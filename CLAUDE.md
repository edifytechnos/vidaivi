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
  **separate `production` and `qa` deploy jobs on purpose**: a single job with a
  conditional environment could land a push to `main` somewhere other than
  production, and two jobs cannot. Both fire on **`push`** — `production` when
  the ref is `main`, `qa` when it is not — and a third job, `close_environment`,
  runs on `pull_request: [closed]` and never deploys.

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
one, which makes them useless for testing anything behind a login.

**Only Google sign-in needs that origin entry.** Admin and student logins go
through `/api/manageauth` and `/api/studentauth`, which are not origin-bound, so
QA is fully testable as an admin or a student today. Signing in **with Google**
on QA additionally requires this host under **Authorised JavaScript origins** on
the OAuth client — *this is a pending step, not a record of one already taken*,
unlike the `vidai.seyali.app` entry above which is done.

- **QA carries every open pull request at once** — it is built as `main` with
  every open PR merged on top, not as whichever branch pushed last. Any push to
  any branch rebuilds it, so a session never has to wait its turn and never has
  its test bed overwritten by someone else's push.
  - The branch that pushed goes in **first**, even before it has a PR, so a
    session's very first push still reaches QA with its own changes in it.
  - **A conflict drops one branch, not QA.** The conflicting merge is aborted,
    everything else deploys, and the run's **job summary** lists what QA carries
    and what was left out with the conflicting files. Read that summary before
    concluding a route is broken — a missing endpoint may simply mean your
    branch was the one skipped.
  - QA therefore serves a commit that exists on no branch. That is the point: it
    is what `main` will look like once everything lands, so a conflict between
    two sessions surfaces here instead of in production.
  - `concurrency: qa-deploy` with `cancel-in-progress` keeps two simultaneous
    pushes from racing to upload.
- **Stay at or under three staging environments** — the Free plan's limit, and
  the thing that actually breaks QA. Exceeding it does **not** fail loudly: the
  surplus environment half-serves, answering roughly half of all requests with
  Azure's own 404 page while the deploy log still reports success. An afternoon
  was lost to this. A closing PR frees its own slot automatically via the
  `close_environment` job. **There is no manual close, and the workflow no
  longer pretends there is.** `action: close` is a pull-request operation end to
  end — `deployment_environment` is not even a declared input on the action —
  and Azure answers anything else with *"Request is missing the pull request
  id"*. Three shapes were tried and rejected identically: the environment name,
  a synthetic event naming it, and a synthetic event carrying a plain number;
  each failed run also left a red check on whatever PR it was dispatched from.
  **To free a slot by hand, delete the environment in the Azure portal** (Static
  Web App → Environments), or close and reopen a PR to recycle its own.
  **Actions → Run workflow** now takes no inputs and simply redeploys QA.
  Measured, once back to two environments: a deploy causes **no disruption at
  all** — 10/10 before, during and after, then 30/30 on `index.html` and 12/12
  on each hashed asset. While a third environment existed, fifteen quiet minutes
  never recovered past ~50%. So a flapping QA means **count the environments**;
  it is not something to wait out.
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
- SWA application settings (Azure portal, not repo): `GEMINI_API_KEY` (optional
  — switches on AI marking; `ASSESS_DAILY_CAP` bounds its spend; see below),
  `GOOGLE_CLIENT_ID`,
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
- `POST /api/tests {action:"adopt", ids[], subjectId?}` copies published masters
  into the caller's account: each gets a **new id** (never the master's),
  `ownerSub` = caller, `platform: false`, `status: "draft"`, `audience: "class"`,
  `copiedFrom` set, every question carried across. **`ids` is a list because a
  teacher building a subject picks several chapters at once** — one request, not
  one per chapter (rule 3), bounded by `inBatches(ids, 10, …)` and capped at 50.
  `id` is still accepted for a single copy.
  `subjectId` files the copies under a subject the caller **owns** — anything
  else is a 403, so copies can never be dropped into someone else's subject or
  into the library itself. Without it they land in the caller's own subject with
  the same board/class/subject (`subjectForAdopter`), created if they have none.
- Only an admin may create, publish or edit a master (`canManageTest` keeps
  `entity.platform ||` for admins). That is what "the built-in cannot be
  changed" means for a teacher.
- Client: `fetchLibrary` / `adoptTests` in `src/api.ts`. **A teacher never
  browses the library to adopt.** They meet it at the two moments they are
  already asking for something: **New subject** offers "start from a built-in
  subject" with a tick list of its tests, and the **+** in the tests tree offers
  "copy a built-in test" into the subject they are in. Both use the shared modal
  (`src/modal.ts`).
- Nothing syncs after the copy is made. `copiedFrom` records the parent so a
  later slice can say "the master has been updated"; a teacher's copy is theirs.

## The library has shelves: platform subjects

A **shelf** is a subject row carrying `platform: true` — "CBSE Class 10 Maths",
holding one master test per NCERT chapter. It is the shape a teacher already
thinks in. It is **not** on Your subjects: that grid means *subjects you own*,
for every role, and a shelf is nobody's own work. Shelves live on **Browse
tests** (`src/screens/browse.ts`), and they are offered where a teacher is
already asking for something — New subject's step 1, and the **+** in the tests
tree.

- Every teacher sees every shelf (`listOwnedSubjects` lets a `platform` row
  through regardless of owner); only an **admin** may rename or delete one
  (`mayManage` in the subjects POST, the same rule `canManageTest` uses).
  `create` honours `platform` only for an admin.
- **A shelf never reaches a student**, and needs no rule of its own: a student's
  subject list is derived from the tests they can see, and platform tests are
  already skipped there.
- `GET /api/tests?library=1&subjectId=<id>` is one shelf's chapters.
- **A shelf is not in the editor's subject dropdown** (`ownSubjects` filters
  `!platform`). Shelf-ness is therefore read from a separate `shelfIds` set
  built from the *full* subject list — `viewingShelf()`, and with it
  `readOnly()`, `canAddHere()` and the sibling filter, would otherwise treat
  every shelf as an ordinary subject and hand a teacher an editable master. An
  admin arriving from Browse is *in* a shelf, so `subjectLead()` carries the
  current shelf as a transient entry rather than showing the wrong subject.
