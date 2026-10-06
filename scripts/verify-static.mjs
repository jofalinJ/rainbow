import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const required=["index.html","admin/index.html","admin/login.html","admin/products.html","admin/inventory.html","admin/staff.html","admin/billing.html","admin/billing.js","admin/app.js","admin/config.js"];
const forbiddenPatterns=[/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*(?!\$\{\{)[A-Za-z0-9._-]{20,}/i,/-----BEGIN [A-Z ]+PRIVATE KEY-----/];

for(const file of required){
  try{await fs.access(path.join(root,file));}
  catch{throw new Error("Missing required project file: "+file);}
}

const htmlFiles=["admin/index.html","admin/login.html","admin/products.html","admin/inventory.html","admin/staff.html","admin/billing.html","index.html"];
const refRe=/(?:src|href)=["']([^"']+)["']/gi;

for(const file of htmlFiles){
  const html=await fs.readFile(path.join(root,file),"utf8");
  for(const match of html.matchAll(refRe)){
    const ref=match[1];
    if(!ref||ref.startsWith("#")||/^(https?:)?\/\//i.test(ref))continue;
    const clean=ref.split("?")[0].split("#")[0];
    if(!clean)continue;
    try{await fs.access(path.resolve(path.dirname(path.join(root,file)),clean));}
    catch{throw new Error("Broken local asset reference in "+file+": "+ref);}
  }
}

async function walk(dir){
  const out=[];
  for(const entry of await fs.readdir(dir,{withFileTypes:true})){
    if(["node_modules","coverage","test-results"].includes(entry.name))continue;
    const full=path.join(dir,entry.name);
    if(entry.isDirectory())out.push(...await walk(full));else out.push(full);
  }
  return out;
}

for(const file of await walk(root)){
  if(/package-lock\.json$/.test(file))continue;
  if(!/\.(html|js|mjs|json|md|yml|yaml|css)$/.test(file))continue;
  const content=await fs.readFile(file,"utf8");
  for(const pattern of forbiddenPatterns){
    if(pattern.test(content))throw new Error("Potential secret material found in "+path.relative(root,file));
  }
}
console.log("Static build verification passed.");
