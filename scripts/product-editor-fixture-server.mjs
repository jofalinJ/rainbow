/* Local-only product editor QA: synthetic transport, no production connection. */
import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {isPublicAssetPath} from "./public-asset-manifest.mjs";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const port=Number(process.env.PRODUCT_EDITOR_FIXTURE_PORT||8848);
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".mjs":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".png":"image/png",".svg":"image/svg+xml",".jpg":"image/jpeg",".webp":"image/webp",".json":"application/json",".webmanifest":"application/manifest+json",".woff2":"font/woff2"};
const csp="default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data: blob:; font-src 'self'; frame-src 'self'; form-action 'self'; base-uri 'self'; worker-src 'none'; object-src 'none'";
const server=http.createServer(async(req,res)=>{
 const headers={"Content-Security-Policy":csp,"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
 const respond=(status,body,type="text/plain; charset=utf-8")=>{res.writeHead(status,{...headers,"Content-Type":type});res.end(req.method==="HEAD"?"":body);};
 if(req.headers.host!=="127.0.0.1:"+port||!["GET","HEAD"].includes(req.method)){respond(403,"Local read-only fixture server");return;}
 try{
  const url=new URL(req.url,"http://127.0.0.1:"+port);
  if(url.pathname==="/__fixture/bootstrap.js"){respond(200,await fs.readFile(path.join(root,"tests/fixtures/product-editor-browser.js")),mime[".js"]);return;}
  if(["/admin/config.js","/config.js"].includes(url.pathname)){
   respond(200,'window.RAINBOW_SUPABASE_CONFIG=Object.freeze({supabaseUrl:"https://product-editor-fixture.invalid",supabasePublishableKey:"fixture-public-only"});window.RAINBOW_MULTI_SHOP_ENABLED=true;',mime[".js"]);return;
  }
  if(url.pathname==="/admin/pwa.js"){respond(200,"/* Service workers are disabled for local QA. */",mime[".js"]);return;}
  if(url.pathname==="/admin/service-worker.js"){respond(403,"Service workers disabled");return;}
  const relative=decodeURIComponent(url.pathname==="/"?"/admin/products.html":url.pathname).replace(/^\//,"");
  if(!isPublicAssetPath(relative)||!Object.hasOwn(mime,path.extname(relative))){respond(403,"Private fixture path");return;}
  const target=path.resolve(root,relative),realTarget=await fs.realpath(target);
  if(!realTarget.startsWith(root+path.sep)||!(await fs.stat(realTarget)).isFile()){respond(403,"Private fixture path");return;}
  let content=await fs.readFile(realTarget);
  if(target.endsWith(".html")){
   let html=content.toString().replace(/<script\b[^>]+src=["']https?:[^"']+["'][^>]*><\/script>/gi,"")
    .replace(/<link\b[^>]*(?:href=["']https?:[^"']+["'])[^>]*>/gi,"");
   html=html.replace(/<head([^>]*)>/i,'<head$1><script src="/__fixture/bootstrap.js"></script>');content=Buffer.from(html);
  }
  respond(200,content,mime[path.extname(target)]);
 }catch{respond(404,"Local fixture resource unavailable");}
});
server.listen(port,"127.0.0.1",()=>console.log("PRODUCT EDITOR FIXTURE http://127.0.0.1:"+port+"/admin/products.html?fixtureRole=cashier"));
