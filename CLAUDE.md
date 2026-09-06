# CBSE 12 Maths Practice Tests — Project Context

Single-page practice test built with Vite + TypeScript, no framework. Maths is
rendered client-side with KaTeX loaded from a CDN (see `index.html`).

## Why this exists

J's first "make once, sell many" side business. Goal of v1 is not revenue — it is to
complete one full loop: build → students use it → parents pay → nothing more needed from J.
Keep scope brutally small. This is a food cart, not a restaurant.

## Distribution (the road)

- Pilot channel: J's friend, a CBSE Class 12 Maths teacher. He shares tests in his class
  WhatsApp group and picks/approves every question so it feels like *his* test.
- Risk: one friend = one customer. Capture parents' WhatsApp numbers directly from day one
  (score reports) so the audience belongs to the product, not the channel.

## Product plan

1. **Free pilot** — 3 chapter tests × 15 questions, matched to the chapters he is teaching
   over the next 2–3 weeks. Free for his class forever.
2. **Paid step (later)** — 80-mark timed board-pattern mock + PDF/WhatsApp score report for
   parents, ~₹99. Students want practice; parents pay for a report card.
3. Revenue share with the teacher: 30–50% or flat per-student — to be agreed with him.

## Success metric

60%+ of his students attempt each free test. Below that, fix distribution before building more.

## Timeline

- Demo (5 Matrices questions) — done, shareable Netlify link.
- Test 1 — by Sun 13 Sep 2026. Tests 2 & 3 — following two weekends.
- Paid mock decision after test 3, based on usage data.

## Stack and constraints

- v1: Vite + TypeScript, no framework, KaTeX via CDN, static deploy (Netlify drop).
- Later: Angular 21 (J's core stack), Supabase, Razorpay, Resend — only when v1 loop is proven.
- NOT in scope yet: backend, auth, payments, adaptive logic, analytics dashboards.
- Mobile-first. Buyers use cheap Android phones — test there, not just on the Mac.
- Maths must render properly (matrices, integrals); Class 12 students notice ugly maths.
- Question content stays in JSON so it ports unchanged into the Angular app later.

## Deployment

- Live at https://vidaivi.seyali.app (Azure Static Web Apps, Free tier; custom domain
  via CNAME on Hostinger, SSL managed by Azure).
- Every push to `main` auto-deploys via `.github/workflows/azure-static-web-apps.yml`
  (needs the `AZURE_STATIC_WEB_APPS_API_TOKEN` repo secret).
- PRs against `main` get a preview URL posted on the PR — use it for teacher approval
  of new question sets before merging.
- Analytics: Azure Application Insights (optional). Activates only when the
  `APPINSIGHTS_CONNECTION_STRING` repo secret is set (passed to the build as
  `VITE_APPINSIGHTS_CONNECTION_STRING`); without it `src/analytics.ts` no-ops.
  Events: test_open, test_start, test_resume, question_answered, test_complete,
  review_open, test_retake, home_open.

## Auth & data (Google login + SWA managed Functions)

- Tests with `access: "login"` require Google sign-in; the demo stays guest-open.
- Client: Google Identity Services popup (`src/auth.ts`), enabled only when
  `VITE_GOOGLE_CLIENT_ID` is set at build time (GitHub secret `GOOGLE_CLIENT_ID`);
  without it the app is guest-only (local dev).
- Server: SWA managed Functions in `api/` (Node, Functions v4 model).
  `POST /api/login` verifies the Google ID token (aud + expiry via Google's
  tokeninfo endpoint) and upserts the profile (name/email/picture/phone) in
  Table Storage; `POST/GET /api/attempts` saves/lists the student's attempts.
- SWA application settings (Azure portal, not repo): `GOOGLE_CLIENT_ID`,
  `STORAGE_CONNECTION_STRING` (Storage account; tables `profiles`, `attempts`,
  `students` are auto-created), `SESSION_SECRET` (any long random string —
  signs student session tokens), `TEACHER_EMAILS` (comma-separated Gmail
  addresses that get the teacher role).
- Admin: `ADMIN_USERNAME` + `ADMIN_PASSWORD` app settings enable
  `POST /api/admin-login` (12h HMAC session, prefix `vad.`); `ADMIN_EMAILS`
  grants the admin role to those Google accounts. Admins manage the teacher
  allowlist (`teachers` table) via `GET/POST /api/teachers` from the app's
  Admin dashboard (welcome screen → Admin link); the table is checked in
  addition to `TEACHER_EMAILS`. Admins also have all teacher powers.
- Roles: Google login is for **teachers and parents** (role decided by
  `TEACHER_EMAILS`); **students** log in with a teacher-issued
  username/password (`POST /api/student-login` → 30-day HMAC session token,
  prefix `vst.`). Teachers manage students via `GET/POST /api/students`
  (create with auto-generated username + password, reset password); passwords
  are stored as salted scrypt hashes and returned in plain text only at
  create/reset time. `/api/attempts` accepts both identity kinds.
