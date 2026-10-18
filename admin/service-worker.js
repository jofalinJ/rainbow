/* Never cache account responses, customer data, invoices, orders, API calls or payments. */
const CACHE="rainbow-staff-offline-notice-v1";
const OFFLINE=new URL("./offline.html",self.registration.scope).href;
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE).then(cache=>cache.add(OFFLINE)).then(()=>self.skipWaiting()));
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith("rainbow-staff-offline-notice-")&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});
self.addEventListener("fetch",event=>{
 if(event.request.mode!=="navigate"||new URL(event.request.url).origin!==self.location.origin)return;
 event.respondWith(fetch(event.request,{cache:"no-store"}).catch(()=>caches.match(OFFLINE)));
});
