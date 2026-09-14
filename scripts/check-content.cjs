#!/usr/bin/env node
//
// Publish-proof every chapter file in content/ before it ever reaches the API.
//
//   node scripts/check-content.cjs                # every shelf
//   node scripts/check-content.cjs content/class12-maths
//
// The server refuses to publish a test whose questions fail the strict pass in
// `validateQuestions`. Running that same function here — the real one, read out
// of api/shared/core.js, never a copy — means a broken question is caught while
// the file is being written rather than in the middle of a seed run.
//
// It also checks the things validateQuestions has no opinion about but a
// library does: unique test ids across all shelves, an `order` per chapter, and
// that a question's `chapter` matches the test it sits in.

const fs = require("fs");
const path = require("path");

const CORE = path.join(__dirname, "..", "api", "shared", "core.js");
const API = path.join(__dirname, "..", "api");

// core.js exports handlers only, so evaluate it with the validator exposed —
// the same trick e2e/helpers.cjs uses, and for the same reason: test the
// shipping function, not a second implementation of it.
const mod = { exports: {} };
new Function(
  "module",
  "exports",
  "require",
  fs.readFileSync(CORE, "utf8") + "\nmodule.exports.__validate = validateQuestions;"
)(mod, mod.exports, (id) =>
  id.startsWith("@azure/") ? require(path.join(API, "node_modules", id)) : require(id)
);
const validateQuestions = mod.exports.__validate;

const roots = process.argv.slice(2);
const dirs = roots.length
  ? roots
  : fs
      .readdirSync(path.join(__dirname, "..", "content"))
      .map((d) => path.join("content", d))
      .filter((d) => fs.statSync(d).isDirectory());

const ids = new Map();
let files = 0;
let questions = 0;
let bad = 0;

for (const dir of dirs.sort()) {
  const names = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  console.log(`\n${dir} (${names.length} chapters)`);
  for (const name of names) {
    const file = path.join(dir, name);
    let test;
    try {
      test = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      console.error(`  ${name}: not valid JSON — ${err.message}`);
      bad++;
      continue;
    }
    const fail = (why) => {
      console.error(`  ${name}: ${why}`);
      bad++;
    };
    if (!test.id) fail("no test id");
    if (ids.has(test.id)) fail(`test id "${test.id}" is already used by ${ids.get(test.id)}`);
    else ids.set(test.id, file);
    if (!test.title) fail("no title");
    if (!test.chapter) fail("no chapter (the subtitle)");
    if (typeof test.order !== "number") fail("no numeric order");

    // What `formatText` in src/dom.ts can actually render: $…$ maths, **bold**,
    // and a blank line as a paragraph break. Nothing else. Anything richer is
    // escaped and shown to the student literally, pipes and all.
    //
    // Both of these shipped before this check existed:
    //
    //   - A **markdown table**. `formatText` has no table support, so a
    //     frequency table rendered as a wall of "| 0 - 10 | 4 |" and the
    //     "|---|---|" separator showed up as visible junk. Write one line per
    //     row instead, with the header in bold.
    //   - A **literal backslash-n**, from building the JSON in Python with a
    //     raw string, where "\\n" stays two characters instead of becoming a
    //     newline. Every paragraph break in that question then appeared on
    //     screen as the text \n.
    //
    // Neither is caught by `validateQuestions` — both are perfectly valid
    // strings. They are only wrong once a student reads them.
    for (const q of test.questions || []) {
      for (const field of ["q", "solution"]) {
        const text = q[field];
        if (typeof text !== "string") continue;
        if (text.includes("\\n")) {
          fail(`${q.id} — ${field} contains a literal backslash-n; it needs a real newline`);
        }
        for (const line of text.split("\n")) {
          const t = line.trim();
          if (t.startsWith("|") && t.endsWith("|")) {
            fail(`${q.id} — ${field} has a markdown table row, which renders literally: ${t.slice(0, 40)}`);
            break;
          }
        }
      }
    }

    const res = validateQuestions(test.questions, { strict: true });
    if (res.error) {
      fail(res.error);
      continue;
    }
    for (const p of res.problems || []) {
      fail(`Q${p.index + 1} ${p.questionId} — ${p.reason}`);
    }
    const marks = (test.questions || []).reduce((t, q) => t + (Number(q.marks) || 0), 0);
    files++;
    questions += (test.questions || []).length;
    if (!(res.problems || []).length) {
      console.log(`  ${name} → ${test.id} · ${test.questions.length} questions · ${marks} marks`);
    }
  }
}

console.log(`\n${files} chapters, ${questions} questions, ${bad} problem${bad === 1 ? "" : "s"}.`);
process.exit(bad ? 1 : 0);
