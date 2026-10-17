const DEFAULT_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff"
};

export function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...DEFAULT_HEADERS, ...extraHeaders }
  });
}

export function notFound() {
  return json({ success: false, error: "API endpoint not found" }, 404);
}

export function methodNotAllowed(allowed = "GET, HEAD") {
  return json(
    { success: false, error: "Method not allowed" },
    405,
    { Allow: allowed }
  );
}
