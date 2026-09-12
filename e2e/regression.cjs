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
    await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 25000 });
    check(true, "admin login lands on the subjects grid");
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
    await shot("review");

    // The cross-device case: save an attempt to the server, wipe this device,
    // and the review must rebuild from what the server holds.
    const saved = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
      if (!auth?.credential) return "no-token";
      const res = await fetch("/api/attempts", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Vidai-Auth": auth.credential, "X-Vidaivi-Auth": auth.credential },
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
        headers: { "Content-Type": "application/json", "X-Vidai-Auth": auth.credential, "X-Vidaivi-Auth": auth.credential },
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
        const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": auth.credential, "X-Vidaivi-Auth": auth.credential };
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
        const hdr = { "X-Vidai-Auth": auth.credential, "X-Vidaivi-Auth": auth.credential };
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
            headers: { "Content-Type": "application/json", "X-Vidai-Auth": auth.credential, "X-Vidaivi-Auth": auth.credential },
            body: JSON.stringify({ action: "progress", testId: id, index: 0, answers: "{}" }),
          });
          localStorage.removeItem(`vidai:attempt:${id}`);
        }, fresh);
      }

      // The publish gate, on a draft this run creates complete and deletes
      // again — an incomplete draft would fail validation before the gate.
      const gate = await page.evaluate(async () => {
        const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
        const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": auth.credential, "X-Vidaivi-Auth": auth.credential };
        const created = await fetch("/api/tests", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({
            action: "create",
            test: {
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
      const hdr = { "X-Vidai-Auth": auth.credential, "X-Vidaivi-Auth": auth.credential };
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
      check(links.unlinkedAttempts === 403, "attempts for an unlinked child are refused");
      check(links.unlinkedTests === 403, "the test list for an unlinked child is refused");
    }

    // Long-answer photos and the teacher's marking queue. This runs the whole
    // loop on a throwaway student it creates and then removes, so it never
    // leaves a photo, a grading row or a login behind.
    const marking = await page.evaluate(async () => {
      const auth = JSON.parse(localStorage.getItem("vidai:auth") || "null");
      const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": auth.credential, "X-Vidaivi-Auth": auth.credential };

      // A missing route answers 404 too, so every refusal below would "pass"
      // against an API without this feature. Prove the queue exists first.
      const queueStatus = await fetch("/api/grading?queue=1", { headers: hdr }).then((r) => r.status);
      if (queueStatus !== 200) return { missing: true, queueStatus };

      const made = await fetch("/api/students", {
        method: "POST",
        headers: hdr,
        body: JSON.stringify({ name: "E2E Photo Student", grade: "12", school: "E2E" }),
      }).then((r) => r.json());
      if (!made.username || !made.password) return { skip: true };

      const cleanup = async () =>
        fetch("/api/students", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({ action: "remove", username: made.username }),
        });

      try {
        // A real JPEG, drawn here rather than pasted as a constant.
        const canvas = document.createElement("canvas");
        canvas.width = 40;
        canvas.height = 30;
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, 40, 30);
        ctx.fillStyle = "#000";
        ctx.fillText("f-1", 4, 20);
        const jpeg = canvas.toDataURL("image/jpeg", 0.7).split(",")[1];

        // The teacher/admin identity must not be able to hand work in.
        const asTeacher = await fetch("/api/answerimage", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({ testId: "e2e-photo", questionId: "q1", image: jpeg }),
        }).then((r) => r.status);

        const login = await fetch("/api/studentauth", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: made.username, password: made.password }),
        }).then((r) => r.json());
        if (!login.token) return { cleanupOnly: true, asTeacher, loginFailed: true, username: made.username };
        const sHdr = { "Content-Type": "application/json", "X-Vidai-Auth": login.token, "X-Vidaivi-Auth": login.token };
        const post = (body) =>
          fetch("/api/answerimage", { method: "POST", headers: sHdr, body: JSON.stringify(body) })
            .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));

        const base = { testId: "e2e-photo", testTitle: "E2E photo test", questionId: "q1", questionIndex: 0, maxMarks: 5 };
        const notAnImage = await post({ ...base, image: btoa("this is plainly not a jpeg") });
        const tooBig = await post({ ...base, image: "/9j/" + "A".repeat(2_400_000) });
        const uploaded = await post({ ...base, image: jpeg });

        // The signed URL is per-student: nobody else's blob comes back.
        const signed = await fetch(
          `/api/answerimage?blob=${encodeURIComponent(uploaded.data.blob || "x")}`,
          { headers: sHdr }
        ).then(async (r) => ({ status: r.status, url: (await r.json().catch(() => ({}))).url || "" }));
        const someoneElse = await fetch(
          "/api/answerimage?blob=" + encodeURIComponent("stu~not-this-student/t/q/1.jpg"),
          { headers: sHdr }
        ).then((r) => r.status);

        // It reaches the teacher's queue, gets marked, and reads back marked.
        const queue = await fetch("/api/grading?queue=1", { headers: hdr }).then((r) => r.json());
        const inQueue = (queue.answers || []).some(
          (a) => a.username === made.username && a.testId === "e2e-photo"
        );
        const marked = await fetch("/api/grading", {
          method: "POST",
          headers: hdr,
          body: JSON.stringify({
            action: "mark",
            username: made.username,
            testId: "e2e-photo",
            questionId: "q1",
            awarded: 9, // over maxMarks on purpose: must clamp to 5
            comment: "Good method.",
          }),
        }).then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
        const mine = await fetch("/api/grading?testId=e2e-photo", { headers: sHdr }).then((r) => r.json());

        return {
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
        };
      } finally {
        await cleanup();
      }
    });

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
        marking.blob.startsWith(`stu~${marking.username}/e2e-photo/q1/`),
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
      console.log(`  (cleaned up ${marking.username})`);
    }

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

    // Subjects: a signed-in teacher lands here, and a subject card opens the
    // page where that subject's tests live.
    await page.goto(BASE, { waitUntil: "domcontentloaded" });
    await page.waitForSelector("#sub-grid .subject-card[data-subject]", { timeout: 20000 });
    check(true, "a signed-in teacher lands on the subjects grid");
    await shot("subjects");
    const owned = await page.$(".subject-card[data-subject]:not(.subject-card-builtin)");
    if (owned) {
      await owned.click();
      // A subject opens the authoring editor scoped to it, not a table.
      await page.waitForSelector(".editor:not(.sk-wrap) .ed-tree", { timeout: 30000 });
      check(true, "clicking a subject opens the authoring editor");
      check(await page.isVisible("#ed-new-test"), "the editor's tree offers Create");
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
    await page.click("#sub-new");
    await page.fill("#sf-board", "CBSE");
    await page.fill("#sf-class", "12");
    await page.fill("#sf-subject", probe);
    await page.click("#sf-save");
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
