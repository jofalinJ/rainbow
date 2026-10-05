const USERNAME_PATTERN = /^[a-z0-9._-]{3,30}$/;
const ALLOWED_ROLES = new Set(["cashier", "inventory_staff"]);

export function validateStaffCreation(input) {
  const name = String(input?.name ?? "").trim();
  const username = String(input?.username ?? "").trim().toLowerCase();
  const password = String(input?.password ?? "");
  const role = String(input?.role ?? "");
  if (!name) return { ok: false, error: "Staff name is required." };
  if (!USERNAME_PATTERN.test(username)) return { ok: false, error: "Use a valid username with 3-30 lowercase letters, numbers, dots, underscores or hyphens." };
  if (password.length < 6) return { ok: false, error: "Password must contain at least 6 characters." };
  if (!ALLOWED_ROLES.has(role)) return { ok: false, error: "Choose a valid staff role." };
  return { ok: true, value: { name, username, password, role } };
}

export const STAFF_ROLES = Object.freeze([...ALLOWED_ROLES]);
