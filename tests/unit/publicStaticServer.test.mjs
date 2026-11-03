import {describe,it,expect} from "vitest";
import {spawn} from "node:child_process";
import {createServer} from "node:net";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  isPublicAssetPath,publicRootFiles,publicDirectories
} from "../../scripts/public-asset-manifest.mjs";

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");

async function reservePort(){
  const server=createServer();
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",resolve);
  });
  const port=server.address().port;
  await new Promise(resolve=>server.close(resolve));
  return port;
}

describe("one public static manifest for build and preview",()=>{
  it("allows the customer storefront and the current staff PWA",()=>{
    for(const file of ["index.html","order.html","admin/login.html",
      "admin/manifest.webmanifest","admin/service-worker.js",
      "staff/index.html","assets/brand/rainbow-logo.png",
      "src/domain/productRules.mjs"]){
      expect(isPublicAssetPath(file),file).toBe(true);
    }
    expect(publicRootFiles).toContain("order-razorpay.mjs");
    expect(publicDirectories).toContain("admin");
  });

  it("refuses backend, SQL, private files, dotfiles and traversal",()=>{
    for(const file of ["backend/rainbow-api/src/index.js",
      "supabase/migrations/20261025220000_erp_branch_pos.sql",
      "scripts/static-server.mjs","tests/fixtures/checkout-browser.js",
      "docs/OWNER_RELEASE_GATES_20261103.md","package.json",
      "package-lock.json",".git/config",".github/workflows/ci.yml",
      "admin/../backend/secret","assets/brand/../../supabase/secret",
      "admin/.env","admin//login.html","admin\\login.html"]){
      expect(isPublicAssetPath(file),file).toBe(false);
    }
  });

  it("keeps production builder and preview server on the same manifest",async()=>{
    const {readFileSync}=await import("node:fs");
    const builder=readFileSync(path.join(root,"scripts/build-cloudflare.mjs"),"utf8");
    const server=readFileSync(path.join(root,"scripts/static-server.mjs"),"utf8");
    expect(builder).toContain('from "./public-asset-manifest.mjs"');
    expect(server).toContain('from "./public-asset-manifest.mjs"');
    expect(server).toContain("isPublicAssetPath(relative)");
  });

  it("serves public pages but blocks private repository files over HTTP",async()=>{
    const port=await reservePort();
    const proc=spawn(process.execPath,["scripts/static-server.mjs"],{
      cwd:root,env:{...process.env,PORT:String(port)},
      stdio:["ignore","pipe","pipe"]
    });
    const base="http://127.0.0.1:"+port;
    try{
      let started=false;
      for(let i=0;i<45;i++){
        try{
          const r=await fetch(base+"/");
          if(r.status===200){started=true;break;}
        }catch{}
        await new Promise(resolve=>setTimeout(resolve,100));
      }
      expect(started).toBe(true);
      for(const file of ["/","/order.html","/admin/login.html",
        "/admin/manifest.webmanifest","/admin/","/staff/",
        "/assets/brand/rainbow-logo.png","/src/domain/productRules.mjs"]){
        const r=await fetch(base+file);
        expect(r.status,file).toBe(200);
      }
      for(const file of ["/backend/rainbow-api/src/index.js",
        "/supabase/migrations/20261025220000_erp_branch_pos.sql",
        "/.git/config","/package.json","/scripts/static-server.mjs",
        "/docs/OWNER_RELEASE_GATES_20261103.md","/tests/fixtures/checkout-browser.js"]){
        const r=await fetch(base+file);
        expect(r.status,file).toBe(403);
      }
      const manifest=await fetch(base+"/admin/manifest.webmanifest");
      expect(manifest.headers.get("content-type")).toContain("application/manifest+json");
      const head=await fetch(base+"/order.html",{method:"HEAD"});
      expect(head.status).toBe(200);
      expect(await head.text()).toBe("");
      const post=await fetch(base+"/order.html",{method:"POST"});
      expect(post.status).toBe(405);
    }finally{
      proc.kill("SIGTERM");
    }
  },12000);
});
