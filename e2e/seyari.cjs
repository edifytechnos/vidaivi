// The Seyari AI panel, driven in a real browser.
//
// No network and no session: `src/screens/editor/seyari.ts` talks to the
// editor through a host object and to the server through `fetch`, and both are
// stood in for here — a host that records what it is handed, and a fetch that
// answers the balance and the model from canned JSON. What is proved is the
// panel's own contract: it opens docked on the right and as a sheet on a
// phone, a message becomes a bubble and then cards, a card is ADDED only when
// the teacher presses Add (and arrives with an id and the chapter), Discard
// drops it, Add all takes the rest, a 501 says the model is off, and the panel
// closes itself when the editor leaves the screen.
//
//   node e2e/seyari.cjs

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
const PORT = 4503;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-seyari-"));

const HARNESS = `
import { openSeyari, hideSeyari, seyariOpen, toggleSeyari } from "${path.join(ROOT, "src/screens/editor/seyari.ts")}";
const w = window as any;
w.accepted = [];
w.created = [];
w.hasTest = true;
const host = {
  context: () => ({ subject: "CBSE Class 10 Maths", title: "Unit test 1", chapter: "Real Numbers", existing: 2, hasTest: w.hasTest }),
  accept: (qs: unknown[]) => { w.accepted.push(...qs); },
  create: async (qs: unknown[], title: string, chapter: string) => { w.created.push({ qs, title, chapter }); },
};
w.openSeyari = () => openSeyari(host);
w.toggleSeyari = () => toggleSeyari(host);
w.hideSeyari = hideSeyari;
w.seyariOpen = seyariOpen;
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
      // pdf.js is reached only when a PDF is attached, which this never does.
      "--external:pdfjs-dist",
      "--external:pdfjs-dist/*",
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
<body><div id="app"><div class="editor" data-authoring="1" data-pane="question"><p>editor</p></div></div>
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

// What the stubbed server answers. Installed before the page's own script
// runs, so the panel never sees a real fetch.
const STUB = `
  window.__calls = [];
  window.__mode = "ok";
  const canned = {
    reply: "Here are two on real numbers.",
    title: "Real Numbers — test 1",
    chapter: "Real Numbers",
    credits: { used: 1, granted: 100, left: 99, low: false },
    questions: [
      { chapter: "Real Numbers", topic: "HCF", type: "mcq", marks: 1, q: "The HCF of 12 and 18 is", options: ["2", "3", "6", "36"], answer: 2, solution: "$12 = 2^2 \\\\cdot 3$, $18 = 2 \\\\cdot 3^2$, so the HCF is $6$.", source: "Seyari AI" },
      { chapter: "Real Numbers", topic: "Irrationals", type: "numeric", marks: 2, q: "Write $\\\\sqrt{2}$ to two decimal places.", answer: 1.41, tolerance: 0.01, solution: "$1.414…$" },
      { chapter: "Real Numbers", topic: "Proof", type: "long", marks: 5, q: "Prove that $\\\\sqrt{3}$ is irrational.", solution: "", needs: ["No explanation"] },
    ],
  };
  window.fetch = async (url, init) => {
    window.__calls.push({ url: String(url), body: init && init.body ? JSON.parse(init.body) : null });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
    if (String(url).startsWith("/api/aiusage")) {
      return reply(200, { used: 1, granted: 100, left: 99, low: window.__mode === "low", on: window.__mode !== "off" });
    }
    if (String(url).startsWith("/api/generate")) {
      if (window.__mode === "off") return reply(501, { error: "Seyari AI is not switched on for this site" });
      if (window.__mode === "fail") return reply(502, { error: "The model refused the request (503)" });
      return reply(200, canned);
    }
    return reply(404, {});
  };
