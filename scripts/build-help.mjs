// Build the help centre: help/**/*.md -> dist/help/**/*.html
//
// Deliberately a script and not a framework. The repo has one dependency
// (katex) and two dev dependencies, the audience is parents on cheap Android
// phones, and the pages are prose — a static-site generator would be a real
// dependency decision for something ~250 lines does.
//
// Two constraints it is written to, both from CLAUDE.md:
//
//   * The CSP is global and `script-src 'self'` with NO inline script. These
//     pages emit no <script> at all, so /help needs no route-scoped header
//     override and can never be the thing that weakens that policy.
//   * `navigationFallback` would otherwise swallow /help, so the config now
//     excludes it. If a help page 404s into the app, that exclude is what is
//     missing.
//
// Facts are substituted rather than typed: a price or a limit written by hand
// is a price that disagrees with the code the first time it changes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "help");
const OUT = path.join(root, "dist", "help");

const NUL = String.fromCharCode(0);

// ---------------------------------------------------------------- the facts
//
// Read out of the code, never restated. PLAN_DEFAULTS is the shape an admin
// edits in Plans & pricing, so what the docs say is what a new platform does.

function planDefaults() {
  const core = fs.readFileSync(path.join(root, "api", "shared", "core.js"), "utf8");
  const block = core.match(/const PLAN_DEFAULTS = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("PLAN_DEFAULTS not found in api/shared/core.js");
  const rules = {};
  for (const m of block[1].matchAll(/^\s*([A-Za-z]\w*):\s*(\d+),/gm)) rules[m[1]] = Number(m[2]);
  return rules;
}

function shelves() {
  const seed = fs.readFileSync(path.join(root, "scripts", "seed-library.mjs"), "utf8");
  const block = seed.match(/const SHELVES = \{([\s\S]*?)\n\};/);
  if (!block) throw new Error("SHELVES not found in scripts/seed-library.mjs");
  const out = [];
  const re = /"([\w-]+)":\s*\{\s*board:\s*"([^"]*)",\s*klass:\s*"([^"]*)",\s*subject:\s*"([^"]*)"/g;
  for (const m of block[1].matchAll(re)) {
    const dir = path.join(root, "content", m[1]);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((x) => x.endsWith(".json")) : [];
    let questions = 0;
    for (const file of files) {
      try {
        const t = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
        questions += Array.isArray(t.questions) ? t.questions.length : 0;
      } catch {}
    }
    // CBSE names a class; Cambridge's own qualification name already carries
    // the level, and NEET has no class at all.
    const board = m[2];
    const shelf =
      board === "NEET"
        ? `NEET \u2014 ${m[4]}`
        : board.startsWith("CBSE")
          ? `${board} Class ${m[3]} ${m[4]}`
          : `${board} ${m[4]}`;
    out.push({ shelf, tests: files.length, questions });
  }
  return out;
}

const rupees = (paise) => "₹" + (paise / 100).toLocaleString("en-IN");

function facts() {
  const rules = planDefaults();
  const shelf = shelves();
  const f = {
    "build.date": new Date().toISOString().slice(0, 10),
    "library.shelves": String(shelf.length),
    "library.tests": String(shelf.reduce((n, s) => n + s.tests, 0)),
    "library.questions": String(shelf.reduce((n, s) => n + s.questions, 0)),
    "library.table": [
      "| Subject | Tests | Questions |",
      "|---|---|---|",
      ...shelf.map((s) => `| ${s.shelf} | ${s.tests} | ${s.questions} |`),
    ].join("\n"),
  };
  for (const [k, v] of Object.entries(rules)) {
    f[`rules.${k}`] = String(v);
    if (k.endsWith("Paise")) f[`rules.${k}.rupees`] = rupees(v);
  }
  return f;
}

/** {{name}} -> the fact. An unknown name fails the build, never blanks. */
function substitute(text, f, where) {
  return text.replace(/\{\{([\w.]+)\}\}/g, (_, name) => {
    if (!(name in f)) throw new Error(`${where}: unknown fact {{${name}}}`);
    return f[name];
  });
}

