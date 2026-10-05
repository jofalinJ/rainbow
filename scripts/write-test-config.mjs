import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const url=(process.env.SUPABASE_TEST_URL||"").trim();
const key=(process.env.SUPABASE_TEST_PUBLISHABLE_KEY||"").trim();
const productionUrl="https://ajnicsvtymvvkgepjmmk2.supabase.co";
if(!url||!key)throw new Error("SUPABASE_TEST_URL and SUPABASE_TEST_PUBLISHABLE_KEY are required.");
if(url.replace(/\/$/,"")===productionUrl)throw new Error("Refusing to configure tests against production.");

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const content="window.RAINBOW_CONFIG=Object.freeze({\n"+
  "  supabaseUrl:"+JSON.stringify(url)+",\n"+
  "  supabasePublishableKey:"+JSON.stringify(key)+"\n"+
  "});\n";
await fs.writeFile(path.join(root,"admin/config.js"),content,"utf8");
console.log("Test configuration written for isolated Supabase environment.");
