// Local E2E harness: serves the built dist/ on http://127.0.0.1:4400 and
// proxies /api/* to production (or E2E_API_BASE). Lets a local Chromium test
// the real app + real API without deploying.
//
//   npm run build && node e2e/serve.js
//
// In sandboxed environments that need an egress proxy for outbound HTTPS,
// run with NODE_USE_ENV_PROXY=1.
const http = require("http");
const fs = require("fs");
const path = require("path");

const DIST = path.join(__dirname, "..", "dist");
const API = process.env.E2E_API_BASE || "https://vidaivi.seyali.app";
const PORT = Number(process.env.E2E_PORT || 4400);
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

http
  .createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/")) {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const headers = {};
        // Forward only the headers the API cares about — including the
        // custom auth header (SWA strips Authorization in production,
        // so the app sends X-Vidaivi-Auth).
        if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
        if (req.headers["authorization"]) headers["authorization"] = req.headers["authorization"];
        if (req.headers["x-vidaivi-auth"]) headers["x-vidaivi-auth"] = req.headers["x-vidaivi-auth"];
        const upstream = await fetch(API + req.url, {
          method: req.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        res.writeHead(upstream.status, {
          "content-type": upstream.headers.get("content-type") || "application/json",
        });
        res.end(body);
        return;
      }
      let file = path.join(DIST, req.url.split("?")[0]);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(DIST, "index.html");
      }
      res.writeHead(200, {
        "content-type": MIME[path.extname(file)] || "application/octet-stream",
      });
      res.end(fs.readFileSync(file));
    } catch (e) {
      res.writeHead(502);
      res.end(String(e.message));
    }
  })
  .listen(PORT, () => console.log(`serving ${DIST} on http://127.0.0.1:${PORT} (API → ${API})`));
