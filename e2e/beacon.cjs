// The version beacon (src/beacon.ts), driven in a real browser.
//
// No network and no session: the real beacon.ts and dom.ts — with the real
// notice toast and analytics behind them — are bundled with esbuild onto a
// harness page, and a server this file controls plays the deploy by changing
// what /version.json says. The bundle's own build id is fixed at "build-a",
// so a page that reloads onto "build-b" is still build-a: which is exactly a
// stale edge, and is what proves the loop guard.
//
// What is proved:
//   - nothing happens while the live build is this one, or before a move;
//   - a newer build is only ARMED by a check — the page never reloads by
//     itself; the 5-minute poll arms it with nobody touching anything;
//   - the next move (setUrl push, or Back) reloads onto the URL moved to,
//     and the new page says so in one line;
//   - a move is refused while a dialog is open, a text field has focus, a
//     screen holds unsaved work, or a write is in flight — and the write is
//     waited out, not aborted, unless the person starts working again;
//   - a reload onto a build that still is not the new one is not repeated
//     (a stale edge cannot loop a tab), and a broken version file arms nothing.
//
//   node e2e/beacon.cjs

const { chromium } = require("playwright-core");
const { execFileSync } = require("node:child_process");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const EXE = process.env.PLAYWRIGHT_CHROMIUM || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const PORT = 4509;
const BASE = `http://localhost:${PORT}`;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-beacon-"));

const HARNESS = `
import { installHistory, setUrl } from "${path.join(ROOT, "src/dom.ts")}";
import { installBeacon, checkVersion, holdUpdatesWhile, trackWrite, updateArmed } from "${path.join(ROOT, "src/beacon.ts")}";
const w = window as any;
w.loaded = Date.now() + Math.random();
w.hold = false;
holdUpdatesWhile(() => w.hold);
installHistory(() => {});
installBeacon();
Object.assign(w, { setUrl, checkVersion, trackWrite, updateArmed });
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
      `--define:import.meta.env=${JSON.stringify({ DEV: false, VITE_GOOGLE_CLIENT_ID: "", VITE_APPINSIGHTS_CONNECTION_STRING: "", MODE: "test" })}`,
      `--define:__VIDAI_BUILD__=${JSON.stringify("build-a")}`,
      "--log-level=error",
    ],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] }
  );
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head>
<body><div id="app"><input id="field" type="text"><button id="btn">button</button></div><script src="harness.js"></script></body></html>`
  );
  fs.copyFileSync(path.join(ROOT, "src/style.css"), path.join(dir, "style.css"));
}

// The deploy switch: what /version.json answers.
const live = { body: JSON.stringify({ build: "build-a" }), status: 200, loads: 0 };

