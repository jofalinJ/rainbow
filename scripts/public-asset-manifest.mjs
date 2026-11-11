/** The only files and directories shipped to Cloudflare Pages. Keep the
 * developer preview server on the same allowlist as production. */
export const publicRootFiles=[
  "index.html","order.html","product.html","invoice.html","404.html",
  "reset-password.html","account-recovery.js","recovery-redirect.js","supabase-client.js",
  "privacy-policy.html","returns-and-refunds.html",
  "shipping-policy.html","terms-and-conditions.html",
  "sitemap.html","sitemap.xml","robots.txt",
  "analytics.js","bill-pdf.js","business-live.js","config.js",
  "content.css","content.js","mobile-storefront.css","mobile-storefront.js","design-system.css","premium-storefront.css","invoice-template.css","invoice-template.js",
  "invoice.js","order-pricing.mjs","pin-lookup.mjs","order.css","order.js",
  "payment-config.js","order-razorpay.mjs",
  "product-page.css","product-page.js","shop-catalogue.js"
  
];
export const publicDirectories=["admin","staff","assets","src/domain","categories","products"];

const PUBLIC_ROOT=new Set(publicRootFiles);


/**
 * Limit local HTTP previews to exactly the same static tree as Pages.
 * Never expose the repository's backend, migrations, tests, source maps,
 * git metadata, node_modules or hidden files through a preview origin.
 */
export function isPublicAssetPath(relative){
  if(typeof relative!=="string"||!relative||relative.includes("\\")||
     relative.includes("\0")||relative.startsWith("/"))return false;
  const parts=relative.split("/");
  if(parts.some(part=>!part||part==="."||part===".."||part.startsWith(".")))return false;
  if(parts.length===1)return PUBLIC_ROOT.has(relative);
  // Generated SEO folders only ever expose crawlable HTML documents, not arbitrary files.
  if(parts[0]==="categories"||parts[0]==="products")
    return parts.at(-1)==="index.html"&&parts.slice(1,-1).every(part=>/^[a-z0-9-]+$/.test(part));
  return publicDirectories.some(directory=>relative.startsWith(directory+"/"));
}
