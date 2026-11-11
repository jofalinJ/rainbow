import js from "@eslint/js";
import globals from "globals";

const crossPageGlobals={
  ...globals.browser,
  SUPABASE_URL:"readonly",
  SUPABASE_ANON_KEY:"readonly",
  bootSupabase:"readonly",
  requireSession:"readonly",
  getMyProfile:"readonly",
  sb:"readonly",
  sbClient:"writable",
  logout:"readonly",
  comingSoon:"readonly"
};

export default [
  { ignores:["node_modules/**","coverage/**","test-results/**"] },
  // Browser entry modules are private closures/modules, not cross-page globals.
  // Enforce liveness here so dead helpers do not creep back into the storefront.
  {
    files:["content.js","mobile-storefront.js","product-page.js","shop-catalogue.js","shop-discovery.js","order.js"],
    languageOptions:{ecmaVersion:"latest",sourceType:"module",globals:{...globals.browser}},
    rules:{"no-unused-vars":"error"}
  },
  {
    files:["src/**/*.mjs","tests/**/*.mjs","scripts/**/*.mjs"],
    languageOptions:{ecmaVersion:"latest",sourceType:"module",globals:{...globals.node}},
    rules:{...js.configs.recommended.rules}
  },
  {
    files:["admin/owner.js"],
    languageOptions:{ecmaVersion:"latest",sourceType:"script",globals:{...globals.browser}},
    rules:{...js.configs.recommended.rules}
  },
  {
    files:["admin/app.js"],
    languageOptions:{ecmaVersion:"latest",sourceType:"script",globals:{...globals.browser}},
    rules:{...js.configs.recommended.rules,"no-unused-vars":"off","no-undef":"off"}
  },
  {
    files:["admin/staff.js","admin/products.js","admin/inventory.js","admin/billing.js","admin/bills.js"],
    languageOptions:{ecmaVersion:"latest",sourceType:"script",globals:crossPageGlobals},
    rules:{...js.configs.recommended.rules,"no-undef":"off","no-unused-vars":"off","no-redeclare":"off","no-global-assign":"off"}
  },
  {
    files:["invoice.js"],
    languageOptions:{ecmaVersion:"latest",sourceType:"script",globals:{...globals.browser}},
    rules:{...js.configs.recommended.rules,"no-unused-vars":"off","no-undef":"off"}
  },
  {
    files:["invoice.js","invoice-template.js","bill-pdf.js"],
    languageOptions:{ecmaVersion:"latest",sourceType:"script",globals:{...globals.browser}},
    rules:{...js.configs.recommended.rules,"no-unused-vars":"off","no-undef":"off"}
  }
];
