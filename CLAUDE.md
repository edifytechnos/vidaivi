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

- Live at https://vidai.seyali.app (Azure Static Web Apps, Free tier; custom
  domain via CNAME on Hostinger, SSL managed by Azure). The pre-rename host
  https://vidaivi.seyali.app stays pointed at the same app, so test links
  already shared in the class WhatsApp group keep working.
- Changing the public hostname takes three steps, all three needed or sign-in breaks:
  CNAME `<host>` → `ambitious-plant-03e9c0f00.5.azurestaticapps.net` in Hostinger DNS,
  the same host added under **Custom domains** in the Azure Static Web App (Azure
  issues the certificate — until then HTTPS fails), and `https://<host>` added to
  **Authorised JavaScript origins** on the Google OAuth client.
- Every push to `main` auto-deploys via `.github/workflows/azure-static-web-apps.yml`
  (needs the `AZURE_STATIC_WEB_APPS_API_TOKEN` repo secret). That workflow has
  **two jobs on purpose** — `production` (push/dispatch) and `qa` (pull request).
  A single job with a conditional environment could land a push to `main`
  somewhere other than production; two jobs cannot. **Both fire on `push`, and
  there is no `pull_request` trigger** — see below.

### QA is one fixed URL, not a URL per PR

**https://ambitious-plant-03e9c0f00-qa.eastasia.5.azurestaticapps.net** — every
push to a branch that is not `main` deploys here (`deployment_environment: qa`,
an Azure *named environment*). Use it for teacher approval of new question sets
before merging.

**It has to be a push trigger, not `pull_request`.** On a `pull_request` event
the deploy action derives the environment from the PR number and **silently
ignores `deployment_environment`** — the job succeeds and the log reads
`Visit your site at: …-<PR number>.…`. That was tried and does not work;
Microsoft's own example pairs `deployment_environment` with a push-on-branches
trigger. The cost is that PRs no longer get an automatic preview comment, which
is fine when the URL never changes.

The URL is fixed **because Google sign-in is bound to an origin**. Per-PR
previews (`…-<PR number>.…`) each have a new origin, so nobody can sign in to
one, which makes them useless for testing anything behind a login. This host is
an authorised JavaScript origin on the OAuth client, alongside
`https://vidai.seyali.app`.

- **One branch under test at a time** — they share the environment, so the
  newest push wins.
- **The Free plan allows only THREE staging environments per app, and the
  fourth does not fail loudly.** It half-serves: roughly half of all requests
  come back as Azure's own 404 page. If QA starts flapping, that is why —
  count the live environments (`…-<name>.eastasia.5.azurestaticapps.net`) and
  close a stale one with **Actions → Deploy to Azure Static Web Apps → Run
  workflow → close_environment**. A PR closing frees its own slot
  automatically; that `pull_request: [closed]` trigger runs the cleanup job
  only and never deploys. Azure's Free plan allows 3 named environments per app if that ever
  needs to become two.
