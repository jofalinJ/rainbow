import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.mjs", "tests/integration/**/*.test.mjs"],
    coverage: { provider: "v8", include: ["src/**/*.mjs"], reporter: ["text", "html"], thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 } }
  }
});
