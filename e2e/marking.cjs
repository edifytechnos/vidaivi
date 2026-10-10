// Marking a paper on a phone: a new question starts at the top, and the
// Assess with AI button can be found.
//
// Both were reported by a teacher marking on a phone. Under `.shell-scroll`
// the document is the scroller, so a teacher who had scrolled down to the
// marks row and pressed Next got the next question with the window still at
// the bottom of it. And the one button that spends a credit was a grey ghost
// button among grey ghost buttons.
//
// This bundles the real `showReview` from `src/screens/review.ts` with esbuild
// and drives it at 390px against a stubbed `fetch` — no network, no session,
// no row written anywhere.
//
//   node e2e/marking.cjs

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
  console.log(`${pass ? "PASS " : "FAIL "} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-marking-"));

// A paper long enough to scroll: every question carries a worked solution
// several screens tall, which is what put Next's landing at the bottom.
const HARNESS = `
import { showReview } from ${JSON.stringify(path.join(ROOT, "src/screens/review"))};
const long = "A worked line of the solution that goes on for a while. ".repeat(40);
const solution = [1, 2, 3, 4, 5, 6].map((n) => long + n).join("\\n\\n");
const test = {
  id: "t-mark", title: "Polynomials", chapter: "Chapter 2", teacher: null,
  questions: [
    { id: "q1", chapter: "Polynomials", topic: "Zeros", type: "numeric", q: "How many zeros has $x^2 - 1$?", answer: 2, tolerance: 0, solution, marks: 2 },
    { id: "q2", chapter: "Polynomials", topic: "Division", type: "numeric", q: "Write the remainder as a surd.", answer: "√3", solution, marks: 2 },
    { id: "q3", chapter: "Polynomials", topic: "Proof", type: "long", q: "Give the third.", solution, marks: 3 },
  ],
};
const attempt = {
  testId: "t-mark", index: 3, score: 3, completedAt: "2026-10-01T10:00:00Z",
  answers: {
    q1: { given: 2, correct: true, earned: 2 },
    q2: { given: null, text: "root three", correct: false, earned: 0, review: "pending" },
    // A long answer the teacher has marked 1 of 3: partial, not done.
    q3: { given: 1, correct: true, earned: 1, review: "marked" },
  },
};
window.openPaper = () =>
  showReview(test, attempt, { student: "priya", studentName: "Priya", marking: true });
`;

// What the stubbed server answers. q2 is the one typed answer the grader sent
// to the teacher, which is the one place Assess with AI is offered.
const STUB = `
  localStorage.setItem("vidai:auth", JSON.stringify({ profile: { kind: "google", role: "teacher", name: "Ms T", sub: "t1" } }));
  localStorage.setItem("vidai:tour:teacher", "1");
  window.__assess = "ok";
  window.__assessCalls = 0;
  const reply = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
  window.fetch = async (url) => {
    url = String(url);
    if (url.startsWith("/api/grading")) {
      return reply(200, { answers: [{
        studentId: "stu~priya", username: "priya", studentName: "Priya", testId: "t-mark", testTitle: "Polynomials",
        questionId: "q2", questionIndex: 1, maxMarks: 2, images: [], lowQuality: {}, answerText: "root three",
        status: "submitted", submittedAt: "2026-10-01T10:00:00Z", awarded: null, comment: "", markedAt: "",
      }] });
    }
    if (url.startsWith("/api/assess")) {
      window.__assessCalls += 1;
      // Long enough to see the button while it reads.
      await new Promise((r) => setTimeout(r, 400));
      if (window.__assess === "fail") return reply(502, { error: "The model did not answer" });
      return reply(200, { awarded: 2, comment: "Right.", reasoning: "Root three is the surd.", model: "stub",
        credits: { used: 1, granted: 100, left: 99, low: false } });
    }
    if (url.startsWith("/api/aiusage")) return reply(200, { used: 1, granted: 100, left: 99, low: false, on: true });
    return reply(404, {});
  };
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
      "--external:pdfjs-dist",
      "--external:pdfjs-dist/*",
      // data.ts discovers the bundled tests with Vite's import.meta.glob; the
      // harness has none to discover.
      "--define:import.meta.glob=__noGlob",
      "--banner:js=var __noGlob = () => ({});",
      `--define:import.meta.env=${JSON.stringify({
        DEV: false,
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

const toBottom = (page) => page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));
// A marker's paper does not write the address bar (it names the student's
// paper, not the teacher's place), so a move is read off the question shown.
const onQuestion = (page, text) =>
  page.waitForFunction((t) => (document.querySelector(".review-item")?.textContent || "").includes(t), text);

(async () => {
  build();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];

  const page = await browser.newPage({ viewport: { width: 390, height: 760 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(STUB);
  await page.goto(`http://localhost:${PORT}/?test=t-mark&review=q1`);
  await page.evaluate(() => window.openPaper());
  await page.waitForSelector(".review-item");

  // ---------- a new question starts at the top ----------
  const tall = await page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight);
  check(tall > 1500, `the paper is long enough to scroll (${tall}px below the fold)`);

  await toBottom(page);
  check((await scrollY(page)) > 1000, "scrolled to the bottom of question 1");
  await page.click("#rv-next");
  await onQuestion(page, "Write the remainder");
  check((await scrollY(page)) === 0, `Next lands question 2 at the top (scrollY ${await scrollY(page)})`);
  check(await page.locator(".ed-crumbrow").isVisible(), "with the crumb row in view");

  await toBottom(page);
  await page.click("#rv-prev");
  await onQuestion(page, "How many zeros");
  check((await scrollY(page)) === 0, `Previous lands at the top too (scrollY ${await scrollY(page)})`);

  // From the question list in the drawer, picked from deep in the page.
  await toBottom(page);
  await page.click("[data-drawer-toggle]");
  await page.waitForSelector(".editor.tree-open");
  await page.click('.ed-tree [data-i="2"]');
  await onQuestion(page, "Give the third");
  check(!(await page.evaluate(() => document.body.classList.contains("drawer-open"))), "picking from the list lets the page go");
  check((await scrollY(page)) === 0, `and the question picked lands at the top (scrollY ${await scrollY(page)})`);

  // ---------- the question list says full, partial and none apart ----------
  const dots = await page.evaluate(() =>
    [...document.querySelectorAll(".ed-tree [data-i] .rv-dot")].map((d) => ({
      cls: d.className,
      bg: getComputedStyle(d).backgroundColor,
    }))
  );
  check(/rv-done/.test(dots[0].cls), `full marks (2/2) are green (${dots[0].cls})`);
  check(/rv-partial/.test(dots[2].cls), `partial marks (1/3) are not green (${dots[2].cls})`);
  check(dots[2].bg !== dots[0].bg && dots[2].bg !== dots[1].bg, `and partial is its own colour (${dots[2].bg}), apart from full (${dots[0].bg}) and waiting (${dots[1].bg})`);

  if (process.env.SHOT_DIR) {
    await page.click("[data-drawer-toggle]");
    await page.waitForSelector(".editor.tree-open");
    await page.waitForTimeout(400);
    await page.locator(".ed-tree").screenshot({ path: path.join(process.env.SHOT_DIR, "tree-partial.png") });
    await page.keyboard.press("Escape");
  }

  // ---------- the Assess with AI button ----------
  await page.click('[data-drawer-toggle]');
  await page.click('.ed-tree [data-i="1"]');
  await page.waitForSelector("#mk-assess");
  const btn = page.locator("#mk-assess");
  check(await btn.isVisible(), "Assess with AI is offered on the typed answer");
  check((await btn.locator("svg.icon").count()) === 1, "it carries the AI sparkle");
  check((await btn.textContent()).trim() === "Assess with AI", "and still says what it does");
  const look = await btn.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      bg: cs.backgroundImage,
      color: cs.color,
      ring: cs.borderTopColor,
      ringWidth: cs.borderTopWidth,
      height: el.getBoundingClientRect().height,
      anim: getComputedStyle(el.querySelector(".mk-trace")).animationName,
      layers: el.querySelectorAll(".mk-trace rect").length,
      shadow: cs.boxShadow,
      width: el.getBoundingClientRect().width,
      row: el.parentElement.getBoundingClientRect().width,
    };
  });
  check(/radial-gradient/.test(look.bg) && /linear-gradient/.test(look.bg), "it is a filled violet pill with a glow at its foot");
  check(look.color === "rgb(255, 255, 255)", `with a white label (${look.color})`);
  check(parseFloat(look.ringWidth) <= 2 && /inset/.test(look.shadow), `the edge is a thin white hairline over a blue line, like a glass rim (${look.ringWidth})`);
  check(Math.round(look.height) === 44, `the button is 44px tall, which the trace's radius assumes (${look.height})`);
  check(/mk-lap/.test(look.anim) && /mk-fade/.test(look.anim), `a streak of light runs round it and fades in and out (${look.anim})`);
  check(look.layers >= 16, `its tail is built of ${look.layers} layers, so it dissolves rather than stops`);
  // With round caps a zero-LENGTH dash still draws a dot, and one per layer
  // stacked into a bright speck on the outline away from the streak.
  const zeroDash = await btn.evaluate((el) =>
    [...el.querySelectorAll(".mk-trace rect")].some((r) =>
      (r.getAttribute("stroke-dasharray") || "").split(/\s+/).some((n, i) => i % 2 === 0 && parseFloat(n) === 0)
    )
  );
  check(!zeroDash, "no layer has a zero-length dash, so no stray dot appears on the outline");
  // The streak travels: two moments a second apart put the head in two places.
  const headAt = () => page.evaluate(() => getComputedStyle(document.querySelector("#mk-assess .mk-trace")).strokeDashoffset);
  const a1 = await headAt();
  await page.waitForTimeout(700);
  check(a1 !== (await headAt()), `the streak moves (${a1} → ${await headAt()})`);
  if (process.env.SHOT_DIR) {
    await btn.scrollIntoViewIfNeeded();
    // Wider than the button, so the halo and the ring are in the picture.
    const b = await btn.boundingBox();
    const clip = { x: Math.max(0, b.x - 16), y: b.y - 16, width: b.width + 32, height: b.height + 32 };
    await page.screenshot({ path: path.join(process.env.SHOT_DIR, "assess-button.png"), clip });
    // Frames of one whole cycle, every 50ms, with the animations paused and
    // stepped by hand so each frame is exactly where it says it is. ffmpeg
    // turns them into a clip: SHOT_DIR/assess-frame-%03d.png.
    const cycle = 4200;
    for (let t = 0, f = 0; t < cycle; t += 50, f++) {
      await page.evaluate((ms) => {
        for (const a of document.querySelector("#mk-assess .mk-trace").getAnimations()) {
          a.pause();
          a.currentTime = ms;
        }
      }, t);
      await page.screenshot({ path: path.join(process.env.SHOT_DIR, `assess-frame-${String(f).padStart(3, "0")}.png`), clip });
    }
    await page.evaluate(() => {
      for (const a of document.querySelector("#mk-assess .mk-trace").getAnimations()) a.play();
    });
  }
  check(look.width < look.row, `the button is its own size, not the row's (${Math.round(look.width)} of ${Math.round(look.row)})`);

  // Pressing it: still bright, still the icon, and the place is kept — the
  // repaint that shows the AI's proposal is the same question.
  await page.evaluate(() => window.scrollTo(0, 200));
  const before = await scrollY(page);
  await btn.click();
  await page.waitForFunction(() => /Reading/.test(document.getElementById("mk-assess")?.textContent || ""));
  check((await btn.locator("svg.icon").count()) === 1, "while it reads, the sparkle stays");
  check((await btn.evaluate((el) => getComputedStyle(el).opacity)) === "1", "and the button is not faded out");
  await page.waitForSelector(".mk-ai");

  // ---------- the AI's proposal carries the same light ----------
  const card = await page.locator(".mk-ai").evaluate((el) => {
    const t = el.querySelector(".mk-trace-card");
    return t ? { anim: getComputedStyle(t).animationName, layers: t.querySelectorAll("rect").length } : null;
  });
  check(!!card && /mk-card-lap/.test(card.anim), `the AI's proposal has the light running round it (${card && card.anim})`);
  check(!!card && card.layers >= 16, "with the same soft-ended streak as the button");
  if (process.env.SHOT_DIR) {
    const c = await page.locator(".mk-ai").boundingBox();
    const clip = { x: Math.max(0, c.x - 10), y: c.y - 10, width: c.width + 20, height: c.height + 20 };
    await page.locator(".mk-ai").scrollIntoViewIfNeeded();
    const c2 = await page.locator(".mk-ai").boundingBox();
    clip.y = c2.y - 10;
    for (let t = 0, f = 0; t < 7000; t += 100, f++) {
      await page.evaluate((ms) => {
        for (const a of document.querySelector(".mk-trace-card").getAnimations()) { a.pause(); a.currentTime = ms; }
      }, t);
      await page.screenshot({ path: path.join(process.env.SHOT_DIR, `card-frame-${String(f).padStart(3, "0")}.png`), clip });
    }
    await page.evaluate(() => {
      for (const a of document.querySelector(".mk-trace-card").getAnimations()) a.play();
    });
  }
  check((await scrollY(page)) === before, `the proposal repaints in place (scrollY ${await scrollY(page)}, was ${before})`);

  // A failure puts the button back exactly as it was, icon included.
  await page.evaluate(() => (window.__assess = "fail"));
  // q2's row now carries a proposal, so reopen fresh (on question 1) for the
  // failure path, and step to the typed answer.
  await page.evaluate(() => window.openPaper());
  await onQuestion(page, "How many zeros");
  await page.click("#rv-next");
  await page.waitForSelector("#mk-assess");
  await page.click("#mk-assess");
  await page.waitForFunction(() => !document.getElementById("mk-assess").disabled);
  check((await page.locator("#mk-assess svg.icon").count()) === 1, "after a failure the sparkle is back");
  check((await page.locator("#mk-assess").textContent()).trim() === "Assess with AI", "and so is the label");

  // ---------- reduced motion ----------
  await page.emulateMedia({ reducedMotion: "reduce" });
  check(
    (await page.locator("#mk-assess .mk-trace").evaluate((el) => getComputedStyle(el).display)) === "none",
    "with reduced motion the streak is gone"
  );
  check(
    /radial-gradient/.test(await page.locator("#mk-assess").evaluate((el) => getComputedStyle(el).backgroundImage)),
    "and the button is still the violet pill"
  );

  check(errors.length === 0, `no page errors${errors.length ? `: ${errors.join(" | ")}` : ""}`);

  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