- **A shelf still opens in the ordinary authoring editor** when an admin asks
  for it — from **Edit** on a Browse row. An **admin** edits a
  master there exactly as they would their own test (unpublish → edit →
  publish; unpublishing a master is safe because it reaches no student). A
  **teacher** gets it read-only.
  This reverses an earlier rule that shelves must never open in the editor. The
  danger it guarded against was real — `editor/state.ts` autosaves ~1s after a
  keystroke, so a teacher who could type into a master would queue writes the
  server then rejects — and it is now handled at the source: **`readOnly()` in
  `src/screens/editor/index.ts` returns true for `test.platform && !isAdmin()`**,
  so the client never asks. `canManageTest` on the server is still the real
  gate.
- The **+** in the tree is hidden on a shelf unless you are an admin
  (`canAddHere()`): a teacher cannot add to the library.

### Browse: reading the library before you take it (`src/screens/browse.ts`)

`?browse` is the shelf list, `?browse=<id>` one shelf; old `?library=<id>` links
land in the same place. A rail item **Browse tests** (`RailKey` `"browse"`) is
shown to teachers and admins. Three read-only levels: shelves → that shelf's
tests as catalogue rows → one test, one question at a time with its worked
solution, so a teacher can *judge* a test before taking it.

- **Use this test** calls `adoptTest(id)` with **no `subjectId`**, so the server
  files the copy under the caller's own matching subject (creating one if they
  have none) and the editor opens on the copy. **Edit** is admin-only and is
  the route by which a master is corrected — it moved here when shelves left
  Your subjects.
- Like `src/screens/review.ts`, this reuses the editor's **layout only**
  (`.ed-*` under `.ed-readonly`) and never reaches into `src/screens/editor/`,
  whose panels are inputs and whose `state.ts` autosaves a shared working copy.
- **`rowMarkup` is the one row renderer**, and it already has slots for what
  will vary between authors — byline badge, price, "already in your tests". The
  catalogue wireframes (`Step2Catalogue`, `CatalogueRow`) hold that design;
  when teacher-to-teacher sharing arrives those tests join the same list with a
  different byline and the page does not change. Browse fetches the whole
  library to open, which is fine at 16 masters and is the same thing that has
  to move server-side when the catalogue grows.

### Where chapter content lives

Chapter JSON lives in **`content/<shelf>/*.json`** and is pushed into Table
Storage as masters by `node scripts/seed-library.mjs` (`VIDAI_BASE`,
`VIDAI_ADMIN_USER`, `VIDAI_ADMIN_PASS` from the environment; never hardcode
credentials). Name one or more directories, or none at all to rebuild every
shelf. The script creates each shelf if it is missing, then for each file
unpublishes → deletes → creates → publishes, so **editing a JSON file and
re-running is how a question is corrected**.

`RETIRED` in that script names test ids that have **left** `content/`. A test is
replaced by id, so a file merely deleted from the repo would leave its row
published in the library forever — nobody would ever see the deletion.

**The eleven shelves**, each 15 questions per chapter:

| Directory | Shelf | Chapters |
|---|---|---|
| `class10-maths` | CBSE Class 10 Maths | 14 |
| `class10-science` | CBSE Class 10 Science | 13 |
| `class12-maths` | CBSE Class 12 Maths | 13 |
| `class12-physics` | CBSE Class 12 Physics | 14 |
| `class12-chemistry` | CBSE Class 12 Chemistry | 10 |
| `igcse-maths` | Cambridge IGCSE Maths (0580) | 9 |
| `igcse-science` | Cambridge IGCSE Combined Science (0653) | 12 |
| `alevel-maths` | Cambridge A Level Maths (9709) | 10 |
| `alevel-physics` | Cambridge A Level Physics (9702) | 12 |
| `alevel-chemistry` | Cambridge A Level Chemistry (9701) | 12 |
| `neet` | NEET (Physics, Chemistry, Biology) | 6 |

**Not `src/tests/`.** Everything there is picked up by `import.meta.glob` and
becomes a guest-visible bundled demo test. `src/tests/` is the guest demo and
nothing else; the library is `content/`.

`order` on each chapter is its NCERT chapter number where there is one, so the
tree reads 1…14; the Cambridge and NEET shelves are ordered by the syllabus'
own topic order instead.

**`node scripts/check-content.cjs` proves a chapter before it ships.** It runs
the server's own `validateQuestions` — read out of `api/shared/core.js`, never
reimplemented — over every file, plus the things a library cares about and the
validator does not: unique test ids across shelves, an `order` per chapter, a
title and a subtitle. Run it after editing any chapter; a question that would
fail to publish then fails while it is being written rather than mid-seed.

**A `source` tag is a claim, and it has to be earned.** A year is written only
when the question was read verbatim out of a full paper for that year, with the
paper's own code, and the tag must say what kind of paper: `CBSE SQP 2024-25`
is not `CBSE 2024`. `docs/library-sources.md` records which papers exist, which
were obtained, and which shelves carry tags.

**The real board papers are at
`https://www.cbse.gov.in/cbsenew/question-paper.html`** — the papers the class
actually sat, one zip per subject-year holding every set by Q.P. code, for 2022
to 2026 in both the main and the compartment sitting. Class XII Maths, Physics
and Chemistry and Class X Science and Maths are all there. An earlier note in
this repo said they were not published; that was wrong, and `library-sources.md`
says so rather than quietly deleting it, because the index is long enough that
the next person to look will reach the same wrong conclusion.

**Extraction loses notation, and that decides which chapters can be tagged.**
Reading a paper as text keeps the words and the whole numbers and drops the
surds, fractions and superscripts — so a question that reads *"the principal
value of $\sec^{-1}$ ___"* cannot be tagged, because what it asked is no longer
on the page. Chapters carried by words tag well; chapters carried by symbols do
not. `docs/class12-maths-sources.md` states the per-chapter count for that
reason: a thin chapter is a limit of the method, not a shortage of papers.

**Physics tags better than Maths does**, and for the same reason: its questions
are carried by numbers and words — a work function in eV, a refractive index, a
frequency — which survive extraction, where a matrix or a surd does not. Every
one of its fourteen chapters has a sourced question; the Maths shelf cannot say
that.

Tagged today: Class 10 Maths (14 chapters, complete), Class 12 Maths (66 of 195,
Relations and Functions complete at 15) and Class 12 Physics (16 of 210, every
chapter covered). Evidence per shelf in `docs/class12-maths-sources.md`,
`docs/class12-maths-relations-and-functions-sources.md` and
`docs/class12-physics-sources.md`.

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

