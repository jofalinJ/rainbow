// Disposable PostgreSQL regression: never connects to any Supabase project.
// Install the pinned test runtime outside the repository:
// npm install --prefix /tmp/rainbow-rls-test --ignore-scripts --save-exact @electric-sql/pglite@0.5.10
// PGLITE_MODULE_PATH=/tmp/rainbow-rls-test/node_modules/@electric-sql/pglite/dist/index.js node tests/security/staff-bootstrap-rls.mjs
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const runtime = process.env.PGLITE_MODULE_PATH;
if (!runtime) throw new Error("Set PGLITE_MODULE_PATH to the pinned disposable PGlite runtime.");
const { PGlite } = await import(pathToFileURL(runtime).href);
const db = new PGlite();
const admin = "00000000-0000-4000-8000-000000000001";
const customer = "00000000-0000-4000-8000-000000000002";
const newStaff = "00000000-0000-4000-8000-000000000003";
const migration = await readFile(new URL("../../supabase/migrations/20261018164735_remove_staff_bootstrap_policy.sql", import.meta.url), "utf8");
const actAs = async (role, uid) => {
  await db.exec(`SET ROLE ${role}`);
  await db.query("SELECT set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: uid, role })]);
};
const insertProfile = (uid, role) => db.query(
  "INSERT INTO public.staff_profiles(user_id,role,active) VALUES ($1,$2,true)", [uid, role]
);
const denied = async action => assert.rejects(action, error => error.code === "42501");

try {
  await db.exec(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE TABLE auth.users(id uuid PRIMARY KEY);
    INSERT INTO auth.users VALUES ('${admin}'),('${customer}'),('${newStaff}');
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid;
    $$;
    CREATE TYPE public.staff_role AS ENUM ('admin','cashier','inventory_staff');
    CREATE TABLE public.staff_profiles(
      user_id uuid PRIMARY KEY REFERENCES auth.users(id),
      role public.staff_role NOT NULL,
      active boolean NOT NULL DEFAULT true
    );
    INSERT INTO public.staff_profiles VALUES ('${admin}','admin',true);
    ALTER TABLE public.staff_profiles ENABLE ROW LEVEL SECURITY;
    CREATE FUNCTION public.is_admin() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
      SELECT EXISTS(SELECT 1 FROM public.staff_profiles WHERE user_id=(SELECT auth.uid()) AND role='admin' AND active);
    $$;
    GRANT USAGE ON SCHEMA public,auth TO authenticated,service_role;
    GRANT SELECT,INSERT,UPDATE,DELETE ON public.staff_profiles TO authenticated,service_role;
    CREATE POLICY "admin manage staff" ON public.staff_profiles FOR ALL TO authenticated
      USING ((SELECT is_admin())) WITH CHECK ((SELECT is_admin()));
    CREATE POLICY "staff read own profile" ON public.staff_profiles FOR SELECT TO authenticated
      USING (user_id=(SELECT auth.uid()));
    CREATE POLICY "bootstrap first admin" ON public.staff_profiles FOR INSERT TO authenticated
      WITH CHECK (user_id=(SELECT auth.uid()) AND role='admin' AND NOT EXISTS(SELECT 1 FROM public.staff_profiles));
  `);

  // The bootstrap predicate sees an empty table for an ordinary customer, but
  // PostgreSQL's recursive-policy guard prevents execution of the INSERT.
  await db.exec("BEGIN");
  await actAs("authenticated", customer);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.staff_profiles")).rows[0].n, 0);
  await assert.rejects(() => insertProfile(customer, "admin"), error => error.code === "42P17");
  await db.exec("ROLLBACK; RESET ROLE");
  // The same obsolete policy also breaks a legitimate administrator's INSERT.
  await db.exec("BEGIN");
  await actAs("authenticated", admin);
  assert.equal((await db.query("SELECT public.is_admin() AS allowed")).rows[0].allowed, true);
  await assert.rejects(() => insertProfile(newStaff, "cashier"), error => error.code === "42P17");
  await db.exec("ROLLBACK; RESET ROLE");

  // Apply the exact migration twice to prove idempotence.
  await db.exec(migration);
  await db.exec(migration);
  await actAs("authenticated", customer);
  await denied(() => insertProfile(customer, "admin"));
  await denied(() => insertProfile(customer, "cashier"));
  assert.equal((await db.query("SELECT public.is_admin() AS allowed")).rows[0].allowed, false);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.staff_profiles")).rows[0].n, 0);

  // Existing administrator access and admin-controlled staff provisioning survive.
  await actAs("authenticated", admin);
  assert.equal((await db.query("SELECT public.is_admin() AS allowed")).rows[0].allowed, true);
  await insertProfile(newStaff, "cashier");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.staff_profiles")).rows[0].n, 2);
  await db.query("UPDATE public.staff_profiles SET active=false WHERE user_id=$1", [newStaff]);
  await db.query("DELETE FROM public.staff_profiles WHERE user_id=$1", [newStaff]);

  // The live create-staff-user Edge Function uses this service-role path.
  await actAs("service_role", admin);
  await insertProfile(newStaff, "inventory_staff");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM public.staff_profiles")).rows[0].n, 2);
  console.log("PASS: baseline policy recursion reproduced; customer self-promotion denied after fix; repeat migration, admin CRUD and service-role provisioning pass.");
} finally {
  await db.close();
}
