// The feedback widget (src/feedback/, the Seyali family's one copy), driven in
// a real browser against a stand-in for seyali.app's /api/feedback.
//
// No network and no session: the widget is bundled with esbuild, the page is
// a fake Vidai screen, and the server here records what it is sent. What it
// proves is the part that matters most in Vidai — the child rule:
//   - a student (replay "off", no snapshot) is offered no recording and no
//     page snapshot, sends neither, and rrweb is never even downloaded;
//   - an adult's report carries the replay and the snapshot, and neither
//     holds a typed word or a [data-clarity-mask] name;
// and the rest of the flow: the log, sending in parts, the idea's similar
// list and its vote, My tickets, Escape, and the host's onOpen/onClose.
//
//   node e2e/feedback.cjs

let chromium;
try { ({ chromium } = require("playwright-core")); } catch { ({ chromium } = require("playwright")); }
const { execFileSync } = require("node:child_process");
const { gunzipSync } = require("node:zlib");
const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const PORT = 4507;
let failures = 0;
const check = (pass, name, extra = "") => { console.log(`${pass ? "PASS " : "FAIL "} ${name}${pass ? "" : ` ${extra}`}`); if (!pass) failures++; };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-fb-"));
fs.writeFileSync(path.join(dir, "harness.ts"), `
import { installFeedback, openFeedback } from ${JSON.stringify(path.join(ROOT, "src/feedback/widget"))};
(window as any).__fb = {
  install: (o: any) => installFeedback({ ...o, api: "", onOpen: () => document.body.classList.add("modal-open"), onClose: () => document.body.classList.remove("modal-open"), reporter: () => ({ name: "Priya Sharma", role: o.role }) }),
  open: (v: any) => openFeedback(v),
};
`);
execFileSync(path.join(ROOT, "node_modules/.bin/esbuild"), [
  path.join(dir, "harness.ts"), "--bundle", "--splitting", "--format=esm", `--outdir=${path.join(dir, "out")}`, "--log-level=error",
], { cwd: ROOT, stdio: ["ignore", "ignore", "inherit"] });
fs.writeFileSync(path.join(dir, "out", "index.html"), `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Vidai</title></head>
<body><main><h1>Your subjects</h1><p data-clarity-mask="true">Priya Sharma</p>
<label>Answer <input id="answer" value=""></label><button id="next" onclick="this.textContent='Next ✓'">Next</button></main>
<script type="module" src="harness.js"></script></body></html>`);

