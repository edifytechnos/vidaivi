// The capture-quality gate on the answer-photo uploader, driven in a real
// browser against synthetic pages.
//
// Two things are proved here, and neither needs a session, a row or the
// network — the same trade `e2e/photoviewer.cjs` makes:
//
//   1. Each check in `src/capturequality.ts` fails the image it exists for and
//      passes a good page. The images are drawn on a canvas — sharp text, the
//      same text blurred, the page in the dark, a reflected window, a shadow
//      over half of it, a blank sheet — so a threshold retuned until a check
//      can no longer catch its own image fails here rather than in a class.
//   2. `mountUploader` refuses a bad capture before any bytes leave, shows the
//      reason, offers "Upload anyway" only on the third refusal of the same
//      question, and flags that upload with the reason so the teacher knows.
//
//   node e2e/capturequality.cjs

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
const PORT = 4502;

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "PASS " : "FAIL "} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-cq-"));

const HARNESS = `
import { assessCapture, REASONS, THRESHOLDS } from ${JSON.stringify(path.join(ROOT, "src/capturequality"))};
import { mountUploader, OVERRIDE_AFTER } from ${JSON.stringify(path.join(ROOT, "src/answerphotos"))};

// --- synthetic pages -------------------------------------------------------
//
// A page of working is paper with dark writing on it. Everything else is that
// page with one thing wrong.
const W = 1200, H = 900;
const PAPER = "#f3f1ea";

function sheet(w = W, h = H, paper = PAPER) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d");
  ctx.fillStyle = paper;
  ctx.fillRect(0, 0, w, h);
  return c;
}

// Handwriting-ish: lines of text plus a few strokes, in a dark blue-black.
function write(c, ink = "#1b1f3a", size = 1) {
  const ctx = c.getContext("2d");
  ctx.fillStyle = ink;
  ctx.strokeStyle = ink;
  ctx.lineWidth = 3 * size;
  const s = c.width / W;
  ctx.font = Math.round(34 * s * size) + "px sans-serif";
  const lines = [
    "Q7. Let A = [[2, 1], [1, 3]]. Find A^-1.",
    "|A| = 6 - 1 = 5",
    "adj A = [[3, -1], [-1, 2]]",
    "A^-1 = (1/5) [[3, -1], [-1, 2]]",
    "Check: A . A^-1 = I",
    "= (1/5)[[6-1, -2+2],[3-3, -1+6]] = I",
  ];
  lines.forEach((t, i) => ctx.fillText(t, 60 * s, (110 + i * 90) * s));
  ctx.beginPath();
  ctx.moveTo(80 * s, 700 * s); ctx.lineTo(600 * s, 720 * s);
  ctx.moveTo(90 * s, 760 * s); ctx.lineTo(500 * s, 740 * s);
  ctx.stroke();
  return c;
}

function pixels(c) {
  const d = c.getContext("2d").getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: d.width, height: d.height };
}

const IMAGES = {
  good: () => write(sheet()),
  blurred: () => {
    const src = write(sheet());
    const c = sheet();
    const ctx = c.getContext("2d");
    ctx.filter = "blur(7px)";
    ctx.drawImage(src, 0, 0);
    return c;
  },
  dark: () => {
    const c = write(sheet());
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,0.82)";
    ctx.fillRect(0, 0, W, H);
    return c;
  },
  bright: () => write(sheet(W, H, "#fdfdfd"), "#e6e6e6"),
  faint: () => write(sheet(W, H, "#ebe8e1"), "#cfcbc3"),
  glare: () => {
    const c = write(sheet());
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(850, 300, 260, 200, 0.3, 0, Math.PI * 2);
    ctx.fill();
    return c;
  },
  shadow: () => {
    const c = write(sheet());
    const ctx = c.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, W / 2, H);
    return c;
  },
  // A page lit from a window: smoothly darker towards one edge, still readable.
  gradient: () => {
    const c = write(sheet());
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, "rgba(0,0,0,0.5)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    return c;
  },
  tiny: () => write(sheet(300, 225)),
  blank: () => sheet(),
};

window.__cq = {
  REASONS,
  THRESHOLDS,
  OVERRIDE_AFTER,
  assess(name) {
    const v = assessCapture(pixels(IMAGES[name]()));
    return { ok: v.ok, reason: v.reason, checks: v.checks.map((c) => ({ id: c.id, ok: c.ok, value: c.value })) };
  },
  png(name) {
    return IMAGES[name]().toDataURL("image/png");
  },
};

// --- the uploader, with the API stubbed ------------------------------------
const calls = [];
window.__calls = calls;
window.fetch = async (url, init) => {
  const body = init && init.body ? JSON.parse(init.body) : null;
  calls.push({ url: String(url), method: (init && init.method) || "GET", body });
  if ((init && init.method) === "POST") {
    const n = calls.filter((c) => c.method === "POST").length;
    const blob = "stu~kid/t1/q1/" + n + ".jpg";
    window.__images = (window.__images || []).concat(blob);
    return new Response(JSON.stringify({ blob, images: window.__images }), { status: 201 });
  }
  return new Response(JSON.stringify({ url: "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }), { status: 200 });
};

mountUploader(document.getElementById("host"), {
  testId: "t1",
  testTitle: "Matrices",
  questionId: "q1",
  questionIndex: 6,
  maxMarks: 5,
  initial: [],
  onChange: () => {},
});
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
      `--define:import.meta.env=${JSON.stringify({
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
<body><div id="app"><main class="card"><div id="host"></div></main></div>
<script src="harness.js"></script></body></html>`
  );
}

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css" };

function serve() {
  const server = http.createServer((req, res) => {
    const name = req.url === "/" ? "/index.html" : req.url.split("?")[0];
    const file = path.join(dir, path.basename(name));
    if (!fs.existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    res.writeHead(200, { "content-type": TYPES[path.extname(file)] || "text/plain" });
    res.end(fs.readFileSync(file));
  });
  return new Promise((ok) => server.listen(PORT, () => ok(server)));
}

(async () => {
  build();
  const server = await serve();
  const browser = await chromium.launch({ executablePath: EXE });
  const page = await browser.newPage({ viewport: { width: 390, height: 780 }, hasTouch: true });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector("#ap-add");

  const REASONS = await page.evaluate(() => window.__cq.REASONS);
  const assess = (name) => page.evaluate((n) => window.__cq.assess(n), name);
  const fmt = (v) =>
    v.checks.map((c) => `${c.id}${c.ok ? "" : "✗"}=${Number(c.value.toFixed(3))}`).join(" ");

  // --- 1. each check catches its own image ----------------------------------
  const good = await assess("good");
  check(good.ok, `a sharp, well-lit page of working passes every check (${fmt(good)})`);
  // The first real photo the gate met was refused for a shadow it did not
  // have: a page lit from a window darkens smoothly across its width. A
  // gradient is not a shadow; an edge is.
  const gradient = await assess("gradient");
  check(gradient.ok, `a page lit from one side passes — a gradient is not a shadow (${fmt(gradient)})`);

  // [image, the check that must fail it, whether it must be the FIRST failure]
  const cases = [
    ["blurred", "blur"],
    ["dark", "dark"],
    ["bright", "bright"],
    ["faint", "contrast"],
    ["glare", "glare"],
    ["shadow", "shadow"],
    ["tiny", "resolution"],
    ["blank", "ink"],
  ];
  for (const [img, id] of cases) {
    const v = await assess(img);
    const c = v.checks.find((x) => x.id === id);
    check(c && !c.ok, `${img}: the ${id} check fails it (${fmt(v)})`);
    check(
      v.reason === REASONS[id],
      `${img}: the student is told "${REASONS[id]}" (got "${v.reason}")`
    );
  }

  // --- 2. the uploader refuses, then relents on the third try ---------------
  //
  // A PNG of the blurred page, handed to the file input as a phone's camera
  // would hand a capture.
  const pngOf = async (name) => {
    const url = await page.evaluate((n) => window.__cq.png(n), name);
    return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
  };
  const blurred = await pngOf("blurred");
  const sharp = await pngOf("good");
  const OVERRIDE_AFTER = await page.evaluate(() => window.__cq.OVERRIDE_AFTER);
  const posts = () =>
    page.evaluate(() => window.__calls.filter((c) => c.method === "POST").map((c) => c.body));

  for (let n = 1; n <= OVERRIDE_AFTER; n++) {
    await page.setInputFiles("#ap-file", { name: `shot${n}.png`, mimeType: "image/png", buffer: blurred });
    await page.waitForSelector(".ap-refused");
    check(
      (await page.locator("#ap-refused-reason").textContent()) === REASONS.blur,
      `refusal ${n}: the popup names the reason`
    );
    const src = await page.locator("#ap-refused-img").getAttribute("src");
    check(
      src && src.startsWith("data:image/jpeg;base64,") && src.length > 1000,
      `refusal ${n}: and shows the photo that was just taken`
    );
    check(
      await page.evaluate(() => document.activeElement && document.activeElement.id === "ap-retake"),
      `refusal ${n}: Retake has the focus`
    );
    check((await posts()).length === 0, `refusal ${n}: nothing was uploaded`);
    const offered = (await page.locator("#ap-anyway").count()) > 0;
    check(
      offered === (n >= OVERRIDE_AFTER),
      `refusal ${n}: "Upload anyway" is ${n >= OVERRIDE_AFTER ? "offered" : "not offered yet"}`
    );
    if (n === 1) {
      // Retake reopens the camera — the file chooser — from the popup itself.
      const [chooser] = await Promise.all([
        page.waitForEvent("filechooser"),
        page.locator("#ap-retake").click(),
      ]);
      check(!!chooser, "Retake opens the camera again");
      check((await page.locator(".ap-refused").count()) === 0, "and the popup is gone");
      check(
        /not clear enough to mark/.test(await page.locator("#ap-error").textContent()),
        "the uploader keeps a one-line note of what happened"
      );
    } else if (n < OVERRIDE_AFTER) {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(50);
      check((await page.locator(".ap-refused").count()) === 0, `refusal ${n}: Escape closes the popup`);
      check(
        !(await page.evaluate(() => document.body.classList.contains("modal-open"))),
        `refusal ${n}: and unlocks the page`
      );
    }
  }

  await page.locator("#ap-anyway").click();
  await page.waitForSelector(".shot");
  const sent = await posts();
  check(sent.length === 1, "Upload anyway sends the refused photo");
  check(
    sent[0] && sent[0].lowQuality === REASONS.blur,
    `and flags it with the reason (${sent[0] && sent[0].lowQuality})`
  );
  check(sent[0] && typeof sent[0].image === "string" && sent[0].image.length > 1000, "with the image itself");
  check((await page.locator(".ap-refused").count()) === 0, "the popup closes once something is up");
  check(await page.locator("#ap-error").isHidden(), "and so does the note");

  // A good photo after that goes up unflagged and without a word.
  await page.setInputFiles("#ap-file", { name: "shot-ok.png", mimeType: "image/png", buffer: sharp });
  await page.waitForFunction(() => document.querySelectorAll(".shot").length === 2);
  const after = await posts();
  check(after.length === 2 && !("lowQuality" in after[1]), "a passing photo uploads with no flag");
  check(await page.locator("#ap-error").isHidden(), "and shows no error");

  check(errors.length === 0, `no page errors (${errors.join("; ") || "none"})`);

  await browser.close();
  server.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})();
