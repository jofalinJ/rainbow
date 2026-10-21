import { methodNotAllowed, notFound } from "./http.js";
import { health } from "./routes/health.js";
import { razorpayRoute, expireRazorpayReservations } from "./routes/razorpay.js";

export default {
  async fetch(request, env = {}) {
    const path = new URL(request.url).pathname;
    if (path === "/" || path === "/api/health") {
      if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed();
      return health(request, env);
    }
    if (path.startsWith("/api/razorpay/")) return razorpayRoute(request,env);
    return notFound();
  },
  async scheduled(event, env = {}) {
    await expireRazorpayReservations(env);
  }
};
