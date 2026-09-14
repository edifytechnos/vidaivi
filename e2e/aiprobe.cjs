// One real assessment, end to end on QA: render a handwritten-looking answer,
// hand it in as a throwaway student, ask the assessor, print what it proposed,
// then delete the student. Temporary — not part of the suite.
const { chromium } = require("playwright-core");

const BASE = process.env.AI_BASE;
const USER = process.env.E2E_ADMIN_USER;
const PASS = process.env.E2E_ADMIN_PASS;

// A 5-mark quadratic, worked correctly to the roots but with the factor pair
// slipped at the last line, so partial credit is the interesting behaviour.
const PAPER = `
<html><body style="margin:0;background:#fdfcf7">
<div style="width:900px;height:1150px;padding:60px 70px;box-sizing:border-box;
     font-family:'Bradley Hand','Segoe Script','Comic Sans MS',cursive;
     font-size:34px;line-height:1.9;color:#1a2b6d;
     background:repeating-linear-gradient(#fdfcf7 0 46px,#dfe7f5 46px 47px)">
  <div style="font-size:28px;color:#888">Q5.  Solve  x&sup2; &minus; 5x + 6 = 0</div>
  <br>
  <div>x&sup2; &minus; 5x + 6 = 0</div>
  <div>Splitting the middle term,</div>
  <div>x&sup2; &minus; 3x &minus; 2x + 6 = 0</div>
  <div>x(x &minus; 3) &minus; 2(x &minus; 3) = 0</div>
  <div>(x &minus; 3)(x &minus; 2) = 0</div>
  <br>
  <div>&there4; x = 3  or  x = &minus;2</div>
</div></body></html>`;

(async () => {
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const p = await (await b.newContext({ viewport: { width: 900, height: 1150 } })).newPage();
  await p.setContent(PAPER);
  const shot = await p.screenshot({ type: "jpeg", quality: 80 });
  await b.close();
  const image = shot.toString("base64");
  console.log(`rendered answer photo: ${Math.round(shot.length / 1024)}KB`);

  // --- one cookie jar per identity, as the suite does ---
  const jars = {};
  const call = async (who, path, init = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        "X-Vidai-Auth": "1",
        ...(jars[who] ? { cookie: jars[who] } : {}),
        ...(init.headers || {}),
      },
    });
    const set = res.headers.get("set-cookie");
    if (set) jars[who] = set.split(";")[0];
    const text = await res.text();
    let data = {};
    try { data = JSON.parse(text); } catch {}
    return { status: res.status, data };
  };

  let r = await call("admin", "/api/manageauth", {
    method: "POST",
    body: JSON.stringify({ username: USER, password: PASS }),
  });
  console.log("admin login:", r.status);

  const name = `AI Probe ${Date.now().toString().slice(-5)}`;
  r = await call("admin", "/api/students", {
    method: "POST",
    body: JSON.stringify({ action: "create", name }),
  });
  const student = r.data;
  console.log("student created:", r.status, student.username || JSON.stringify(r.data).slice(0, 120));
  if (!student.username) return;

  const testId = "aiprobe-" + Math.random().toString(36).slice(2, 7);
  const questionId = "q1";
  try {
    r = await call("stu", "/api/studentauth", {
      method: "POST",
      body: JSON.stringify({ username: student.username, password: student.password }),
    });
    console.log("student login:", r.status);

    r = await call("stu", "/api/answerimage", {
      method: "POST",
      body: JSON.stringify({
        testId, questionId, questionIndex: 0, maxMarks: 5,
        testTitle: "AI probe", image,
      }),
    });
    console.log("photo handed in:", r.status);

    const t0 = Date.now();
    r = await call("admin", "/api/assess", {
      method: "POST",
      body: JSON.stringify({
        username: student.username,
        testId,
        questionId,
        question: "Solve the quadratic equation x^2 - 5x + 6 = 0 by factorisation. (5 marks)",
        solution:
          "Split the middle term: x^2 - 3x - 2x + 6 = 0, so x(x-3) - 2(x-3) = 0 and (x-3)(x-2) = 0. " +
          "Therefore x = 3 or x = 2. Award 2 marks for correct splitting, 2 for the factorisation, 1 for both roots.",
      }),
    });
    console.log(`\nassess: HTTP ${r.status}  (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    console.log(JSON.stringify(r.data, null, 2));
  } finally {
    const done = await call("admin", "/api/students", {
      method: "POST",
      body: JSON.stringify({ action: "remove", username: student.username }),
    });
    console.log("\ncleaned up student:", done.status);
  }
})();
