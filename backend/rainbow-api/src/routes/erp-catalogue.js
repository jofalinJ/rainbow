import { json, methodNotAllowed } from "../http.js";

// Read-only public catalogue projection. Never accepts shop/user identifiers or credentials.
// Deliberately feature-gated: legacy checkout still uses its original stock source.
const ORIGINS=new Set(["https://rainbowgoldcovering.com","https://www.rainbowgoldcovering.com"]);
function reply(request,response) {
 const origin=request.headers.get("Origin");
 if(!origin||!ORIGINS.has(origin))return response;
 const headers=new Headers(response.headers);
 headers.set("Access-Control-Allow-Origin",origin);
 headers.set("Vary","Origin");
 headers.set("Access-Control-Allow-Methods","GET, HEAD, OPTIONS");
 headers.set("Access-Control-Allow-Headers","Content-Type");
 return new Response(response.body,{status:response.status,headers});
}
function parseNumber(value,defaultValue,max) {
 if(value===null)return defaultValue;
 if(!/^\d{1,6}$/.test(value))return null;
 const n=Number(value);
 return Number.isSafeInteger(n)&&n<=max?n:null;
}
export async function erpCatalogue(request,env={}) {
 const path=new URL(request.url);
 if(env.ERP_CATALOGUE_ENABLED!=="true")
   return reply(request,json({success:false,error:"ERP catalogue not enabled"},404));
 if(request.method==="OPTIONS")
   return reply(request,new Response(null,{status:204,headers:{"Cache-Control":"no-store"}}));
 if(request.method!=="GET"&&request.method!=="HEAD")
   return reply(request,methodNotAllowed("GET, HEAD, OPTIONS"));
 const page=parseNumber(path.searchParams.get("page"),0,10000);
 const limit=parseNumber(path.searchParams.get("limit"),24,48);
 const term=(path.searchParams.get("q")||"").trim();
 if(page===null||limit===null||limit<1||term.length>70)
   return reply(request,json({success:false,error:"Invalid catalogue query"},400));
 if(!env.SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)
   return reply(request,json({success:false,error:"Catalogue unavailable"},503));
 try {
  const response=await fetch(new URL("/rest/v1/rpc/erp_public_catalogue",env.SUPABASE_URL),{
   method:"POST",
   headers:{"apikey":env.SUPABASE_SERVICE_ROLE_KEY,
    "Authorization":"Bearer "+env.SUPABASE_SERVICE_ROLE_KEY,
    "Content-Type":"application/json","Cache-Control":"no-store"},
   body:JSON.stringify({p_page:page,p_limit:limit,p_search:term})
  });
  if(!response.ok)throw Error("Catalogue database failed with HTTP "+response.status);
  const data=await response.json();
  const extra={"Cache-Control":"public, max-age=15, s-maxage=30"};
  return reply(request,request.method==="HEAD"
   ?new Response(null,{status:200,headers:{"Content-Type":"application/json; charset=utf-8",...extra}})
   :json({success:true,...data},200,extra));
 }catch(error) {
  console.error("ERP catalogue read failed",error.message);
  return reply(request,json({success:false,error:"Catalogue temporarily unavailable"},503));
 }
}
