---
name: vidai-scale
description: The performance, scaling, cost and security rules every change to Vidai must hold. Use BEFORE writing or editing anything in api/ (a handler, an Azure Table Storage query, a listEntities call, a partition key, a blob read), before adding or changing a fetch on the client, before adding a screen that loads data, and whenever the task mentions caching, CDN, edge, cold starts, cost, bandwidth, throughput, "slow", "scale", "high traffic", "many students", "many teachers", choosing an Azure service, or anything touching auth, login, passwords, tokens, sessions, escaping, XSS, CSP, headers, rate limiting or permissions. Also use when reviewing a diff that touches those things.
---

# Building Vidai so it stays fast and nearly free

Vidai runs on Azure Static Web Apps **Free**, with SWA managed Functions and
Azure Table Storage. Money is not the binding constraint — ten million table
operations costs pennies. **Latency on a cheap Android phone and the Free
tier's 100 GB/month of bandwidth are.** So every rule here is about doing less
work and sending fewer bytes, not about buying a bigger thing.

Full context and the reasoning behind each rule: **Performance, scale and cost**
in `CLAUDE.md`. This file is the checklist to work from.

## Before you write a storage query

Run these four questions in order. A "no" is a design problem, not a detail to
fix later.

**1. Does it name a PartitionKey?**

A filter on `RowKey` alone, or on an ordinary property alone, is a scan of the
whole table that grows forever and never shows up in testing, because the table
is small today.

```js
// NO — scans every attempt ever written, by anybody
attempts.listEntities({ queryOptions: { filter: `RowKey eq '${key}'` } });

// YES — a point read per candidate, bounded by a class
attempts.getEntity(`stu~${username}`, key).then(() => true).catch(() => false);
```

If the question cannot be answered from one partition, **the partition key is
wrong — change the key, do not write the scan.**

**2. Does it name the properties it wants?**

Without `select`, Table Storage returns the whole row. On `tests` that means
`qc0..qcN` — the full text of every question. A list of titles was carrying
every paper it walked past.

```js
// NO
tests.listEntities({ queryOptions: { filter: `PartitionKey eq 'test'` } });

// YES
tests.listEntities({
  queryOptions: { filter: `PartitionKey eq 'test'`, select: TEST_META_SELECT },
});
```

Reuse the projection constants in `api/shared/core.js`: `TEST_META_SELECT`,
`SUBJECT_SELECT`, `ROSTER_SELECT`, `ATTEMPT_LIST_SELECT`, `GRADING_SELECT`.
When a listing starts needing a new property, **add it to the projection** —
and never add the question chunks back.

**3. Is anything awaited inside a loop?**

```js
// NO — a class of 200 is 200 serial round trips
for (const s of roster) { s.attempts = await load(s); }

// YES — parallel, but bounded
await inBatches(roster, 20, async (s) => { s.attempts = await load(s); });
```

**4. Is it computing on read what could be stamped on write?**

`chunkQuestions` writes `questionCount` and `totalMarks` beside the chunks,
which is the only reason a listing can project the chunks away. Every write of
questions goes through that one function, so the counts cannot drift. Do the
same for any new derived value: stamp it at the single write point, read it
back, and give legacy rows a bounded heal like `backfillCounts`.

## Before you add a per-request lookup

If the answer is derived from a stable input, memoise it. A warm Function
instance serves many requests; `makeCache(max)` in `api/shared/core.js` is the
whole caching tier — no Redis, nothing to pay for.

```js
const THING_TTL_MS = 60 * 1000;
const thingCache = makeCache(500);

async function thing(key) {
  const hit = thingCache.get(key);
  if (hit !== undefined) return hit;          // a cached `null` is not a miss
  const value = await expensive(key);
  return thingCache.set(key, value, THING_TTL_MS);
}
```

Two rules, both non-negotiable:

- **Every entry carries a TTL.** A warm instance must never disagree with a
  cold one for longer than that TTL.
- **Every write that invalidates an entry calls `drop()`.** If a cached value
  gates access (a student record, a role), say in a comment how long a
  revocation can lag across instances, and prefer a shorter TTL over a longer one.

Never key a cache on a secret. Token claims are keyed on a **sha256 of the
credential**, never the credential itself.

## Before you add a fetch on the client

- Fetch **once** per render, in parallel (`Promise.all`) — not the same endpoint
  twice in one path.
- Everything goes through `apiFetch` (`src/auth.ts`), which ends the session on
  a 401. Do not bypass it.
- New assets must be fingerprinted by Vite so `/assets/*` stays `immutable`.
  **Never hand-edit a file under `/assets/` in place.**
- Prefer bundling a library over a CDN `<script>`: same origin means no extra
  DNS + TLS handshake on a phone, and a school network cannot block it. Import
  it dynamically (as `renderMath` does with KaTeX) so it stays out of the first
  bundle. Adding a dependency still needs the user's say-so.

## When the answer looks like "add a service"

Take the cheapest rung that solves it, and say what it costs:

1. **Free** — a projection, a partition key, a batch, an in-process cache, a
   cache header. Nearly every problem is here. Exhaust this rung first.
2. **Free** — bake immutable content to a blob or a static file and let the
   edge serve it. A published test never changes (editing is draft-only), so it
   belongs here rather than behind a Function.
3. **~$9/mo — SWA Standard.** The first thing worth buying: for the SLA, or
   past 100 GB/month.