**Every action is one icon row** (`.ed-toolbar`, `toolbarMarkup`) in the **Test
details panel's own header**, right-aligned — Who sees this (`#ed-audience`),
Preview (`#ov-preview`), Quick edit (`#ov-quick`, drafts only) and Publish
(`#ov-publish`) / Move back to draft (`#ed-unpublish-bar`). It belongs to that
panel, not to a bar floating above it. On a library master viewed by a teacher
the row collapses to **Preview alone** — publishing, the audience picker and
quick edit would all 403. There is no
PUBLISHING card and no duplicate set in the app bar; the bar keeps identity and
state only (the tree toggle and the status chip, whose `title` is
`audienceNote()`). The read-only banner keeps its own `#ed-unpublish`, which is
why the toolbar's is `#ed-unpublish-bar` — two of the same id would leave one
unbindable.

**A test is named on two lines wherever it is listed**: the **Title** on top and
the **Subtitle** beneath it, smaller and lighter. `testLabel` /
`testLabelMarkup` in `src/dom.ts` is the one implementation
(`.tl > .tl-main + .tl-sub`), and it is deliberately trivial — line one is what
the teacher typed in Title, line two is what they typed in Subtitle. **Nothing
is derived, stripped or rearranged.**

An earlier version put the chapter first and tried to work the rest out of the
title by substring-matching and stripping a `Class N ·` prefix. It was clever
and unpredictable: a teacher could not tell what either line would say without
running it. Two boxes, two lines, in that order.

The second box is **labelled Subtitle** in the editor and the card builder, but
it is still `chapter` in the JSON and in Table Storage — the stored schema has
not changed, only the label and where it renders. Used by the editor tree,
`student.ts`, `review.ts` and `home.ts`. **Not** the My tests table, which has
its own Chapter column. The app bar was on that list too — `mount({title})`
sets `textContent`, and a second line grows the bar — and it still is on a
desktop, where the two sit side by side. Under `.shell-scroll` on a phone the
bar does stack them, because there the crumb row carries neither and the bar
is the only thing that says what is open.

**The tree rows carry no icon.** The caret already says a row opens, and the
two-line label is the thing to read.

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

## Security — the rules that hold everywhere

Vidai holds minors' names, exam answers and photographs of their handwriting.
That is the standard to design to, and none of what follows costs anything.

### Signing in is throttled, and the two buckets are not equal

There was no rate limiting anywhere. A student password was one of **23,040**
strings and nothing counted the guesses, so a classmate who knew a username
could walk the whole space in minutes. Every guess also ran scrypt, which made
the login endpoint a CPU burn billed to a consumption plan.

- Table **`authattempts`**: PK = bucket kind (`user` | `ip`), RK = a **sha256
  digest** of the identifier — no raw IP is ever stored. Point reads and point
  writes only, never a scan.
- **The gate runs before the row read and before any hashing** (`loginGate`).
  Letting an unthrottled caller reach scrypt is what turns a login into a denial
  of service the owner pays for.
- **`LOCK_AFTER = { user: 5, ip: 50 }`, and the gap is deliberate.** A whole
  school commonly sits behind one NAT address; an IP threshold as tight as the
  username one would let a single student fumbling their password lock out every
  classmate. The username bucket stops an attack — an attacker must name an
  account and cannot evade the count. The IP bucket only catches someone walking
  many accounts at once, and `x-forwarded-for` is **not** a trust boundary, so
  spoofing it sidesteps only the weaker of the two.
- Locks step 30s → 1m → 2m → 5m → 15m → 30m and cap there. A quiet
  `FAIL_WINDOW_MS` (15 min) wipes the slate: this throttles attacks, it does not
  punish a student who mistypes today and again next week.
- Covers `/api/studentauth`, `/api/manageauth` and invite redemption. Redemption
  buckets the **caller**, never the code — locking a code would let anyone shut
  a real parent out.

### A wrong username costs exactly what a wrong password costs

`studentlogin` used to return early when the username was unknown, so the answer
came back measurably quicker for a name with no account — a free oracle for
"which of my classmates is registered". An unknown username now still pays for a
comparison against `timingDecoyHash()`. `adminlogin` runs both `safeEqual`
compares rather than `||`-short-circuiting past the second.

### Generated passwords

`word + 2 digits + word + word` from a **64-word list** — 64³ × 90 =
**23,592,960**, exactly 1024× the 23,040 it was. Still all lowercase with a
two-digit number, because a student reads it off WhatsApp and types it on a
phone. **Existing students keep their old password until it is reset** — reset
the roster once after this ships.

### Escaping covers quotes

`escapeHtml` escaped `& < >` and not `"` or `'`, while being interpolated into
attribute positions all over the app (`value="${escapeHtml(opt)}"`). Text
positions never needed the quotes; attribute positions always did. One helper
serves both — **never narrow it again**.

### The Content-Security-Policy is real, and the suite proves it

`globalHeaders` in `public/staticwebapp.config.json` carries the CSP plus
`x-content-type-options`, `referrer-policy`, `permissions-policy` and
`cross-origin-opener-policy`.

- `script-src 'self'` holds because the build has **no inline script and no
  `eval`** — keep it that way, and never add `'unsafe-inline'` to scripts.
- `style-src` does allow `'unsafe-inline'`: KaTeX writes inline styles on every
  formula. Style injection is a far smaller problem than script injection, and
  this is the trade that buys a strict `script-src`.
- `font-src` allows `data:` because Vite inlines one small KaTeX `woff` under
  its 4KB limit. A `data:` font cannot execute.
- `permissions-policy` keeps `camera=(self)`: answer photos use
  `<input type="file" capture>`, and locking the camera off risks the hand-in
  flow on Android for no gain.
- **`e2e/serve.cjs` applies these headers locally**, so the policy is exercised
  by the suite rather than first met in production, and
  `e2e/regression.cjs` fails on any `securitypolicyviolation`. That test caught
  the `data:` font on its first run. **A CSP that is not tested is a CSP that
  breaks sign-in in front of a class.**

### Already sound — do not regress these

- Every interpolated OData filter escapes quotes (`.replace(/'/g, "''")`).
- `safeId` allowlists `[a-z0-9-]` rather than blocklisting.
- `/api/answerimage` parses the owner from the blob path, requires the `stu~`
  prefix, gates on `canSeeStudent`, and signs a SAS scoped to that one blob for
  15 minutes.
- Passwords are scrypt with a per-user salt, compared with `timingSafeEqual`.
- `ROSTER_SELECT` excludes `passwordHash`.
- Authorization fails **closed**: `assignedTo`, `fetchReleased`, `canSeeStudent`.
- Login says "Wrong username or password" for both halves.

### The session is a cookie the page cannot read

