/* Cache ONLY non-sensitive draft UI resources. Never cache API/data. */
const CACHE="rainbow-offline-draft-shell-20261017-a";
const STATIC=["offline-drafts.html","offline-drafts.js"];
self.addEventListener("install",event=>{
 event.waitUntil(caches.open(CACHE).then(c=>c.addAll(STATIC)));
});
self.addEventListener("activate",event=>{
 event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith("rainbow-offline-draft-shell-")&&k!==CACHE).map(k=>caches.delete(k)))));
});
self.addEventListener("fetch",event=>{
 const url=new URL(event.request.url);
 if(event.request.method!=="GET"||url.origin!==self.location.origin||
  !/\/(offline-drafts\.html|offline-drafts\.js)$/.test(url.pathname))return;
 event.respondWith(caches.match(event.request,{ignoreSearch:true})
  .then(hit=>hit||fetch(event.request)));
});