- **`vidai.qa.seyali.app` is not possible here.** Azure does not support custom
  domains on preview environments, only on an app's *production* environment
  ([docs](https://learn.microsoft.com/en-us/azure/static-web-apps/custom-domain)).
  A real QA hostname would need a **second Static Web App** — its own deploy
  token, its own custom domain, and (the actual prize) its own app settings, so
  QA could point at a separate storage account instead of the live one.
- **QA shares production's API and database.** Students and tests created while
  testing are the live ones, exactly as in local dev.
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
  (`vidai:pendingAttempts`); localStorage remains the source of truth for the
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

## The built-in library (`platform: true`, `POST /api/tests {action:"adopt"}`)

A **master** test is one carrying `platform: true` — the Vidai library. It is
never edited or owned by a teacher, and **it reaches no student directly**: a
student only ever sees their own teacher's copy of it. `visible()` therefore
returns `false` for a platform test on the student path, and the student subject
list skips platform tests for the same reason.

- `GET /api/tests?library=1` → the published masters, each with `adopted: true`
  when the caller already holds a copy (matched on `copiedFrom`). Teachers only.
- `POST /api/tests {action:"adopt", id}` copies a published master into the
  caller's account: a **new id** (never the master's), `ownerSub` = caller,
  `platform: false`, `status: "draft"`, `audience: "class"`, `copiedFrom` set,
  every question carried across. It is filed under the caller's **own** subject
  with the same board/class/subject (`subjectForAdopter`), created if they have
  none — a copy filed under the library's subject would be invisible to them.
- Only an admin may create, publish or edit a master (`canManageTest` keeps
  `entity.platform ||` for admins). That is what "the built-in cannot be
  changed" means for a teacher.
- Client: `fetchLibrary` / `adoptTest` in `src/api.ts`, and the **Built-in
  tests** block in Console → My tests: **Use this test** adopts and opens the
  editor on the *copy*, so the teacher lands where they can change it.
- Nothing syncs after the copy is made. `copiedFrom` records the parent so a
  later slice can say "the master has been updated"; a teacher's copy is theirs.

## The library has shelves: platform subjects (`src/screens/library.ts`)

A **shelf** is a subject row carrying `platform: true` — "CBSE Class 10 Maths",
holding one master test per NCERT chapter. It is the shape a teacher already
thinks in, and it is what they meet on **Your subjects**, badged *Built in*
beside their own subjects.

- Every teacher sees every shelf (`listOwnedSubjects` lets a `platform` row
  through regardless of owner); only an **admin** may rename or delete one
  (`mayManage` in the subjects POST, the same rule `canManageTest` uses).
  `create` honours `platform` only for an admin.
- **A shelf never reaches a student**, and needs no rule of its own: a student's
  subject list is derived from the tests they can see, and platform tests are
  already skipped there.
- `GET /api/tests?library=1&subjectId=<id>` is one shelf's chapters.
- Opening a shelf goes to `showLibrary`, **never** the authoring editor:
  `editor/state.ts` is one shared working copy that autosaves, so browsing a
  master through it would queue writes against a test nobody may change.
  `src/screens/library.ts` is read-only and reuses the editor's *layout* only,
  exactly as `src/screens/review.ts` does — `.ed-cols` / `.ed-tree*` /
  `.ed-panel` under `.ed-readonly`, with `bindTreeDrawer` for the phone drawer.
  **Use this test** in the crumb row adopts the chapter and opens the editor on
  the copy.
- `?library=<id>` survives a refresh (`src/main.ts`). The chapter is deliberately
  *not* in the URL: a `test=` param there would be caught by the shared-link
  route and open the test player instead.
- The crumb's back link names the shelf on a wide screen and reads "‹ Back"
  below 720px (`.crumb-wide` / `.crumb-tight`) — the full title pushed **Use
  this test** off the edge of a 390px screen.

### Where chapter content lives

Chapter JSON lives in **`content/<shelf>/*.json`** — `content/class10-maths/`,
`content/class12-maths/` — and is pushed into Table Storage as masters by
`node scripts/seed-library.mjs content/class10-maths` (`VIDAI_BASE`,
`VIDAI_ADMIN_USER`, `VIDAI_ADMIN_PASS` from the environment; never hardcode
credentials). The script creates the shelf if it is missing, then for each file
unpublishes → deletes → creates → publishes, so **editing a JSON file and
re-running is how a question is corrected**.

**Not `src/tests/`.** Everything there is picked up by `import.meta.glob` and
becomes a guest-visible bundled demo test. `src/tests/` is the guest demo and
nothing else; the library is `content/`.

`order` on each chapter is its NCERT chapter number, so the tree reads 1…14.

## Authoring editor (`src/screens/editor/`)

A **full-bleed application shell** from the approved design canvas — not a page
of cards in a container. The app bar spans the window; three columns fill the
height, divided by borders: **tests tree (268px) · question · explanation
(384px)**. Below 1180px the explanation drops under the question; below 900px the
surfaces become bottom tabs and the tree slides in as a drawer. Keep both
properties — the shell fills the viewport, and the explanation belongs on the
right rather than stacked in the middle column; `e2e/editor.cjs` asserts each.

The tree is a real tree: **every test is a root node**, its **questions are the
level beneath it**. Any test can be expanded — another test's questions are
fetched on demand (`loadTreeQuestions`) and clicking one switches the editor to
that test. **Create** is the small **+** in the tree's header (`#ed-new-test`) and makes a
new *test*; questions are added with the **+** that appears between rows on hover, inserting at that position (only the slot below
the hovered question shows). Each question row has a **…** menu (duplicate,
move, delete) and a drag handle for reordering.

### The app bar names where you are; the pane holds the actions

The bar reads **Vidai │ subject ▾ │ test title · status**. The brand is a button
that goes to Your subjects (bound in `installShell()` in `src/screens/menu.ts` —
`shell.ts` must not import `screens/subjects.ts`, which imports `mount` from it).
`mount()`/`setShellbar()` take an optional **`lead`** slot between brand and
title; the editor fills it with `#ed-subject`, a `<select>` of the teacher's
**own** subjects (a platform shelf is read-only and opens on its own screen).
The list is fetched **once when the editor opens**, in the same `Promise.all` as
the tests, and reused on every render. Switching calls `showEditorForSubject`.
`setShellbar` writes `lead` only when given it, so a re-render cannot wipe the
picker out from under an open dropdown. Below 1100px the audience note drops and
below 600px the title does: the crumb row already carries the test's name.

**Every action is one icon row** (`.ed-toolbar`, `toolbarMarkup`) at the top
right of the overview pane — Who sees this (`#ed-audience`), Preview
(`#ov-preview`), Quick edit (`#ov-quick`, drafts only) and Publish
(`#ov-publish`) / Move back to draft (`#ed-unpublish-bar`). There is no
PUBLISHING card and no duplicate set in the app bar; the bar keeps identity and
state only (the tree toggle and the status chip, whose `title` is
`audienceNote()`). The read-only banner keeps its own `#ed-unpublish`, which is
why the toolbar's is `#ed-unpublish-bar` — two of the same id would leave one
unbindable.

**A test is named on two lines wherever it is listed**: the chapter, and the
rest of the title beneath it smaller and lighter, so two tests on the same
chapter are told apart. `testLabel` / `testLabelMarkup` in `src/dom.ts` is the
one implementation (`.tl > .tl-main + .tl-sub`) — it strips a leading
`Class N ·` prefix, since the class is the subject you are already in. Used by
the editor tree, `library.ts`, `student.ts`, `review.ts` and `home.ts`. **Not**
the app bar (`mount({title})` sets `textContent`, and a second line would grow
the bar) and **not** the My tests table, which has its own Chapter column.

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

## Performance, scale and cost — the rules that hold everywhere

This is a free-tier product with paying customers coming. Money is not the
binding constraint — Table Storage is about $0.045/GB a month and $0.00036 per
10,000 transactions, so even ten million operations costs pennies. **Latency on
a cheap Android phone and the Free tier's 100 GB/month of bandwidth are the
constraints**, which is why every rule below is about doing less work and
sending fewer bytes rather than about buying something.

Where everything lives: the static site on **Azure Static Web Apps Free**
(global edge), the API as **SWA managed Functions** (`api/`, consumption plan,
cold starts of 1–3s), the data in **11 Azure Table Storage tables** and
students' answer photos in the private blob container `answers`. No Redis, no
Front Door, no Cosmos — and none of them are wanted until the numbers say so.

### The five rules

1. **Every `listEntities` names the properties it wants.** Without `select`,
   Table Storage returns the whole row — which for `tests` means `qc0..qcN`,
   the full text of every question. A list of titles was carrying every paper
   it walked past. Projections live next to the query (`TEST_META_SELECT`,
   `SUBJECT_SELECT`, `ROSTER_SELECT`, `ATTEMPT_LIST_SELECT`, `GRADING_SELECT`)
   — **add a property to the projection when a listing starts needing it**, and
   never add the question chunks back.
2. **Never query without a PartitionKey.** A filter on `RowKey` alone, or on an
   ordinary property alone, is a scan of the whole table that grows forever.
   `hasAttemptInProgress` was one; it is now a handful of point reads against
   the test's own audience. If a question cannot be answered from one partition,
   the key is wrong — change the key, don't write the scan.
3. **No N+1 awaited in a loop.** Use `inBatches(items, 20, fn)`: parallel, but
   bounded. `/api/reports` was 200 serial round trips for a class of 200.
4. **Anything derived from a stable input is memoised in-process.** A warm
   Function instance serves many requests, so `makeCache(max)` holds Google
   token claims, the teacher allowlist and student records behind short TTLs.
   Every cache entry carries a TTL and **every write that invalidates one calls
   `drop()`**, because a warm instance must never disagree with a cold one for
   longer than its TTL. See the revocation note below.
5. **Derived counts are stamped on write, never computed on read.**
   `chunkQuestions` writes `questionCount` and `totalMarks` alongside the
   chunks, which is the only reason a listing can project the chunks away.
   Every write of questions goes through that one function, so they cannot
   drift. Rows written before this are healed once, bounded, by
   `backfillCounts`.

### What the caches cost in correctness

- **Google tokens** (`GOOGLE_TOKEN_TTL_MS`, 5 min): capped well under the
  token's own hour. A rejection is cached for 30s so a client looping on a
  stale token cannot hammer Google.
- **Teacher allowlist** (`ROLE_TTL_MS`, 60s): `handlers.teachers` drops the
  entry on add and remove, so the admin's own instance sees the change at once;
  another instance catches up within the minute.
- **Student records** (`STUDENT_TTL_MS`, 30s): the deliberate trade. Removing a
  student must revoke their access — the students handler drops the entry on
  delete and reset, but **across instances a removed account stays usable for
  up to 30 seconds**. Shorten this before lengthening it.
- Token cache keys are a **sha256 of the credential**, never the credential.

### Client and edge

- `public/staticwebapp.config.json` caches `/assets/*` (Vite-fingerprinted, so
  safe) as `immutable` for a year, `index.html` and `/` as `no-cache`, and
  `/api/*` as `no-store`. **A new asset gets a new hash; never hand-edit a file
  under `/assets/` in place.**
- **KaTeX is bundled, not CDN-loaded**, and imported dynamically from
  `renderMath` in `src/dom.ts`, so it sits in its own chunk and loads only when
  maths appears. Same origin means no extra DNS + TLS handshake on a phone, and
  a school network that blocks jsDelivr can no longer silently kill maths
  rendering. Fonts are still Google-hosted.
- A screen should fetch **once**, in parallel (`Promise.all`), not call the
  same endpoint twice on one render.

### Not yet, and why

Ranked, with the next architectural step first:

- **Re-partition `tests` and `subjects` by `ownerSub`** — they use a constant
  PartitionKey (`"test"`, `"subject"`), so every read still scans the whole
  platform and every write lands in one partition. Fine at one teacher, fatal
  at five hundred. **This is the one true architectural change outstanding**,
  and it gets cheaper the sooner it is done.
- **Bake published tests to immutable blobs on publish.** Editing is already
  draft-only, so a published paper never changes — which makes it CDN-cacheable
  forever at `tests/<id>/<version>.json`. Forty students opening the same test
  would be one origin read, not forty Function invocations.
- **SWA Standard (~$9/mo)** — buy first, when the SLA or >100 GB/mo is needed.
- **Front Door (~$35/mo), Redis (~$16/mo), Cosmos DB** — no. SWA already serves
  static from a global edge, rule 4 gives most of what Redis would, and Table
  Storage with the right partition keys handles a hundred thousand students.

Prices are from memory — check the Azure calculator before committing to any.

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
- `screens/test.ts` — test player (landing → questions → score); guests only, past the landing.
- `screens/student.ts` — the student's workspace: subject → tests tree → one question.
- `screens/assign.ts` — "Who sees this test": the audience picker, shared by the editor and My tests.
- `screens/review.ts` — read-only review, one question per page.
- `screens/marking.ts` — the teacher's marking queue for long answers.
- `answerphotos.ts` — camera capture, browser-side downscale, photo strips.

Convention: each screen is a `show*()` function that replaces `app.innerHTML` and binds
its listeners; cross-screen imports are function-only (safe with ES-module cycles).
Full product roadmap lives in `docs/PRODUCT-PLAN.md`.

## E2E regression (`e2e/`)

`node e2e/serve.cjs` serves the built `dist/` on :4400 with `/api/*` proxied to
production; `node e2e/regression.cjs` runs the Playwright suite (guest flows always;
admin flows only when `E2E_ADMIN_USER`/`E2E_ADMIN_PASS` env vars are set — never
hardcode credentials). `node e2e/helpers.cjs` needs no browser and no network: it
covers the pure helpers in `api/shared/core.js` (the counts stamped on write, the
in-process cache, `inBatches`). Because the browser suite proxies `/api/*` to
**production**, it does not exercise unmerged API changes — point `E2E_API_BASE`
at the PR preview for those. See `e2e/README.md`.

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
`vidai:attempt:<test id>` — device-local, no backend.

Question objects (`src/main.ts` types this as `Question`; do not rename or
repurpose fields):

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique stable ID, e.g. `"mat-003"`. Never reuse. |
| `chapter` | string | yes | CBSE chapter name, e.g. `"Matrices"`. |
| `topic` | string | yes | Sub-topic shown as a chip on the question card. |
| `source` | string | no | Where the question came from, e.g. `"CBSE 2025"`. Shown as a quieter chip beside the topic; never graded, never required. |
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
- **long** — no auto-grading. A signed-in student photographs their working and hands it in; the teacher awards the marks (see below). A guest keeps the old self-assessment. Do not add `options`/`answer`/`tolerance` to long questions.

Notes:
- `answer` is a JSON **number** in both cases (not a string) — that's what `src/main.ts` grades against.
- Question style: CBSE board pattern (1-mark MCQ, 2–3 mark numeric, 5-mark long).
- Total marks = sum of `marks` across the file; no separate config.
- Content is plain-text escaped before rendering, so raw HTML in strings will display literally, not render.

## Long answers: photos in, teacher marks out

A `long` question is no longer self-marked when a **signed-in student** answers
it. They photograph their working, hand it in, and the teacher awards the marks;
the score is provisional until then. A guest on the demo, or a teacher previewing
their own test, keeps the old self-assessment — nobody would ever mark theirs.

- **Photos** live in the private Azure Blob container `answers`
  (`<studentId>/<testId>/<questionId>/<ts>-<rand>.jpg`), in the same storage
  account as the tables. `POST /api/answerimage` takes JSON `{testId,
  questionId, questionIndex, maxMarks, testTitle, image}` where `image` is
  base64 — the client downscales to 1600px / JPEG 0.72 in a canvas first
  (`src/answerphotos.ts`), so there is no multipart parsing anywhere. Students
  only; ≤ 1.5 MB and ≤ 3 photos per answer; JPEG/PNG confirmed by magic bytes.
  `GET /api/answerimage?blob=` returns `{url}` — a 15-minute SAS — because an
  `<img>` cannot carry `X-Vidai-Auth`. Readable by the owning student, their
  teacher, an admin, or a linked parent.
- **Marks** live in the `grading` table, one row per (student, test, question):
  PK = `stu~<username>`, RK = `<testId>~<questionId>`, holding `images`,
  `maxMarks`, `status` (`submitted` → `marked`), `awarded`, `comment`,
  `teacherId`. `GET /api/grading?queue=1` is the teacher's queue;
  `GET /api/grading[?student=&testId=]` is one student's rows;
  `POST {action:"mark", username, testId, questionId, awarded, comment}` awards.
- **The attempt row is never touched by a teacher.** Its `score` stays the
  auto-graded subtotal — long answers contribute 0 until marked — and the
  displayed score is that plus the `awarded` values, merged on read
  (`hydrateMarks` in `src/screens/test.ts`). That keeps marking off the
  student's row entirely: no etag races, and no risk of tripping the
  `Q_CHUNK` guard that silently drops an oversized `answers` blob.
- Storage needs no new app setting — the blob client reuses
  `STORAGE_CONNECTION_STRING`. The container is created on first upload.

## Releasing the answers (`/api/release`, table `releases`)

Taking a test is **silent**: a signed-in student submits and nothing comes back —
no verdict, no correct answer, no worked solution, for any question type. The
teacher decides when the paper opens. (Guests on the demo keep the old instant
feedback: they have no teacher to release anything, and the demo has to stay
useful as a demo.)

- Table `releases`: PK = test id, RK = username for one student, or `*` for the
  whole class. Row holds `releasedAt`, `releasedBy`. "Can this student see the
  paper" is two point reads — `isReleased(testId, username)` — never a scan.
- `GET /api/release?testId=` → `{released}` for a student; add `&student=` for a
  teacher, admin or linked parent asking about one student; a teacher asking
  without `student` gets `{classWide, students[]}` for the whole test.
- `POST {action:"release"|"unrelease", testId, username?}` — teachers/admins,
  gated by `canSeeStudent`. Omit `username` to open it for everyone.
- Client: `fetchReleased` / `fetchReleaseState` / `setReleased` in `src/auth.ts`.
  `fetchReleased` **fails closed** — a network error keeps the paper shut.

## The test is silent until the teacher releases it

A signed-in student submits and **nothing comes back** — no verdict, no correct
answer, no worked solution, for any question type (`finishQuestion` in
`src/screens/test.ts`). The score screen shows their marks but locks the
question-by-question detail. **Guests keep the old instant feedback**: a guest
has no teacher to release anything, and the demo has to stay worth sharing.
`canHandIn()` is the one test for "is this a real student with a teacher".

Release is per student *and* per class — see `/api/release` above. The teacher
presses it from the marking queue (`src/screens/marking.ts`) or from a student's
report (`showStudentReport` in `src/screens/console.ts`).

## Where a question came from (`source`)

A question may carry `source` — free text, ≤ 40 characters, e.g. `"CBSE 2025"` —
rendered as a `.chip-source` beside the topic wherever a question is shown:
`src/screens/student.ts` (sitting the test), `src/screens/review.ts` (the
released result) and `src/screens/test.ts` (the guest player). Teachers set it in
the **Source** box beside Topic, in both the editor and the quick-add builder.

It is optional and never validated: a question without one is complete, so no
existing test can become unpublishable. But it **must be carried explicitly** in
the `clean` object inside `validateQuestions` (`api/shared/core.js`) — that object
is rebuilt from scratch on every save, so any property not named there is
silently dropped on the first round trip.

The first use is the Class 10 Real Numbers test, whose board-year tags are
evidenced question by question in `docs/class10-real-numbers-sources.md`. Tag a
question with a year only when the paper has actually been read: a wrong year is
worse in front of a class than no year at all.

## Who sees a test (`audience` / `assignedTo`, `POST /api/tests {action:"assign"}`)

Publishing is the act of sharing: a published test reaches **everyone the
teacher created**, which is the default (`audience: "class"`) and what every
test written before assignment carries. A teacher can narrow it to named
students — `audience: "selected"` plus `assignedTo`, a JSON array of usernames
on the test row.

- `POST /api/tests {action:"assign", id, audience, usernames[]}` — teachers and
  admins, own test only. Every username is re-checked through `canSeeStudent`,
  so a teacher cannot assign someone else's student, and `"selected"` with an
  empty list is a 400 rather than a test nobody can see by accident.
- `visible()` gains one clause: published **and** owned by the student's teacher
  **and** `assignedTo(e, username)`. The student subject list applies the same
  rule, or a narrowed test would still light up its subject card.
- **Fails closed**: an unreadable or empty `assignedTo` on a `"selected"` test
  reaches nobody, never everybody — the same principle as `fetchReleased`.
- **A student is never sent the class list.** `testMeta` carries `audience` and
  `assignedCount`; only staff get `assignedTo` (`testMetaForStaff`).
- Client: `assignTest` in `src/api.ts`, and `openAssign` / `audienceLabel` in
  `src/screens/assign.ts` — the one dialog the editor's **Who sees this** button
  and My tests' **Seen by** column both open.
- **A draft reaches nobody, however it is assigned.** The editor's top bar says
  so ("Students cannot see this yet — publish it to share it", `audienceNote`),
  and My tests reads "nobody yet". That sentence is the one that was missing
  when a teacher wondered where their test had gone.

## The correct MCQ option says it is the correct option

The radio beside each option marks the answer. It used to say nothing, and it
arrived **pre-set to A** — `blankQuestion`, the quick-add builder, and
`validateQuestions` (which forced an unset answer back to `0`) all agreed on it
— so a teacher who never touched the radios published a paper where A was the
answer to every question.

- Nothing is pre-selected (`answer: -1`), in both the editor
  (`src/screens/editor/panels.ts`) and the card builder (`src/screens/builder.ts`).
- The panel says *the option you select is the correct answer*, and until one is
  picked it says publishing is blocked. The chosen row carries a **Correct
  answer** tag and every radio has a real `aria-label`.
- `validateQuestions` keeps an unset answer unset, so the existing strict pass
  raises "No correct option marked" and publishing returns the question in
  `problems[]` instead of quietly answering it. Drafts still autosave.

## The shared modal also does radios and checklists (`src/modal.ts`)

`ModalField.kind` is `"text"` (the default), `"radio"` or `"checklist"`, with
`choices` and an optional `showWhen: {field, value}` that shows a field only
while another holds a value. A checklist's ticks arrive as the **second**
argument to `onSubmit` (`picks[name]`), since one field yields many values; a
radio also reports its single pick in `values`. This is how "Who sees this test"
is built — use it rather than adding another inline form.

## The student's workspace (`src/screens/student.ts`)

A student gets the same shape their teacher authors in, read-only: **subjects →
a tree of tests → one question beside the tree**. Never a single page of every
question scrolling to the end — that rule holds everywhere a test is shown.

- Signing in lands on **Your subjects** (already true); a subject now opens the
  workspace rather than the flat test list. Every test is a root node in the
  tree and the open test's questions are the level beneath it, exactly as in
  `src/screens/editor/`.
- **Sitting the test has no explanation column** — `.ed-cols.overview`, two
  columns — and no worked solution anywhere on the page. The discussion panel
  under the question is the next phase's work; nothing is stubbed for it yet.
- **Reading the result has both**: that is `src/screens/review.ts`, unchanged —
  three columns, with the explanation on the right, once the teacher releases
  the paper.
- **The controls follow the approved screen**: *Hand in test* sits at the right
  of the breadcrumb row, and **Previous · progress · Save answer · Next** form
  one row at the foot of the answer card. The released result mirrors it, with
  *Retake test* in the same place. Below 560px that row becomes a grid — Save
  full width, then the two steps, then the count — and `.st-navrow .btn` needs
  `min-width: 0`, because `.btn` carries `min-width: 130px` and a bare `1fr`
  column cannot shrink under it (the row spilled out of the card on a phone).
  Below 720px the crumb keeps only the subject link and the action; the test
  title is in the app bar already and wrapped onto four lines otherwise.
  `e2e/regression.cjs` asserts the order, the single row, and that nothing
  overflows the card at 390px.
- **Below 900px the tree is a side drawer**, on the workspace and the result
  alike: `.ed-tree` is parked off-canvas with `transform: translateX(-100%)` and
  **`visibility: hidden`** — the visibility is what hides it, since a transform
  alone leaves it "visible" to Playwright and to a screen reader — and slides in
  when its `.editor` carries `tree-open`. `bindTreeDrawer` and
  `drawerToggleMarkup` in `src/shell.ts` are the one implementation: a
  **Questions** button at the left of the crumb row opens it; the scrim, Escape
  or picking a question closes it. The workspace's old bottom tab bar is gone
  with it (its only job was the tree), which is also how the result screen
  finally got a way to reach its question list on a phone.
- **Padding is tighter below 900px** (`.ed-center` 12/14, `.ed-panel` 12/13,
  10/11 under 480px) so the question owns the small screen. The ≥900px canvas is
  untouched.
- **Questions may be answered in any order** and revisited; an answered one is
  ticked in the tree. The score is *recomputed* from the answers on every save
  (`recomputeScore`), never accumulated, so changing an answer cannot double it.
- **One test at a time**: while an attempt is in progress, every other
  not-started test is disabled in the tree and on the overview cards. Finishing
  or handing in releases the lock.
- `?test=<id>&q=<questionId>` carries the place, so a refresh mid-test lands
  back on the same question instead of the landing card (`showLanding` reads
  `?q=` *before* `setUrl` drops it). `vidai:subject` remembers which subject the
  student is working in, so "back" still works after a reload.
- A shared `?test=` link opens with no subject loaded, so `showAttempt` seeds the
  tree with the test being sat and fills the rest of the subject in when it
  arrives — the tree is never empty under the question.
- **Guests keep the old linear player** (`showQuestion` in `src/screens/test.ts`)
  with its instant verdict and solution: the demo's whole value is that
  feedback, and a guest has no teacher to release anything. `startTest` is the
  one place that chooses, on `canHandIn()`.
- Coming later, deliberately not built: a running timer, and questions unlocked
  only in order.

## Review: one question per page (`src/screens/review.ts`)

Review is **not** a scroll of the whole paper. It is the layout the teacher
authors in, read-only: questions listed down the left with each result on its
row, one question in the middle (the student's answer, their photos, the
awarded mark and the teacher's comment), the explanation on the right. Prev/next
walk the paper and `?test=<id>&review=<questionId>` carries the place.

It reuses the editor's **layout only** — `.ed-cols`, `.ed-tree*`, `.ed-panel`,
`.ed-preview`, `.ed-tabs` — under an `.ed-readonly` modifier. Never change those
base rules: `e2e/editor.cjs` asserts `.ed-cols` computes to exactly three columns
at 1280px and that `.ed-tree` / `.ed-explain` sit flush to the rail and the
window edge. Do **not** reach into `src/screens/editor/` for this: its panels are
all inputs with no read-only renderer, and `editor/state.ts` is a single shared
working copy that autosaves, so a student opening a test through it would queue
writes against the teacher's draft.

The `.review-item` class stays on the question view — `e2e/regression.cjs`
asserts it.

## The Vidaivi → Vidai rename

- localStorage moved from `vidaivi:*` to `vidai:*`. `migrateStorage()` in
  `src/attempts.ts` copies every old key across and **must stay the first
  statement in `src/main.ts`** — `vidaivi:auth` holds the session and
  `vidaivi:pendingAttempts` holds unsynced saves. The old keys are left in place
  and can be deleted a release from now.
- The auth header is `X-Vidai-Auth`. For one release the client sends **both**
  names and `getBearer()` in `api/shared/core.js` accepts both, because the
  deploy is not atomic. Drop both fallbacks once the renamed API is everywhere.
- **`vidai.seyali.app` is an authorised JavaScript origin on the Google OAuth
  client** — done, and Google sign-in works there. Recorded because it is a
  requirement of the rename, not an open task: any *new* host needs the same
  entry or Google sign-in fails on it, while student and admin logins are
  unaffected.

## An expired session says so (`apiFetch` in `src/auth.ts`)

A Google ID token expires after about an hour. Before this, every call then
returned `401 {"error":"Invalid token"}` and each fetch helper swallowed it and
returned `null`/`[]` — so screens rendered their ordinary empty state and the
console said "Could not load … refresh to retry", which cannot possibly help.
An hour-old session looked exactly like a teacher whose data had been deleted.

- **Every call to our API goes through `apiFetch`.** A 401 can only mean
  `identify()` rejected the token — permission refusals are 403 and network
  failures throw — so it ends the session: `signOut()`, set
  `vidai:sessionExpired`, and hand off to the callback registered by
  `handleSessionExpiry()` in `src/main.ts` (which shows the welcome screen).
- **`/api/login`, `/api/studentauth` and `/api/manageauth` are excluded**: a 401
  there is a wrong password, not an expired session.
- One sign-out however many calls 401 together (`expiring` guard), and
  `vidai:pendingAttempts` is deliberately left alone so unsynced answers
  survive and flush on the next sign-in.
- `showWelcome()` reads `sessionJustExpired()` and explains it — the sign-in
  timed out, nothing is lost. `e2e/regression.cjs` asserts this for teacher,
  admin and parent, and asserts a valid session is *not* signed out.
- **Two things keep that message on screen**, and both were needed: `mount()`
  refuses to paint while `sessionIsExpired()`, because the screen whose call was
  refused is still awaiting its own fetch and would otherwise render its empty
  state straight over the welcome; and `sessionJustExpired()` does **not** clear
  the flag on read, because the welcome screen can render more than once around
  an expiry. Both are cleared in `saveAuth` when someone signs in again.

## Small creation flows use one modal (`src/modal.ts`)

Creating a subject, a student or a teacher opens `openModal({title, description,
fields, submitLabel, onSubmit})`. Use it for any new small "create a thing"
flow rather than adding another inline form.

- `onSubmit(values)` returns a **message to keep the modal open and show it**, or
  nothing to close. Throwing is treated as returning a message.
- A `required: true` field is marked with a red `*`, and validation names the one
  field that is empty ("Subject is needed."), marks it, and focuses it.
- Esc, the ✕, Cancel and a click on the scrim all close it; focus is trapped
  inside while open and restored to the trigger on close.
- `options` renders a datalist — suggestions, never a closed set.

**Why it exists.** The inline subject form pre-filled Board and Class with real
values and gave Subject only a placeholder. Three boxes with grey-and-black text
look identically filled, so submitting failed with "Board, class and subject are
all needed" on a form the teacher had every reason to think was complete. A
placeholder must never be able to pass for a value: `.modal-input::placeholder`
is italic and faint for the same reason, and `e2e/regression.cjs` asserts the
error names the empty field.

## Working style

- Concise, structured output. No padding.
- Prefer the smallest change that keeps the loop moving.
- Ask before adding any dependency, backend, or new feature outside this file.
- Hold to **Performance, scale and cost** above on every change that touches
  `api/` or adds a fetch. The `vidai-scale` skill carries the same rules as a
  checklist — invoke it before writing a query, a handler or a screen fetch.
