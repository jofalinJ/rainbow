export const BASE_URL = (process.env.E2E_BASE_URL || "http://127.0.0.1:4173").replace(/\/$/, "");
export const ADMIN_USERNAME = process.env.E2E_ADMIN_USERNAME || "";
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD || "";
export const E2E_ENABLED = process.env.E2E_ENABLED === "true";
export const ISOLATED_ENV = process.env.E2E_ISOLATED_ENV === "true";

export function requireAuthenticatedE2EConfig() {
  if (!E2E_ENABLED) return false;
  if (!ISOLATED_ENV) throw new Error("Authenticated E2E tests require E2E_ISOLATED_ENV=true.");
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) throw new Error("Authenticated E2E tests require E2E_ADMIN_USERNAME and E2E_ADMIN_PASSWORD.");
  return true;
}
