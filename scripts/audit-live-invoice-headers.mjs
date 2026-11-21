// Read-only public origin probe; no invoice token, no cookies, no PII, no writes.
// The Cloudflare Pages _headers file must not be assumed to control GitHub Pages.
import process from "node:process";
import {resolve} from "node:path";
import {pathToFileURL} from "node:url";

const TARGET="https://rainbowgoldcovering.com/invoice.html";
const APPROVED=new Set(["rainbowgoldcovering.com","www.rainbowgoldcovering.com"]);

export async function auditPublicInvoiceHeaders(fetcher=fetch){
 const request=new URL(TARGET);
 const response=await fetcher(request,{method:"HEAD",redirect:"manual",
   headers:{"accept":"text/html"}});
 const redirect=response.headers.get("location");
 if(redirect){
  const destination=new URL(redirect,request);
  if(destination.protocol!=="https:"||!APPROVED.has(destination.hostname)||
     destination.username||destination.password||destination.search||destination.hash){
   throw new Error("Unexpected invoice origin redirect; refusing to follow.");
  }
 }
 const cacheControl=response.headers.get("cache-control")||"";
 const referrerPolicy=response.headers.get("referrer-policy")||"";
 const robots=response.headers.get("x-robots-tag")||"";
 const noStore=/(?:^|,)\s*no-store(?:\s*,|$)/i.test(cacheControl);
 const noReferrer=referrerPolicy.split(",").some(x=>x.trim().toLowerCase()==="no-referrer");
 const noIndex=/\bnoindex\b/i.test(robots);
 return {
  inspected_url:TARGET,
  status:response.status,
  location:redirect||null,
  cache_control:cacheControl||null,
  referrer_policy:referrerPolicy||null,
  x_robots_tag:robots||null,
  hosting_hint:response.headers.get("x-github-request-id")?"github-pages":
    response.headers.get("cf-ray")?"cloudflare-edge":"unverified",
  checks:{
    http_success:response.ok,
    no_store_response_header:noStore,
    no_referrer_response_header:noReferrer,
    noindex_response_header:noIndex
  },
  important:"Only server response headers are tested. HTML meta referrer and robots tags are a separate fallback."
 };
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 auditPublicInvoiceHeaders().then(result=>{
  process.stdout.write(JSON.stringify(result,null,2)+"\n");
  const missing=Object.entries(result.checks).filter(([,v])=>!v).map(([k])=>k);
  if(missing.length){
   process.stderr.write("Invoice privacy HTTP-header review required: "+missing.join(", ")+"\n");
   // Report accurately without blocking an unrelated PR: the hosting configuration
   // is outside the isolated CI's ability to modify safely.
  }
 }).catch(error=>{
  process.stderr.write("Invoice header read-only probe failed: "+error.message+"\n");
  process.exitCode=1;
 });
}
