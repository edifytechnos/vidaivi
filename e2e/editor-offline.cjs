// The authoring editor's tree is the subject the open test LIVES IN, and a
// test made from the screen is filed under the subject on screen. Driven in a
// real browser with no network and no session — the same trade
// `newsubject-offline.cjs` makes: the editor reaches the server only through
// `fetch`, which is stood in for with two subjects, a shelf and four tests,
// recording every call so what was asked for and what was written can be
// asserted exactly.
//
// What was wrong, in one teacher's screenshot: an MBBS subject's tree holding
// two CBSE Class 12 Maths tests. `showEditor` scoped the tree by the subject
// in memory, which a reload has none of and New subject's Done step never set,
// so the listing went out unscoped and the picker showed its first option as
// if the tree were in it; and the first test created from that shell was
// filed under no subject at all.
//
//   node e2e/editor-offline.cjs

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
const PORT = 4508;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-editor-"));

const HARNESS = `
import { showEditor, showEditorForSubject } from "${path.join(ROOT, "src/screens/editor/index.ts")}";
import { setSubject, currentSubject } from "${path.join(ROOT, "src/screens/home.ts")}";
const w = window as any;
w.showEditor = (id: string) => showEditor(id, null, () => {});
w.showEditorForSubject = (id: string | null) => showEditorForSubject(id, () => {});
w.setSubject = setSubject;
w.currentSubject = currentSubject;
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
      "--loader:.json=json",
      "--external:pdfjs-dist",
      "--external:pdfjs-dist/*",
      `--define:import.meta.env=${JSON.stringify({
        VITE_GOOGLE_CLIENT_ID: "",
        VITE_APPINSIGHTS_CONNECTION_STRING: "",
        MODE: "test",
      })}`,
      `--define:__VIDAI_BUILD__=${JSON.stringify("test")}`,
      "--define:import.meta.glob=__viteGlob",
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
<body><div id="app"><p>editor</p></div>
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

// A signed-in teacher with two subjects of their own — MBBS and CBSE Class 12
// Maths — beside one library shelf; one test in the MBBS subject, the two
// starter samples in the Maths one, and a draft filed under nothing. The
// listing answers scoped exactly as the server does: by `subjectId`, and
// unscoped with every test the teacher owns.
const STUB = `
  globalThis.__viteGlob = () => ({});
  localStorage.setItem("vidai:auth", JSON.stringify({ profile: { sub: "t1", name: "T", email: "t@example.com", role: "teacher" } }));
  localStorage.setItem("vidai:tour:teacher", "1");
  window.__calls = [];
  const subjects = [
    { id: "sub-mbbs", board: "MBBS", klass: "Year 1", subject: "Human Physiology", title: "MBBS Year 1 Human Physiology", ownerSub: "t1", collaborators: [], testCount: 1 },
    { id: "sub-maths", board: "CBSE", klass: "12", subject: "Maths", title: "CBSE Class 12 Maths", ownerSub: "t1", collaborators: [], testCount: 2 },
    { id: "sub-new", board: "MBBS", klass: "Year 2", subject: "Pathology", title: "MBBS Year 2 Pathology", ownerSub: "t1", collaborators: [], testCount: 0 },
    { id: "lib-c10-maths", board: "CBSE", klass: "10", subject: "Maths", title: "CBSE Class 10 Maths", platform: true, ownerSub: "~platform", collaborators: [] },
  ];
  const q = { id: "q1", chapter: "C", topic: "Cells", type: "mcq", q: "Which?", options: ["a", "b", "c", "d"], answer: 0, solution: "a", marks: 1 };
  const meta = (t) => ({ teacher: null, order: 99, access: "login", status: "draft", platform: false, sample: false, audience: "class", assignedCount: 0, ownerSub: "t1", questionCount: 1, totalMarks: 1, ...t });
  const tests = [
    meta({ id: "t-phys", title: "Human Physiology", chapter: "Cells and fluids", subjectId: "sub-mbbs" }),
    meta({ id: "t-mat", title: "Matrices — Demo Test", chapter: "Matrices", subjectId: "sub-maths", sample: true }),
    meta({ id: "t-rel", title: "Test 1 — Relations and Functions", chapter: "Relations and Functions", subjectId: "sub-maths", sample: true }),
    meta({ id: "t-orphan", title: "Untitled test", chapter: "", subjectId: "" }),
    // A starter sample seeded under a shelf's id — where every new teacher's
    // went for a month — is filed nowhere the teacher can open.
    meta({ id: "t-shelved", title: "Matrices — Demo Test", chapter: "Matrices", subjectId: "lib-c10-maths", sample: true }),
  ];
  window.__tests = tests;
  window.fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : null;
    const u = new URL(String(url), location.origin);
    window.__calls.push({ url: String(url), method, body });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
    if (method === "GET" && u.pathname === "/api/subjects") return reply(200, { subjects });
    if (method === "GET" && u.pathname === "/api/tests") {
      if (u.searchParams.get("library") === "1") return reply(200, { tests: [] });
      const id = u.searchParams.get("id");
      if (id) {
        const t = tests.find((x) => x.id === id);
        return t ? reply(200, { test: { ...t, questions: [q], assignedTo: [] } }) : reply(404, { error: "Test not found" });
      }
      const sub = u.searchParams.get("subjectId");
      return reply(200, { tests: tests.filter((t) => !sub || t.subjectId === sub), needsSamples: false });
    }
    if (method === "POST" && u.pathname === "/api/tests") {
      if (body.action === "create") {
        const made = meta({ id: "t-made", title: body.test.title, chapter: body.test.chapter || "", subjectId: body.test.subjectId || "" });
        tests.push(made);
        return reply(201, { test: made });
      }
      if (body.action === "update") {
        const t = tests.find((x) => x.id === body.test.id);
        // The server's rule: a row filed nowhere its owner can open — no
        // subject, or a shelf's id — takes the one named when that is the
        // owner's; a row already under one of their own keeps it.
        const own = (id) => subjects.some((s) => s.id === id && !s.platform);
        if (t && body.test.subjectId && !own(t.subjectId) && own(body.test.subjectId)) t.subjectId = body.test.subjectId;
        return reply(200, { test: t });
      }
      return reply(200, { ok: true });
    }
    if (method === "GET" && u.pathname === "/api/release") return reply(200, { released: false });
    if (u.pathname === "/api/aiusage") return reply(200, { credits: 100, used: 0, left: 100, low: false, on: false });
    return reply(404, { error: "not stubbed: " + method + " " + u.pathname });
  };
