import { methodNotAllowed, notFound } from "./http.js";
import { health } from "./routes/health.js";

// No sensitive routes are enabled until authentication, authorization,
// signature verification, and persistence have been implemented and tested.
export default {
  async fetch(request, env = {}) {
    const path = new URL(request.url).pathname;

    if (path === "/" || path === "/api/health") {
      if (request.method !== "GET" && request.method !== "HEAD") {
        return methodNotAllowed();
      }
      return health(request, env);
    }

    return notFound();
  }
};
