---
name: vidai-scale
description: The performance, scaling and cost rules every change to Vidai must hold. Use BEFORE writing or editing anything in api/ (a handler, an Azure Table Storage query, a listEntities call, a partition key, a blob read), before adding or changing a fetch on the client, before adding a screen that loads data, and whenever the task mentions caching, CDN, edge, cold starts, cost, bandwidth, throughput, "slow", "scale", "high traffic", "many students", "many teachers", or choosing an Azure service. Also use when reviewing a diff that touches those things.
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

## The one architectural change still outstanding

`tests` and `subjects` use a **constant PartitionKey** (`"test"`, `"subject"`).
Every read still scans the whole platform and every write lands in one
partition — fine at one teacher, fatal at five hundred. Re-partitioning by
`ownerSub` is the next real step, and it gets cheaper the sooner it is done. If
a task lands near it, say so rather than building more on the constant key.

## Checking the work

```sh
node e2e/helpers.cjs        # offline: stamped counts, the cache, inBatches
npm run build               # typecheck + production build
node e2e/serve.cjs &        # serves dist/ on :4400, proxies /api/* to production
node e2e/regression.cjs     # browser regression (guest flows always)
```

The browser regression proxies `/api/*` to **production**, so it does not
exercise unmerged API changes. Point `E2E_API_BASE` at the PR preview URL to
test those before believing them.
