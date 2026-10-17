import {createClient} from 'npm:@supabase/supabase-js@2.58.0';
import {providers} from '../face-attendance/providers.ts';
import {openCollection,collectionDescriptor} from '../face-attendance/service.mjs';

// Invoke daily from an authenticated scheduler. Retry incomplete deletions on every run.
Deno.serve(async (request: Request) => {
  const env = Deno.env.toObject();
  const secret = env.BIOMETRIC_RETENTION_TOKEN || '';
  const supplied = request.headers.get('Authorization')?.replace(/^Bearer /,'') || '';
  const digest = async (value: string) => new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)));
  const a = await digest(secret), b = await digest(supplied);
  let difference = 0;
  for (let i=0;i<a.length;i++) difference |= a[i] ^ b[i];
  const headers = {'Content-Type':'application/json','Cache-Control':'no-store'};
  if (request.method !== 'POST' || secret.length < 32 || difference !== 0) return new Response('{}',{status:403,headers});
  const db = createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
  const providerFor = providers(env);
  const cutoff = new Date().toISOString();
  const {data,error} = await db.from('biometric_enrollments').select('staff_id,generation').lte('expires_at',cutoff).limit(100);
  if (error) return new Response('{"error":"Retention query failed"}',{status:503,headers});
  let removed=0,failed=0;
  for (const row of data || []) {
    try {
      // Recheck expiry in the update: a stale candidate must not delete a
      // generation whose enrollment completed after the initial selection.
      const {data:locked,error:lockError} = await db.from('biometric_enrollments').update({status:'deleting'}).eq('staff_id',row.staff_id).eq('generation',row.generation).lte('expires_at',cutoff).select('collection_ref').maybeSingle();
      if (lockError) throw lockError;
      if (!locked) continue;
      const saved = collectionDescriptor(await openCollection(locked.collection_ref,row.staff_id,env.BIOMETRIC_TEMPLATE_KEY));
      await providerFor(saved.kind).deleteCollection(saved.id);
      const {error:purgeError} = await db.rpc('biometric_purge_enrollment',{p_staff:row.staff_id,p_generation:row.generation});
      if (purgeError) throw purgeError;
      removed++;
    } catch { failed++; }
  }
  const {error:sessionError} = await db.from('biometric_sessions').delete().lt('created_at',new Date(Date.now()-86400000).toISOString());
  return new Response(JSON.stringify({removed,failed,session_cleanup:!sessionError,more_possible:data?.length===100}),{status:failed||sessionError?503:200,headers});
});
