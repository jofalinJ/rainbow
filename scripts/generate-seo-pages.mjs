/**
 * Generate crawlable HTML from the same public product catalogue used by the shop.
 * No service-role key: only records permitted by Supabase's public RLS are queried.
 * Run after product publications (scheduled GitHub Action or manually).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = "https://rainbowgoldcovering.com";
const MARKER = "<!-- AUTO-GENERATED SEO PAGE: do not edit manually -->";
const MANIFEST = "scripts/seo-manifest.json";
const PAGE_SIZE = 24;
const LIMIT = 500;
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g, char => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
})[char]);
const slugify = value => String(value || "").normalize("NFKD").toLowerCase()
  .replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-")
  .replace(/^-|-$/g, "") || "jewellery";
const safeImage = value => {
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password ? url.href : ""; }
  catch { return ""; }
};
const validPrice = value => value !== null && value !== "" && Number.isFinite(Number(value))
  && Number(value) >= 0;
const lastmod = value => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : "";
};
export function productPath(product) {
  if (!/^[0-9a-f-]{36}$/i.test(String(product.id || ""))) throw Error("Invalid product ID");
  return "/products/" + slugify(product.product_name) + "-" + product.id.toLowerCase() + "/";
}
export function categoryPath(category) {
  return "/categories/" + slugify(category.name) + "/";
}
export function eligibleProducts(products, categories) {
  const visible = new Set(categories.filter(c => c.active === true && c.show_in_storefront === true)
    .map(c => c.id));
  return products.filter(p => p.active === true && visible.has(p.category_id)
    && /^[0-9a-f-]{36}$/i.test(String(p.id || ""))
    && String(p.product_name || "").trim() && String(p.product_code || "").trim()
    && validPrice(p.selling_price)
    && (p.product_images || []).some(image => safeImage(image.public_url)));
}
const htmlDocument = (title, description, canonical, body, jsonLd = null) => {
  const structured = jsonLd ? '<script type="application/ld+json">' +
    JSON.stringify(jsonLd).replace(/</g, "\\u003c") + "</script>" : "";
  return [MARKER, "<!doctype html>", '<html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="theme-color" content="#8f1520">',
    "<title>" + escapeHtml(title) + "</title>",
    '<meta name="description" content="' + escapeHtml(description) + '">',
    '<link rel="canonical" href="' + escapeHtml(canonical) + '">',
    '<meta property="og:type" content="website">',
    '<meta property="og:title" content="' + escapeHtml(title) + '">',
    '<meta property="og:description" content="' + escapeHtml(description) + '">',
    '<meta property="og:url" content="' + escapeHtml(canonical) + '">',
    '<link rel="icon" href="/assets/brand/rainbow-logo.png">',
    '<style>body{margin:0;background:#fffdf9;color:#312526;font:16px/1.6 system-ui,-apple-system,sans-serif}a{color:#881823}header{background:#841a24;color:white;padding:1rem max(1rem,calc((100% - 1100px)/2))}header a{color:white;text-decoration:none;font-weight:700}.wrap{max-width:1100px;margin:auto;padding:2rem 1rem}h1{line-height:1.2;color:#65141c}.crumb{font-size:.9rem}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:1rem}.card{border:1px solid #e7d9d3;border-radius:12px;padding:1rem;min-width:0}.card img{width:100%;height:220px;object-fit:contain}.price{font-weight:750;font-size:1.25rem}.btn{display:inline-block;background:#841a24;color:white;padding:.7rem 1.15rem;border-radius:7px;text-decoration:none}.product{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:2rem}.product img{max-width:100%;max-height:520px;object-fit:contain}.pages{display:flex;gap:1rem;flex-wrap:wrap;margin-top:2rem}footer{border-top:1px solid #eee;padding:2rem 1rem;text-align:center}@media(max-width:690px){.product{grid-template-columns:1fr}}</style>',
    structured, "</head><body>", '<header><a href="/">RAINBOW GOLD COVERING</a></header>',
    '<main class="wrap">', body, "</main>",
    '<footer><a href="/">Rainbow Gold Covering</a> · <a href="/shipping-policy.html">Shipping</a> · <a href="/privacy-policy.html">Privacy</a></footer>',
    "</body></html>\n"].join("\n");
};
const card = product => {
  const photo = [...(product.product_images || [])].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary)
    || Number(a.sort_order || 0) - Number(b.sort_order || 0)).find(image => safeImage(image.public_url));
  return '<article class="card"><a href="' + escapeHtml(productPath(product)) + '">' +
    '<img loading="lazy" width="240" height="240" alt="' +
    escapeHtml(photo.alt_text || product.product_name) + '" src="' + escapeHtml(safeImage(photo.public_url)) + '">' +
    '<h2>' + escapeHtml(product.product_name) + "</h2></a>" +
    '<p class="price">₹' + Number(product.selling_price).toLocaleString("en-IN") + "</p></article>";
};
export function renderProduct(product, category) {
  const canonical = ORIGIN + productPath(product);
  const photos = (product.product_images || []).filter(photo => safeImage(photo.public_url));
  const mainPhoto = [...photos].sort((a, b) => Number(!!b.is_primary) - Number(!!a.is_primary))[0];
  const description = String(product.description || "").trim() ||
    "View the design, price and available options for " + product.product_name + " at Rainbow Gold Covering.";
  const inStock = (product.product_variants || []).some(v => v.active === true && Number(v.stock_quantity) > 0);
  const html = '<nav class="crumb"><a href="/">Home</a> / <a href="' + escapeHtml(categoryPath(category)) +
    '">' + escapeHtml(category.name) + "</a></nav>" +
    '<div class="product"><div><img src="' + escapeHtml(safeImage(mainPhoto.public_url)) +
    '" alt="' + escapeHtml(mainPhoto.alt_text || product.product_name) +
    '" width="600" height="600"></div><div><h1>' + escapeHtml(product.product_name) +
    '</h1><p>Product code: ' + escapeHtml(product.product_code) +
    '</p><p class="price">₹' + Number(product.selling_price).toLocaleString("en-IN") +
    '</p><p>' + escapeHtml(description) + '</p><p>' + (inStock ? "Available to order" : "Currently out of stock") +
    '</p><p><a class="btn" href="/product.html?sku=' + encodeURIComponent(product.product_code) +
    '">Check live options and add to bag →</a></p><p>Final stock and price are confirmed on the live product page.</p></div></div>';
  const jsonLd = {
    "@context": "https://schema.org", "@type": "Product", name: product.product_name,
    sku: product.product_code, description, image: photos.map(p => safeImage(p.public_url)),
    brand: { "@type": "Brand", name: "Rainbow Gold Covering" },
    offers: { "@type": "Offer", url: canonical, price: Number(product.selling_price).toFixed(2),
      priceCurrency: "INR", availability: inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock" }
  };
  return htmlDocument(product.product_name + " | Rainbow Gold Covering",
    description.slice(0, 155), canonical, html, jsonLd);
}
export function renderCategory(category, products, page = 1) {
  const totalPages = Math.ceil(products.length / PAGE_SIZE);
  const base = categoryPath(category);
  const url = page === 1 ? base : base + "page/" + page + "/";
  const list = products.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const description = "Explore " + category.name + " jewellery at Rainbow Gold Covering. View real product images and prices.";
  const pages = Array.from({ length: totalPages }, (_, n) => {
    const number = n + 1;
    return '<a href="' + escapeHtml(number === 1 ? base : base + "page/" + number + "/") +
      '"' + (page === number ? ' aria-current="page"' : "") + ">" + number + "</a>";
  }).join(" · ");
  const html = '<nav class="crumb"><a href="/">Home</a> / <a href="/categories/">Jewellery categories</a></nav>' +
    "<h1>" + escapeHtml(category.name) + "</h1><p>" + escapeHtml(description) +
    '</p><section class="grid" aria-label="Jewellery designs">' + list.map(card).join("\n") +
    '</section><nav class="pages" aria-label="Category pages">' + pages + "</nav>";
  return htmlDocument(category.name + " Jewellery | Rainbow Gold Covering" +
    (page > 1 ? " — Page " + page : ""), description, ORIGIN + url, html,
    { "@context": "https://schema.org", "@type": "CollectionPage",
      name: category.name + " Jewellery", url: ORIGIN + url });
}
function renderCategoryIndex(categories) {
  const html = '<nav class="crumb"><a href="/">Home</a> / Categories</nav><h1>Browse jewellery by category</h1>' +
    '<p>Explore Rainbow Gold Covering designs by jewellery type.</p><ul>' +
    categories.map(category => '<li><a href="' + escapeHtml(categoryPath(category)) + '">' +
      escapeHtml(category.name) + '</a></li>').join("") + "</ul>";
  return htmlDocument("Jewellery Categories | Rainbow Gold Covering",
    "Browse chains, earrings, bangles and other available jewellery designs at Rainbow Gold Covering.",
    ORIGIN + "/categories/", html);
}
async function publicCatalogue() {
  const config = await fs.readFile(path.join(ROOT, "admin/config.js"), "utf8");
  const setting = key => {
    const match = config.match(new RegExp("\\b" + key + "\\s*:\\s*[\"']([^\"']+)[\"']"));
    return match?.[1] || "";
  };
  const apiUrl = process.env.SUPABASE_URL || setting("supabaseUrl");
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || setting("supabasePublishableKey");
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(apiUrl) || !key)
    throw Error("Missing valid public Supabase configuration");
  async function allRows(table, select, filters, order) {
    const results = [];
    for (let offset = 0; offset < 50000; offset += LIMIT) {
      const url = new URL("/rest/v1/" + table, apiUrl);
      const params = { select, ...filters, order, limit: LIMIT, offset };
      for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
      const response = await fetch(url, { headers: { apikey: key, accept: "application/json" },
        signal: AbortSignal.timeout(30000) });
      if (!response.ok) throw Error(table + " public REST fetch failed: HTTP " + response.status);
      const rows = await response.json();
      if (!Array.isArray(rows)) throw Error("Unexpected " + table + " response");
      results.push(...rows);
      if (rows.length < LIMIT) return results;
    }
    throw Error("Catalogue exceeded safety limit; raise page cap after review");
  }
  const categories = await allRows("categories", "id,name,active,show_in_storefront,storefront_order",
    { active: "eq.true", show_in_storefront: "eq.true" }, "storefront_order.asc.nullslast,name.asc");
  const products = await allRows("products",
    "id,category_id,product_code,product_name,description,selling_price,active,updated_at,product_images(public_url,alt_text,is_primary,sort_order),product_variants(active,stock_quantity)",
    { active: "eq.true" }, "created_at.asc,id.asc");
  return { categories, products };
}
function sitemapXml(entries) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
    entries.map(entry => "  <url><loc>" + escapeHtml(ORIGIN + entry.path) + "</loc>" +
      (entry.lastmod ? "<lastmod>" + escapeHtml(entry.lastmod) + "</lastmod>" : "") +
      "</url>").join("\n") + "\n</urlset>\n";
}
async function writePage(relative, content) {
  const file = path.join(ROOT, relative);
  await fs.mkdir(path.dirname(file), { recursive: true });
  try {
    const previous = await fs.readFile(file, "utf8");
    if (!previous.includes(MARKER)) throw Error("Refusing to replace manually owned page: " + relative);
    if (previous === content) return;
  } catch (error) { if (error.code !== "ENOENT") throw error; }
  await fs.writeFile(file, content);
}
export async function generateSeo(catalogue) {
  const items = eligibleProducts(catalogue.products, catalogue.categories);
  const categoriesById = new Map(catalogue.categories.map(c => [c.id, c]));
  const categories = catalogue.categories.filter(c => items.some(p => p.category_id === c.id));
  const slugs = new Set();
  for (const c of categories) {
    const slug = slugify(c.name);
    if (slugs.has(slug)) throw Error("Category slug collision: " + slug);
    slugs.add(slug);
  }
  const generated = [];
  const urls = [
    { path: "/" }, { path: "/privacy-policy.html" }, { path: "/sitemap.html" }
  ];
  const add = async (relative, html, lastModified = "") => {
    await writePage(relative, html);
    generated.push(relative);
    urls.push({ path: "/" + relative.replace(/index\.html$/, ""), lastmod: lastModified });
  };
  await add("categories/index.html", renderCategoryIndex(categories));
  for (const c of categories) {
    const products = items.filter(p => p.category_id === c.id)
      .sort((a, b) => String(a.product_name).localeCompare(String(b.product_name)));
    const total = Math.ceil(products.length / PAGE_SIZE);
    for (let n = 1; n <= total; n++) {
      const relative = categoryPath(c).slice(1) + (n === 1 ? "" : "page/" + n + "/") + "index.html";
      await add(relative, renderCategory(c, products, n));
    }
  }
  for (const p of items) {
    const relative = productPath(p).slice(1) + "index.html";
    await add(relative, renderProduct(p, categoriesById.get(p.category_id)), lastmod(p.updated_at));
  }
  let oldManifest = [];
  try { oldManifest = JSON.parse(await fs.readFile(path.join(ROOT, MANIFEST), "utf8")); }
  catch (error) { if (error.code !== "ENOENT") throw error; }
  if (!Array.isArray(oldManifest)) throw Error("Invalid SEO manifest");
  for (const stale of oldManifest.filter(filename => !generated.includes(filename))) {
    if (!/^(categories|products)\/(?:[a-z0-9/-]+\/)?index\.html$/.test(stale))
      throw Error("Unsafe generated page path: " + stale);
    const full = path.join(ROOT, stale);
    const existing = await fs.readFile(full, "utf8").catch(error => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
    if (existing && !existing.includes(MARKER)) throw Error("Refusing to remove non-generated page: " + stale);
    await fs.rm(full, { force: true });
  }
  await fs.writeFile(path.join(ROOT, MANIFEST), JSON.stringify(generated.sort(), null, 2) + "\n");
  await fs.writeFile(path.join(ROOT, "sitemap.xml"), sitemapXml(urls));
  return { categories: categories.length, products: items.length, generated: generated.length };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  generateSeo(await publicCatalogue()).then(result => console.log("Generated SEO catalogue:", result))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