`;

(async () => {
  build();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];

  // ---------- desktop ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(STUB);
  await page.goto(`http://localhost:${PORT}/`);

  check((await page.locator("#sy-panel").count()) === 0, "no panel until it is opened");
  await page.evaluate(() => window.openSeyari());
  await page.waitForSelector("#sy-panel:not([hidden])");
  const box = await page.locator("#sy-panel").boundingBox();
  const vp = page.viewportSize();
  check(Math.round(box.x + box.width) === vp.width, `the panel is docked to the right edge (ends at ${Math.round(box.x + box.width)} of ${vp.width})`);
  check(Math.round(box.y + box.height) === vp.height, "and runs to the bottom of the window");
  check(box.width <= 420, `and is a column, not the screen (${Math.round(box.width)}px wide)`);
  check(await page.locator(".sy-empty-mark").isVisible(), "it opens on the empty state with the mark in the middle");
  check(await page.locator("#sy-input").isVisible() && (await page.locator("#sy-send").isVisible()), "the composer is at the foot with a send button");
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === "sy-input"), "and the composer has focus");
  await page.waitForFunction(() => /99 credits left/.test(document.querySelector("#sy-credits").textContent));
  check(true, "the balance is read when the panel opens");

  // "+" opens the attach menu with the two ways in.
  await page.click("#sy-plus");
  check(await page.locator("#sy-menu").isVisible(), "+ opens the attach menu");
  check((await page.locator("#sy-pick").textContent()).includes("PDF") && (await page.locator("#sy-shoot").textContent()).includes("photo"), "offering an upload and the camera");
  await page.click("body", { position: { x: 10, y: 10 } });
  check(await page.locator("#sy-menu").isHidden(), "and a click elsewhere closes it");

  // A starter fills the composer; Enter sends.
  await page.click(".sy-starter >> nth=0");
  check((await page.inputValue("#sy-input")).length > 20, "a starter chip fills the composer");
  await page.fill("#sy-input", "Two questions on HCF please");
  await page.press("#sy-input", "Enter");
  await page.waitForSelector(".sy-card");
  const me = await page.locator(".sy-me .sy-bubble").textContent();
  check(me.includes("Two questions on HCF"), "the message becomes a bubble on the right");
  check((await page.locator(".sy-card").count()) === 3, "and the reply becomes one card per question");
  const sentBody = await page.evaluate(() => window.__calls.find((c) => c.url.startsWith("/api/generate")).body);
  check(sentBody.prompt === "Two questions on HCF please" && sentBody.images.length === 0, "the prompt went up as typed");
  check(sentBody.context.title === "Unit test 1" && sentBody.context.existing === 2, "with the test it is for");
  check((await page.locator(".sy-card >> nth=0 >> .sy-correct").count()) === 1, "an MCQ card marks the correct option");
  check((await page.locator(".sy-card >> nth=0 >> .katex").count()) > 0, "maths on a card is typeset");
  check((await page.locator(".sy-card >> nth=2 >> .sy-needs").textContent()).includes("No explanation"), "a card says what it still needs");
  check(/99 credits left/.test(await page.locator("#sy-credits").textContent()), "the balance on the reply is shown");
  check((await page.inputValue("#sy-input")) === "", "the composer is cleared");

  // Nothing is in the test until Add is pressed.
  check((await page.evaluate(() => window.accepted.length)) === 0, "nothing reaches the test on its own");
  await page.click(".sy-card >> nth=0 >> .sy-add");
  const got = await page.evaluate(() => window.accepted);
  check(got.length === 1 && got[0].q.startsWith("The HCF"), "Add hands that one question to the editor");
  check(/^unit-test-1-[a-z0-9]{6}$/.test(got[0].id), `stamped with a fresh id from the test's title (${got[0].id})`);
  check(got[0].chapter === "Real Numbers" && !("needs" in got[0]), "with its chapter and without the card's own notes");
  check((await page.locator(".sy-card >> nth=0 >> .sy-added").count()) === 1, "and the card says it was added");
  await page.click(".sy-card >> nth=1 >> .sy-drop");
  check((await page.locator(".sy-card >> nth=1 >> .sy-dropped").count()) === 1, "Discard drops a card");
  check((await page.evaluate(() => window.accepted.length)) === 1, "without touching the test");
  check((await page.locator("[data-act=add-all]").count()) === 0, "Add all is gone once fewer than two remain");

  // A follow-up carries the earlier turns as text, and Add all takes the rest.
  await page.fill("#sy-input", "Make them harder");
  await page.click("#sy-send");
  await page.waitForFunction(() => document.querySelectorAll(".sy-ai").length === 2);
  const second = await page.evaluate(() => window.__calls.filter((c) => c.url.startsWith("/api/generate"))[1].body);
  check(second.history.length === 2 && second.history[0].role === "user" && second.history[1].role === "assistant", "a follow-up sends the earlier turns");
  check(second.history[1].text.includes("The HCF of 12 and 18"), "including the questions the model wrote, so it knows which is which");
  await page.click("[data-act=add-all]");
  check((await page.evaluate(() => window.accepted.length)) === 4, "Add all hands over every pending card in that reply");

  // Hide keeps the conversation; opening again brings it back.
  await page.click("#sy-close");
  check(await page.locator("#sy-panel").isHidden(), "✕ hides the panel");
  await page.evaluate(() => window.toggleSeyari());
  check((await page.locator(".sy-card").count()) === 6, "and the conversation is still there when it is opened again");

  // An error is a bubble with Try again, and a 501 says the model is off.
  await page.evaluate(() => { window.__mode = "fail"; });
  await page.fill("#sy-input", "again");
  await page.press("#sy-input", "Enter");
  await page.waitForSelector(".sy-error");
  check((await page.locator(".sy-error").textContent()).includes("refused") && (await page.locator("[data-act=retry]").count()) === 1, "a model failure is a bubble with Try again");
  await page.evaluate(() => { window.__mode = "off"; });
  await page.click("[data-act=retry]");
  await page.waitForFunction(() => /Not switched on/.test(document.querySelector("#sy-credits").textContent));
  check(await page.locator("#sy-send").isDisabled(), "a 501 says the model is off and disables send");

  // No draft open: Add becomes Create.
  await page.evaluate(() => { window.hasTest = false; window.__mode = "ok"; });
  await page.evaluate(() => { window.hideSeyari(); window.openSeyari(); });
  await page.evaluate(() => { document.getElementById("sy-send").disabled = false; });
  await page.fill("#sy-input", "fresh");
  await page.press("#sy-input", "Enter");
  await page.waitForFunction(() => document.querySelectorAll(".sy-ai").length >= 4);
  const label = await page.locator(".sy-ai >> nth=-1 >> .sy-add >> nth=0").textContent();
  check(/Create test/.test(label), `with no draft open the card offers to create one ("${label}")`);
  await page.click(".sy-ai >> nth=-1 >> [data-act=add-all]");
  const created = await page.evaluate(() => window.created);
  check(created.length === 1 && created[0].qs.length === 3 && created[0].title === "Real Numbers — test 1", "Create all makes one test with the model's title");

  // The editor leaves the screen: the panel goes with it.
  await page.evaluate(() => { document.getElementById("app").innerHTML = "<main>subjects</main>"; });
  await page.waitForFunction(() => !document.getElementById("sy-panel"));
  check(true, "the panel closes itself when the editor leaves the screen");
  await page.evaluate(() => { document.getElementById("app").innerHTML = '<div class="editor sk-wrap"></div>'; });
  await page.evaluate(() => window.openSeyari());
  await page.evaluate(() => { document.getElementById("app").innerHTML = '<div class="editor" data-authoring="1"></div>'; });
  await page.waitForTimeout(50);
  check((await page.locator("#sy-panel").count()) === 1, "but an editor repaint, or its ghost loader, keeps it");

  // ---------- phone ----------
  const phone = await browser.newPage({ viewport: { width: 390, height: 780 }, hasTouch: true });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.addInitScript(STUB);
  await phone.goto(`http://localhost:${PORT}/`);
  await phone.evaluate(() => window.openSeyari());
  await phone.waitForSelector("#sy-panel:not([hidden])");
  const pb = await phone.locator("#sy-panel").boundingBox();
  check(Math.round(pb.width) === 390 && Math.round(pb.y + pb.height) === 780, `on a phone it is a sheet from the bottom (${Math.round(pb.width)}px wide, ends at ${Math.round(pb.y + pb.height)})`);
  check(pb.y > 60, `leaving the top of the page showing (starts at ${Math.round(pb.y)})`);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
  check(!over, "nothing overflows the window sideways");
  await phone.fill("#sy-input", "line one");
  await phone.press("#sy-input", "Enter");
  await phone.waitForTimeout(100);
  check((await phone.locator(".sy-card").count()) === 0 && (await phone.inputValue("#sy-input")).includes("\n"), "on a touch screen Enter is a new line, not send");

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
