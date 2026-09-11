// Drive the new authoring editor end to end against the real API.
const { chromium } = require("playwright-core");
const BASE = process.env.E2E_BASE || "http://127.0.0.1:4400";
const EXE = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
const SHOT = process.env.SHOT_DIR || "";
let fail = 0;
let testId = null;
let page = null;
let browser = null;
const check = (ok, label) => { console.log((ok ? "PASS  " : "FAIL  ") + label); if (!ok) fail++; };

(async () => {
  browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  page = await ctx.newPage();
  const shot = (n) => (SHOT ? page.screenshot({ path: `${SHOT}/${n}.png`, fullPage: true }) : Promise.resolve());

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.click("#admin-link");
  await page.fill("#ad-user", process.env.E2E_ADMIN_USER);
  await page.fill("#ad-pass", process.env.E2E_ADMIN_PASS);
  await page.click("#ad-submit");
  await page.waitForSelector("#sub-grid .subject-card", { timeout: 25000 });
  // My tests is admin-only now and lives in the topbar menu.
  await page.click("#top-menu-btn");
  await page.click('[data-top-nav="mytests"]');

  // Create a fresh test through the UI — the editor should open on it.
  await page.waitForSelector("#mt-new", { timeout: 25000 });
  await page.click("#mt-new");
  await page.waitForSelector(".editor", { timeout: 30000 });
  check(await page.isVisible(".ed-tree"), "Create test opens the editor with the tests tree");
  check(/edit=/.test(page.url()), "url carries the test so a refresh restores it");
  testId = new URL(page.url()).searchParams.get("edit");
  await shot("ed-overview");

  // A brand-new test starts empty — that was impossible before this slice.
  check((await page.$$(".ed-tree-q")).length === 0, "a new test starts with no questions");

  check(await page.isVisible("#ed-new-test"), "the tree's primary button creates a TEST");
  // Every test is a root node; questions hang beneath their own test.
  const nodes = await page.$$(".ed-node");
  check(nodes.length >= 3, `the tree lists every test as a root node (${nodes.length})`);
  const nested = await page.evaluate(() => {
    const open = document.querySelector(".ed-node.open");
    return !!open && !!open.querySelector(".ed-tree-questions");
  });
  check(nested, "the open test nests its questions beneath it");
  const others = await page.$$(".ed-node:not(.open) .ed-caret-btn");
  check(others.length >= 2, "other tests are collapsed root nodes with a caret");
  await page.click('.ed-insert-btn[data-at="0"]');
  await page.waitForSelector("#ed-q", { timeout: 15000 });
  check((await page.$$(".ed-tree-row[data-i]")).length === 1, "the + between rows inserts a question");
  check(await page.isVisible("#ed-solution"), "question, answer and explanation panels all show on desktop");
  const cols = await page.evaluate(() => {
    const el = document.querySelector(".ed-cols");
    return el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : 0;
  });
  check(cols === 3, `desktop lays out three columns (got ${cols})`);
  const explainRight = await page.evaluate(() => {
    const a = document.querySelector(".ed-pane-answer")?.getBoundingClientRect();
    const e = document.querySelector(".ed-explain")?.getBoundingClientRect();
    return a && e ? e.left >= a.right - 1 : false;
  });
  check(explainRight, "the explanation sits to the RIGHT of the answer panel, not below it");
  check(await page.isVisible(".ed-appbar #ed-publish-bar"), "the app bar carries Publish");
  check(await page.isVisible(".ed-appbar .ed-taxonomy"), "the app bar shows the CBSE / Mathematics 12 context");
  const fills = await page.evaluate(() => {
    const ed = document.querySelector(".editor").getBoundingClientRect();
    const tree = document.querySelector(".ed-tree").getBoundingClientRect();
    const ex = document.querySelector(".ed-explain").getBoundingClientRect();
    return {
      full: ed.width >= window.innerWidth - 1 && ed.height >= window.innerHeight - 1,
      edges: tree.left <= 1 && ex.right >= window.innerWidth - 1,
    };
  });
  check(fills.full, "the shell fills the viewport");
  check(fills.edges, "the tree and explanation reach the window edges");

  // Maths must typeset in the preview as the teacher writes.
  await page.fill("#ed-q", "Order of a $2\\times 3$ matrix?");
  await page.waitForSelector(".ed-preview .katex", { timeout: 15000 }).then(
    () => check(true, "KaTeX typesets the question preview as you write"),
    () => check(false, "KaTeX typesets the question preview as you write")
  );

  // Autosave.
  const topic = "Autosave probe " + Date.now();
  await page.fill("#ed-topic", topic);
  await page.waitForSelector(".ed-save-saving", { timeout: 8000 }).catch(() => {});
  await page.waitForSelector(".ed-save-saved", { timeout: 20000 });
  check(true, "typing autosaves and the header reports Saved");
  await shot("ed-question");

  // The edit survives a reload — proof it really reached the server.
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(".ed-tree-q", { timeout: 25000 });
  const treeText = await page.textContent(".ed-tree");
  check(treeText.includes(topic), "the autosaved topic came back after a reload");

  // Insert a second question between the first and the end, then remove it.
  await page.click('.ed-insert-btn[data-at="1"]');
  await page.waitForSelector('.ed-tree-row[data-i="1"]', { timeout: 10000 });
  check((await page.$$(".ed-tree-row[data-i]")).length === 2, "inserting at a position adds a second question");

  // Exactly one insert affordance, and only for the question under the cursor.
  // opacity is transitioned, so wait for it to settle rather than reading mid-fade.
  const shownCount = () =>
    page.evaluate(() =>
      [...document.querySelectorAll(".ed-insert")].filter((el) => Number(getComputedStyle(el).opacity) > 0.5).length
    );
  const waitForShown = async (n) => {
    try {
      await page.waitForFunction(
        (want) =>
          [...document.querySelectorAll(".ed-insert")].filter((el) => Number(getComputedStyle(el).opacity) > 0.5)
            .length === want,
        n,
        { timeout: 4000 }
      );
      return true;
    } catch {
      return false;
    }
  };

  await page.hover(".ed-tree-title");
  check(await waitForShown(0), `no insert lines when the cursor is off the questions (saw ${await shownCount()})`);

  // The + must not be painted over by a neighbouring selected row.
  await page.hover('.ed-tree-row[data-i="0"]');
  await waitForShown(1);
  const plusOnTop = await page.evaluate(() => {
    const btn = document.querySelector(".ed-insert-btn");
    if (!btn) return false;
    const r = btn.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && (hit === btn || btn.contains(hit));
  });
  check(plusOnTop, "the + stays clickable above the neighbouring row");
  await page.hover('.ed-tree-row[data-i="0"]');
  check(await waitForShown(1), `hovering a question reveals exactly one + (saw ${await shownCount()})`);
  const belowHovered = await page.evaluate(() => {
    const row = document.querySelector('.ed-tree-row[data-i="0"]').getBoundingClientRect();
    const ins = [...document.querySelectorAll(".ed-insert")].find((el) => Number(getComputedStyle(el).opacity) > 0.5);
    return ins ? ins.getBoundingClientRect().top >= row.bottom - 2 : false;
  });
  check(belowHovered, "that + sits directly below the hovered question");
  await page.hover('.ed-tree-row[data-i="1"]');
  await page.click('.ed-row-menu[data-i="1"]');
  await page.waitForSelector(".ed-row-actions", { timeout: 8000 });
  check(true, "the row menu opens from the … button");
  await page.click('.ed-row-actions button[data-act="delete"]');
  await page.waitForFunction(() => document.querySelectorAll(".ed-tree-row[data-i]").length === 1, { timeout: 10000 });
  check(true, "Delete removes that question");
  await page.waitForSelector(".ed-save-saved", { timeout: 20000 });

  // Expanding another test loads its questions into the tree.
  const otherCaret = await page.$(".ed-node:not(.open) .ed-caret-btn");
  if (otherCaret) {
    await otherCaret.click();
    await page.waitForSelector(".ed-tree-q-other", { timeout: 20000 });
    check(true, "expanding another test shows its questions in the tree");
  } else {
    check(false, "expected a collapsed test to expand");
  }

  // The question is deliberately unfinished (no explanation) — publish must refuse.
  const hollow = await page.$$(".ed-tree-q:not(:has(.ed-dot.done))");
  check(hollow.length >= 1, "an unfinished question shows a hollow dot in the tree");

  await page.click("#ed-publish-bar");
  await page.waitForSelector("#ov-publish-error:not([hidden])", { timeout: 25000 });
  const err = await page.textContent("#ov-publish-error");
  check(/finishing/.test(err), `publish is blocked: "${err.trim()}"`);
  const ovText = await page.textContent(".ed-overview");
  check(/No explanation/.test(ovText), "the overview names what is unfinished");
  check(/1 question · 1 mark\b/.test(ovText), "counts read as singular for one question");
  check(/Multiple choice/.test(ovText), "the question type reads in plain words");
  check(!/\$/.test(ovText.split("PUBLISHING")[0]), "the summary strips maths markers");
  await shot("ed-publish-blocked");

  // Finish it, and publishing should now go through.
  await page.click('.ed-tree-q[data-i="0"]');
  await page.waitForSelector("#ed-solution", { timeout: 15000 });
  await page.fill("#ed-solution", "Rows first, then columns.");
  await page.fill("#ed-marks", "1");
  await page.click("#ed-type");
  await page.selectOption("#ed-type", "long");
  await page.waitForSelector(".ed-save-saved", { timeout: 20000 });
  check(!(await page.$(".ed-option-text")), "switching to long answer drops the option fields");

  await page.click("#ed-publish-bar");
  await page.waitForSelector(".status-chip.status-done", { timeout: 25000 });
  check(true, "a finished test publishes");

  // Published tests are read-only in this slice.
  await page.click('.ed-tree-q[data-i="0"]');
  await page.waitForSelector(".ed-banner", { timeout: 15000 });
  check(await page.isDisabled("#ed-q"), "a published test opens read-only");
  const roPreview = await page.textContent(".ed-preview");
  check(roPreview.trim().length > 0 && !/preview appears here/.test(roPreview),
    "a read-only question still shows its rendered preview");
  await shot("ed-readonly");

  // Phone layout: three tabs, one surface at a time.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.click("#ed-unpublish-bar");
  await page.waitForSelector(".ed-banner", { state: "detached", timeout: 20000 });
  check(true, "unpublishing clears the read-only banner");
  check(!(await page.$(".ed-save-dirty")), "publishing does not leave the document unsaved");
  await page.waitForSelector("#ed-tree-toggle", { timeout: 20000 });
  check(await page.isVisible("#ed-tree-toggle"), "phone shows the tree toggle");
  check(!(await page.isVisible('.ed-tree-q[data-i="0"]')), "the tree is tucked away on a phone");
  await page.click("#ed-tree-toggle");
  await page.waitForSelector('.ed-tree-q[data-i="0"]:visible', { timeout: 10000 });
  await page.click('.ed-tree-q[data-i="0"]');
  await page.waitForSelector(".ed-tabs", { timeout: 15000 });
  check((await page.$$(".ed-tab")).length === 3, "phone shows three bottom tabs");
  check(await page.isVisible("#ed-q"), "the Question tab is showing");
  check(!(await page.isVisible("#ed-solution")), "the Explain panel is hidden behind its tab");
  await page.click(".ed-tab[data-pane='explain']");
  check(await page.isVisible("#ed-solution"), "tapping Explain swaps to the explanation");
  await shot("ed-mobile");

})()
  .catch((e) => {
    console.error("FAIL:", e.message);
    fail++;
  })
  .finally(async () => {
    // Always remove the test this run created, or a failed run leaks a draft.
    if (testId && page) {
      try {
        await page.evaluate(async (id) => {
          const auth = JSON.parse(localStorage.getItem("vidaivi:auth"));
          const call = (action) =>
            fetch("/api/tests", {
              method: "POST",
              headers: { "Content-Type": "application/json", "X-Vidaivi-Auth": auth.credential },
              body: JSON.stringify({ action, id }),
            });
          await call("unpublish");
          await call("delete");
        }, testId);
        console.log(`  (cleaned up ${testId})`);
      } catch (e) {
        console.log(`  (could not clean up ${testId}: ${e.message})`);
      }
    }
    try { await browser.close(); } catch {}
    console.log(fail ? `\n${fail} FAILURE(S)` : "\nALL PASS");
    process.exit(fail ? 1 : 0);
  });
