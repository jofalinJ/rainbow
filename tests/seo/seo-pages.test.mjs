import test from "node:test";
import assert from "node:assert/strict";
import { productPath, categoryPath, eligibleProducts, renderProduct, renderCategory } from "../../scripts/generate-seo-pages.mjs";

const category={id:"c1",name:"Jimmiki",active:true,show_in_storefront:true};
const product={
  id:"8b27d095-9924-4ed0-99c2-0dd6abc0be10",category_id:"c1",active:true,
  product_code:"RGC/E0001",product_name:"Jimmiki & Shine",description:"Classic <gold> style",
  selling_price:299,updated_at:"2026-10-24T07:00:00Z",
  product_images:[{public_url:"https://example.com/jimmiki.png",alt_text:"Jimmiki earring",is_primary:true}],
  product_variants:[{active:true,stock_quantity:3}]
};
test("stable product and category URLs",()=>{
  assert.equal(categoryPath(category),"/categories/jimmiki/");
  assert.match(productPath(product),/^\/products\/jimmiki-shine-[0-9a-f-]{36}\/$/);
});
test("only deliberately active, storefront-visible image-bearing catalogue items are indexable",()=>{
  const valid=eligibleProducts([product], [category]);
  assert.equal(valid.length,1);
  assert.equal(eligibleProducts([{...product,active:false}],[category]).length,0);
  assert.equal(eligibleProducts([product],[{...category,show_in_storefront:false}]).length,0);
  assert.equal(eligibleProducts([{...product,product_images:[]}],[category]).length,0);
  assert.equal(eligibleProducts([{...product,selling_price:null}],[category]).length,0);
});
test("product HTML has crawlable price, escaped description, canonical URL and real JSON-LD",()=>{
  const html=renderProduct(product,category);
  assert.match(html,/<h1>Jimmiki &amp; Shine<\/h1>/);
  assert.match(html,/Classic &lt;gold&gt; style/);
  assert.ok(!html.includes("Classic <gold> style"));
  assert.match(html,/https:\/\/rainbowgoldcovering\.com\/products\/jimmiki-shine-/);
  assert.match(html,/schema.org\/InStock/);
  assert.match(html,/₹299/);
  assert.match(html,/product\.html\?sku=RGC%2FE0001/);
  assert.match(html,/Jimmiki earring/);
});
test("category HTML renders product cards and pagination",()=>{
  const html=renderCategory(category,[product]);
  assert.match(html,/<h1>Jimmiki<\/h1>/);
  assert.match(html,/jimmiki-shine/);
  assert.match(html,/rel="canonical"/);
});
