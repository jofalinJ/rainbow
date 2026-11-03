import {describe,it,expect} from "vitest";
import {readFileSync} from "node:fs";

const read=path=>readFileSync(new URL("../../"+path,import.meta.url),"utf8");
const navigablePages=[
  "404.html",
  "admin/attendance.html",
  "admin/billing.html",
  "admin/bills.html",
  "admin/customers.html",
  "admin/index.html",
  "admin/inventory.html",
  "admin/login.html",
  "admin/my-attendance.html",
  "admin/offline.html",
  "admin/orders.html",
  "admin/products.html",
  "admin/reports.html",
  "admin/settings.html",
  "admin/staff.html",
  "index.html",
  "invoice.html",
  "order.html",
  "privacy-policy.html",
  "product.html",
  "reset-password.html",
  "returns-and-refunds.html",
  "shipping-policy.html",
  "sitemap.html",
  "terms-and-conditions.html"
];

describe("sitewide keyboard navigation",()=>{
  for(const page of navigablePages){
    it(`${page} exposes a keyboard-reachable main landmark`,()=>{
      const html=read(page);
      expect(html).toMatch(/<html\b[^>]*\blang="en"/i);
      expect(html).toMatch(/<meta\b[^>]*name="viewport"/i);
      const link=html.match(/<a\b[^>]*class="skip-link"[^>]*>/i);
      expect(link).not.toBeNull();
      const destination=link?.[0].match(/\bhref="#([^"]+)"/i)?.[1];
      expect(destination).toBeTruthy();
      const landmark=page==="admin/login.html"
        ? html.match(/<div\b[^>]*\brole="main"[^>]*>/i)
        : html.match(/<main\b[^>]*>/i);
      expect(landmark).not.toBeNull();
      expect(landmark?.[0]).toContain(`id="${destination}"`);
      expect(landmark?.[0]).toContain('tabindex="-1"');
      expect(html.indexOf(link?.[0])).toBeLessThan(html.indexOf(landmark?.[0]));
    });
  }

  it("preserves an accessible login without changing its form behavior",()=>{
    const html=read("admin/login.html");
    expect(html).toContain('aria-label="Username or email"');
    expect(html).toContain('autocomplete="username"');
    expect(html).toContain('aria-label="Password"');
    expect(html).toContain('autocomplete="current-password"');
    expect(html).toContain('id="msg" role="status" aria-live="polite"');
  });

  it("makes skip links visible on keyboard focus but invisible on printed invoices",()=>{
    const css=read("design-system.css");
    expect(css).toContain(".skip-link:focus-visible");
    expect(css).toMatch(/@media print\s*\{\s*\.skip-link\s*\{\s*display:\s*none\s*!important/);
    expect(read("invoice.html")).toContain('class="skip-link"');
  });

  it("keeps the staff redirect from becoming a second dashboard",()=>{
    const html=read("staff/index.html");
    expect(html).not.toContain('id="mainContent"');
  });
});
