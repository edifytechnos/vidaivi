// The result/marking paper on a phone: what the fixed bottom bar covers, and
// what happens to the page when the question list is open.
//
// Both were reported from a real phone and neither needs a session to
// reproduce — they are the shell's own layout (`.ed-cols` stacked under
// `.shell-scroll`) and the real `bindTreeDrawer` from `src/shell.ts`. So this
// builds that markup against the real stylesheet rather than signing in,
// which also means it runs with no network and writes no row anywhere.
//
//   node e2e/paperlayout.cjs

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
  console.log(`${pass ? "PASS " : "FAIL "} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-paper-"));

// The shape `showReview` paints: the shell with `scroll: "page"`, a crumb row
// carrying the drawer toggle, then tree / centre / explain and the scrim.
const HARNESS = `
import { bindTreeDrawer, drawerToggleMarkup } from ${JSON.stringify(path.join(ROOT, "src/shell"))};
const q = (n) => \`<div class="ed-tree-row"><button class="ed-tree-q" data-i="\${n}">
  <span class="rv-dot rv-done">✓</span><span class="ed-tree-name">\${n + 1}. Topic</span>
  <span class="ed-tree-marks">1/1</span></button></div>\`;
const para = (n) => "<p>" + "Worked solution line ".repeat(6) + n + "</p>";
document.getElementById("app").innerHTML = \`
  <div class="shell shell-scroll">
    <header class="shellbar"><span class="shellbar-brand">V</span>
      <span class="shellbar-title">Polynomials</span></header>
    <div class="shell-body">
      <nav class="rail"></nav>
      <main class="shell-main shell-main-full">
        <div class="editor ed-readonly ed-paper">
          <div class="ed-crumbrow">\${drawerToggleMarkup("Questions")}<span class="ed-spacer"></span>
            <button class="btn btn-ghost">Release</button></div>
          <div class="ed-cols">
            <aside class="ed-tree" id="rv-tree"><div class="ed-tree-head">
              <span class="ed-tree-title">Answers</span></div>
              <div class="ed-tree-body">\${Array.from({ length: 15 }, (_, i) => q(i)).join("")}</div>
            </aside>
            <div class="ed-center"><section class="ed-panel"><div class="question-text">
              \${para("in the answer")}</div></section>
              <div class="st-navrow"><button class="btn btn-ghost st-step" id="rv-prev">‹ Previous</button>
                <span class="ed-spacer"></span><span class="st-count">7 of 15</span>
                <button class="btn btn-ghost st-step" id="rv-next">Next ›</button></div>
            </div>
            <aside class="ed-explain"><section class="ed-panel">
              \${[1, 2, 3, 4, 5, 6].map(para).join("")}</section></aside>
            <div class="ed-scrim"></div>
          </div>
        </div>
      </main>
    </div>
  </div>\`;
document.getElementById("app").className = "has-shell shell-full";
bindTreeDrawer(document.querySelector(".editor"));
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
  fs.copyFileSync(path.join(ROOT, "src/style.css"), path.join(dir, "style.css"));
  fs.writeFileSync(
    path.join(dir, "index.html"),
    `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="stylesheet" href="style.css"></head>
<body><div id="app"></div><script src="harness.js"></script></body></html>`
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
  const page = await browser.newPage({
    viewport: { width: 390, height: 780 },
    hasTouch: true,
    isMobile: true,
  });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector(".ed-explain");

  // --- The bottom bar covers nothing -------------------------------------
  // The two columns stack on a phone, so the LAST of them is what the fixed
  // Previous/Next bar can hide — and it is the explanation, not the answer.
  const pads = await page.evaluate(() => ({
    center: getComputedStyle(document.querySelector(".ed-center")).paddingBottom,
    explain: getComputedStyle(document.querySelector(".ed-explain")).paddingBottom,
  }));
  check(pads.explain === "108px", `the explanation clears the bar (${pads.explain})`);
  check(
    pads.center !== "108px",
    `and the answer panel does not open a hole mid-scroll (${pads.center})`
  );

  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.waitForTimeout(150);
  const ends = await page.evaluate(() => {
    const bar = document.querySelector(".st-navrow").getBoundingClientRect();
    const last = document.querySelector(".ed-explain .ed-panel").getBoundingClientRect();
    return { barTop: bar.top, lastBottom: last.bottom, fixed: getComputedStyle(document.querySelector(".st-navrow")).position };
  });
  check(ends.fixed === "fixed", `the steps row is on the floor of the window (${ends.fixed})`);
  check(
    ends.lastBottom <= ends.barTop + 1,
    `the last line of the worked solution ends above it (${Math.round(ends.lastBottom)} vs ${Math.round(ends.barTop)})`
  );

  // --- The question list scrolls; the page behind it holds still ----------
  await page.evaluate(() => window.scrollTo(0, 220));
  const before = await page.evaluate(() => window.scrollY);
  await page.locator("[data-drawer-toggle]").click();
  await page.waitForTimeout(350);
  const open = await page.evaluate(() => ({
    open: !!document.querySelector(".editor.tree-open"),
    held: document.body.classList.contains("drawer-open"),
    top: document.body.style.top,
    contain: getComputedStyle(document.querySelector(".ed-tree")).overscrollBehaviorY,
    scrolls: (() => {
      const t = document.querySelector(".ed-tree");
      return t.scrollHeight > t.clientHeight;
    })(),
  }));
  check(open.open, "the question list opens");
  check(open.held && open.top === `-${before}px`, `the page is held where it was (${open.top})`);
  check(open.contain === "contain", `the list contains its own scroll (${open.contain})`);

  // The gesture that was scrolling the whole screen: a drag over the page
  // behind the sheet.
  await page.mouse.move(340, 500);
  await page.mouse.wheel(0, 500);
  await page.waitForTimeout(200);
  const moved = await page.evaluate(() => window.scrollY);
  check(moved === 0, `the screen behind does not move (window.scrollY ${moved} — the body is out of flow)`);

  // And the list itself still scrolls when it is longer than the sheet.
  if (open.scrolls) {
    const listMoved = await page.evaluate(async () => {
      const t = document.querySelector(".ed-tree");
      t.scrollTop = 120;
      return t.scrollTop;
    });
    check(listMoved > 0, `the list scrolls inside the sheet (scrollTop ${listMoved})`);
  }

  await page.locator(".ed-scrim").click({ position: { x: 360, y: 500 } });
  await page.waitForTimeout(350);
  const closed = await page.evaluate(() => ({
    held: document.body.classList.contains("drawer-open"),
    y: window.scrollY,
    top: document.body.style.top,
  }));
  check(!closed.held && closed.top === "", "closing lets the page go");
  check(
    Math.abs(closed.y - before) <= 2,
    `and puts it back where it was, not at the top (${closed.y} vs ${before})`
  );

  // A desktop has the tree as a column, so nothing is ever held there.
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.evaluate(() => document.querySelector("[data-drawer-toggle]").click());
  await page.waitForTimeout(200);
  check(
    !(await page.evaluate(() => document.body.classList.contains("drawer-open"))),
    "on a desktop the page is never held — the tree is a column, not a sheet"
  );

  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
