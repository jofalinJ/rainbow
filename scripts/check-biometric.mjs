import {spawnSync} from 'node:child_process';
// Backend pins are independent of frontend packages and have a separate lockfile.
const result=spawnSync('deno',['check','--node-modules-dir=none','--lock=supabase/deno.lock',
  'supabase/functions/face-attendance/index.ts','supabase/functions/face-attendance-retention/index.ts'],
  {stdio:'inherit',env:{...process.env,DENO_NO_PACKAGE_JSON:'1'}});
process.exit(result.status??1);
