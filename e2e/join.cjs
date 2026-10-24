// Sharing a test by link, and joining one: the teacher's Share dialog, the
// student's join screen, and the per-test Results screen with its one
// release button. Driven in a real browser at 1280px and 390px with no
// network, no session and no row written — `fetch` is stood in for and
// records every call, and Google's sign-in script is answered by a stub
// that draws a button and hands back a made-up credential. The server half
// is `joinChecks()` in `e2e/helpers.cjs`.
//
//   node e2e/join.cjs
//
// What it guards: the join screen asks for Google first and the code second,
// and the code box stays shut until Google has answered; a wrong code is an
// error on the screen and never a sign-out; the right code sends the token,
// the code with its dash dropped and the credential once, lands a STUDENT
// session on this device and opens the test; a student of the same teacher
// already signed in skips the Google step; a test already joined simply
// opens; anybody signed in as somebody else is told to sign out first and
// the button does it; a switched-off link and a dead one each say so. The
// Share dialog mints on Turn on, keeps the link across off and on, remakes
// the code on New code, and puts link and code into one message. Results
// lists who took the test with a link-joined student shown by email, counts
// only handed-in papers, and Release opens the paper class-wide.

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
const PORT = 4509;
const TOKEN = "0123456789abcdef";

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-join-"));

