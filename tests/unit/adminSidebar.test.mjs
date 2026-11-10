import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import path from "node:path";

const source = readFileSync(path.resolve("admin/app.js"), "utf8");

class Element {
  constructor(tagName) {
    this.tagName = tagName;
    this.children = [];
    this.className = "";
    this.textContent = "";
    this.attributes = new Map();
    this.style = {};
    this.classList = { add: () => {} };
  }
  append(...nodes) { this.children.push(...nodes); }
  prepend(...nodes) { this.children.unshift(...nodes); }
  replaceChildren(...nodes) { this.children = nodes; }
  setAttribute(key, value) { this.attributes.set(key, value); }
  getAttribute(key) { return this.attributes.get(key) ?? null; }
  addEventListener() {}
  querySelector(selector) {
    if (selector === "nav") return this.children.find(x => x.tagName === "nav") ?? null;
    if (selector === ".user") return this.children.find(x => x.className === "user") ?? null;
    return null;
  }
}

function sidebarFor(role, page, authResult) {
  const aside = new Element("aside");
  const location = { pathname: "/admin/" + page, href: "" };
  const document = {
    readyState: "loading",
    body: { appendChild() {} },
    createElement: tag => new Element(tag),
    querySelector: selector => selector === "body > aside" ? aside : null,
    addEventListener() {}
  };
  const profile = { role, full_name: "Current staff member", active: true };
  const client = {
    auth: {
      getUser: async () => authResult || ({ data: { user: { id: "staff-1" } }, error: null }),
      signOut: async () => ({ error: null })
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: profile, error: null })
        })
      })
    })
  };
  const window = {
    RAINBOW_SUPABASE_CONFIG: {},
    supabase: { createClient: () => client },
    addEventListener() {}
  };
  const context = createContext({ document, window, location, console: { ...console, error() {} } });
  runInContext(source, context, { filename: "admin/app.js" });
  return { aside, location, verify: () => runInContext("applyRoleNavigation()", context) };
}

describe("shared admin sidebar", () => {
  it.each([
    { data: { user: null }, error: null },
    { data: { user: null }, error: { name: "AuthSessionMissingError", message: "Auth session missing!" } },
    { data: { user: null }, error: { status: 401, message: "Invalid token" } }
  ])("redirects unauthenticated staff and leaves navigation empty", async result => {
    const {aside, location, verify}=sidebarFor("admin","staff.html",result);
    await verify();
    expect(location.href).toBe("login.html");
    expect(aside.querySelector("nav").children).toHaveLength(0);
  });
  it("keeps transient authentication outages distinct from sign-out", async () => {
    const {location, verify}=sidebarFor("admin","staff.html",{data:{user:null},error:{name:"AuthRetryableFetchError",status:503,message:"Unavailable"}});
    await verify();
    expect(location.href).toBe("");
  });
  it.each([
    ["inventory_staff", "inventory.html"],
    ["cashier", "billing.html"],
    ["admin", "index.html"]
  ])("does not reveal links or user details before %s access is verified", (role, page) => {
    const { aside } = sidebarFor(role, page);
    const nav = aside.querySelector("nav");
    const user = aside.querySelector(".user");
    expect(nav.children).toHaveLength(0);
    expect(user.children.map(child => child.tagName)).toEqual(["button"]);
    expect(user.children.some(child => child.textContent === "Checking access…")).toBe(false);
  });

  it.each(["inventory_staff", "cashier"])("gives %s the same combined staff navigation", async role => {
    const { aside, verify } = sidebarFor(role, "inventory.html");
    await verify();
    const nav = aside.querySelector("nav");
    expect(nav.children.map(child => child.textContent)).toEqual([
      "Quick Products", "Products", "Inventory", "Bills", "Orders", "Billing", "Customers", "My Attendance"
    ]);
    expect(nav.children.find(child => child.getAttribute("aria-current") === "page")?.textContent).toBe("Inventory");
    expect(aside.querySelector(".user").children.find(child => child.tagName === "small")?.textContent).toBe("Staff");
  });

  it.each(["admin","inventory_staff","cashier"])("opens Quick Products inside the existing %s staff navigation", async role => {
    const {aside,location,verify}=sidebarFor(role,"owner.html");
    await verify();
    expect(location.href).toBe("");
    const current=aside.querySelector("nav").children.find(x=>x.getAttribute("aria-current")==="page");
    expect(current?.textContent).toBe("Quick Products");
  });

  it.each(["inventory_staff", "cashier"])("blocks %s from admin-only staff management", async role => {
    const { aside, location, verify } = sidebarFor(role, "staff.html");
    await verify();
    expect(aside.querySelector("nav").children).toHaveLength(0);
    expect(location.href).toBe("billing.html");
  });

  it("shows admin links only after valid admin verification", async () => {
    const { aside, verify } = sidebarFor("admin", "index.html");
    expect(aside.querySelector("nav").children).toHaveLength(0);
    await verify();
    const labels = aside.querySelector("nav").children.map(child => child.textContent);
    expect(labels).toContain("Dashboard");
    expect(labels).toContain("Staff");
    expect(labels).toContain("Inventory");
  });
  it("loads the cache-busted Quick Products navigation on every existing staff page",()=>{
    const pages=["attendance.html","billing.html","bills.html","customers.html",
      "index.html","inventory.html","my-attendance.html","orders.html",
      "products.html","reports.html","settings.html","staff.html"];
    for(const page of pages){
      const html=readFileSync(path.resolve("admin",page),"utf8");
      expect(html).toContain("app.js?v=20261110-quick-products");
      expect(html).not.toContain("app.js?v=20261018-unified-shop-staff-v2");
    }
  });

});
