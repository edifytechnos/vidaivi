// The full-screen photo viewer, driven in a real browser.
//
// It needs no network and no session: `src/photoviewer.ts` is deliberately free
// of any "who is looking" — a photo is readable by whoever could already see
// the strip — so the whole of it can be exercised against two fake pages of
// working. That is also why one viewer serves the teacher marking, the parent
// watching and the student checking their own photo: there is nothing per-role
// in it to test three times.
//
// The harness is bundled with esbuild rather than hitting the built app,
// because reaching a real handed-in photo needs a student, an attempt and an
// upload against the live database. This proves the behaviour that was
// missing — open, zoom, pan, page, close — without writing a row anywhere.
//
//   node e2e/photoviewer.cjs

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
const PORT = 4501;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "PASS " : "FAIL "} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-pv-"));

const HARNESS = `
import { bindPhotoViewer } from ${JSON.stringify(path.join(ROOT, "src/photoviewer"))};
const host = document.getElementById("host");
const page = (n, colour) =>
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1600">' +
      '<rect width="1200" height="1600" fill="' + colour + '"/>' +
      '<text x="60" y="300" font-size="140">Page ' + n + "</text></svg>"
  );
host.innerHTML =
  '<div class="shots shots-read">' +
  [1, 2]
    .map(
      (n) =>
        '<figure class="shot" data-blob="stu~x/t/q/' + n + '.jpg">' +
        '<button type="button" class="shot-img shot-open" aria-label="Open photo ' + n + '"><img' +
        ' alt="Handed-in working, photo ' + n + '" src="' + page(n, n === 1 ? "#fef3c7" : "#dbeafe") + '" /></button>' +
        "</figure>"
    )
    .join("") +
  "</div>";
bindPhotoViewer(host);
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
      // KaTeX's CSS rides in through the import graph; the fonts are not the
      // point here, they just have to not stop the bundle.
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
  fs.copyFileSync(path.join(ROOT, "src/style.css"), path.join(dir, "style.css"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="style.css"></head>
<body><div id="app"><main class="card"><div id="host"></div></main></div>
<script src="harness.js"></script></body></html>`
  );
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve() {
  const server = http.createServer((req, res) => {
    const name = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = path.join(dir, path.basename(name));
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
  // A cheap Android handset, which is what this is read on.
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const violations = [];
  page.on("pageerror", (e) => violations.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector(".shot-open");

  check((await page.locator(".pv").count()) === 0, "no viewer until a photo is opened");
  await page.locator(".shot-open").first().click();
  await page.waitForSelector(".pv");
  check(await page.locator(".pv").isVisible(), "tapping a thumbnail opens the viewer");
  check((await page.locator("#pv-count").textContent()) === "Page 1 of 2", "it says which page you are on");

  // The whole point of the change: 132px of a page of working cannot be read.
  const box = await page.locator("#pv-img").boundingBox();
  const vp = page.viewportSize();
  check(box.width > vp.width * 0.9, `the photo fills the width (${Math.round(box.width)} of ${vp.width})`);
  check(box.height > 400, `and is tall (${Math.round(box.height)}px)`);
  check(
    !(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)),
    "nothing overflows the phone"
  );

  await page.locator("#pv-in").click();
  await page.locator("#pv-in").click();
  check((await page.locator("#pv-reset").textContent()) === "196%", "zoom in reaches 196%");
  const scaled = await page.evaluate(
    () => getComputedStyle(document.getElementById("pv-img")).transform
  );
  check(/matrix\(1\.96/.test(scaled), "the image is actually scaled, not just the label");
  await page.locator("#pv-reset").click();
  check((await page.locator("#pv-reset").textContent()) === "100%", "reset goes back to fit");

  // A teacher marking a stack of papers on a laptop does it from the keyboard.
  await page.keyboard.press("+");
  check((await page.locator("#pv-reset").textContent()) === "140%", "+ zooms in");
  await page.keyboard.press("0");
  check((await page.locator("#pv-reset").textContent()) === "100%", "0 resets");
  await page.keyboard.press("r");
  const turned = await page.evaluate(
    () => getComputedStyle(document.getElementById("pv-img")).transform
  );
  check(/matrix\(0, 1, -1, 0/.test(turned), "r rotates a page photographed sideways");

  await page.keyboard.press("ArrowRight");
  check((await page.locator("#pv-count").textContent()) === "Page 2 of 2", "→ goes to the next page");
  check(await page.locator("#pv-next").isDisabled(), "and Next stops at the last one");
  await page.locator("#pv-prev").click();
  check((await page.locator("#pv-count").textContent()) === "Page 1 of 2", "Previous comes back");

  // A zoom left on would open the next page mid-magnification, somewhere in
  // the middle of a page nobody chose.
  await page.locator("#pv-in").click();
  await page.locator("#pv-next").click();
  check((await page.locator("#pv-reset").textContent()) === "100%", "a new page opens at fit, not at the last zoom");

  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  check((await page.locator(".pv").count()) === 0, "Escape closes it");
  check(
    !(await page.evaluate(() => document.body.classList.contains("modal-open"))),
    "and unlocks the page behind"
  );
  check(
    await page.evaluate(() => document.activeElement?.classList.contains("shot-open")),
    "focus returns to the thumbnail it was opened from"
  );

  // The thumbnail is a button precisely so this works.
  await page.keyboard.press("Enter");
  await page.waitForSelector(".pv");
  check(await page.locator(".pv").isVisible(), "Enter on the thumbnail opens it, keyboard only");
  await page.locator(".pv-close").click();

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator(".shot-open").first().click();
  await page.waitForSelector(".pv");
  const wide = await page.locator("#pv-img").boundingBox();
  check(wide.height > 600, `on a laptop the page is ${Math.round(wide.height)}px tall`);

  check(violations.length === 0, `no page errors (${violations.join("; ") || "none"})`);

  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