function serve() {
  const server = http.createServer((req, res) => {
    const name = req.url.split("?")[0];
    if (name === "/version.json") {
      res.writeHead(live.status, { "content-type": "application/json", "cache-control": "no-store" });
      res.end(live.body);
      return;
    }
    if (name === "/") live.loads += 1;
    const file = path.join(dir, name === "/" ? "index.html" : path.basename(name));
    if (!fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    const type = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" }[path.extname(file)] || "text/plain";
    res.writeHead(200, { "content-type": type });
    res.end(fs.readFileSync(file));
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

const deploy = (build) => (live.body = JSON.stringify({ build }));

(async () => {
  build();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];

  async function fresh() {
    const context = await browser.newContext();
    // Clarity loads only on the live hosts, so a recorder stands in for it.
    // Its calls are kept in sessionStorage, which survives the reload, so the
    // event sent the moment before it can still be read after.
    await context.addInitScript(() => {
      window.clarity = (...a) => {
        const k = "clarityCalls";
        const all = JSON.parse(sessionStorage.getItem(k) || "[]");
        all.push(a.join(":"));
        sessionStorage.setItem(k, JSON.stringify(all));
      };
    });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    deploy("build-a");
    await page.goto(BASE + "/");
    await page.waitForFunction(() => window.loaded);
    return { context, page };
  }
  const loadedAt = (page) => page.evaluate(() => window.loaded);
  // A move is a person's: a real click first, which also ends the boot's
  // restore (until then setUrl replaces rather than pushes — see dom.ts).
  const move = async (page, params, from = "#btn") => {
    await page.click(from);
    await page.evaluate((p) => window.setUrl(p), params);
  };
  // A reload happens or it does not; give it the time it would take.
  async function settle(page, marker, ms = 800) {
    await page.waitForTimeout(ms);
    await page.waitForFunction(() => window.loaded).catch(() => {});
    return (await loadedAt(page)) !== marker;
  }

  // ---------- Nothing to do ----------
  {
    const { context, page } = await fresh();
    const m = await loadedAt(page);
    await page.evaluate(() => window.checkVersion());
    await move(page, { test: "t1" });
    check(!(await settle(page, m)) && !(await page.evaluate(() => window.updateArmed())), "on the live build, a move never reloads");

    // ---------- Armed, and still nothing until a move ----------
    deploy("build-b");
    await page.evaluate(() => window.checkVersion());
    check(await page.evaluate(() => window.updateArmed()), "a newer build in version.json arms the update");
    check(!(await settle(page, m, 1200)), "and arming alone never reloads the page");

    // ---------- The move ----------
    await move(page, { test: "t1", q: "q2" });
    const reloaded = await settle(page, m, 1200);
    check(reloaded, "the next move reloads");
    check((await page.evaluate(() => location.search)) === "?test=t1&q=q2", "onto the screen it moved to");
    await page.waitForSelector(".notice, .toast, [role=status]", { timeout: 3000 }).catch(() => {});
    const toast = await page.evaluate(() => document.body.innerText);
    check(/Vidai has been updated/.test(toast), "and the new page says so in one line");
    const calls = await page.evaluate(() => JSON.parse(sessionStorage.getItem("clarityCalls") || "[]"));
    const order = ["event:update_armed", "event:update_applied", "event:update_landed"].map((e) => calls.indexOf(e));
    check(order.every((i) => i >= 0) && order[0] < order[1] && order[1] < order[2], `Clarity hears the update armed, applied and landed, in that order (${calls.join(", ")})`);
    check(calls.includes("set:build:build-a"), "and every session is tagged with the build it runs");

    // ---------- A stale edge: reloaded, still not on the new build ----------
    const m2 = await loadedAt(page);
    await page.evaluate(() => window.checkVersion());
    await move(page, { test: "t1", q: "q3" });
    check(!(await settle(page, m2, 1200)), "a reload that did not reach the new build is not repeated (no loop)");
    await context.close();
  }

  // ---------- The 5-minute poll arms it with nobody touching anything ----------
  {
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.clock.install();
    deploy("build-a");
    await page.goto(BASE + "/");
    await page.waitForFunction(() => window.loaded);
    await page.clock.runFor(2000);
    deploy("build-c");
    check(!(await page.evaluate(() => window.updateArmed())), "before the poll, the tab does not know");
    await page.clock.runFor(5 * 60_000 + 1000);
    await page.waitForFunction(() => window.updateArmed(), null, { timeout: 3000 }).catch(() => {});
    check(await page.evaluate(() => window.updateArmed()), "the five-minute poll arms the update by itself");
    await context.close();
  }

  // ---------- Each guard refuses, and the next move after it succeeds ----------
  async function guarded(name, arm, disarm, from) {
    const { context, page } = await fresh();
    deploy("build-d" + name.length);
    await page.evaluate(() => window.checkVersion());
    const m = await loadedAt(page);
    await arm(page);
    await move(page, { view: "a" }, from);
    const refused = !(await settle(page, m));
    await disarm(page);
    await move(page, { view: "b" });
    const taken = await settle(page, m, 1200);
    check(refused && taken, `${name}: refused while it holds, taken at the next move after`);
    await context.close();
  }
  await guarded(
    "an open dialog",
    (p) => p.evaluate(() => document.body.classList.add("modal-open")),
    (p) => p.evaluate(() => document.body.classList.remove("modal-open"))
  );
  await guarded(
    "a focused text field",
    async () => {},
    async () => {},
    // Typing in a field: the click that starts the move lands in the field,
    // so it has focus when the move is made. The next move starts from a
    // button, which takes the focus away.
    "#field"
  );
  await guarded(
    "a screen holding unsaved work",
    (p) => p.evaluate(() => (window.hold = true)),
    (p) => p.evaluate(() => (window.hold = false))
  );

  // ---------- A write in flight is waited out, never aborted ----------
  {
    const { context, page } = await fresh();
    deploy("build-e");
    await page.evaluate(() => window.checkVersion());
    const m = await loadedAt(page);
    await page.evaluate(() => {
      window.trackWrite(new Promise((r) => setTimeout(() => ((window.writeLanded = true), r()), 1500)));
    });
    await move(page, { view: "w" });
    const early = await settle(page, m, 600);
    check(!early, "a write in flight holds the reload");
    await page.waitForFunction(() => window.loaded !== undefined, null, { timeout: 5000 });
    const later = await settle(page, m, 2000);
    check(later, "and it reloads once the write has landed");
    check((await page.evaluate(() => location.search)) === "?view=w", "onto the screen moved to");
    await context.close();
  }
  {
    const { context, page } = await fresh();
    deploy("build-f");
    await page.evaluate(() => window.checkVersion());
    const m = await loadedAt(page);
    await page.evaluate(() => {
      window.trackWrite(new Promise((r) => setTimeout(r, 1000)));
    });
    await move(page, { view: "x" });
    await page.waitForTimeout(300);
    await page.mouse.click(5, 300); // they start working again
    check(!(await settle(page, m, 1800)), "if they start working again while it waits, it stands down until the next move");
    await context.close();
  }

  // ---------- Back is a move too ----------
  {
    const { context, page } = await fresh();
    await move(page, { view: "one" });
    await move(page, { view: "two" });
    deploy("build-g");
    await page.evaluate(() => window.checkVersion());
    const m = await loadedAt(page);
    await page.goBack();
    check(await settle(page, m, 1200), "Back is a move: it reloads too");
    check((await page.evaluate(() => location.search)) === "?view=one", "onto the screen Back went to");
    await context.close();
  }

  // ---------- A broken version file arms nothing ----------
  {
    const { context, page } = await fresh();
    live.body = "<html>not json";
    await page.evaluate(() => window.checkVersion());
    const a = await page.evaluate(() => window.updateArmed());
    live.status = 404;
    deploy("build-h");
    await page.evaluate(() => window.checkVersion());
    const b = await page.evaluate(() => window.updateArmed());
    live.status = 200;
    check(!a && !b, "garbage or a 404 from version.json arms nothing");
    await context.close();
  }

  check(errors.length === 0, `no page errors (${errors.join(" | ")})`);
  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nall passed");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
