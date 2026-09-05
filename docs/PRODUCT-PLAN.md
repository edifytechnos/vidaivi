# Vidaivi — Full Product Requirements & Phased Build Plan

## Context

Vidaivi started as a single-teacher CBSE-12 Maths pilot (live at vidaivi.seyali.app; Test 1 ships Sun 13 Sep on the current app, untouched by this plan). This plan turns it into a multi-teacher assessment platform: teachers author their own tests with a rich editor, tests are scoped to their students, a platform question bank seeds content via copy-on-fork, and eventually a marketplace lets teachers sell tests to other teachers and to students directly. The long-term vision widens beyond CBSE-12 Maths to other boards (State/ICSE/IGCSE), classes (10/11/12), and exams (JEE/NEET) — so the data model must carry a taxonomy from day one even though the UI shows only CBSE-12 Maths for now.

**Platform decision (user's call): evolve the existing Vite + TypeScript app** — no Angular rebuild. TipTap is framework-agnostic, so this is viable; the codebase gets modularized as it grows (see Architecture).

## Personas & roles

| Role | Login | Can do |
|---|---|---|
| **Admin** (J) | username/password or Google (ADMIN_EMAILS) | Everything + teacher allowlist + platform bank curation + marketplace ops |
| **Teacher** | Google (allowlisted) | Manage students, author/fork/publish tests, review collaborators' tests, dashboards, reply to comments, sell/buy on marketplace |
| **Student** | Teacher-issued username/password | Take their teacher's tests + platform tests + own purchases, comment on questions, see own reports/leaderboard |
| **Parent** | Google (non-allowlisted) | Receive report cards; later: view linked child's progress |
| **Guest** | none | Demo/open tests only, device-local scores |

Student ownership: **one teacher per student** (their class), plus independent marketplace purchases under their own account.

## Domain model (new entities, Azure Table Storage)

- **Taxonomy** on every test/question: `{board, klass, subject, chapter, topic}` — e.g. `{CBSE, 12, Maths, Matrices, "Inverse"}`. UI fixed to CBSE/12/Maths for now; model ready for State/ICSE/IGCSE, classes 10–12, JEE/NEET.
- **Test** (moves from repo JSON to DB): id, ownerTeacherSub, taxonomy, title, status (`draft | in_review | published | archived`), settings (openAt, closeAt, timerMinutes, maxAttempts, leaderboardEnabled), collaborators[], approvers[], forkedFromId, marketplace fields (listed, price — schema only until Phase 4).
- **Question**: belongs to a test; rich content as TipTap JSON (rendered read-only for students, KaTeX for maths, images from Blob Storage); types: `mcq`, `mcq-multi`, `numeric` (+tolerance), `fill-blank` (accepted answers, case/space tolerant), `long` (self-assessed); marks, solution (also TipTap).
- **Platform bank** = tests/questions owned by admin, flagged `platform: true`. Current repo JSON tests become the seed (demo stays guest-open). **Copy-on-pick fork**: picking a bank test/question clones it under the teacher; original never mutates. `forkedFromId` retained for future suggest-back.
- **Attempt** (extend existing): + per-question answers payload (for question-level review), duration, attempt number.
- **Comment**: scope = question or test; author (student/teacher); threaded reply; resolved flag.
- **Purchase / Payout / Listing**: Phase 4 (Razorpay platform-mediated; economics decision deferred — model supports teacher-set price and commission %).
- **Notification**: in-app inbox rows per user (type, refs, read flag).

## Functional requirements by phase

### Phase 0 — Pilot (DONE / in flight)
Current live app: 3 roles, roster, reports, Test 1 by Sep 13 with the friend's questions. Untouched by this plan except bug fixes.

### Phase 1 — Test authoring (core value)
1. **Tests move to the database.** New `tests` API (CRUD, scoped by owner); student home merges platform tests + their teacher's published tests; repo JSON becomes the platform-bank seed via a one-time import.
2. **TipTap editor** for question text, options, and solutions: bold/italic, lists, **maths node** (KaTeX, inline + block, with editing dialog), **image upload** (Azure Blob container + SAS-less upload through an API function), live student-view preview.
3. Question types: current 3 + **multi-select MCQ** (all-or-nothing marking v1) + **fill-in-the-blank**.
4. **Test builder screen** (console area): metadata + taxonomy, question list with reorder/edit/delete, add-from-bank (fork picker with chapter filter), marks auto-total.
5. **Lifecycle**: `draft → in_review → published → archived`. Collaborators (other allowlisted teachers by email) can edit drafts; designated approver(s) must approve to publish. Solo teachers can self-publish (review step optional per test).
6. **Test settings**: open/close datetimes, timer (countdown + autosubmit), max attempts, leaderboard toggle.
7. **Access**: teacher's published tests visible only to that teacher's students. Platform tests follow their own access flag (open/login).
8. Student test player upgrades: render TipTap content, enforce timer/attempt limits/open-close windows.

### Phase 2 — Analytics & parent reports (the paid promise)
1. **Class dashboard per test**: attempted vs pending roster, class average, score distribution, per-question correct % (weak-topic detection).
2. **Question-level review**: teacher opens any student's attempt and sees their exact answers (requires attempts storing answers — added in Phase 1).
3. **Leaderboard**: per-test class rank for students, honoring the per-test toggle.
4. **Parent report card**: shareable per-student report link (later PDF); v1 delivery = ready-to-forward WhatsApp message (existing pattern); this is the ₹99 product surface.

### Phase 3 — Comments / doubt-solving
1. Students comment on a **question** (from review screen) or on the **whole test**; teachers reply inline on the question page; threads resolvable.
2. **In-app inbox**: badge for teachers (unanswered doubts) and students (replies, newly published tests).
3. **WhatsApp Business API** notifications (published test, teacher replied, report ready) — provider selection (Meta Cloud API / interakt / Twilio) and template approval tracked as a sub-project; in-app inbox ships first and works without it.

### Phase 4 — Marketplace
1. Teachers list a published test (price or free); other teachers buy → forked copy for their students; students buy → personal access.
2. **Razorpay platform-mediated**: platform is the merchant; orders + webhook verification in the API; purchases table gates access; teacher payout ledger (settlement process manual at first). Economics (pricing model, commission %) intentionally **deferred** — schema supports teacher-set price + commission.
3. Marketplace browse: taxonomy filters, preview (first N questions), ratings later.

## Architecture evolution (staying on Vite)

- **Modularize `src/`**: split the current single `main.ts` (~1100 lines) into `screens/` (one file per screen), `api.ts` (fetch client), `router.ts` (current query-param routing formalized), `state.ts`. No framework; a tiny render/bind convention documented in CLAUDE.md. Do this as Phase 1 step 0 — before the editor lands.
- **Dependencies to add** (each needs the usual CLAUDE.md ask — pre-approved by this plan): `@tiptap/core` + starter-kit + a KaTeX math extension, and nothing else until Phase 4 (Razorpay is a script include).
- **API** stays SWA managed Functions (v3 layout, `shared/core.js`); new function folders: `tests`, `questions` (or nested in tests), `upload` (Blob), `comments`, `dashboard`, later `orders`, `webhook-razorpay`, `notifications`. Respect the two SWA landmines already discovered: **no `/api/admin*` route names, auth via `X-Vidaivi-Auth` header**.
- **Storage**: Table Storage continues (tests/questions/comments/purchases tables); **Azure Blob Storage** container for question images (public-read, unguessable names). Supabase not needed under this path.
- **Known risks**: TipTap JSON rendering must be sanitized server-side or rendered through TipTap's own renderer (never innerHTML raw); Table Storage has no transactions across tables — keep writes idempotent; the no-framework choice means discipline (the modularization + CLAUDE.md conventions are the mitigation). Re-evaluate the Angular question only if the editor phase proves painful.

## Cross-cutting

- **Analytics events** extended per phase (test_created, test_published, comment_posted, purchase_completed…).
- **CLAUDE.md** updated each phase: new tables, API routes, schema changes (tests leave the repo — the "stable JSON schema" section becomes the platform-bank seed format).
- **Housekeeping debts**: rotate ADMIN_PASSWORD; delete test students; Google origin list gains no new entries.

## Verification approach (each phase)

- Local handler smoke tests (`node` against `shared/core.js` with fake req/context — pattern already established).
- Live API circuit via curl with admin/student tokens (pattern established).
- Browser E2E via Playwright + localhost harness proxying `/api` to production (harness exists in scratchpad; promote it into `e2e/` in the repo).
- Manual: J on desktop (console flows) + phone (student flows) before each phase is announced to teachers.

## Suggested phase sequencing vs. the pilot

- **Now → Sep 13**: nothing from this plan touches production except Phase 1 step 0 (modularization, invisible refactor). Test 1–3 run on current app.
- **Phase 1** build during the pilot weeks; friend becomes design partner for the editor.
- **Phase 2** immediately after (it monetizes the pilot's parents).
- **Phase 3**, then **Phase 4** once ≥2–3 active teachers exist (marketplace needs sellers AND buyers).

## Open decisions (parked deliberately)

1. Marketplace economics: pricing model + commission % (decide at Phase 4 start).
2. WhatsApp API provider + template strategy (decide at Phase 3 start).
3. Suggest-back loop from forks to platform bank (post-Phase 4).
4. Multi-teacher enrollment for students (parked; single teacher + purchases for now).
5. GST/invoicing implications of marketplace revenue (needs real-world advice before Phase 4 launch).
