import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "coverage/**", "test-results/**"] },
  {
    files: ["src/**/*.mjs", "tests/**/*.mjs", "scripts/**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } },
    rules: { ...js.configs.recommended.rules }
  },
  {
    files: ["admin/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "script",
      globals: {
        ...globals.browser,
        SUPABASE_URL: "readonly",
        SUPABASE_ANON_KEY: "readonly",
        bootSupabase: "readonly",
        requireSession: "readonly",
        getMyProfile: "readonly",
        sb: "readonly",
        sbClient: "readonly",
        logout: "readonly",
        comingSoon: "readonly"
      }
    },
    rules: { ...js.configs.recommended.rules, "no-undef": "warn", "no-unused-vars": "off" }
  }
];
