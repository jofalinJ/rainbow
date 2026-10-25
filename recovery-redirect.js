/* Handle recovery emails that fall back to the configured storefront Site URL. */
(() => {
  const fragment=new URLSearchParams(window.location.hash.slice(1));
  if(fragment.get("type")!=="recovery"&&fragment.get("error_code")!=="otp_expired")return;
  const destination=new URL("reset-password.html",window.location.href);
  destination.search="";
  destination.hash=window.location.hash;
  window.location.replace(destination.href);
})();
