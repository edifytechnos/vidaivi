// The New subject flow, driven in a real browser with no network and no
// session — the same trade `seyari.cjs` makes. `src/screens/newsubject.ts`
// reaches the server only through `fetch`, which is stood in for here with
// two canned shelves, and it NEVER presses Create: the live walk in
// `newsubject.cjs` (admin creds from the environment) is the one that
// proxies to the real database, and even that one stops short of creating.
//
// What is proved is the College & other path end to end — a fifth group
// with no board pills, a typed course stored as the board, a year/semester
// step that can be skipped, comma-separated subjects, the Create button's
// arithmetic — and that the school path is as it was: four steps, tiles,
// "Class N" in the crumb. Desktop and phone. And that no POST ever leaves
// the page.
//
//   node e2e/newsubject-offline.cjs

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
const PORT = 4507;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-newsubject-"));

const HARNESS = `
import { openNewSubject } from "${path.join(ROOT, "src/screens/newsubject.ts")}";
import { classWord, subjectTitle } from "${path.join(ROOT, "src/taxonomy.ts")}";
const w = window as any;
w.openNewSubject = () => openNewSubject();
w.classWord = classWord;
w.subjectTitle = subjectTitle;
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
      `--define:import.meta.env=${JSON.stringify({
        VITE_GOOGLE_CLIENT_ID: "",
        VITE_APPINSIGHTS_CONNECTION_STRING: "",
        MODE: "test",
      })}`,
      `--define:__VIDAI_BUILD__=${JSON.stringify("test")}`,
      // The flow's import chain reaches `data.ts`, whose `import.meta.glob`
      // is Vite's and empty under esbuild's iife output. Stood in for by a
      // function the init script defines, answering "no bundled demo tests",
      // which this walk never needs.
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
<body><div id="app"><p>subjects</p></div>
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

// A signed-in teacher (the flow reads nothing unless `isLoggedIn()`), two
// library shelves so the school path has something to tick, and a fetch that
// records every call — the assertion that nothing was written hangs off it.
const STUB = `
  globalThis.__viteGlob = () => ({});
  localStorage.setItem("vidai:auth", JSON.stringify({ profile: { sub: "t1", name: "T", email: "t@example.com", role: "teacher" } }));
  localStorage.setItem("vidai:tour:teacher", "1");
  window.__calls = [];
  const shelves = [
    { id: "lib-c10-maths", board: "CBSE", klass: "10", subject: "Maths", title: "CBSE Class 10 Maths", platform: true, ownerSub: "~platform", collaborators: [] },
    { id: "lib-c12-maths", board: "CBSE", klass: "12", subject: "Maths", title: "CBSE Class 12 Maths", platform: true, ownerSub: "~platform", collaborators: [] },
  ];
  const masters = [
    { id: "lib-c10-01", title: "Real Numbers", chapter: "Chapter 1", order: 1, status: "published", platform: true, subjectId: "lib-c10-maths", questionCount: 15, totalMarks: 31 },
    { id: "lib-c10-02", title: "Polynomials", chapter: "Chapter 2", order: 2, status: "published", platform: true, subjectId: "lib-c10-maths", questionCount: 15, totalMarks: 30 },
  ];
  window.fetch = async (url, init) => {
    const method = (init && init.method) || "GET";
    window.__calls.push({ url: String(url), method, body: init && init.body ? JSON.parse(init.body) : null });
    const reply = (status, data) => ({ ok: status < 400, status, json: async () => data, text: async () => JSON.stringify(data) });
    if (method === "GET" && String(url).startsWith("/api/subjects")) return reply(200, { subjects: shelves });
    if (method === "GET" && String(url).startsWith("/api/tests?library=1")) return reply(200, { tests: masters });
    return reply(404, { error: "not stubbed" });
  };