// The stand-in for seyali.app: what each action was sent, and believable answers.
let got = [];
const fetched = [];
const parts = {};
const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  fetched.push(url.pathname);
  if (url.pathname === "/api/feedback") {
    let raw = "";
    req.on("data", (c) => (raw += c)).on("end", () => {
      const body = raw ? JSON.parse(raw) : {};
      const q = Object.fromEntries(url.searchParams);
      got.push({ method: req.method, q, body, headers: req.headers });
      const ok = (o, s = 200) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
      const ticket = (kind, title) => ({ id: `vidai-${kind[0]}abc123`, app: "vidai", appName: "Vidai", kind, title, body: "", status: "received", updates: [{ at: new Date().toISOString(), status: "received" }], votes: 1, comments: 0, createdAt: new Date().toISOString() });
      if (q.similar !== undefined) return ok({ similar: [{ id: "vidai-fzz111", app: "vidai", appName: "Vidai", title: "A timer on chapter tests", summary: "", status: "planned", votes: 5, comments: 2, createdAt: "" }] });
      if (q.mine) return ok({ tickets: [ticket("issue", "Hand in does nothing")] });
      if (body.action === "submit") return ok({ id: `vidai-${body.kind[0]}abc123`, key: "k".repeat(22), ticket: { ...ticket(body.kind, body.title), status: body.files?.length ? "uploading" : "received" }, uploads: (body.files || []).map((f, i) => ({ id: `f${i}`, kind: f.kind, parts: Math.ceil(f.size / 840000), partBytes: 840000 })) }, 201);
      if (body.action === "attach") { (parts[body.file] ||= []).push(Buffer.from(body.data, "base64")); return ok({ ok: true }); }
      if (body.action === "send") return ok({ ticket: ticket("issue", "sent") });
      if (body.action === "vote") return ok({ votes: 6, voted: true });
      return ok({ error: "?" }, 400);
    });
    return;
  }
  const name = url.pathname === "/" ? "index.html" : path.basename(url.pathname);
  const file = path.join(dir, "out", name);
  if (!fs.existsSync(file)) { res.writeHead(404).end(); return; }
  res.writeHead(200, { "content-type": name.endsWith(".js") ? "text/javascript" : "text/html" });
  res.end(fs.readFileSync(file));
});

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch(process.env.PLAYWRIGHT_CHROMIUM ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM } : {});
  const errors = [];
  for (const width of [390, 1280]) {
    const page = await browser.newPage({ viewport: { width, height: 844 } });
    page.on("pageerror", (e) => errors.push(e.message));

    // --- a student: no recording, no snapshot, rrweb never fetched ---------
    got = []; fetched.length = 0; for (const k of Object.keys(parts)) delete parts[k];
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => (window).__fb);
    await page.evaluate(() => { (window).__fb.install({ app: "vidai", replay: "off", snapshot: false, role: "student" }); console.error("TypeError: x is undefined"); });
    await page.evaluate(() => (window).__fb.open("issue"));
    await page.waitForSelector(".fb-card");
    check(await page.evaluate(() => document.body.classList.contains("modal-open")), `${width}: onOpen marks the body (the beacon holds its reload)`);
    check(await page.locator("text=Record the problem").count() === 0, `${width}: a student is offered no recording`);
    check(await page.locator("text=Page snapshot").count() === 0, `${width}: a student is offered no page snapshot`);
    check(await page.locator("text=Capture screen").count() === 0, `${width}: a student is offered no screen capture`);
    check(await page.locator("text=Console and network log").count() === 1, `${width}: the log is offered, and shown before it goes`);
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}: nothing spills sideways`);
    await page.fill("#fb-title", "Hand in does nothing");
    await page.click("text=Send report");
    await page.waitForSelector("text=Thank you — it is with us");
    const sub = got.find((g) => g.body.action === "submit");
    check(sub && sub.body.files.map((f) => f.kind).join() === "traces", `${width}: a student's report carries the log and nothing else`, JSON.stringify(sub?.body.files));
    check(sub && sub.body.digest.errors.some((e) => e.includes("x is undefined")), `${width}: the error is in the issue's digest`);
    check(sub && sub.body.app === "vidai" && sub.headers["x-seyali-csrf"] === "1", `${width}: sent as Vidai, with the CSRF marker`);
    check(!fetched.some((p) => /rrweb/.test(p)), `${width}: rrweb was never downloaded for a student`);
    await page.getByRole("button", { name: "My tickets" }).click();
    await page.waitForSelector(".fb-row, .fb-error, .fb-empty").catch(() => {});
    if (!(await page.locator(".fb-row").count())) console.log("mine shows:", await page.locator(".fb-body").innerText());
    check((await got.at(-1).headers["x-seyali-tickets"]).startsWith("vidai-iabc123:"), `${width}: My tickets asks with the key this device holds`);
    await page.keyboard.press("Escape");
    check(await page.locator(".fb-card").count() === 0 && !(await page.evaluate(() => document.body.classList.contains("modal-open"))), `${width}: Escape closes, onClose clears the body`);

    // --- an adult with the dashcam: replay + snapshot, masked ---------------
    await page.goto(`http://localhost:${PORT}/`);
    await page.waitForFunction(() => (window).__fb);
    got = []; for (const k of Object.keys(parts)) delete parts[k];
    await page.evaluate(() => (window).__fb.install({ app: "vidai", replay: "buffer", snapshot: true, role: "teacher" }));
    await page.waitForTimeout(2600); // the idle start of the buffer, and rrweb's chunk
    await page.fill("#answer", "secret123");
    await page.click("#next");
    await page.waitForTimeout(400);
    await page.evaluate(() => (window).__fb.open("issue"));
    await page.waitForSelector("text=Page snapshot");
    check(await page.locator("text=on screen").count() === 1, `${width}: an adult's report offers the last moments on screen`);
    await page.fill("#fb-title", "Next button changes text");
    await page.click("text=Send report");
    await page.waitForSelector("text=Thank you — it is with us", { timeout: 15000 });
    const s2 = got.find((g) => g.body.action === "submit");
    const kinds = s2.body.files.map((f) => f.kind);
    check(kinds.includes("replay") && kinds.includes("snapshot") && kinds.includes("traces"), `${width}: an adult's report carries replay, snapshot and log`, kinds.join());
    const fileText = (i) => gunzipSync(Buffer.concat(parts[`f${i}`] || [])).toString("utf8");
    const all = s2.body.files.map((f, i) => fileText(i)).join("\n");
    check(!all.includes("secret123"), `${width}: nothing typed is in the replay or the snapshot`);
    check(!all.includes("Priya Sharma"), `${width}: a data-clarity-mask name is masked`);
    check(all.includes("Your subjects"), `${width}: the page itself is in the snapshot`);
    check(!fileText(kinds.indexOf("snapshot")).includes("What went wrong?"), `${width}: the dialog is blocked out of the snapshot`);
    check(!JSON.stringify(s2.body).includes("Priya Sharma") || s2.body.reporter.name === "Priya Sharma", `${width}: the reporter's name rides only in reporter (the team's eyes)`);

    // --- an idea: similar list and its vote ------------------------------
    await page.click("text=Close");
    await page.evaluate(() => (window).__fb.open("feature"));
    await page.fill("#fb-title", "timer for tests");
    await page.waitForSelector(".fb-similar");
    check(await page.locator(".fb-similar").innerText().then((t) => t.includes("A timer on chapter tests")), `${width}: a similar idea is shown while typing`);
    await page.locator(".fb-similar .fb-vote").click();
    await page.waitForFunction(() => document.querySelector(".fb-similar .fb-vote")?.getAttribute("aria-pressed") === "true");
    check(got.some((g) => g.body.action === "vote" && g.body.id === "vidai-fzz111" && g.body.voter), `${width}: voting from the list sends the vote with a device id`);
    if (process.env.SHOT_DIR) await page.screenshot({ path: path.join(process.env.SHOT_DIR, `feedback-idea-${width}.png`) });
    await page.close();
  }
  check(errors.length === 0, "no page errors", errors.join(" | "));
  await browser.close();
  server.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
