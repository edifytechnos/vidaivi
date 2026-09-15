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
// Name as many shelves as you like, or none at all to rebuild every shelf in
// SHELVES below. Credentials come from the environment. Never hardcode them.
//
// Re-running is safe: a chapter already in the library is replaced (unpublish →
// delete → create → publish), so editing a JSON file and re-running is the way
// to correct a question.

import fs from "node:fs";
import path from "node:path";

const BASE = process.env.VIDAI_BASE || "https://vidai.seyali.app";
const USER = process.env.VIDAI_ADMIN_USER;
const PASS = process.env.VIDAI_ADMIN_PASS;
// One shelf per directory, and as many directories as you name — seeding the
// whole library is one run, not eleven.
const dirs = process.argv.slice(2);

// The shelf each content directory belongs to. Board/class/subject must match
// what the questions actually are: `subjectForAdopter` files a teacher's copy
// under their own subject with the same taxonomy.
const SHELVES = {
  "class10-maths": { board: "CBSE", klass: "10", subject: "Maths" },
  "class10-science": { board: "CBSE", klass: "10", subject: "Science" },
  "class12-maths": { board: "CBSE", klass: "12", subject: "Maths" },
  "class12-physics": { board: "CBSE", klass: "12", subject: "Physics" },
  "class12-chemistry": { board: "CBSE", klass: "12", subject: "Chemistry" },
  "igcse-maths": { board: "Cambridge IGCSE", klass: "10", subject: "Maths (0580)" },
  "igcse-science": { board: "Cambridge IGCSE", klass: "10", subject: "Combined Science (0653)" },
  "alevel-maths": { board: "Cambridge A Level", klass: "12", subject: "Maths (9709)" },
  "alevel-physics": { board: "Cambridge A Level", klass: "12", subject: "Physics (9702)" },
  "alevel-chemistry": { board: "Cambridge A Level", klass: "12", subject: "Chemistry (9701)" },
  "neet": { board: "NEET", klass: "12", subject: "Physics, Chemistry & Biology" },
};

if (!USER || !PASS) {
  console.error("Set VIDAI_ADMIN_USER and VIDAI_ADMIN_PASS.");
  process.exit(1);
}
// Chapters that were in the library and are not any more. The seeder replaces a
// test by id, so a file simply deleted from content/ would leave its row
// published forever — nobody would ever see the deletion.
const RETIRED = ["lib-matrices-demo"];

if (!dirs.length) dirs.push(...Object.keys(SHELVES).map((d) => `content/${d}`));
for (const d of dirs) {
  if (!SHELVES[path.basename(d)]) {
    console.error(`No shelf defined for ${d}. Add one to SHELVES.`);
    process.exit(1);
  }
}

// The session is an httpOnly cookie, not a token in the body.
//
// This script used to read `auth.token` from the login response and send it as
// `X-Vidai-Auth`. That stopped working when sessions moved to the
// `vidai_session` cookie (see "The session is a cookie the page cannot read" in
// CLAUDE.md): /api/manageauth now answers `{ok: true}` and sets the cookie, so
// `auth.token` was undefined and every run died on "Admin login failed" — the
// credentials were never the problem.
//
// `X-Vidai-Auth` is still sent, but it is now only the **CSRF marker** that
// `csrfRefused` looks for on a state-changing call. Its value is not a secret
// and is never checked; what authenticates is the cookie.
const login = await fetch(`${BASE}/api/manageauth`, {
  method: "POST",
  headers: { "Content-Type": "application/json", "X-Vidai-Auth": "1" },
  body: JSON.stringify({ username: USER, password: PASS }),
});
const session = (login.headers.getSetCookie?.() || [])
  .map((c) => /(?:^|;\s*)vidai_session=([^;]+)/.exec(c)?.[1])
  .find(Boolean);
if (!login.ok || !session) {
  const body = await login.json().catch(() => ({}));
  console.error(`Admin login failed (${login.status}) ${body.error || ""}`.trim());
  if (login.ok) console.error("Logged in but no vidai_session cookie came back.");
  process.exit(1);
}
const hdr = {
  "Content-Type": "application/json",
  "X-Vidai-Auth": "1",
  Cookie: `vidai_session=${session}`,
};
const post = (url, body) =>
  fetch(`${BASE}${url}`, { method: "POST", headers: hdr, body: JSON.stringify(body) })
    .then(async (r) => ({ status: r.status, data: await r.json().catch(() => ({})) }));
const get = (url) => fetch(`${BASE}${url}`, { headers: hdr }).then((r) => r.json());

let seeded = 0;
let wanted = 0;

for (const id of RETIRED) {
  await post("/api/tests", { action: "unpublish", id });
  const gone = await post("/api/tests", { action: "delete", id });
  if (gone.status === 200) console.log(`retired: ${id}`);
}

for (const dir of dirs) {
  const shelf = SHELVES[path.basename(dir)];
  console.log(`\n${dir} → ${shelf.board} ${shelf.klass} ${shelf.subject}`);

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
  wanted += files.length;
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
    seeded++;
    console.log(`  ${file} → ${t.id} (${t.questions.length} questions)`);
  }
}
console.log(`\n${seeded}/${wanted} chapters in the library.`);
