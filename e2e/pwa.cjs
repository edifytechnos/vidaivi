// Vidai installed from the browser, driven in a real browser.
//
// No network and no session: the built `dist/` is served by a server this
// file controls, with the deployed security headers applied. What is proved:
//
//   - the manifest is complete and every icon it names exists at the size it
//     claims (Chrome silently refuses to install on a wrong size);
//   - Chromium itself reports the page installable (no installability errors);
//   - the service worker registers, controls the page, and caches ONE thing,
//     the offline page — never index.html, never /assets/, never /api/;
//   - online, every navigation still reaches the server (no cached shell to
//     pin a tab to an old build); offline, the offline page answers instead
//     of the browser's dinosaur, and "Try again" comes back to the app;
//   - "Install the app" is hidden until the browser can install, replays the
//     browser's prompt once, and on an iPhone explains Share → Add to Home
//     Screen instead;
//   - none of it trips the Content-Security-Policy.
//
//   VITE_GOOGLE_CLIENT_ID=suite.apps.googleusercontent.com npm run build && node e2e/pwa.cjs
//
// The client id only has to be present, so the welcome screen (where the
// button lives for a signed-out visitor) is what a guest boots into, exactly
// as in production. Google's script never loads: there is no network.

const { chromium } = require("playwright-core");
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const EXE = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = 4507;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const config = JSON.parse(fs.readFileSync(path.join(ROOT, "public/staticwebapp.config.json"), "utf8"));
const TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json",
  ".woff": "font/woff", ".woff2": "font/woff2", ".ttf": "font/ttf", ".png": "image/png",
  ".svg": "image/svg+xml", ...config.mimeTypes,
};

