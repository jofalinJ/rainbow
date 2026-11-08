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
import {publicRootFiles,publicDirectories} from "./public-asset-manifest.mjs";

const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const output=path.join(repo,"dist-pages");
const seoEnabled=process.env.RAINBOW_SEO_CATALOGUE_APPROVED==="true";
if(seoEnabled){
  // Read only public published product data: never use service-role credentials.
  const {publicCatalogue,generateSeo}=await import("./generate-seo-pages.mjs");
  const result=await generateSeo(await publicCatalogue());
  console.log("Cloudflare SEO catalogue:",result);
}
const optionalGeneratedDirectories=new Set(["categories","products"]);

await fs.rm(output,{recursive:true,force:true});
await fs.mkdir(output,{recursive:true});

for(const file of publicRootFiles){
  const sourcePath=path.join(repo,file);
  const info=await fs.stat(sourcePath);
  if(!info.isFile())throw new Error("Required public file is not a file: "+file);
  await fs.copyFile(sourcePath,path.join(output,file));
}
for(const dir of publicDirectories){
  if(optionalGeneratedDirectories.has(dir)){
    if(!seoEnabled)continue;
    try{await fs.access(path.join(repo,dir));}
    catch(error){if(error.code==="ENOENT")continue;throw error;}
  }
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

// Copies of public directories must not accidentally ship hidden files,
// credentials, SQL, maps, internal docs, or symlinks on a future commit.
const publicExtensions=new Set([
  ".html",".js",".mjs",".css",".json",".webmanifest",
  ".svg",".png",".jpg",".jpeg",".webp",".xml",".txt",".woff2"
]);
async function validatePublishedTree(directory){
  for(const entry of await fs.readdir(directory,{withFileTypes:true})){
    const full=path.join(directory,entry.name);
    if(entry.name.startsWith(".")||entry.isSymbolicLink())
      throw new Error("Unsafe publicly shipped file: "+path.relative(output,full));
    if(entry.isDirectory()){await validatePublishedTree(full);continue;}
    if(!entry.isFile()||!publicExtensions.has(path.extname(entry.name).toLowerCase()))
      throw new Error("Unsafe publicly shipped file: "+path.relative(output,full));
  }
}
await validatePublishedTree(output);

for(const required of [
  "index.html","staff/index.html","admin/login.html","admin/manifest.webmanifest",
  "admin/service-worker.js","src/domain/productRules.mjs",
  "payment-config.js","order-razorpay.mjs","order.js"
]){
  await fs.access(path.join(output,required));
}

console.log("Cloudflare Pages publish directory ready: dist-pages");
