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
  {
    files:["src/**/*.mjs","tests/**/*.mjs","scripts/**/*.mjs"],
    languageOptions:{ecmaVersion:"latest",sourceType:"module",globals:{...globals.node}},
    rules:{...js.configs.recommended.rules}
  },
  {
    files:["admin/app.js"],
    languageOptions:{ecmaVersion:"latest",sourceType:"script",globals:{...globals.browser}},
    rules:{...js.configs.recommended.rules,"no-unused-vars":"off","no-undef":"off"}
  },
  {
    files:["admin/staff.js","admin/products.js","admin/inventory.js","admin/billing.js"],
    languageOptions:{ecmaVersion:"latest",sourceType:"script",globals:crossPageGlobals},
    rules:{...js.configs.recommended.rules,"no-undef":"off","no-unused-vars":"off","no-redeclare":"off","no-global-assign":"off"}
  }
];