`;

async function walk(page, label) {
  const text = async () => (await page.textContent(".ns")) || "";
  const nextLabel = async () => ((await page.textContent("#ns-next")) || "").trim();
  const crumb = async () => ((await page.textContent("#ns-crumbs")) || "").trim();

  await page.evaluate(() => window.openNewSubject());
  await page.waitForSelector('[data-group="college"]', { timeout: 20000 });

  // ------------------------------------------------------------- step 1
  check(await page.isVisible('[data-group="college"]'), `${label}: College & other is a group of its own`);
  check((await page.locator(".ns-pill").count()) === 0, `${label}: no pills until a group is picked`);
  check(await page.isDisabled("#ns-next"), `${label}: cannot continue with nothing picked`);

  await page.click('[data-group="college"]');
  check(/Step 1 of 3/.test(await text()), `${label}: a course has THREE steps, and says so`);
  check((await page.locator(".ns-pill").count()) === 0, `${label}: picking it reveals no board pills`);
  check(await page.isVisible("#ns-course"), `${label}: it reveals the course box instead`);
  check(
    (await page.locator("#ns-courses option").count()) >= 10,
    `${label}: with course suggestions beneath it`
  );
  check(await page.isDisabled("#ns-next"), `${label}: the group alone is not a course`);
  check(
    await page.evaluate(() => document.activeElement && document.activeElement.id === "ns-course"),
    `${label}: and the caret is already in the box`
  );

  await page.fill("#ns-course", "MBBS");
  check(!(await page.isDisabled("#ns-next")), `${label}: a typed course unlocks Continue`);
  await page.click("#ns-next");

  // ------------------------------------------------------------- step 2
  check(/Which year or semester\?/.test(await text()), `${label}: a course asks for a year or semester, not a class`);
  check(/Step 2 of 3/.test(await text()), `${label}: step 2 of 3`);
  check(/MBBS/.test(await crumb()), `${label}: the crumb carries the course`);
  for (const y of ["Year 1", "Year 2", "Year 3", "Year 4"]) {
    check(await page.isVisible(`[data-klass="${y}"]`), `${label}: offers ${y}`);
  }
  check(await page.isVisible("[data-noclass]"), `${label}: and a way to say there is no year`);
  check(await page.isDisabled("#ns-next"), `${label}: nothing picked yet is still blocked`);

  // "No year" is an answer, not an absence.
  await page.click("[data-noclass]");
  check(!(await page.isDisabled("#ns-next")), `${label}: "No year or semester" unlocks Continue`);
  check(
    (await page.getAttribute("[data-noclass]", "aria-pressed")) === "true",
    `${label}: and reads as pressed`
  );

  // Then a real year, which wins.
  await page.click('[data-klass="Year 1"]');
  check(
    (await page.getAttribute("[data-noclass]", "aria-pressed")) === "false",
    `${label}: picking a year un-presses "No year"`
  );
  check(
    (await page.getAttribute('[data-klass="Year 1"]', "aria-pressed")) === "true",
    `${label}: Year 1 is pressed`
  );
  await page.click("#ns-next");

  // ------------------------------------------------------------- step 3
  check(/Which subjects\?/.test(await text()), `${label}: step 3 asks for the subjects`);
  check(/Step 3 of 3/.test(await text()), `${label}: step 3 of 3`);
  check(/MBBS\s+›\s+Year 1/.test(await crumb()), `${label}: the crumb reads "MBBS › Year 1" — no "Class" (got "${await crumb()}")`);
  check(
    (await page.locator("[data-paper]").count()) === 0,
    `${label}: no school-subject tiles to tick for a course`
  );
  check(
    !/Nothing ready-made here yet/.test(await text()),
    `${label}: and no "nothing ready-made" alert repeating what the blurb says`
  );
  check(await page.isVisible("#ns-extra"), `${label}: the subjects box is the step`);
  check(await page.isDisabled("#ns-next"), `${label}: blocked until a subject is named`);

  await page.fill("#ns-extra", "Anatomy, Physiology , biochemistry,, anatomy");
  check(
    /Create 3 subjects/.test(await nextLabel()),
    `${label}: "Anatomy, Physiology , biochemistry,, anatomy" is THREE subjects — commas split, blanks and a repeat drop (button: "${await nextLabel()}")`
  );
  await page.fill("#ns-extra", "Anatomy");
  check(/Create 1 subject$/.test(await nextLabel()), `${label}: one name is one subject`);

  // ----------------------------------------- back and forth keeps its word
  await page.click("#ns-back");
  check(/Which year or semester\?/.test(await text()), `${label}: Back returns to the year`);
  await page.click("[data-other]");
  check(await page.isVisible("#ns-kc"), `${label}: "Semester or something else" opens a box`);
  await page.fill("#ns-kc", "Semester 3");
  await page.click("#ns-next");
  check(/MBBS\s+›\s+Semester 3/.test(await crumb()), `${label}: a typed semester reads as typed in the crumb`);
  check(
    (await page.inputValue("#ns-extra")) === "",
    `${label}: changing the year forgot the subjects typed under the old one`
  );

  // Changing the COURSE forgets the year too — a different course is a
  // different subject, the same rule as picking a different board pill.
  await page.click("#ns-back");
  await page.click("#ns-back");
  await page.fill("#ns-course", "B.E. Mechanical");
  await page.click("#ns-next");
  check(await page.isDisabled("#ns-next"), `${label}: a new course starts the year over`);

  // -------------------------------------------- the school path is as it was
  await page.click("#ns-back");
  await page.click('[data-group="national"]');
  check(/Step 1 of 4/.test(await text()), `${label}: a school board still has four steps`);
  check(await page.isVisible('[data-board="CBSE"]'), `${label}: and its pills`);
  check((await page.locator("#ns-course").count()) === 0, `${label}: and no course box`);
  await page.click('[data-board="CBSE"]');
  await page.click("#ns-next");
  check(/Which class\?/.test(await text()), `${label}: a school board asks for a class`);
  check((await page.locator("[data-noclass]").count()) === 0, `${label}: and cannot skip it`);
  await page.click('[data-klass="10"]');
  await page.click("#ns-next");
  check(/CBSE\s+›\s+Class 10/.test(await crumb()), `${label}: the crumb still says "Class 10" for a plain number`);
  check((await page.locator("[data-paper]").count()) >= 1, `${label}: with a ready-made subject to tick`);
  // A ticked subject with tests behind it leads to "Choose tests"; untick it
  // so the button counts what is typed, and the split proves itself here too.
  for (const b of await page.locator("[data-paper]").all()) await b.uncheck();
  await page.fill("#ns-extra", "Hindi, Sanskrit");
  check(
    /Create 2 subjects/.test(await nextLabel()),
    `${label}: "Hindi, Sanskrit" is two subjects under a school board too (button: "${await nextLabel()}")`
  );

  // Close without creating.
  await page.keyboard.press("Escape");
  await page.waitForSelector(".ns", { state: "detached", timeout: 5000 });

  const writes = await page.evaluate(() => window.__calls.filter((c) => c.method !== "GET"));
  check(writes.length === 0, `${label}: nothing was ever written (${writes.length} non-GET calls)`);
}

(async () => {
  build();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const errors = [];

  // ---------- the title rule, on the client mirror ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript(STUB);
  await page.goto(`http://localhost:${PORT}/`);
  const titles = await page.evaluate(() => ({
    school: window.subjectTitle("CBSE", "12", "Maths"),
    exam: window.subjectTitle("JEE Main", "2027", "Physics"),
    year: window.subjectTitle("MBBS", "Year 1", "Anatomy"),
    sem: window.subjectTitle("B.E. Mechanical", "Semester 3", "Thermodynamics"),
    none: window.subjectTitle("General", "", "Aptitude"),
    typed: window.subjectTitle("Tamil Nadu", "MBBS I", "Anatomy"),
    word: window.classWord(" 9 "),
  }));
  check(titles.school === "CBSE Class 12 Maths", `a plain number is a class: "${titles.school}"`);
  check(titles.exam === "JEE Main 2027 Physics", `a year is bare: "${titles.exam}"`);
  check(titles.year === "MBBS Year 1 Anatomy", `a college year is as typed: "${titles.year}"`);
  check(titles.sem === "B.E. Mechanical Semester 3 Thermodynamics", `so is a semester: "${titles.sem}"`);
  check(titles.none === "General Aptitude", `no class at all is just board and subject: "${titles.none}"`);
  check(titles.typed === "Tamil Nadu MBBS I Anatomy", `and the old "Class MBBS I" is gone: "${titles.typed}"`);
  check(titles.word === "Class 9", `classWord trims and says Class for a number: "${titles.word}"`);

  await walk(page, "desktop");
  await page.close();

  // ---------- phone ----------
  const phone = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  phone.on("pageerror", (e) => errors.push(e.message));
  await phone.addInitScript(STUB);
  await phone.goto(`http://localhost:${PORT}/`);
  await walk(phone, "phone");
  // On a phone the dialog is a card with a gutter, and nothing overflows.
  await phone.evaluate(() => window.openNewSubject());
  await phone.waitForSelector('[data-group="college"]');
  await phone.click('[data-group="college"]');
  const box = await phone.locator(".ns").boundingBox();
  check(box && box.x >= 8 && box.x + box.width <= 390 - 8, `phone: the dialog keeps its gutter with the course box open (x=${box && Math.round(box.x)}, w=${box && Math.round(box.width)})`);
  const over = await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  check(!over, "phone: nothing overflows the window sideways");
  await phone.close();

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
