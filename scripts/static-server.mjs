import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {isPublicAssetPath} from "./public-asset-manifest.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const port=Number(process.env.PORT||4173);
const mime={
  ".html":"text/html; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".mjs":"text/javascript; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json",
  ".svg":"image/svg+xml",
  ".png":"image/png",
  ".jpg":"image/jpeg",
  ".jpeg":"image/jpeg",
  ".webp":"image/webp",
  ".xml":"application/xml; charset=utf-8",
  ".txt":"text/plain; charset=utf-8",
  ".woff2":"font/woff2"
};

function safePath(urlPath){
  let decoded;
  try{decoded=decodeURIComponent((urlPath||"/").split("?")[0]);}
  catch{return null;}
  let relative=decoded.replace(/^\/+/,"")||"index.html";
  if(["admin","admin/","staff","staff/"].includes(relative))
    relative=relative.replace(/\/$/,"")+"/index.html";
  if(!isPublicAssetPath(relative))return null;
  const full=path.resolve(root,relative);
  if(!full.startsWith(root+path.sep))return null;
  return full;
}

const server=http.createServer(async(req,res)=>{
  const headers={"Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
  const respond=(status,body,type="text/plain; charset=utf-8")=>{
    res.writeHead(status,{...headers,"Content-Type":type});
    res.end(req.method==="HEAD"?"":body);
  };
  if(req.method!=="GET"&&req.method!=="HEAD"){
    res.writeHead(405,{...headers,Allow:"GET, HEAD"});res.end();return;
  }
  try{
    const filePath=safePath(req.url);
    if(!filePath){respond(403,"Forbidden");return;}
    let info;
    try{info=await fs.stat(filePath);}
    catch(error){
      if(error.code!=="ENOENT")throw error;
      respond(404,await fs.readFile(path.join(root,"404.html")),"text/html; charset=utf-8");
      return;
    }
    if(!info.isFile()){respond(404,"Not found");return;}
    const body=await fs.readFile(filePath);
    respond(200,body,mime[path.extname(filePath)]||"application/octet-stream");
  }catch{
    respond(500,"Internal server error");
  }
});
server.listen(port,"127.0.0.1",
  ()=>console.log("Static test server listening on http://127.0.0.1:"+port));
