import {test} from "node:test";
import assert from "node:assert/strict";
import {inspect,readPublicConfig,report} from "../../scripts/owner-readiness.mjs";

const PUBLIC_KEY="sb_publishable_testing_only";
const CONFIG={url:"https://ajnicsvtymvvkgepjmmk.supabase.co",key:PUBLIC_KEY};
const result=(value,type="application/json")=>
  new Response(typeof value==="string"?value:JSON.stringify(value),{
    status:200,headers:{"content-type":type}
  });

function mock(overrides={}){
  const requests=[];
  const fetcher=async (url,options={})=>{
    assert.equal(options.method,"GET","readiness must never write");
    requests.push(url);
    const path=new URL(url).pathname;
    if(path==="/api/razorpay/config")
      return result(overrides.config??{mode:"live",enabled:true,keyId:"rzp_live_DummyPublic123"});
    if(path==="/api/razorpay/provider-check")
      return result(overrides.provider??{provider:"connected"});
    if(path==="/rest/v1/products")
      return result(overrides.products??[{id:"product"}]);
    if(path==="/rest/v1/product_variants")
      return result(overrides.variants??[{id:"variant"}]);
    if(path==="/sitemap.xml")
      return result('<?xml version="1.0"?><urlset></urlset>',"application/xml");
    if(path==="/robots.txt")return result("User-agent: *\nAllow: /","text/plain");
    if(path==="/order.html"&&overrides.checkoutDown)
      return new Response("Down",{status:503});
    return result("<!doctype html><html lang='en'></html>","text/html");
  };
  return {fetcher,requests};
}

test("release checks use only read-only GET requests and never send secrets",async()=>{
  const m=mock();
  const r=await inspect({fetcher:m.fetcher,publicConfig:CONFIG});
  assert.equal(r.technicalReady,true);
  assert.equal(r.blockers.length,0);
  assert.equal(r.checks.length,12);
  assert.equal(m.requests.length,12);
  assert.match(report(r),/Technical checks: PASS/);
  assert.ok(r.manualGates.some(x=>x.includes("Accountant")));
  assert.ok(!report(r).includes(PUBLIC_KEY));
});

test("empty live catalogue blocks a merchant launch",async()=>{
  const r=await inspect({fetcher:mock({products:[],variants:[]}).fetcher,publicConfig:CONFIG});
  assert.equal(r.technicalReady,false);
  assert.deepEqual(r.blockers,["catalogue:products","catalogue:variants"]);
});

test("unavailable checkout page is a release blocker",async()=>{
  const r=await inspect({fetcher:mock({checkoutDown:true}).fetcher,publicConfig:CONFIG});
  assert.ok(r.blockers.includes("page:/order.html"));
});

test("unverified or suspended provider is a release blocker",async()=>{
  const r=await inspect({fetcher:mock({config:{mode:"test",enabled:false,keyId:""}}).fetcher,publicConfig:CONFIG});
  assert.ok(r.blockers.includes("gateway:config"));
  const s=await inspect({fetcher:mock({provider:{provider:"disconnected"}}).fetcher,publicConfig:CONFIG});
  assert.ok(s.blockers.includes("gateway:provider"));
});

test("public payment configuration must never expose secrets",async()=>{
  const r=await inspect({fetcher:mock({config:{
    mode:"live",enabled:true,keyId:"rzp_live_DummyPublic123",keySecret:"unsafe"
  }}).fetcher,publicConfig:CONFIG});
  assert.ok(r.blockers.includes("gateway:config"));
  assert.doesNotMatch(JSON.stringify(r),/unsafe/);
});

test("rejects private credentials and unexpected database host before network access",async()=>{
  assert.throws(()=>readPublicConfig('supabaseUrl:"https://example.com",supabasePublishableKey:"sb_publishable_fake"'));
  assert.throws(()=>readPublicConfig('supabaseUrl:"https://ajnicsvtymvvkgepjmmk.supabase.co",supabasePublishableKey:"service_role_DO_NOT_USE"'));
  await assert.rejects(()=>inspect({publicConfig:{url:"https://example.com",key:PUBLIC_KEY}}));
});