4. **Front Door (~$35/mo), Redis (~$16/mo), Cosmos DB (from ~$24/mo)** — the
   answer is no until real numbers say otherwise. SWA already serves static from
   a global edge, rung 1 gives most of what Redis would, and Table Storage with
   the right partition keys handles a hundred thousand students.

Prices are from memory; check the Azure calculator before committing to any.
**Ask before adding any paid resource** — it is a change to the product's
economics, not a technical detail.

## A row lives in its owner's partition

`tests` and `subjects` used to use a **constant PartitionKey** (`"test"`,
`"subject"`), so every listing walked the whole platform. They no longer do:
`ownerPartition(row)` in `api/shared/core.js` puts a row in its owner's
partition, and a master or a shelf (`platform: true`) in `PLATFORM_PK`.

Working near it:

- **Read the partition from the ROW, never from the caller.** A row's home is
  decided by whose it is.
- **A point read needs a partition**, so use `readByPartitions(table,
  partitions, rowKey, legacyPk)` and list the caller's own partition first.
  The set you pass must be the mirror of whatever `visible()`/`canManageTest()`
  would allow — never wider.
- **A listing uses `walkPartitions`**, which also drains the legacy partition.
  Never add a query that names no PartitionKey; `partitionChecks()` in
  `e2e/helpers.cjs` throws on one.
- **Every write goes through `saveRow`**, which moves a row still sitting in
  the legacy partition. Skipping it is how a drain racing an edit loses the
  edit.
- `ownerSub` is still on the row and is still the authorization field. **A
  partition key says where a row lives, never what it permits.**

**Never exercise a storage-shape change on QA before merging it.** QA runs the
new code against *production's* tables, and compatibility runs one way only:
new code reads old rows, old code cannot read new ones. Opening QA on such a PR
migrates live data into a shape the live site cannot see.

**Re-partitioning did not make a teacher's own test listing faster**, and that
is worth knowing before you reach for a partition key again. It was never slow
because of other teachers' rows: `visible()` gives every teacher all 125
published masters, which is 65 KB of the 65 KB. A partition key fixes what
*grows*; it does nothing about what is already big. Measure which one you have.

**Not reading a row beats reading it and filtering it away.** The plain listing
used to hand every teacher all 125 masters for the client to discard. The fix
was the partition list, NOT `visible()` — that predicate also gates `?id=`, and
narrowing it would 403 Browse. When a listing is sending something nobody wants,
look at what it walks before you look at what it permits.

Still outstanding, in order: bake published tests to immutable blobs on publish;
then delete `LEGACY_TEST_PK` / `LEGACY_SUBJECT_PK` and the paths that read them,
once both tables have drained.

## Before you touch anything security-shaped

Vidai holds minors' names, exam answers and photographs of their handwriting.
Full detail is under **Security** in `CLAUDE.md`; these are the ones easiest to
undo by accident.

**Any endpoint that checks a credential** goes through `loginGate` **before** the
row read and before any hashing — scrypt is slow on purpose, so an unthrottled
caller reaching it is a denial of service the owner pays for. Note the failure on
both buckets, clear the username bucket on success.

```js
const gate = await loginGate(req, username);
if (gate.lockMs > 0) return tooManyAttempts(context, gate.lockMs);
// ... check the credential ...
if (!ok) { await noteLoginFailure(gate); return json(context, 401, {...}); }
await clearFailures(gate.table, "user", gate.user);
```

**Never tighten the IP bucket to match the username one.** `LOCK_AFTER` is
`{ user: 5, ip: 50 }` because a whole school sits behind one NAT address, and an
equal threshold lets one student's fumbled password lock out the class.

**A miss must cost what a hit costs.** No early return when a username is
unknown — compare against `timingDecoyHash()`. No `||` short-circuit between two
credential compares.

**`escapeHtml` escapes quotes too.** It is interpolated into attribute positions;
narrowing it back to `& < >` reopens the whole class of bug.

**The CSP is tested, not just written.** `e2e/serve.cjs` applies `globalHeaders`
locally and `e2e/regression.cjs` fails on any `securitypolicyviolation`. If you
add an origin, a font, an image host or a script, run the suite — a CSP that
only breaks in production breaks it in front of a class. Never add
`'unsafe-inline'` to `script-src`: it holds today only because the build has no
inline script and no `eval`.

**Storage keys are digests.** No raw IP in a table row.

**Never name an API route `admin…`.** Azure Functions reserves that namespace,
and SWA serves such a route as a 404 with no warning anywhere — the function
simply never registers. `/api/adminsecurity` cost an afternoon proving it; the
endpoint is `/api/twostep`.

**The session is an httpOnly cookie, and the page must never hold the token.**
`authHeader()` sends a marker, not a secret; anything that puts a credential
back into `localStorage` undoes the whole of finding 4. A new endpoint is
covered by the CSRF guard automatically (handlers are wrapped at export time) —
do not unwrap one, and add it to `SIGN_IN_HANDLERS` only if it genuinely has no
session to abuse.

**Anything that revokes access bumps `tokenEpoch` and drops the cache entry.**
Deleting a student, resetting their password, signing out everywhere. A change
that revokes without bumping leaves a usable session for up to 30 days.

## Checking the work

```sh
node e2e/helpers.cjs        # offline: counts, cache, inBatches, lockout, passwords
npm run build               # typecheck + production build
node e2e/serve.cjs &        # serves dist/ on :4400, proxies /api/* to production
node e2e/regression.cjs     # browser regression (guest flows always)
```

The browser regression proxies `/api/*` to **production**, so it does not
exercise unmerged API changes. Point `E2E_API_BASE` at the PR preview URL to
test those before believing them.
