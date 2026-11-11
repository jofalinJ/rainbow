/**
 * Conservative audit of browser-delivered JavaScript/CSS modules.
 * Uses the production Pages manifest, not a loose file-system scan, so backend,
 * SQL migrations and tests are never mistaken for public dead code.
 * A missing literal reference is a review candidate, not proof of deadness:
 * third-party scripts, runtime-generated URLs and reflective calls exist.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {publicRootFiles,publicDirectories} from "./public-asset-manifest.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const skip=new Set(["categories","products"]); // Generated SEO routes are optional.
const sourceExt=new Set([".html",".js",".mjs",".css",".webmanifest"]);
const moduleExt=new Set([".js",".mjs",".css"]);
const sources=new Map();
async function readPublic(relative){
  const file=path.join(root,relative);
  let info;
  try{info=await fs.lstat(file);}catch(error){if(error.code==="ENOENT")return;throw error;}
  if(info.isSymbolicLink())throw new Error("Refusing symlinked public source: "+relative);
  if(info.isDirectory()){
    for(const entry of await fs.readdir(file))
      await readPublic(path.posix.join(relative,entry));
    return;
  }
  if(!info.isFile()||!sourceExt.has(path.extname(relative)))return;
  sources.set(relative,await fs.readFile(file,"utf8"));
}
for(const entry of publicRootFiles)await readPublic(entry);
for(const entry of publicDirectories)if(!skip.has(entry))await readPublic(entry);

const candidates=[];
let javascriptBytes=0,cssBytes=0;
for(const [asset,body] of sources){
  const ext=path.extname(asset);
  if(ext===".js"||ext===".mjs")javascriptBytes+=Buffer.byteLength(body);
  if(ext===".css")cssBytes+=Buffer.byteLength(body);
  if(!moduleExt.has(ext))continue;
  const basename=path.posix.basename(asset);
  // Check references in other runtime documents, not tests or documentation.
  // Include import specifiers, script elements, cache manifests, worker fetches,
  // dynamically constructed links and the source names in PWA precache arrays.
  const inbound=[...sources].filter(([source,text])=>source!==asset&&text.includes(basename)).map(([source])=>source);
  if(inbound.length===0)candidates.push(asset);
}
const report={
  runtimeSources:sources.size,
  runtimeJavaScriptBytes:javascriptBytes,
  runtimeCssBytes:cssBytes,
  orphanCandidates:candidates
};
console.log("Browser asset liveness audit:",JSON.stringify(report,null,2));
if(process.argv.includes("--strict")&&candidates.length){
  console.error("Review unreferenced public scripts or styles before release.");
  process.exitCode=1;
}
