/* Installs the encrypted offline cash POS shell. Business data stays in the locally encrypted vault; auth APIs are never cached. */
(function(){
 if(!("serviceWorker" in navigator)||!window.isSecureContext)return;
 window.addEventListener("load",()=>{
   navigator.serviceWorker.register("./service-worker.js",{scope:"./"})
     .catch(error=>console.warn("Staff offline billing shell unavailable.",error));
 },{once:true});
})();
