import {describe,it,expect,vi} from "vitest";
import {readFileSync} from "node:fs";
import {runInNewContext} from "node:vm";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const invoice=read("invoice.js");
const html=read("invoice.html");
const headers=read("_headers");
const manifest=read("scripts/public-asset-manifest.mjs");
const builder=read("scripts/build-cloudflare.mjs");

async function invoiceScene(search,{result=null,error=null}={}){
 const dom=new Map();
 const doc={getElementById(id){
   if(!dom.has(id))dom.set(id,{innerHTML:"",style:{display:"none"},onclick:null});
   return dom.get(id);
 }};
 const rpc=vi.fn(async()=>({data:result,error}));
 const render=vi.fn();
 const fakeConsole={error:vi.fn()};
 const win={RAINBOW_SUPABASE_CONFIG:{supabaseUrl:"https://example.supabase.co",
   supabasePublishableKey:"sb_publishable_testing_only"},
   supabase:{createClient:()=>({rpc})},
   RainbowInvoice:{render,money:n=>"₹"+n},
   open:vi.fn(),print:vi.fn()};
 const scope={document:doc,location:{search},window:win,
   URLSearchParams,console:fakeConsole,setTimeout:vi.fn()};
 runInNewContext(invoice.replace(/\bloadInvoice\(\);\s*$/,"this.invoiceLoadPromise=loadInvoice();"),scope);
 await scope.invoiceLoadPromise;
 return {dom,rpc,render,win,fakeConsole};
}
describe("public invoice bearer-link privacy",()=>{
 it("loads invoice pages without forwarding the token as a referrer or caching the document",()=>{
   expect(html).toContain('<meta name="referrer" content="no-referrer">');
   expect(html).toContain('name="robots" content="noindex,nofollow,noarchive"');
   expect(headers).toContain("/invoice.html");
   expect(headers).toContain("Referrer-Policy: no-referrer");
   expect(headers).toContain("Cache-Control: private, no-store");
   expect(headers).toContain("X-Robots-Tag: noindex");
   expect(manifest).toContain('"invoice.html","_headers"');
   expect(builder).toContain('relative!=="_headers"');
   expect(html).toContain("invoice.js?v=20261121-privacy");
 });
 it("rejects missing or malformed tokens without contacting Supabase",async()=>{
   for(const search of ["","?token=obvious-guess","?token=<script>alert(1)</script>"]){
     const {dom,rpc,render}=await invoiceScene(search);
     expect(rpc).not.toHaveBeenCalled();
     expect(render).not.toHaveBeenCalled();
     expect(dom.get("invoice").innerHTML).toMatch(/Missing bill link|Invalid bill link/);
   }
 });
 it("keeps valid private invoice links printable, with optional WhatsApp action",async()=>{
   const token="00000000-0000-4000-8000-000000000001";
   const data={customer_phone:"919999999999",invoice_number:"TEST-INV",total_amount:25};
   const {dom,rpc,render,win}=await invoiceScene("?token="+token,{result:data});
   expect(rpc).toHaveBeenCalledWith("get_public_invoice",{p_token:token});
   expect(render).toHaveBeenCalled();
   expect(dom.get("waBtn").style.display).toBe("inline-block");
   dom.get("printBtn").onclick();
   expect(win.print).toHaveBeenCalledTimes(1);
 });
 it("does not log private tokens even if the invoice RPC rejects them",async()=>{
   const token="00000000-0000-4000-8000-000000000001";
   const {dom,rpc,fakeConsole}=await invoiceScene("?token="+token,{error:{message:"token="+token}});
   expect(rpc).toHaveBeenCalledTimes(1);
   expect(dom.get("invoice").innerHTML).toContain("Could not load this bill");
   expect(fakeConsole.error).not.toHaveBeenCalled();
 });
});
