// Drive the four-step New subject flow in a real browser, desktop and phone.
//
// It needs an admin session (E2E_ADMIN_USER / E2E_ADMIN_PASS — never hardcode
// them), because a subject is something you own and a guest owns nothing.
//
// **It never presses the last button.** Every step up to "Create…" is walked
// and asserted, and then the dialog is closed — because that button writes
// real subjects to the live database, which is what `e2e/serve.cjs` proxies
// to. The one thing this cannot cover is therefore the creation itself; the
// flow's arithmetic (which subjects, which tests, what the button says it will
// do) is all asserted before it.
//
// The assertions that earn the file:
//
//   * an entrance exam asks for a YEAR, not a class. That is the whole reason
//     the redesign has a fourth board group, and it is the branch a flat
//     step-machine would silently drop.
//   * NEET is reachable at all. It was in the library and homeless in a
//     board-and-class shape — the design canvas's own note says so.
//   * picking a board group reveals its boards without leaving step 1.
//
//   node e2e/serve.cjs &   node e2e/newsubject.cjs

const { chromium } = require("playwright-core");
const BASE = process.env.E2E_BASE || "http://127.0.0.1:4400";
const EXE = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let fail = 0;
const check = (ok, label) => {
  console.log((ok ? "PASS  " : "FAIL  ") + label);
  if (!ok) fail++;
};

if (!process.env.E2E_ADMIN_USER || !process.env.E2E_ADMIN_PASS) {
  console.log("SKIP  set E2E_ADMIN_USER / E2E_ADMIN_PASS to run the New subject walk");
  process.exit(0);
}

