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

    // Preserve historical orders and stock audit attribution: never delete auth.users.
    const { data: archived, error: archiveError } = await admin
      .from("staff_profiles")
      .update({ active: false, archived_at: new Date().toISOString() })
      .eq("user_id", targetUserId)
      .neq("role", "admin")
      .select("user_id")
      .maybeSingle();

    if (archiveError || !archived) {
      return json({ error: "Could not remove staff access. No account was deleted." }, 500);
    }

    // active=false prevents data access even with an existing JWT.
    // Ban future password sign-ins as an additional protection.
    const { error: banError } = await admin.auth.admin.updateUserById(
      targetUserId,
      { ban_duration: "876000h" }
    );
    if (banError) {
      console.error("Staff sign-in ban failed after access was revoked:", banError);
      return json({
        success: true,
        archived: true,
        warning: "Staff data access is disabled, but the sign-in ban needs admin follow-up."
      });
    }
    return json({ success: true, archived: true, user_id: targetUserId, username: target.username });
  } catch (error) {
    return json({
      error: error instanceof Error ? error.message : "Could not delete staff."
    }, 500);
  }
});