const HARNESS = `
import { showJoin } from "${path.join(ROOT, "src/screens/join.ts")}";
import { openShareLink, shareMessage } from "${path.join(ROOT, "src/screens/share.ts")}";
import { showTestResults } from "${path.join(ROOT, "src/screens/results.ts")}";
const w = window as any;
w.showJoin = showJoin;
w.openShareLink = openShareLink;
w.shareMessage = shareMessage;
w.showTestResults = showTestResults;
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
      // A client id, so the join screen offers Google at all: without one the
      // app is guest-only and the step says sign-in is not set up.
      `--define:import.meta.env=${JSON.stringify({
        VITE_GOOGLE_CLIENT_ID: "test-client",
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
<body><div id="app"><p>join</p></div>
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

// Google's sign-in script, stood in for: `initialize` keeps the callback and
// `renderButton` draws a real button that answers it with the credential the
// test planted — so the screen's own code runs end to end, and a click on
// "Continue with Google" is a click.
const GIS = `
  window.google = { accounts: { id: {
    initialize(opts) { window.__gisCallback = opts.callback; window.__gisClient = opts.client_id; },
    renderButton(container, opts) {
      const b = document.createElement("button");
      b.id = "fake-google";
      b.type = "button";
      b.textContent = "Continue with Google";
      b.addEventListener("click", () => window.__gisCallback({ credential: window.__fakeCredential }));
      container.appendChild(b);
      window.__gisText = opts && opts.text;
    },
  } } };
`;

// A fake Google ID token: three parts, a readable payload, long enough to
// pass the shape check the server makes before verifying. Verification is
// the server's and is not exercised here.
function fakeCredential() {
  const b64 = (s) => Buffer.from(s).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
  return `${b64('{"alg":"RS256"}')}.${b64('{"sub":"g123","name":"Asha Rao","email":"asha@example.com"}')}.${"s".repeat(40)}`;
}

// The server, stood in for. The scenario the join screen meets — who is
// signed in, whether the link is on, whether the test is published — is read
// from localStorage at call time, so a walk can change it without a reload,
// and every call is kept in localStorage too, because joining ends in a
// full-page navigation that would take an in-memory log with it.
const STUB = `
  globalThis.__viteGlob = () => ({});
  localStorage.setItem("vidai:tour:teacher", "1");
  localStorage.setItem("vidai:tour:student", "1");
  window.__fakeCredential = ${JSON.stringify(fakeCredential())};
  window.__copied = [];
  Object.defineProperty(navigator, "clipboard", { value: { writeText: async (t) => { window.__copied.push(t); } }, configurable: true });
  const scenario = () => JSON.parse(localStorage.getItem("__scenario") || "{}");
  const record = (c) => {
    const all = JSON.parse(localStorage.getItem("__calls") || "[]");
    all.push(c);
    localStorage.setItem("__calls", JSON.stringify(all));
  };
  window.__share = { on: false, token: "", code: "" };
  window.__released = false;
  const T = ${JSON.stringify(TOKEN)};
  const q1 = { id: "q1", chapter: "Human Physiology", topic: "Cells", type: "mcq", q: "Which organelle?", options: ["a", "b", "c", "d"], answer: 0, solution: "a", marks: 16 };
  const q2 = { id: "q2", chapter: "Human Physiology", topic: "Fluids", type: "numeric", q: "How many litres?", answer: 5, tolerance: 0, solution: "5", marks: 16 };
  const test = { id: "t-phys", title: "Cells and fluids — Test 1", chapter: "Human Physiology", teacher: null, order: 1, access: "login", status: "published", platform: false, audience: "class", assignedCount: 0, ownerSub: "t1", subjectId: "sub-mbbs", questionCount: 2, totalMarks: 32, questions: [q1, q2], assignedTo: [] };
  window.fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    const body = init && init.body ? JSON.parse(init.body) : null;
    const u = new URL(String(url), location.origin);
    record({ url: String(url), method, body });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
    const sc = scenario();
    if (u.pathname === "/api/join") {
      const token = method === "GET" ? u.searchParams.get("token") : body.token;
      if (token !== T) return reply(404, { error: "This link is not a test link, or the test is gone" });
      if (method === "GET") {
        return reply(200, {
          title: test.title, chapter: test.chapter, teacher: "Dr Rao", questionCount: 2, totalMarks: 32,
          published: sc.published !== false, on: sc.on !== false, testId: test.id, subjectId: test.subjectId,
          student: sc.student || null, otherSession: sc.otherSession || "",
        });
      }
      if (sc.on === false) return reply(403, { error: "This test is not open for joining right now — ask your teacher for a new link." });
      if (body.credential && sc.otherSession) return reply(409, { error: "You are signed in as somebody else. Sign out first, then open the link again to join as a student.", reason: "other_session" });
      if (!body.credential && !sc.student) return reply(401, { error: "Sign in with Google to join this test", reason: "no_session" });
      if (body.code !== "ABCDEF") return reply(401, { error: "That access code is not right. Check it with your teacher and try again." });
      if (sc.full) return reply(403, { error: "This test is not taking more students right now. Ask your teacher to make room and try again.", full: true });
      return reply(200, { student: { username: "g-abc123def456", name: "Asha Rao", via: "google" }, testId: test.id, subjectId: test.subjectId, published: sc.published !== false });
    }
    if (u.pathname === "/api/signout") return reply(200, { ok: true });
    if (method === "GET" && u.pathname === "/api/tests") {
      if (u.searchParams.get("id") === "t-phys") return reply(200, { test: { ...test, share: window.__share } });
      return reply(200, { tests: [test], needsSamples: false });
    }
    if (method === "POST" && u.pathname === "/api/tests" && body.action === "share") {
      const s = window.__share;
      if (body.on && !s.token) { s.token = T; s.code = "ABCDEF"; }
      if (body.rotate) s.code = "XYZ123";
      s.on = !!body.on;
      return reply(200, { ok: true, share: { ...s } });
    }
    if (method === "GET" && u.pathname === "/api/reports") {
      if (u.searchParams.get("testId") !== "t-phys") return reply(400, { error: "unscoped report asked for" });
      return reply(200, { students: [
        { username: "g-abc123def456", name: "Asha Rao", school: "", grade: "", parentPhone: "", via: "google", email: "asha@example.com",
          attempts: [{ testId: "t-phys", score: 16, total: 32, completedAt: "2026-10-24T09:10:00Z", status: "done" }] },
        { username: "bala.k", name: "Bala K", school: "", grade: "", parentPhone: "", via: "login", email: "",
          attempts: [{ testId: "t-phys", score: 16, total: 32, completedAt: "", status: "progress", index: 1, updatedAt: "2026-10-24T09:20:00Z" }] },
        { username: "chitra.m", name: "Chitra M", school: "", grade: "", parentPhone: "", via: "login", email: "",
          attempts: [
            { testId: "t-phys", score: 32, total: 32, completedAt: "2026-10-24T09:30:00Z", status: "done" },
            { testId: "t-phys", score: 20, total: 32, completedAt: "2026-10-23T09:30:00Z", status: "done" },
          ] },
        { username: "dev.p", name: "Dev P", school: "", grade: "", parentPhone: "", via: "login", email: "", attempts: [] },
      ] });
    }
    if (method === "GET" && u.pathname === "/api/release") return reply(200, { classWide: window.__released, students: [] });
    if (method === "POST" && u.pathname === "/api/release") { window.__released = body.action === "release"; return reply(200, { ok: true }); }
    if (u.pathname === "/api/aiusage") return reply(200, { credits: 100, used: 0, left: 100, low: false, on: false });
    return reply(404, { error: "not stubbed: " + method + " " + u.pathname });
  };
`;

const TEACHER = { kind: "google", profile: { kind: "google", sub: "t1", name: "Dr Rao", email: "rao@example.com", role: "teacher" }, savedAt: 1 };
const STUDENT = { kind: "student", profile: { kind: "student", sub: "g-abc123def456", name: "Asha Rao", role: "student" }, savedAt: 1 };

async function calls(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem("__calls") || "[]"));
}
async function setScenario(page, sc, auth) {
  await page.evaluate(
    ({ sc, auth }) => {
      localStorage.setItem("__scenario", JSON.stringify(sc));
      localStorage.setItem("__calls", "[]");
      if (auth) localStorage.setItem("vidai:auth", JSON.stringify(auth));
      else localStorage.removeItem("vidai:auth");
    },
    { sc, auth: auth || null }
  );
}
async function text(page) {
  return page.evaluate(() => document.body.textContent || "");
}
async function openJoin(page, sc, auth) {
  await page.goto(`http://localhost:${PORT}/`);
  await setScenario(page, sc, auth);
  await page.evaluate((t) => window.showJoin(t), TOKEN);
}
async function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
}

