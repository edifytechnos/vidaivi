// Drive the self-guided tour and the help centre in a real browser, at phone
// width, against the built dist/ on :4400.
//
// It needs an admin session (E2E_ADMIN_USER / E2E_ADMIN_PASS — never hardcode
// them) because the tour is per role and there is no role before a sign-in.
//
// The two assertions that earn this file:
//
//   * the tour OPENS BY ITSELF on a first signed-in boot, and does NOT come
//     back on the next one. Both halves matter — a first-run dialog that never
//     fires teaches nobody, and one that fires every time is the thing people
//     hate most about them;
//   * the final button really reaches a help page that really exists. The
//     handover is the whole point of the tour, and a 404 there would be
//     invisible from inside the app.
//
//   node e2e/serve.cjs &   node e2e/tour.cjs

const { chromium } = require("playwright-core");
const BASE = process.env.E2E_BASE || "http://127.0.0.1:4400";
const EXE = process.env.CHROMIUM_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome";
let fail = 0;
const check = (ok, label) => {
  console.log((ok ? "PASS  " : "FAIL  ") + label);
  if (!ok) fail++;
};

if (!process.env.E2E_ADMIN_USER || !process.env.E2E_ADMIN_PASS) {
  console.log("SKIP  set E2E_ADMIN_USER / E2E_ADMIN_PASS to run the tour walk");
  process.exit(0);
}

(async () => {
  const browser = await chromium.launch({ executablePath: EXE, args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();

  // The help pages carry the same global CSP as the app, and they are the one
  // part of the product a reader meets before anything else works.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });

  await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.click("#admin-link");
  await page.fill("#ad-user", process.env.E2E_ADMIN_USER);
  await page.fill("#ad-pass", process.env.E2E_ADMIN_PASS);
  await page.click("#ad-submit");
  await page.waitForSelector("#sub-grid .subject-card", { timeout: 30000 });

  // Signed in with no tour flag stored: this reload IS a first-run boot.
  await page.reload({ waitUntil: "domcontentloaded" });
  const dialog = ".modal-scrim .modal";
  const opened = await page.waitForSelector(dialog, { timeout: 15000 }).catch(() => null);
  check(!!opened, "the tour opens by itself on a first signed-in boot");

  if (opened) {
    const text = await page.textContent(dialog);
    check(/Step 1 of 5/.test(text), "it says Step 1 of 5");
    // "Cancel" is wrong on a dialog nobody is filling in.
    check(await page.isVisible('button:text-is("Skip")'), "the dismiss button says Skip, not Cancel");

    for (let i = 0; i < 4; i++) await page.click(".modal-submit");
    check(/Step 5 of 5/.test(await page.textContent(dialog)), "Next walks through to Step 5 of 5");

    const label = (await page.textContent(".modal-submit")) ?? "";
    check(/help centre/i.test(label), `the last button hands over to the docs (${label.trim()})`);

    const [tab] = await Promise.all([ctx.waitForEvent("page"), page.click(".modal-submit")]);
    await tab.waitForLoadState("domcontentloaded");
    check(/\/help\/admin\//.test(tab.url()), `it opens the ADMIN help page (${tab.url().replace(BASE, "")})`);
    check(/Teachers and accounts/.test((await tab.textContent("h1")) ?? ""), "and that page really renders");
    // The help centre carries no script at all, which is what keeps the CSP's
    // script-src 'self' free of an exception for it.
    check((await tab.$$("script")).length === 0, "the help page loads no script");
    await tab.close();
  }

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2500);
  check(!(await page.isVisible(dialog)), "it does not come back on the next load");

  await page.click("#profile-btn");
  check(await page.isVisible('#profile-menu a[href*="/help/"]'), "the profile menu carries a Help link");
  await page.click('[data-rail="tour"]');
  check(
    await page
      .waitForSelector(dialog, { timeout: 8000 })
      .then(() => true)
      .catch(() => false),
    "Take the tour reopens it on demand"
  );

  const viol = await page.evaluate(() => window.__cspViolations);
  check(viol.length === 0, `no CSP violations (${viol.join("; ") || "none"})`);

  await browser.close();
  console.log(fail ? `\n${fail} FAILURE(S)` : "\nALL PASS");
  process.exit(fail ? 1 : 0);
})();
