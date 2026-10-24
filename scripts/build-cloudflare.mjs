/**
 * Publish ONLY browser-delivered assets to Cloudflare Pages.
 *
 * Keep backend Workers, Supabase migrations/functions, tests, operational
 * documentation and the repository's Git history out of the static output.
 * Browser modules in src/domain ARE required by the staff PWA.
 *
 * Cloudflare Pages settings:
 *   Root directory: /
 *   Build command: npm run build:pages
 *   Build output directory: dist-pages
 */
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const output=path.join(repo,"dist-pages");

const publicRootFiles=[
  "index.html","order.html","product.html","invoice.html",
  "privacy-policy.html","returns-and-refunds.html",
  "shipping-policy.html","terms-and-conditions.html",
  "sitemap.html","sitemap.xml","robots.txt",
  "analytics.js","bill-pdf.js","business-live.js","config.js",
  "content.css","content.js","mobile-storefront.css","mobile-storefront.js","invoice-template.css","invoice-template.js",
  "invoice.js","order-pricing.mjs","order.css","order.js",
  "payment-config.js","order-razorpay.mjs",
  "product-page.css","product-page.js","shop-catalogue.js",
  "shop-discovery.js"
];
const publicDirectories=["admin","staff","assets","src/domain"];
const optionalGeneratedDirectories=["categories","products"];

await fs.rm(output,{recursive:true,force:true});
await fs.mkdir(output,{recursive:true});

for(const file of publicRootFiles){
  const sourcePath=path.join(repo,file);
  const info=await fs.stat(sourcePath);
  if(!info.isFile())throw new Error("Required public file is not a file: "+file);
  await fs.copyFile(sourcePath,path.join(output,file));
}
for(const dir of publicDirectories){
  await fs.cp(path.join(repo,dir),path.join(output,dir),{recursive:true});
}
for(const dir of optionalGeneratedDirectories){
  try{await fs.access(path.join(repo,dir));}
  catch(error){if(error.code==="ENOENT")continue;throw error;}
  await fs.cp(path.join(repo,dir),path.join(output,dir),{recursive:true});
}

// Hard-fail if private project directories accidentally enter the published tree.
for(const hidden of ["backend","supabase","tests","docs","scripts",".github",
                       ".gitignore","CNAME","package.json"]){
  try{
    await fs.access(path.join(output,hidden));
    throw new Error("Private repository resource in Pages output: "+hidden);
  }catch(error){
    if(error.code!=="ENOENT")throw error;
  }
}

for(const required of [
  "index.html","staff/index.html","admin/login.html","admin/manifest.webmanifest",
  "admin/service-worker.js","src/domain/productRules.mjs",
  "payment-config.js","order-razorpay.mjs","order.js"
]){
  await fs.access(path.join(output,required));
}

console.log("Cloudflare Pages publish directory ready: dist-pages");
