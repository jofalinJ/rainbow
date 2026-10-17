import { json } from "../http.js";

export function health(request, env = {}) {
  const response = json({
    application: "Rainbow Gold Covering",
    service: "rainbow-api",
    status: "online",
    version: "1.0.0",
    environment: env.APP_ENV || "development"
  });

  if (request.method === "HEAD") {
    return new Response(null, {
      status: response.status,
      headers: response.headers
    });
  }
  return response;
}
