// Browser regression suite. Run against the local harness:
//
//   npm run build && node e2e/serve.js &          # (NODE_USE_ENV_PROXY=1 in sandboxes)
//   node e2e/regression.js
//
// Requires playwright-core + a Chromium binary. Set CHROMIUM_PATH if the
// default managed-environment path doesn't exist.
//
// Guest flows always run. Admin/teacher/report flows run only when
// E2E_ADMIN_USER and E2E_ADMIN_PASS are set (never hardcode credentials).
const { chromium } = require("playwright-core");

const BASE = process.env.E2E_BASE || "http://127.0.0.1:4400";
const EXE = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const ADMIN_USER = process.env.E2E_ADMIN_USER;
const ADMIN_PASS = process.env.E2E_ADMIN_PASS;
const SHOT = process.env.SHOT_DIR || "";

let failures = 0;
function check(ok, label) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) failures++;
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 } })).newPage();
  const shot = (name) => (SHOT ? page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true }) : Promise.resolve());

  // Welcome screen
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.waitForSelector("#student-btn");
  check(await page.isVisible("#guest-btn"), "welcome shows student/guest buttons");
  await shot("welcome");

  // Student login rejects bad credentials
  await page.click("#student-btn");
  await page.fill("#su-user", "nosuchuser");
  await page.fill("#su-pass", "wrongpass");
  await page.click("#su-submit");
  await page.waitForSelector("#su-error:not([hidden])", { timeout: 20000 });
  check(true, "student login shows error for bad credentials");
  await page.click("#su-back");
  await page.waitForSelector("#guest-btn");

  // Guest home: demo open, login test locked
  await page.click("#guest-btn");
  await page.waitForSelector(".test-card[data-test]");
  const cards = await page.$$(".test-card[data-test]");
  check(cards.length >= 2, `home lists ${cards.length} tests`);
  const lockedSub = await page.textContent(".test-card[data-test='relations-functions-test1'] .test-card-sub");
  check(lockedSub.includes("sign in"), "login-gated test shows sign-in hint for guests");
  await shot("home-guest");

  // Demo test: answer first (MCQ) question
  await page.click(".test-card[data-test='matrices-demo']");
  await page.waitForSelector("#primary-btn");
  await page.click("#primary-btn");
  await page.waitForSelector(".option");
  check((await page.$$(".option")).length === 4, "MCQ renders 4 options");
  // serve.cjs mirrors the KaTeX CDN through this origin, so maths must render.
  await page.waitForFunction(() => !!window.renderMathInElement, { timeout: 15000 });
  await page.click(".option");
  await page.click("#submit-btn");
  await page.waitForSelector(".solution");
  check(await page.isVisible("#next-btn"), "submit shows solution + next button");
  // Q1's text is prose, but its worked solution carries maths.
  await page.waitForSelector(".solution .katex", { timeout: 15000 });
  check(true, "KaTeX typesets the worked solution");
  await shot("demo-q1");

  // Q2 has maths in the question body itself.
  await page.click("#next-btn");
  await page.waitForSelector(".question-text");
  await page.waitForSelector(".question-text .katex", { timeout: 15000 });
  check(true, "KaTeX typesets the question body");

  // Gated test redirects guests to Google sign-in
  await page.goto(BASE + "/?test=relations-functions-test1", { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".google-btn-slot");
  check(true, "gated test shows Google sign-in gate");

  if (ADMIN_USER && ADMIN_PASS) {
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    // Sign out of any lingering session, land on welcome
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.click("#admin-link");
    await page.fill("#ad-user", ADMIN_USER);
    await page.fill("#ad-pass", ADMIN_PASS);
    await page.click("#ad-submit");
    // Every sign-in path lands on the subjects grid, admins included.
    await page.waitForSelector("#sub-grid .subject-card", { timeout: 25000 });
    check(true, "admin login lands on the subjects grid");
    await shot("subjects-admin");

    // Account-level places live in the topbar menu now, on every screen.
    await page.click("#top-menu-btn");
    await page.click('[data-top-nav="admin"]');
    await page.waitForSelector("#te-list", { timeout: 20000 });
    check(true, "the topbar menu reaches teacher access");
    await shot("admin");

    await page.click("#nav-students");
    // Wait for the loaded state, not the "Loading…" hint that renders first.
    await page.waitForSelector("#st-list .data-table, #st-list .login-error", { timeout: 20000 });
    check(await page.isVisible("#st-list .data-table"), "students roster loads");
    await shot("students");

    const report = await page.$(".roster-report");
    if (report) {
      await report.click();
      await page.waitForSelector(".report-stats", { timeout: 20000 });
      check(true, "student report shows stat tiles");
      await shot("report");
    } else {
      console.log("SKIP  report (roster is empty)");
    }

    // My tests: the DB-backed test list and its import affordance.
    await page.click("#nav-tests");
    await page.waitForSelector("#mt-list .data-table, #mt-list .hint:not(:empty)", { timeout: 20000 });
    check(await page.isVisible("#mt-open-import"), "my tests page offers test import");
    await page.click("#mt-open-import");
    await page.fill("#mt-json", "{ not json");
    await page.click("#mt-create");
    await page.waitForSelector("#mt-error:not([hidden])", { timeout: 10000 });
    check(true, "my tests rejects invalid JSON with an error");
    await shot("my-tests");

    // Subjects: a signed-in teacher lands here, and a subject card opens the
    // page where that subject's tests live.
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sub-grid .subject-card", { timeout: 20000 });
    check(true, "a signed-in teacher lands on the subjects grid");
    await shot("subjects");
    const owned = await page.$(".subject-card:not(.subject-card-builtin)");
    if (owned) {
      await owned.click();
      // A subject opens the authoring editor scoped to it, not a table.
      await page.waitForSelector(".editor .ed-tree", { timeout: 30000 });
      check(true, "clicking a subject opens the authoring editor");
      check(await page.isVisible("#ed-new-test"), "the editor's tree offers Create");
      await page.click("#ed-exit");
      await page.waitForSelector("#sub-grid .subject-card", { timeout: 20000 });
      check(true, "the editor returns to all subjects");
      // The bug that started this: ?edit= must not survive leaving the editor.
      check(!/edit=/.test(page.url()), "leaving the editor clears ?edit= from the url");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#sub-grid .subject-card", { timeout: 25000 });
      check(true, "a reload lands on subjects, not a stale editor");
    } else {
      console.log("SKIP  subject routing (no teacher-owned subject)");
    }

    // A subject with no tests opens the same shell, with an empty tree.
    // Created and removed here so the check does not depend on live data.
    const probe = `E2E${Date.now().toString().slice(-6)}`;
    await page.click("#sub-new");
    await page.fill("#sf-board", "CBSE");
    await page.fill("#sf-class", "12");
    await page.fill("#sf-subject", probe);
    await page.click("#sf-save");
    const card = `.subject-card:has(.subject-name:text-is("CBSE Class 12 ${probe}"))`;
    try {
      await page.waitForSelector(card, { timeout: 25000 });
      await page.click(card);
      await page.waitForSelector(".editor .ed-tree", { timeout: 30000 });
      check(await page.isVisible("#ed-new-test"), "an empty subject opens the editor shell");
      check((await page.$$(".ed-node")).length === 0, "the empty subject's tree has no tests");
      check(await page.isVisible("#ed-empty-create"), "the empty shell offers Create the first test");
      await page.click("#ed-exit");
      await page.waitForSelector("#sub-grid .subject-card", { timeout: 20000 });
    } finally {
      page.once("dialog", (d) => d.accept());
      const del = await page.$(`${card} .subject-del`);
      if (del) {
        await del.click();
        await page.waitForSelector(card, { state: "detached", timeout: 20000 }).catch(() => {});
      }
      console.log(`  (cleaned up subject ${probe})`);
    }
  } else {
    console.log("SKIP  admin flows (set E2E_ADMIN_USER / E2E_ADMIN_PASS to enable)");
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