const hits = { navigations: 0, api: 0 };
function serve() {
  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (url.startsWith("/api/")) {
      hits.api += 1;
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"error":"no session in this suite"}');
      return;
    }
    if (req.headers["sec-fetch-mode"] === "navigate") hits.navigations += 1;
    let file = path.join(DIST, decodeURIComponent(url));
    if (!file.startsWith(DIST)) file = DIST;
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // navigationFallback, as Azure does it.
      if (url.startsWith("/assets/")) {
        res.writeHead(404);
        res.end();
        return;
      }
      file = path.join(DIST, "index.html");
    }
    res.writeHead(200, { ...config.globalHeaders, "content-type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => server.listen(PORT, () => resolve(server)));
}

function pngSize(file) {
  const b = fs.readFileSync(file);
  if (b.readUInt32BE(0) !== 0x89504e47) return null;
  return `${b.readUInt32BE(16)}x${b.readUInt32BE(20)}`;
}

// Clarity loads only on the live hosts, so a recorder stands in for it: what
// src/install.ts hands `window.clarity` is what the real tag would receive.
const CLARITY_RECORDER = () => {
  window.__clarity = [];
  window.clarity = (...args) => window.__clarity.push(args);
};
const clarityCalls = (p) => p.evaluate(() => window.__clarity.map((a) => a.join(":")));

(async () => {
  // ---------- The manifest, on disk ----------
  const manifest = JSON.parse(fs.readFileSync(path.join(DIST, "manifest.webmanifest"), "utf8"));
  check(manifest.name && manifest.short_name && manifest.short_name.length <= 12, `named, with a short name that fits under an icon (${manifest.short_name})`);
  check(manifest.start_url === "/" && manifest.scope === "/" && manifest.display === "standalone", "opens at / in its own window");
  check(/^#[0-9a-f]{6}$/i.test(manifest.theme_color) && /^#[0-9a-f]{6}$/i.test(manifest.background_color), "theme and splash colours set");
  const icons = manifest.icons || [];
  for (const icon of icons) {
    const actual = pngSize(path.join(DIST, icon.src));
    check(actual === icon.sizes, `${icon.src} is ${icon.sizes} as it claims (${actual})`);
  }
  const has = (size, purpose) => icons.some((i) => i.sizes === size && (i.purpose || "any").split(" ").includes(purpose));
  check(has("192x192", "any") && has("512x512", "any"), "192 and 512 icons, which Android requires");
  check(has("512x512", "maskable"), "a maskable icon, so Android does not shrink it onto a white disc");
  check(config.mimeTypes?.[".webmanifest"] === "application/manifest+json", "Azure serves the manifest with its own type");
  const swRoute = config.routes.find((r) => r.route === "/sw.js");
  check(swRoute?.headers?.["cache-control"] === "no-cache", "sw.js is no-cache, so a fixed worker reaches every phone on its next visit");
  const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
  check(/rel="manifest" href="\/manifest\.webmanifest"/.test(html) && /rel="apple-touch-icon"/.test(html), "index.html links the manifest and the iPhone icon");

  // ---------- In the browser ----------
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const violations = [];
  // A persistent profile, not a fresh context: Playwright's ordinary contexts
  // are incognito, and Chrome never offers to install from incognito — the
  // installability check would fail on that alone.
  const profileDir = fs.mkdtempSync(path.join(require("node:os").tmpdir(), "vidai-pwa-"));
  const context = await chromium.launchPersistentContext(profileDir, { executablePath: EXE, viewport: { width: 390, height: 844 } });
  // Vidai's own first-run tour is not what is under test here.
  await context.addInitScript(() => {
    for (const r of ["student", "teacher", "parent", "admin"]) localStorage.setItem(`vidai:tour:${r}`, "1");
  });
  const page = context.pages()[0] || (await context.newPage());
  page.on("console", (m) => {
    if (/Content Security Policy|Refused to/.test(m.text())) violations.push(m.text());
  });
  await page.goto(BASE + "/");
  await page.waitForSelector(".welcome", { timeout: 10000 });
  const scope = await page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
  check(scope === BASE + "/", `the service worker registers for the whole site (${scope})`);
  await page.reload();
  await page.waitForSelector(".welcome");
  check(await page.evaluate(() => !!navigator.serviceWorker.controller), "and controls the page after a reload");

  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  check(installabilityErrors.length === 0, `Chromium reports the page installable (${JSON.stringify(installabilityErrors)})`);
  const app = await cdp.send("Page.getAppManifest");
  check(app.errors.length === 0, `and reads the manifest without errors (${JSON.stringify(app.errors)})`);

  const cached = await page.evaluate(async () => {
    const out = [];
    for (const key of await caches.keys()) for (const req of await (await caches.open(key)).keys()) out.push(new URL(req.url).pathname);
    return out;
  });
  check(cached.length === 1 && cached[0] === "/offline.html", `the worker caches the offline page and nothing else (${cached.join(", ")})`);

  // Online, the page is the network's every time: no cached shell.
  const before = hits.navigations;
  await page.reload();
  await page.waitForSelector(".welcome");
  check(hits.navigations === before + 1, "online, a navigation still reaches the server");

  // Offline: the offline page, not the browser's error.
  await context.setOffline(true);
  await page.goto(BASE + "/?test=anything").catch(() => {});
  const offlineText = await page.textContent("body").catch(() => "");
  check(/You are offline/.test(offlineText || ""), "offline, the offline page answers the navigation");
  await context.setOffline(false);
  await page.click("a:text-is(\"Try again\")");
  await page.waitForSelector(".welcome", { timeout: 10000 });
  check(true, "and Try again comes back to the app once the network is back");

  // ---------- The install button ----------
  const button = ".welcome-install";
  // This profile is installable, so Chromium makes its own offer, for real.
  await page.waitForSelector(button, { state: "visible", timeout: 10000 }).catch(() => {});
  check(await page.locator(button).isVisible(), "Chromium's own offer to install brings Install the app up");

  // Incognito is never offered an install, which makes it the place to see
  // the button wait for the browser, and then answer it.
  const plain = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const pl = await plain.newPage();
  await pl.addInitScript(CLARITY_RECORDER);
  await pl.goto(BASE + "/");
  await pl.waitForSelector(".welcome");
  check(await pl.locator(button).isHidden(), "Install the app is hidden while the browser has not offered to install");
  await pl.evaluate(() => {
    const e = new Event("beforeinstallprompt");
    e.prompt = () => {
      window.__prompted = (window.__prompted || 0) + 1;
      return Promise.resolve();
    };
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  check(await pl.locator(button).isVisible(), "it appears when the browser is ready to install");
  await pl.click(button);
  await pl.waitForFunction(() => window.__prompted === 1);
  check(true, "pressing it replays the browser's own install prompt");
  await pl.waitForFunction(() => window.__clarity.some((a) => a[1] === "install_prompt_accepted"));
  const plCalls = await clarityCalls(pl);
  check(plCalls.includes("set:display:browser"), `Clarity tags a browser-tab session display=browser (${plCalls.join(", ")})`);
  check(plCalls.includes("event:install_prompt_accepted"), "and records the install prompt's answer as a Clarity event");
  await pl.evaluate(() => window.dispatchEvent(new Event("appinstalled")));
  check((await clarityCalls(pl)).includes("event:app_installed"), "and the install itself");
  check(await pl.locator(button).isHidden(), "and it goes away: a prompt can be shown only once");
  await plain.close();

  // An iPhone never fires the event; the button explains instead.
  const iphone = await browser.newContext({
    viewport: { width: 390, height: 844 },
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
  });
  const ip = await iphone.newPage();
  await ip.goto(BASE + "/");
  await ip.waitForSelector(".welcome");
  check(await ip.locator(button).isVisible(), "on an iPhone the button is there from the start");
  await ip.click(button);
  await ip.waitForSelector(".modal", { timeout: 5000 });
  const dialog = await ip.textContent(".modal");
  check(/Add to Home Screen/.test(dialog || "") && /Share/.test(dialog || ""), "and explains Share → Add to Home Screen");
  check((await ip.locator(".modal-actions .btn:visible").count()) === 1, "with one answer, not a Got it beside a Close that does the same");
  await iphone.close();

  // Once installed, there is nothing to offer.
  const installed = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const ins = await installed.newPage();
  await ins.addInitScript(CLARITY_RECORDER);
  await ins.addInitScript(() => {
    const real = window.matchMedia.bind(window);
    window.matchMedia = (q) => (q === "(display-mode: standalone)" ? { matches: true, media: q, addEventListener() {}, removeEventListener() {} } : real(q));
  });
  await ins.goto(BASE + "/");
  await ins.waitForSelector(".welcome");
  await ins.evaluate(() => {
    const e = new Event("beforeinstallprompt");
    e.prompt = () => Promise.resolve();
    e.userChoice = Promise.resolve({ outcome: "accepted" });
    window.dispatchEvent(e);
  });
  check(await ins.locator(button).isHidden(), "running as the installed app, the button never shows");
  const insCalls = await clarityCalls(ins);
  check(insCalls.includes("set:display:installed") && !insCalls.includes("set:display:browser"), `an open from the installed app is tagged display=installed in Clarity (${insCalls.join(", ")})`);
  await installed.close();

  check(violations.length === 0, `no Content-Security-Policy violations (${violations.join(" | ")})`);

  await context.close();
  await browser.close();
  fs.rmSync(profileDir, { recursive: true, force: true });
  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
