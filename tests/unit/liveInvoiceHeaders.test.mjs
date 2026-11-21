import {describe,it,expect,vi} from "vitest";
import {auditPublicInvoiceHeaders} from "../../scripts/audit-live-invoice-headers.mjs";

function response(headers={},status=200){
 return {ok:status>=200&&status<300,status,headers:new Headers(headers)};
}
describe("read-only public invoice HTTP header probe",()=>{
 it("uses HEAD with no customer token, cookies, or other sensitive data",async()=>{
   const mock=vi.fn(async()=>response({
     "Cache-Control":"private, no-store, max-age=0",
     "Referrer-Policy":"no-referrer",
     "X-Robots-Tag":"noindex, nofollow, noarchive"
   }));
   const result=await auditPublicInvoiceHeaders(mock);
   const [url,options]=mock.mock.calls[0];
   expect(url.href).toBe("https://rainbowgoldcovering.com/invoice.html");
   expect(url.search).toBe("");
   expect(options.method).toBe("HEAD");
   expect(options.redirect).toBe("manual");
   expect(options.headers.cookie).toBeUndefined();
   expect(result.checks).toEqual({
     http_success:true,
     no_store_response_header:true,
     no_referrer_response_header:true,
     noindex_response_header:true
   });
 });
 it("flags unverified GitHub Pages-style headers without hiding the risk",async()=>{
   const result=await auditPublicInvoiceHeaders(async()=>response({
     "Cache-Control":"max-age=600",
     "X-GitHub-Request-Id":"fake-fixture",
     "Content-Type":"text/html"
   }));
   expect(result.hosting_hint).toBe("github-pages");
   expect(result.checks.no_store_response_header).toBe(false);
   expect(result.checks.no_referrer_response_header).toBe(false);
   expect(result.checks.noindex_response_header).toBe(false);
 });
 it("rejects unsafe redirects instead of issuing an external request",async()=>{
   for(const target of ["https://evil.example/invoice.html",
     "http://rainbowgoldcovering.com/invoice.html",
     "https://rainbowgoldcovering.com/invoice.html?token=secret"]){
     const mock=vi.fn(async()=>response({Location:target},302));
     await expect(auditPublicInvoiceHeaders(mock)).rejects.toThrow(
       "Unexpected invoice origin redirect");
     expect(mock).toHaveBeenCalledTimes(1);
   }
 });
});
