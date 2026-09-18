// Prove the help centre before it ships, the way check-content.cjs proves a
// chapter.
//
// Docs rot silently: a price changes, a page keeps the old number, and nobody
// notices until a parent is quoted one figure by the app and another by the
// help page they were sent to. So the rule this enforces is the one that
// actually keeps a page true — **a number that exists in the code may not be
// typed by hand**. It has to be a {{fact}}, substituted at build time.
//
// It also checks the things a link-rot bug looks like: a page that links to a
// file that is not there, or to an anchor no heading makes.
//
//   node scripts/check-help.cjs

const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const SRC = path.join(root, "help");

const problems = [];
const fail = (where, msg) => problems.push(`${where}: ${msg}`);

// ------------------------------------------------------------- what exists

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const files = walk(SRC);
const pages = new Map();

for (const file of files) {
  const rel = path.relative(SRC, file).split(path.sep).join("/");
  const raw = fs.readFileSync(file, "utf8");
  const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  if (fm)
    for (const line of fm[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
  const body = fm ? raw.slice(fm[0].length) : raw;
  const anchors = new Set(
    [...body.matchAll(/^#{1,4}\s+(.*)$/gm)].map((m) =>
      m[1]
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
    )
  );
  pages.set(rel, { rel, meta, body, anchors, persona: rel.includes("/") ? rel.split("/")[0] : "" });
}

// --------------------------------------------------------- the facts exist

const core = fs.readFileSync(path.join(root, "api", "shared", "core.js"), "utf8");
const planBlock = core.match(/const PLAN_DEFAULTS = \{([\s\S]*?)\n\};/);
if (!planBlock) fail("api/shared/core.js", "PLAN_DEFAULTS not found — build-help.mjs reads it");

const known = new Set(["build.date", "library.shelves", "library.tests", "library.questions", "library.table"]);
if (planBlock)
  for (const m of planBlock[1].matchAll(/^\s*([A-Za-z]\w*):\s*(\d+),/gm)) {
    known.add(`rules.${m[1]}`);
    if (m[1].endsWith("Paise")) known.add(`rules.${m[1]}.rupees`);
  }

// ---------------------------------------------------------------- the rules

const PERSONAS = ["student", "parent", "teacher", "admin"];
const seen = new Map(PERSONAS.map((p) => [p, []]));

for (const p of pages.values()) {
  const where = p.rel;

  if (p.rel === "index.md") {
    if (!p.meta.title) fail(where, "front matter needs a title");
  } else {
    if (!PERSONAS.includes(p.persona))
      fail(where, `lives outside a persona directory (${PERSONAS.join(", ")})`);
    if (!p.meta.title) fail(where, "front matter needs a title");
    if (!p.meta.summary) fail(where, "front matter needs a summary — it is the lede and the meta description");
    if (!p.meta.order) fail(where, "front matter needs an order");
    else if (seen.has(p.persona)) {
      const list = seen.get(p.persona);
      if (list.includes(p.meta.order)) fail(where, `order ${p.meta.order} is already used in ${p.persona}/`);
      list.push(p.meta.order);
    }
  }

  // Every {{fact}} must be one the build can answer.
  for (const m of p.body.matchAll(/\{\{([\w.]+)\}\}/g))
    if (!known.has(m[1])) fail(where, `unknown fact {{${m[1]}}}`);

  // The staleness rule. A rupee amount or a bare credit/day count typed into
  // prose is a number that will disagree with the code the first time an admin
  // edits it in Plans & pricing. Write {{rules.…}} instead.
  for (const m of p.body.matchAll(/₹\s?\d[\d,]*/g))
    fail(where, `"${m[0]}" is typed by hand — use {{rules.<name>.rupees}} so it cannot go stale`);

  // Relative links have to land somewhere.
  for (const m of p.body.matchAll(/\]\(([^)\s]+)\)/g)) {
    const href = m[1];
    if (/^(https?:|mailto:|#|\/)/.test(href)) continue;
    const [file, anchor] = href.split("#");
    const target = path
      .normalize(path.join(path.dirname(p.rel), file.replace(/\.html$/, ".md")))
      .split(path.sep)
      .join("/");
    const dest = pages.get(target);
    if (!dest) fail(where, `link to ${href} — no such page`);
    else if (anchor && !dest.anchors.has(anchor))
      fail(where, `link to ${href} — ${target} has no heading "${anchor}"`);
  }
}

if (!pages.has("index.md")) fail("help/", "index.md is the front door and is missing");
for (const [persona, list] of seen) if (!list.length) fail("help/", `${persona}/ has no pages`);
if (!fs.existsSync(path.join(SRC, "help.css"))) fail("help/", "help.css is missing");

// ------------------------------------------------------------------- report

if (problems.length) {
  for (const p of problems) console.error(`  ${p}`);
  console.error(`\n${problems.length} problem${problems.length === 1 ? "" : "s"} in help/`);
  process.exit(1);
}
console.log(`help: ${pages.size} pages, ${known.size} facts, no problems`);
