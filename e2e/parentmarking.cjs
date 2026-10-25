// A parent marks a teacher's student only while the teacher allows it — the
// two screens that make that true, driven in a real browser with no network
// and no session. The same trade `editor-offline.cjs` makes: the screens reach
// the server only through `fetch`, which is stood in for here and records
// every call, so what was asked for and what was written can be asserted.
//
// 1. The teacher's student report carries the switch. Ticking it sends
//    `students {action:"parentMarking"}`; a refused save puts the box back.
// 2. A parent whose child's teacher allows it opens a paper as its marker:
//    the marks row, Assess with AI, and Release — asking about that ONE child,
//    never the whole test's release list, which for a teacher's test would
//    name the child's classmates. A parent who only watches gets none of it.
//
//   node e2e/parentmarking.cjs            (SHOT_DIR=… to keep screenshots)

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
const PORT = 4511;
const SHOT_DIR = process.env.SHOT_DIR || "";

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-parentmark-"));

const HARNESS = `
import { showStudentReport } from "${path.join(ROOT, "src/screens/console.ts")}";
import { showChildResults } from "${path.join(ROOT, "src/screens/parent.ts")}";
const w = window as any;
w.showStudentReport = showStudentReport;
w.showChildResults = showChildResults;
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
<body><div id="app"><p>parent marking</p></div>
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

// One paper — a long answer handed in and waiting, and an MCQ already right —
// sat by Kid, a teacher's student. `role` decides who is signed in; the
// students POST answers with whatever `window.__saveStatus` says, so a
// refused save can be played.
const stub = (role) => `
  globalThis.__viteGlob = () => ({});
  localStorage.setItem("vidai:auth", JSON.stringify({ profile: {
    sub: "${role === "teacher" ? "t1" : "p1"}", name: "${role === "teacher" ? "Teacher" : "Parent"}",
    email: "${role}@example.com", role: "${role}" } }));
  localStorage.setItem("vidai:tour:${role}", "1");
  window.__calls = [];
  window.__saveStatus = 200;
  const test = {
    id: "tp-1", title: "Integrals", chapter: "Integrals", teacher: null, order: 1, access: "login",
    status: "published", platform: false, sample: false, audience: "class", assignedCount: 0,
    ownerSub: "t1", questionCount: 2, totalMarks: 6, subjectId: "s1",
    questions: [
      { id: "q0", chapter: "Integrals", topic: "By parts", type: "long", q: "Integrate x e^x.", solution: "By parts.", marks: 5 },
      { id: "q1", chapter: "Integrals", topic: "Basics", type: "mcq", q: "Pick one", options: ["a", "b"], answer: 0, solution: "a", marks: 1 },
    ],
  };
  const answers = {
    q0: { given: null, correct: false, earned: 0, review: "pending", images: [] },
    q1: { given: 0, correct: true, earned: 1 },
  };
  const graded = [{
    studentId: "stu~kid", username: "kid", studentName: "Kid", testId: "tp-1", testTitle: "Integrals",
    questionId: "q0", questionIndex: 0, maxMarks: 5, images: [], lowQuality: {},
    answerText: "x e^x - e^x + C", status: "submitted", submittedAt: "2026-10-20T10:00:00.000Z",
    awarded: null, comment: "", markedAt: "", markedBy: "",
    aiAwarded: null, aiComment: "", aiReasoning: "", aiAt: "", aiModel: "",
  }];
  window.fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : null;
    const u = new URL(String(url), location.origin);
    window.__calls.push({ url: String(url), method, body });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
    if (u.pathname === "/api/reports") {
      return reply(200, { students: [{ username: "kid", name: "Kid", school: "", grade: "12", parentPhone: "",
        email: "", via: "login", parentMarks: false,
        attempts: [{ testId: "tp-1", score: 1, total: 6, completedAt: "2026-10-20T10:00:00.000Z", status: "done" }] }] });
    }
    if (method === "POST" && u.pathname === "/api/students") {
      return window.__saveStatus < 400
        ? reply(200, { ok: true, username: body.username, parentMarks: body.on })
        : reply(window.__saveStatus, { error: "Not your student" });
    }
    if (method === "GET" && u.pathname === "/api/tests") {
      if (u.searchParams.get("id")) return reply(200, { test });
      return reply(200, { tests: [test], needsSamples: false });
    }
    if (method === "GET" && u.pathname === "/api/attempts") {
      if (u.searchParams.get("testId")) {
        return reply(200, { attempt: { testId: "tp-1", score: 1, total: 6, completedAt: "2026-10-20T10:00:00.000Z", answers }, progress: null });
      }
      return reply(200, { attempts: [{ testId: "tp-1", score: 1, total: 6, completedAt: "2026-10-20T10:00:00.000Z", status: "done" }] });
    }
    if (method === "GET" && u.pathname === "/api/grading") return reply(200, { answers: graded });
    if (u.pathname === "/api/aiusage") return reply(200, { used: 4, granted: 100, left: 96, low: false, lifetime: true, on: true });
    if (method === "GET" && u.pathname === "/api/release") {
      if (u.searchParams.get("student")) return reply(200, { released: false });
      return reply(200, { testId: "tp-1", classWide: null, students: [{ username: "classmate", releasedAt: "", releasedBy: "" }] });
    }
    if (method === "POST" && u.pathname === "/api/release") return reply(200, { ok: true, released: body.action === "release" });
    return reply(404, { error: "not stubbed: " + method + " " + u.pathname });
  };
