// A tab left open across a deploy, driven in a real browser.
//
// No network and no session: the built `dist/` is served by a server this
// file controls, so it can do what a deploy does — make the previous build's
// hashed chunks vanish — while a page that loaded before is still open. What
// is proved is `src/staleload.ts`'s contract: the first chunk-load failure
// reloads the page once and the screen comes back whole; a second failure
// straight after does NOT reload again, so a genuinely broken build cannot
// spin a tab in a loop.
//
//   npm run build && node e2e/stale.cjs

const { chromium } = require("playwright-core");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const EXE =
  process.env.PLAYWRIGHT_CHROMIUM ||
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = 4506;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf",
};

// The deploy switch. While `deployed` is true the old build's lazy chunks
// are gone: the index.html and the main bundle (what a loaded tab already
// holds) are served, everything else under /assets/ is a 404 — exactly what
// Azure answers for a hash that no longer exists. A GET of `/` while deployed
// is a reload picking up "the new build", and brings the chunks back.
const state = { deployed: false, indexHits: 0, chunk404s: [] };
const LAZY = /^\/assets\/(auto-render|browse|pdf|katex)/;

function serve() {
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url === "/" || url === "/index.html") {
      state.indexHits += 1;
      if (state.deployed) state.deployed = false; // the reload fetched the new build
    }
    if (state.deployed && LAZY.test(url)) {
      state.chunk404s.push(url);
      res.writeHead(404, { "content-type": "text/html" }).end("not found");
      return;
    }
    const file = path.join(DIST, url === "/" ? "index.html" : url);
    if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

(async () => {
  if (!fs.existsSync(path.join(DIST, "index.html"))) {
    console.error("dist/ is missing — run `npm run build` first");
    process.exit(1);
  }
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // The Google sign-in script is not reachable here; ignore its failure.
  await page.route("https://accounts.google.com/**", (r) => r.abort());

  // A guest opens the demo test and reaches its landing card — before the
  // deploy. Nothing lazy has loaded yet: the landing shows no maths.
  await page.goto(`http://localhost:${PORT}/?test=matrices-demo`, { waitUntil: "networkidle" });
  const guest = page.locator("#guest-btn");
  if (await guest.count()) await guest.click();
  await page.waitForSelector("text=Start test");
  const loaded = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => new URL(r.name).pathname).filter((p) => p.includes("/assets/"))
  );
  check(!loaded.some((p) => LAZY.test(p)), `no lazy chunk loaded before the deploy (${loaded.join(", ")})`);

  // The deploy lands while the tab is open.
  state.deployed = true;
  const hitsBefore = state.indexHits;

  // The guest starts the test. Every question card is handed to renderMath,
  // which is the first dynamic import of the session — and this build no
  // longer has it.
  await page.click("text=Start test");
  await page.waitForTimeout(4000);

  check(state.chunk404s.length > 0, `the old chunks were asked for and were gone (${state.chunk404s.length} x 404)`);
  check(state.indexHits === hitsBefore + 1, `the page reloaded exactly once (index served ${state.indexHits - hitsBefore} more time)`);
  const url = page.url();
  check(url.includes("test=matrices-demo"), `the reload kept the place (${url.replace(/^.*\?/, "?")})`);
  check(await page.evaluate(() => Number(sessionStorage.getItem("vidai:staleReload") || 0) > 0), "the reload was noted for the loop guard");
  check(errors.every((e) => !/preload CSS/.test(e)), `the failure that triggered the reload was not thrown (${errors.length ? errors[0].slice(0, 80) : "none"})`);

  // The reloaded tab runs the new build. The guest player comes back on its
  // landing card (a student's or a teacher's `?q=` carries the question);
  // pressing Start again asks for the same chunk, which now loads.
  errors.length = 0;
  const landing = page.locator("text=Start test");
  if (await landing.count()) await landing.click();
  await page.waitForTimeout(2500);
  const after = await page.evaluate(() =>
    performance.getEntriesByType("resource").map((r) => new URL(r.name).pathname).filter((p) => p.includes("/assets/"))
  );
  check(after.some((p) => /auto-render/.test(p)), `KaTeX loaded in the reloaded tab (${after.filter((p) => LAZY.test(p)).join(", ")})`);
  check(errors.length === 0, `and nothing errored after the reload (${errors[0] ? errors[0].slice(0, 80) : "none"})`);
  check(state.indexHits === hitsBefore + 1, "with no further reload");

  // ---------- A second failure straight after does not reload again ----------
  state.deployed = true;
  const hits2 = state.indexHits;
  const refused = await page.evaluate(() => {
    return new Promise((resolve) => {
      let prevented = null;
      const on = (e) => { prevented = e.defaultPrevented; };
      window.addEventListener("vite:preloadError", on, { capture: false });
      // Fire the same event Vite would, after the app's listener has run.
      const ev = new Event("vite:preloadError", { cancelable: true });
      ev.payload = new Error("Failed to fetch dynamically imported module: /assets/x.js");
      window.dispatchEvent(ev);
      setTimeout(() => resolve(prevented), 1500);
    });
  });
  check(refused === false, "a failure inside the window is left alone (not prevented)");
  check(state.indexHits === hits2, "and the page did not reload a second time");

  // ---------- Long after the last reload, recovery is allowed again ----------
  await page.evaluate(() => sessionStorage.setItem("vidai:staleReload", String(Date.now() - 60_000)));
  await page.evaluate(() => {
    const ev = new Event("vite:preloadError", { cancelable: true });
    ev.payload = new Error("Failed to fetch dynamically imported module: /assets/y.js");
    window.dispatchEvent(ev);
  });
  await page.waitForTimeout(2500);
  check(state.indexHits === hits2 + 1, "a failure after the window reloads once more");

  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
