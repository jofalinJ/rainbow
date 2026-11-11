/* Only cache the public, standalone offline POS shell. Never cache auth responses,
 * customer records, invoices, orders, payments, stock APIs or Supabase requests. */
const CACHE="rainbow-staff-offline-pos-v2";
const ROOT=new URL("./",self.registration.scope);
const OFFLINE=new URL("offline.html",ROOT).href;
const CASH=new URL("offline-pos.html",ROOT).href;
const FILES=["offline.html","offline-pos.html","offline-pos.mjs","offline-pos-core.mjs",
 "offline-pos-sync.mjs","config.js","../assets/brand/rainbow-logo.png"]
 .map(path=>new URL(path,ROOT).href);
const SAFE=new Set(FILES);
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(
  keys.filter(key=>key.startsWith("rainbow-staff-offline-")&&key!==CACHE)
   .map(key=>caches.delete(key))
 )).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
 const request=event.request;
 if(request.method!=="GET")return;
 const url=new URL(request.url);
 if(url.origin!==self.location.origin)return; // Never cache third-party/CDN content.
 if(request.mode==="navigate"){
  event.respondWith(fetch(request,{cache:"no-store"}).catch(async()=>{
   const cache=await caches.open(CACHE);
   if(url.pathname.endsWith("/admin/billing.html")||url.pathname.endsWith("/admin/offline-pos.html"))
    return (await cache.match(CASH))||Response.error();
   return (await cache.match(OFFLINE))||Response.error();
  }));
  return;
 }
 // Only cache vetted static offline POS dependencies. No account or REST APIs.
 // Remove version query strings when checking the explicit asset allowlist.
 const assetUrl=new URL(url.href);assetUrl.search="";
 if(SAFE.has(assetUrl.href)){
  event.respondWith(caches.open(CACHE).then(async cache=>
   (await cache.match(assetUrl.href))||fetch(request)));
 }
});
