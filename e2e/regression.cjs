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
  // Record every Content-Security-Policy refusal the page makes, on every
  // document it loads, so a policy that blocks something the app needs shows up
  // as a failure here instead of as a dead button in front of a class.
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener("securitypolicyviolation", (e) => {
      window.__cspViolations.push(`${e.violatedDirective} blocked ${e.blockedURI}`);
    });
  });
  const shot = (name) => (SHOT ? page.screenshot({ path: `${SHOT}/${name}.png`, fullPage: true }) : Promise.resolve());

  // The session is an httpOnly cookie now, so the page can no longer hold two
  // identities at once the way a header let it. Two tools replace that:
  //
  //  - keepSession()/putSession() park and restore the browser context's jar,
  //    for the places that sign in as a student and then need the teacher back;
  //  - signInStudent()/asStudent() run a second identity from Node with its own
  //    Cookie header, which is what a browser does anyway and lets one check
  //    compare two students against the same test.
  const ctx = page.context();
  const keepSession = () => ctx.cookies();
  const putSession = async (saved) => {
    await ctx.clearCookies();
    if (saved && saved.length) await ctx.addCookies(saved);
  };
  const signInStudent = async (username, password) => {
    const res = await fetch(`${BASE}/api/studentauth`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) return null;
    const set = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
    const jar = set.map((c) => c.split(";")[0]).join("; ");
    return jar || null;
  };
  const asStudent = (jar, path, init) =>
    fetch(`${BASE}${path}`, {
      ...(init || {}),
      headers: { cookie: jar, "x-vidai-auth": "1", ...((init || {}).headers || {}) },
    });

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
  // Every listed test shows the Title on line one and the Subtitle beneath it,
  // both exactly as typed — nothing derived or rearranged.
  const label = await page.evaluate(() => {
    const card = document.querySelector(".test-card[data-test='relations-functions-test1'] .test-card-title");
    return {
      main: card?.querySelector(".tl-main")?.textContent?.trim() || "",
      sub: card?.querySelector(".tl-sub")?.textContent?.trim() || "",
    };
  });
  check(label.main === "Test 1 — Relations and Functions", `the title leads the label (got "${label.main}")`);
  check(label.sub === "Relations and Functions", `the subtitle sits beneath it (got "${label.sub}")`);
  await shot("home-guest");

  // Demo test: answer first (MCQ) question
  await page.click(".test-card[data-test='matrices-demo']");
  await page.waitForSelector("#primary-btn");
  await page.click("#primary-btn");
  await page.waitForSelector(".option");
  check((await page.$$(".option")).length === 4, "MCQ renders 4 options");
  // The CSP must not break what the app actually needs. A violation here is a
  // real outage — sign-in, maths or images silently dead — so fail on any.
  check(
    (await page.evaluate(() => window.__cspViolations.length)) === 0,
    `no CSP violations so far (${JSON.stringify(await page.evaluate(() => window.__cspViolations.slice(0, 3)))})`
  );
  // KaTeX is bundled and imported on demand rather than loaded from a CDN, so
  // there is no global to probe for. What matters is unchanged and asserted
  // below: a .katex node must appear wherever maths is shown.
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

  // Brute force is answered with a lock, not with another guess. Uses a name
  // nobody owns, so only that throwaway bucket is spent; the IP bucket is far
  // looser precisely so a run like this cannot lock the suite — or a school —
  // out of the accounts that matter.
  const throttle = await page.evaluate(async () => {
    const username = `e2e-nobody-${Date.now()}`;
    const seen = [];
    for (let i = 0; i < 8; i++) {
      const res = await fetch("/api/studentauth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password: `wrong-${i}` }),
      });
      seen.push(res.status);
      if (res.status === 429) {
        return { locked: true, at: i + 1, seen, retryAfter: res.headers.get("retry-after") };
      }
    }
    return { locked: false, seen };
  });
  if (!throttle.locked && throttle.seen.every((s) => s === 401)) {
    console.log("SKIP  login throttling (this API predates it — every guess answered 401)");
  } else {
    check(throttle.locked, `repeated wrong passwords are locked out (after ${throttle.at})`);
    check(
      Number(throttle.retryAfter) > 0,
      `the lock says how long to wait (Retry-After: ${throttle.retryAfter})`
    );
  }

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
    await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 25000 });
    check(true, "admin login lands on the subjects grid");

    // The headline claim of the session work, checked on a real sign-in rather
    // than asserted in a comment: the session exists, the page cannot read it,
    // and nothing that looks like a credential was left in localStorage.
    const jar = await page.context().cookies();
    const session = jar.find((c) => c.name === "vidai_session");
    check(!!session, "signing in sets a session cookie");
    check(!!session && session.httpOnly, "the session cookie is httpOnly");
    check(!!session && session.sameSite === "Strict", `and SameSite=Strict (${session && session.sameSite})`);
    check(
      await page.evaluate(() => !/vidai_session/.test(document.cookie)),
      "script cannot read it — document.cookie does not have it"
    );
    check(
      await page.evaluate(() => {
        const raw = localStorage.getItem("vidai:auth") || "";
        return !/vad\.|vst\.|vgo\.|credential/.test(raw);
      }),
      "and no token is left behind in localStorage"
    );
    await shot("subjects-admin");

    // The rail is the navigation on every signed-in screen.
    check(await page.isVisible(".rail"), "a signed-in user gets the rail");
    await page.click('[data-rail="admin"]');
    await page.waitForSelector("#te-list .data-table, #te-list .hint", { timeout: 20000 });
    check(true, "the rail reaches teacher access");
    await shot("admin");

    await page.click('[data-rail="students"]');
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
    await page.click('[data-rail="mytests"]');
    await page.waitForSelector("#mt-list .data-table, #mt-list .hint:not(:empty)", { timeout: 20000 });
    check(await page.isVisible("#mt-open-import"), "my tests page offers test import");
    await page.click("#mt-open-import");
    await page.fill("#mt-json", "{ not json");
    await page.click("#mt-create");
    await page.waitForSelector("#mt-error:not([hidden])", { timeout: 10000 });
    check(true, "my tests rejects invalid JSON with an error");
    await shot("my-tests");

    // The Vidaivi → Vidai rename must not cost a student their data. Seed the
    // pre-rename keys, reload, and the app should have carried them across.
    await page.evaluate(() => {
      // Only this check's own keys — the admin session lives here too.
      for (const k of ["vidai:attempt:matrices-demo", "vidai:guestMode"]) localStorage.removeItem(k);
      localStorage.setItem(
        "vidaivi:attempt:matrices-demo",
        JSON.stringify({ answers: {}, index: 2, completed: false, score: 1, updatedAt: "" })
      );
      localStorage.setItem("vidaivi:guestMode", "1");
    });
    await page.goto(BASE + "/?test=matrices-demo", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#primary-btn", { timeout: 20000 });
    const migrated = await page.evaluate(() => ({
      attempt: localStorage.getItem("vidai:attempt:matrices-demo"),
      guest: localStorage.getItem("vidai:guestMode"),
      oldKept: localStorage.getItem("vidaivi:attempt:matrices-demo") !== null,
    }));
    check(
      !!migrated.attempt && JSON.parse(migrated.attempt).index === 2,
      "a pre-rename attempt is carried across to the new storage key"
    );
    check(migrated.guest === "1", "and so is the rest of the device's state");
    check(migrated.oldKept, "the old keys are left in place for older cached bundles");
    await page.evaluate(() => {
      for (const k of [
        "vidai:attempt:matrices-demo",
        "vidai:guestMode",
        "vidaivi:attempt:matrices-demo",
        "vidaivi:guestMode",
      ]) localStorage.removeItem(k);
    });

    // Review: a completed test opens read-only, on this device and on a
    // device that has never held the attempt.
    await page.evaluate(() => {
      localStorage.setItem(
        "vidai:attempt:matrices-demo",
        JSON.stringify({
          answers: { "mat-001": { given: 0, correct: false, earned: 0 } },
          index: 5,
          completed: true,
          score: 3,
          completedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
      );
    });
    await page.goto(BASE + "/?test=matrices-demo", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".review-item", { timeout: 20000 });
    check(true, "a completed test opens review, not the landing card");
    check(
      (await page.textContent(".review-given")).includes("Your answer"),
      "review shows the answer the student submitted"
    );
    check(await page.isVisible(".review-item .solution"), "review shows the explanation");
    check(
      (await page.textContent(".review-correct")).includes("Correct answer"),
      "a wrong answer names the correct one"
    );

    // One question per page, with the rest listed beside it — the teacher's
    // authoring layout, read-only. Never a scroll of the whole paper.
    const shape = await page.evaluate(() => ({
      shown: document.querySelectorAll(".ed-center .question-text").length,
      rows: document.querySelectorAll("#rv-tree .ed-tree-q").length,
      cols: getComputedStyle(document.querySelector(".ed-cols")).gridTemplateColumns.split(" ").length,
      first: document.querySelector(".ed-center .question-text")?.textContent?.trim() || "",
    }));
    check(shape.shown === 1, `review shows one question at a time (${shape.shown} on screen)`);
    check(shape.rows > 1, `the rest of the paper is listed beside it (${shape.rows} rows)`);
    check(shape.cols === 3, `it uses the editor's three columns (${shape.cols})`);
    await page.click("#rv-tree .ed-tree-q[data-i='2']");
    await page.waitForFunction(
      (before) => (document.querySelector(".ed-center .question-text")?.textContent?.trim() || "") !== before,
      shape.first,
      { timeout: 10000 }
    );
    check(true, "picking a question from the list swaps it in place");
    check(
      await page.evaluate(() => new URLSearchParams(location.search).get("review") !== null),
      "the url carries the question, so a refresh lands back on it"
    );
    await page.goto(BASE + "/?test=matrices-demo", { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".review-item", { timeout: 20000 });
    await shot("review");

    // The cross-device case: save an attempt to the server, wipe this device,
    // and the review must rebuild from what the server holds.
    const saved = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
      if (!auth) return "no-token";
      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Vidai-Auth": "1" },
        body: JSON.stringify({
          testId: "matrices-demo",
          score: 3,
          total: 8,
          completedAt: new Date().toISOString(),
          answers: JSON.stringify({ "mat-001": { given: 0, correct: false, earned: 0 } }),
        }),
      });
      return res.ok ? "ok" : `http-${res.status}`;
    });
    if (saved === "ok") {
      await page.evaluate(() => localStorage.removeItem("vidai:attempt:matrices-demo"));
      await page.goto(BASE + "/?test=matrices-demo", { waitUntil: "domcontentloaded" });
      await page.waitForSelector(".review-item", { timeout: 25000 });
      check(true, "review rebuilds from the server with no local attempt");
      check(
        (await page.textContent(".review-given")).includes("Your answer"),
        "the server-rebuilt review carries the submitted answer"
      );
    } else {
      check(false, `cross-device review could not save an attempt (${saved})`);
    }
    await page.evaluate(() => localStorage.removeItem("vidai:attempt:matrices-demo"));

    // Work in progress, saved as it is given. Probe first with index 0, which
    // an API without this feature rejects (400) and one with it accepts
    // harmlessly — so running this suite against an older API writes nothing.
    const progressProbe = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
      return fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Vidai-Auth": "1" },
        body: JSON.stringify({ action: "progress", testId: "matrices-demo", index: 0, answers: "{}" }),
      }).then((r) => r.status);
    });

    if (progressProbe !== 200) {
      console.log(`SKIP  per-question saving (/api/attempts has no progress action here: ${progressProbe})`);
    } else {
      // The mechanism, on a test id nobody has ever completed, so the result
      // cannot be decided by leftover rows from earlier runs.
      const probeId = `e2e-resume-${Date.now()}`;
      const roundTrip = await page.evaluate(async (id) => {
        const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
        const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": "1" };
        await fetch("/api/attempts", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({
            action: "progress",
            testId: id,
            index: 1,
            answers: JSON.stringify({ "q-1": { given: 0, correct: true, earned: 1 } }),
          }),
        });
        return fetch(`/api/attempts?testId=${id}`, { headers: hdr }).then((r) => r.json());
      }, probeId);
      check(
        roundTrip.attempt === null && roundTrip.progress?.index === 1,
        "an unfinished test reads back as progress, not as a finished attempt"
      );
      check(
        !!roundTrip.progress?.answers && Object.keys(roundTrip.progress.answers).length === 1,
        "the answers given so far come back with it"
      );

      // End to end: a bundled test this identity has never finished must offer
      // Continue after the device is wiped.
      const fresh = await page.evaluate(async () => {
        const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
        const hdr = { "X-Vidai-Auth": "1" };
        const mine = await fetch("/api/attempts", { headers: hdr }).then((r) => r.json());
        const finished = new Set((mine.attempts || []).filter((a) => a.status !== "progress").map((a) => a.testId));
        return ["matrices-demo", "relations-functions-test1"].find((id) => !finished.has(id)) || "";
      });
      if (!fresh) {
        console.log("SKIP  resume in the UI (this account has finished every bundled test)");
      } else {
        await page.goto(`${BASE}/?test=${fresh}`, { waitUntil: "domcontentloaded" });
        await page.evaluate((id) => localStorage.removeItem(`vidai:attempt:${id}`), fresh);
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector("#primary-btn", { timeout: 20000 });
        await page.click("#primary-btn");
        await page.waitForSelector(".option", { timeout: 20000 });
        const progressSaved = page.waitForResponse(
          (r) => r.url().includes("/api/attempts") && r.request().method() === "POST",
          { timeout: 20000 }
        );
        await page.click(".option");
        await page.click("#submit-btn");
        await page.waitForSelector("#next-btn", { timeout: 20000 });
        const saved = await progressSaved.then((r) => r.status()).catch(() => 0);
        check(saved === 200, `answering a question saves progress to the server (${saved})`);

        await page.evaluate((id) => localStorage.removeItem(`vidai:attempt:${id}`), fresh);
        await page.goto(`${BASE}/?test=${fresh}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#primary-btn", { timeout: 25000 });
        const label = await page
          .waitForFunction(
            () => {
              const t = document.querySelector("#primary-btn")?.textContent || "";
              return t.includes("Continue") ? t : false;
            },
            { timeout: 25000 }
          )
          .then((h) => h.jsonValue())
          .catch(() => "");
        check(!!label, "a wiped device resumes the test from the server");
        if (label) check(/Question 2 of/.test(label), `it continues at the right question ("${label.trim()}")`);

        // Put it back to "not started" rather than leaving a half-done test.
        await page.evaluate(async (id) => {
          const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
          await fetch("/api/attempts", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Vidai-Auth": "1" },
            body: JSON.stringify({ action: "progress", testId: id, index: 0, answers: "{}" }),
          });
          localStorage.removeItem(`vidai:attempt:${id}`);
        }, fresh);
      }

      // The publish gate, on a draft this run creates complete and deletes
      // again — an incomplete draft would fail validation before the gate.
      const gate = await page.evaluate(async () => {
        const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
        const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": "1" };
        const created = await fetch("/api/tests", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({
            action: "create",
            test: {
              // A unique id every run. Letting the server name it gives
              // "e2epublishgate-<100..999>" — only 900 of them — and the
              // cleanup below writes index 0, which keeps a progress row
              // rather than removing it. A later run that collided then met
              // that leftover row and failed the publish it expected to pass.
              id: `e2egate-${Date.now()}`,
              title: "E2E publish gate",
              chapter: "Matrices",
              questions: [
                {
                  id: "gate-q1",
                  chapter: "Matrices",
                  topic: "Gate",
                  type: "mcq",
                  q: "Two plus two?",
                  options: ["3", "4"],
                  answer: 1,
                  solution: "Four.",
                  marks: 1,
                },
              ],
            },
          }),
        }).then((r) => r.json());
        const id = created.test?.id;
        if (!id) return { skip: true };
        // Clean first, so the only reason publish can fail is the gate.
        const clean = await fetch("/api/tests", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({ action: "publish", id }),
        }).then((r) => r.status);
        await fetch("/api/tests", { method: "POST", headers: hdr, body: JSON.stringify({ action: "unpublish", id }) });
        // Now someone is part-way through it.
        await fetch("/api/attempts", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({ action: "progress", testId: id, index: 1, answers: "{}" }),
        });
        const blocked = await fetch("/api/tests", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({ action: "publish", id }),
        }).then(async (r) => ({ status: r.status, error: (await r.json().catch(() => ({}))).error || "" }));
        await fetch("/api/attempts", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({ action: "progress", testId: id, index: 0, answers: "{}" }),
        });
        await fetch("/api/tests", { method: "POST", headers: hdr, body: JSON.stringify({ action: "delete", id }) });
        return { id, clean, ...blocked };
      });
      if (gate.skip) {
        console.log("SKIP  publish gate (could not create a draft to try)");
      } else {
        check(gate.clean === 200, `a complete draft publishes when nobody is mid-test (${gate.clean})`);
        check(gate.status === 409, `publishing is refused while a student is part-way through (${gate.status})`);
        check(/part-way through/i.test(gate.error), "the refusal explains why in the teacher's words");
        console.log(`  (cleaned up ${gate.id})`);
      }

    }

    // Parent links. A code is a key to a child's results, so what matters
    // most here is the refusals. Redemption itself needs a Google identity,
    // which this suite cannot produce — that rule is asserted instead.
    const links = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
      const hdr = { "X-Vidai-Auth": "1" };
      const call = (body) =>
        fetch("/api/parentlink", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...hdr },
          body: JSON.stringify(body),
        }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

      const roster = await fetch("/api/students", { headers: hdr }).then((r) => r.json());
      const username = (roster.students || [])[0]?.username || "";
      if (!username) return { skip: true };

      const made = await call({ action: "invite", username });
      // A missing route also answers 404, so every refusal below would "pass"
      // against an API that does not have this feature at all. Prove it exists.
      if (made.status !== 201) return { missing: true, status: made.status };
      const badStudent = await call({ action: "invite", username: "no-such-student-xyz" });
      const badCode = await call({ action: "redeem", code: "ZZZZZZZZ" });
      const nonGoogle = made.data.code
        ? await call({ action: "redeem", code: made.data.code })
        : null;
      const unlinkedAttempts = await fetch("/api/attempts?student=someone-elses-child", {
        headers: hdr,
      });
      const unlinkedTests = await fetch("/api/tests?student=someone-elses-child", { headers: hdr });
      return {
        code: made.data.code || "",
        badStudent: badStudent.status,
        badCode: badCode.status,
        nonGoogle: nonGoogle && nonGoogle.status,
        unlinkedAttempts: unlinkedAttempts.status,
        unlinkedTests: unlinkedTests.status,
      };
    });

    if (links.skip) {
      console.log("SKIP  parent links (roster is empty)");
    } else if (links.missing) {
      check(false, `/api/parentlink is not deployed here (invite returned ${links.status})`);
    } else {
      check(/^[A-Z2-9]{8}$/.test(links.code), `an invite code is minted (${links.code})`);
      check(
        !/[ILO01]/.test(links.code),
        "the code avoids look-alike characters a parent would mistype"
      );
      check(links.badStudent === 404, "a code cannot be minted for someone else's student");
      // The Google-only gate runs before the lookup, so an ineligible account
      // gets the same 403 for any code — it cannot probe which codes exist.
      check(links.badCode === 403, "an ineligible account learns nothing from an unknown code");
      check(links.nonGoogle === 403, "only a Google account can redeem a code");
      // Refused, but the reason depends on who is asking. /api/attempts now
      // gates on canSeeStudent, so a parent gets 403 "Not your child" while
      // this suite's admin — who may read any student that exists — gets 404
      // for one who does not. Both are a refusal; neither hands back a paper.
      check(
        links.unlinkedAttempts === 403 || links.unlinkedAttempts === 404,
        `attempts for an unlinked child are refused (${links.unlinkedAttempts})`
      );
      check(links.unlinkedTests === 403, "the test list for an unlinked child is refused");
    }

    // Long-answer photos and the teacher's marking queue. This runs the whole
    // loop on a throwaway student it creates and then removes, so it never
    // leaves a photo, a grading row or a login behind.
    // A per-run test id: student usernames are derived from the name and can be
    // handed out again once a student is removed, and a recycled username would
    // otherwise inherit the previous run's grading row ("already marked", 409).
    const photoTestId = "e2e-photo-" + Math.random().toString(36).slice(2, 7);
    // The session is a cookie, and a browser context holds exactly one. So the
    // teacher's half of this runs in the page and the student's half runs from
    // Node with its own jar — which is what two people on two phones actually
    // are, and a truer test than one tab holding two tokens at once.
    const marking = await (async () => {
      const jpeg = await page.evaluate(() => {
        // A real JPEG, drawn here rather than pasted as a constant.
        const canvas = document.createElement("canvas");
        canvas.width = 40;
        canvas.height = 30;
        const c = canvas.getContext("2d");
        c.fillStyle = "#fff";
        c.fillRect(0, 0, 40, 30);
        c.fillStyle = "#000";
        c.fillText("f-1", 4, 20);
        return canvas.toDataURL("image/jpeg", 0.7).split(",")[1];
      });

      const teacher = (path, init) =>
        page.evaluate(
          async ({ path, init }) => {
            const res = await fetch(path, {
              ...init,
              headers: { "Content-Type": "application/json", "X-Vidai-Auth": "1", ...(init.headers || {}) },
            });
            return { status: res.status, data: await res.json().catch(() => ({})) };
          },
          { path, init: init || {} }
        );

      // A missing route answers 404 too, so every refusal below would "pass"
      // against an API without this feature. Prove the queue exists first.
      const queue0 = await teacher("/api/grading?queue=1");
      if (queue0.status !== 200) return { missing: true, queueStatus: queue0.status };

      const made = (
        await teacher("/api/students", {
          method: "POST",
          body: JSON.stringify({ name: "E2E Photo Student", grade: "12", school: "E2E" }),
        })
      ).data;
      if (!made.username || !made.password) return { skip: true };

      const cleanup = () =>
        teacher("/api/students", {
          method: "POST",
          body: JSON.stringify({ action: "remove", username: made.username }),
        });

      try {
        // The teacher/admin identity must not be able to hand work in.
        const asTeacher = (
          await teacher("/api/answerimage", {
            method: "POST",
            body: JSON.stringify({ testId: photoTestId, questionId: "q1", image: jpeg }),
          })
        ).status;

        const jar = await signInStudent(made.username, made.password);
        if (!jar) return { cleanupOnly: true, asTeacher, loginFailed: true, username: made.username };

        const post = (body) =>
          asStudent(jar, "/api/answerimage", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

        const base = { testId: photoTestId, testTitle: "E2E photo test", questionId: "q1", questionIndex: 0, maxMarks: 5 };
        const notAnImage = await post({ ...base, image: Buffer.from("this is plainly not a jpeg").toString("base64") });
        const tooBig = await post({ ...base, image: "/9j/" + "A".repeat(2_400_000) });
        const uploaded = await post({ ...base, image: jpeg });

        // The signed URL is per-student: nobody else's blob comes back.
        const signed = await asStudent(
          jar,
          `/api/answerimage?blob=${encodeURIComponent(uploaded.data.blob || "x")}`
        ).then(async (r) => ({ status: r.status, url: (await r.json().catch(() => ({}))).url || "" }));
        const someoneElse = await asStudent(
          jar,
          "/api/answerimage?blob=" + encodeURIComponent("stu~not-this-student/t/q/1.jpg")
        ).then((r) => r.status);

        // It reaches the teacher's queue, gets marked, and reads back marked.
        const queue = (await teacher("/api/grading?queue=1")).data;
        const inQueue = (queue.answers || []).some(
          (a) => a.username === made.username && a.testId === photoTestId
        );
        const marked = await teacher("/api/grading", {
          method: "POST",
          body: JSON.stringify({
            action: "mark",
            username: made.username,
            testId: photoTestId,
            questionId: "q1",
            awarded: 9, // over maxMarks on purpose: must clamp to 5
            comment: "Good method.",
          }),
        });
        const mine = await asStudent(jar, `/api/grading?testId=${photoTestId}`).then((r) =>
          r.json().catch(() => ({}))
        );

        // Release: the paper is shut until the teacher opens it.
        const studentSees = () =>
          asStudent(jar, `/api/release?testId=${photoTestId}`).then((r) => r.json().catch(() => ({})));
        const before = await studentSees();
        // A student must not be able to open their own paper.
        const bySelf = (
          await asStudent(jar, "/api/release", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ action: "release", testId: photoTestId }),
          })
        ).status;
        // Nor may a teacher open one for somebody else's student.
        const forStranger = (
          await teacher("/api/release", {
            method: "POST",
            body: JSON.stringify({
              action: "release",
              testId: photoTestId,
              username: "no-such-student-xyz",
            }),
          })
        ).status;
        const opened = (
          await teacher("/api/release", {
            method: "POST",
            body: JSON.stringify({ action: "release", testId: photoTestId, username: made.username }),
          })
        ).status;
        const after = await studentSees();
        await teacher("/api/release", {
          method: "POST",
          body: JSON.stringify({ action: "unrelease", testId: photoTestId, username: made.username }),
        });
        const closedAgain = await studentSees();

        // The teacher reads the whole paper, MCQs included. The attempt row is
        // the student's own; GET /api/attempts?student= gates on canSeeStudent,
        // so a teacher reaches their own student and nobody else's.
        const handedIn = (
          await asStudent(jar, "/api/attempts", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              testId: photoTestId,
              score: 3,
              total: 5,
              completedAt: new Date().toISOString(),
              answers: JSON.stringify({ q1: { given: 2, correct: true, earned: 3 } }),
            }),
          })
        ).status;
        // The AI assessor. It proposes a mark and never awards one, so the
        // thing to prove is that a student cannot reach it at all, and that
        // with no key configured it says so rather than 404ing.
        const assessAsStudent = (
          await asStudent(jar, "/api/assess", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username: made.username, testId: photoTestId, questionId: "q1" }),
          })
        ).status;
        const assessAsTeacher = await teacher("/api/assess", {
          method: "POST",
          body: JSON.stringify({
            username: made.username,
            testId: photoTestId,
            questionId: "q1",
            question: "Prove it.",
            solution: "By induction.",
          }),
        });

        const paperRead = await teacher(
          `/api/attempts?testId=${photoTestId}&student=${made.username}`
        );
        const strangerPaper = (
          await teacher(`/api/attempts?testId=${photoTestId}&student=no-such-student-xyz`)
        ).status;

        return {
          assess: { student: assessAsStudent, teacher: assessAsTeacher.status, data: assessAsTeacher.data },
          paper: {
            handedIn,
            status: paperRead.status,
            error: paperRead.data?.error || "",
            given: paperRead.data?.attempt?.answers?.q1?.given,
            stranger: strangerPaper,
          },
          asTeacher,
          notAnImage: notAnImage.status,
          tooBig: tooBig.status,
          uploaded: uploaded.status,
          blob: uploaded.data.blob || "",
          signedStatus: signed.status,
          signedUrl: signed.url,
          someoneElse,
          inQueue,
          markStatus: marked.status,
          awarded: marked.data.awarded,
          readBack: (mine.answers || [])[0] || null,
          username: made.username,
          jar,
          release: {
            before: before.released,
            bySelf,
            forStranger,
            opened,
            after: after.released,
            closedAgain: closedAgain.released,
          },
        };
      } finally {
        await cleanup();
      }
    })();

    if (marking.assess) {
      const a = marking.assess;
      if (a.teacher === 404) {
        // The endpoint is not on this environment at all; a 404 for the
        // student says nothing about the rule, so do not claim it does.
        console.log("SKIP  AI assessment (/api/assess is not deployed here)");
      } else if (a.teacher === 501) {
        check(
          a.student === 403,
          `a student cannot ask the AI to mark their own work (${a.student})`
        );
        // No GEMINI_API_KEY on this environment. That is the shipped-dormant
        // state, and saying so is the correct answer — not a 404, not a 500.
        check(true, "with no key configured the assessor says it is switched off (501)");
      } else {
        check(
          a.student === 403,
          `a student cannot ask the AI to mark their own work (${a.student})`
        );
        if (a.teacher === 502 && /location|region/i.test((a.data && a.data.error) || "")) {
          // The key is set but this app is hosted where the provider does not
          // serve. That is the documented state, not a regression.
          check(true, "the assessor reports the region it cannot be reached from");
        } else {
          check(
            a.teacher === 200 && typeof a.data.awarded === "number",
            `the assessor proposes a mark (${a.teacher}, awarded ${a.data && a.data.awarded})`
          );
        }
      }
    }

    if (marking.paper) {
      const paper = marking.paper;
      if (paper.status === 403 && /child/i.test(paper.error)) {
        // The old parent-only rule. Point E2E_API_BASE at an environment
        // carrying this branch to exercise it.
        console.log(`SKIP  teacher reads a student's paper (API predates it: "${paper.error}")`);
      } else {
        check(paper.handedIn === 201, `a student hands a paper in (${paper.handedIn})`);
        check(
          paper.status === 200 && paper.given === 2,
          `the teacher reads it back question by question (${paper.status}, answer ${paper.given})`
        );
        check(
          paper.stranger === 404 || paper.stranger === 403,
          `and cannot read a student who is not theirs (${paper.stranger})`
        );
      }
    }

    if (marking.missing) {
      // Running against an API that predates this feature (production, before
      // the PR merges). Skipping is honest; every refusal below would otherwise
      // "pass" against a 404.
      console.log(`SKIP  long-answer photos (/api/grading is not deployed here: ${marking.queueStatus})`);
    } else if (marking.skip) {
      console.log("SKIP  long-answer photos (could not create a throwaway student)");
    } else if (marking.loginFailed) {
      check(false, "long-answer photos: the throwaway student could not sign in");
    } else {
      check(marking.asTeacher === 403, `a teacher cannot hand work in as a student (${marking.asTeacher})`);
      check(marking.notAnImage === 415, `a body that is not an image is refused (${marking.notAnImage})`);
      check(marking.tooBig === 413, `an oversized photo is refused (${marking.tooBig})`);
      check(marking.uploaded === 201, `a student hands in a photo of their working (${marking.uploaded})`);
      check(
        marking.blob.startsWith(`stu~${marking.username}/${photoTestId}/q1/`),
        `the photo is stored under its own student (${marking.blob})`
      );
      check(
        marking.signedStatus === 200 && /^https:\/\/.+sig=/.test(marking.signedUrl),
        "reading it back gives a signed, expiring URL"
      );
      check(marking.someoneElse === 403, `another student's photo is refused (${marking.someoneElse})`);
      check(marking.inQueue, "it turns up in the teacher's marking queue");
      check(marking.markStatus === 200, `the teacher awards marks (${marking.markStatus})`);
      check(marking.awarded === 5, `marks are clamped to what the question is worth (got ${marking.awarded})`);
      check(marking.readBack?.status === "marked", "the student's copy reads back as marked");
      check(marking.readBack?.awarded === 5 && marking.readBack?.comment === "Good method.",
        "with the mark and the teacher's comment");
      const r = marking.release;
      check(r.before === false, "a paper starts shut — the student sees no answers");
      check(r.bySelf === 403, `a student cannot open their own paper (${r.bySelf})`);
      // 403 when the student belongs to another teacher, 404 when there is no
      // such student — both refusals, and which one depends on the username.
      check(
        r.forStranger === 403 || r.forStranger === 404,
        `a teacher cannot open one for a student who is not theirs (${r.forStranger})`
      );
      check(r.opened === 200 && r.after === true, "the teacher opens it and the student sees it");
      check(r.closedAgain === false, "and can shut it again");
      // Sitting the test as a real student: nothing comes back. This needs a
      // student who still exists — the one above is deleted by the time we get
      // here — because the workspace saves progress to the server as it goes,
      // and a dead token would end the session mid-check.
      const adminAuth = await page.evaluate(() => localStorage.getItem("vidai:auth"));
      const adminJar = await keepSession();
      // Signing in as the student in the page replaces the teacher's cookie
      // with theirs — which is exactly what is wanted here, and why the jar is
      // parked above and put back after.
      const sitter = await page.evaluate(async () => {
        const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": "1" };
        const made = await fetch("/api/students", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({ name: "E2E Sitting Student", grade: "12", school: "E2E" }),
        }).then((r) => r.json());
        if (!made.username) return null;
        const ok = await fetch("/api/studentauth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: made.username, password: made.password }),
        }).then((r) => r.ok);
        return ok ? { username: made.username } : null;
      });
      await page.evaluate(() => {
        localStorage.setItem(
          "vidai:auth",
          JSON.stringify({
            kind: "student",
            profile: { kind: "student", sub: "e2e", name: "E2E Sitting Student", role: "student" },
          })
        );
        localStorage.removeItem("vidai:attempt:matrices-demo");
      });
      await page.goto(BASE + "/?test=matrices-demo", { waitUntil: "domcontentloaded" });
      await page.waitForSelector("#primary-btn", { timeout: 20000 });
      await page.click("#primary-btn");
      // A signed-in student sits the test in the workspace (src/screens/student.ts):
      // the question list beside one question, and the answer saves itself.
      await page.waitForSelector(".ed-student .option", { timeout: 20000 });
      await page.click(".ed-student .option");
      // The tree is a drawer at phone width, so count the tick rather than
      // waiting for it to be on screen.
      await page.waitForFunction(
        () => document.querySelectorAll("#st-tree .st-answered").length === 1,
        { timeout: 20000 }
      );
      const silent = await page.evaluate(() => ({
        verdict: document.querySelectorAll(".verdict").length,
        solution: document.querySelectorAll(".solution").length,
        explain: document.querySelectorAll(".ed-explain").length,
      }));
      check(silent.verdict === 0, `a student gets no verdict on submit (${silent.verdict} found)`);
      check(silent.solution === 0, `and no worked solution (${silent.solution} found)`);
      check(silent.explain === 0, "and no explanation panel while the test is being sat");
      await putSession(adminJar);
      await page.evaluate(async ({ a, username }) => {
        localStorage.removeItem("vidai:attempt:matrices-demo");
        localStorage.removeItem("vidai:subject");
        if (a) localStorage.setItem("vidai:auth", a);
        if (username) {
          await fetch("/api/students", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Vidai-Auth": "1" },
            body: JSON.stringify({ action: "remove", username }),
          });
        }
      }, { a: adminAuth, username: sitter?.username });

      console.log(`  (cleaned up ${marking.username})`);
    }

    // An expired sign-in must say so. A Google ID token lasts about an hour;
    // before this, every call 401'd and each screen rendered its own empty
    // state, so an hour-old session looked exactly like deleted data.
    const adminAuthForExpiry = await page.evaluate(() => localStorage.getItem("vidai:auth"));
    const liveJar = await keepSession();
    // The session lives in the cookie now, so a stale localStorage entry alone
    // is not an expired session — the jar has to be empty for the API to refuse
    // the call this is about.
    await ctx.clearCookies();
    for (const role of ["teacher", "admin", "parent"]) {
      await page.evaluate((r) => {
        localStorage.setItem(
          "vidai:auth",
          JSON.stringify({
            credential: "expired.google.token",
            profile: { kind: "google", sub: "1", name: "Expired User", email: "e@x.com", role: r },
          })
        );
      }, role);
      await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
      // The shell paints from the cached profile before the first call comes
      // back, so wait for the welcome screen itself, not for whichever renders
      // first — otherwise this races its own subject.
      await page.waitForSelector(".welcome", { timeout: 25000 });
      const state = await page.evaluate(() => ({
        welcome: !!document.querySelector(".welcome"),
        told: !!document.querySelector(".welcome-expired"),
        stillSignedIn: localStorage.getItem("vidai:auth") !== null,
      }));
      check(state.welcome, `an expired ${role} session lands on sign-in, not an empty page`);
      check(state.told, `and is told the sign-in timed out (${role})`);
      check(!state.stillSignedIn, `and the dead session is cleared (${role})`);
    }
    // The other half: a live session must NOT be signed out.
    await putSession(liveJar);
    await page.evaluate((a) => localStorage.setItem("vidai:auth", a), adminAuthForExpiry);
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 25000 });
    check(
      await page.evaluate(() => localStorage.getItem("vidai:auth") !== null),
      "a valid session is left alone"
    );

    // No flicker, no shift. With the API held back, a hard reload must paint
    // the shell and a skeleton at once, and the chrome must not move when the
    // data arrives or when moving between screens.
    await page.route("**/api/**", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      // A navigation can retire the request while it is held; that is fine.
      try { await route.continue(); } catch {}
    });
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    const early = await page.evaluate(() => {
      const r = document.querySelector(".rail")?.getBoundingClientRect();
      const b = document.querySelector(".shellbar")?.getBoundingClientRect();
      return { rail: r && [r.left, r.width, r.height], bar: b && [b.top, b.height], sk: document.querySelectorAll(".sk").length };
    });
    check(!!early.rail && early.sk > 0, `a hard reload paints the shell and a skeleton before data (${early.sk} bones)`);
    await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 25000 });
    const late = await page.evaluate(() => {
      const r = document.querySelector(".rail").getBoundingClientRect();
      const b = document.querySelector(".shellbar").getBoundingClientRect();
      return { rail: [r.left, r.width, r.height], bar: [b.top, b.height], sk: document.querySelectorAll(".sk").length };
    });
    check(JSON.stringify(early.rail) === JSON.stringify(late.rail) && JSON.stringify(early.bar) === JSON.stringify(late.bar),
      "the chrome does not move when the data lands");
    check(late.sk === 0, "no skeleton is left behind once the data has landed");
    const shellBefore = await page.$(".shell");
    await page.click('[data-rail="students"]');
    await page.waitForSelector("#st-list .data-table, #st-list .login-error", { timeout: 25000 });
    const sameShell = await page.evaluate((el) => el === document.querySelector(".shell"), shellBefore);
    check(sameShell, "moving between screens keeps the same shell element (no re-layout)");
    await page.unroute("**/api/**");

    // Marking: the queue is a list, and opening one lands in the ordinary
    // paper view with marking switched on — the same screen the student reads
    // their result on, not a pane of its own.
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-rail="mark"]', { timeout: 25000 });
    await page.click('[data-rail="mark"]');
    await page.waitForSelector(".test-list .test-card, .empty-state", { timeout: 30000 });
    check(
      !(await page.$(".mark-wrap .detail")),
      "the marking queue has no detail pane of its own any more"
    );
    const markCard = await page.$(".test-list .test-card[data-test]");
    if (markCard) {
      await markCard.click();
      // An answer can outlive its test — old queue rows point at tests that
      // were deleted — and then there is no paper to open. That is a real
      // outcome, not a failure, so accept either and only assert the marking
      // block when a paper actually opened.
      await page.waitForSelector(".review-item, .login-error", { timeout: 30000 });
    }
    if (markCard && (await page.$(".review-item"))) {
      const marking = await page.evaluate(() => ({
        cols: getComputedStyle(document.querySelector(".ed-cols")).gridTemplateColumns.split(" ").length,
        award: !!document.querySelector("#mk-buttons"),
        release: !!document.querySelector("#mk-release"),
        solution: !!document.querySelector(".solution"),
      }));
      check(marking.cols === 3, `marking uses the three-column paper view (${marking.cols})`);
      check(marking.award, "with the marks row under the answer it belongs to");
      check(marking.release, "and Release on the same screen");
      check(marking.solution, "the model solution is beside it, as the student will see it");
      await shot("teacher-marking");
    } else if (markCard) {
      check(
        await page.isVisible(".login-error"),
        "an answer whose test is gone says so instead of opening an empty paper"
      );
    } else {
      console.log("SKIP  marking queue (nothing waiting to mark)");
    }

    // Subjects: a signed-in teacher lands here, and a subject card opens the
    // page where that subject's tests live.
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 20000 });
    check(true, "a signed-in teacher lands on the subjects grid");
    await shot("subjects");
    // Your subjects means subjects you own. Built-in shelves are read from
    // Browse and picked when creating a subject or a test; they are not here,
    // and they are not in the editor's subject picker either.
    check(
      (await page.$$("#sub-grid .subject-card-builtin")).length === 0,
      "no built-in shelf on Your subjects"
    );
    check(await page.isVisible('[data-rail="browse"]'), "the rail offers Browse tests");
    await page.click('[data-rail="browse"]');
    // Wait for Browse's own loaded state: Your subjects is a ".subjects" page
    // too, and Browse paints its title over a skeleton before the data lands.
    await page.waitForSelector("#br-subjects", { timeout: 25000 });
    const shelfCard = await page.$(".subjects .subject-card-builtin[data-subject]");
    check(!!shelfCard, "Browse lists the built-in shelves");
    if (shelfCard) {
      await shot("browse");
      await shelfCard.click();
      await page.waitForSelector(".br-list .br-row, .ed-panel .hint", { timeout: 30000 });
      const rows = await page.$$(".br-list .br-row");
      check(rows.length >= 1, `the shelf lists its tests as catalogue rows (${rows.length})`);
      check(await page.isVisible(".br-row .br-use"), "each row offers Use this test");
      const admin = !!process.env.E2E_ADMIN_USER;
      check(
        (await page.$$(".br-row .br-edit")).length > 0 === admin,
        admin ? "an admin gets Edit on a built-in test" : "a teacher gets no Edit on a built-in test"
      );
      if (rows.length) {
        await page.click(".br-row .br-preview");
        await page.waitForSelector(".ed-readonly .ed-explain", { timeout: 30000 });
        check(true, "a built-in test opens read-only with its explanation");
        await shot("browse-test");
      }
    }
    await page.click('[data-rail="subjects"]');
    await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 25000 });
    const owned = await page.$(".subject-card[data-subject]:not(.subject-card-builtin)");
    if (owned) {
      await owned.click();
      // A subject opens the authoring editor scoped to it, not a table.
      await page.waitForSelector(".editor:not(.sk-wrap) .ed-tree", { timeout: 30000 });
      check(true, "clicking a subject opens the authoring editor");
      check(await page.isVisible("#ed-new-test"), "the editor's tree offers Create");
      check(
        !(await page.evaluate(() =>
          [...document.querySelectorAll("#ed-subject option")].some((o) => /built in/i.test(o.textContent))
        )),
        "the editor's subject picker lists no built-in shelf"
      );
      await page.click("#ed-exit");
      await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 20000 });
      check(true, "the editor returns to all subjects");
      // The bug that started this: ?edit= must not survive leaving the editor.
      check(!/edit=/.test(page.url()), "leaving the editor clears ?edit= from the url");
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 25000 });
      check(true, "a reload lands on subjects, not a stale editor");
    } else {
      console.log("SKIP  subject routing (no teacher-owned subject)");
    }

    // A subject with no tests opens the same shell, with an empty tree.
    // Created and removed here so the check does not depend on live data.
    const probe = `E2E${Date.now().toString().slice(-6)}`;
    // The modal must never let a placeholder pass for a value: the old inline
    // form pre-filled board and class and left subject showing only a
    // placeholder, so a form that looked complete failed with "Board, class and
    // subject are all needed" and named no field in particular.
    await page.click("#sub-new");
    await page.waitForSelector(".modal", { timeout: 15000 });
    // Step 1 asks what you teach; the three fields live behind "Something else".
    check(
      (await page.textContent("#modal-count")).trim() === "Step 1 of 2",
      "New subject opens on step 1 of 2"
    );
    check(
      (await page.$$(".modal-card")).length >= 2,
      "the built-in subjects are offered as cards"
    );
    check(
      !(await page.isVisible('.modal-input[name="subject"]')),
      "the taxonomy fields are not asked up front"
    );
    await page.click('.modal-card:has(input[value="__custom__"])');
    await page.click(".modal-submit");
    await page.waitForSelector('.modal-input[name="subject"]:visible', { timeout: 10000 });
    check(
      (await page.textContent("#modal-count")).trim() === "Step 2 of 2",
      "choosing Something else advances to the fields"
    );
    await page.fill('.modal-input[name="klass"]', "10");
    await page.click(".modal-submit");
    await page.waitForSelector(".modal-error:not([hidden])", { timeout: 10000 });
    check(
      (await page.textContent(".modal-error")).trim() === "Subject is needed.",
      "an empty required field is named, not lumped in with the filled ones"
    );
    check(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("name") === "subject"
      ),
      "and the cursor lands in it"
    );
    await page.keyboard.press("Escape");
    await page.waitForSelector(".modal", { state: "detached", timeout: 10000 });

    await page.click("#sub-new");
    // Creating anything small goes through the shared modal now.
    await page.waitForSelector(".modal", { timeout: 15000 });

    // A built-in card leads to that shelf's tests, and the button counts them.
    await page.click(".modal-card:has(.modal-card-badge)");
    await page.click(".modal-submit");
    await page.waitForSelector(".modal-bulk", { timeout: 10000 });
    check(
      !(await page.isVisible('.modal-input[name="subject"]')),
      "picking a built-in subject never asks for board, class and subject"
    );
    const ticks = await page.$$(".modal-step[data-step='1'] fieldset:not([hidden]) .modal-choice-input");
    check(ticks.length > 1, `that shelf's tests are listed (${ticks.length})`);
    check(
      (await page.textContent(".modal-submit")).trim() === "Create subject",
      "with nothing ticked the button offers an empty subject"
    );
    await ticks[0].click();
    await page.waitForTimeout(200);
    check(
      (await page.textContent(".modal-submit")).trim() === "Create with 1 test",
      `the button counts what is ticked (got "${(await page.textContent(".modal-submit")).trim()}")`
    );
    await page.click(".modal-bulk [data-bulk-none]");
    await page.waitForTimeout(200);
    check(
      (await page.textContent(".modal-submit")).trim() === "Create subject",
      "Clear empties the selection"
    );
    // Back returns to step 1 with the choice intact, then take the custom path.
    await page.click(".modal-back");
    await page.waitForTimeout(200);
    check(
      (await page.textContent("#modal-count")).trim() === "Step 1 of 2",
      "Back returns to step 1"
    );
    await page.click('.modal-card:has(input[value="__custom__"])');
    await page.click(".modal-submit");
    await page.waitForSelector('.modal-input[name="subject"]:visible', { timeout: 10000 });
    await page.fill('.modal-input[name="board"]', "CBSE");
    await page.fill('.modal-input[name="klass"]', "12");
    await page.fill('.modal-input[name="subject"]', probe);
    await page.click(".modal-submit");
    await page.waitForSelector(".modal", { state: "detached", timeout: 25000 });
    const card = `.subject-card:has(.subject-name:text-is("CBSE Class 12 ${probe}"))`;
    try {
      await page.waitForSelector(card, { timeout: 25000 });
      await page.click(card);
      await page.waitForSelector(".editor:not(.sk-wrap) .ed-tree", { timeout: 30000 });
      check(await page.isVisible("#ed-new-test"), "an empty subject opens the editor shell");
      check((await page.$$(".ed-node")).length === 0, "the empty subject's tree has no tests");
      check(await page.isVisible("#ed-empty-create"), "the empty shell offers Create the first test");
      await page.click("#ed-exit");
      await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 20000 });
    } finally {
      page.once("dialog", (d) => d.accept());
      const del = await page.$(`${card} .subject-del`);
      if (del) {
        await del.click();
        await page.waitForSelector(card, { state: "detached", timeout: 20000 }).catch(() => {});
      }
      console.log(`  (cleaned up subject ${probe})`);
    }

    // ---- The student's workspace ----------------------------------------
    // A student lands on their subjects, opens one, and gets the tree of tests
    // with one question beside it — the teacher's authoring shape, read-only.
    // Sitting the test has no explanation panel; the released result does.
    // Everything here is thrown away again at the end: subject, tests, student.
    const wsId = "e2e-workspace-" + Math.random().toString(36).slice(2, 7);
    const wsQuestions = (n) => [
      { id: `${n}q1`, chapter: "Matrices", topic: "Order", type: "mcq",
        q: "Order of a $2\\times3$ matrix?", options: ["2x3", "3x2", "6", "2"], answer: 0,
        // `source` is rebuilt from scratch server-side, so a round trip is the
        // only thing that proves it is carried rather than silently dropped.
        source: "CBSE 2026", solution: "Rows then columns.", marks: 1 },
      { id: `${n}q2`, chapter: "Matrices", topic: "Determinant", type: "numeric",
        q: "$\\det(I_2)$?", answer: 1, tolerance: 0, solution: "The identity has determinant 1.", marks: 2 },
      { id: `${n}q3`, chapter: "Matrices", topic: "Proof", type: "long",
        q: "Prove $(AB)^T=B^TA^T$.", solution: "Compare entries.", marks: 5 },
    ];
    const wsTests = [
      { id: wsId + "-a", title: "E2E workspace A", chapter: "Matrices", teacher: null, questions: wsQuestions("a") },
      { id: wsId + "-b", title: "E2E workspace B", chapter: "Matrices", teacher: null, questions: wsQuestions("b") },
    ];
    const ws = await page.evaluate(async (tests) => {
      const auth = JSON.parse(localStorage.getItem("vidai:auth"));
      const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": "1" };
      const post = (url, body) =>
        fetch(url, { method: "POST", headers: hdr, body: JSON.stringify(body) })
          .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
      const subject = await post("/api/subjects", {
        action: "create", board: "CBSE", klass: "12", subject: "E2EWorkspace",
      });
      const subjectId = subject.data.subject?.id;
      let published = 0;
      for (const test of tests) {
        await post("/api/tests", { action: "create", test: { ...test, subjectId } });
        const r = await post("/api/tests", { action: "publish", id: test.id });
        if (r.status === 200 || r.status === 201) published++;
      }
      // A draft, left as one: a draft must reach nobody, however it is assigned.
      const draft = { ...tests[0], id: tests[0].id + "-draft", title: "E2E workspace draft" };
      await post("/api/tests", { action: "create", test: { ...draft, subjectId } });
      const student = await post("/api/students", { name: "E2E Workspace Student", grade: "12", school: "E2E" });
      const other = await post("/api/students", { name: "E2E Other Student", grade: "12", school: "E2E" });
      return {
        subjectId,
        published,
        draftId: draft.id,
        username: student.data.username,
        password: student.data.password,
        other: other.data.username,
        otherPassword: other.data.password,
      };
    }, wsTests);
    // The admin session, parked for cleanup: the student signs in below and
    // their cookie replaces it, and cleanup as a student would be refused.
    const wsAdmin = await keepSession();
    const wsAdminProfile = await page.evaluate(() => localStorage.getItem("vidai:auth"));

    try {
      if (ws.published !== wsTests.length || !ws.username) {
        check(false, `workspace fixture could not be published (${ws.published}/${wsTests.length})`);
      } else {
        await page.evaluate(() => localStorage.clear());
        await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
        await page.click("#student-btn");
        await page.fill("#su-user", ws.username);
        await page.fill("#su-pass", ws.password);
        await page.click("#su-submit");
        await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 25000 });
        check(true, "a student lands on the subjects they are assigned");
        check(
          !!(await page.$(`.subject-card[data-subject='${ws.subjectId}']`)),
          "their teacher's subject is one of them"
        );

        const wsSubjectTitle = await page.getAttribute(
          `.subject-card[data-subject='${ws.subjectId}']`, "data-title"
        );
        await page.click(`.subject-card[data-subject='${ws.subjectId}']`);
        await page.waitForSelector(".st-workspace .test-list", { timeout: 25000 });
        check((await page.$$(".test-list .test-card[data-test]")).length === 2, "a subject opens its tests as a list");
        // The subject page is that list and nothing else: the app bar already
        // names the subject, so a crumb row repeating it and a drawer holding
        // a second copy of the list were both noise.
        const subjPage = await page.evaluate(() => ({
          toggle: !!document.querySelector("[data-drawer-toggle]"),
          tree: !!document.querySelector("#st-tree"),
          crumb: !!document.querySelector(".ed-crumbrow"),
        }));
        check(!subjPage.toggle && !subjPage.tree, "with no Tests drawer duplicating it");
        check(!subjPage.crumb, "and no crumb row repeating the subject's name");
        // With no subtitle the app bar's second grid row must collapse. A row
        // gap left it drawn, and the title — placed in row 1 only — rode a few
        // pixels above the brand that spans both.
        const barMid = await page.evaluate(() => {
          const mid = (sel) => {
            const r = document.querySelector(sel).getBoundingClientRect();
            return r.top + r.height / 2;
          };
          return {
            title: mid("#shellbar-title"),
            brand: mid(".shellbar-brand"),
            subHidden: document.querySelector("#shellbar-sub").hidden,
          };
        });
        check(barMid.subHidden, "the subject's bar carries no subtitle line");
        check(
          Math.abs(barMid.title - barMid.brand) <= 1,
          `and the name is centred beside the V (${barMid.title.toFixed(1)} vs ${barMid.brand.toFixed(1)})`
        );
        // The card is a row of two, and the left half has to be able to shrink
        // or the status chip is pushed out past the card's own right edge.
        const cardFit = await page.evaluate(() => {
          const card = document.querySelector(".test-card[data-test]");
          const chip = card.querySelector(".status-chip");
          return {
            chipRight: Math.round(chip.getBoundingClientRect().right),
            cardRight: Math.round(card.getBoundingClientRect().right),
          };
        });
        check(
          cardFit.chipRight <= cardFit.cardRight,
          `the status chip stays inside the card (${cardFit.chipRight} of ${cardFit.cardRight})`
        );

        await page.click(`.test-card[data-test='${wsTests[0].id}']`);
        await page.waitForSelector(".ed-center .question-text", { timeout: 25000 });
        const wsShape = await page.evaluate(() => ({
          shown: document.querySelectorAll(".ed-center .question-text").length,
          rows: document.querySelectorAll("#st-tree .ed-tree-q").length,
          roots: document.querySelectorAll("#st-tree .st-test").length,
          cols: getComputedStyle(document.querySelector(".ed-cols")).gridTemplateColumns.split(" ").length,
          explain: document.querySelectorAll(".ed-explain").length,
          solution: document.querySelectorAll(".solution").length,
        }));
        check(wsShape.shown === 1, `one question on screen, never the whole paper (${wsShape.shown})`);
        check(wsShape.rows === 3, `its questions are listed beside it (${wsShape.rows})`);
        check(wsShape.roots === 0, "as a flat list, not a folder of every test in the subject");
        check(wsShape.cols === 2, `sitting a test has no third column (${wsShape.cols})`);
        check(wsShape.explain === 0 && wsShape.solution === 0, "no explanation and no solution while sitting it");
        check(
          (await page.textContent(".ed-center .chip-source").catch(() => "")) === "CBSE 2026",
          "and the question says which exam it came from"
        );

        // The button layout J drew: Hand in test up on the breadcrumb row, and
        // Previous · count · Clear · Next as one row at the foot of the answer
        // card. Save is gone — an answer saves itself the moment it is given,
        // so what is left in that slot is the way back out.
        // Clear is hidden until there is an answer, so give it one first.
        await page.click(".ed-student .option");
        await page.waitForSelector("#st-clear:not([hidden])", { timeout: 15000 });
        const wsButtons = await page.evaluate(() => {
          const box = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom }; };
          return {
            handinInCrumb: !!document.querySelector(".ed-crumbrow .st-handin"),
            prev: box("#st-prev"), save: box("#st-clear"), next: box("#st-next"),
            noSave: !document.querySelector("#st-save"),
            clearInHead: !!document.querySelector(".ed-panel-head #st-clear"),
            count: box(".st-count"),
            panel: box(".ed-body .ed-panel:last-of-type"),
          };
        });
        check(wsButtons.handinInCrumb, "Hand in test sits on the breadcrumb row");
        check(wsButtons.noSave, "there is no Save button — answers save themselves");
        check(
          Math.abs(wsButtons.prev.y - wsButtons.next.y) < 4,
          "Previous and Next share one row"
        );
        check(
          wsButtons.prev.x < wsButtons.count.x && wsButtons.count.right <= wsButtons.next.x,
          "in the order Previous · count · Next"
        );
        // Clear acts on the answer, so it sits with the answer's own status
        // rather than in the steps row — above them, never beside Next.
        check(
          !!wsButtons.clearInHead && wsButtons.save.bottom <= wsButtons.prev.y,
          "and Clear answer sits up in the answer panel's head, above the steps"
        );
        check(
          wsButtons.next.right <= wsButtons.panel.right + 1 && wsButtons.prev.x >= wsButtons.panel.x - 1,
          "and the row stays inside the answer card"
        );

        // Answered in any order, and revisitable. Picking the option IS the
        // save: this is the bug that lost answers when a student tapped Next.
        await page.click(".ed-student .option[data-i='0']");
        await page.waitForFunction(
          () => document.querySelectorAll("#st-tree .st-answered").length === 1,
          { timeout: 15000 }
        );
        check(true, "picking an option saves it and ticks the question");
        // And Clear takes it back off, so the question can be left for later.
        await page.click("#st-clear");
        await page.waitForFunction(
          () => document.querySelectorAll("#st-tree .st-answered").length === 0,
          { timeout: 15000 }
        );
        check(
          !(await page.$(".ed-student .option.selected")),
          "Clear unticks it and deselects the option"
        );
        await page.click(".ed-student .option[data-i='0']");
        await page.waitForFunction(
          () => document.querySelectorAll("#st-tree .st-answered").length === 1,
          { timeout: 15000 }
        );
        await page.click("#st-tree .ed-tree-q[data-i='2']");
        await page.waitForSelector("#st-upload", { timeout: 15000 });
        check(true, "a later question can be opened before the one before it");
        await page.click("#st-tree .ed-tree-q[data-i='1']");
        await page.waitForSelector("#st-num", { timeout: 15000 });
        await page.fill("#st-num", "1");
        // A typed number settles before it saves; leaving the box commits at once.
        await page.click(".ed-center .question-text");
        await page.waitForFunction(
          () => document.querySelectorAll("#st-tree .st-answered").length === 2,
          { timeout: 15000 }
        );
        check(true, "a typed number saves itself on blur, answered out of order");

        // A refresh lands back on the same question.
        const wsBefore = await page.evaluate(() => new URLSearchParams(location.search).get("q"));
        await page.reload({ waitUntil: "domcontentloaded" });
        await page.waitForSelector(".ed-center .question-text", { timeout: 25000 });
        const wsAfter = await page.evaluate(() => new URLSearchParams(location.search).get("q"));
        check(!!wsBefore && wsBefore === wsAfter, `a refresh stays on the question (${wsBefore} → ${wsAfter})`);

        // One test at a time: the other one is locked while this is open.
        await page.click("#st-back");
        await page.waitForSelector(".st-workspace .test-list", { timeout: 20000 });
        check(
          (await page.textContent("#shellbar-title")) === wsSubjectTitle,
          "Back returns to the subject's tests, with the subject named in the bar"
        );
        const wsLocks = await page.$$eval(".test-list .test-card[data-test]", (n) =>
          n.map((e) => ({ id: e.dataset.test, disabled: e.disabled })));
        check(
          wsLocks.find((t) => t.id === wsTests[1].id)?.disabled === true,
          "another test is locked while one is in progress"
        );
        check(
          wsLocks.find((t) => t.id === wsTests[0].id)?.disabled === false,
          "and the one in progress stays open"
        );

        // Hand in: the score, with the paper still shut.
        await page.click(`.test-card[data-test='${wsTests[0].id}']`);
        await page.waitForSelector("#st-submit", { timeout: 20000 });
        page.once("dialog", (d) => d.accept());
        await page.click("#st-submit");
        // A student gets no score screen. Handing in returns them to their
        // subject, with the paper readable but silent: marks are the teacher's
        // to give, and a number on the way out is a half-truth while every
        // long answer is unmarked.
        await page.waitForSelector(".st-workspace .test-list", { timeout: 25000 });
        check(
          !(await page.$(".score-card")),
          "handing in shows no score screen"
        );
        check(
          await page.isVisible(".st-handed"),
          "it lands back on the subject, saying the paper is in"
        );
        await shot("student-handed-in");
        // The paper opens read-only: what they answered, and nothing else.
        await page.click(`.test-card[data-test='${wsTests[0].id}']`);
        await page.waitForSelector(".review-item", { timeout: 25000 });
        const shut = await page.evaluate(() => ({
          cols: getComputedStyle(document.querySelector(".ed-cols")).gridTemplateColumns.split(" ").length,
          solution: !!document.querySelector(".solution"),
          correct: !!document.querySelector(".review-correct"),
          retake: !!document.querySelector("#retake-btn"),
          given: (document.querySelector(".review-given") || {}).textContent || "",
          chips: [...document.querySelectorAll(".ed-panel-head .status-chip")].map((c) => c.textContent.trim()),
          marks: [...document.querySelectorAll("#rv-tree .ed-tree-marks")].map((m) => m.textContent.trim()),
        }));
        check(shut.cols === 2, `a handed-in paper has no explanation column (${shut.cols})`);
        check(!shut.solution, "and no worked solution");
        check(!shut.correct, "and never says what the correct answer was");
        check(!shut.retake, "and offers no Try again until the teacher releases it");
        check(/answer/i.test(shut.given), `but does show what was answered ("${shut.given.slice(0, 40)}")`);
        check(
          shut.chips.every((c) => /answered/i.test(c)),
          `no verdict on any question, only whether it was answered (${shut.chips.join(", ")})`
        );
        check(
          shut.marks.every((m) => !m.includes("/")),
          `and no marks in the question list (${shut.marks.join(" ")})`
        );
        await shot("student-paper-shut");

        // Released, the result view is the three-column one, explanation and all.
        const studentJar = await keepSession();
        await putSession(wsAdmin);
        const wsReleased = await page.evaluate(async ({ id, username }) =>
          fetch("/api/release", {
            method: "POST",
            headers: { "Content-Type": "application/json", "X-Vidai-Auth": "1" },
            body: JSON.stringify({ action: "release", testId: id, username }),
          }).then((r) => r.status),
          { id: wsTests[0].id, username: ws.username }
        );
        await putSession(studentJar);
        check(wsReleased === 200, `the teacher releases the paper (${wsReleased})`);
        await page.goto(BASE + `/?test=${wsTests[0].id}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector(".review-item", { timeout: 25000 });
        const wsResult = await page.evaluate(() => ({
          cols: getComputedStyle(document.querySelector(".ed-cols")).gridTemplateColumns.split(" ").length,
          solution: !!document.querySelector(".review-item .solution"),
        }));
        check(wsResult.cols === 3, `the result view brings back the third column (${wsResult.cols})`);
        check(wsResult.solution, "and shows the explanation beside the question");
        // Release is also what puts the marks and Try again back.
        const nowOpen = await page.evaluate(() => ({
          retake: !!document.querySelector("#retake-btn"),
          marks: [...document.querySelectorAll("#rv-tree .ed-tree-marks")].map((m) => m.textContent.trim()),
        }));
        check(
          nowOpen.marks.some((m) => m.includes("/")),
          `the released paper shows the marks (${nowOpen.marks.join(" ")})`
        );
        check(nowOpen.retake, "and Try again is offered once it is open");
        await shot("student-paper-open");

        // The result screen used to have no way to reach the question list on a
        // phone at all: its bottom tabs switch panes, and nothing opened the tree.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.reload({ waitUntil: "domcontentloaded" });
        // The trigger sits in the app bar on a phone, not inside the result view.
        await page.waitForSelector("[data-drawer-toggle]", { timeout: 25000 });
        check(!(await page.isVisible("#rv-tree .ed-tree-q")), "the result's question list starts closed on a phone");
        await page.click("[data-drawer-toggle]");
        await page.waitForSelector("#rv-tree .ed-tree-q:visible", { timeout: 10000 });
        check(true, "and opens from the same Questions button");
        await page.keyboard.press("Escape");
        // The bottom tab bar is gone from the paper. Two of its three tabs did
        // nothing — the [data-pane] rules only hide .ed-pane-* panels, which
        // exist in the authoring editor and not here — and the third only
        // un-hid the explanation, which now simply stacks under the answer.
        const paper = await page.evaluate(() => {
          const ex = document.querySelector(".ed-explain");
          return {
            tabs: !!document.querySelector(".ed-paper .ed-tabs"),
            pane: document.querySelector(".ed-paper")?.getAttribute("data-pane"),
            explainShown: ex ? getComputedStyle(ex).display !== "none" : null,
            navPos: getComputedStyle(document.querySelector(".st-navrow")).position,
            navBottom: Math.round(document.querySelector(".st-navrow").getBoundingClientRect().bottom),
            vh: window.innerHeight,
          };
        });
        check(!paper.tabs && !paper.pane, "the handed-in paper has no bottom tab bar");
        if (paper.explainShown !== null) {
          check(paper.explainShown, "and its explanation stacks under the answer, no tab to press");
        }
        // A short paper is the case sticky could not hold: its panel ends
        // mid-screen, so there was nothing for sticky to pull against.
        check(
          paper.navPos === "fixed" && Math.abs(paper.navBottom - paper.vh) <= 1,
          `Previous and Next sit on the floor even on a short paper (${paper.navBottom} of ${paper.vh})`
        );
        await page.setViewportSize({ width: 1280, height: 900 });


        // ---- Who sees a test ------------------------------------------
        // Publishing shares with everyone the teacher created; assignment
        // narrows it to named students. A draft reaches nobody either way.
        // Three identities at once — teacher, student A, student B — which one
        // cookie jar cannot hold. The teacher stays in the page; the two
        // students run from Node, each with their own jar.
        //
        // The page is signed in as the student who just sat the test, so the
        // teacher's jar goes back first: without it every call below runs as
        // that student and answers 403.
        const wsStudentJar = await keepSession();
        await putSession(wsAdmin);
        const audience = await (async () => {
          const tests = wsTests;
          const teacher = (path, init) =>
            page.evaluate(
              async ({ path, init }) => {
                const res = await fetch(path, {
                  ...init,
                  headers: { "Content-Type": "application/json", "X-Vidai-Auth": "1", ...(init.headers || {}) },
                });
                return { status: res.status, data: await res.json().catch(() => ({})) };
              },
              { path, init: init || {} }
            );
          const post = (body) =>
            teacher("/api/tests", { method: "POST", body: JSON.stringify(body) });

          const seenBy = async (jar, id) => {
            const one = await asStudent(jar, `/api/tests?id=${encodeURIComponent(id)}`);
            const list = await asStudent(jar, "/api/tests").then((r) => r.json().catch(() => ({})));
            const subjects = await asStudent(jar, "/api/subjects").then((r) => r.json().catch(() => ({})));
            const row = (list.tests || []).find((t) => t.id === id);
            return {
              one: one.status,
              listed: !!row,
              leaksRoster: !!row && row.assignedTo !== undefined,
              subjects: (subjects.subjects || []).map((x) => x.id),
            };
          };

          const a = await signInStudent(ws.username, ws.password);
          const b = await signInStudent(ws.other, ws.otherPassword);
          if (!a || !b) return { skip: true };

          // Test B starts shared with the class: both students can open it.
          const classWide = {
            a: await seenBy(a, tests[1].id),
            b: await seenBy(b, tests[1].id),
          };

          // Narrow it to the first student only.
          const assigned = await post({
            action: "assign",
            id: tests[1].id,
            audience: "selected",
            usernames: [ws.username],
          });
          const narrowed = {
            a: await seenBy(a, tests[1].id),
            b: await seenBy(b, tests[1].id),
          };

          // Someone else's student cannot be assigned.
          const stranger = await post({
            action: "assign",
            id: tests[1].id,
            audience: "selected",
            usernames: ["no-such-student-xyz"],
          });
          // Nor an empty list posing as "selected" — that would read as nobody.
          const empty = await post({
            action: "assign",
            id: tests[1].id,
            audience: "selected",
            usernames: [],
          });

          // With every test in the subject narrowed away from B, the subject
          // card must go too — a subject is only theirs through its tests.
          await post({ action: "assign", id: tests[0].id, audience: "selected", usernames: [ws.username] });
          const subjectGone = {
            b: (await seenBy(b, tests[0].id)).subjects,
            a: (await seenBy(a, tests[0].id)).subjects,
          };
          await post({ action: "assign", id: tests[0].id, audience: "class", usernames: [] });

          // Where a question came from must survive the save.
          const storedSource = (
            await teacher(`/api/tests?id=${encodeURIComponent(tests[0].id)}`)
          ).data.test?.questions?.[0]?.source;

          const draft = { a: await seenBy(a, ws.draftId) };

          // An MCQ with no option marked. The API used to force it to A, so a
          // teacher who never touched the radios published a paper where A was
          // the answer to everything.
          const unmarkedId = `${ws.draftId}-unmarked`;
          const unmarked = {
            id: unmarkedId,
            title: "E2E unmarked answer",
            chapter: "Matrices",
            teacher: null,
            subjectId: ws.subjectId,
            questions: [
              {
                id: "u1",
                chapter: "Matrices",
                topic: "Order",
                type: "mcq",
                q: "Which one is right?",
                options: ["First", "Second", "Third", "Fourth"],
                answer: -1,
                solution: "The second one.",
                marks: 1,
              },
            ],
          };
          await post({ action: "create", test: unmarked });
          const storedUnmarked = (
            await teacher(`/api/tests?id=${encodeURIComponent(unmarkedId)}`)
          ).data.test?.questions?.[0]?.answer;
          const publishUnmarked = await post({ action: "publish", id: unmarkedId });
          // Unpublish first: only drafts can be deleted, so a publish that
          // unexpectedly succeeded would otherwise leave the fixture behind.
          await post({ action: "unpublish", id: unmarkedId });
          await post({ action: "delete", id: unmarkedId });

          // The teacher's own list still carries the roster.
          const teacherRow = ((await teacher("/api/tests")).data.tests || []).find(
            (t) => t.id === tests[1].id
          );

          // Put it back, so the rest of the fixture behaves as before.
          await post({ action: "assign", id: tests[1].id, audience: "class", usernames: [] });
          return {
            classWide,
            assigned: assigned.status,
            narrowed,
            stranger: stranger.status,
            empty: empty.status,
            draft,
            storedSource,
            subjectGone,
            teacherRow,
            storedUnmarked,
            publishUnmarked: publishUnmarked.status,
            publishProblems: publishUnmarked.data.problems || [],
            publishError: publishUnmarked.data.error || "",
          };
        })();
        await putSession(wsStudentJar);

        if (audience.skip) {
          check(false, "who-sees-this: the throwaway students could not sign in");
        } else {
          check(
            audience.classWide.a.listed && audience.classWide.b.listed,
            "a published test reaches everyone the teacher created"
          );
          check(audience.assigned === 200, `the teacher narrows it to named students (${audience.assigned})`);
          check(
            audience.narrowed.a.listed && audience.narrowed.a.one === 200,
            "the assigned student still sees it"
          );
          check(
            !audience.narrowed.b.listed && audience.narrowed.b.one === 403,
            `a student it was not assigned to cannot see or open it (${audience.narrowed.b.one})`
          );
          check(
            !audience.subjectGone.b.includes(ws.subjectId) && audience.subjectGone.a.includes(ws.subjectId),
            "and the subject itself stops listing for a student with no test left in it"
          );
          check(
            !audience.classWide.a.leaksRoster && !audience.narrowed.a.leaksRoster,
            "a student is never sent the class list"
          );
          check(
            Array.isArray(audience.teacherRow?.assignedTo),
            "the teacher's own list does carry it"
          );
          check(
            audience.stranger === 403 || audience.stranger === 404,
            `another teacher's student cannot be assigned (${audience.stranger})`
          );
          check(audience.empty === 400, `"selected" with nobody picked is refused (${audience.empty})`);
          check(
            !audience.draft.a.listed && audience.draft.a.one === 403,
            "a draft reaches nobody, however it is assigned"
          );
          check(
            audience.storedSource === "CBSE 2026",
            `a question's source survives the save (${audience.storedSource})`
          );
          check(
            audience.storedUnmarked === -1,
            `an unmarked MCQ answer stays unmarked, not forced to A (${audience.storedUnmarked})`
          );
          check(
            audience.publishUnmarked === 400 &&
              audience.publishProblems.some((p) => /correct option/i.test(p.reason || "")),
            `publishing it is refused, saying which question needs an answer ("${audience.publishError}")`
          );
        }


        // Phone: the tree is a drawer behind its tab, one surface at a time.
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto(BASE + `/?test=${wsTests[1].id}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#primary-btn", { timeout: 25000 });
        await page.click("#primary-btn");
        await page.waitForSelector("[data-drawer-toggle]", { timeout: 20000 });
        check(!(await page.isVisible("#st-tree .ed-tree-q")), "on a phone the tree is tucked away");
        check(
          !(await page.$(".ed-student .ed-tabs")),
          "the bottom tab bar is gone — the drawer has its own button"
        );
        // .btn carries min-width:130px, so a bare 1fr column used to push this
        // row past the card's edge on a 390px screen.
        // Clear only exists once there is something to clear, so answer first.
        const phoneOption = await page.$(".ed-student .option");
        if (phoneOption) await phoneOption.click();
        const phoneRow = await page.evaluate(() => {
          const box = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, width: b.width }; };
          return { save: box("#st-clear"), prev: box("#st-prev"), next: box("#st-next"),
                   panel: box(".ed-body .ed-panel:last-of-type"), scrollWidth: document.documentElement.scrollWidth };
        });
        check(
          phoneRow.next.right <= 390 && phoneRow.prev.x >= -1,
          "on a phone the buttons stay inside the window"
        );
        if (phoneRow.save) {
          check(
            phoneRow.save.y < phoneRow.prev.y,
            "with Clear answer above them, in the answer panel's head"
          );
          check(
            phoneRow.save.right <= phoneRow.panel.right + 1,
            "and Clear inside the card"
          );
        } else {
          console.log("SKIP  phone Clear layout (first question is not answerable in one tap)");
        }
        check(phoneRow.scrollWidth <= 390, `and nothing forces a sideways scroll (${phoneRow.scrollWidth}px)`);
        // The drawer: parked off-canvas, slides in, and the scrim shuts it.
        const parked = await page.evaluate(() => {
          const t = document.querySelector(".ed-tree");
          return { visibility: getComputedStyle(t).visibility, x: t.getBoundingClientRect().x };
        });
        check(
          parked.visibility === "hidden" && parked.x < 0,
          `the tree waits off-screen to the left (${Math.round(parked.x)}px, ${parked.visibility})`
        );
        // The mobile chrome J asked for. Inside a test the bottom bar is gone:
        // its two items are not what a student is doing, and the crumb row —
        // Back, Questions, Hand in — is the whole of what stays.
        const chrome = await page.evaluate(() => {
          const rail = document.querySelector(".rail");
          const crumb = document.querySelector(".ed-crumbrow");
          const back = crumb && crumb.querySelector(".ed-crumb-back");
          const toggle = crumb && crumb.querySelector("[data-drawer-toggle]");
          return {
            railShown: !!rail && getComputedStyle(rail).display !== "none",
            toggleInBar: !!document.querySelector("#shellbar-actions [data-drawer-toggle]"),
            toggleInCrumb: !!toggle,
            handInSameRow: !!crumb.querySelector(".st-handin"),
            backBeforeToggle: !!(back && toggle &&
              back.getBoundingClientRect().right <= toggle.getBoundingClientRect().left + 1),
            // Nothing between them: only the two buttons, the spacer and Hand in.
            crumbText: crumb.textContent.replace(/\s+/g, " ").trim(),
            barTitle: (document.querySelector("#shellbar-title") || {}).textContent || "",
            barTitleShown: document.querySelector("#shellbar-title")
              ? getComputedStyle(document.querySelector("#shellbar-title")).display
              : "none",
            barSub: (document.querySelector("#shellbar-sub") || {}).textContent || "",
            barSubShown: document.querySelector("#shellbar-sub")
              ? getComputedStyle(document.querySelector("#shellbar-sub")).display
              : "none",
          };
        });
        check(!chrome.railShown, "inside a test the bottom bar is gone — the screen is the question");
        check(
          chrome.toggleInCrumb && !chrome.toggleInBar,
          "Questions sits in the crumb row beside Hand in, where a student works"
        );
        check(
          chrome.handInSameRow,
          "and Hand in is in that same row"
        );
        check(chrome.backBeforeToggle, "with Back to the left of it");
        check(
          chrome.crumbText === "Questions Hand in test" || chrome.crumbText === "Questions Hand in",
          `and nothing in between (\"${chrome.crumbText}\")`
        );
        check(
          /\S/.test(chrome.barTitle) && chrome.barTitleShown !== "none",
          `the app bar names the test beside the logo ("${chrome.barTitle.slice(0, 40)}")`
        );
        check(
          /\S/.test(chrome.barSub) && chrome.barSubShown !== "none",
          `with its subtitle on the line under it ("${chrome.barSub.slice(0, 40)}")`
        );
        const barLines = await page.evaluate(() => {
          const t = document.querySelector("#shellbar-title").getBoundingClientRect();
          const sb = document.querySelector("#shellbar-sub").getBoundingClientRect();
          return Math.round(sb.top - t.bottom);
        });
        check(
          barLines <= 4,
          `and the two lines read as one label, not two (${barLines}px apart)`
        );
        await page.click("[data-drawer-toggle]");
        await page.waitForSelector("#st-tree .ed-tree-q:visible", { timeout: 10000 });
        // It slides, so wait for the transform to land rather than racing it.
        await page.waitForFunction(
          () => document.querySelector(".ed-tree").getBoundingClientRect().x >= 0,
          { timeout: 10000 }
        );
        const opened = await page.evaluate(() => ({
          x: document.querySelector(".ed-tree").getBoundingClientRect().x,
          top: Math.round(document.querySelector(".ed-tree").getBoundingClientRect().top),
          crumbBottom: Math.round(document.querySelector(".ed-crumbrow").getBoundingClientRect().bottom),
          scrim: getComputedStyle(document.querySelector(".ed-scrim")).display,
        }));
        check(opened.scrim === "block", `the Questions button slides it in over a scrim (at ${Math.round(opened.x)}px)`);
        // From the window's own left edge, and from under the row whose button
        // opened it — the button and the panel belong together.
        check(
          Math.round(opened.x) === 0,
          `and from the screen's left wall (${Math.round(opened.x)}px)`
        );
        check(
          Math.abs(opened.top - opened.crumbBottom) <= 2,
          `starting under the Questions button (tree ${opened.top}, crumb ends ${opened.crumbBottom})`
        );
        // With no bar to clear, the overlay runs to the floor.
        const scrimFoot = await page.evaluate(() => ({
          bottom: Math.round(document.querySelector(".ed-scrim").getBoundingClientRect().bottom),
          vh: window.innerHeight,
        }));
        check(
          scrimFoot.bottom >= scrimFoot.vh - 1,
          `the overlay runs to the floor now the bar is gone (${scrimFoot.bottom} of ${scrimFoot.vh})`
        );
        await page.mouse.click(370, 500);
        await page.waitForFunction(
          () => getComputedStyle(document.querySelector(".ed-tree")).visibility === "hidden",
          { timeout: 10000 }
        );
        check(true, "and a tap outside closes it again");

        // Scrolling: the app bar leaves with the content, the crumb row stays,
        // and the drawer still opens under the row as it sits *now* — that is
        // the measure-on-open fix, and a bind-time number would fail here.
        // A short window, so there is reliably more paper than screen.
        await page.setViewportSize({ width: 390, height: 420 });
        const scrolled = await page.evaluate(async () => {
          const doc = document.scrollingElement;
          doc.scrollTop = doc.scrollHeight;
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
          const bar = document.querySelector(".shellbar").getBoundingClientRect();
          const crumb = document.querySelector(".ed-crumbrow").getBoundingClientRect();
          return {
            scrollTop: Math.round(doc.scrollTop),
            barBottom: Math.round(bar.bottom),
            crumbTop: Math.round(crumb.top),
            crumbPos: getComputedStyle(document.querySelector(".ed-crumbrow")).position,
          };
        });
        check(scrolled.scrollTop > 0, `the page itself scrolls (${scrolled.scrollTop}px)`);
        check(
          scrolled.barBottom <= 0,
          `the app bar scrolls away with the content (ends at ${scrolled.barBottom})`
        );
        check(
          scrolled.crumbPos === "sticky" && scrolled.crumbTop <= 1 && scrolled.crumbTop >= -1,
          `and the Questions / Hand in row sticks to the top (${scrolled.crumbTop})`
        );
        await page.click("[data-drawer-toggle]");
        await page.waitForFunction(
          () => document.querySelector(".ed-tree").getBoundingClientRect().x >= 0,
          { timeout: 10000 }
        );
        const afterScroll = await page.evaluate(() => ({
          top: Math.round(document.querySelector(".ed-tree").getBoundingClientRect().top),
          crumbBottom: Math.round(document.querySelector(".ed-crumbrow").getBoundingClientRect().bottom),
        }));
        check(
          Math.abs(afterScroll.top - afterScroll.crumbBottom) <= 2,
          `the drawer still starts under that row once scrolled (tree ${afterScroll.top}, crumb ends ${afterScroll.crumbBottom})`
        );
        await page.keyboard.press("Escape");
        await page.evaluate(() => { document.scrollingElement.scrollTop = 0; });
        await page.setViewportSize({ width: 390, height: 844 });

        // Previous and Next ride the floor of the window while there is still
        // paper below them, with the count above rather than under a thumb.
        const pinned = await page.evaluate(() => {
          const row = document.querySelector(".st-navrow");
          const r = row.getBoundingClientRect();
          const count = document.querySelector(".st-count").getBoundingClientRect();
          const prev = document.querySelector("#st-prev").getBoundingClientRect();
          const last = [...document.querySelectorAll(".ed-center .ed-panel")].pop();
          return {
            position: getComputedStyle(row).position,
            bottom: Math.round(r.bottom),
            top: Math.round(r.top),
            vh: window.innerHeight,
            countAbove: count.bottom <= prev.top + 1,
            // Nothing may end underneath the bar.
            lastPanelBottom: Math.round(last.getBoundingClientRect().bottom),
            clearInNav: !!document.querySelector(".st-navrow #st-clear"),
            clearInHead: !!document.querySelector(".ed-panel-head #st-clear"),
          };
        });
        check(pinned.position === "fixed", "the steps row is a bottom bar, not a row in the page");
        check(
          Math.abs(pinned.bottom - pinned.vh) <= 1,
          `Previous and Next sit on the floor of the window (row ends ${pinned.bottom} of ${pinned.vh})`
        );
        check(pinned.countAbove, "with the answered count on the line above them");
        check(
          !pinned.clearInNav && pinned.clearInHead,
          "and Clear answer up with the answer it clears, never under a thumb aiming for Next"
        );

        // The bottom bar itself: it belongs to the subject picker, which is the
        // one screen that is not full-bleed.
        await page.click("#shellbar-home");
        await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 25000 });
        check(true, "the V in the app bar goes back to the subjects");
        const railHome = await page.evaluate(() => {
          const rail = document.querySelector(".rail").getBoundingClientRect();
          return { y: Math.round(rail.y), w: Math.round(rail.width), vh: innerHeight, vw: innerWidth };
        });
        check(
          railHome.y > railHome.vh / 2 && railHome.w === railHome.vw,
          `and there the rail is a bottom bar (y ${railHome.y} of ${railHome.vh}, ${railHome.w}px wide)`
        );
        await page.setViewportSize({ width: 1280, height: 900 });

        // The editor says what a draft means — the sentence J went hunting for.
        await putSession(wsAdmin);
        await page.evaluate((stored) => {
          if (stored) localStorage.setItem("vidai:auth", stored);
        }, wsAdminProfile);
        await page.goto(BASE + `/?edit=${ws.draftId}`, { waitUntil: "domcontentloaded" });
        await page.waitForSelector("#ed-audience", { timeout: 30000 });
        const draftNote = await page.textContent("#shellbar-sub");
        check(
          /cannot see this yet/i.test(draftNote || ""),
          `the editor says a draft reaches nobody ("${(draftNote || "").trim()}")`
        );
        check(await page.isVisible("#ed-audience"), "and offers Who sees this");

        // ---- The built-in library ---------------------------------------
        // A master (platform) test is the library copy: teachers may take
        // their own copy of it, students never see it directly.
        const lib = await page.evaluate(async ({ questions }) => {
          const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": "1" };
          const post = (url, body) =>
            fetch(url, { method: "POST", headers: hdr, body: JSON.stringify(body) })
              .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
          const get = (url) =>
            fetch(url, { headers: hdr })
              .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

          // The taxonomy is deliberately unique, so the copy lands in a subject
          // of its own that cleanup can remove without touching a real one.
          const libSubject = await post("/api/subjects", {
            action: "create", platform: true, board: "CBSE", klass: "12", subject: "E2ELibrary",
          });
          const libSubjectId = libSubject.data.subject?.id;
          const masterId = "e2e-master-" + Math.random().toString(36).slice(2, 7);
          const master = {
            id: masterId, title: "E2E library master", chapter: "Matrices", teacher: null,
            platform: true, subjectId: libSubjectId, questions,
          };
          await post("/api/tests", { action: "create", test: master });
          const pub = await post("/api/tests", { action: "publish", id: masterId });
          const listed = await get("/api/tests?library=1");
          const inLibrary = (listed.data.tests || []).find((t) => t.id === masterId) || null;

          // The shelf itself: it lists for staff, it filters, and it is not
          // the teacher's to rename.
          const staffSubjects = (await get("/api/subjects")).data.subjects || [];
          const shelfRow = staffSubjects.find((x) => x.id === libSubjectId) || null;
          const filtered = await get(`/api/tests?library=1&subjectId=${libSubjectId}`);
          const otherShelf = await get("/api/tests?library=1&subjectId=nosuchsubject");

          const adopted = await post("/api/tests", { action: "adopt", id: masterId });
          const copy = adopted.data.test || null;
          const masterAfter = await get(`/api/tests?id=${masterId}`);

          return {
            masterId, libSubjectId, shelfRow,
            filteredIds: (filtered.data.tests || []).map((t) => t.id),
            otherShelfCount: (otherShelf.data.tests || []).length,
            published: pub.status, inLibrary,
            copy, adoptStatus: adopted.status,
            masterQuestions: (masterAfter.data.test?.questions || []).length,
            masterStatus: masterAfter.data.test?.status,
            copySource: (copy && (await get(`/api/tests?id=${copy.id}`)).data.test?.questions?.[0]?.source) || "",
          };
        }, { questions: wsQuestions("lib") });

        // The student's view, from their own jar: the master itself is not
        // available to them, and its shelf is not among their subjects.
        const libJar = await signInStudent(ws.username, ws.password);
        lib.studentStatus = libJar
          ? (await asStudent(libJar, `/api/tests?id=${lib.masterId}`)).status
          : 0;
        lib.studentSubjects = libJar
          ? (
              ((await asStudent(libJar, "/api/subjects").then((r) => r.json().catch(() => ({}))))
                .subjects || []).map((x) => x.id)
          )
          : [];

        try {
          check(lib.published === 200, `a master test publishes into the library (${lib.published})`);
          check(!!lib.inLibrary, "GET /api/tests?library=1 lists it for a teacher");
          check(lib.inLibrary && lib.inLibrary.adopted === false, "and says it has not been copied yet");
          check(lib.adoptStatus === 201 && !!lib.copy, `adopt makes a copy (${lib.adoptStatus})`);
          if (lib.copy) {
            check(lib.copy.id !== lib.masterId, `the copy has an id of its own (${lib.copy.id})`);
            check(lib.copy.status === "draft", "the copy arrives as the teacher's draft");
            check(!lib.copy.platform, "and is no longer a library test");
            check(lib.copy.questionCount === 3, `it carries every question (${lib.copy.questionCount})`);
            check(lib.copySource === "CBSE 2026", `the board-year tags survive the copy ("${lib.copySource}")`);
          }
          check(lib.masterQuestions === 3 && lib.masterStatus === "published", "the master itself is untouched");
          check(!!lib.shelfRow && lib.shelfRow.platform === true, "the shelf lists for staff as a platform subject");
          check(
            lib.filteredIds.length === 1 && lib.filteredIds[0] === lib.masterId,
            `?library=1&subjectId= returns only that shelf's chapters (${lib.filteredIds.length})`
          );
          check(lib.otherShelfCount === 0, `and nothing for a shelf with no chapters (${lib.otherShelfCount})`);
          check(
            !lib.studentSubjects.includes(lib.libSubjectId),
            "a student never sees the shelf among their subjects"
          );
          check(lib.studentStatus === 403, `a student cannot open the master directly (${lib.studentStatus})`);
        } finally {
          await putSession(wsAdmin);
          await page.evaluate(async ({ masterId, copyId, subjectId }) => {
            const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": "1" };
            const post = (url, body) =>
              fetch(url, { method: "POST", headers: hdr, body: JSON.stringify(body) }).then((r) => r.status);
            for (const id of [masterId, copyId]) {
              if (!id) continue;
              await post("/api/tests", { action: "unpublish", id });
              await post("/api/tests", { action: "delete", id });
            }
            if (subjectId) await post("/api/subjects", { action: "delete", id: subjectId });
          }, { masterId: lib.masterId, copyId: lib.copy?.id, subjectId: lib.libSubjectId });
        }
      }
    } finally {
      await putSession(wsAdmin);
      const wsGone = await page.evaluate(async ({ ws, ids }) => {
        const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": "1" };
        const post = (url, body) =>
          fetch(url, { method: "POST", headers: hdr, body: JSON.stringify(body) }).then((r) => r.status);
        for (const username of [ws.username, ws.other]) {
          if (username) await post("/api/students", { action: "remove", username });
        }
        for (const id of [...ids, ws.draftId]) {
          if (!id) continue;
          await post("/api/tests", { action: "unpublish", id });
          await post("/api/tests", { action: "delete", id });
        }
        return ws.subjectId ? post("/api/subjects", { action: "delete", id: ws.subjectId }) : 0;
      }, { ws, ids: wsTests.map((t) => t.id) });
      console.log(`  (cleaned up workspace fixture, subject ${wsGone})`);
      // Back to the admin session for anything that follows: the cookie is
      // already restored above, so this is just the profile the shell paints.
      await page.evaluate((stored) => {
        localStorage.clear();
        if (stored) localStorage.setItem("vidai:auth", stored);
      }, wsAdminProfile);
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
