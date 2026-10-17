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

function sidebarFor(role, page) {
  const aside = new Element("aside");
  const location = { pathname: "/admin/" + page, href: "" };
  const document = {
    readyState: "loading",
    createElement: tag => new Element(tag),
    querySelector: selector => selector === "body > aside" ? aside : null,
    addEventListener() {}
  };
  const profile = { role, full_name: "Current staff member", active: true };
  const client = {
    auth: {
      getUser: async () => ({ data: { user: { id: "staff-1" } }, error: null }),
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
  const context = createContext({ document, window, location, console });
  runInContext(source, context, { filename: "admin/app.js" });
  return { aside, location, verify: () => runInContext("applyRoleNavigation()", context) };
}

describe("shared admin sidebar", () => {
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

  it("only publishes inventory staff links after verification", async () => {
    const { aside, verify } = sidebarFor("inventory_staff", "inventory.html");
    await verify();
    const nav = aside.querySelector("nav");
    expect(nav.children.map(child => child.textContent)).toEqual(["Products", "Inventory", "Purchasing", "My Attendance"]);
    expect(nav.children.find(child => child.getAttribute("aria-current") === "page")?.textContent).toBe("Inventory");
    const user = aside.querySelector(".user");
    expect(user.children.find(child => child.tagName === "small")?.textContent).toBe("Inventory Staff");
  });

  it("never displays admin-only links when a cashier opens an unauthorized page", async () => {
    const { aside, location, verify } = sidebarFor("cashier", "inventory.html");
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
});
