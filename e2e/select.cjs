// The app's own dropdown, driven in a real browser.
//
// No network and no session: `src/select.ts` upgrades a native <select> in
// place, so a page with three selects on it is the whole fixture. What is
// proved is the contract every caller relies on: the native control keeps
// its value and still fires `change`; the list is ours and opens, moves and
// picks by mouse and by keyboard; a disabled select stays disabled; a select
// painted AFTER boot is upgraded by the watcher; and a test's `selectOption`
// on the hidden native still lands and repaints the label.
//
//   node e2e/select.cjs

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
const PORT = 4504;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-select-"));

const HARNESS = `
import { installSelects } from "${path.join(ROOT, "src/select.ts")}";
const w = window as any;
w.changes = [];
document.addEventListener("change", (e) => w.changes.push((e.target as HTMLSelectElement).id + "=" + (e.target as HTMLSelectElement).value));
installSelects();
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
<body><div id="app" style="padding:20px">
  <label for="type">Answer expected</label>
  <select class="ed-select" id="type">
    <option value="mcq" selected>Multiple choice</option>
    <option value="numeric">Short answer</option>
    <option value="long">Long answer</option>
  </select>
  <select class="ed-input" id="access" disabled>
    <option value="login" selected>Signed-in students only</option>
    <option value="open">Anyone with the link</option>
  </select>
  <div id="late"></div>
</div>
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

  const btn = page.locator("#type-vs");
  check((await btn.count()) === 1, "a select is upgraded to a button at boot");
  check((await btn.textContent()).trim() === "Multiple choice", "the button reads the selected option");
  check((await btn.getAttribute("role")) === "combobox" && (await btn.getAttribute("aria-expanded")) === "false", "it is a closed combobox");
  check((await page.getAttribute('label[for="type-vs"]', "for")) === "type-vs", "the <label> now points at the button");
  check((await page.locator("#type").getAttribute("aria-hidden")) === "true", "the native select is hidden from assistive tech");
  const nativeBox = await page.locator("#type").boundingBox();
  check(nativeBox && nativeBox.width <= 1, "and visually gone");
  check(await page.locator(".vs-list").first().isHidden(), "the list is closed until asked for");

  // Mouse: open, see our list, pick.
  await btn.click();
  const list = page.locator("#type").locator("..").locator(".vs-list");
  check(await list.isVisible(), "clicking opens our own list, not the OS one");
  check((await list.locator(".vs-opt").count()) === 3, "with one row per option");
  check((await list.locator('[aria-selected="true"]').textContent()).includes("Multiple choice"), "the current option is marked");
  const rowBox = await list.locator(".vs-opt").first().boundingBox();
  const btnBox = await btn.boundingBox();
  check(rowBox.y > btnBox.y + btnBox.height, "the list hangs below the button");
  await list.locator(".vs-opt").nth(2).click();
  check(await list.isHidden(), "picking closes it");
  check((await page.inputValue("#type")) === "long", "the native select carries the pick");
  check((await btn.textContent()).trim() === "Long answer", "and the button repaints");
  check((await page.evaluate(() => window.changes)).join(",") === "type=long", "one change event fired on the native select");
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === "type-vs"), "focus stays on the button");

  // Keyboard: arrows move, Enter picks, Escape closes without picking.
  await btn.press("ArrowDown");
  check(await list.isVisible(), "ArrowDown opens it");
  await btn.press("ArrowUp");
  await btn.press("Enter");
  check((await page.inputValue("#type")) === "numeric", "ArrowUp then Enter picks the option above");
  await btn.press("Space");
  await btn.press("ArrowDown");
  await btn.press("Escape");
  check(await list.isHidden() && (await page.inputValue("#type")) === "numeric", "Escape closes without changing the value");
  await btn.press("Enter");
  await btn.press("m");
  await btn.press("Enter");
  check((await page.inputValue("#type")) === "mcq", "typing a letter jumps to the matching option");
  check((await page.evaluate(() => window.changes)).length === 3, "each real change fired exactly once");

  // Picking the same option again is not a change.
  await btn.click();
  await list.locator(".vs-opt").first().click();
  check((await page.evaluate(() => window.changes)).length === 3, "re-picking the current option fires nothing");

  // Disabled mirrors the native state, both ways.
  const access = page.locator("#access-vs");
  check(await access.isDisabled(), "a disabled select gives a disabled button");
  await page.evaluate(() => { document.getElementById("access").disabled = false; });
  await page.waitForTimeout(20);
  check(await access.isEnabled(), "enabling the native enables the button");
  await page.evaluate(() => { document.getElementById("access").disabled = true; });
  await page.waitForTimeout(20);
  check(await access.isDisabled(), "and disabling it again disables the button");

  // Code and tests still drive the native select.
  await page.selectOption("#type", "long");
  check((await btn.textContent()).trim() === "Long answer", "selectOption on the native repaints the button");

  // A select painted later is upgraded by the watcher.
  await page.evaluate(() => {
    document.getElementById("late").innerHTML = '<select id="later" class="numeric-input"><option value="a">Alpha</option><option value="b" selected>Beta</option></select>';
  });
  await page.waitForSelector("#later-vs");
  check((await page.locator("#later-vs").textContent()).trim() === "Beta", "a select painted after boot is upgraded too");

  // Click elsewhere closes an open list; opening one closes another.
  await btn.click();
  await page.locator("#later-vs").click();
  check(await list.isHidden() && (await page.locator("#later-vs").locator("..").locator(".vs-list").isVisible()), "opening one list closes the other");
  await page.mouse.click(900, 650);
  check((await page.locator(".vs-list:not([hidden])").count()) === 0, "a click elsewhere closes it");

  // Near the floor it opens upward.
  await page.evaluate(() => { document.getElementById("app").style.paddingTop = "620px"; });
  await btn.click();
  check(await page.evaluate(() => document.querySelector("#type").closest(".vs").classList.contains("vs-up")), "with no room below, the list opens upward");
  await btn.press("Escape");

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
