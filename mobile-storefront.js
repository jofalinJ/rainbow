/* Rainbow Gold Covering: mobile navigation and UI feedback.
   Reuses the existing catalogue, auth, wishlist and cart controllers. */
(() => {
  function init(){
    const nav=document.querySelector(".mobile-shop-nav");
    if(!nav)return;
    const wishlist=document.getElementById("wishlistToggle");
    const account=document.getElementById("accountOpen");
    const accountOverlay=document.getElementById("accountOverlay");
    const home=nav.querySelector("[data-mobile-home]");
    const categories=nav.querySelector("[data-mobile-categories]");
    const saved=nav.querySelector("[data-mobile-wishlist]");
    const profile=nav.querySelector("[data-mobile-account]");
    const tabs=[home,categories,saved,profile].filter(Boolean);
    let previousTab=home;
    const setTab=tab=>{
      for(const item of tabs){
        const current=item===tab;
        item.classList.toggle("is-current",current);
        if(current)item.setAttribute("aria-current","page");
        else item.removeAttribute("aria-current");
      }
    };
    const activeTab=()=>tabs.find(item=>item.classList.contains("is-current"))||home;
    const wishlistActive=()=>wishlist?.getAttribute("aria-pressed")==="true";
    const syncWishlist=()=>{
      if(wishlistActive())setTab(saved);
      else if(activeTab()===saved)setTab(categories);
    };
    saved?.addEventListener("click",()=>{
      wishlist?.click();
      document.getElementById("products")?.scrollIntoView({
        block:"start",behavior:window.matchMedia("(prefers-reduced-motion: reduce)").matches?"auto":"smooth"
      });
    });
    profile?.addEventListener("click",()=>{
      previousTab=activeTab();
      setTab(profile);
      account?.click();
    });
    const exitSaved=()=>{if(wishlistActive())wishlist?.click();};
    home?.addEventListener("click",()=>{exitSaved();setTab(home);});
    categories?.addEventListener("click",()=>{exitSaved();setTab(categories);});
    document.getElementById("mobileCategoryTrack")?.addEventListener("click",event=>{
      if(event.target.closest("[data-mobile-category]"))setTab(categories);
    });
    // Choosing a category from the hamburger uses the same Explore active tab.
    document.getElementById("shopDrawer")?.addEventListener("click",event=>{
      if(event.target.closest("[data-filter-type]"))setTab(categories);
    });
    wishlist?.addEventListener("click",()=>queueMicrotask(syncWishlist));
    if(wishlist)new MutationObserver(syncWishlist).observe(wishlist,{attributes:true,attributeFilter:["aria-pressed"]});
    if(accountOverlay){
      new MutationObserver(()=>{
        if(accountOverlay.hidden||accountOverlay.getAttribute("aria-hidden")==="true"){
          if(activeTab()===profile)setTab(wishlistActive()?saved:previousTab);
        }
      }).observe(accountOverlay,{attributes:true,attributeFilter:["hidden","aria-hidden"]});
    }

    // A badge echoes the genuine cart count; it never maintains separate cart state.
    const cartCount=document.getElementById("cartCount");
    const bagBadge=document.getElementById("mobileBagCount");
    const bagLink=nav.querySelector('a[href="order.html"]');
    const syncBag=()=>{
      if(!bagBadge||!cartCount)return;
      const count=Math.max(0,Number.parseInt(cartCount.textContent||"0",10)||0);
      bagBadge.hidden=count===0;
      bagBadge.textContent=count>99?"99+":String(count);
      if(bagLink)bagLink.setAttribute("aria-label",count===0?"View shopping bag":`View shopping bag, ${count} ${count===1?"item":"items"}`);
    };
    if(cartCount)new MutationObserver(syncBag).observe(cartCount,{childList:true,characterData:true,subtree:true});
    syncBag();

    // A short mobile hint fits alongside existing voice, photo and search controls.
    // The desktop placeholder is retained at all larger widths.
    const searchField=document.getElementById("siteSearch");
    const originalPlaceholder=searchField?.getAttribute("placeholder")||"Search designs and categories";
    const narrowScreen=window.matchMedia("(max-width:767px)");
    const syncSearchLabel=()=>{
      if(searchField)searchField.placeholder=narrowScreen.matches?"Search jewellery":originalPlaceholder;
    };
    syncSearchLabel();
    narrowScreen.addEventListener?.("change",syncSearchLabel);

    // Keep the bottom navigation away from focused form fields/mobile keyboards.
    const editable=element=>element?.matches?.("input,textarea,select,[contenteditable='true']");
    document.addEventListener("focusin",event=>{
      if(editable(event.target))document.body.classList.add("mobile-editing");
    });
    document.addEventListener("focusout",()=>{
      requestAnimationFrame(()=>{
        if(!editable(document.activeElement))document.body.classList.remove("mobile-editing");
      });
    });

    // Non-blocking feedback for genuine wishlist and cart operations.
    const toast=document.getElementById("mobileShopToast");
    let hideToastTimer=null;
    document.addEventListener("rainbow:mobile-toast",event=>{
      if(!toast||!window.matchMedia("(max-width:767px)").matches)return;
      const message=String(event.detail?.message||"").trim();
      if(!message)return;
      toast.textContent=message;
      toast.hidden=false;
      if(hideToastTimer!==null)clearTimeout(hideToastTimer);
      hideToastTimer=setTimeout(()=>{toast.hidden=true;hideToastTimer=null;},2300);
    });
    window.addEventListener("pagehide",()=>{if(hideToastTimer!==null)clearTimeout(hideToastTimer);},{once:true});
    window.addEventListener("pageshow",()=>{syncWishlist();syncBag();});
    syncWishlist();
  }
  if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});
  else init();
})();