`;

async function noSideways(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}
async function shot(page, name) {
  if (!SHOT_DIR) return;
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({ path: path.join(SHOT_DIR, `${name}.png`), fullPage: true });
}
const calls = (page) => page.evaluate(() => window.__calls);

async function teacherReport(page, label) {
  await page.evaluate(() => window.showStudentReport("kid"));
  await page.waitForSelector("#rep-parent-marks", { timeout: 10000 });
  check(!(await page.isChecked("#rep-parent-marks")), `${label}: the switch is off when the server says off`);
  check(await noSideways(page), `${label}: the report with the switch fits the window`);
  const box = await page.$eval(".rep-parent", (el) => el.getBoundingClientRect().height);
  check(box >= 44, `${label}: the switch row is a 44px target (${Math.round(box)}px)`);
  await shot(page, `report-${label}`);

  await page.evaluate(() => { window.__calls = []; });
  await page.click(".rep-parent");
  await page.waitForFunction(() => window.__calls.some((c) => c.url.includes("/api/students")));
  const sent = (await calls(page)).find((c) => c.url.includes("/api/students"));
  check(
    sent && sent.method === "POST" && sent.body.action === "parentMarking" && sent.body.username === "kid" && sent.body.on === true,
    `${label}: ticking it saves parentMarking on for this student`
  );
  await page.waitForFunction(() => !document.getElementById("rep-parent-marks").disabled);
  check(await page.isChecked("#rep-parent-marks"), `${label}: and the box stays ticked once saved`);

  // A refused save must not leave the box claiming a state the server lacks.
  await page.evaluate(() => { window.__saveStatus = 403; });
  await page.click(".rep-parent");
  await page.waitForFunction(() => !document.getElementById("rep-parent-marks").disabled);
  check(await page.isChecked("#rep-parent-marks"), `${label}: a refused save puts the box back`);
  await page.evaluate(() => { window.__saveStatus = 200; });
}

const kid = (canMark) => ({ username: "kid", name: "Kid", teacherSub: "t1", linkedAt: "", own: false, canMark });

async function parentMarker(page, label) {
  await page.evaluate((c) => window.showChildResults(c), kid(true));
  await page.waitForSelector(".pa-mark", { timeout: 10000 });
  check(/Mark 1/.test(await page.textContent(".pa-mark")), `${label}: a parent allowed to mark gets Mark 1 & release`);
  check(/96/.test((await page.textContent("#pa-credits")) || ""), `${label}: and sees their own credits beside it`);
  check(await noSideways(page), `${label}: the child's results fit the window`);
  await shot(page, `child-${label}`);

  await page.evaluate(() => { window.__calls = []; });
  await page.click(".test-card[data-test='tp-1']");
  await page.waitForSelector("#mk-release", { timeout: 10000 });
  await page.waitForFunction(() => !document.getElementById("mk-release").disabled);
  check(true, `${label}: the card opens the paper as its marker, with Release`);
  check((await page.$("#mk-buttons")) !== null, `${label}: with the marks row under the answer to mark`);
  check((await page.$("#mk-assess")) !== null, `${label}: and Assess with AI`);
  const got = await calls(page);
  const testRead = got.find((c) => c.url.startsWith("/api/tests?") && c.url.includes("id=tp-1"));
  check(testRead && testRead.url.includes("forStudent=kid"), `${label}: the paper is read as its marker (${testRead && testRead.url})`);
  const releaseReads = got.filter((c) => c.method === "GET" && c.url.startsWith("/api/release"));
  check(
    releaseReads.length > 0 && releaseReads.every((c) => c.url.includes("student=kid")),
    `${label}: Release asks about this one child, never the whole test's list`
  );
  check(/Release to this student/.test(await page.textContent("#mk-release")), `${label}: and offers to release it`);
  await shot(page, `paper-${label}`);

  await page.evaluate(() => { window.__calls = []; });
  await page.click("#mk-release");
  await page.waitForFunction(() => window.__calls.some((c) => c.method === "POST" && c.url.includes("/api/release")));
  const posted = (await calls(page)).find((c) => c.method === "POST" && c.url.includes("/api/release"));
  check(posted && posted.body.action === "release" && posted.body.username === "kid", `${label}: pressing it releases the paper to the child`);
  check(await noSideways(page), `${label}: the marking paper fits the window`);
}

async function parentWatcher(page, label) {
  await page.evaluate((c) => window.showChildResults(c), kid(false));
  await page.waitForSelector(".test-card[data-test='tp-1']", { timeout: 10000 });
  check((await page.$(".pa-mark")) === null, `${label}: a parent who only watches gets no Mark button`);
  check(((await page.textContent("#pa-credits")) || "").trim() === "", `${label}: and no credits line`);
  const got = await calls(page);
  check(!got.some((c) => c.url.startsWith("/api/grading")), `${label}: and the marking rows are never asked for`);
}

(async () => {
  build();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];
  const sizes = [
    ["desktop", { viewport: { width: 1280, height: 800 } }],
    ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ];
  for (const [label, opts] of sizes) {
    const t = await browser.newPage(opts);
    t.on("pageerror", (e) => errors.push(e.message));
    await t.addInitScript(stub("teacher"));
    await t.goto(`http://localhost:${PORT}/`);
    await teacherReport(t, label);
    await t.close();

    const p = await browser.newPage(opts);
    p.on("pageerror", (e) => errors.push(e.message));
    await p.addInitScript(stub("parent"));
    await p.goto(`http://localhost:${PORT}/`);
    await parentWatcher(p, label);
    await parentMarker(p, label);
    await p.close();
  }
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