The token used to live in `localStorage`, where any script could read it: an XSS
past the CSP took the account outright. It is now an **httpOnly + Secure +
SameSite=Strict cookie** (`vidai_session`), and the client holds nothing but a
profile — a name, a role, a picture. Losing that costs a sign-in screen.

- **One token shape for all three kinds**: `<prefix>.<payload>.<hmac>`, with
  `vst` student, `vad` admin and `vgo` teacher/parent. **A Google ID token is
  now accepted in exactly one place** — `/api/login`, where it is exchanged for
  a Vidai session and never held by the client again.
- **Silent renewal.** `renewIfStale` re-issues a session past the halfway point
  of its life; `json()` picks the new cookie off `context.__renewCookie`, so
  every handler renews without knowing about it. Signing in lasts until someone
  signs out, instead of until Google expires the ID token an hour later. There
  is no refresh token to store, leak or revoke.
- **CSRF is two locks.** `SameSite=Strict` keeps the cookie off every cross-site
  request; on top of that `csrfRefused` requires a custom header on any
  state-changing call, which a cross-origin page cannot set without a CORS
  preflight this API never answers. **The guard wraps every handler at export
  time**, not handler by handler — that is the only way a rule like this
  survives a new endpoint.
- SWA's edge rewrites the cookie's domain to the request host and passes the
  `Cookie` header back in unchanged. Both were **verified against a deployed
  preview** before the design was written, because the same edge replaces
  `Authorization`.
- **Local dev needs `cookieDomainRewrite: ""`** in `vite.config.ts` — the API is
  proxied from the deployed host, and a browser on localhost would throw the
  cookie away.
- For one release the API still accepts the token in `X-Vidai-Auth`, for tabs
  opened before this shipped. Drop that path, `getBearer`, and `AuthState.credential`
  once everyone has reloaded.

### Sign out everywhere (`tokenEpoch`, `POST /api/signout`)

Every account carries a `tokenEpoch`, stamped into each token at issue and
checked on every request. Bumping it invalidates every token ever minted for
that account, on every device at once — no token list to walk, nothing stored
per device.

- `POST /api/signout` clears the cookie; `{everywhere: true}` bumps the epoch
  first. The cookie is cleared **either way**: a failed revoke must not leave
  the caller apparently signed in.
- Where the epoch lives: on the `students` row (free — `identify` already reads
  it), on the `profiles` row for Google accounts, and in the `authstate` table
  for the admin, who signs in against environment variables and so has no row.
- **Resetting a student's password bumps their epoch**, so the devices that had
  the old password lose access instead of keeping it for a month.
- `EPOCH_TTL_MS` is 30s: the instance that did the revoking is correct at once,
  another warm instance catches up within 30 seconds. That window is how long a
  stolen session still works — **shorten it before lengthening it**.

### The admin has a second factor (`/api/twostep`, TOTP)

The admin password is one shared string that opens every teacher, every student
and every answer photo. Throttling only slows a guess; it does nothing about a
password that has leaked. A time-based code makes a leaked password
insufficient, and costs nothing.

- **TOTP (RFC 6238) is hand-rolled against `node:crypto`** — it is an HMAC of a
  counter, and a dependency for thirty lines would be a supply-chain surface on
  the most sensitive endpoint in the product. That is only defensible because
  `e2e/helpers.cjs` checks it against **the RFC's own test vectors**, including
  one past 2^32 that exercises the 64-bit counter split. Keep those tests.
- **A used code is dead.** `totpMatchStep` returns *which* step matched rather
  than a boolean; the row stores it and refuses anything at or below it, at
  sign-in and when switching the factor off. A code read over a shoulder cannot
  be replayed inside its own 30 seconds.
- **A wrong code counts against the lockout; a missing one does not.** Six
  digits are walkable in minutes unthrottled. A *missing* code is different:
  reaching that branch already needed the right password, and counting it would
  lock the real admin out for filling the form in two steps.
- **Eight single-use recovery codes**, scrypt-hashed, shown once. An admin
  locked out of their own platform is worse than the codes existing.
- **Turning it on ends every other admin session** (they predate the factor,
  including one an attacker may hold) and re-issues the caller's own cookie in
  the same response. **Turning it off needs a current code**, not just a
  session, or a stolen session could remove it.
- Setup is manual key entry, not a QR: a QR needs a bundled encoder, and this is
  done once by one person. State lives in `authstate`, PK `totp`, RK `admin`.
- **The lost-phone path**: an admin who signs in with **Google** may switch the
  factor off without a code. That is not a hole — this factor protects the
  shared username-and-password login, and a Google admin already holds every
  power on the platform through an account with a second factor of its own, so
  requiring a code from a different credential adds nothing against them. The
  password session still has to prove a code, which is the case that matters.
  Only a password session gets a replacement cookie: minting a `vad.` one for a
  Google caller would hand them a second identity named after their Google sub.
- **The backstop if there is no Google admin either**: delete that one row in
  the Azure portal's Storage browser. Nothing else reads it.

### Never name an API route `admin…`

`/api/adminsecurity` returned **404 on every request** while the identical
handler answered under another name. It is not a code problem and not a stale
deploy: a throwaway function proved new functions register fine, and a second
probe proved the same handler works as `zzprobe` and fails as `adminprobe`.
**Any `/api/` route beginning with `admin` is silently not served** — Azure
Functions reserves that namespace for its own management API. The endpoint is
`/api/twostep` for this reason. Nothing warns you; the route simply 404s as if
the function did not exist.

### Known and not yet done

- `authattempts` rows are never swept. They are tiny and point-keyed, so this is
  untidy rather than costly.

## Source layout (`src/`)

- `main.ts` — boot only: analytics init, URL → screen routing. No screen code here.
- `types.ts` — Question/Test/Attempt interfaces (mirror the JSON schema below).
- `data.ts` — TESTS registry (`import.meta.glob` over `src/tests/*.json`), `totalMarks`, `testTitle`.
- `dom.ts` — `app` root, `escapeHtml`/`formatText`/`renderMath`, ICONS, topbar/brand, `copyText`, `pct`.
- `attempts.ts` — localStorage attempt store, guest mode, `requiresLogin`.
- `auth.ts` — auth state + all API fetch calls. The page never holds the session
  token; `authHeader()` sends a CSRF marker, not a secret. `analytics.ts` — App Insights.
