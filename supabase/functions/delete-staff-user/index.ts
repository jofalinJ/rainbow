import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS"
};

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" }
  });

const isUuid = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

async function collectFiles(storage: any, prefix: string, depth = 0): Promise<string[]> {
  if (depth > 5) throw new Error("Staff photo folder nesting is invalid.");
  const files: string[] = [];
  let offset = 0;
  while (true) {
    const { data, error } = await storage.from("staff-private").list(prefix, { limit: 100, offset });
    if (error) throw error;
    const entries = data || [];
    for (const entry of entries) {
      const path = prefix + "/" + entry.name;
      if (entry.id) files.push(path);
      else files.push(...await collectFiles(storage, path, depth + 1));
    }
    if (entries.length < 100) break;
    offset += entries.length;
  }
  return files;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authorization = req.headers.get("Authorization");
    if (!authorization) return json({ error: "Unauthorized" }, 401);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const token = authorization.replace(/^Bearer\s+/i, "");
    const { data: { user: caller }, error: authError } = await admin.auth.getUser(token);
    if (authError || !caller) return json({ error: "Unauthorized" }, 401);

    const { data: callerProfile, error: callerProfileError } = await admin
      .from("staff_profiles")
      .select("role, active")
      .eq("user_id", caller.id)
      .maybeSingle();

    if (callerProfileError) return json({ error: "Could not verify admin access." }, 500);
    if (!callerProfile?.active || callerProfile.role !== "admin") {
      return json({ error: "Admin access required." }, 403);
    }

    const body = await req.json().catch(() => ({}));
    const targetUserId = String(body.user_id || "").trim();

    if (!isUuid(targetUserId)) {
      return json({ error: "Invalid staff account." }, 400);
    }

    if (targetUserId === caller.id) {
      return json({ error: "You cannot delete your own admin account." }, 400);
    }

    const { data: target, error: targetError } = await admin
      .from("staff_profiles")
      .select("user_id, full_name, username, role")
      .eq("user_id", targetUserId)
      .maybeSingle();

    if (targetError) return json({ error: "Could not find that staff account." }, 500);
    if (!target) return json({ error: "Staff account not found." }, 404);
    if (target.role === "admin") {
      return json({ error: "Admin accounts are protected and cannot be deleted here." }, 403);
    }

    const { data: enrollment, error: enrollmentError } = await admin
      .from("biometric_enrollments").select("staff_id").eq("staff_id", targetUserId).maybeSingle();
    if (enrollmentError) return json({ error: "Could not check biometric deletion requirements." }, 503);
    if (enrollment) return json({
      error: "Delete this employee's face enrollment from Attendance first so the provider templates are removed and audited."
    }, 409);

    try {
      const photos = [
        ...await collectFiles(admin.storage, "profiles/" + targetUserId),
        ...await collectFiles(admin.storage, "attendance/" + targetUserId)
      ];
      for (let offset = 0; offset < photos.length; offset += 100) {
        const { error } = await admin.storage.from("staff-private").remove(photos.slice(offset, offset + 100));
        if (error) throw error;
      }
    } catch (photoError) {
      console.error("Private staff photo cleanup failed:", photoError);
      return json({ error: "Private staff photos could not be removed; the account was not deleted." }, 500);
    }

    const { error: authDeleteError } = await admin.auth.admin.deleteUser(targetUserId);
    if (authDeleteError) return json({ error: "Could not delete the staff login." }, 500);

    const { error: profileDeleteError } = await admin
      .from("staff_profiles")
      .delete()
      .eq("user_id", targetUserId);

    if (profileDeleteError) {
      return json({
        error: "The login was removed, but the staff profile could not be removed. Contact an administrator."
      }, 500);
    }

    return json({
      success: true,
      user_id: targetUserId,
      username: target.username
    });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Could not delete staff."
    }, 500);
  }
});