- First login asks once for a WhatsApp phone number (stored on the profile —
  the parent-contact capture from the product plan).
- Attempt saves are fire-and-forget with a localStorage retry queue
  (`vidaivi:pendingAttempts`); localStorage remains the source of truth for the
  student's own resume/review UX. Google ID tokens expire after ~1h — an
  expired session just re-queues saves until the next sign-in.

## Cloud-authored tests (`/api/tests`, table `tests`)

Phase 1 of `docs/PRODUCT-PLAN.md`. Teachers author tests that live in Table
Storage instead of the repo; bundled `src/tests/*.json` stay as the platform seed.

- `GET /api/tests` → metadata list visible to the caller (teachers/admins see
  their own + published platform tests; students see published platform tests
  plus their own teacher's published tests).
- `GET /api/tests?id=<id>` → one full test (questions included) if visible.
- `POST /api/tests` with `{action, ...}`: `create`/`update` (`{test: {...}}`,
  same JSON shape as the bundled files), `publish`, `unpublish`, `archive`,
  `delete` (drafts only). Teachers only; a teacher can only touch their own tests.
- Lifecycle: `draft → published → archived`; only published tests reach students.
- Storage shape: PK `test`, RK = test id; questions are JSON split across
  `qc0..qcN` string properties (Table Storage caps one property at 64KB) with
  `chunkCount`. Taxonomy (`board`/`klass`/`subject`) is stored from day one,
  fixed to CBSE/12/Maths until the UI exposes it.
- Client: `src/api.ts`. Home merges published cloud tests into the test list;
  a `?test=<id>` link that isn't bundled falls back to fetching it from the API,
  so teacher-authored test links work the same way as built-in ones.
- Console → **My tests** lists a teacher's cloud tests with publish/archive/delete.
  **Create test** / **Edit** open the authoring editor (`src/screens/editor/`);
  **Quick add** / **Quick edit** open the card builder (`src/screens/builder.ts`):
  metadata plus per-question cards (type, topic, marks, question, type-specific
  answer fields, solution) with a live "Student sees" preview under each text
  field. Client validation mirrors the server's rules. Pasting test JSON is still
  available as "Import JSON instead".

## Authoring editor (`src/screens/editor/`)

A **full-bleed application shell** from the approved design canvas — not a page
of cards in a container. The app bar spans the window; three columns fill the
height, divided by borders: **tests tree (268px) · question · explanation
(384px)**. Below 1180px the explanation drops under the question; below 900px the
surfaces become bottom tabs and the tree slides in as a drawer. Keep both
properties — the shell fills the viewport, and the explanation belongs on the
right rather than stacked in the middle column; `e2e/editor.cjs` asserts each.

Tree interactions follow the design: **Create** makes a new *test*; questions are
added with the **+** that appears between rows on hover (insert at that
position); each row has a **…** menu (duplicate, move, delete) and a drag handle
for reordering.

`index.ts` is the shell (app bar, tree, overview, responsive panes), `state.ts` holds the working
copy and autosaves ~1s after typing (saves are serialised, never concurrent),
`panels.ts` renders the question body, the type-adaptive Answer Expected panel
and the explanation, each with a live "Student sees" preview.

- **Validation is status-aware** (`validateQuestions(input, {strict})` in
  `api/shared/core.js`): a draft may hold unfinished questions so autosave never
  fails mid-sentence; publishing runs the strict pass against what is *stored*
  and returns `problems[]` naming every question that needs work.
- **Question ids carry a random suffix** (`newQuestionId` in `src/api.ts`).
  They must never be positional — deleting a question and adding another would
  reuse a surviving question's id.
- **Editing is draft-only**: a published test opens read-only behind "Unpublish
  to edit", because `update` overwrites the row students are reading. Versioning
  (next slice) replaces this.
- **Starter samples**: a teacher with no tests gets the bundled tests copied in
  as their own editable drafts, once ever (`teacherstate` table, `seedSamples`).
- `?edit=<testId>&q=<questionId>` restores a teacher's place across a refresh.

## Source layout (`src/`)

- `main.ts` — boot only: analytics init, URL → screen routing. No screen code here.
- `types.ts` — Question/Test/Attempt interfaces (mirror the JSON schema below).
- `data.ts` — TESTS registry (`import.meta.glob` over `src/tests/*.json`), `totalMarks`, `testTitle`.
- `dom.ts` — `app` root, `escapeHtml`/`formatText`/`renderMath`, ICONS, topbar/brand, `copyText`, `pct`.
- `attempts.ts` — localStorage attempt store, guest mode, `requiresLogin`.
- `auth.ts` — auth state + all API fetch calls. `analytics.ts` — App Insights.
- `screens/auth.ts` — welcome, student login, admin login, phone capture.
- `screens/home.ts` — home test list, profile row, cloud-saved results.
- `api.ts` — fetch client for the DB-backed tests API.
- `screens/console.ts` — teacher/admin console shell, allowlist, roster, student report, my tests.
- `screens/builder.ts` — visual test builder (create/edit cloud tests).
- `screens/test.ts` — test player (landing → questions → score → review).

Convention: each screen is a `show*()` function that replaces `app.innerHTML` and binds
its listeners; cross-screen imports are function-only (safe with ES-module cycles).
Full product roadmap lives in `docs/PRODUCT-PLAN.md`.

## E2E regression (`e2e/`)

`node e2e/serve.cjs` serves the built `dist/` on :4400 with `/api/*` proxied to
production; `node e2e/regression.cjs` runs the Playwright suite (guest flows always;
admin flows only when `E2E_ADMIN_USER`/`E2E_ADMIN_PASS` env vars are set — never
hardcode credentials). See `e2e/README.md`.

## Local development

`npm run dev` serves the app on localhost with hot reload. The API is Azure SWA
managed Functions and can't run under Vite, so `vite.config.ts` proxies `/api/*`
to a deployed environment — production by default, or set `VITE_API_TARGET` to a
PR preview URL to try unmerged API changes. Copy `.env.example` to `.env.local`
(gitignored) to enable the login screens locally; student and admin logins work
on localhost, while Google sign-in only works from origins registered on the
OAuth client.

Local dev talks to the **real** database, so students and tests created there
are the live ones.

## Commands

- `npm run dev` — local dev server (API proxied, see above)
- `npm run build` — typecheck + production build to `dist/` (ready for Netlify drop)
- `npm run preview` — serve the built `dist/`

## Test & question JSON schema (`src/tests/*.json`) — stable, do not change without updating this file

Each test is one JSON file in `src/tests/` (auto-discovered via `import.meta.glob`
in `src/main.ts` — adding a file adds the test, no code change). A test file is an
object:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Stable test ID, used in the URL (`/?test=<id>`) and as the localStorage key. Never change after sharing a link. |
| `title` | string | yes | Shown on home card and test landing screen. |
| `chapter` | string | yes | CBSE chapter name. |
| `teacher` | string \| null | yes | Shown as "Curated by …" on the landing screen; `null` hides the line. |
| `order` | number | no | Sort order on the home screen (ascending). |
| `access` | `"open"` \| `"login"` | no | `"login"` requires Google sign-in before the test; default `"open"` (guest). |
| `questions` | Question[] | yes | Array of question objects (below). |

Student progress/results are stored per test in `localStorage` under
`vidaivi:attempt:<test id>` — device-local, no backend.

Question objects (`src/main.ts` types this as `Question`; do not rename or
repurpose fields):

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique stable ID, e.g. `"mat-003"`. Never reuse. |
| `chapter` | string | yes | CBSE chapter name, e.g. `"Matrices"`. |
| `topic` | string | yes | Sub-topic shown as a chip on the question card. |
| `type` | `"mcq"` \| `"numeric"` \| `"long"` | yes | Controls the UI and grading (see below). |
| `q` | string | yes | Question text. Inline maths in `$...$`, display maths in `$$...$$` (KaTeX). JSON-escape backslashes: `\\times`, `\\begin{pmatrix}`. |
| `options` | string[] | mcq only | Answer choices, rendered A/B/C/D in order. |
| `answer` | number | mcq + numeric | For `mcq`: 0-based index into `options`. For `numeric`: the expected numeric value. |
| `tolerance` | number | numeric only | Accept answers within ±tolerance of `answer`. Use `0` for exact. |
| `solution` | string | yes | Worked solution shown after submission. Supports `$...$` maths, `**bold**`, and blank lines (`\n\n`) as paragraph breaks — nothing else (no full markdown, no HTML). |
| `marks` | number | yes | Marks awarded when correct. Score screen totals these. |

Grading by type:
- **mcq** — student picks an option; correct iff selected index equals `answer`.
- **numeric** — student types a number; correct iff `|value − answer| ≤ tolerance` (defaults to 0 if omitted).
- **long** — no auto-grading: student reveals the solution and self-assesses ("I got it right/wrong"), earning full `marks` or 0. Do not add `options`/`answer`/`tolerance` to long questions.

Notes:
- `answer` is a JSON **number** in both cases (not a string) — that's what `src/main.ts` grades against.
- Question style: CBSE board pattern (1-mark MCQ, 2–3 mark numeric, 5-mark long).
- Total marks = sum of `marks` across the file; no separate config.
- Content is plain-text escaped before rendering, so raw HTML in strings will display literally, not render.

## Working style

- Concise, structured output. No padding.
- Prefer the smallest change that keeps the loop moving.
- Ask before adding any dependency, backend, or new feature outside this file.