- `screens/auth.ts` — welcome, student login, admin login, phone capture.
- `screens/home.ts` — home test list, profile row, cloud-saved results.
- `api.ts` — fetch client for the DB-backed tests API.
- `screens/browse.ts` — read-only catalogue of built-in shelves and their tests.
- `screens/console.ts` — teacher/admin console shell, allowlist, roster, student report, my tests.
- `screens/builder.ts` — visual test builder (create/edit cloud tests).
- `screens/test.ts` — test player (landing → questions → score); guests only, past the landing.
- `screens/student.ts` — the student's workspace: subject → tests tree → one question.
- `screens/assign.ts` — "Who sees this test": the audience picker, shared by the editor and My tests.
- `screens/review.ts` — read-only review, one question per page.
- `screens/marking.ts` — the marking queue (a list) and `openStudentPaper`, the one way into marking a paper.
- `answerphotos.ts` — camera capture, browser-side downscale, photo strips.

Convention: each screen is a `show*()` function that replaces `app.innerHTML` and binds
its listeners; cross-screen imports are function-only (safe with ES-module cycles).
Full product roadmap lives in `docs/PRODUCT-PLAN.md`.

## E2E regression (`e2e/`)

`node e2e/serve.cjs` serves the built `dist/` on :4400 with `/api/*` proxied to
production — **forwarding cookies both ways**, and stripping only `Secure` and
`Domain` on the way back so a session set by the deployed host survives on
`http://localhost`. A browser context holds **one** session cookie, where a
header used to let one tab hold three identities at once, so the suite has
`keepSession`/`putSession` to park and restore a jar, and `signInStudent`/
`asStudent` to run a second identity from Node. `node e2e/regression.cjs` runs
the Playwright suite (guest flows always;
admin flows only when `E2E_ADMIN_USER`/`E2E_ADMIN_PASS` env vars are set — never
hardcode credentials). `node e2e/helpers.cjs` needs no browser and no network: it
covers the pure helpers in `api/shared/core.js` (the counts stamped on write, the
in-process cache, `inBatches`) **and drives the second factor through the real
handlers against a fake Table Storage** — enabling, replay refusal, recovery
codes, the session re-issue — so those paths are not left to be tried by hand. Because the browser suite proxies `/api/*` to
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

## The teacher marks on the student's own screen, with an AI first draft

**Marking happens inside the paper**, not in a screen of its own. A teacher
opens a student's paper — from the marking queue, or from **Open & mark** on an
attempt row in their report — and gets the three-column review the student
reads their result on, with the marks row under each long answer and **Release**
in the crumb. The MCQs and numerics are already graded and already show their
marks; that was the point of putting them on the same screen.

- **The queue is a list now** (`src/screens/marking.ts`): one card per student
  and test, "3 to mark". Its old detail pane is deleted. That pane could mark an
  answer but could not show the rest of the paper — not the MCQs the student got
  wrong, not the marks already earned — and it was laid out unlike anything else
  in the app.
- **`openStudentPaper` is the one way in**, exported from `marking.ts` and used
  by the console too, so a teacher learns one screen. It sets `?review=` before
  painting, because `showReview` reads the question from the address bar.
- **An answer can outlive its test.** A photo reaches the queue when it is
  uploaded, which may be long before the paper is handed in — so
  `openStudentPaper` falls back to the in-progress row, then to an empty paper,
  and says plainly when the test itself has been deleted.
- `showReview({marking: true})` is the whole switch; the layout does not change.

### The AI proposes; the teacher awards (`POST /api/assess`)

**The model never awards a mark.** It writes `aiAwarded` / `aiComment` /
`aiReasoning` on the grading row; only the teacher's existing
`POST /api/grading {action:"mark"}` writes `awarded` and moves `status` to
`marked`. A wrong AI mark is therefore a suggestion a teacher overrules, never a
mark a student receives — and the proposal is **not** pre-filled into the marks
row, because a number a teacher has to *choose* gets reviewed and one already in
the box gets rubber-stamped.

- **Gemini `gemini-3.5-flash-lite`**, called from the Function with plain
  `fetch` (no new dependency): `POST /v1beta/interactions`, key in the
  `x-goog-api-key` header, `input[]` of one text part plus the photographs, and
  `response_format` with a JSON schema so the reply is never free prose. The
  answer comes back at `interaction.output_text` as a JSON string.
- **The paid tier is not optional.** Google's free tier says content *is* used
  to improve their products; the paid tier says it is not. What is being sent is
  a child's handwriting. Keep billing on.
- **The model is never told who the student is** — it gets the question, the
  teacher's model solution, the marks available and the images. Nothing else is
  its business, and nothing else is in the request if it leaks.
- **A daily cap, not a vault.** A loaded key is money with no brakes: at ~₹0.15
  an assessment, ₹500 is about 3,300 calls, and a stuck retry or a stolen
  teacher session could spend it in an afternoon. `ASSESS_DAILY_CAP` (200)
  bounds it per teacher per day — PK `assess`, RK `<digest(teacherId)>~<date>`,
  a point read and a point write, never a scan; tomorrow is simply a different
  key, so nothing needs sweeping. **The gate runs before the row read, the blob
  downloads and the model call**, for the same reason `loginGate` runs before
  scrypt: the expensive work is exactly what an abuser wants. A failed model
  call does not consume a slot. `e2e/helpers.cjs` drives this through the real
  handler against a fake table and asserts that a refused assessment never
  reaches the network.
- **Key Vault is not available here, and this is not a tier problem.** Microsoft's
  own page says Key Vault integration is unavailable for *"static web apps using
  managed functions"*, that *"Azure Serverless Functions do not support direct
  Key Vault integration"*, and that managed identity is Standard-plan only. Our
  API **is** managed functions, so `@Microsoft.KeyVault(SecretUri=…)` in an app
  setting does nothing at any tier. Reading a vault from code needs a credential
  to reach the vault — without managed identity that is a client secret in an
  app setting, which moves the secret rather than protecting it, and adds a
  round trip per cold start. Real Key Vault means **bring-your-own Functions +
  Standard**. If that is ever done, do it for `STORAGE_CONNECTION_STRING`,
  `SESSION_SECRET` and `ADMIN_PASSWORD` first: they are the account, the
  sessions and the platform, while the Gemini key is capped pocket money.
- **Harden the key at Google instead**: restrict it to the Generative Language
  API, and set a budget alert on the project. IP restriction is not usable —
  SWA managed Functions have no stable outbound address.