`;

async function treeTitles(page) {
  return page.$$eval(".ed-tree .ed-tree-test .tl-main", (els) => els.map((e) => e.textContent.trim()));
}
async function pickerValue(page) {
  return page.$eval("#ed-subject", (el) => el.value);
}
async function pickerLabel(page) {
  return page.$eval("#ed-subject", (el) => (el.selectedOptions[0] && el.selectedOptions[0].textContent.trim()) || "");
}
async function listings(page) {
  return page.evaluate(() =>
    window.__calls
      .filter((c) => c.method === "GET" && /^\/api\/tests(\?|$)/.test(c.url) && !/[?&]id=/.test(c.url) && !/library=1/.test(c.url))
      .map((c) => c.url)
  );
}
async function reset(page, subject) {
  await page.evaluate((s) => { window.__calls = []; window.setSubject(s); }, subject);
}

async function run(page, label) {
  // ---------- A reload: no subject in memory, the test says where it is ----
  await reset(page, null);
  await page.evaluate(() => window.showEditor("t-phys"));
  await page.waitForSelector(".ed-tree .ed-tree-test", { state: "attached", timeout: 20000 });
  let titles = await treeTitles(page);
  check(
    titles.length === 1 && titles[0] === "Human Physiology",
    `${label}: with no subject in memory the tree holds the test's own subject and nothing else (${titles.join(" | ")})`
  );
  check((await pickerValue(page)) === "sub-mbbs", `${label}: and the picker names that subject (${await pickerLabel(page)})`);
  let asked = await listings(page);
  check(
    asked.length === 1 && /subjectId=sub-mbbs/.test(asked[0]),
    `${label}: one listing was asked for, scoped to it — never the unscoped one (${asked.join(", ") || "none"})`
  );
  check((await page.evaluate(() => window.currentSubject())) === "sub-mbbs", `${label}: and that subject is the working one from here on`);

  // ---------- A stale subject in memory, from My tests ---------------------
  await reset(page, "sub-maths");
  await page.evaluate(() => window.showEditor("t-phys"));
  await page.waitForFunction(() => document.querySelector("#ed-subject") && document.querySelector("#ed-subject").value === "sub-mbbs", null, { timeout: 20000 });
  titles = await treeTitles(page);
  check(
    titles.length === 1 && titles[0] === "Human Physiology",
    `${label}: a stale subject in memory loses to the test's own (${titles.join(" | ")})`
  );
  asked = await listings(page);
  check(
    asked.length === 2 && /subjectId=sub-maths/.test(asked[0]) && /subjectId=sub-mbbs/.test(asked[1]),
    `${label}: the guess was asked first, then the right one — no unscoped listing (${asked.join(", ")})`
  );

  // ---------- The right subject in memory: one listing, no second ask ------
  await reset(page, "sub-maths");
  await page.evaluate(() => window.showEditor("t-mat"));
  await page.waitForSelector(".ed-tree .ed-tree-test", { state: "attached", timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".ed-tree .ed-tree-test").length === 2, null, { timeout: 20000 });
  titles = await treeTitles(page);
  check(
    titles.length === 2 && titles.every((x) => /Matrices|Relations/.test(x)),
    `${label}: the Maths subject's tree holds the two samples and nothing of the MBBS subject's (${titles.join(" | ")})`
  );
  asked = await listings(page);
  check(asked.length === 1 && /subjectId=sub-maths/.test(asked[0]), `${label}: a right guess costs one listing (${asked.join(", ")})`);

  // ---------- New subject's path: an empty subject, then its first test ----
  await reset(page, null);
  await page.evaluate(() => window.showEditorForSubject("sub-new"));
  await page.waitForSelector("#ed-empty-create", { timeout: 20000 });
  check((await page.evaluate(() => window.currentSubject())) === "sub-new", `${label}: opening a subject's shell makes it the working subject, whoever opened it`);
  check((await pickerValue(page)) === "sub-new", `${label}: and the shell's picker names it (${await pickerLabel(page)})`);
  await page.click("#ed-empty-create");
  await page.waitForFunction(() => document.querySelector("#ed-subject") && document.querySelectorAll(".ed-tree .ed-tree-test").length === 1 && !document.querySelector("#ed-empty-create"), null, { timeout: 20000 });
  const created = await page.evaluate(() => window.__calls.find((c) => c.method === "POST" && c.body && c.body.action === "create"));
  check(!!created && created.body.test.subjectId === "sub-new", `${label}: "Create the first test" files the test under THAT subject (${created && created.body.test.subjectId})`);
  titles = await treeTitles(page);
  check(titles.length === 1 && titles[0] === "Untitled test", `${label}: and the new test opens in a tree of its own subject (${titles.join(" | ")})`);
  check((await pickerValue(page)) === "sub-new", `${label}: with the picker still on it`);

  // ---------- An orphan opened inside a subject is filed there -------------
  await reset(page, "sub-mbbs");
  await page.evaluate(() => window.showEditor("t-orphan"));
  await page.waitForFunction(() => window.__calls.some((c) => c.method === "POST" && c.body && c.body.action === "update"), null, { timeout: 20000 });
  const refiled = await page.evaluate(() => window.__calls.find((c) => c.method === "POST" && c.body && c.body.action === "update"));
  check(refiled.body.test.id === "t-orphan" && refiled.body.test.subjectId === "sub-mbbs", `${label}: a draft with no subject, opened in one, is saved under it (${refiled.body.test.subjectId})`);
  await page.waitForSelector(".notice, .toast, [role=status]", { timeout: 10000 }).catch(() => {});
  const said = await page.evaluate(() => document.body.textContent || "");
  check(/Filed under MBBS Year 1 Human Physiology/.test(said), `${label}: and says so in one line`);
  titles = await treeTitles(page);
  check(
    titles.length === 2 && titles.includes("Human Physiology") && titles.includes("Untitled test"),
    `${label}: the tree is that subject's tests plus the one just filed (${titles.join(" | ")})`
  );
  check((await page.evaluate(() => window.__tests.find((t) => t.id === "t-orphan").subjectId)) === "sub-mbbs", `${label}: and the row carries the subject afterwards`);

  // ---------- A sample seeded under a shelf is healed the same way ---------
  await reset(page, "sub-maths");
  await page.evaluate(() => window.showEditor("t-shelved"));
  await page.waitForFunction(() => window.__calls.some((c) => c.method === "POST" && c.body && c.body.action === "update"), null, { timeout: 20000 });
  const healed = await page.evaluate(() => window.__calls.find((c) => c.method === "POST" && c.body && c.body.action === "update"));
  check(healed.body.test.id === "t-shelved" && healed.body.test.subjectId === "sub-maths", `${label}: a sample filed under a shelf's id, opened in the Maths subject, is saved under it (${healed.body.test.subjectId})`);
  check((await pickerValue(page)) === "sub-maths", `${label}: the picker names the subject it is now in, not the shelf (${await pickerLabel(page)})`);
  await page.waitForFunction(() => document.querySelectorAll(".ed-tree .ed-tree-test").length === 3, null, { timeout: 20000 });
  titles = await treeTitles(page);
  check(titles.filter((x) => /Matrices/.test(x)).length === 2 && titles.some((x) => /Relations/.test(x)), `${label}: the tree is the Maths subject's two tests plus it (${titles.join(" | ")})`);
  check((await page.evaluate(() => window.__tests.find((t) => t.id === "t-shelved").subjectId)) === "sub-maths", `${label}: and the row is no longer under the shelf`);
  await page.evaluate(() => { window.__tests.find((t) => t.id === "t-shelved").subjectId = "lib-c10-maths"; });

  // ---------- An orphan with nothing in memory stays put, and says so ------
  await page.evaluate(() => { window.__tests.find((t) => t.id === "t-orphan").subjectId = ""; });
  await reset(page, null);
  await page.evaluate(() => window.showEditor("t-orphan"));
  await page.waitForSelector(".ed-tree .ed-tree-test", { state: "attached", timeout: 20000 });
  await page.waitForFunction(() => document.querySelectorAll(".ed-tree .ed-tree-test").length >= 5, null, { timeout: 20000 });
  const writes = await page.evaluate(() => window.__calls.filter((c) => c.method === "POST").length);
  check(writes === 0, `${label}: with no subject to file it under, nothing is written (${writes} writes)`);
  check((await pickerValue(page)) === "" && (await pickerLabel(page)) === "All subjects", `${label}: and the picker says the tree is every subject's, not the first one listed (${await pickerLabel(page)})`);
}

(async () => {
  build();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];

  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(STUB);
  await page.goto(`http://localhost:${PORT}/`);
  await run(page, "desktop");
  await page.close();

  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.addInitScript(STUB);
  await phone.goto(`http://localhost:${PORT}/`);
  await run(phone, "phone");
  await phone.close();

  check(errors.length === 0, `no page errors (${errors.join(" | ") || "none"})`);

  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.log(`FAIL  the walk threw: ${e.message}`);
  process.exit(1);
});
