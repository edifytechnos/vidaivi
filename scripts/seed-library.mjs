#!/usr/bin/env node
//
// Rebuild the built-in library from the repo.
//
// The chapter tests live in content/<shelf>/*.json — NOT in src/tests/, which is
// the guest demo registry and would make them guest-visible. This script pushes
// them into Table Storage as master (`platform: true`) tests under a platform
// subject, so the library is reproducible from git rather than from a shell
// history.
//
//   VIDAI_BASE=https://vidai.seyali.app \
//   VIDAI_ADMIN_USER=... VIDAI_ADMIN_PASS=... \
//   node scripts/seed-library.mjs content/class10-maths
//
// Credentials come from the environment. Never hardcode them.
//
// Re-running is safe: a chapter already in the library is replaced (unpublish →
// delete → create → publish), so editing a JSON file and re-running is the way
// to correct a question.

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.VIDAI_BASE || "https://vidai.seyali.app";
const USER = process.env.VIDAI_ADMIN_USER;
const PASS = process.env.VIDAI_ADMIN_PASS;
const dir = process.argv[2] || "content/class10-maths";

// The shelf each content directory belongs to. Board/class/subject must match
// what the questions actually are: `subjectForAdopter` files a teacher's copy
// under their own subject with the same taxonomy.
const SHELVES = {
  "class10-maths": { board: "CBSE", klass: "10", subject: "Maths" },
  "class12-maths": { board: "CBSE", klass: "12", subject: "Maths" },
};

if (!USER || !PASS) {
  console.error("Set VIDAI_ADMIN_USER and VIDAI_ADMIN_PASS.");
  process.exit(1);
}
const shelf = SHELVES[path.basename(dir)];
if (!shelf) {
  console.error(`No shelf defined for ${dir}. Add one to SHELVES.`);
  process.exit(1);
}

const auth = await fetch(`${BASE}/api/manageauth`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ username: USER, password: PASS }),
}).then((r) => r.json());
if (!auth.token) {
  console.error("Admin login failed.");
  process.exit(1);
}
const hdr = { "Content-Type": "application/json", "X-Vidai-Auth": auth.token };
const post = (url, body) =>
  fetch(`${BASE}${url}`, { method: "POST", headers: hdr, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (url) => fetch(`${BASE}${url}`, { headers: hdr }).then((r) => r.json());

// The shelf: one platform subject per board/class/subject, created once.
const subjects = (await get("/api/subjects")).subjects || [];
let shelfRow = subjects.find(
  (s) => s.platform && s.board === shelf.board && s.klass === shelf.klass && s.subject === shelf.subject
);
if (!shelfRow) {
  const made = await post("/api/subjects", { action: "create", platform: true, ...shelf });
  if (!made.data.subject) {
    console.error("Could not create the shelf:", made.status, made.data.error);
    process.exit(1);
  }
  shelfRow = made.data.subject;
  console.log(`shelf created: ${shelfRow.id} (${shelfRow.title})`);
} else {
  console.log(`shelf: ${shelfRow.id} (${shelfRow.title})`);
}

const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
let ok = 0;
for (const file of files) {
  const t = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
  // Replace rather than update: `update` cannot move a test between subjects,
  // and a master is never mid-attempt, so nothing is lost by rewriting the row.
  await post("/api/tests", { action: "unpublish", id: t.id });
  await post("/api/tests", { action: "delete", id: t.id });
  const made = await post("/api/tests", {
    action: "create",
    test: {
      id: t.id,
      title: t.title,
      chapter: t.chapter,
      teacher: t.teacher || "",
      order: t.order ?? 99,
      access: t.access || "login",
      platform: true,
      subjectId: shelfRow.id,
      questions: t.questions,
    },
  });
  if (made.status !== 201) {
    console.error(`  ${file}: create failed (${made.status}) ${made.data.error || ""}`);
    continue;
  }
  const pub = await post("/api/tests", { action: "publish", id: t.id });
  if (pub.status !== 200) {
    console.error(`  ${file}: publish failed (${pub.status}) ${pub.data.error || ""}`);
    (pub.data.problems || []).forEach((p) => console.error(`     Q${p.index + 1} ${p.reason}`));
    continue;
  }
  ok++;
  console.log(`  ${file} → ${t.id} (${t.questions.length} questions)`);
}
console.log(`${ok}/${files.length} chapters in the library.`);