- **It does not work from this app's region, and that is why it ships off.**
  The Static Web App runs in Azure **East Asia, which is Hong Kong**, so its
  Functions call out from there — and Hong Kong is on **neither** Google's
  Gemini available-regions list **nor** Anthropic's supported-countries list.
  Both were checked; India, where the key was created, is on both, which is why
  the same key works from a laptop and 400s from the app. The error is
  *"This API is not available in your current location"*, and it was only
  visible after the provider's `error.message` was allowed through — worth
  remembering the next time a provider call fails opaquely.
  **Setting the key does not fix it.** The three ways out, none of them small:
  a model deployed inside Azure (AI Foundry — the call never crosses a border),
  moving the app to a served region such as Central India (a new Static Web App:
  region is fixed at creation, so new deploy token, custom domain, OAuth
  origins and QA URL — and it would also cut latency for students who are all
  in India), or Vertex AI with a service account instead of an API key.
  Until one of those happens the feature is **dormant on purpose**: a 400 whose
  message names a location marks it unavailable in-process for six hours
  (`aiUnavailableUntil`) and `/api/assess` answers **501** from then on, so the
  button disappears instead of failing on every press. Leaving a key set in the
  portal is therefore harmless.
- **Set `GEMINI_API_KEY`** as an SWA application setting to switch it on
  (`GEMINI_MODEL` overrides the model). Without it `/api/assess` answers **501**
  and the client hides the button — dormant, exactly like analytics without its
  connection string. `e2e/regression.cjs` asserts the 501.
- **It runs only when the teacher presses "Assess with AI"**, one answer at a
  time. Nothing is spent on papers nobody opens. About ₹0.15 an answer.
- The provider's error body is never echoed to the client: it can contain the
  request, and the request contains the handwriting.

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
- `GET /api/release?testIds=a,b,c` → `{released: {id: bool}}` — the same
  question for up to 50 papers at once, because the results list asks about
  every paper a student has handed in and one request per paper is an N+1 from
  a phone. Still only point reads (`isReleased` twice per id, `inBatches`).
- `POST {action:"release"|"unrelease", testId, username?}` — teachers/admins,
  gated by `canSeeStudent`. Omit `username` to open it for everyone.
- Client: `fetchReleased` / `fetchReleaseState` / `setReleased` in `src/auth.ts`.
  `fetchReleased` **fails closed** — a network error keeps the paper shut.

## The test is silent until the teacher releases it — marks included

A signed-in student submits and **nothing comes back**: no verdict, no correct
answer, no worked solution, **and no score**. **`showScore` is the guest's
screen and only the guest's.** It used to show a student their marks with the
detail behind a padlock and *Try again* beside it, which is three wrong things
at once — a number that is a half-truth while every long answer is unmarked, a
padlock where an answer should be, and an invitation to retake a paper the
teacher has not finished with.

What a student gets instead, in order:

1. **Hand in → back to their subject.** `handIn` in `src/screens/student.ts`
   goes to `showStudentSubject`, with one green note (`.st-handed`,
   `takeHandedIn()`) saying the paper is in and what happens next. It is a note
   for one render, not state: a reload has nothing to say about it.
2. **The paper stays open to them, read-only and silent.** `showReview` has one
   flag, `open`, and it is the whole difference between the two screens it is:
   `false` renders what they answered and nothing else — two columns, no
   explanation, no correct answer, no marks in the tree, no *Try again*, and a
   chip that says only *Answered* / *Not answered*. A blank "not released yet"
   page used to stand here, which left a student unable to see what they had
   handed in.
3. **Released → the result.** The same screen with `open` true: marks, correct
   answers, the worked solution beside each question, and *Try again*. It is
   reachable from the subject tree and from the row in **Your saved results**,
   which is a button once the paper is open and reads *"Handed in 14 Sep ·
   waiting for your teacher"* before that.

**No score reaches a student anywhere before release.** `statusChip` and
`refreshStatusChips` in `src/screens/home.ts` read `releasedTests`, filled by
one `fetchReleasedMany` call; an unreleased paper's chip says *Handed in*. That
set **fails closed**: absent means shut, so a failed request cannot leak a mark.

**Guests keep the old instant feedback** — verdict, solution, score screen and
all. A guest has no teacher to release anything, and the demo has to stay worth
sharing. `canHandIn()` is the one test for "is this a real student with a
teacher".

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

`ModalField.kind` is `"text"` (the default), `"radio"`, `"checklist"` or
`"cards"`, with `choices` and an optional `showWhen: {field, value}` that shows a
field only while another holds a value.

- **`"cards"`** is a radio that looks like a tile — use it when the choice is
  about *content* (which subject you teach) rather than a setting. A choice may
  carry a `badge` (the promise: "14 ready-made tests") and `wide: true` to span
  the row, for an option that is deliberately the lesser one.
- **`bulk: true`** on a checklist adds Select all / Clear and a live count.
- **`steps: ModalStep[]`** makes it a multi-step dialog: a "Step 1 of 2"
  counter, a **Back** button, and validation that only ever checks the step
  being answered. `onSubmit` still receives everything from every step, so
  callers hold no state. `fields` without `steps` behaves exactly as before —
  the student, teacher and assign dialogs all still use it.
- **`submitLabel` may be a function** `(values, picks) => string`, recomputed on
  every change, which is how the button can say "Create with 3 tests".
- **`showWhen` only works because `.modal-field[hidden]` is declared.** An
  author `display` rule outranks the UA's `[hidden]`, so without that line the
  attribute is set and nothing moves — it silently showed the class list under
  "Everyone I teach" in production for a while. A checklist's ticks arrive as the **second**
argument to `onSubmit` (`picks[name]`), since one field yields many values; a
radio also reports its single pick in `values`. This is how "Who sees this test"
is built — use it rather than adding another inline form.

## The student's workspace (`src/screens/student.ts`)

A student gets the same shape their teacher authors in, read-only: **subjects →
a tree of tests → one question beside the tree**. Never a single page of every
question scrolling to the end — that rule holds everywhere a test is shown.

- Signing in lands on **Your subjects** (already true). **A subject is a list
  of its tests and nothing else** — no crumb row repeating the subject the app
  bar already names, and no drawer holding a second copy of the list on screen.
- **The question list is flat: the open test's questions, and only those.** It
  was a tree of every test in the subject with one expanded, which on a phone
  was folders to scroll past to reach the questions — and a student has exactly
  one test open, because the others are locked while it is. The way to another
  test is Back. `studentTreeMarkup` and `review.ts`'s `treeMarkup` both render
  this shape; the teacher's authoring tree in `src/screens/editor/` still has
  tests as roots, because a teacher really is moving between them.
- **Sitting the test has no explanation column** — `.ed-cols.overview`, two
  columns — and no worked solution anywhere on the page. The discussion panel
  under the question is the next phase's work; nothing is stubbed for it yet.
