import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules/**", "coverage/**", "test-results/**"] },
  { files: ["src/**/*.mjs", "tests/**/*.mjs", "scripts/**/*.mjs"], languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } }, rules: { ...js.configs.recommended.rules } },
  { files: ["admin/**/*.js"], languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: { ...globals.browser } }, rules: { ...js.configs.recommended.rules, "no-undef": "warn", "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }] } }
];
