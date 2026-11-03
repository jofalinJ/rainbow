/**
 * Read-only merchant release inspection. It never creates an order, reserves
 * inventory, changes payment flags, or writes production database records.
 *
 * Command: node scripts/owner-readiness.mjs [--json]
 */
import {readFile} from "node:fs/promises";
import {fileURLToPath} from "node:url";

export const SITE="https://rainbowgoldcovering.com";
export const API="https://rainbow-api.jofalin2005.workers.dev";
const SUPABASE="https://ajnicsvtymvvkgepjmmk.supabase.co";
const REQUIRED_PAGES=[
  ["/", "Homepage"],
  ["/order.html", "Checkout"],
  ["/privacy-policy.html", "Privacy policy"],
  ["/shipping-policy.html", "Shipping policy"],
  ["/returns-and-refunds.html", "Refund policy"],
  ["/terms-and-conditions.html", "Terms"],
  ["/robots.txt", "Robots"],
  ["/sitemap.xml", "Sitemap"]
];

const responseText=async (fetcher,url,headers={})=>{
  const response=await fetcher(url,{method:"GET",headers,signal:AbortSignal.timeout(12000)});
  const finalUrl=new URL(response.url||url);
  if(finalUrl.origin!==new URL(url).origin)throw new Error("Unexpected cross-origin redirect");
  const body=await response.text();
  if(!response.ok)throw new Error("HTTP "+response.status);
  return body;
};

export function readPublicConfig(contents){
  const url=contents.match(/supabaseUrl:\s*"([^"]+)"/)?.[1];
  const key=contents.match(/supabasePublishableKey:\s*"([^"]+)"/)?.[1];
  if(url!==SUPABASE||!key?.startsWith("sb_publishable_"))throw new Error("Public Supabase config not valid");
  return {url,key};
}

export async function inspect({fetcher=fetch,publicConfig}={}){
  if(!publicConfig)throw new Error("Public config required (publishable key only)");
  if(publicConfig.url!==SUPABASE||!publicConfig.key?.startsWith("sb_publishable_"))
    throw new Error("Refusing unapproved database endpoint or private key");
  const checks=[];
  const record=(id,ok,detail,severity="blocker")=>{
    checks.push({id,ok,detail,severity});
  };
  for(const [path,label] of REQUIRED_PAGES){
    try{
      const body=await responseText(fetcher,SITE+path);
      const expected=path.endsWith(".xml")?"<urlset":path.endsWith(".txt")?"User-agent":"<html";
      record("page:"+path,body.toLowerCase().includes(expected.toLowerCase()),label+" served");
    }catch(e){record("page:"+path,false,label+": "+e.message);}
  }

  try{
    const body=JSON.parse(await responseText(fetcher,API+"/api/razorpay/config",{
      Origin:SITE,Accept:"application/json"
    }));
    const validMode=body.mode==="live"||body.mode==="test";
    const validKey=typeof body.keyId==="string"&&
      new RegExp("^rzp_"+body.mode+"_[A-Za-z0-9]+$").test(body.keyId);
    const noSecrets=!["keySecret","RAZORPAY_LIVE_KEY_SECRET","service_role"].some(k=>k in body);
    record("gateway:config",validMode&&body.enabled===true&&body.mode==="live"&&validKey&&noSecrets,
      body.enabled===true&&validMode&&noSecrets?"Gateway configured ("+body.mode+")":"Gateway disabled, invalid, or exposing sensitive data");
  }catch(e){record("gateway:config",false,"Gateway config: "+e.message);}

  try{
    const body=JSON.parse(await responseText(fetcher,API+"/api/razorpay/provider-check",{
      Origin:SITE,Accept:"application/json"
    }));
    record("gateway:provider",body.provider==="connected","Gateway provider connection: "+String(body.provider||"unknown"));
  }catch(e){record("gateway:provider",false,"Provider check: "+e.message);}

  const headers={apikey:publicConfig.key,Accept:"application/json"};
  const catalogue=[
    ["catalogue:products","products?select=id&active=eq.true&limit=1","Active catalogue product"],
    ["catalogue:variants","product_variants?select=id&active=eq.true&limit=1","Active product variant"]
  ];
  for(const [id,query,label] of catalogue){
    try{
      const body=JSON.parse(await responseText(fetcher,SUPABASE+"/rest/v1/"+query,headers));
      record(id,Array.isArray(body)&&body.length>0,label+" found in public database");
    }catch(e){record(id,false,label+": "+e.message);}
  }

  const blockers=checks.filter(c=>!c.ok&&c.severity==="blocker").map(c=>c.id);
  return {
    checkedAt:new Date().toISOString(),
    target:SITE,
    technicalReady:blockers.length===0,
    checks,
    blockers,
    manualGates:[
      "Accountant confirms jewellery HSN, GST rate and interstate IGST treatment",
      "Merchant checks actual stock allocation, images, pricing and product accuracy",
      "Use isolated tests to verify authenticated staff roles and cross-branch permissions",
      "Reconcile a controlled Razorpay payment, webhook, paid invoice and refund with the merchant dashboard",
      "Review Supabase security advisors, privileged RPC authorization and backup recovery",
      "Verify courier fulfilment, consent-based WhatsApp sending and customer support contact"
    ],
    note:"This is a read-only technical preflight, not approval to charge customers."
  };
}

export function report(result){
  const lines=["RAINBOW OWNER RELEASE PREFLIGHT",result.checkedAt,
    result.technicalReady?"Technical checks: PASS":"Technical checks: BLOCKED"];
  for(const c of result.checks)lines.push((c.ok?"PASS ":"FAIL ")+c.id+" - "+c.detail);
  lines.push("Manual sign-offs still required:");
  result.manualGates.forEach((gate,i)=>lines.push((i+1)+". "+gate));
  lines.push(result.note);
  return lines.join("\n");
}

async function main(){
  const root=new URL("../admin/config.js",import.meta.url);
  const config=readPublicConfig(await readFile(root,"utf8"));
  const result=await inspect({publicConfig:config});
  if(process.argv.includes("--json"))console.log(JSON.stringify(result,null,2));
  else console.log(report(result));
  if(!result.technicalReady)process.exitCode=1;
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===fileURLToPath(new URL("file://"+process.argv[1]))){
  main().catch(e=>{console.error("Preflight could not run: "+e.message);process.exitCode=1;});
}
