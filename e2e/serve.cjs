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
const API = process.env.E2E_API_BASE || "https://vidai.seyali.app";
const PORT = Number(process.env.E2E_PORT || 4400);
const MIME = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// Apply the deployed globalHeaders locally, so the CSP is exercised by the
// suite rather than first met in production. SWA applies these at the edge;
// without them here, a policy that breaks Google sign-in would pass every
// local run and fail only once it was live.
function globalHeaders() {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(DIST, "staticwebapp.config.json"), "utf8"));
    return cfg.globalHeaders || {};
  } catch {
    return {};
  }
}

const SECURITY_HEADERS = globalHeaders();

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
        // so the app sends X-Vidai-Auth).
        if (req.headers["content-type"]) headers["content-type"] = req.headers["content-type"];
        if (req.headers["authorization"]) headers["authorization"] = req.headers["authorization"];
        if (req.headers["x-vidai-auth"]) headers["x-vidai-auth"] = req.headers["x-vidai-auth"];
        // The pre-rename header, still accepted by the API for one release.
        if (req.headers["x-vidaivi-auth"]) headers["x-vidaivi-auth"] = req.headers["x-vidaivi-auth"];
        // The session is a cookie now, so it has to make the round trip or
        // every authenticated flow in the suite signs in and is immediately a
        // stranger again.
        if (req.headers["cookie"]) headers["cookie"] = req.headers["cookie"];
        const upstream = await fetch(API + req.url, {
          method: req.method,
          headers,
          body: chunks.length ? Buffer.concat(chunks) : undefined,
        });
        const body = Buffer.from(await upstream.arrayBuffer());
        const out = {
          "content-type": upstream.headers.get("content-type") || "application/json",
        };
        // The throttle answers 429 with Retry-After, and the suite reads it.
        // Dropping it here made the API look like it had forgotten to send one.
        const retryAfter = upstream.headers.get("retry-after");
        if (retryAfter) out["retry-after"] = retryAfter;
        const setCookie = upstream.headers.getSetCookie
          ? upstream.headers.getSetCookie()
          : [upstream.headers.get("set-cookie")].filter(Boolean);
        if (setCookie.length) {
          // This server is plain http on localhost, and the cookie comes back
          // scoped to the deployed host. Keep HttpOnly and SameSite — those are
          // what the suite is here to exercise — and drop only the two
          // attributes that would make the browser discard it locally.
          out["set-cookie"] = setCookie.map((c) =>
            c
              .split(";")
              .filter((a) => !/^\s*(secure|domain=)/i.test(a))
              .join(";")
          );
        }
        res.writeHead(upstream.status, out);
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
      res.writeHead(200, {
        "content-type": MIME[ext] || "application/octet-stream",
        ...SECURITY_HEADERS,
      });
      res.end(body);
    } catch (e) {
      res.writeHead(502);
      res.end(String(e.message));
    }
  })
  .listen(PORT, () => console.log(`serving ${DIST} on http://127.0.0.1:${PORT} (API → ${API})`));