// ------------------------------------------------------------- the markdown
//
// A deliberately small subset, and the same trade `formatText` in src/dom.ts
// makes: everything is escaped first, so anything richer reaches the reader
// literally rather than as markup.

const esc = (s) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

function inline(s) {
  let out = esc(s);
  const code = [];
  out = out.replace(/`([^`]+)`/g, (_, c) => NUL + (code.push(`<code>${c}</code>`) - 1) + NUL);
  out = out.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, t, href) => `<a href="${href}">${t}</a>`);
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/(^|[\s(])\*([^*]+)\*/g, "$1<em>$2</em>");
  return out.replace(new RegExp(NUL + "(\\d+)" + NUL, "g"), (_, i) => code[Number(i)]);
}

const slug = (s) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const BULLET = /^(\s*)([-*]|\d+\.)\s+/;

function render(md) {
  const lines = md.split("\n");
  const out = [];
  const headings = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }

    if (/^```/.test(line)) {
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
      i++;
      out.push(`<pre><code>${esc(body.join("\n"))}</code></pre>`);
      continue;
    }
    if (/^---+$/.test(line.trim())) {
      out.push("<hr>");
      i++;
      continue;
    }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      const id = slug(text);
      if (level === 2) headings.push({ id, text });
      out.push(`<h${level} id="${id}">${inline(text)}</h${level}>`);
      i++;
      continue;
    }

    if (/^\|/.test(line)) {
      const rows = [];
      while (i < lines.length && /^\|/.test(lines[i])) rows.push(lines[i++]);
      const cells = (r) =>
        r
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(rows[0]);
      const body = rows.slice(/^[\s|:-]+$/.test(rows[1] ?? "") ? 2 : 1);
      out.push(
        `<div class="tw"><table><thead><tr>${head
          .map((c) => `<th>${inline(c)}</th>`)
          .join("")}</tr></thead><tbody>` +
          body
            .map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
            .join("") +
          `</tbody></table></div>`
      );
      continue;
    }

    if (/^>\s?/.test(line)) {
      const body = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) body.push(lines[i++].replace(/^>\s?/, ""));
      out.push(`<blockquote><p>${inline(body.join(" "))}</p></blockquote>`);
      continue;
    }

    if (BULLET.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items = [];
      while (i < lines.length && BULLET.test(lines[i])) {
        let text = lines[i++].replace(BULLET, "");
        // A wrapped bullet: an indented continuation line belongs to it.
        while (i < lines.length && lines[i].trim() && !BULLET.test(lines[i]) && /^\s+\S/.test(lines[i]))
          text += " " + lines[i++].trim();
        items.push(`<li>${inline(text)}</li>`);
      }
      out.push(`<${ordered ? "ol" : "ul"}>${items.join("")}</${ordered ? "ol" : "ul"}>`);
      continue;
    }

    const para = [];
    while (
      i < lines.length &&
      lines[i].trim() &&
      !/^(#{1,4}\s|\||>|```|---+$)/.test(lines[i]) &&
      !BULLET.test(lines[i])
    )
      para.push(lines[i++]);
    out.push(`<p>${inline(para.join(" "))}</p>`);
  }
  return { html: out.join("\n"), headings };
}

// -------------------------------------------------------------- front matter

