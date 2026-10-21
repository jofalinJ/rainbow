// Cloudflare Workers Web Crypto utilities; no secret ever reaches the browser.
const encoder = new TextEncoder();
export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), {name:"HMAC", hash:"SHA-256"}, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(message)));
  return [...bytes].map(x=>x.toString(16).padStart(2,"0")).join("");
}
export function safeHexEqual(expected, actual) {
  if (typeof actual !== "string" || !/^[0-9a-f]{64}$/i.test(actual)) return false;
  const a = expected.toLowerCase(), b = actual.toLowerCase();
  let mismatch = a.length ^ b.length;
  for (let i=0;i<Math.max(a.length,b.length);i++) mismatch |= (a.charCodeAt(i)||0) ^ (b.charCodeAt(i)||0);
  return mismatch === 0;
}
export async function verifyHmac(secret, message, signature) {
  return safeHexEqual(await hmacHex(secret,message),signature);
}
export function isTestSecretsConfigured(env={}) {
  return /^rzp_test_[a-zA-Z0-9]+$/.test(String(env.RAZORPAY_KEY_ID||"")) &&
    Boolean(env.RAZORPAY_KEY_SECRET && env.RAZORPAY_WEBHOOK_SECRET &&
      env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY);
}
export function isTestConfigured(env={}) {
  return env.PAYMENTS_ENABLED === "true" && isTestSecretsConfigured(env);
}