async function runJoin(page, label) {
  // ---------- A dead link ----------------------------------------------------
  await page.goto(`http://localhost:${PORT}/`);
  await setScenario(page, {});
  await page.evaluate(() => window.showJoin("deadbeefdeadbeef"));
  await page.waitForSelector(".join .landing-title", { timeout: 20000 });
  check(/This link does not open a test/.test(await text(page)), `${label}: a dead link says so`);
  check((await calls(page)).every((c) => c.method === "GET"), `${label}: and nothing is written`);

  // ---------- Switched off ---------------------------------------------------
  await openJoin(page, { on: false });
  await page.waitForFunction(() => /not open for joining/.test(document.body.textContent || ""), null, { timeout: 20000 });
  check(/Cells and fluids — Test 1/.test(await text(page)), `${label}: a switched-off link still names the test`);
  check(!(await page.$("#join-code")), `${label}: and offers no code box`);

  // ---------- Signed in as somebody else ------------------------------------
  await openJoin(page, { otherSession: "google" }, TEACHER);
  await page.waitForSelector("#join-signout", { timeout: 20000 });
  check(/signed in on this device as a teacher or parent/.test(await text(page)), `${label}: a teacher opening the link is told to sign out first`);
  check(!(await page.$("#join-code")), `${label}: and gets no code box`);
  await page.click("#join-signout");
  await page.waitForLoadState("load");
  await page.waitForFunction(() => !localStorage.getItem("vidai:auth"), null, { timeout: 20000 });
  check((await calls(page)).some((c) => c.method === "POST" && c.url.endsWith("/api/signout")), `${label}: Sign out and continue ends the session on the server`);
  check(!(await page.evaluate(() => localStorage.getItem("vidai:auth"))), `${label}: and on this device`);

  // ---------- A fresh visitor: Google, then the code -------------------------
  await openJoin(page, {});
  await page.waitForSelector("#fake-google", { timeout: 20000 });
  check(/By Dr Rao · 2 questions · 32 marks/.test(await text(page)), `${label}: the link opens on the test's name, whose it is and its size`);
  check(!(await page.$(".join-note")), `${label}: a published test carries no "not open yet" note`);
  check((await page.evaluate(() => window.__gisClient)) === "test-client", `${label}: Google is initialised with the site's client id`);
  check(await page.$eval("#join-code", (el) => el.disabled), `${label}: the code box is shut until Google has answered`);
  check(await page.$eval("#join-go", (el) => el.disabled), `${label}: and so is Join`);
  check(await noOverflow(page), `${label}: the card fits the window`);
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, `join-${label}.png`), fullPage: true });

  await page.click("#fake-google");
  await page.waitForFunction(() => !document.querySelector("#join-code").disabled, null, { timeout: 20000 });
  check(/Signed in as Asha Rao\. Now the code\./.test(await text(page)), `${label}: Google's answer names who signed in and points at the code`);
  check(await page.$eval("#join-google", (el) => el.hidden), `${label}: and the Google button is put away`);
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === "join-code"), `${label}: focus moves to the code box`);
  check(await page.$eval("#join-go", (el) => el.disabled), `${label}: Join waits for a whole code`);

  await page.type("#join-code", "abc");
  check((await page.$eval("#join-code", (el) => el.value)) === "ABC", `${label}: the code is upper-cased as it is typed`);
  check(await page.$eval("#join-go", (el) => el.disabled), `${label}: three letters are not a code`);
  await page.type("#join-code", "dex");
  check((await page.$eval("#join-code", (el) => el.value)) === "ABC-DEX", `${label}: and shown as ABC-DEF`);
  check(!(await page.$eval("#join-go", (el) => el.disabled)), `${label}: six letters make Join live`);

  // A wrong code is an error on the screen — and never a sign-out, which is
  // what a 401 means everywhere else.
  await page.click("#join-go");
  await page.waitForFunction(() => { const e = document.querySelector("#join-error"); return e && !e.hidden; }, null, { timeout: 20000 });
  check(/That access code is not right/.test(await page.$eval("#join-error", (el) => el.textContent)), `${label}: a wrong code says so on the screen`);
  check(!(await page.evaluate(() => localStorage.getItem("vidai:auth"))) && !(await page.evaluate(() => localStorage.getItem("vidai:sessionExpired"))), `${label}: and ends no session`);
  check(!(await page.$eval("#join-go", (el) => el.disabled)) && (await page.$eval("#join-go", (el) => el.textContent)) === "Join and open the test", `${label}: Join is live again for another go`);
  check(/\/\?join=/.test(await page.url()), `${label}: the address still names the join screen`);

  // Enter in the code box is Join. The right code sends the token, the code
  // with its dash dropped and the credential — once — and opens the test as
  // a student of this teacher.
  await page.fill("#join-code", "");
  await page.type("#join-code", "abcdef");
  check((await page.$eval("#join-code", (el) => el.value)) === "ABC-DEF", `${label}: a cleared box takes a new code`);
  await Promise.all([page.waitForURL(/\?test=t-phys/, { timeout: 20000 }), page.press("#join-code", "Enter")]);
  const joined = (await calls(page)).filter((c) => c.method === "POST" && c.url.endsWith("/api/join"));
  check(joined.length === 2, `${label}: two joins were sent in all — the wrong code and the right one (${joined.length})`);
  const sent = joined[1] && joined[1].body;
  check(!!sent && sent.token === TOKEN && sent.code === "ABCDEF" && sent.credential === (await page.evaluate(() => window.__fakeCredential)), `${label}: the right one carried the token, the bare code and the credential`);
  const auth = await page.evaluate(() => JSON.parse(localStorage.getItem("vidai:auth") || "null"));
  check(!!auth && auth.kind === "student" && auth.profile.sub === "g-abc123def456" && auth.profile.name === "Asha Rao" && auth.profile.role === "student", `${label}: this device now holds a STUDENT session for the joined student`);
  check(/\/\?test=t-phys$/.test(await page.url()), `${label}: and the test opens (${await page.url()})`);

  // ---------- The same teacher's student, already signed in -----------------
  await openJoin(page, { student: { username: "g-abc123def456", joined: false } }, STUDENT);
  await page.waitForSelector("#join-code", { timeout: 20000 });
  check(!(await page.$("#join-google")), `${label}: a student of this teacher gets no Google step`);
  check(!(await page.$eval("#join-code", (el) => el.disabled)), `${label}: and the code box is open from the start`);
  check(!/2 · /.test(await page.$eval(".join-step-label", (el) => el.textContent)), `${label}: and the one step is not numbered 2`);
  await page.type("#join-code", "ABCDEF");
  await Promise.all([page.waitForURL(/\?test=t-phys/, { timeout: 20000 }), page.click("#join-go")]);
  const asSelf = (await calls(page)).find((c) => c.method === "POST" && c.url.endsWith("/api/join"));
  check(!!asSelf && asSelf.body.credential === "" && asSelf.body.code === "ABCDEF", `${label}: they join as themselves — the code alone, no credential`);
  const kept = await page.evaluate(() => JSON.parse(localStorage.getItem("vidai:auth") || "null"));
  check(!!kept && kept.kind === "student" && kept.profile.sub === "g-abc123def456", `${label}: and keep their session`);

  // ---------- Already joined: it simply opens --------------------------------
  await page.goto(`http://localhost:${PORT}/`);
  await setScenario(page, { student: { username: "g-abc123def456", joined: true } }, STUDENT);
  await Promise.all([page.waitForURL(/\?test=t-phys/, { timeout: 20000 }), page.evaluate((t) => window.showJoin(t), TOKEN)]);
  check((await calls(page)).every((c) => c.method === "GET"), `${label}: a test already joined opens with nothing written`);

  // ---------- Not published yet ----------------------------------------------
  await openJoin(page, { published: false });
  await page.waitForSelector(".join-note", { timeout: 20000 });
  check(/Not open yet — your teacher has not published this test/.test(await page.$eval(".join-note", (el) => el.textContent)), `${label}: an unpublished test says so and still lets the student join`);
  check(!!(await page.$("#fake-google")), `${label}: with the Google step in place`);
}

