import { createClient } from 'npm:@supabase/supabase-js@2.58.0';
import { awsProvider } from './aws-provider.ts';
import { handleOperation, BiometricError, readRequestBody } from './service.mjs';

Deno.serve(async (request: Request) => {
  const env = Deno.env.toObject();
  const origin = request.headers.get('Origin') || '';
  const allowed = (env.BIOMETRIC_ALLOWED_ORIGINS || '').split(',').map(s => s.trim()).filter(Boolean);
  const headers: Record<string,string> = {'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin',
    'Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Access-Control-Allow-Methods':'POST, OPTIONS'};
  if (allowed.includes(origin)) headers['Access-Control-Allow-Origin'] = origin;
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body),{status,headers});
  if (origin && !allowed.includes(origin)) return json({code:'ORIGIN_REJECTED',error:'This origin is not authorized.'},403);
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (request.method !== 'POST') return json({code:'METHOD_REJECTED',error:'Use POST.'},405);
  try {
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer ')) return json({code:'AUTH_EXPIRED',error:'Sign in again to continue.'},401);
    const db = createClient(env.SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
    const {data:{user},error} = await db.auth.getUser(authorization.slice(7));
    if (error || !user) return json({code:'AUTH_EXPIRED',error:'Your session expired. Sign in again.'},401);
    // Attendance requests contain identifiers only; reject uploads and unbounded input.
    const text = await readRequestBody(request);
    let body;
    try { body = JSON.parse(text); } catch { return json({code:'INVALID_REQUEST',error:'Invalid JSON.'},400); }
    return json(await handleOperation({db,provider:awsProvider(env),actor:user.id,env},body));
  } catch (error) {
    if (error instanceof BiometricError) return json({code:error.code,error:error.message},error.status);
    // Never log provider responses, photos, template references, credentials or request bodies.
    return json({code:'PROVIDER_UNAVAILABLE',error:'Face verification could not be confirmed. Refresh attendance before retrying, or ask an administrator for help.'},503);
  }
});
