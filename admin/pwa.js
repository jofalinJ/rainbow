/* Android staff installability; does not grant access or cache business data. */
(function(){
 if(!("serviceWorker" in navigator)||!window.isSecureContext)return;
 window.addEventListener("load",()=>{
   navigator.serviceWorker.register("./service-worker.js",{scope:"./"})
     .catch(error=>console.warn("Staff app offline notice unavailable.",error));
 },{once:true});
})();
