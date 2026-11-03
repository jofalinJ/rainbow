import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const required=["404.html","reset-password.html","account-recovery.js","supabase-client.js","recovery-redirect.js","index.html","product.html","product-page.js","product-page.css","order.html","staff/index.html","admin/index.html","admin/login.html","admin/products.html","admin/inventory.html","admin/staff.html","admin/settings.html","admin/orders.html","admin/billing.html","admin/billing.js","admin/bills.html","admin/bills.js","admin/orders.js","admin/app.js","admin/config.js","business-live.js","content.js","invoice.html","invoice.js","invoice-template.js","invoice-template.css","bill-pdf.js","scripts/run-e2e-local.mjs"];
const forbiddenPatterns=[/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*(?!\$\{\{)[A-Za-z0-9._-]{20,}/i,/-----BEGIN [A-Z ]+PRIVATE KEY-----/];

for(const file of required){
  try{await fs.access(path.join(root,file));}
  catch{throw new Error("Missing required project file: "+file);}
}

const htmlFiles=["404.html","reset-password.html","product.html","staff/index.html","admin/index.html","admin/login.html","admin/products.html","admin/inventory.html","admin/staff.html","admin/settings.html","admin/orders.html","admin/billing.html","admin/bills.html","invoice.html","order.html","index.html","admin/attendance.html","admin/customers.html","admin/my-attendance.html","admin/offline.html","admin/reports.html","privacy-policy.html","returns-and-refunds.html","shipping-policy.html","sitemap.html","terms-and-conditions.html"];
const refRe=/(?:src|href)=["']([^"']+)["']/gi;

for(const file of htmlFiles){
  const html=await fs.readFile(path.join(root,file),"utf8");
  for(const match of html.matchAll(refRe)){
    const ref=match[1];
    if(!ref||ref.startsWith("#")||/^(?:(?:https?:)?\/\/|mailto:|tel:|sms:)/i.test(ref))continue;
    const clean=ref.split("?")[0].split("#")[0];
    if(!clean)continue;
    try{await fs.access(clean.startsWith("/")?path.join(root,clean):path.resolve(path.dirname(path.join(root,file)),clean));}
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

// Prevent empty placeholders or retired pictures from silently re-entering the
// public Pages bundle. Brand art must be used by actual browser-delivered code;
// references in internal documentation or tests do not count.
const brandDir=path.join(root,"assets/brand");
const runtimePaths=(await walk(root)).filter(file=>{
  const relative=path.relative(root,file).replaceAll(path.sep,"/");
  if(relative.startsWith(".git/")||relative.startsWith("docs/")||
     relative.startsWith("tests/")||relative.startsWith("scripts/")||
     relative.startsWith("backend/")||relative.startsWith("supabase/")||
     relative.startsWith("dist-pages/"))return false;
  return /\.(html|js|mjs|css)$/i.test(relative);
});
const runtimeCode=(await Promise.all(runtimePaths.map(file=>fs.readFile(file,"utf8")))).join("\n");
for(const filename of await fs.readdir(brandDir)){
  const full=path.join(brandDir,filename);
  const stat=await fs.stat(full);
  if(!stat.isFile())continue;
  if(!/\.(png|jpe?g|webp|svg)$/i.test(filename)||stat.size<100)
    throw new Error("Invalid brand asset / empty placeholder: "+filename);
  if(!runtimeCode.includes("assets/brand/"+filename))
    throw new Error("Unreferenced brand asset should not be deployed: "+filename);
}

console.log("Static build verification passed.");
