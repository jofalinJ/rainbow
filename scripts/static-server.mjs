import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const port = Number(process.env.PORT || 4173);
const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8" };

function safePath(urlPath) {
  const decoded = decodeURIComponent((urlPath || "/").split("?")[0]);
  const relative = decoded.replace(/^\/+/, "") || "index.html";
  const full = path.resolve(root, relative);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

const server = http.createServer(async (req, res) => {
  try {
    const filePath = safePath(req.url);
    if (!filePath) { res.writeHead(403); res.end("Forbidden"); return; }
    let target = filePath;
    try { const stat = await fs.stat(target); if (stat.isDirectory()) target = path.join(target, "index.html"); }
    catch { res.writeHead(404); res.end("Not found"); return; }
    const content = await fs.readFile(target);
    res.writeHead(200, { "Content-Type": mime[path.extname(target)] || "application/octet-stream", "Cache-Control": "no-store" });
    res.end(content);
  } catch { res.writeHead(500); res.end("Internal server error"); }
});
server.listen(port, "127.0.0.1", () => console.log("Static test server listening on http://127.0.0.1:" + port));
