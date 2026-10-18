import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const html=readFileSync(new URL("../../index.html",import.meta.url),"utf8");
const styles=readFileSync(new URL("../../content.css",import.meta.url),"utf8");
const script=readFileSync(new URL("../../content.js",import.meta.url),"utf8");

describe("storefront without filter and sort controls",()=>{
  it("removes advanced filter and sort inputs from desktop and mobile",()=>{
    for(const id of ["shopFilters","catalogSort","catalogMinPrice","catalogMaxPrice",
      "catalogColor","catalogSize","catalogLength","catalogReset",
      "desktopFilterHost","drawerFilterSection","drawerFilterHost","drawerFilterResults"]){
      expect(html).not.toContain('id="'+id+'"');
    }
    expect(html).not.toContain("FILTER &amp; SORT");
  });

  it("shows a full-width catalogue with its browsing controls intact",()=>{
    const section=html.slice(html.indexOf('<section class="section live-products"'),
      html.indexOf('<section class="section gold-covering-explainer"'));
    expect(section).toContain('class="catalog-layout"');
    expect(section).toContain('class="catalog-main"');
    expect(section).not.toContain('class="catalog-filter-sidebar"');
    for(const id of ["productHeading","browseAllProducts","productStatus",
      "clearProductFilter","productGrid","cataloguePager","loadMoreProducts"]){
      expect(section).toContain('id="'+id+'"');
    }
    expect(styles).toContain('.catalog-main .product-grid');
  });

  it("keeps category browsing in the hamburger drawer without filters",()=>{
    const drawer=html.slice(html.indexOf('<aside id="shopDrawer"'),html.indexOf('</aside>')+8);
    expect(drawer).toContain('id="drawerCategories"');
    expect(drawer).toContain('data-segment="women"');
    expect(drawer).toContain('data-segment="men"');
    expect(drawer).not.toContain('drawer-filter-section');
    expect(html).not.toContain('id="mobileFiltersToggle"');
  });

  it("safely skips optional advanced filter event binding when no filter form exists",()=>{
    expect(script).toContain('const form=document.getElementById("shopFilters");if(!form)return;');
    expect(html).toContain('id="siteSearchForm"');
  });
});
