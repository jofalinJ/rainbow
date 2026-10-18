import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
const html=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
const styles=readFileSync(new URL("../../content.css",import.meta.url),"utf8");
const script=readFileSync(new URL("../../content.js",import.meta.url),"utf8");
describe("shop filters: desktop left / mobile existing hamburger",()=>{
  it("keeps exactly one set of catalogue filters and their controls",()=>{
    for(const id of ["shopFilters","catalogSort","catalogMinPrice","catalogMaxPrice",
      "catalogColor","catalogSize","catalogLength","catalogReset"]){
      expect(html.split('id="'+id+'"')).toHaveLength(2);
    }
  });
  it("places the product cards right of the filter sidebar in DOM",()=>{
    const section=html.slice(html.indexOf('<section class="section live-products"'),
      html.indexOf('<section class="section gold-covering-explainer"'));
    expect(section.indexOf('class="catalog-filter-sidebar"')).toBeLessThan(section.indexOf('class="catalog-main"'));
    expect(section).toContain('id="desktopFilterHost"');
    expect(section).toContain('id="productGrid"');
  });
  it("adds a mobile filter container to the original navigation hamburger drawer",()=>{
    const drawer=html.slice(html.indexOf('<aside id="shopDrawer"'),html.indexOf('</aside>')+8);
    expect(drawer).toContain('id="drawerFilterHost"');
    expect(drawer).toContain('id="drawerFilterResults"');
    expect(html).not.toContain('id="mobileFiltersToggle"');
  });
  it("moves the existing form at the mobile media breakpoint rather than cloning fields",()=>{
    expect(script).toContain('window.matchMedia?.("(max-width: 800px)")');
    expect(script).toContain('if(form.parentElement!==target)target.appendChild(form)');
    expect(script).toContain('breakpoint.addEventListener("change",placeFilters)');
    expect(script).toContain('document.getElementById("drawerFilterResults")?.addEventListener("click"');
    expect(styles).toContain('.catalog-layout.catalog-layout--filters-left');
    expect(styles).toContain('.shop-drawer .shop-filters');
    expect(styles).toContain('.drawer-filter-section{display:block');
  });
});
