/* Mobile-only view navigation; delegates to the existing storefront controllers.
   No cloned customer data, cart operations or authentication logic. */
(() => {
  function init() {
    const nav=document.querySelector(".mobile-shop-nav");
    if(!nav)return;
    const wishlist=document.getElementById("wishlistToggle");
    const account=document.getElementById("accountOpen");
    const home=nav.querySelector('[data-mobile-home]');
    const categories=nav.querySelector('[data-mobile-categories]');
    const saved=nav.querySelector('[data-mobile-wishlist]');
    const profile=nav.querySelector('[data-mobile-account]');
    const tabs=[home,categories,saved,profile].filter(Boolean);
    const setTab=tab => {
      for(const item of tabs){
        const current=item===tab;
        item.classList.toggle("is-current",current);
        if(current)item.setAttribute("aria-current","page");
        else item.removeAttribute("aria-current");
      }
    };
    const syncWishlist=()=>{
      const active=wishlist?.getAttribute("aria-pressed")==="true";
      if(active)setTab(saved);
      else if(saved?.classList.contains("is-current"))setTab(categories);
    };
    saved?.addEventListener("click",()=>{
      wishlist?.click();
      document.getElementById("products")?.scrollIntoView({
        block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"
      });
    });
    profile?.addEventListener("click",()=>account?.click());
    home?.addEventListener("click",()=>setTab(home));
    categories?.addEventListener("click",()=>setTab(categories));
    wishlist?.addEventListener("click",()=>queueMicrotask(syncWishlist));
    if(wishlist)new MutationObserver(syncWishlist).observe(wishlist,{attributes:true,attributeFilter:["aria-pressed"]});
    window.addEventListener("pageshow",syncWishlist);
    syncWishlist();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();