// The browser's Back button, driven in a real browser.
//
// Every screen used to call `history.replaceState`, so the app held one
// history entry and Back always left the site. `setUrl` in `src/dom.ts` now
// pushes an entry when the address changes, and `installHistory` runs the
// router again on every popstate. This proves the mechanics without a
// session, a screen or a row: a stub route() stands in for `main.ts`, and the
// assertions are about what the address bar and the history do.
//
//   node e2e/history.cjs

const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const EXE =
  process.env.PLAYWRIGHT_CHROMIUM ||
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = 4502;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-history-"));

// The harness exposes setUrl and a route() that records every call and, like
// a real screen, rewrites the address as it paints.
const HARNESS = `
import { installHistory, setUrl } from "${path.join(ROOT, "src/dom.ts")}";
const w = window as any;
w.routed = [];
w.escapes = 0;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") w.escapes++; });
installHistory(() => {
  w.routed.push(location.search);
  // A screen restored under a URL normalises it on the way — the thing that
  // must replace rather than push while a restore is in flight.
  const p = new URLSearchParams(location.search);
  if (p.get("test")) {
    const next = { test: p.get("test")!.replace(/-dirty$/, "") };
    if (p.get("q")) next.q = p.get("q")!;
    setUrl(next);
  }
});
w.setUrl = setUrl;
`;

function build() {
  const entry = path.join(dir, "harness.ts");
  fs.writeFileSync(entry, HARNESS);
  execFileSync(
    path.join(ROOT, "node_modules/.bin/esbuild"),
    [
      entry,
      "--bundle",
      `--outfile=${path.join(dir, "harness.js")}`,
      "--format=iife",
      "--loader:.woff2=dataurl",
      "--loader:.woff=dataurl",
      "--loader:.ttf=dataurl",
      `--define:import.meta.env=${JSON.stringify({
        VITE_GOOGLE_CLIENT_ID: "",
        VITE_APPINSIGHTS_CONNECTION_STRING: "",
        MODE: "test",
      })}`,
      "--log-level=error",
    ],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] }
  );
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"></head>
<body><div id="app"><button id="go">go</button></div><script src="harness.js"></script></body></html>`
  );
}

const TYPES = { ".html": "text/html", ".js": "text/javascript" };

function serve() {
  const server = http.createServer((req, res) => {
    const name = req.url.split("?")[0];
    const file = path.join(dir, name === "/" ? "index.html" : path.basename(name));
    if (!fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

(async () => {
  build();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));

  const len = () => page.evaluate(() => history.length);
  const search = () => page.evaluate(() => location.search);
  const set = (params) => page.evaluate((p) => window.setUrl(p), params);

  // Arrive on a link that needs cleaning, as a shared WhatsApp link does.
  await page.goto(`http://localhost:${PORT}/?test=abc-dirty`);
  const atBoot = await len();

  // --- The boot is a restore: the screen's own rewrite replaces, never pushes.
  await set({ test: "abc" });
  check((await search()) === "?test=abc", "the boot's clean-up rewrites the address");
  check((await len()) === atBoot, "…and replaces the entry rather than pushing one");

  // --- The person does something; from here a change is a move.
  await page.click("#go");
  await set({ test: "abc", q: "q2" });
  check((await len()) === atBoot + 1, "a URL change after a click pushes an entry");
  await set({ q: "q2", test: "abc" });
  check((await len()) === atBoot + 1, "the same parameters in another order push nothing");
  await set({ test: "abc", q: "q2" });
  check((await len()) === atBoot + 1, "a re-render of the same screen pushes nothing");
  await set({ view: "students" });
  check((await len()) === atBoot + 2, "a second move pushes a second entry");

  // --- Back routes to the previous screen instead of leaving the site.
  await page.goBack();
  await page.waitForFunction(() => window.routed.length === 1);
  check((await search()) === "?test=abc&q=q2", "Back lands on the previous screen's address");
  check(
    (await page.evaluate(() => window.routed[0])) === "?test=abc&q=q2",
    "…and route() is asked to paint it"
  );
  check((await len()) === atBoot + 2, "the restored screen's own setUrl pushes nothing");

  await page.goBack();
  await page.waitForFunction(() => window.routed.length === 2);
  check((await search()) === "?test=abc", "Back again reaches the entry the boot cleaned");
  check(await page.evaluate(() => history.state && history.state.vidai === 1), "entries carry the app's stamp");

  await page.goForward();
  await page.waitForFunction(() => window.routed.length === 3);
  check((await search()) === "?test=abc&q=q2", "Forward works too");

  // --- A restore ends at the next click: a change after it is a push again.
  await page.click("#go");
  await set({ mark: "1" });
  check((await len()) === atBoot + 2, "after Back, a move pushes on top of where you are (forward history replaced)");

  // --- An open dialog is closed on Back, by the Escape it already listens
  //     for, and that synthetic key does NOT end the restore.
  await page.evaluate(() => document.body.classList.add("modal-open"));
  await page.goBack();
  await page.waitForFunction(() => window.routed.length === 4);
  check((await page.evaluate(() => window.escapes)) === 1, "Back sends Escape to an open dialog");
  await page.evaluate(() => document.body.classList.remove("modal-open"));
  const before = await len();
  await set({ test: "abc", q: "q2", extra: "1" });
  check((await len()) === before, "the screen's rewrite after that Escape still replaces: the restore survived the synthetic key");

  check(errors.length === 0, `no page errors (${errors.join("; ")})`);

  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
