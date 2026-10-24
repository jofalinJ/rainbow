import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";

// Read-only checks against the one approved Worker and storefront. Never create
// a checkout, charge a payment, or dispatch a message from deployment checks.
const worker="https://rainbow-api.jofalin2005.workers.dev";
const site="https://rainbowgoldcovering.com";
const source=await readFile(new URL("../backend/rainbow-api/src/routes/razorpay.js",import.meta.url),"utf8");
const expected=source.match(/release:\s*["']([^"']+)["']/)?.[1];
assert.ok(expected,"Source must declare a public payment release marker");
const headers={Origin:site,Accept:"application/json"};

for(const suffix of ["",`?deployment_check=${Date.now()}`]){
  const response=await fetch(`${worker}/api/razorpay/config${suffix}`,{headers,cache:"no-store"});
  const config=await response.json();
  assert.equal(response.status,200);
  assert.equal(config.release,expected,"Live Worker differs from checked-out source");
  assert.equal(config.mode,"test");
  assert.equal(config.enabled,true,"TEST checkout is unavailable");
  assert.match(config.keyId,/^rzp_test_[A-Za-z0-9]+$/);
  assert.equal(response.headers.get("access-control-allow-origin"),site);
  assert.equal(response.headers.get("cache-control"),"no-store");
  console.log(JSON.stringify({check:"payment-config",status:response.status,release:config.release,mode:config.mode,enabled:config.enabled}));
}

const providerResponse=await fetch(`${worker}/api/razorpay/provider-check`,{headers,cache:"no-store"});
const provider=await providerResponse.json();
assert.equal(providerResponse.status,200,"TEST provider credential check failed");
assert.equal(provider.provider,"connected","TEST provider is not ready");
console.log(JSON.stringify({check:"provider",status:providerResponse.status,ready:provider.provider==="connected"}));

const forbidden=await fetch(`${worker}/api/razorpay/config`,{headers:{Origin:"https://untrusted.invalid"}});
assert.equal(forbidden.headers.get("access-control-allow-origin"),null,"Unapproved browser Origin received CORS access");

// Invalid input is rejected before any database or provider mutation. These
// probes distinguish the hardened Worker from older code sharing the v4 marker.
for(const path of ["manual-upi","track","status"]){
  const response=await fetch(`${worker}/api/razorpay/${path}`,{method:"POST",headers:{...headers,"Content-Type":"application/json"},body:"{}"});
  assert.equal(response.status,400,`Hardened route is missing or unavailable: ${path}`);
  console.log(JSON.stringify({check:"reject-invalid-input",path,status:response.status}));
}

for(const path of ["content.js","order.html","order.js","order.css","order-razorpay.mjs","invoice.html","invoice.js","admin/orders.html","admin/orders.js","admin/payment-review.mjs"]){
  const local=await readFile(new URL(`../${path}`,import.meta.url),"utf8");
  const response=await fetch(`${site}/${path}?deployment_check=${Date.now()}`,{cache:"no-store"});
  assert.equal(response.status,200,`Missing published asset: ${path}`);
  assert.equal(await response.text(),local,`Published asset differs from source: ${path}`);
  console.log(JSON.stringify({check:"asset",path,status:response.status,matchesSource:true}));
}
console.log("Deployment matches source; all checks were read-only.");