- **Reading the result has both**: that is `src/screens/review.ts`, unchanged —
  three columns, with the explanation on the right, once the teacher releases
  the paper.
- **An answer saves itself. There is no Save button.** Tapping an option is the
  save; a typed number settles for 800ms, and blur or Enter commits it at once;
  a photo saves when it uploads and unsaves when the last one is removed. The
  button that stood there cost a tap on every question and lost the answer of
  anyone who tapped **Next** instead — which is exactly what happened in
  testing. Saving no longer re-renders the page either (`refreshProgress` moves
  the tick, the chip and the count in place): a full render tore the number
  input out from under the student mid-number.
- **What sits in that slot now is Clear answer** (`#st-clear`), hidden until
  there is something to clear — the way to take an answer back off the paper
  and leave the question for later. A `long` question has no Clear of its own:
  the photo *is* the answer, and the uploader's ✕ already removes it
  server-side, which a local Clear could not do.
- **The controls follow the approved screen**: *Hand in test* sits at the right
  of the breadcrumb row, and **Previous · progress · Next** form one row at the
  foot of the answer card, with *Clear answer* in the answer panel's own head.
  The released result mirrors it, with *Retake test* in the same place. Below
  560px that row becomes a grid, and `.st-navrow .btn` needs `min-width: 0`,
  because `.btn` carries `min-width: 130px` and a bare `1fr` column cannot
  shrink under it (the row spilled out of the card on a phone). Below 720px the
  crumb keeps only the action; the test title is in the app bar already and
  wrapped onto four lines otherwise. `e2e/regression.cjs` asserts the order,
  the single row, and that nothing overflows the window at 390px.
- **On a phone and a tablet the chrome moves out of the way** (≤899px):
  - **The page scrolls, not a box inside it.** `mount({scroll: "page"})` puts
    `.shell-scroll` on the shell, which unwinds `height: 100dvh` and the inner
    `overflow` so the *document* is the scroller. The app bar then scrolls away
    with the content and comes back when the student returns to the top — no
    scroll-direction listener, just ordinary scrolling. Only `student.ts` and
    `review.ts` opt in; the authoring editor keeps its fixed shell.
  - **The crumb row is sticky** (`top: 0`): when the app bar goes, Back,
    Questions and Hand in stay. It is the secondary bar.
  - **The rail becomes a bottom bar** — fixed, full width, icon over label,
    where a thumb is. As a column it spent a sixth of a 320px screen on two
    icons. **It belongs to the subject picker alone**: `.shell-full .rail` is
    hidden, and `.shell-full` is set on exactly the full-bleed screens, so a
    bar whose two items are Subjects and Results does not follow a student
    into a subject or a test. `env(safe-area-inset-bottom)` keeps it clear of
    the home indicator where it does appear.
  - **The crumb row is Back · Questions … Hand in, and nothing else.** It used
    to spend its width on `subject › test › Question 3 of 15` between the two
    buttons a student presses — and hid the trail below 720px anyway. The app
    bar names the test, the panel head names the question. Back
    (`.ed-crumb-back`, an arrow) sits left of Questions and returns to the
    subject's test list with the subject back in the bar.
  - **Previous and Next are a fixed bottom bar** — `position: fixed; bottom: 0`,
    always on the floor of the window, with the answered count on the line
    **above** them rather than buried under a thumb. `.ed-center` carries
    matching bottom padding (declared *after* the ≤480px block, whose `padding`
    shorthand would otherwise reset it on the narrowest phones).
    It was `position: sticky` for one release and could not keep the promise:
    sticky only shifts an element within **its own containing block**, which
    here is the answer panel the row closes — so on a short paper the panel
    ended mid-screen, there was nothing to pull against, and the row sat in the
    middle of the window. Fixed is the only thing that always means the bottom.
    The bar stays **under** the drawer and its scrim (20 against 40/35): unlike
    the rail, it is not the way off the screen, so the question list may cover
    it.
  - **Clear answer sits in the answer panel's head**, beside the *Answered*
    chip — not in the steps row. It acts on the answer rather than on
    navigation, a fixed bar has no room for a third full-width line, and it is
    the one place it can never land under a thumb aiming for Next, which is the
    hazard that put it last in the row to begin with.
  - **The drawer slides from the window's own left edge, under the row whose
    button opened it** — `position: fixed`, `left: 0`, running to the floor.
    It was `absolute`, so it started wherever the page did, which on a phone
    meant inset by the rail and clipped on the right. The top offset is
    **measured on open, not on bind**: `bindTreeDrawer`'s `placeDrawer()` runs
    inside the toggle handler, because the crumb row is sticky and a number
    taken when the screen was painted is wrong the moment the page scrolls.
  - **The bottom bar is never dimmed by the drawer's overlay** on the screens
    that still have one: it sits above both (`z-index: 45`) and the scrim stops
    where the bar starts. The scrim's `bottom` has to be declared *after* the
    base `.ed-scrim` rule, whose `inset` shorthand would otherwise reset it —
    `.shell-full .ed-scrim` then takes it back to the floor where there is no
    bar.
  - **The app bar names the test on two lines** — Title, then Subtitle
    (`chapter`), stacked in a grid under `.shell-scroll` so the brand and the
    profile stay whole beside them. This is the one exception to the rule that
    the app bar is a single line: the crumb row no longer carries the test's
    name at any width, so without it a phone says nothing about what is open.
    **Three declarations in that grid are load-bearing, and all three were
    missing at first.** `row-gap: 0`, because `column-gap` does not cancel
    `row-gap` and `.shellbar` carries a `gap` shorthand that sets both — the
    lines drifted apart, and with *no* subtitle the phantom gap under row 1
    left the title riding above the brand beside it. `align-content: center`,
    or the two auto rows stretch to fill `min-height` and the lines drift again
    inside their own taller rows. And `.shell-scroll .shellbar-div {display:
    none}`, because the divider is the one child the grid never places: it is
    hidden only below 600px, so on a tablet it auto-placed into the subtitle's
    own cell and inflated that row with its 22px. Space it with a margin on the
    subtitle, never with a gap.
  - **A full-bleed screen keeps its own margins.** `.shell-main-full` sets
    `padding: 0`, and the small-screen `.shell-main` rules were quietly
    overriding it — 28px of a 320px phone. They now re-assert it. Measured on
    a 320px screen, the question text went from **200px to 276px** of usable
    width.
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

## The teacher reads the whole paper, not just the long answers

