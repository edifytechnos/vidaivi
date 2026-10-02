// The app's own confirm and notice, driven in a real browser.
//
// No network and no session: `src/dialog.ts` draws a confirmation with the
// shared modal and a notice as a toast, and neither asks who is looking. What
// is proved is the contract the twenty former `confirm()`/`alert()` sites now
// rely on: a confirmation resolves true only on its primary and false on
// Cancel, ✕, Escape or the scrim; a destructive one is drawn red; focus lands
// on the answer so Enter confirms; a notice is announced, dismissable, never
// blocks the page, and goes away on its own.
//
//   node e2e/dialog.cjs

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
const PORT = 4505;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-dialog-"));

const HARNESS = `
import { confirmDialog, notice } from "${path.join(ROOT, "src/dialog.ts")}";
const w = window as any;
w.results = [];
w.ask = (opts: any) => { confirmDialog(opts).then((r) => w.results.push(r)); };
w.notice = notice;
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
      `--define:import.meta.env=${JSON.stringify({ VITE_GOOGLE_CLIENT_ID: "", VITE_APPINSIGHTS_CONNECTION_STRING: "", MODE: "test" })}`,
      "--log-level=error",
    ],
    { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] }
  );
  fs.copyFileSync(path.join(ROOT, "src/style.css"), path.join(dir, "style.css"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="style.css"></head>
<body><div id="app" style="padding:20px"><button id="trigger">Delete</button></div>
<script src="harness.js"></script></body></html>`
  );
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

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
  const page = await browser.newPage({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);

  const ask = (opts) => page.evaluate((o) => window.ask(o), opts);
  const results = () => page.evaluate(() => window.results);
  const danger = { title: "Delete this draft?", message: "It is gone for good.", confirmLabel: "Delete", danger: true };

  // --- A destructive confirmation ---
  await page.focus("#trigger");
  await ask(danger);
  await page.waitForSelector(".modal-scrim");
  check((await page.textContent("#modal-title")) === "Delete this draft?", "the question is the title");
  check((await page.textContent("#modal-desc")).includes("gone for good"), "and the consequence is the body");
  check((await page.locator(".modal-submit").textContent()).trim() === "Delete", "the primary is a verb");
  check(await page.locator(".modal-submit").evaluate((b) => b.classList.contains("btn-danger")), "and red when it cannot be undone");
  check(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains("modal-submit")), "focus lands on the answer");
  check((await page.locator(".modal-input").count()) === 0, "there is nothing to fill in");
  await page.keyboard.press("Enter");
  await page.waitForSelector(".modal-scrim", { state: "detached" });
  check(JSON.stringify(await results()) === "[true]", "Enter on the primary resolves true");
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === "trigger"), "and focus goes back where it came from");

  // --- Every other way out is "no" ---
  await ask(danger);
  await page.click('.modal-actions [data-close]');
  await page.waitForSelector(".modal-scrim", { state: "detached" });
  check(JSON.stringify(await results()) === "[true,false]", "Cancel resolves false");
  await ask(danger);
  await page.keyboard.press("Escape");
  await page.waitForSelector(".modal-scrim", { state: "detached" });
  check(JSON.stringify(await results()) === "[true,false,false]", "Escape resolves false");
  await ask(danger);
  await page.click(".modal-x");
  await page.waitForSelector(".modal-scrim", { state: "detached" });
  check(JSON.stringify(await results()) === "[true,false,false,false]", "✕ resolves false");
  await ask(danger);
  await page.mouse.click(5, 5);
  await page.waitForSelector(".modal-scrim", { state: "detached" });
  check(JSON.stringify(await results()) === "[true,false,false,false,false]", "the scrim resolves false");

  // --- An ordinary confirmation is not red, and may name its own cancel ---
  await ask({ title: "Hand in?", message: "3 questions are unanswered.", confirmLabel: "Hand in", cancelLabel: "Keep going" });
  await page.waitForSelector(".modal-scrim");
  check(!(await page.locator(".modal-submit").evaluate((b) => b.classList.contains("btn-danger"))), "a plain confirmation keeps the primary colour");
  check((await page.locator('.modal-actions [data-close]').textContent()).trim() === "Keep going", "and Cancel can say what staying means");
  await page.click(".modal-submit");
  await page.waitForSelector(".modal-scrim", { state: "detached" });
  check((await results()).length === 6 && (await results())[5] === true, "the primary resolves true");

  // --- Notices ---
  await page.evaluate(() => window.notice("Could not save", "error", 600));
  const toast = page.locator(".toast");
  check(await toast.isVisible(), "a notice appears");
  check((await page.getAttribute("#toasts", "role")) === "status" && (await page.getAttribute("#toasts", "aria-live")) === "polite", "in a live region, so it is announced");
  check(await toast.evaluate((t) => t.classList.contains("toast-error")), "an error is marked as one");
  check((await page.locator(".modal-scrim").count()) === 0, "and nothing blocks the page");
  check(await page.locator("#trigger").isEnabled(), "the page stays usable");
  await page.waitForSelector(".toast", { state: "detached", timeout: 3000 });
  check(true, "and it goes away on its own");
  await page.evaluate(() => window.notice("Stays until read", "info", 60000));
  await page.click(".toast-x");
  await page.waitForSelector(".toast", { state: "detached", timeout: 2000 });
  check(true, "✕ dismisses one early");
  await page.evaluate(() => { for (let i = 0; i < 7; i += 1) window.notice("n" + i, "info", 60000); });
  check((await page.locator(".toast").count()) === 5, "never more than five at once");

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