async function runShare(page, label) {
  await page.goto(`http://localhost:${PORT}/`);
  await setScenario(page, {}, TEACHER);
  await page.evaluate(() => {
    window.__share = { on: false, token: "", code: "" };
    window.__changes = [];
    window.openShareLink({ id: "t-phys", title: "Cells and fluids — Test 1" }, (s) => window.__changes.push(s));
  });
  await page.waitForSelector(".modal.share", { timeout: 20000 });
  check(await page.evaluate(() => document.body.classList.contains("modal-open")), `${label}: the dialog locks the page behind it`);
  check(/Sharing is off/.test(await page.$eval(".share-state", (el) => el.textContent)), `${label}: a test never shared opens on Sharing is off`);
  check((await page.$eval("#share-toggle", (el) => el.textContent)) === "Turn on" && (await page.$eval("#share-toggle", (el) => el.className)).includes("btn-primary"), `${label}: with Turn on as the primary`);
  check(!(await page.$("#share-link")), `${label}: and no link to copy yet`);
  check(await page.evaluate(() => document.activeElement && document.activeElement.id === "share-toggle"), `${label}: focus lands on the switch`);

  await page.click("#share-toggle");
  await page.waitForSelector("#share-link", { timeout: 20000 });
  const turnedOn = (await calls(page)).find((c) => c.method === "POST" && c.body && c.body.action === "share");
  check(!!turnedOn && turnedOn.body.id === "t-phys" && turnedOn.body.on === true && turnedOn.body.rotate === false, `${label}: Turn on asks the server to share, without remaking anything`);
  check(/Sharing is on/.test(await page.$eval(".share-state", (el) => el.textContent)), `${label}: and the dialog says so`);
  const link = await page.$eval("#share-link", (el) => el.value);
  check(link === `http://localhost:${PORT}/?join=${TOKEN}`, `${label}: the link is this site's ?join= with the token (${link})`);
  check((await page.$eval("#share-code", (el) => el.value)) === "ABC-DEF", `${label}: the code reads ABC-DEF`);
  check((await page.evaluate(() => window.__changes.length)) === 1 && (await page.evaluate(() => window.__changes[0].on)) === true, `${label}: the caller is told the new state`);
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, `share-${label}.png`), fullPage: true });
  check(await noOverflow(page), `${label}: the dialog fits the window`);

  await page.click('.share-copy[data-copy="link"]');
  await page.waitForFunction(() => window.__copied.length === 1, null, { timeout: 20000 });
  check((await page.evaluate(() => window.__copied[0])) === link, `${label}: Copy beside the link copies the link`);
  check((await page.$eval('.share-copy[data-copy="link"]', (el) => el.textContent)) === "Copied", `${label}: and the button says so for a moment`);

  await page.click("#share-rotate");
  await page.waitForFunction(() => { const c = document.querySelector("#share-code"); return c && c.value === "XYZ-123"; }, null, { timeout: 20000 });
  const rotated = (await calls(page)).filter((c) => c.method === "POST" && c.body && c.body.action === "share")[1];
  check(!!rotated && rotated.body.rotate === true && rotated.body.on === true, `${label}: New code asks for a new code and keeps sharing on`);
  check((await page.$eval("#share-link", (el) => el.value)) === link, `${label}: the link does not change with the code`);

  await page.click('.share-copy[data-copy="message"]');
  await page.waitForFunction(() => window.__copied.length === 2, null, { timeout: 20000 });
  const message = await page.evaluate(() => window.__copied[1]);
  check(message.includes(link) && message.includes("XYZ-123") && message.includes("Cells and fluids — Test 1"), `${label}: the message carries the test's name, the link and the current code`);
  check(message === (await page.evaluate(() => window.shareMessage("Cells and fluids — Test 1", { on: true, token: "0123456789abcdef", code: "XYZ123" }))), `${label}: and is the one shareMessage writes`);

  await page.click("#share-toggle");
  await page.waitForFunction(() => /Sharing is off/.test((document.querySelector(".share-state") || {}).textContent || ""), null, { timeout: 20000 });
  check(/The link and the code are kept/.test(await page.$eval(".share-switch .hint", (el) => el.textContent)), `${label}: Turn off keeps the link and the code, and says so`);
  check(!(await page.$("#share-link")), `${label}: and puts the link away while it is off`);
  const offCall = (await calls(page)).filter((c) => c.method === "POST" && c.body && c.body.action === "share")[2];
  check(!!offCall && offCall.body.on === false, `${label}: the server is told off`);

  await page.click("#share-toggle");
  await page.waitForSelector("#share-link", { timeout: 20000 });
  check((await page.$eval("#share-link", (el) => el.value)) === link && (await page.$eval("#share-code", (el) => el.value)) === "XYZ-123", `${label}: on again, the same link and the same code come back`);

  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector(".modal.share"), null, { timeout: 20000 });
  check(!(await page.evaluate(() => document.body.classList.contains("modal-open"))), `${label}: Escape closes it and unlocks the page`);
  check((await page.evaluate(() => window.__changes.length)) === 4, `${label}: every change reached the caller (${await page.evaluate(() => window.__changes.length)})`);
}