const DLG = ".modal-scrim .ns";

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
    for (const r of ["student", "parent", "teacher", "admin"]) {
      try { localStorage.setItem(`vidai:tour:${r}`, "1"); } catch {}
    }
  });

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.click("#admin-link");
  await page.fill("#ad-user", process.env.E2E_ADMIN_USER);
  await page.fill("#ad-pass", process.env.E2E_ADMIN_PASS);
  await page.click("#ad-submit");
  await page.waitForSelector("#sub-grid .subject-card", { timeout: 30000 });

  const open = async () => {
    await page.click("#sub-new");
    await page.waitForSelector(DLG, { timeout: 15000 });
    // The board groups only exist once the shelves have landed.
    await page.waitForSelector('[data-group="national"]', { timeout: 20000 });
  };
  const text = () => page.textContent(DLG);
  const nextLabel = async () => (await page.textContent("#ns-next")).trim();

  await open();

  // ---------------------------------------------------------------- step 1
  check(/Step 1 of 4/.test(await text()), "opens on step 1 of 4");
  check(
    /Which board do you teach\?/.test(await text()),
    "step 1 asks for the board"
  );
  check(
    await page.isVisible('[data-group="exam"]'),
    "Entrance exam is a board group of its own"
  );
  check(
    !(await page.isVisible('[data-board="NEET"]')),
    "a group's boards are hidden until the group is picked"
  );
  check(await page.isDisabled("#ns-next"), "cannot continue without a board");

  await page.click('[data-group="exam"]');
  for (const b of ["JEE Main", "JEE Advanced", "NEET", "CUET"]) {
    check(await page.isVisible(`[data-board="${b}"]`), `picking the group reveals ${b}`);
  }
  check(
    /Step 1 of 4/.test(await text()),
    "revealing the boards does NOT cost a step"
  );
  check(await page.isDisabled("#ns-next"), "the group alone is not a board");

  await page.click('[data-board="NEET"]');
  check(!(await page.isDisabled("#ns-next")), "a board unlocks Continue");

  // ---------------------------------------------------------------- step 2
  await page.click("#ns-next");
  check(/Which attempt\?/.test(await text()), "an exam asks for the ATTEMPT, not a class");
  check(
    !/Class 10/.test(await text()) && !/Class 12/.test(await text()),
    "and offers no class tiles at all"
  );
  const thisYear = new Date().getFullYear();
  const offered = [];
  for (const y of [thisYear, thisYear + 1, thisYear + 2]) {
    if (await page.isVisible(`[data-klass="${y}"]`)) offered.push(String(y));
  }
  check(offered.length >= 2, `it offers real attempt years (${offered.join(", ")})`);
  check(/NEET/.test(await page.textContent("#ns-crumbs")), "the crumb carries the board");

  const year = await page.$eval(".ns-tile .ns-tile-name", (el) => el.textContent.trim());
  await page.click(`[data-klass="${year}"]`);

  // ---------------------------------------------------------------- step 3
  await page.click("#ns-next");
  check(/Which subjects\?/.test(await text()), "step 3 asks for the subjects");
  const crumb = await page.textContent("#ns-crumbs");
  check(
    crumb.includes(year) && !crumb.includes("Class"),
    `the crumb shows the year bare, not as a class (${crumb.trim()})`
  );
  const papers = await page.$$eval("[data-paper]", (els) =>
    els.map((e) => e.getAttribute("data-paper"))
  );
  // NEET HAS a shelf, so the flow shows what the library holds rather than
  // the exam's three papers on top of it. That is the rule under test: the
  // library's subjects, or the exam's papers, never both.
  check(
    papers.length === 1 && /Biology/.test(papers[0]),
    `a board with a shelf shows the shelf, not a duplicate set (${papers.join(", ")})`
  );

  const boxes = await page.$$("[data-paper]");
  for (const b of boxes) await b.uncheck();
  check(await page.isDisabled("#ns-next"), "with nothing ticked and no name, it is blocked");
  await page.fill("#ns-extra", "Zoology");
  check(
    !(await page.isDisabled("#ns-next")),
    "a typed subject of your own is enough on its own"
  );

  // An exam the library has nothing for offers its OWN papers instead.
  await page.click("#ns-back");
  await page.click("#ns-back");
  await page.click('[data-board="JEE Main"]');
  await page.click("#ns-next");
  await page.click(`[data-klass="${offered[0]}"]`);
  await page.click("#ns-next");
  const jee = await page.$$eval("[data-paper]", (els) =>
    els.map((e) => e.getAttribute("data-paper"))
  );
  check(
    ["Physics", "Chemistry", "Maths"].every((p) => jee.includes(p)),
    `an exam with no shelf offers its own papers (${jee.join(", ")})`
  );
  const jeeBoxes = await page.$$("[data-paper]");
  for (const b of jeeBoxes) await b.check();
  const allOn = await nextLabel();
  check(
    /Create 3 subjects/.test(allOn),
    // Three, not four: "Zoology" was typed on the NEET branch a moment ago and
    // must not follow the teacher to JEE Main. This read "Create 4 subjects"
    // before changing the board cleared it.
    `multi-select creates several, and a stale typed subject does not tag along (${allOn})`
  );
  for (const b of jeeBoxes) await b.uncheck();

  // -------------------------------------------- the school-board branch
  await page.click("#ns-back");
  await page.click("#ns-back");
  await page.click('[data-group="national"]');
  await page.click('[data-board="CBSE"]');
  await page.click("#ns-next");
  check(/Which class\?/.test(await text()), "a school board asks for a CLASS");
  check(await page.isVisible('[data-klass="12"]'), "and offers Class 12");
  check(
    /\d+ subjects? ready-made/.test(await text()),
    "each class tile says whether anything ready-made exists"
  );
  await page.click('[data-klass="12"]');
  await page.click("#ns-next");
  const cbseCrumb = await page.textContent("#ns-crumbs");
  check(
    cbseCrumb.includes("Class 12"),
    `a class shows AS a class in the crumb (${cbseCrumb.trim()})`
  );
  const cbsePapers = await page.$$eval("[data-paper]", (els) =>
    els.map((e) => e.getAttribute("data-paper"))
  );
  check(cbsePapers.length >= 3, `CBSE Class 12 offers its library subjects (${cbsePapers.join(", ")})`);
  check(
    (await nextLabel()) === "Choose tests",
    `with ready-made tests behind it, step 3 leads to step 4 (${await nextLabel()})`
  );

  // ---------------------------------------------------------------- step 4
  await page.click("#ns-next");
  check(/Step 4 of 4/.test(await text()), "step 4 is the tests");
  check((await page.$$(".ns-sec")).length >= 2, "one collapsible section per subject");
  const total = await page.textContent(".ns-total-n");
  check(/\d+ tests across \d+ subjects/.test(total), `a live total across subjects (${total.trim()})`);
  check(
    /Create with \d+ tests/.test(await nextLabel()),
    `the button counts the chapters (${await nextLabel()})`
  );
  await page.click("[data-none]");
  check(
    (await nextLabel()) === "Create empty",
    "clearing every chapter still creates the subjects, empty"
  );
  await page.click("[data-all]");

  // Peek reads the first question of a test it did not already hold.
  await page.click(".ns-secbody [data-peek]");
  await page.waitForSelector(".ns-peek-box", { timeout: 20000 });
  await page.waitForFunction(
    () => !/Loading/.test(document.querySelector(".ns-peek-box")?.textContent || "Loading"),
    { timeout: 25000 }
  );
  const stem = (await page.textContent(".ns-peek-box")).trim();
  check(stem.length > 10, `Peek fetches a real question (${stem.slice(0, 48)}…)`);

  const viol = await page.evaluate(() => window.__cspViolations);
  check(viol.length === 0, `no CSP violations (${viol.join("; ") || "none"})`);

  // Never press Create: it writes to the live database.
  await page.keyboard.press("Escape");
  check(!(await page.isVisible(DLG)), "Escape closes it");

  // ----------------------------------------------------------- at 390px
  const phone = await ctx.newPage();
  await phone.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await phone.setViewportSize({ width: 390, height: 844 });
  await phone.reload({ waitUntil: "domcontentloaded" });
  await phone.waitForSelector("#sub-new", { timeout: 25000 });
  await phone.click("#sub-new");
  await phone.waitForSelector('[data-group="national"]', { timeout: 20000 });
  // It is a POPUP on a phone, not a sheet welded to the bottom edge. The three
  // things that say so, and all three were wrong once: a gutter on both sides,
  // a radius on all four corners, and it is not stuck to the floor.
  const box = await phone.$eval(DLG, (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      left: r.left,
      right: window.innerWidth - r.right,
      bottom: window.innerHeight - r.bottom,
      width: r.width,
      radius: [cs.borderTopLeftRadius, cs.borderBottomLeftRadius, cs.borderBottomRightRadius],
    };
  });
  check(
    box.left >= 8 && box.right >= 8,
    `there is a gutter on both sides (${Math.round(box.left)}px / ${Math.round(box.right)}px)`
  );
  check(
    Math.abs(box.left - box.right) < 2,
    `and it is centred (${Math.round(box.left)} vs ${Math.round(box.right)})`
  );
  check(
    box.radius.every((r) => parseFloat(r) > 0),
    `every corner is rounded, so it reads as a popup (${box.radius.join(", ")})`
  );
  check(box.bottom > 4, `it is not welded to the bottom edge (${Math.round(box.bottom)}px clear)`);
  check(box.width <= 390, `the dialog fits a 390px screen (${Math.round(box.width)}px)`);

  // The button a teacher came to press sits furthest from the thumb. This read
  // Back / Cancel / Create for a release, because the markup carried neither
  // .modal-submit nor .modal-back and the shared ordering rule never fired.
  const order = await phone.$$eval(".modal-actions .btn", (els) =>
    els
      .filter((e) => e.offsetParent !== null)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)
      .map((e) => e.textContent.trim())
  );
  check(
    /Continue|Create/.test(order[0] ?? ""),
    `the primary is on top on a phone (${order.join(" → ")})`
  );
  const cols = await phone.$eval(".ns-scroll", () => {
    const t = document.querySelector(".ns-tiles");
    return t ? getComputedStyle(t).gridTemplateColumns.split(" ").length : 1;
  });
  check(cols === 1, "tiles stack to one column on a phone");
  const overflow = await phone.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  check(overflow <= 0, `nothing overflows the window (${overflow}px)`);

  await browser.close();
  console.log(fail ? `\n${fail} FAILURE(S)` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();
