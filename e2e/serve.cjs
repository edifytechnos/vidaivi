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

const CDN_HOSTS = /https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\/[^"')\s]*/g;

/** Point CDN URLs at this origin's /_cdn/ mirror. */
function rewriteCdn(text) {
  return text.replace(CDN_HOSTS, (url) => `/_cdn/${encodeURIComponent(url)}`);
}

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
      // Mirror the CDN assets (KaTeX, fonts) through this origin. Browsers in
      // locked-down environments often can't reach them directly, which would
      // silently disable maths rendering — the one thing worth checking most.
      if (req.url.startsWith("/_cdn/")) {
        const remote = decodeURIComponent(req.url.slice("/_cdn/".length));
        if (!/^https:\/\/(cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(remote)) {
          res.writeHead(403);
          res.end("blocked");
          return;
        }
        const upstream = await fetch(remote);
        let body = Buffer.from(await upstream.arrayBuffer());
        const type = upstream.headers.get("content-type") || "application/octet-stream";
        // Rewrite nested URLs (e.g. font files referenced from katex.min.css).
        if (type.includes("text/css")) {
          body = Buffer.from(rewriteCdn(body.toString()));
        }
        res.writeHead(upstream.status, { "content-type": type });
        res.end(body);
        return;
      }

      let file = path.join(DIST, req.url.split("?")[0]);
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        file = path.join(DIST, "index.html");
      }
      const ext = path.extname(file);
      let body = fs.readFileSync(file);
      if (ext === ".html" || ext === ".css") body = Buffer.from(rewriteCdn(body.toString()));
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
      res.end(body);
    } catch (e) {
      res.writeHead(502);
      res.end(String(e.message));
    }
  })
  .listen(PORT, () => console.log(`serving ${DIST} on http://127.0.0.1:${PORT} (API → ${API})`));
