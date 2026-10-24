// Legacy direct-send endpoints are retired. Paid online invoices are dispatched
// only by the consent/template/allowlist-gated rainbow-api outbox. Do not restore
// a free-text or uploaded-PDF send path here, even if old Meta secrets still exist.
Deno.serve(async (req) => {
  const origin=req.headers.get("Origin");
  const allowed=new Set(["https://rainbowgoldcovering.com","https://www.rainbowgoldcovering.com","https://jofalinj.github.io"]);
  const headers=new Headers({"Content-Type":"application/json","Cache-Control":"no-store","X-Content-Type-Options":"nosniff","Vary":"Origin"});
  if(origin && allowed.has(origin)){
    headers.set("Access-Control-Allow-Origin",origin);
    headers.set("Access-Control-Allow-Headers","authorization,apikey,x-client-info,content-type");
    headers.set("Access-Control-Allow-Methods","POST,OPTIONS");
  }
  if(req.method==="OPTIONS")return new Response(null,{status:204,headers});
  if(req.method!=="POST")return new Response(JSON.stringify({error:"Method not allowed"}),{status:405,headers});
  return new Response(JSON.stringify({enabled:false,error:"Direct WhatsApp sending is disabled. Use the verified paid-invoice notification workflow when it is configured and consented."}),{status:503,headers});
});