async function runResults(page, label) {
  await page.goto(`http://localhost:${PORT}/`);
  await setScenario(page, {}, TEACHER);
  await page.evaluate(() => { window.__released = false; window.showTestResults("t-phys", () => { window.__left = true; }); });
  await page.waitForSelector("#res-release", { timeout: 20000 });
  check(/\?results=t-phys/.test(await page.url()), `${label}: the screen names itself in the address bar`);
  const reports = (await calls(page)).filter((c) => c.method === "GET" && /\/api\/reports/.test(c.url));
  check(reports.length === 1 && /testId=t-phys/.test(reports[0].url) && !/username=/.test(reports[0].url), `${label}: one report listing, scoped to this test (${reports.map((c) => c.url).join(", ")})`);
  const stats = await page.$$eval(".report-stat-num", (els) => els.map((e) => e.textContent.trim()));
  check(stats.join(" ") === "3 2 75%", `${label}: three took it, two handed in, and the average is over the finished papers only (${stats.join(" ")})`);
  const names = await page.$$eval(".roster-card tbody tr .cell-strong", (els) => els.map((e) => e.firstChild.textContent.trim()));
  check(names.join(" | ") === "Asha Rao | Bala K | Chitra M", `${label}: everyone with anything on the paper is listed, and nobody without (${names.join(" | ")})`);
  const hints = await page.$$eval(".roster-card tbody tr .cell-strong .hint", (els) => els.map((e) => e.textContent.trim()));
  check(hints[0] === "asha@example.com" && hints[1] === "bala.k", `${label}: a link-joined student is shown by email, a login by username (${hints.join(" | ")})`);
  const rowText = await page.$$eval(".roster-card tbody tr", (els) => els.map((e) => e.textContent.replace(/\s+/g, " ").trim()));
  check(/In progress/.test(rowText[1]) && /See what they have so far/.test(rowText[1]) && !/\d+%/.test(rowText[1]), `${label}: a paper still being written has no score and one action`);
  check(/2 attempts/.test(rowText[2]) && /32\/32/.test(rowText[2]) && /100%/.test(rowText[2]), `${label}: a second attempt is counted and the newest is the score`);
  check(/16\/32/.test(rowText[0]) && /50%/.test(rowText[0]) && /Open & mark/.test(rowText[0]), `${label}: a finished paper shows marks, percent and Open & mark`);
  check(await noOverflow(page), `${label}: the page fits the window`);
  if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, `results-${label}.png`), fullPage: true });

  check((await page.$eval("#res-release", (el) => el.textContent)) === "Release to everyone" && (await page.$eval("#res-state", (el) => el.textContent)) === "Locked — nothing shown yet", `${label}: the paper starts locked with Release as the action`);
  await page.click("#res-release");
  await page.waitForFunction(() => (document.querySelector("#res-release") || {}).textContent === "Hide again", null, { timeout: 20000 });
  const rel = (await calls(page)).find((c) => c.method === "POST" && c.url.endsWith("/api/release"));
  check(!!rel && rel.body.action === "release" && rel.body.testId === "t-phys" && rel.body.username === undefined, `${label}: Release opens the paper class-wide — no username`);
  check((await page.$eval("#res-state", (el) => el.textContent)) === "Open to everyone who took it", `${label}: and the state says so`);
  await page.click("#res-release");
  await page.waitForFunction(() => (document.querySelector("#res-release") || {}).textContent === "Release to everyone", null, { timeout: 20000 });
  const unrel = (await calls(page)).filter((c) => c.method === "POST" && c.url.endsWith("/api/release"))[1];
  check(!!unrel && unrel.body.action === "unrelease", `${label}: Hide again takes it back`);

  await page.click("#res-back");
  check(await page.evaluate(() => window.__left === true), `${label}: Back goes where the caller said`);
}

(async () => {
  build();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];

  for (const [label, opts] of [
    ["desktop", { viewport: { width: 1280, height: 800 } }],
    ["phone", { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }],
  ]) {
    const context = await browser.newContext(opts);
    await context.route("https://accounts.google.com/gsi/client", (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript", body: GIS })
    );
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
    await page.addInitScript(STUB);
    await runJoin(page, label);
    await runShare(page, label);
    await runResults(page, label);
    await context.close();
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