function parse(file) {
  const raw = fs.readFileSync(file, "utf8");
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?/);
  const meta = {};
  let body = raw;
  if (m) {
    body = raw.slice(m[0].length);
    for (const line of m[1].split("\n")) {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (kv) meta[kv[1]] = kv[2].trim().replace(/^["']|["']$/g, "");
    }
  }
  return { meta, body };
}

// ------------------------------------------------------------------ the page

const PERSONAS = [
  { key: "student", label: "Students", blurb: "Sitting a test, handing it in, reading your result." },
  { key: "parent", label: "Parents", blurb: "Adding a child, credits, marking and releasing a paper." },
  { key: "teacher", label: "Teachers", blurb: "Subjects, tests, students, marking, release." },
  { key: "admin", label: "Admins", blurb: "Teachers, plans, payments, AI usage, the library." },
];

function page({ title, summary, bodyHtml, headings, nav, depth, persona }) {
  const up = "../".repeat(depth) || "./";
  const toc = headings.length
    ? `<nav class="toc" aria-label="On this page"><b>On this page</b><ul>${headings
        .map((h) => `<li><a href="#${h.id}">${esc(h.text)}</a></li>`)
        .join("")}</ul></nav>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}${/\bhelp$/i.test(title) ? "" : " · Vidai help"}</title>
${summary ? `<meta name="description" content="${esc(summary)}">` : ""}
<link rel="stylesheet" href="${up}help.css">
</head>
<body>
<header class="hd">
  <a class="brand" href="${up}index.html">Vidai <span>help</span></a>
  <a class="back" href="/">Back to the app</a>
</header>
<div class="wrap">
  <nav class="side" aria-label="Help sections">${nav}</nav>
  <main>
    ${persona ? `<p class="kicker">${esc(persona)}</p>` : ""}
    <h1>${esc(title)}</h1>
    ${summary ? `<p class="lede">${inline(summary)}</p>` : ""}
    ${toc}
    ${bodyHtml}
  </main>
</div>
<footer class="ft">
  <p>Vidai · <a href="/">vidai.seyali.app</a> · built {{build.date}}</p>
</footer>
</body>
</html>`;
}

function navHtml(pages, current, depth) {
  const up = "../".repeat(depth) || "./";
  return PERSONAS.map((p) => {
    const mine = pages.filter((x) => x.persona === p.key).sort((a, b) => a.order - b.order);
    if (!mine.length) return "";
    return `<div class="side-group"><b>${esc(p.label)}</b><ul>${mine
      .map(
        (x) =>
          `<li${x.href === current ? ' class="here"' : ""}><a href="${up}${x.href}">${esc(
            x.meta.title
          )}</a></li>`
      )
      .join("")}</ul></div>`;
  }).join("");
}

// ----------------------------------------------------------------------- go

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name.endsWith(".md")) out.push(full);
  }
  return out;
}

const f = facts();
const pages = walk(SRC)
  .filter((x) => path.relative(SRC, x) !== "index.md")
  .map((file) => {
    const rel = path.relative(SRC, file);
    const { meta, body } = parse(file);
    if (!meta.title) throw new Error(`${rel}: front matter needs a title`);
    return {
      rel,
      persona: rel.split(path.sep)[0],
      order: Number(meta.order || 0),
      meta,
      body,
      href: rel.replace(/\.md$/, ".html").split(path.sep).join("/"),
    };
  });

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
fs.copyFileSync(path.join(SRC, "help.css"), path.join(OUT, "help.css"));

for (const p of pages) {
  const depth = p.href.split("/").length - 1;
  const { html, headings } = render(substitute(p.body, f, p.rel));
  const persona = PERSONAS.find((x) => x.key === p.persona);
  const dest = path.join(OUT, p.href);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(
    dest,
    substitute(
      page({
        title: p.meta.title,
        summary: p.meta.summary || "",
        bodyHtml: html,
        headings,
        nav: navHtml(pages, p.href, depth),
        depth,
        persona: persona ? persona.label : "",
      }),
      f,
      p.rel
    )
  );
}

// The front door: pick who you are.
const { meta: iMeta, body: iBody } = parse(path.join(SRC, "index.md"));
const cards = PERSONAS.map((p) => {
  const first = pages.filter((x) => x.persona === p.key).sort((a, b) => a.order - b.order)[0];
  return first
    ? `<a class="card" href="${first.href}"><b>${esc(p.label)}</b><span>${esc(p.blurb)}</span></a>`
    : "";
}).join("");
fs.writeFileSync(
  path.join(OUT, "index.html"),
  substitute(
    page({
      title: iMeta.title || "Vidai help",
      summary: iMeta.summary || "",
      bodyHtml: `<div class="cards">${cards}</div>\n${render(substitute(iBody, f, "index.md")).html}`,
      headings: [],
      nav: navHtml(pages, "", 0),
      depth: 0,
      persona: "",
    }),
    f,
    "index.md"
  )
);

console.log(`help: ${pages.length + 1} pages -> dist/help`);