A teacher could see every long answer in the marking queue and the total on the
student's report, and **never which MCQ the class got wrong** — the one thing a
chapter test is for.

- **Student report → an attempt row → View paper** (`openPaper` in
  `src/screens/console.ts`) opens that student's finished paper in the same
  read-only review screen the student and the parent get. One renderer for a
  finished paper, no second implementation of "what did they put down".
- **`GET /api/attempts?testId=&student=` now gates on `canSeeStudent`**, not on
  `childLink`. That one function already knew every rule — a student reads only
  their own, a parent only a linked child, a teacher only their own student, an
  admin anyone — so the endpoint gained a role rather than a new rule. The read
  is still one point-partition query with an explicit projection.
- **Release does not gate the teacher.** `gated` in `src/screens/review.ts`
  excludes `isTeacher()`: release is the teacher's own switch, and a teacher
  has to see the answers *before* deciding to open them to the class.
- The review's labels say **"Priya's answer"** rather than "Your answer" when
  someone else's paper is open (`owner` in `review.ts`, set from
  `opts.studentName`).

## The score is marks, and says so (the guest's screen)

The big number on the score screen is **marks**, and it was read as questions
answered: `4 / 14` on a paper of 15 questions, because 12 of the 26 marks were
still with the teacher and the denominator is deliberately what has been graded
so far. The number now carries a `marks` unit and the count it was mistaken for
is its own line underneath — *"15 of 15 questions answered"*. Keep both: either
alone is ambiguous the moment a long answer is outstanding.

That screen is **the guest's** now — a student never reaches it (see above).
The misreading is what started the change; it is kept because the demo still
shows it.

## Review: one question per page (`src/screens/review.ts`)

Review is **not** a scroll of the whole paper. It is the layout the teacher
authors in, read-only: questions listed down the left with each result on its
row, one question in the middle (the student's answer, their photos, the
awarded mark and the teacher's comment), the explanation on the right. Prev/next
walk the paper and `?test=<id>&review=<questionId>` carries the place.

**The paper has no bottom tab bar** (`.ed-paper` on its root, and no
`data-pane`). It had one, and two of its three tabs did nothing: the
`[data-pane]` rules hide `.ed-pane-question` / `.ed-pane-answer`, classes that
exist only in the authoring editor, while `review.ts` renders plain `.ed-panel`
sections. Only the third tab acted, by un-hiding the explanation — which now
simply stacks under the answer on a phone. Dropping the attribute is what does
it: with no `data-pane` none of those rules match, so the editor and Browse keep
their tabs untouched. `.ed-paper` is also excluded from the 86px clearance that
reserves room for a bar it no longer has.

It reuses the editor's **layout only** — `.ed-cols`, `.ed-tree*`, `.ed-panel`,
`.ed-preview` — under an `.ed-readonly` modifier. Never change those
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

## New subject asks one thing per step (`src/screens/subjects.ts`)

**The taxonomy is a consequence, not a question.** Picking "CBSE Class 10 Maths"
*is* the board, the class and the subject, so only **Something else** asks for
them — and then those three fields are the only thing on screen. The dialog this
replaced put a content choice, a taxonomy chore and a second content choice in
one scrolling box, and asked for the taxonomy even when it already knew it.

- **Step 1 — what do you teach?** One `cards` field: a tile per built-in shelf
  badged with its test count, plus a full-width **Something else**.
- **Step 2 — which tests?** That shelf's tests as a `bulk` checklist (Select all
  / Clear / a live count), or the three taxonomy fields on the Something-else
  branch. The submit label counts — **Create with 3 tests**, falling back to
  **Create subject** at zero, which is also how a teacher starts empty. There is
  no separate Skip button because the label already says what will happen.
- Copies land as **drafts**, and `vidai:justCopied` carries the count to the
  editor, which shows one dismissible banner (`copiedBanner`) saying so and then
  clears the key. That banner is the answer to "where did my test go?".
- **A teacher who owns no subject gets `firstRunMarkup()`** instead of an empty
  grid: a subject → holds your tests → students sit them, one button, and a note
  that ready-made tests are included. Built-in shelves do not count as owning
  one, or a teacher would never see it.
- **This is where the library grows into a catalogue.** `openForm` currently
  fetches every subject and every built-in test to open — fine at two shelves,
  and the first thing to change when tests come from many authors. Search moves
  server-side and the test list loads only for the shelf actually picked; the
  two-step shape and Step 2 are already the right seam for it.

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

## The ghost loader is part of the screen (`skeleton` in `src/shell.ts`)

A skeleton exists to stop the page jumping when the data lands. One that draws
furniture the real screen does not have does the opposite, so **`skeleton.editor()`
must be the shape of the screen its caller is about to paint** — and it takes
options because the three screens sharing that shell no longer agree:

| Caller | Shape |
|---|---|
| `src/screens/editor/index.ts` | `{ add: true }` — the authoring editor, the one screen with the **+** in the tree's head |
| `showStudentSubject` (`student.ts`) | `{ tree: false, crumb: false }` — the subject page is a list of tests and nothing else |
| `openTest` (`student.ts`), `openStudentPaper` (`marking.ts`) | the default — the paper: a question list and a crumb row |

Two things it is easy to get wrong, and both were:

- **The `+` placeholder belongs in the tree's head**, right-aligned, 26px square
  — the same size and slot as the real `#ed-new-test`. It used to be a 60px
  bone in a row of its own *below* the head, which inherited `.ed-tree-add`'s
  purple and sat under the title instead of beside it.
- **`scroll` must match too.** A skeleton mounted without `scroll: "page"` in
  front of a screen that has it flips the whole scroll model the moment the data
  arrives.

`e2e/regression.cjs` holds the API back and asserts both: the ghost `+` lands at
the same right edge and width as the real button, and the subject page's ghost
draws no tree and no crumb row.

## Working style

- Concise, structured output. No padding.
- **Rework the ghost loader with the screen.** Any change to a screen's
  furniture — a column, a row of controls, the scroll model — is not finished
  until `skeleton` in `src/shell.ts` matches it and the suite has been run. The
  skeleton is the first thing a student or a teacher sees on a cold start, and
  it is the easiest thing in the app to leave behind.
- Prefer the smallest change that keeps the loop moving.
- Ask before adding any dependency, backend, or new feature outside this file.
- Hold to **Performance, scale and cost** and **Security** above on every change
  that touches `api/` or adds a fetch. The `vidai-scale` skill carries both as a
  checklist — invoke it before writing a query, a handler or a screen fetch.
