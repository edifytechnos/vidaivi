// Shared logic for all API functions (classic v3 programming model:
// handlers receive (context, req) and set context.res).

const { TableClient } = require("@azure/data-tables");
const crypto = require("crypto");

const STORAGE = process.env.STORAGE_CONNECTION_STRING;
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const SESSION_SECRET = process.env.SESSION_SECRET;
const TEACHER_EMAILS = (process.env.TEACHER_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
const ADMIN_EMAILS = (process.env.ADMIN_EMAILS || "")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);
// The AI marking assistant. Unset means the feature simply does not exist:
// /api/assess answers 501 and the client hides the button, the same way
// analytics no-ops without its connection string. Nothing else changes.
//
// The model lives in **Azure AI Foundry, South India** rather than at Google.
// That is not a preference, it is the only thing that works from here: this app
// runs in Azure East Asia (Hong Kong), and Hong Kong is on neither Google's
// Gemini available-regions list nor Anthropic's, so a key that works from a
// laptop in Chennai 400s from the Function. A call to an Azure endpoint is
// Azure-to-Azure and has no country gate, so the app did not have to move —
// and a child's handwriting now stays inside Azure instead of going to Google.
// Only the origin is wanted — the portal offers the *full* Responses URL to
// copy ("https://<name>.services.ai.azure.com/openai/v1/responses"), and
// pasting that is the obvious thing to do. Left alone it produced
// ".../openai/v1/responses/openai/v1/chat/completions" and a bare 404 that
// blamed the deployment. Taking the origin makes either paste work.
const AZURE_AI_ENDPOINT = (() => {
  const raw = (process.env.AZURE_AI_ENDPOINT || "").trim().replace(/\/+$/, "");
  if (!raw) return "";
  try {
    return new URL(raw).origin;
  } catch {
    return raw;
  }
})();
const AZURE_AI_KEY = process.env.AZURE_AI_KEY;
// The *deployment* name, which is whatever it was called in the portal — not
// the model id. It defaults to the name this was built against.
const AZURE_AI_DEPLOYMENT = process.env.AZURE_AI_DEPLOYMENT || "gpt-4.1-mini";
const aiConfigured = () => !!(AZURE_AI_ENDPOINT && AZURE_AI_KEY);
// What a call costs, so the admin report can show real money rather than a
// count. Prices are per *million* tokens and are settings, not constants in
// spirit: changing the deployment or the exchange rate must not need a deploy.
// Defaults are gpt-4.1-mini's published rates.
const AI_USD_PER_M_IN = Number(process.env.AI_USD_PER_M_IN || 0.4);
const AI_USD_PER_M_OUT = Number(process.env.AI_USD_PER_M_OUT || 1.6);
const USD_INR = Number(process.env.USD_INR || 88);
// Accumulated in integer micro-dollars. A float accumulator drifts once it has
// been added to a few thousand times, and this one is read as money.
//
// The division looks missing and is not: dollars are `tokens * rate / 1e6`,
// and micro-dollars are that times 1e6, so the two cancel exactly. Written
// out, it would be `* 1e6 / 1e6`.
function costMicroUsd(promptTokens, completionTokens) {
  return Math.round(promptTokens * AI_USD_PER_M_IN + completionTokens * AI_USD_PER_M_OUT);
}
// Each assessment costs one credit. A month is the unit because that is how a
// teacher thinks about a term, and because it keeps the ledger to one row per
// teacher per month.
const ASSESS_MONTHLY_CREDITS = Number(process.env.ASSESS_MONTHLY_CREDITS || 100);
// "Close to the limit" is decided here and nowhere else: the teacher's warning
// and the admin's list must agree about who is in trouble, and they would drift
// the first time the grant changed if each worked it out for itself.
//
// A fraction rather than a fixed number for the same reason — "10 left" is
// ample notice out of 100 and far too late out of 500.
const LOW_CREDIT_FRACTION = 0.2;
const creditsAreLow = (used, granted) => granted > 0 && granted - used <= granted * LOW_CREDIT_FRACTION;
// A loaded key is a spending limit with no brakes: at roughly fifteen paise an
// assessment, ₹500 is about 3,300 of them. A stuck retry, a loop, or a stolen
// teacher session could spend the lot in an afternoon, and the first anyone
// would know is the bill. One cap per teacher per day is the brake.
const ASSESS_DAILY_CAP = Number(process.env.ASSESS_DAILY_CAP || 200);

const ADMIN_USERNAME = process.env.ADMIN_USERNAME;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

const STUDENT_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const ADMIN_TOKEN_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
// Teachers and parents used to carry the Google ID token itself, which Google
// expires after about an hour -- that hour is the "your sign-in timed out"
// screen. We now mint our own session for them on the same 30 days a student
// gets, and slide it (see renewIfStale), so signing in lasts until someone
// signs out.
const GOOGLE_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// ---------- The session cookie ----------
//
// The token used to live in localStorage, where any script on the page could
// read it: an XSS that got past the CSP could take an account outright. It now
// travels in a cookie the page cannot read at all.
//
//   HttpOnly  - document.cookie cannot see it, so script cannot steal it.
//   Secure    - never sent over plain http.
//   SameSite=Strict - not attached to any cross-site request, which is what
//               makes CSRF impossible rather than merely awkward. Nothing here
//               needs the cookie on a cross-site navigation: the app boots from
//               static HTML and only then calls the API same-site, so a test
//               link shared in the class WhatsApp group still opens normally.
//   Path=/    - the app and the API share an origin.
//
// SWA's edge rewrites the cookie's domain to the request host on the way out
// and hands the Cookie header back in unchanged. Both were verified against a
// deployed preview before this was written: the edge already replaces
// Authorization, so neither was safe to assume.
const SESSION_COOKIE = "vidai_session";

// ---------- In-process caches ----------
//
// A warm Function instance serves many requests before it is recycled, so
// anything derived from a stable input is memoised here. This is the whole of
// the caching tier: no Redis, no Front Door, nothing to pay for. Every entry
// carries a TTL, because a cold instance must never be able to disagree with a
// warm one for longer than that TTL.

function makeCache(maxEntries = 500) {
  const map = new Map();
  return {
    get(key) {
      const hit = map.get(key);
      if (!hit) return undefined;
      if (hit.expires <= Date.now()) {
        map.delete(key);
        return undefined;
      }
      map.delete(key); // re-insert, so the least recently used key evicts first
      map.set(key, hit);
      return hit.value;
    },
    set(key, value, ttlMs) {
      map.delete(key);
      map.set(key, { value, expires: Date.now() + ttlMs });
      if (map.size > maxEntries) map.delete(map.keys().next().value);
      return value;
    },
    drop(key) {
      map.delete(key);
    },
  };
}

/** Run `fn` over `items` a few at a time: parallel, but never unbounded. */
async function inBatches(items, size, fn) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  }
  return out;
}

// A TableClient is stateless and owns the HTTP connection pool, so building a
// new one per call threw away keep-alive on every request.
const tableClients = new Map();

function tableClient(name) {
  let client = tableClients.get(name);
  if (!client) {
    client = TableClient.fromConnectionString(STORAGE, name);
    tableClients.set(name, client);
  }
  return client;
}

// createTable answers 409 the moment the table exists, so calling it on every
// request bought nothing but a round trip. Once per table per instance is enough.
const ensuredTables = new Set();

async function ensureTable(client) {
  if (ensuredTables.has(client.tableName)) return;
  try {
    await client.createTable();
  } catch (e) {
    if (e.statusCode !== 409) throw e; // 409 = already exists
  }
  ensuredTables.add(client.tableName);
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64url");
}

function json(context, status, body, extraHeaders) {
  context.res = {
    status,
    headers: {
      "Content-Type": "application/json",
      // Set here rather than in staticwebapp.config.json, whose route headers
      // do not reach /api/* at all: those requests go to the Functions backend
      // and only the function's own headers survive. Every API response is
      // built here, so this is the one place that can say it. It matters most
      // for the answerimage SAS and for any authenticated GET an intermediary
      // might otherwise think it may keep.
      "Cache-Control": "no-store",
      // Silent renewal: identify() parks a refreshed session cookie here when
      // the token is past halfway, so every handler renews without knowing it.
      // extraHeaders spreads last, so a handler that sets its own Set-Cookie
      // (signing in, signing out) still wins.
      ...(context && context.__renewCookie
        ? { "Set-Cookie": context.__renewCookie }
        : {}),
      ...(extraHeaders || {}),
    },
    body,
  };
}

function getBearer(req) {
  // SWA's edge replaces the standard Authorization header before requests
  // reach managed functions, so the client sends our token in a custom
  // header instead. Authorization remains as a fallback for local dev.
  //
  // X-Vidaivi-Auth is the pre-rename name. A student with the page already open
  // when this deploys is still sending it, so it stays accepted for one release
  // — drop the two fallbacks below once everyone has reloaded.
  const headers = req.headers || {};
  const custom =
    headers["x-vidai-auth"] ||
    headers["X-Vidai-Auth"] ||
    headers["x-vidaivi-auth"] ||
    headers["X-Vidaivi-Auth"] ||
    "";
  if (custom) return custom.startsWith("Bearer ") ? custom.slice(7) : custom;
  const header = headers.authorization || headers.Authorization || "";
  return header.startsWith("Bearer ") ? header.slice(7) : "";
}

function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  try {
    return JSON.parse(req.rawBody || req.body || "{}");
  } catch {
    return {};
  }
}

// ---------- Google auth (teachers / parents) ----------

// Google's tokeninfo endpoint sat in front of every single request a teacher
// or parent made — an outbound HTTPS round trip before any of our own work.
// The answer is pinned to one credential string and holds until that token
// expires, so a warm instance verifies each token once. The TTL is capped well
// under the token's own hour so a withdrawn account cannot linger.
const GOOGLE_TOKEN_TTL_MS = 5 * 60 * 1000;
const GOOGLE_TOKEN_FAIL_TTL_MS = 30 * 1000;
const tokenCache = makeCache(500);

async function verifyGoogleToken(credential) {
  if (!credential) return { reason: "no_bearer_token" };
  if (!GOOGLE_CLIENT_ID) return { reason: "no_client_id_configured" };
  // The credential is a secret: key on a digest of it, never on the token.
  const key = crypto.createHash("sha256").update(credential).digest("base64url");
  const cached = tokenCache.get(key);
  if (cached) return cached;
  const result = await askGoogleAboutToken(credential);
  // A rejection is cached briefly too, or a client looping on a stale token
  // would hammer Google once per retry.
  const ttl = result.token
    ? Math.min(GOOGLE_TOKEN_TTL_MS, Number(result.token.exp) * 1000 - Date.now())
    : GOOGLE_TOKEN_FAIL_TTL_MS;
  if (ttl > 0) tokenCache.set(key, result, ttl);
  return result;
}

async function askGoogleAboutToken(credential) {
  let res;
  try {
    res = await fetch(
      "https://oauth2.googleapis.com/tokeninfo?id_token=" +
        encodeURIComponent(credential)
    );
  } catch {
    return { reason: "tokeninfo_unreachable" };
  }
  if (!res.ok) return { reason: `tokeninfo_rejected_${res.status}` };
  const token = await res.json();
  if (token.aud !== GOOGLE_CLIENT_ID) {
    return {
      reason: `aud_mismatch (token aud ...${String(token.aud).slice(-25)} vs configured ...${GOOGLE_CLIENT_ID.slice(-25)})`,
    };
  }
  if (Number(token.exp) * 1000 < Date.now()) return { reason: "expired" };
  if (!token.sub || !token.email) return { reason: "missing_claims" };
  return { token };
}

// Teacher allowlist lives in the "teachers" table (managed from the admin
// dashboard); the TEACHER_EMAILS app setting remains as an optional fallback.
// One table read per request, for an answer that changes about twice a year.
// The teachers handler drops the entry when the allowlist is edited, so an
// admin sees their own change at once; another instance catches up within the TTL.
const ROLE_TTL_MS = 60 * 1000;
const roleCache = makeCache(500);

async function resolveRole(email) {
  const normalized = String(email).toLowerCase();
  if (ADMIN_EMAILS.includes(normalized)) return "admin";
  if (TEACHER_EMAILS.includes(normalized)) return "teacher";
  const cached = roleCache.get(normalized);
  if (cached) return cached;
  let role = "parent";
  try {
    await tableClient("teachers").getEntity("teacher", normalized);
    role = "teacher";
  } catch {}
  return roleCache.set(normalized, role, ROLE_TTL_MS);
}

// ---------- What a plan allows, and what it costs ----------
//
// Every price and every limit lives in ONE row an admin edits from the
// platform itself. Nothing here is a constant, because the first thing that
// happens to a price is that it changes, and a deploy is a poor way to change
// one.
//
// Money is in **paise, as integers**. A rupee is never a float: 499.00 read
// back as 498.99999 is the kind of thing nobody notices until a customer does.
// Rupees exist only at the edges, for display.
const PLAN_TTL_MS = 60 * 1000;
const planCache = makeCache(4);
const PLAN_PK = "plan";
const PLAN_RK = "current";

// Used until an admin saves the row for the first time — so the platform is
// never broken by a table that has not been written yet.
const PLAN_DEFAULTS = {
  trialDays: 30,
  trialSubjects: 1,
  trialTests: 3,
  trialStudents: 3,
  // A teacher paying the platform fee: their own subjects and tests are
  // unlimited (0 means no limit); seats are not.
  teacherMonthlyPaise: 9900,
  teacherSubjects: 0,
  teacherTests: 0,
  teacherFreeStudents: 2,
  perStudentMonthlyPaise: 4900,
  // A ready-made subject, with every test in it.
  subjectPaise: 49900,
  subjectAttempts: 2,
  // What anyone may try before paying for a shelf.
  freeShelfSubjects: 1,
  freeShelfTests: 3,
  parentMaxChildren: 3,
};

async function planTable() {
  const t = tableClient("platform");
  await ensureTable(t);
  return t;
}

/** The current rules, memoised. A number an admin changes takes effect on
 *  their own instance at once and everywhere else within the TTL. */
async function platformRules() {
  const hit = planCache.get(PLAN_RK);
  if (hit !== undefined) return hit;
  let row = null;
  try {
    row = await (await planTable()).getEntity(PLAN_PK, PLAN_RK);
  } catch {
    row = null;
  }
  const rules = { ...PLAN_DEFAULTS };
  for (const key of Object.keys(PLAN_DEFAULTS)) {
    if (row && typeof row[key] === "number" && Number.isFinite(row[key])) rules[key] = row[key];
  }
  return planCache.set(PLAN_RK, rules, PLAN_TTL_MS);
}

// ---------- The account: which role they chose, and what they hold ----------
//
// PK is constant and RK is the Google sub, the same trade `tests` and
// `subjects` already make. Defensible here and not elsewhere: this table holds
// *teachers and parents*, never students, so it is hundreds of rows rather
// than hundreds of thousands, and the admin's listing is one partition query
// with a projection. It joins the outstanding re-partition work rather than
// being a new kind of problem.
const ACCOUNT_PK = "account";
const ACCOUNT_SELECT = [
  "PartitionKey",
  "RowKey",
  "chose",
  "email",
  "name",
  "trialStartedAt",
  "trialEndsAt",
  "paidSeats",
  "exempt",
  "createdAt",
];

async function accountsTable() {
  const t = tableClient("accounts");
  await ensureTable(t);
  return t;
}

async function accountRow(table, sub) {
  try {
    return await table.getEntity(ACCOUNT_PK, sub);
  } catch {
    return null;
  }
}

/**
 * Everyone who already had an account keeps what they had.
 *
 * The pilot class was promised free forever, and limits arriving by surprise
 * would bill the one teacher the whole pilot depends on. So the first time
 * this runs, every existing profile is stamped as an exempt account; new
 * sign-ups after that get an account row from `choose` instead and are not
 * touched here.
 *
 * Guarded by a marker row, so it is once for the platform rather than once per
 * cold start, and bounded so a large profiles table cannot stall a request.
 *
 * The in-process flag matters as much as the marker row: without it every
 * gated request would pay a point read forever, for work that happens once
 * (rule 4 — anything derived from a stable input is memoised). A fresh
 * instance pays exactly one read and then never again.
 */
let legacyExemptDone = false;

async function exemptLegacyAccounts(table) {
  if (legacyExemptDone) return;
  const state = tableClient("authstate");
  await ensureTable(state);
  try {
    await state.getEntity("migration", "exempt-legacy");
    legacyExemptDone = true;
    return; // already done
  } catch {}
  try {
    const profiles = tableClient("profiles");
    await ensureTable(profiles);
    const subs = [];
    const iter = profiles.listEntities({
      queryOptions: { filter: `PartitionKey eq 'profile'`, select: ["RowKey", "email", "name"] },
    });
    for await (const e of iter) {
      subs.push({ sub: e.rowKey, email: e.email || "", name: e.name || "" });
      if (subs.length >= 2000) break;
    }
    await inBatches(subs, 20, async (p) => {
      // Never overwrite an account that already exists: a live trial must not
      // be turned into a free-forever account by a migration.
      if (await accountRow(table, p.sub)) return;
      await table.upsertEntity(
        {
          partitionKey: ACCOUNT_PK,
          rowKey: p.sub,
          chose: "",
          email: p.email,
          name: p.name,
          exempt: true,
          paidSeats: 0,
          createdAt: new Date().toISOString(),
          legacy: true,
        },
        "Merge"
      );
    });
    await state.upsertEntity(
      { partitionKey: "migration", rowKey: "exempt-legacy", at: new Date().toISOString(), count: subs.length },
      "Merge"
    );
    legacyExemptDone = true;
  } catch {
    // Best effort. A failed migration must not take the API down with it —
    // it simply runs again on the next request.
  }
}

/**
 * Everything a caller is allowed to do, resolved once.
 *
 * Read this rather than recomputing a limit at the call site: two places
 * deciding the same rule is how they come to disagree, which is the same
 * reason `creditsAreLow` lives in exactly one function.
 *
 * `limit` of 0 means no limit. Every gate treats a *missing* answer as the
 * tightest one, never the loosest.
 */
async function entitlements(who) {
  const rules = await platformRules();
  // An admin is never gated by a plan they themselves set.
  if (who.role === "admin") {
    return { plan: "admin", exempt: true, rules, subjects: 0, tests: 0, students: 0, shelfSubjects: 0, shelfTests: 0, trialEndsAt: "" };
  }
  const table = await accountsTable();
  await exemptLegacyAccounts(table);
  const row = await accountRow(table, who.id);

  // Anyone who held an account before plans existed keeps everything they had.
  // The pilot class was promised free forever, and a limit that arrives by
  // surprise would bill the one teacher the whole pilot depends on.
  if (row && row.exempt) {
    return { plan: "exempt", exempt: true, rules, subjects: 0, tests: 0, students: 0, shelfSubjects: 0, shelfTests: 0, trialEndsAt: "" };
  }

  const chose = String((row && row.chose) || "");
  const trialEndsAt = String((row && row.trialEndsAt) || "");
  const onTrial = !!trialEndsAt && Date.parse(trialEndsAt) > Date.now();
  const paidSeats = typeof row?.paidSeats === "number" ? row.paidSeats : 0;

  if (chose === "teacher" && !onTrial) {
    // The platform fee buys unlimited subjects and tests of their own; seats
    // and ready-made content are still bought separately.
    return {
      plan: "teacher",
      exempt: false,
      rules,
      chose,
      trialEndsAt,
      subjects: rules.teacherSubjects,
      tests: rules.teacherTests,
      students: rules.teacherFreeStudents + paidSeats,
      shelfSubjects: rules.freeShelfSubjects,
      shelfTests: rules.freeShelfTests,
    };
  }
  if (chose === "parent") {
    return {
      plan: "parent",
      exempt: false,
      rules,
      chose,
      trialEndsAt,
      subjects: rules.trialSubjects,
      tests: rules.trialTests,
      students: rules.parentMaxChildren,
      shelfSubjects: rules.freeShelfSubjects,
      shelfTests: rules.freeShelfTests,
    };
  }
  // On trial, or has not chosen yet — the trial's limits either way, which is
  // the safe direction to be wrong in.
  return {
    plan: onTrial ? "trial" : chose ? "lapsed" : "new",
    exempt: false,
    rules,
    chose,
    trialEndsAt,
    subjects: rules.trialSubjects,
    tests: rules.trialTests,
    students: rules.trialStudents,
    shelfSubjects: rules.freeShelfSubjects,
    shelfTests: rules.freeShelfTests,
  };
}

/**
 * How many rows this account already owns in `table`.
 *
 * Since the re-partition this is the caller's **own partition** — the question
 * "how many of mine" is exactly one partition, rather than the whole platform
 * filtered down to one owner in memory. `walkPartitions` also drains the
 * legacy `"test"` / `"subject"` partition as it passes, so an account whose
 * rows have not moved yet is still counted correctly and is nudged along.
 *
 * Projected to `RowKey` alone: the bodies are not wanted, only the count.
 * Stops as soon as the answer is "over", because the exact number past the
 * limit is never used.
 */
async function ownedCount(table, ownerSub, legacyPk, stopAt) {
  let n = 0;
  await walkPartitions(
    table,
    {
      partitions: [ownerSub],
      select: ["RowKey", "ownerSub"],
      legacyPk,
      budget: { left: LEGACY_DRAIN_BUDGET },
    },
    (e) => {
      // A legacy row in the shared partition may belong to somebody else.
      if (e.ownerSub && e.ownerSub !== ownerSub) return;
      n += 1;
      if (stopAt && n > stopAt) return false;
    }
  );
  return n;
}

/**
 * The one shape every limit refusal takes: what you hit, and what to do about
 * it. A bare "no" makes a person think the product is broken; a number and a
 * price makes it a decision they can act on.
 */
function overLimit(context, what, used, limit, priceNote) {
  return json(context, 402, {
    error: `You have used ${used} of ${limit} ${what} on your current plan.${priceNote ? ` ${priceNote}` : ""}`,
    limit,
    used,
  });
}

// ---------- What they have bought ----------
//
// PK is the buyer's own sub, RK the shelf they bought. "Do they own this
// shelf" is therefore a point read inside their own partition — the right key
// from the first line, unlike the two tables above.
async function purchasesTable() {
  const t = tableClient("purchases");
  await ensureTable(t);
  return t;
}

/** How many library copies this account already holds. Same partition as
 *  `ownedCount` — the caller's own — and the thing that makes a row a copy is
 *  `copiedFrom`, filtered here rather than in the query so the legacy drain
 *  still sees every row it walks past. */
async function adoptedCount(tests, ownerSub, stopAt) {
  let n = 0;
  await walkPartitions(
    tests,
    {
      partitions: [ownerSub],
      select: ["RowKey", "ownerSub", "copiedFrom"],
      legacyPk: LEGACY_TEST_PK,
      budget: { left: LEGACY_DRAIN_BUDGET },
    },
    (e) => {
      if (e.ownerSub && e.ownerSub !== ownerSub) return;
      if (!e.copiedFrom) return;
      n += 1;
      if (stopAt && n > stopAt) return false;
    }
  );
  return n;
}

async function ownsShelf(ownerSub, shelfId) {
  if (!shelfId) return false;
  try {
    await (await purchasesTable()).getEntity(ownerSub, shelfId);
    return true;
  } catch {
    return false;
  }
}

/** Rupees, for a message a person reads. Paise are the stored truth. */
const rupees = (paise) => `₹${Math.round(paise) / 100}`;

// ---------- Sessions (students, admins, teachers and parents) ----------
//
// One token shape for all three kinds:  <prefix>.<payload>.<hmac>
//   vst = student, vad = admin, vgo = teacher/parent signed in with Google.
//
// The payload carries `ep`, the account's token epoch at the moment it was
// issued. Bumping the epoch on the account invalidates every token ever minted
// for it, which is what "sign out everywhere" is made of: there is no token
// list to walk and nothing to store per device.

function signSession(prefix, username, ttlMs, extra) {
  const now = Date.now();
  const payload = b64url(
    JSON.stringify({ u: username, iat: now, exp: now + ttlMs, ...(extra || {}) })
  );
  const sig = b64url(
    crypto.createHmac("sha256", SESSION_SECRET).update(`${prefix}.${payload}`).digest()
  );
  return `${prefix}.${payload}.${sig}`;
}

function verifySession(expectedPrefix, token) {
  try {
    const [prefix, payload, sig] = token.split(".");
    if (prefix !== expectedPrefix || !payload || !sig) return null;
    const expected = b64url(
      crypto.createHmac("sha256", SESSION_SECRET).update(`${prefix}.${payload}`).digest()
    );
    const got = Buffer.from(sig);
    const want = Buffer.from(expected);
    // timingSafeEqual throws on a length mismatch, which would be an unhandled
    // 500 rather than a rejected token.
    if (got.length !== want.length || !crypto.timingSafeEqual(got, want)) return null;
    const data = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (!data.u || data.exp < Date.now()) return null;
    return {
      username: data.u,
      epoch: Number(data.ep) || 0,
      email: typeof data.e === "string" ? data.e : "",
      name: typeof data.n === "string" ? data.n : "",
      issuedAt: Number(data.iat) || 0,
      expiresAt: Number(data.exp) || 0,
    };
  } catch {
    return null;
  }
}

// ---------- Cookies ----------

function readCookie(req, name) {
  const raw = String((req && req.headers && req.headers.cookie) || "");
  if (!raw) return "";
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return "";
}

function sessionCookie(token, ttlMs) {
  return `${SESSION_COOKIE}=${token}; Max-Age=${Math.floor(ttlMs / 1000)}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

function clearedCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

// The lifetime each kind of session is issued and re-issued with.
const TTL_FOR_PREFIX = {
  vst: STUDENT_TOKEN_TTL_MS,
  vad: ADMIN_TOKEN_TTL_MS,
  vgo: GOOGLE_SESSION_TTL_MS,
};

/**
 * Silent renewal. A session past the halfway point of its life is re-issued on
 * the way out, so anyone who uses Vidai at all stays signed in indefinitely and
 * only an account left untouched for a full window has to sign in again. The
 * cost is one HMAC; there is no refresh token to store, leak or revoke.
 *
 * The renewed cookie is parked on `context` and picked up by `json()`, so this
 * works for every handler without any of them knowing about it. A handler that
 * sets its own Set-Cookie (sign-in, sign-out) still wins: `json()` spreads its
 * extraHeaders last.
 */
function renewIfStale(context, prefix, session, claims) {
  if (!context) return;
  const ttl = TTL_FOR_PREFIX[prefix];
  if (!ttl || !session.issuedAt || !session.expiresAt) return;
  const halfway = session.issuedAt + (session.expiresAt - session.issuedAt) / 2;
  if (Date.now() < halfway) return;
  context.__renewCookie = sessionCookie(
    signSession(prefix, session.username, ttl, claims),
    ttl
  );
}

// ---------- Token epochs (sign out everywhere) ----------
//
// Every account carries a `tokenEpoch`. It is stamped into each token at issue
// and checked on every request; bumping it makes every token minted before the
// bump fail to verify, on every device at once.
//
// Students already have their row read on each request, so their epoch is free.
// Google accounts and the admin cost one extra point read, memoised for
// EPOCH_TTL_MS -- which is exactly how long a "sign out everywhere" can lag on
// a warm instance that did not serve the request. Shorten this before
// lengthening it: it is the window in which a stolen session still works.
const EPOCH_TTL_MS = 30 * 1000;
const epochCache = makeCache(500);

// The admin signs in against environment variables and so has no row anywhere.
// This table gives it one -- and nothing else lives here.
const ADMIN_EPOCH_KEY = "admin";

async function profileEpoch(sub) {
  const key = `goo~${sub}`;
  const cached = epochCache.get(key);
  if (cached !== undefined) return cached;
  let epoch = 0;
  try {
    const row = await tableClient("profiles").getEntity("profile", sub);
    epoch = Number(row.tokenEpoch) || 0;
  } catch {}
  return epochCache.set(key, epoch, EPOCH_TTL_MS);
}

async function adminEpoch() {
  const key = `adm~${ADMIN_EPOCH_KEY}`;
  const cached = epochCache.get(key);
  if (cached !== undefined) return cached;
  let epoch = 0;
  try {
    const row = await tableClient("authstate").getEntity("epoch", ADMIN_EPOCH_KEY);
    epoch = Number(row.tokenEpoch) || 0;
  } catch {}
  return epochCache.set(key, epoch, EPOCH_TTL_MS);
}

// ---------- The admin's second factor (TOTP, RFC 6238) ----------
//
// The admin password is one shared string that opens the whole platform. It is
// throttled, but throttling only slows a guess; it does nothing about a
// password that has leaked. A time-based code from the phone in your pocket is
// the cheapest thing that makes a leaked password insufficient.
//
// Hand-rolled on purpose: TOTP is an HMAC of a counter, and `crypto` already
// has HMAC-SHA1. A dependency for thirty lines would be a supply-chain surface
// on the most sensitive endpoint in the product, and needs asking for besides.
// It is checked against the RFC 6238 test vectors in e2e/helpers.cjs.

const TOTP_STEP_S = 30;
const TOTP_DIGITS = 6;
// One step either side, because the phone's clock and Azure's are not the same
// clock. Wider than this starts to matter: each extra step is another code an
// attacker may guess.
const TOTP_SKEW_STEPS = 1;
const TOTP_KEY = "admin";
const RECOVERY_CODE_COUNT = 8;

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32Encode(buf) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of String(str).toUpperCase().replace(/[\s=]/g, "")) {
    const idx = B32.indexOf(ch);
    if (idx < 0) throw new Error("bad base32");
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The 6-digit code for one 30-second step. `digits` is for the RFC vectors. */
function totpCode(secretBase32, step, digits = TOTP_DIGITS) {
  const counter = Buffer.alloc(8);
  counter.writeUInt32BE(Math.floor(step / 0x100000000), 0);
  counter.writeUInt32BE(step >>> 0, 4);
  const mac = crypto
    .createHmac("sha1", base32Decode(secretBase32))
    .update(counter)
    .digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) |
    (mac[offset + 1] << 16) |
    (mac[offset + 2] << 8) |
    mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, "0");
}

function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / TOTP_STEP_S);
}

/**
 * Which step a code belongs to, or 0 for none.
 *
 * Returning the step rather than a boolean is what makes replay impossible:
 * the caller records the step it accepted and refuses anything at or below it,
 * so a code read over a shoulder is dead the moment it is used once.
 * Every candidate is compared, so a code that matches the first step costs
 * exactly what one that matches the last does.
 */
function totpMatchStep(secretBase32, code, now = Date.now()) {
  const given = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(given)) return 0;
  const here = currentStep(now);
  let found = 0;
  for (let d = -TOTP_SKEW_STEPS; d <= TOTP_SKEW_STEPS; d++) {
    const step = here + d;
    if (safeEqual(totpCode(secretBase32, step), given)) found = step;
  }
  return found;
}

function newTotpSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160 bits, as RFC 4226 asks
}

/**
 * The way back in when the phone is lost. Eight single-use codes, shown once
 * and stored as scrypt hashes like any other password — an admin locked out of
 * their own platform is a worse outcome than the codes existing.
 */
function newRecoveryCodes() {
  return Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    crypto.randomBytes(5).toString("hex").replace(/(.{4})(?=.)/g, "$1-")
  );
}

async function adminTotp() {
  try {
    const row = await tableClient("authstate").getEntity("totp", TOTP_KEY);
    return {
      secret: String(row.secret || ""),
      active: row.active === true,
      lastStep: Number(row.lastStep) || 0,
      recovery: JSON.parse(String(row.recovery || "[]")),
    };
  } catch {
    return null;
  }
}

async function writeAdminTotp(fields) {
  const state = tableClient("authstate");
  await ensureTable(state);
  await state.upsertEntity({ partitionKey: "totp", rowKey: TOTP_KEY, ...fields }, "Merge");
}

/**
 * Ends every session for one account, everywhere, by moving its epoch past the
 * value stamped in the tokens already out there. The cache entry is dropped so
 * the instance handling the request is correct immediately; other warm
 * instances catch up within EPOCH_TTL_MS.
 */
async function bumpEpoch(who) {
  if (who.kind === "student") {
    const students = tableClient("students");
    await ensureTable(students);
    const row = await students.getEntity("student", who.username);
    await students.updateEntity(
      {
        partitionKey: "student",
        rowKey: who.username,
        tokenEpoch: (Number(row.tokenEpoch) || 0) + 1,
      },
      "Merge"
    );
    studentCache.drop(who.username);
    return true;
  }
  if (who.kind === "google") {
    const profiles = tableClient("profiles");
    await ensureTable(profiles);
    let current = 0;
    try {
      current = Number((await profiles.getEntity("profile", who.id)).tokenEpoch) || 0;
    } catch {}
    await profiles.upsertEntity(
      { partitionKey: "profile", rowKey: who.id, tokenEpoch: current + 1 },
      "Merge"
    );
    epochCache.drop(`goo~${who.id}`);
    return true;
  }
  if (who.kind === "admin") {
    const state = tableClient("authstate");
    await ensureTable(state);
    let current = 0;
    try {
      current = Number((await state.getEntity("epoch", ADMIN_EPOCH_KEY)).tokenEpoch) || 0;
    } catch {}
    await state.upsertEntity(
      { partitionKey: "epoch", rowKey: ADMIN_EPOCH_KEY, tokenEpoch: current + 1 },
      "Merge"
    );
    epochCache.drop(`adm~${ADMIN_EPOCH_KEY}`);
    return true;
  }
  return false;
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 32).toString("hex");
  return `${salt}:${hash}`;
}

function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(":");
  if (!salt || !hash) return false;
  const candidate = crypto.scryptSync(password, salt, 32).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(hash), Buffer.from(candidate));
}

// An unknown username must still cost a hash comparison. Computed once and
// lazily: one scrypt on first use, not on every cold start.
let decoyHash = null;

function timingDecoyHash() {
  if (!decoyHash) decoyHash = hashPassword("timing-parity-decoy");
  return decoyHash;
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

// ---------- Login throttling ----------
//
// There was none. A student password was one of 23,040 strings and nothing
// counted the guesses, so a classmate who knew a username could walk the whole
// space in minutes. Worse, every guess ran scrypt: unthrottled, the login
// endpoint was also a CPU burn billed to a consumption plan.
//
// Table "authattempts": PK = bucket kind ("user" | "ip"), RK = the identifier.
// Point reads and point writes only, never a scan.
//
// The username bucket is the control that matters: an attacker must name an
// account to attack it, and cannot evade the count. The IP bucket is secondary
// — x-forwarded-for is set by SWA's edge but is not a trust boundary, so
// spoofing it only sidesteps the weaker of the two.

// The two buckets are deliberately not equally strict. A whole school commonly
// sits behind one NAT address, so an IP threshold as tight as the username one
// would let a single student fumbling their password lock out every classmate.
// The username bucket is the control that stops an attack; the IP bucket only
// catches someone walking many accounts at once.
const LOCK_AFTER = { user: 5, ip: 50 };
const FAIL_WINDOW_MS = 15 * 60 * 1000; // failures older than this are forgotten
const LOCK_STEPS_MS = [30e3, 60e3, 2 * 60e3, 5 * 60e3, 15 * 60e3, 30 * 60e3];

/** Buckets are keyed by a digest, so no raw IP is stored — these are minors. */
function digestKey(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 32);
}

function ipKey(req) {
  const h = req.headers || {};
  const xff = String(h["x-forwarded-for"] || h["X-Forwarded-For"] || "");
  // SWA appends the source port: "203.0.113.4:51514".
  const first = xff.split(",")[0].trim().replace(/:\d+$/, "");
  return digestKey(first || "unknown");
}

async function attemptsTable() {
  const t = tableClient("authattempts");
  await ensureTable(t);
  return t;
}

function lockMsFor(fails, kind = "user") {
  const after = LOCK_AFTER[kind] ?? LOCK_AFTER.user;
  if (fails < after) return 0;
  return LOCK_STEPS_MS[Math.min(fails - after, LOCK_STEPS_MS.length - 1)];
}

/** Milliseconds this bucket stays shut. 0 means go ahead. */
async function bucketLock(table, kind, id) {
  try {
    const e = await table.getEntity(kind, id);
    return Math.max(0, (Date.parse(e.lockedUntil || "") || 0) - Date.now());
  } catch {
    return 0; // no row, or the read failed: never lock someone out by accident
  }
}

async function noteFailure(table, kind, id) {
  let fails = 0;
  try {
    const e = await table.getEntity(kind, id);
    const last = Date.parse(e.lastFailAt || "") || 0;
    // A quiet quarter of an hour wipes the slate: this throttles attacks, it
    // does not punish a student who mistypes today and again next week.
    if (Date.now() - last < FAIL_WINDOW_MS) fails = Number(e.fails) || 0;
  } catch {}
  fails += 1;
  const lock = lockMsFor(fails, kind);
  try {
    await table.upsertEntity(
      {
        partitionKey: kind,
        rowKey: id,
        fails,
        lastFailAt: new Date().toISOString(),
        lockedUntil: lock ? new Date(Date.now() + lock).toISOString() : "",
      },
      "Replace"
    );
  } catch {}
  return lock;
}

async function clearFailures(table, kind, id) {
  try {
    await table.deleteEntity(kind, id);
  } catch {}
}

/**
 * The gate in front of every credential check.
 *
 * Run this BEFORE hashing anything. scrypt is deliberately slow, so letting an
 * unthrottled caller reach it is what turns a login endpoint into a denial of
 * service that the account owner pays for.
 */
async function loginGate(req, id) {
  const table = await attemptsTable();
  const ip = ipKey(req);
  const user = digestKey(id);
  const [userLock, ipLock] = await Promise.all([
    bucketLock(table, "user", user),
    bucketLock(table, "ip", ip),
  ]);
  return { table, ip, user, lockMs: Math.max(userLock, ipLock) };
}

function tooManyAttempts(context, lockMs) {
  const seconds = Math.max(1, Math.ceil(lockMs / 1000));
  const wait = seconds >= 60 ? `${Math.ceil(seconds / 60)} minutes` : `${seconds} seconds`;
  return json(
    context,
    429,
    { error: `Too many sign-in attempts. Try again in ${wait}.`, retryAfter: seconds },
    { "Retry-After": String(seconds) }
  );
}

/** Both buckets pay for a failure, so neither route around the other. */
async function noteLoginFailure(gate) {
  await Promise.all([
    noteFailure(gate.table, "user", gate.user),
    noteFailure(gate.table, "ip", gate.ip),
  ]);
}

// Sixty-four plain words, three of them per password, so the space is
// 64 x 90 x 64 x 64 = 23,592,960 — exactly 1024x the 23,040 this used to be.
// Still all lowercase and a two-digit number, because a student reads it off
// WhatsApp and types it on a phone.
const PW_WORDS = [
  "tiger", "lotus", "mango", "cobra", "delta", "gamma", "sigma", "vector",
  "matrix", "prime", "pearl", "coral", "falcon", "comet", "orbit", "pixel",
  "amber", "basil", "cedar", "cliff", "coast", "crane", "dune", "ember",
  "fern", "flint", "glade", "grove", "harbor", "heron", "ivory", "jade",
  "kite", "lagoon", "lark", "linen", "maple", "marsh", "meadow", "mint",
  "nectar", "oasis", "olive", "onyx", "opal", "otter", "petal", "quartz",
  "quill", "raven", "reef", "ridge", "saffron", "slate", "sparrow", "spruce",
  "summit", "thistle", "topaz", "tulip", "violet", "walnut", "willow", "zephyr",
];

function generatePassword() {
  const word = () => PW_WORDS[crypto.randomInt(PW_WORDS.length)];
  return `${word()}${crypto.randomInt(10, 100)}${word()}${word()}`;
}

// A roster row never needs the password hash — the one property on a student
// that must not travel further than the login check.
const ROSTER_SELECT = [
  "PartitionKey", "RowKey", "name", "school", "grade", "parentPhone", "teacherSub",
];

const ATTEMPT_LIST_SELECT = [
  "PartitionKey", "RowKey", "testId", "score", "total", "completedAt", "updatedAt", "index",
  // A teacher's granted extra attempt rides in this partition too; the listing
  // tallies it rather than showing it.
  "extra",
];

function slugify(name) {
  return (
    String(name)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "")
      .slice(0, 16) || "student"
  );
}

// ---------- Unified caller identity ----------

// Every student request read this row. Removing a student must still revoke
// their access, so the window is short and the students handler drops the entry
// the moment it deletes or resets an account; across instances the account stays
// usable for at most STUDENT_TTL_MS after removal.
const STUDENT_TTL_MS = 30 * 1000;
const studentCache = makeCache(500);

async function studentRecord(username) {
  const cached = studentCache.get(username);
  if (cached !== undefined) return cached;
  let record = null;
  try {
    record = await tableClient("students").getEntity("student", username);
  } catch {}
  return studentCache.set(username, record, STUDENT_TTL_MS);
}

/**
 * Who is calling, and on what.
 *
 * The session token is read from the httpOnly cookie first. The custom header
 * stays as a fallback for one release: a student with the page already open
 * when this deploys is still holding a token in localStorage and sending it
 * that way, and the deploy is not atomic. Drop the header path -- and
 * `getBearer` with it -- once everyone has reloaded.
 *
 * `context` is optional and used only for silent renewal; a caller that does
 * not pass it simply does not renew.
 */
async function identify(req, context) {
  const cookie = readCookie(req, SESSION_COOKIE);
  const bearer = cookie || getBearer(req);
  if (!bearer) return { reason: "no_bearer_token" };
  if (bearer.startsWith("vst.")) {
    if (!SESSION_SECRET) return { reason: "no_session_secret_configured" };
    const session = verifySession("vst", bearer);
    if (!session) return { reason: "bad_student_token" };
    // Student sessions last 30 days, so a signed token outlives the account.
    // Check the record still exists, otherwise removing a student would not
    // actually revoke their access. Also carries teacherSub for test scoping.
    const record = await studentRecord(session.username);
    if (!record) return { reason: "student_removed" };
    // The student's row is already in hand, so their epoch costs nothing.
    if (session.epoch !== (Number(record.tokenEpoch) || 0)) {
      return { reason: "session_revoked" };
    }
    renewIfStale(context, "vst", session, { ep: session.epoch });
    return {
      kind: "student",
      id: `stu~${session.username}`,
      username: session.username,
      teacherSub: record.teacherSub || "",
    };
  }
  if (bearer.startsWith("vad.")) {
    if (!SESSION_SECRET) return { reason: "no_session_secret_configured" };
    const session = verifySession("vad", bearer);
    if (!session) return { reason: "bad_admin_token" };
    if (session.epoch !== (await adminEpoch())) return { reason: "session_revoked" };
    renewIfStale(context, "vad", session, { ep: session.epoch });
    return { kind: "admin", id: `adm~${session.username}`, name: "Admin", role: "admin" };
  }
  if (bearer.startsWith("vgo.")) {
    if (!SESSION_SECRET) return { reason: "no_session_secret_configured" };
    const session = verifySession("vgo", bearer);
    if (!session) return { reason: "bad_session_token" };
    if (session.epoch !== (await profileEpoch(session.username))) {
      return { reason: "session_revoked" };
    }
    renewIfStale(context, "vgo", session, {
      ep: session.epoch,
      e: session.email,
      n: session.name,
    });
    return {
      kind: "google",
      id: session.username,
      // Carried in the token rather than read back: it is only ever stamped on
      // a row as "who marked this" or "who released this", and one more point
      // read per request to spell a name would not be worth it.
      name: session.name,
      email: session.email,
      // Still resolved per request (memoised 60s), so adding a teacher to the
      // allowlist takes effect without them signing in again.
      role: await resolveRole(session.email),
    };
  }
  // Legacy: a raw Google ID token, from a tab opened before this deploy. It
  // still expires after Google's hour; the next reload gets a real session.
  //
  // Check the shape first. The current client sends only a CSRF marker in this
  // header, so without this every authenticated request from a browser whose
  // cookie was refused would spend a round trip asking Google about the string
  // "1" -- a network call per request, to be told no.
  if (bearer.split(".").length !== 3 || bearer.length <= 40) {
    return { reason: "not_a_session_token" };
  }
  const { token, reason } = await verifyGoogleToken(bearer);
  if (!token) return { reason };
  return {
    kind: "google",
    id: token.sub,
    name: token.name || "",
    email: token.email,
    role: await resolveRole(token.email),
  };
}

/**
 * CSRF. SameSite=Strict already keeps the cookie off every cross-site request,
 * so this is the second lock rather than the first: a state-changing call must
 * also carry a custom header, and a cross-origin page cannot set one without a
 * CORS preflight this API never answers. Reads are exempt -- nothing here
 * changes state on a GET -- and so are the sign-in endpoints, which have no
 * cookie to abuse yet.
 */
// Signing in has no session cookie to abuse, and a 403 there would just be a
// confusing way to fail a password check.
const SIGN_IN_HANDLERS = new Set(["studentlogin", "adminlogin", "health"]);

function csrfRefused(context, req) {
  const method = String((req && req.method) || "GET").toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") return false;
  if (!readCookie(req, SESSION_COOKIE)) return false; // header-authenticated
  const headers = (req && req.headers) || {};
  const marked =
    headers["x-vidai-auth"] ||
    headers["X-Vidai-Auth"] ||
    headers["x-vidaivi-auth"] ||
    headers["X-Vidaivi-Auth"];
  if (marked) return false;
  json(context, 403, { error: "Missing request header" });
  return true;
}

function misconfigured(context) {
  if (!STORAGE || !GOOGLE_CLIENT_ID) {
    json(context, 500, { error: "API not configured" });
    return true;
  }
  return false;
}

// ---------- Handlers ----------

const handlers = {};

handlers.health = async (context) => {
  json(context, 200, {
    hasGoogleClientId: !!GOOGLE_CLIENT_ID,
    hasStorageConnectionString: !!STORAGE,
    hasSessionSecret: !!SESSION_SECRET,
    hasAdminCredentials: !!(ADMIN_USERNAME && ADMIN_PASSWORD),
    teacherEmailsConfigured: TEACHER_EMAILS.length,
    model: "v3",
    node: process.version,
  });
};

/**
 * Sign in with Google, and the one place a Google ID token is ever accepted.
 *
 * It is exchanged here for a Vidai session and never held by the client again:
 * the browser gets an httpOnly cookie, not a token it could be robbed of, and
 * the session is ours to expire and revoke rather than Google's to expire in an
 * hour.
 *
 * The same endpoint takes the WhatsApp number afterwards, authenticated by that
 * cookie -- the signed-in caller has no Google credential left to re-present.
 */
handlers.login = async (context, req) => {
  if (misconfigured(context)) return;

  const credential = getBearer(req);
  const body = getBody(req);
  const phone =
    typeof body.phone === "string" ? body.phone.trim().slice(0, 20) : "";

  let sub = "";
  let token = null;
  // A Google ID token is a JWT. Our own session tokens are also three
  // dot-separated parts, and a signed-in caller sends only the CSRF marker
  // ("1"), so the shape alone is not enough to tell them apart — which is how
  // saving a phone number would have gone to Google's tokeninfo endpoint
  // carrying the string "1" and come back 401.
  const isOurs = /^(vgo|vst|vad)\./.test(credential);
  const looksLikeJwt = credential.split(".").length === 3 && credential.length > 40;
  if (credential && !isOurs && looksLikeJwt) {
    const verified = await verifyGoogleToken(credential);
    if (!verified.token) {
      return json(context, 401, { error: "Invalid token", reason: verified.reason });
    }
    token = verified.token;
    sub = token.sub;
  } else {
    // No Google credential: this is a signed-in caller updating their profile.
    const who = await identify(req, context);
    if (who.kind !== "google") {
      return json(context, 401, { error: "Invalid token", reason: who.reason || "not_google" });
    }
    sub = who.id;
  }

  const profiles = tableClient("profiles");
  await ensureTable(profiles);

  let entity;
  try {
    entity = await profiles.getEntity("profile", sub);
  } catch {
    entity = null;
  }
  if (!token && !entity) {
    return json(context, 401, { error: "Invalid token", reason: "no_profile" });
  }

  const epoch = Number(entity && entity.tokenEpoch) || 0;
  const merged = {
    partitionKey: "profile",
    rowKey: sub,
    name: (token && token.name) || (entity && entity.name) || "",
    email: (token && token.email) || (entity && entity.email) || "",
    picture: (token && token.picture) || (entity && entity.picture) || "",
    phone: phone || (entity && entity.phone) || "",
    lastLoginAt: new Date().toISOString(),
    createdAt: (entity && entity.createdAt) || new Date().toISOString(),
    tokenEpoch: epoch,
  };
  await profiles.upsertEntity(merged, "Merge");
  epochCache.drop(`goo~${sub}`);

  json(
    context,
    200,
    {
      sub: merged.rowKey,
      name: merged.name,
      email: merged.email,
      picture: merged.picture,
      phone: merged.phone,
      role: await resolveRole(merged.email),
    },
    // Only a fresh Google sign-in mints a session; a phone update rides the
    // one already in the cookie.
    token
      ? {
          "Set-Cookie": sessionCookie(
            signSession("vgo", sub, GOOGLE_SESSION_TTL_MS, {
              ep: epoch,
              e: merged.email,
              n: String(merged.name || "").slice(0, 60),
            }),
            GOOGLE_SESSION_TTL_MS
          ),
        }
      : undefined
  );
};

handlers.studentlogin = async (context, req) => {
  if (misconfigured(context)) return;
  if (!SESSION_SECRET) {
    return json(context, 500, { error: "API not configured", reason: "no_session_secret" });
  }
  const body = getBody(req);
  const username = String(body.username || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (!username || !password) {
    return json(context, 400, { error: "Username and password required" });
  }
  const students = tableClient("students");
  await ensureTable(students);

  // Before the row read and before any hashing.
  const gate = await loginGate(req, username);
  if (gate.lockMs > 0) return tooManyAttempts(context, gate.lockMs);

  let entity;
  try {
    entity = await students.getEntity("student", username);
  } catch {
    entity = null;
  }
  // An unknown username still pays for a comparison. Returning early made the
  // answer measurably quicker for a name that does not exist, which is a free
  // oracle for "which of my classmates has an account".
  const ok = entity
    ? checkPassword(password, entity.passwordHash)
    : (checkPassword(password, timingDecoyHash()), false);
  if (!ok) {
    await noteLoginFailure(gate);
    return json(context, 401, { error: "Wrong username or password" });
  }
  await clearFailures(gate.table, "user", gate.user);

  const epoch = Number(entity.tokenEpoch) || 0;
  json(
    context,
    200,
    {
      student: {
        username,
        name: entity.name,
        school: entity.school,
        grade: entity.grade,
      },
    },
    {
      "Set-Cookie": sessionCookie(
        signSession("vst", username, STUDENT_TOKEN_TTL_MS, { ep: epoch }),
        STUDENT_TOKEN_TTL_MS
      ),
    }
  );
};

handlers.adminlogin = async (context, req) => {
  if (misconfigured(context)) return;
  if (!SESSION_SECRET || !ADMIN_USERNAME || !ADMIN_PASSWORD) {
    return json(context, 500, { error: "API not configured", reason: "no_admin_credentials" });
  }
  const body = getBody(req);
  const username = String(body.username || "").trim();
  const password = String(body.password || "");
  const gate = await loginGate(req, `admin~${username}`);
  if (gate.lockMs > 0) return tooManyAttempts(context, gate.lockMs);

  // Both compares always run: `||` would skip the password check on a wrong
  // username, and the difference is measurable.
  const userOk = safeEqual(username, ADMIN_USERNAME);
  const passOk = safeEqual(password, ADMIN_PASSWORD);
  if (!userOk || !passOk) {
    await noteLoginFailure(gate);
    return json(context, 401, { error: "Wrong username or password" });
  }

  // The second factor. Only read once the password is right, so an attacker
  // walking passwords never learns whether the account has one.
  const totp = await adminTotp();
  if (totp && totp.active && totp.secret) {
    const code = String(body.code || "").replace(/\s|-/g, "");
    if (!code) {
      // Not counted as a failure: reaching here needed the right password, and
      // the five guesses that bought were already spent. Counting it would
      // lock the real admin out for filling the form in two steps.
      return json(context, 401, {
        error: "Authentication code required",
        needsCode: true,
      });
    }

    const step = totpMatchStep(totp.secret, code);
    let ok = step > 0 && step > totp.lastStep;
    let usedRecovery = -1;
    if (!ok) {
      // A recovery code, for the admin whose phone is gone. Every stored hash
      // is compared, so a wrong code costs what a right one does.
      for (let i = 0; i < totp.recovery.length; i++) {
        if (checkPassword(code, totp.recovery[i])) usedRecovery = i;
      }
      ok = usedRecovery >= 0;
    }
    if (!ok) {
      // Counted, unlike a missing code: this is a guess at the code, and six
      // digits are walkable in minutes without the lockout.
      await noteLoginFailure(gate);
      return json(context, 401, {
        error: step > 0 ? "That code has already been used" : "Wrong authentication code",
        needsCode: true,
      });
    }
    if (usedRecovery >= 0) {
      // Single use. The list shrinks; when it empties, the phone is the only
      // way back in, which is what the count is for.
      const left = totp.recovery.filter((_, i) => i !== usedRecovery);
      await writeAdminTotp({ recovery: JSON.stringify(left) });
    } else {
      // Record the step so this exact code cannot be replayed inside its own
      // 30 seconds by someone who read it over a shoulder.
      await writeAdminTotp({ lastStep: step });
    }
  }

  await clearFailures(gate.table, "user", gate.user);

  const epoch = await adminEpoch();
  json(
    context,
    200,
    { ok: true },
    {
      "Set-Cookie": sessionCookie(
        signSession("vad", username, ADMIN_TOKEN_TTL_MS, { ep: epoch }),
        ADMIN_TOKEN_TTL_MS
      ),
    }
  );
};

/**
 * Signing out.
 *
 * Plain: clear the cookie. There is nothing else to clear -- the client never
 * held the token.
 *
 * `{ everywhere: true }`: move the account's token epoch past every token
 * already minted for it, which ends the session on every device at once. This
 * is the answer to a lost phone, and the reason a session may now last a month
 * without that being reckless.
 */
handlers.signout = async (context, req) => {
  if (misconfigured(context)) return;
  const body = getBody(req);
  const everywhere = body.everywhere === true;
  let revoked = false;
  if (everywhere) {
    const who = await identify(req, context);
    if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
    revoked = await bumpEpoch(who);
  }
  // The cookie goes either way: a failed revoke must still sign this device out
  // rather than leave the caller apparently signed in.
  json(context, 200, { ok: true, revoked }, { "Set-Cookie": clearedCookie() });
};

/**
 * Turning the admin's second factor on and off.
 *
 * Separate from /api/manageauth on purpose: signing in has no session to abuse
 * and is exempt from the CSRF guard, while these actions change what protects
 * the whole platform and must not be.
 *
 * Disabling asks for a current code, not just a session — otherwise a stolen
 * session could switch off the thing that makes a stolen password useless.
 */
handlers.twostep = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  if (who.role !== "admin") return json(context, 403, { error: "Admins only" });

  const existing = await adminTotp();

  if (req.method !== "POST") {
    return json(context, 200, {
      enabled: !!(existing && existing.active),
      pending: !!(existing && !existing.active && existing.secret),
      recoveryLeft: existing ? existing.recovery.length : 0,
    });
  }

  const body = getBody(req);
  const action = String(body.action || "");
  const code = String(body.code || "").replace(/\s|-/g, "");

  if (action === "init") {
    if (existing && existing.active) {
      return json(context, 409, { error: "Two-step verification is already on" });
    }
    // A fresh secret every time this is opened: an abandoned setup must not
    // leave a working secret lying in the table.
    const secret = newTotpSecret();
    await writeAdminTotp({ secret, active: false, lastStep: 0, recovery: "[]" });
    const label = encodeURIComponent(`Vidai (${ADMIN_USERNAME || "admin"})`);
    return json(context, 200, {
      secret,
      uri: `otpauth://totp/${label}?secret=${secret}&issuer=Vidai&digits=${TOTP_DIGITS}&period=${TOTP_STEP_S}`,
    });
  }

  if (action === "enable") {
    if (!existing || !existing.secret) {
      return json(context, 400, { error: "Start the setup again" });
    }
    if (existing.active) return json(context, 409, { error: "Already on" });
    const step = totpMatchStep(existing.secret, code);
    if (step <= 0) return json(context, 400, { error: "That code did not match. Try the next one." });

    const recovery = newRecoveryCodes();
    await writeAdminTotp({
      active: true,
      lastStep: step,
      enrolledAt: new Date().toISOString(),
      recovery: JSON.stringify(recovery.map((c) => hashPassword(c.replace(/-/g, "")))),
    });
    // Every other admin session predates the second factor, so end them —
    // including any an attacker already holds. This one is re-issued below, or
    // turning 2FA on would sign the admin out of the screen they are looking at.
    await bumpEpoch(who);
    const epoch = await adminEpoch();
    return json(
      context,
      200,
      { ok: true, recoveryCodes: recovery },
      {
        "Set-Cookie": sessionCookie(
          signSession("vad", who.id.replace(/^adm~/, ""), ADMIN_TOKEN_TTL_MS, { ep: epoch }),
          ADMIN_TOKEN_TTL_MS
        ),
      }
    );
  }

  if (action === "disable") {
    if (!existing || !existing.active) return json(context, 409, { error: "It is not on" });

    // An admin who signed in with GOOGLE may clear this without a code.
    //
    // It sounds like a hole and is not: this factor protects the shared
    // username-and-password admin login, and a Google admin already holds every
    // power on the platform through an account with a second factor of its own.
    // Requiring a code from a different credential adds nothing against them —
    // while the ability to reset is the whole difference between a lost phone
    // and a platform nobody can administer. Without it the only way back is
    // deleting a row in the Azure portal, and an escape hatch that needs the
    // portal is not one you can use from a phone on a Sunday.
    //
    // The password session (`kind: "admin"`) still has to prove a code, which
    // is the case that matters: a stolen admin session must not be able to
    // switch off the thing that makes the stolen password insufficient.
    if (who.kind !== "google") {
      // A used code is refused here as it is at sign-in. Someone who has taken
      // a session and shoulder-surfed one code should not be able to switch the
      // second factor off with it; the cost is waiting up to 30 seconds for a
      // fresh one, on an action done once.
      const step = totpMatchStep(existing.secret, code);
      let ok = step > 0 && step > existing.lastStep;
      if (!ok) {
        for (const stored of existing.recovery) if (checkPassword(code, stored)) ok = true;
      }
      if (!ok) {
        return json(context, 400, {
          error: step > 0 ? "That code has already been used — wait for the next one" : "Wrong authentication code",
        });
      }
    }
    await writeAdminTotp({ secret: "", active: false, lastStep: 0, recovery: "[]" });
    // Only the password account's sessions are ended, and only a password
    // session gets a replacement. Minting a `vad.` cookie for a Google caller
    // would hand them a second identity they never asked for, named after their
    // Google sub — which is exactly what the first version of this did.
    if (who.kind !== "admin") return json(context, 200, { ok: true });
    await bumpEpoch(who);
    const epoch = await adminEpoch();
    return json(
      context,
      200,
      { ok: true },
      {
        "Set-Cookie": sessionCookie(
          signSession("vad", who.id.replace(/^adm~/, ""), ADMIN_TOKEN_TTL_MS, { ep: epoch }),
          ADMIN_TOKEN_TTL_MS
        ),
      }
    );
  }

  return json(context, 400, { error: `Unknown action: ${action}` });
};

handlers.teachers = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  if (who.role !== "admin") return json(context, 403, { error: "Admins only" });

  const teachers = tableClient("teachers");
  await ensureTable(teachers);

  if (req.method === "POST") {
    const body = getBody(req);
    const action = body.action || "add";
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json(context, 400, { error: "Enter a valid email address" });
    }
    if (action === "remove") {
      try {
        await teachers.deleteEntity("teacher", email);
      } catch {}
      roleCache.drop(email);
      return json(context, 200, { ok: true });
    }
    roleCache.drop(email);
    await teachers.upsertEntity(
      {
        partitionKey: "teacher",
        rowKey: email,
        addedBy: who.id,
        addedAt: new Date().toISOString(),
      },
      "Merge"
    );
    return json(context, 200, { ok: true });
  }

  const list = [];
  const iter = teachers.listEntities({
    queryOptions: { filter: `PartitionKey eq 'teacher'`, select: ["PartitionKey", "RowKey", "addedAt"] },
  });
  for await (const e of iter) {
    list.push({ email: e.rowKey, addedAt: e.addedAt });
    if (list.length >= 200) break;
  }
  list.sort((a, b) => a.email.localeCompare(b.email));
  json(context, 200, { teachers: list });
};

handlers.students = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  if (who.role !== "teacher" && who.role !== "admin") {
    return json(context, 403, { error: "Teachers only" });
  }
  const students = tableClient("students");
  await ensureTable(students);

  if (req.method === "POST") {
    const body = getBody(req);
    const action = body.action || "create";

    if (action === "remove") {
      const username = String(body.username || "").trim().toLowerCase();
      let entity;
      try {
        entity = await students.getEntity("student", username);
      } catch {
        return json(context, 404, { error: "Student not found" });
      }
      if (entity.teacherSub !== who.id) {
        return json(context, 403, { error: "Not your student" });
      }
      // Remove the student's attempt history too, so no orphan rows are left
      // pointing at a login that no longer exists.
      const attempts = tableClient("attempts");
      await ensureTable(attempts);
      let removedAttempts = 0;
      try {
        const iter = attempts.listEntities({
          queryOptions: {
            filter: `PartitionKey eq 'stu~${username.replace(/'/g, "''")}'`,
            select: ["PartitionKey", "RowKey"],
          },
        });
        for await (const a of iter) {
          await attempts.deleteEntity(a.partitionKey, a.rowKey);
          removedAttempts++;
        }
      } catch {
        // Best effort: the student record still goes, below.
      }
      // The graded answers go too, and so do the photographs they point at.
      //
      // Removing a student used to delete the login and the attempts and stop
      // there, which left every `grading` row and every uploaded photo behind
      // for good. Nothing could reach them afterwards either: `answerimage`'s
      // own remove keys on `grading.getEntity(who.id, ...)` — the *caller's*
      // partition — so not even an admin could delete another student's photo,
      // and the only route left was the Azure portal.
      //
      // Vidai holds photographs of minors' handwriting. Removing the account
      // has to remove the handwriting, or "remove this student" quietly means
      // "hide this student".
      const grading = tableClient("grading");
      await ensureTable(grading);
      let removedAnswers = 0;
      let removedPhotos = 0;
      try {
        const rows = [];
        const iter = grading.listEntities({
          queryOptions: {
            // One partition — the student is the PartitionKey — so this is a
            // bounded read, never a scan. `images` is the only extra property
            // needed; the rest of GRADING_SELECT is for people, not for this.
            filter: `PartitionKey eq 'stu~${username.replace(/'/g, "''")}'`,
            select: ["PartitionKey", "RowKey", "images"],
          },
        });
        for await (const g of iter) rows.push(g);

        // Blobs first: a row deleted before its photo would lose the only
        // record of where that photo lives.
        const container = await answerContainer();
        const photos = rows.flatMap((g) => parseImages(g.images));
        await inBatches(photos, 20, async (name) => {
          try {
            const done = await container.getBlockBlobClient(name).deleteIfExists();
            if (done && done.succeeded) removedPhotos++;
          } catch {
            // One stubborn blob must not strand the other rows.
          }
          return null;
        });
        await inBatches(rows, 20, async (g) => {
          try {
            await grading.deleteEntity(g.partitionKey, g.rowKey);
            removedAnswers++;
          } catch {}
          return null;
        });
      } catch {
        // Best effort, exactly as above: the login must still go. A student
        // who asked to be removed and is still able to sign in is the worse
        // failure of the two.
      }
      await students.deleteEntity("student", username);
      studentCache.drop(username); // revoke this instance's copy at once
      return json(context, 200, {
        ok: true,
        username,
        removedAttempts,
        removedAnswers,
        removedPhotos,
      });
    }

    if (action === "reset") {
      const username = String(body.username || "").trim().toLowerCase();
      let entity;
      try {
        entity = await students.getEntity("student", username);
      } catch {
        return json(context, 404, { error: "Student not found" });
      }
      if (entity.teacherSub !== who.id) {
        return json(context, 403, { error: "Not your student" });
      }
      const password = generatePassword();
      entity.passwordHash = hashPassword(password);
      // Resetting a password must end the sessions opened with the old one --
      // otherwise a device that should have lost access keeps it for a month.
      entity.tokenEpoch = (Number(entity.tokenEpoch) || 0) + 1;
      await students.upsertEntity(entity, "Merge");
      studentCache.drop(username);
      return json(context, 200, { username, password });
    }

    // Seats. A student login is a real child's account, so this gate runs
    // before the name is even read, and fails closed.
    const seatEnt = await entitlements(who);
    if (seatEnt.students > 0) {
      const safeSub = who.id.replace(/'/g, "''");
      let seats = 0;
      const seatIter = students.listEntities({
        queryOptions: {
          filter: `PartitionKey eq 'student' and teacherSub eq '${safeSub}'`,
          select: ["RowKey"],
        },
      });
      for await (const _ of seatIter) {
        seats += 1;
        if (seats > seatEnt.students) break;
      }
      if (seats >= seatEnt.students) {
        return overLimit(
          context,
          seatEnt.plan === "parent" ? "children" : "student accounts",
          seats,
          seatEnt.students,
          seatEnt.plan === "parent"
            ? ""
            : `Each additional student is ${rupees(seatEnt.rules.perStudentMonthlyPaise)} a month.`
        );
      }
    }

    const name = String(body.name || "").trim().slice(0, 60);
    const school = String(body.school || "").trim().slice(0, 80);
    const grade = String(body.grade || "").trim().slice(0, 20);
    const parentPhone = String(body.parentPhone || "").trim().slice(0, 20);
    if (!name) return json(context, 400, { error: "Name required" });

    let username = "";
    for (let i = 0; i < 8; i++) {
      const candidate = `${slugify(name)}${crypto.randomInt(10, 100)}`;
      try {
        await students.getEntity("student", candidate);
      } catch {
        username = candidate;
        break;
      }
    }
    if (!username) {
      return json(context, 500, { error: "Could not allocate username, try again" });
    }
    const password = generatePassword();
    await students.createEntity({
      partitionKey: "student",
      rowKey: username,
      name,
      school,
      grade,
      parentPhone,
      passwordHash: hashPassword(password),
      tokenEpoch: 0,
      teacherSub: who.id,
      teacherEmail: who.email || "",
      createdAt: new Date().toISOString(),
    });
    studentCache.drop(username); // in case a lookup cached this name as absent
    return json(context, 201, { username, password, name, school, grade, parentPhone });
  }

  const list = [];
  const iter = students.listEntities({
    queryOptions: {
      filter: `PartitionKey eq 'student' and teacherSub eq '${who.id.replace(/'/g, "''")}'`,
      select: ROSTER_SELECT.concat("createdAt"),
    },
  });
  for await (const e of iter) {
    list.push({
      username: e.rowKey,
      name: e.name,
      school: e.school,
      grade: e.grade,
      parentPhone: e.parentPhone,
      createdAt: e.createdAt,
    });
    if (list.length >= 200) break;
  }
  list.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  json(context, 200, { students: list });
};

// Teacher/admin: attempts for one of their students (?username=...) or all.
handlers.reports = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  if (who.role !== "teacher" && who.role !== "admin") {
    return json(context, 403, { error: "Teachers only" });
  }
  const students = tableClient("students");
  const attempts = tableClient("attempts");
  await ensureTable(students);
  await ensureTable(attempts);

  const wanted = String((req.query && req.query.username) || "").trim().toLowerCase();

  // Collect this teacher's students (optionally just one).
  const roster = [];
  const iter = students.listEntities({
    queryOptions: {
      filter: `PartitionKey eq 'student' and teacherSub eq '${who.id.replace(/'/g, "''")}'`,
      select: ROSTER_SELECT,
    },
  });
  for await (const e of iter) {
    if (wanted && e.rowKey !== wanted) continue;
    roster.push({
      username: e.rowKey,
      name: e.name,
      school: e.school,
      grade: e.grade,
      parentPhone: e.parentPhone,
    });
    if (roster.length >= 200) break;
  }
  if (wanted && !roster.length) {
    return json(context, 404, { error: "Student not found" });
  }

  // Attach each student's attempts (newest first via inverted-time row keys).
  // One partition query per student, but run a few at a time: awaiting them one
  // after another made a class of 200 into 200 serial round trips.
  await inBatches(roster, 20, async (s) => {
    s.attempts = [];
    const aIter = attempts.listEntities({
      queryOptions: {
        filter: `PartitionKey eq 'stu~${s.username.replace(/'/g, "''")}'`,
        select: ATTEMPT_LIST_SELECT,
      },
    });
    for await (const a of aIter) {
      s.attempts.push({
        testId: a.testId,
        score: a.score,
        total: a.total,
        completedAt: a.completedAt,
      });
      if (s.attempts.length >= 100) break;
    }
  });
  roster.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  json(context, 200, { students: roster });
};

// ---------- Tests (DB-backed; Phase 1 of the product plan) ----------
//
// Table "tests": PK = WHO THE ROW BELONGS TO, RK = test id. Questions are
// stored as JSON chunked across qc0..qcN string properties (Table Storage caps
// one string property at 64KB). Taxonomy fields (board/klass/subject) are
// stored from day one even though the UI is fixed to CBSE/12/Maths for now.
//
// The partition key was the constant "test" until the re-partition, which made
// every listing a walk of the whole platform: "show me my twelve papers" read
// every row every teacher had ever written. Seeding the library made that
// visible rather than theoretical -- a teacher's home screen walked 126 rows
// for the twelve it wanted, and the walk grows with the platform forever.
//
// Now a row lives in its owner's partition, so "my tests" is one bounded
// partition query whose cost is the caller's own work and nothing else. The
// same applies to "subjects". `ownerSub` is still stored on the row: it is the
// authorization field that canManageTest() and visible() read, and nothing
// about who may do what is decided by a partition key.

const TEST_STATUSES = ["draft", "published", "archived"];

// The library has a partition of its own. A master belongs to the platform
// rather than to whichever admin typed it in, so `?library=1` is one partition
// query instead of a walk past every teacher's drafts -- and an admin's own
// personal drafts stay out of the library's way.
//
// "~" can begin neither a Google sub (digits) nor an admin id ("adm~..."), so
// neither name can ever collide with a real owner.
const PLATFORM_PK = "~platform";
// A row whose ownerSub is missing. Table Storage accepts an empty partition
// key, but a row nobody can name is worse than one parked somewhere visible.
const ORPHAN_PK = "~orphan";

// The pre-re-partition names. Rows written before the change still live here,
// and every listing below reads them as a fallback and moves the ones it meets
// (drainLegacy). DELETE THESE, and every `legacy` path that mentions them,
// once both tables are empty of them -- the cost until then is one query
// against a partition that is usually empty.
const LEGACY_TEST_PK = "test";
const LEGACY_SUBJECT_PK = "subject";

/**
 * Which partition a test or subject row belongs in.
 *
 * Read it from the ROW, never from the caller: a row's home is decided by
 * whose it is, and a caller asking about someone else's row must not be able
 * to move it by asking.
 */
function ownerPartition(row) {
  if (row && row.platform) return PLATFORM_PK;
  const owner = String((row && row.ownerSub) || "").trim();
  return owner || ORPHAN_PK;
}

/** One partition key, escaped for an OData filter. */
function pkFilter(pk) {
  return `PartitionKey eq '${String(pk).replace(/'/g, "''")}'`;
}

/**
 * Read one row by id from the partitions a caller could legitimately hold it
 * in — their own, and the library's.
 *
 * With a constant partition key this was a single point read. With a real one
 * the partition has to be named, and the set worth naming is exactly the set
 * visible() would admit anyway. That is not a loosening: a caller who cannot
 * name the partition cannot reach the row at all, so another teacher's test
 * now reads as missing rather than as refused — one fewer way to learn that an
 * id exists.
 *
 * Awaited in sequence on purpose. The caller's own partition is listed first
 * and is the overwhelmingly common case, so this is usually ONE round trip;
 * running all of them in parallel would pay for every candidate every time.
 * The list is never longer than three.
 */
async function readByPartitions(table, partitions, rowKey, legacyPk) {
  for (const pk of [...new Set([...partitions, legacyPk].filter(Boolean))]) {
    try {
      return await table.getEntity(pk, rowKey);
    } catch {}
  }
  return null;
}

/**
 * Write a row back, moving it into its real partition if it is still sitting
 * in the legacy one.
 *
 * Every write goes through this, and that is what makes the lazy migration
 * safe. A drain running at the same moment as an edit can only ever lose to
 * it: the edit reads the legacy row, writes the real partition and drops the
 * legacy twin, so the newest content is always the copy in the real partition.
 * Without this the drain could copy a row a heartbeat before an edit landed in
 * the legacy partition, and the edit would go down with it.
 */
async function saveRow(table, legacyPk, entity, mode = "Replace") {
  const pk = ownerPartition(entity);
  if (entity.partitionKey === pk) {
    await table.updateEntity(entity, mode);
    return entity;
  }
  const moved = { ...entity, partitionKey: pk };
  delete moved.etag;
  delete moved.timestamp;
  // Replace, never Merge: this row is arriving in its partition for the first
  // time, so there is nothing to merge with.
  await table.upsertEntity(moved, "Replace");
  try {
    await table.deleteEntity(legacyPk, entity.rowKey);
  } catch {}
  return moved;
}

/**
 * Move one row left behind by the re-partition into its real partition.
 *
 * Bounded by the caller's budget, exactly as backfillCounts is: one listing
 * can never turn into a table-wide rewrite. The row is READ IN FULL first —
 * the listing that met it projected the question chunks away, so building the
 * new row from that projection would drop every question in it.
 *
 * The new row is written before the old one is deleted. A crash between the
 * two leaves a duplicate, which walkPartitions already tolerates by preferring
 * the copy in the real partition; a crash the other way round would lose the
 * test.
 */
async function drainLegacy(table, legacyPk, rowKey, budget) {
  if (!budget || budget.left <= 0) return;
  budget.left--;
  try {
    const full = await table.getEntity(legacyPk, rowKey);
    const pk = ownerPartition(full);
    if (pk === legacyPk) return;
    // Already in its real partition? Then this legacy copy is stale BY
    // CONSTRUCTION, because saveRow writes the real partition first and drops
    // the legacy twin second — a row present in both is one whose delete did
    // not land. Copying it across would undo the edit that wrote the real one,
    // so the stale copy is what goes.
    let already = false;
    try {
      await table.getEntity(pk, rowKey);
      already = true;
    } catch {}
    if (already) {
      await table.deleteEntity(legacyPk, rowKey);
      return;
    }
    await saveRow(table, legacyPk, full);
  } catch {
    // Best effort. A row that fails to move is simply read from the legacy
    // partition again next time; never fail a listing over housekeeping.
  }
}

/**
 * Walk several partitions of one table as one stream.
 *
 * What used to be a single scan of every row on the platform is now a handful
 * of queries, each naming its own PartitionKey (rule 2), whose combined size
 * is the caller's own work plus the library — bounded by them, and no longer
 * by how many teachers the platform has. `onRow` returns false to stop early.
 *
 * `legacyPk` is walked last and its rows are moved into their real partitions
 * as they are met, so the tables migrate themselves under ordinary traffic and
 * nothing is ever unreadable in the meantime. It is a content-preserving move
 * of a row from one partition to another, which is why any caller may trigger
 * it and not only the row's owner.
 */
async function walkPartitions(table, opts, onRow) {
  const { partitions = [], select, legacyPk, budget } = opts;
  const seen = new Set();
  for (const pk of [...new Set(partitions.filter(Boolean))]) {
    const iter = table.listEntities({ queryOptions: { filter: pkFilter(pk), select } });
    for await (const row of iter) {
      seen.add(row.rowKey);
      if ((await onRow(row)) === false) return;
    }
  }
  if (!legacyPk) return;
  const iter = table.listEntities({ queryOptions: { filter: pkFilter(legacyPk), select } });
  for await (const row of iter) {
    // A duplicate left behind by an interrupted move. The real partition has
    // already answered for this id, and by construction it is the newer copy.
    if (seen.has(row.rowKey)) {
      await drainLegacy(table, legacyPk, row.rowKey, budget);
      continue;
    }
    const verdict = await onRow(row);
    // After onRow, not before: the row is moved out from under a listing that
    // has already had its look at it.
    await drainLegacy(table, legacyPk, row.rowKey, budget);
    if (verdict === false) return;
  }
}

// Listing tests must never pull their questions off the wire. Without an
// explicit projection Table Storage hands back every property — qc0..qcN
// included — so a list of titles carried the full text of every paper it saw.
// Anything visible(), testMeta() or testMetaForStaff() touches belongs here;
// the question chunks deliberately do not.
const TEST_META_SELECT = [
  "PartitionKey", "RowKey", "title", "chapter", "teacher", "order", "access",
  "status", "platform", "sample", "subjectId", "ownerSub", "updatedAt",
  "audience", "assignedTo", "copiedFrom", "questionCount", "totalMarks",
  "board", "klass", "subject",
];

// How many legacy rows one request may heal. Beyond it the rest keep their
// fallback for the next listing, so no single request pays an unbounded cost.
const COUNT_BACKFILL_BUDGET = 25;

// The same bound for the re-partition drain, and deliberately its own number:
// sharing one budget would let a listing full of unstamped counts starve the
// migration, or the other way round.
const LEGACY_DRAIN_BUDGET = 25;

const SUBJECT_SELECT = [
  "PartitionKey", "RowKey", "board", "klass", "subject", "title", "ownerSub",
  "collaborators", "createdAt", "platform",
];

const Q_CHUNK = 30000;

function chunkQuestions(entity, questions) {
  const raw = JSON.stringify(questions);
  const count = Math.max(1, Math.ceil(raw.length / Q_CHUNK));
  for (let i = 0; i < count; i++) {
    entity[`qc${i}`] = raw.slice(i * Q_CHUNK, (i + 1) * Q_CHUNK);
  }
  entity.chunkCount = count;
  // Denormalised so a listing can say how big a test is without reading its
  // questions back. Every write of questions goes through here, so the stored
  // counts cannot drift from the stored questions.
  entity.questionCount = questions.length;
  entity.totalMarks = questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0);
}

function countsFromQuestions(questions) {
  return {
    questionCount: questions.length,
    totalMarks: questions.reduce((sum, q) => sum + (Number(q.marks) || 0), 0),
  };
}

/** The stamped counts, or null for a row written before they existed. */
function storedCounts(e) {
  return typeof e.questionCount === "number" && typeof e.totalMarks === "number"
    ? { questionCount: e.questionCount, totalMarks: e.totalMarks }
    : null;
}

/**
 * Heal a row written before the counts were stamped: read it in full once,
 * write the counts back, and answer from them afterwards. Bounded per request,
 * so one listing can never turn into a table-wide rewrite.
 */
async function backfillCounts(tests, e, budget) {
  if (storedCounts(e) || budget.left <= 0) return e;
  budget.left--;
  try {
    // The row's own partition, taken off the projected row — never a constant.
    // A heal that guessed the partition would silently stop healing anything
    // the moment the re-partition moved the row.
    const full = await tests.getEntity(e.partitionKey, e.rowKey);
    const counts = countsFromQuestions(unchunkQuestions(full));
    await tests.updateEntity(
      { partitionKey: e.partitionKey, rowKey: e.rowKey, ...counts },
      "Merge"
    );
    return { ...e, ...counts };
  } catch {
    return e; // derived data: a failed heal must never fail the listing
  }
}

function unchunkQuestions(entity) {
  let raw = "";
  for (let i = 0; i < (entity.chunkCount || 0); i++) raw += entity[`qc${i}`] || "";
  try {
    return JSON.parse(raw || "[]");
  } catch {
    return [];
  }
}

// Drafts hold work in progress, so a question may be incomplete: only the
// structural rules (unique ids, known type, length caps) are enforced on save.
// Publishing runs the same pass with strict=true, which additionally requires
// everything a student needs and reports every offending question at once.
function validateQuestions(input, { strict = false } = {}) {
  if (!Array.isArray(input) || input.length > 60) {
    return { error: "A test can hold at most 60 questions" };
  }
  if (strict && !input.length) {
    return { error: "Add at least one question before publishing", problems: [] };
  }
  const out = [];
  const problems = [];
  const seen = new Set();

  input.forEach((q, index) => {
    if (!q || typeof q !== "object") {
      problems.push({ index, questionId: "", reason: "Not a question" });
      return;
    }
    const id = String(q.id || "").trim().slice(0, 40);
    const type = ["mcq", "numeric", "long"].includes(q.type) ? q.type : "mcq";
    const at = { index, questionId: id };

    // Structural rules hold in every status — a duplicate id would silently
    // overwrite another question's answers.
    if (!id) {
      problems.push({ ...at, reason: "Question has no id", fatal: true });
      return;
    }
    if (seen.has(id)) {
      problems.push({ ...at, reason: `Duplicate question id "${id}"`, fatal: true });
      return;
    }
    seen.add(id);

    const marks = Number(q.marks);
    const clean = {
      id,
      chapter: String(q.chapter || "").slice(0, 60),
      topic: String(q.topic || "").slice(0, 60),
      type,
      q: String(q.q ?? "").slice(0, 4000),
      solution: String(q.solution ?? "").slice(0, 8000),
      marks: Number.isFinite(marks) ? Math.min(20, Math.max(0, Math.round(marks))) : 0,
    };
    // Where the question came from ("CBSE 2025"). Optional and never validated:
    // a question without one is complete. It has to be carried here explicitly —
    // `clean` is built from scratch, so anything not named is dropped on save.
    const source = String(q.source || "").trim().slice(0, 40);
    if (source) clean.source = source;

    if (!clean.q.trim()) problems.push({ ...at, reason: "No question text" });
    if (!clean.solution.trim()) problems.push({ ...at, reason: "No explanation" });
    if (!(clean.marks >= 1)) problems.push({ ...at, reason: "Marks must be at least 1" });

    if (type === "mcq") {
      const options = Array.isArray(q.options) ? q.options.slice(0, 6).map((o) => String(o).slice(0, 500)) : [];
      clean.options = options;
      const answer = Number(q.answer);
      // An unset answer stays unset. Coercing it to 0 silently made option A
      // the correct one, so a teacher who never touched the radios published a
      // paper where A was the answer to every question.
      clean.answer = Number.isInteger(answer) && answer >= 0 ? answer : -1;
      const filled = options.filter((o) => o.trim()).length;
      if (options.length < 2 || filled < 2) {
        problems.push({ ...at, reason: "Needs at least two filled options" });
      } else if (clean.answer < 0 || clean.answer >= options.length || !options[clean.answer].trim()) {
        problems.push({ ...at, reason: "No correct option marked" });
      }
    } else if (type === "numeric") {
      const answer = Number(q.answer);
      if (Number.isFinite(answer)) clean.answer = answer;
      else problems.push({ ...at, reason: "No numeric answer" });
      const tol = Number(q.tolerance);
      clean.tolerance = Number.isFinite(tol) && tol >= 0 ? tol : 0;
    }

    out.push(clean);
  });

  const fatal = problems.filter((p) => p.fatal);
  if (fatal.length) return { error: fatal[0].reason, problems: fatal };
  if (strict && problems.length) {
    // Count questions, not problems — one question can fail several rules.
    const affected = new Set(problems.map((p) => p.questionId)).size;
    return {
      error: `${affected} question${affected > 1 ? "s need" : " needs"} finishing before publishing`,
      problems,
    };
  }
  return { questions: out, problems };
}

/**
 * Who a test is for. "class" is everyone the owner teaches — the default, and
 * what every test written before assignment existed carries. "selected" is the
 * named usernames in `assignedTo` and nobody else.
 *
 * Fails closed: an unreadable or empty list on a "selected" test reaches no
 * student, never every student.
 */
function assignedList(e) {
  try {
    const list = JSON.parse(e.assignedTo || "[]");
    return Array.isArray(list) ? list.map((u) => String(u).toLowerCase()) : [];
  } catch {
    return [];
  }
}

function audienceOf(e) {
  return e.audience === "selected" ? "selected" : "class";
}

function assignedTo(e, username) {
  if (audienceOf(e) !== "selected") return true;
  return assignedList(e).includes(String(username || "").toLowerCase());
}

function testMeta(e) {
  // The counts are stamped on write, so a listing projects them off the row
  // instead of pulling every question body over the wire. A row written before
  // that is healed by backfillCounts(); this fallback covers the direct reads.
  const counts = storedCounts(e) || countsFromQuestions(unchunkQuestions(e));
  return {
    audience: audienceOf(e),
    assignedCount: audienceOf(e) === "selected" ? assignedList(e).length : 0,
    id: e.rowKey,
    title: e.title,
    chapter: e.chapter,
    teacher: e.teacher || null,
    order: typeof e.order === "number" ? e.order : 99,
    access: e.access === "open" ? "open" : "login",
    status: e.status,
    platform: !!e.platform,
    sample: !!e.sample,
    subjectId: e.subjectId || "",
    ownerSub: e.ownerSub,
    // Whether the attempt cap applies, not where the row came from: the
    // client needs the rule, and a master's id is the library's business.
    capped: !!e.copiedFrom,
    questionCount: counts.questionCount,
    totalMarks: counts.totalMarks,
    updatedAt: e.updatedAt,
  };
}

function testFull(e) {
  return { ...testMeta(e), questions: unchunkQuestions(e) };
}

/** The staff view: same metadata plus the usernames it is assigned to. */
function testMetaForStaff(e) {
  return { ...testMeta(e), assignedTo: assignedList(e) };
}

function canManageTest(who, entity) {
  if (who.role === "admin") return entity.platform || entity.ownerSub === who.id;
  return who.role === "teacher" && entity.ownerSub === who.id;
}

/**
 * The subject an adopted copy is filed under: the caller's own subject with the
 * same board/class/subject, created if they have none. A copy filed under the
 * library's subject would be invisible in the teacher's own subject list.
 */
async function subjectForAdopter(who, master) {
  const board = master.board || "CBSE";
  const klass = master.klass || "12";
  const subject = master.subject || "Maths";
  const subjects = tableClient("subjects");
  await ensureTable(subjects);
  // The caller's own partition: the question is "which of MY subjects is this",
  // which is precisely one partition now rather than every subject on the
  // platform filtered down to one owner in memory.
  let found = "";
  await walkPartitions(
    subjects,
    {
      partitions: [who.id],
      select: SUBJECT_SELECT,
      legacyPk: LEGACY_SUBJECT_PK,
      budget: { left: LEGACY_DRAIN_BUDGET },
    },
    (e) => {
      if (e.ownerSub !== who.id) return;
      if ((e.board || "") === board && (e.klass || "") === klass && (e.subject || "") === subject) {
        found = e.rowKey;
        return false;
      }
    }
  );
  if (found) return found;
  const id = `${slugify(`${board}${klass}${subject}`)}-${crypto.randomBytes(3).toString("hex")}`;
  const entity = {
    partitionKey: who.id,
    rowKey: id,
    board,
    klass,
    subject,
    title: subjectTitle(board, klass, subject),
    ownerSub: who.id,
    ownerEmail: who.email || "",
    collaborators: "[]",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await subjects.createEntity(entity);
  return id;
}

handlers.tests = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });

  const tests = tableClient("tests");
  await ensureTable(tests);
  const isStaff = who.role === "teacher" || who.role === "admin";

  // The partitions a member of staff may hold a test in: their own work, and
  // the library. It is exactly the set canManageTest() admits — an admin may
  // manage a master or their own test, a teacher only their own — so naming
  // the partition can never reach a row the old code would have refused.
  // A student's partition is their teacher's, and is resolved below, after the
  // parent-as-child case has settled whose teacher that is.
  const staffPartitions = isStaff ? [who.id, PLATFORM_PK] : [];

  if (req.method === "POST") {
    if (!isStaff) return json(context, 403, { error: "Teachers only" });
    const body = getBody(req);
    const action = body.action || "create";

    if (["publish", "unpublish", "archive", "delete"].includes(action)) {
      const id = String(body.id || "").trim();
      const entity = await readByPartitions(tests, staffPartitions, id, LEGACY_TEST_PK);
      if (!entity) return json(context, 404, { error: "Test not found" });
      if (!canManageTest(who, entity)) return json(context, 403, { error: "Not your test" });
      if (action === "delete") {
        if (entity.status !== "draft") return json(context, 400, { error: "Only drafts can be deleted — archive instead" });
        // The row's own partition, not a constant: a delete that named the
        // wrong one would answer ok and leave the test standing.
        await tests.deleteEntity(entity.partitionKey, id);
        return json(context, 200, { ok: true });
      }
      if (action === "publish") {
        // Students must never meet a half-written question, so the strict pass
        // runs against what is actually stored — not against what a client says.
        const ready = validateQuestions(unchunkQuestions(entity), { strict: true });
        if (ready.error) {
          return json(context, 400, { error: ready.error, problems: ready.problems || [] });
        }
        // Publishing replaces the row a student is reading. Someone part-way
        // through would have the paper changed under them mid-test.
        if (await hasAttemptInProgress(entity)) {
          return json(context, 409, {
            error: "A student is part-way through this test — publishing would change it under them. Try again once they have finished.",
          });
        }
      }
      entity.status = action === "publish" ? "published" : action === "archive" ? "archived" : "draft";
      entity.updatedAt = new Date().toISOString();
      await saveRow(tests, LEGACY_TEST_PK, entity);
      return json(context, 200, { ok: true, status: entity.status });
    }

    if (action === "assign") {
      const id = String(body.id || "").trim();
      const entity = await readByPartitions(tests, staffPartitions, id, LEGACY_TEST_PK);
      if (!entity) return json(context, 404, { error: "Test not found" });
      if (!canManageTest(who, entity)) return json(context, 403, { error: "Not your test" });

      const audience = body.audience === "selected" ? "selected" : "class";
      let usernames = [];
      if (audience === "selected") {
        usernames = Array.isArray(body.usernames)
          ? [...new Set(body.usernames.map((u) => String(u || "").trim().toLowerCase()).filter(Boolean))].slice(0, 500)
          : [];
        if (!usernames.length) {
          return json(context, 400, { error: "Pick at least one student, or share it with everyone you teach" });
        }
        // Never take the client's word for whose student this is.
        for (const username of usernames) {
          const reason = await canSeeStudent(who, username);
          if (reason) return refuse(context, reason);
        }
      }
      entity.audience = audience;
      entity.assignedTo = JSON.stringify(usernames);
      entity.updatedAt = new Date().toISOString();
      await saveRow(tests, LEGACY_TEST_PK, entity, "Merge");
      return json(context, 200, { ok: true, audience, assignedCount: usernames.length });
    }

    // A teacher takes their own copy of a published master ("built-in") test.
    // The master itself is never edited by them — this is a fork, not a share.
    if (action === "adopt") {
      // One or many. A teacher building a subject from the library picks
      // several chapters at once, and that must be ONE round trip rather than
      // one per chapter (rule 3: nothing awaited in a loop).
      const ids = Array.isArray(body.ids)
        ? body.ids.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 50)
        : [String(body.id || "").trim()].filter(Boolean);
      if (!ids.length) return json(context, 400, { error: "Nothing to copy" });

      // Where the copies are filed. A caller may name one of their OWN
      // subjects; anything else falls back to the subject-per-taxonomy rule,
      // so a teacher cannot drop copies into somebody else's subject.
      let intoSubject = "";
      const wantSubject = String(body.subjectId || "").trim();
      if (wantSubject) {
        const subjects = tableClient("subjects");
        await ensureTable(subjects);
        // The caller's own partition only. A subject that is not theirs is not
        // in it, so the 403 below is now reached without ever reading the row —
        // the partition key enforces the rule the check states.
        const row = await readByPartitions(subjects, [who.id], wantSubject, LEGACY_SUBJECT_PK);
        if (row && row.ownerSub === who.id && !row.platform) intoSubject = row.rowKey;
        if (!intoSubject) return json(context, 403, { error: "Not your subject" });
      }

      // The library is where the money is: a shelf you own copies freely, and
      // anything else spends the free allowance. The gate runs before any
      // master is read, and counts what the caller already took — copies carry
      // `copiedFrom`, which is exactly "came from the library".
      const ent = await entitlements(who);
      if (!ent.exempt && ent.shelfTests > 0) {
        // Which shelf is being taken from decides whether it is already paid
        // for. A mixed request is judged by its first master's shelf, which is
        // the only case the UI can produce — the + and New subject both copy
        // from one shelf at a time.
        let shelfId = "";
        try {
          const first = await tests.getEntity("test", ids[0]);
          shelfId = String(first.subjectId || "");
        } catch {}
        if (!(await ownsShelf(who.id, shelfId))) {
          const taken = await adoptedCount(tests, who.id, ent.shelfTests);
          if (taken + ids.length > ent.shelfTests) {
            return json(context, 402, {
              error:
                `Your plan includes ${ent.shelfTests} ready-made tests and you have taken ${taken}. ` +
                `The whole subject is ${rupees(ent.rules.subjectPaise)}, with every test in it.`,
              limit: ent.shelfTests,
              used: taken,
              subjectPaise: ent.rules.subjectPaise,
              shelfId,
            });
          }
        }
      }

      const copies = [];
      const failed = [];
      await inBatches(ids, 10, async (id) => {
        // A master is always in the library's partition, so this is one point
        // read rather than a search — and a teacher naming their own test's id
        // here cannot reach it, which the platform check below wanted anyway.
        const master = await readByPartitions(tests, [PLATFORM_PK], id, LEGACY_TEST_PK);
        if (!master) {
          failed.push(id);
          return;
        }
        if (!master.platform || master.status !== "published") {
          failed.push(id);
          return;
        }
        const questions = unchunkQuestions(master);
        const copyId = `${slugify(master.title || "test")}-${crypto.randomBytes(3).toString("hex")}`.slice(0, 60);
        const entity = {
          // The copy belongs to the teacher who took it, so it lands in their
          // partition and never in the library's.
          partitionKey: who.id,
          rowKey: copyId,
          title: String(master.title || "Test").slice(0, 120),
          chapter: String(master.chapter || "").slice(0, 60),
          teacher: String(master.teacher || "").slice(0, 60),
          order: typeof master.order === "number" ? master.order : 99,
          access: master.access === "open" ? "open" : "login",
          status: "draft",
          platform: false,
          audience: "class",
          assignedTo: "[]",
          ownerSub: who.id,
          ownerEmail: who.email || "",
          board: master.board || "CBSE",
          klass: master.klass || "12",
          subject: master.subject || "Maths",
          subjectId: intoSubject || (await subjectForAdopter(who, master)),
          copiedFrom: id,
          forkedFromId: id,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        chunkQuestions(entity, questions);
        await tests.createEntity(entity);
        copies.push(testMeta(entity));
      });

      if (!copies.length) return json(context, 404, { error: "No built-in test was copied" });
      // `test` stays for the single-copy callers that predate `ids`.
      return json(context, 201, { test: copies[0], tests: copies, failed });
    }

    if (action === "seedSamples") {
      // A teacher's first visit gets the bundled tests copied in as their own
      // editable drafts to learn from. Once only: deleting them is final.
      const state = tableClient("teacherstate");
      await ensureTable(state);
      let seeded = null;
      try {
        seeded = await state.getEntity("state", who.id);
      } catch {}
      if (seeded && seeded.samplesSeededAt) {
        return json(context, 200, { ok: true, seeded: 0, alreadySeeded: true });
      }
      const samples = Array.isArray(body.tests) ? body.tests.slice(0, 5) : [];
      // Optional: file the samples under a subject the teacher already owns.
      // Without it they are written orphaned and the subjects GET adopts them.
      const seedSubject = String(body.subjectId || "").slice(0, 80);
      const created = [];
      for (const sample of samples) {
        const checked = validateQuestions(sample.questions);
        if (checked.error) continue;
        const id = `sample-${slugify(sample.title || "test")}-${crypto.randomBytes(3).toString("hex")}`;
        const entity = {
          partitionKey: who.id,
          rowKey: id,
          title: String(sample.title || "Sample test").slice(0, 120),
          chapter: String(sample.chapter || "").slice(0, 60),
          teacher: "",
          order: 99,
          access: "login",
          status: "draft",
          platform: false,
          sample: true,
          ownerSub: who.id,
          ownerEmail: who.email || "",
          board: "CBSE",
          klass: "12",
          subject: "Maths",
          subjectId: seedSubject,
        forkedFromId: String(sample.id || "").slice(0, 60),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        chunkQuestions(entity, checked.questions);
        try {
          await tests.createEntity(entity);
          created.push(testMeta(entity));
        } catch {}
      }
      await state.upsertEntity(
        { partitionKey: "state", rowKey: who.id, samplesSeededAt: new Date().toISOString() },
        "Merge"
      );
      return json(context, 201, { ok: true, seeded: created.length, tests: created });
    }

    if (action !== "create" && action !== "update") {
      return json(context, 400, { error: `Unknown action: ${action}` });
    }
    const t = body.test || {};
    const title = String(t.title || "").trim().slice(0, 120);
    if (!title) return json(context, 400, { error: "Title required" });
    const checked = validateQuestions(t.questions);
    if (checked.error) {
      return json(context, 400, { error: checked.error, problems: checked.problems || [] });
    }

    if (action === "create") {
      const ent = await entitlements(who);
      if (ent.tests > 0) {
        const have = await ownedCount(tests, who.id, LEGACY_TEST_PK, ent.tests);
        if (have >= ent.tests) {
          return overLimit(
            context,
            "tests",
            have,
            ent.tests,
            `The ${rupees(ent.rules.teacherMonthlyPaise)}/month plan lifts this.`
          );
        }
      }
      // Decided before the row is built, because it decides the partition.
      const isPlatform = !!t.platform && who.role === "admin";
      let id = String(t.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
      if (!id) id = `${slugify(title)}-${crypto.randomBytes(3).toString("hex")}`;
      // A test id is now unique PER OWNER rather than across the platform:
      // uniqueness in Table Storage is (partition, row), and the partition is
      // the owner. That is the right scope, because it is also the scope a link
      // resolves in — a student following `?test=<id>` is only ever shown their
      // own teacher's test, and readByPartitions tries the caller's own
      // partition before the library, so a teacher's id always beats a master's
      // for that teacher. The generated suffix went from 900 values to 16.7
      // million in the same change, since a collision is no longer refused by a
      // platform-wide check that no longer exists.
      const clash = await readByPartitions(tests, isPlatform ? [PLATFORM_PK] : [who.id], id, LEGACY_TEST_PK);
      if (clash) return json(context, 409, { error: `Test id already exists: ${id}` });
      const entity = {
        partitionKey: isPlatform ? PLATFORM_PK : who.id,
        rowKey: id,
        title,
        chapter: String(t.chapter || "").slice(0, 60),
        teacher: String(t.teacher || "").slice(0, 60),
        order: Number.isFinite(Number(t.order)) ? Number(t.order) : 99,
        access: t.access === "open" ? "open" : "login",
        status: "draft",
        platform: isPlatform,
        ownerSub: who.id,
        ownerEmail: who.email || "",
        subjectId: String(t.subjectId || "").slice(0, 80),
        board: "CBSE",
        klass: "12",
        subject: "Maths",
        forkedFromId: String(t.forkedFromId || "").slice(0, 60),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      // Stamp the taxonomy from the subject so a test always knows its context.
      if (entity.subjectId) {
        const subjects = tableClient("subjects");
        await ensureTable(subjects);
        // Their own subject, or a library shelf when an admin is authoring a
        // master into one.
        const sub = await readByPartitions(
          subjects,
          [who.id, PLATFORM_PK],
          entity.subjectId,
          LEGACY_SUBJECT_PK
        );
        if (sub) {
          entity.board = sub.board || entity.board;
          entity.klass = sub.klass || entity.klass;
          entity.subject = sub.subject || entity.subject;
        }
      }
      chunkQuestions(entity, checked.questions);
      await tests.createEntity(entity);
      return json(context, 201, { test: testMeta(entity) });
    }

    // update
    const id = String(t.id || "").trim();
    const entity = await readByPartitions(tests, staffPartitions, id, LEGACY_TEST_PK);
    if (!entity) return json(context, 404, { error: "Test not found" });
    if (!canManageTest(who, entity)) return json(context, 403, { error: "Not your test" });
    // Clear old chunks before writing new ones (Replace drops absent props).
    for (let i = 0; i < (entity.chunkCount || 0); i++) delete entity[`qc${i}`];
    entity.title = title;
    entity.chapter = String(t.chapter || "").slice(0, 60);
    entity.teacher = String(t.teacher || "").slice(0, 60);
    if (Number.isFinite(Number(t.order))) entity.order = Number(t.order);
    if (t.access) entity.access = t.access === "open" ? "open" : "login";
    entity.updatedAt = new Date().toISOString();
    chunkQuestions(entity, checked.questions);
    await saveRow(tests, LEGACY_TEST_PK, entity);
    return json(context, 200, { test: testMeta(entity) });
  }

  // GET ?id=... → full test (if visible), GET → metadata list.
  const wantedId = String((req.query && req.query.id) || "").trim();
  // identify() resolved the student's teacher when it verified the account.
  let teacherSub = who.kind === "student" ? who.teacherSub || "" : "";

  // A parent sees exactly what their linked child sees. The link row decides
  // whose teacher that is — never a username the client sent.
  const wantedChild = String((req.query && req.query.student) || "").trim().toLowerCase();
  let asChild = false;
  if (wantedChild) {
    const link = await childLink(who, wantedChild);
    if (!link) return json(context, 403, { error: "Not your child" });
    teacherSub = link.teacherSub;
    asChild = true;
  }

  // A parent reads as their child, so assignment is checked against the child's
  // username, not the parent's.
  const asUsername = asChild ? wantedChild : who.username || "";

  function visible(e) {
    if (isStaff && !asChild) return canManageTest(who, e) || (e.platform && e.status === "published");
    if (e.status !== "published") return false;
    // A master (platform) test reaches no student directly: a student only ever
    // sees their own teacher's copy of it, made with the "adopt" action.
    if (e.platform) return false;
    if (!((who.kind === "student" || asChild) && !!teacherSub && e.ownerSub === teacherSub)) return false;
    // Assigned to named students only: everyone else is not in this class.
    return assignedTo(e, asUsername);
  }

  // The partitions this caller could possibly hold a VISIBLE test in — the
  // mirror image of visible() above, clause for clause. Staff: their own work
  // and the library. A student, or a parent reading as their child: that
  // child's teacher and nobody else, because a master reaches no student
  // directly and another teacher's class is not theirs.
  const readPartitions = isStaff && !asChild ? staffPartitions : [teacherSub];

  if (wantedId) {
    const entity = await readByPartitions(tests, readPartitions, wantedId, LEGACY_TEST_PK);
    if (!entity) return json(context, 404, { error: "Test not found" });
    if (!visible(entity)) return json(context, 403, { error: "Not available" });
    const full = testFull(entity);
    // The class list is the teacher's business — a student never receives it.
    return json(context, 200, { test: isStaff && !asChild ? { ...full, assignedTo: assignedList(entity) } : full });
  }

  // The library: every published master, for a teacher to take a copy of.
  if (String((req.query && req.query.library) || "") === "1") {
    if (!isStaff) return json(context, 403, { error: "Teachers only" });
    const onlySubject = String((req.query && req.query.subjectId) || "").trim();
    const masters = [];
    const mine = new Set();
    const budget = { left: COUNT_BACKFILL_BUDGET };
    const drain = { left: LEGACY_DRAIN_BUDGET };
    // Two partitions, not the platform: the library, and the caller's own work
    // so "have I already taken a copy of this" can be answered without a
    // second pass. The body below is unchanged — only what it walks is.
    await walkPartitions(
      tests,
      {
        partitions: [PLATFORM_PK, who.id],
        select: TEST_META_SELECT,
        legacyPk: LEGACY_TEST_PK,
        budget: drain,
      },
      async (e) => {
        if (e.platform && e.status === "published") {
          if (!onlySubject || (e.subjectId || "") === onlySubject) {
            masters.push(testMeta(await backfillCounts(tests, e, budget)));
          }
        } else if (e.ownerSub === who.id && e.copiedFrom) mine.add(e.copiedFrom);
      }
    );
    for (const m of masters) m.adopted = mine.has(m.id);
    masters.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    return json(context, 200, { tests: masters });
  }

  const wantedSubject = String((req.query && req.query.subjectId) || "").trim();

  // Whether this listing walks the library at all.
  //
  // A master is the library's, not the caller's work, and every client asking
  // for this listing unscoped already throws them away: the editor filters
  // `!t.platform`, My tests filters `!t.platform || isAdmin()`. Sending them
  // cost every teacher 125 rows and 65 KB on every render, in order to discard
  // them — measured on production after the re-partition, which is what
  // exposed it.
  //
  // This is deliberately **not** a change to visible(). That predicate also
  // gates `?id=`, which is how Browse lets a teacher read a master before
  // taking a copy of it, so narrowing it would 403 the one screen the library
  // exists for. Not reading a row is strictly better than reading it and
  // filtering it away, so the fix belongs here and visible() is untouched.
  //
  // The library is still walked when the caller is actually looking at it.
  let wantsMasters = String((req.query && req.query.platform) || "") === "1";
  if (!wantsMasters && wantedSubject && isStaff && !asChild) {
    // One point read decides it: a shelf's tests live in the library's
    // partition, an ordinary subject's in its owner's. Without this a teacher
    // opening their OWN subject — which is what the editor always does — still
    // walked every master to throw it away.
    const subjects = tableClient("subjects");
    await ensureTable(subjects);
    const sub = await readByPartitions(
      subjects,
      [who.id, PLATFORM_PK],
      wantedSubject,
      LEGACY_SUBJECT_PK
    );
    wantsMasters = !!(sub && sub.platform);
  }
  // The caller's own partition is walked either way, so `ownedCount` — and the
  // `needsSamples` that hangs off it — still counts what it always counted.
  const listPartitions =
    isStaff && !asChild
      ? wantsMasters
        ? [who.id, PLATFORM_PK]
        : [who.id]
      : readPartitions;

  const list = [];
  let ownedCount = 0;
  const budget = { left: COUNT_BACKFILL_BUDGET };
  const drain = { left: LEGACY_DRAIN_BUDGET };
  await walkPartitions(
    tests,
    {
      partitions: listPartitions,
      select: TEST_META_SELECT,
      legacyPk: LEGACY_TEST_PK,
      budget: drain,
    },
    async (row) => {
      if (isStaff && row.ownerSub === who.id) ownedCount++;
      // The partition list above already keeps the library out, but the legacy
      // partition is walked whatever it holds, so an undrained master could
      // still arrive here and visible() would admit it. Without this the
      // response would carry masters or not depending on how far the migration
      // had got — a "sometimes" is worse than either answer.
      if (row.platform && !wantsMasters) return;
      if (wantedSubject && (row.subjectId || "") !== wantedSubject) return;
      if (!visible(row)) return;
      const e = await backfillCounts(tests, row, budget);
      list.push(isStaff && !asChild ? testMetaForStaff(e) : testMeta(e));
      if (list.length >= 200) return false;
    }
  );
  list.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));

  // A teacher with nothing of their own gets the bundled tests copied in as
  // starting samples — but only the first time, so deleting them sticks.
  let needsSamples = false;
  if (isStaff && ownedCount === 0) {
    try {
      const seeded = await tableClient("teacherstate").getEntity("state", who.id);
      needsSamples = !seeded.samplesSeededAt;
    } catch {
      needsSamples = true;
    }
  }
  json(context, 200, { tests: list, needsSamples });
};

// ---------- Subjects (a board + class + subject that owns tests) ----------
//
// Teacher-owned, with a collaborators list carried from day one so a subject
// can be shared later without a migration. Table "subjects": PK = the owner
// (the library's shelves live in PLATFORM_PK), RK = subject id — see the note
// on the tests table above for why the constant partition key had to go.

function subjectTitle(board, klass, subject) {
  return [board, klass ? `Class ${klass}` : "", subject].filter(Boolean).join(" ");
}

function subjectOut(e) {
  let collaborators = [];
  try {
    collaborators = JSON.parse(e.collaborators || "[]");
  } catch {}
  return {
    id: e.rowKey,
    board: e.board || "",
    klass: e.klass || "",
    subject: e.subject || "",
    title: e.title || subjectTitle(e.board, e.klass, e.subject),
    platform: !!e.platform,
    ownerSub: e.ownerSub || "",
    collaborators,
    createdAt: e.createdAt,
  };
}

function canUseSubject(who, e) {
  if (e.ownerSub === who.id) return true;
  let collaborators = [];
  try {
    collaborators = JSON.parse(e.collaborators || "[]");
  } catch {}
  const email = String(who.email || "").toLowerCase();
  return !!email && collaborators.includes(email);
}

/** Every subject this teacher owns or collaborates on. */
async function listOwnedSubjects(who) {
  const subjects = tableClient("subjects");
  await ensureTable(subjects);
  const out = [];
  // Their own partition and the library's. A COLLABORATOR's subject is the one
  // thing this no longer finds, and it never actually could: nothing writes to
  // `collaborators` yet, so the field has only ever held "[]". When sharing
  // arrives it needs an index of subject-ids per collaborator email — which is
  // the same shape as any other "find me rows I do not own", and the reason to
  // build it deliberately rather than to keep a platform-wide scan alive for a
  // feature that does not exist.
  await walkPartitions(
    subjects,
    {
      partitions: [who.id, PLATFORM_PK],
      select: SUBJECT_SELECT,
      legacyPk: LEGACY_SUBJECT_PK,
      budget: { left: LEGACY_DRAIN_BUDGET },
    },
    (e) => {
      // A platform subject is the library shelf: every teacher sees it, nobody
      // but an admin owns it. Students never reach here.
      if (e.platform || canUseSubject(who, e)) out.push(e);
      if (out.length >= 200) return false;
    }
  );
  return out;
}

handlers.subjects = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  const isStaff = who.role === "teacher" || who.role === "admin";

  const subjects = tableClient("subjects");
  await ensureTable(subjects);
  const tests = tableClient("tests");
  await ensureTable(tests);

  if (req.method === "POST") {
    if (!isStaff) return json(context, 403, { error: "Teachers only" });
    const body = getBody(req);
    const action = body.action || "create";
    const board = String(body.board || "").trim().slice(0, 40);
    const klass = String(body.klass || "").trim().slice(0, 20);
    const subject = String(body.subject || "").trim().slice(0, 40);

    if (action === "create") {
      if (!board || !klass || !subject) {
        return json(context, 400, { error: "Board, class and subject are all required" });
      }
      // The gate runs before the row is built, and fails closed: a limit that
      // cannot be read must not become an unlimited one.
      const ent = await entitlements(who);
      if (ent.subjects > 0) {
        const have = await ownedCount(subjects, who.id, LEGACY_SUBJECT_PK, ent.subjects);
        if (have >= ent.subjects) {
          return overLimit(
            context,
            "subjects",
            have,
            ent.subjects,
            ent.plan === "parent"
              ? "A parent account holds one subject."
              : `The ${rupees(ent.rules.teacherMonthlyPaise)}/month plan lifts this.`
          );
        }
      }
      const slug = slugify(`${board}${klass}${subject}`);
      const id = `${slug}-${crypto.randomBytes(3).toString("hex")}`;
      const isPlatform = !!body.platform && who.role === "admin";
      const entity = {
        // A shelf belongs to the library, everything else to whoever made it.
        partitionKey: isPlatform ? PLATFORM_PK : who.id,
        rowKey: id,
        board,
        klass,
        subject,
        title: subjectTitle(board, klass, subject),
        platform: isPlatform,
        ownerSub: who.id,
        ownerEmail: who.email || "",
        collaborators: "[]",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      await subjects.createEntity(entity);
      return json(context, 201, { subject: subjectOut(entity) });
    }

    const id = String(body.id || "").trim();
    // Their own, or a library shelf — which is exactly what mayManage below
    // allows, so no subject the old code refused becomes reachable here.
    const entity = await readByPartitions(
      subjects,
      [who.id, PLATFORM_PK],
      id,
      LEGACY_SUBJECT_PK
    );
    if (!entity) return json(context, 404, { error: "Subject not found" });
    // Same rule as canManageTest: the library shelf is the admins' to curate.
    const mayManage = entity.platform ? who.role === "admin" : entity.ownerSub === who.id;
    if (!mayManage) return json(context, 403, { error: "Not your subject" });

    if (action === "update") {
      if (board) entity.board = board;
      if (klass) entity.klass = klass;
      if (subject) entity.subject = subject;
      entity.title = subjectTitle(entity.board, entity.klass, entity.subject);
      entity.updatedAt = new Date().toISOString();
      await saveRow(subjects, LEGACY_SUBJECT_PK, entity);
      return json(context, 200, { subject: subjectOut(entity) });
    }

    if (action === "delete") {
      // Refuse while tests still point at it — deleting would orphan them.
      let used = 0;
      // A subject's tests live where the subject does: a teacher's under the
      // teacher, a shelf's masters under the library. ownerPartition() of the
      // subject row therefore names exactly the partition worth asking.
      await walkPartitions(
        tests,
        {
          partitions: [ownerPartition(entity)],
          select: ["PartitionKey", "RowKey", "subjectId"],
          legacyPk: LEGACY_TEST_PK,
          budget: { left: LEGACY_DRAIN_BUDGET },
        },
        (t) => {
          if ((t.subjectId || "") !== id) return;
          used++;
          return false;
        }
      );
      if (used) {
        return json(context, 400, { error: "Move or delete this subject's tests before removing it" });
      }
      await subjects.deleteEntity(entity.partitionKey, id);
      return json(context, 200, { ok: true });
    }

    return json(context, 400, { error: `Unknown action: ${action}` });
  }

  // GET
  if (isStaff) {
    let owned = await listOwnedSubjects(who);

    // A teacher who has tests but no subject yet gets a default one, and their
    // tests are filed under it — otherwise the grid would look empty while
    // their work sits unreachable.
    if (!owned.length) {
      const orphans = [];
      await walkPartitions(
        tests,
        {
          partitions: [who.id],
          select: ["PartitionKey", "RowKey", "subjectId", "ownerSub"],
          legacyPk: LEGACY_TEST_PK,
          budget: { left: LEGACY_DRAIN_BUDGET },
        },
        (t) => {
          if (t.ownerSub === who.id && !t.subjectId) orphans.push(t);
        }
      );
      if (orphans.length) {
        const id = `cbse12maths-${crypto.randomBytes(3).toString("hex")}`;
        const entity = {
          partitionKey: who.id,
          rowKey: id,
          board: "CBSE",
          klass: "12",
          subject: "Maths",
          title: subjectTitle("CBSE", "12", "Maths"),
          ownerSub: who.id,
          ownerEmail: who.email || "",
          collaborators: "[]",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
        await subjects.createEntity(entity);
        for (const t of orphans) {
          // A projected row carries no etag, so name the keys explicitly and
          // merge only the one property this is actually setting.
          await tests.updateEntity(
            { partitionKey: t.partitionKey, rowKey: t.rowKey, subjectId: id },
            "Merge"
          );
        }
        owned = [entity];
      }
    }

    const list = owned.map(subjectOut);
    // How many tests sit in each, for the card.
    const counts = {};
    // Only the subjects in `list` are ever looked up in `counts`, and those are
    // the caller's own plus the library's shelves — so those two partitions
    // answer the whole question.
    await walkPartitions(
      tests,
      {
        partitions: [who.id, PLATFORM_PK],
        select: ["PartitionKey", "RowKey", "subjectId"],
        legacyPk: LEGACY_TEST_PK,
        budget: { left: LEGACY_DRAIN_BUDGET },
      },
      (t) => {
        if (t.subjectId) counts[t.subjectId] = (counts[t.subjectId] || 0) + 1;
      }
    );
    for (const s of list) s.testCount = counts[s.id] || 0;
    list.sort((a, b) => a.title.localeCompare(b.title));
    return json(context, 200, { subjects: list });
  }

  // Students see the subjects their visible published tests belong to.
  const wanted = new Set();
  const teacherSub = who.kind === "student" ? who.teacherSub || "" : "";
  // Only a student reaches here with a teacher, and the loop below admits
  // nothing without one, so asking at all would be pure waste.
  if (!teacherSub) return json(context, 200, { subjects: [] });
  // A student only ever sees their own teacher's published tests, and that is
  // now the partition rather than a property filtered out of the whole table.
  await walkPartitions(
    tests,
    {
      partitions: [teacherSub],
      select: ["PartitionKey", "RowKey", "status", "subjectId", "platform", "ownerSub", "audience", "assignedTo"],
      legacyPk: LEGACY_TEST_PK,
      budget: { left: LEGACY_DRAIN_BUDGET },
    },
    (t) => {
      if (t.status !== "published" || !t.subjectId) return;
      // A subject the student has no test in is not their subject — assignment
      // included, or a narrowed test would still light up its subject card.
      if (t.platform) return; // masters belong to the library, not to a class
      if (t.ownerSub === teacherSub && assignedTo(t, who.username)) {
        wanted.add(t.subjectId);
      }
    }
  );
  const list = [];
  // The subject of a test owned by this teacher is owned by them too, so it is
  // a point read in their partition — never a search.
  await inBatches([...wanted], 20, async (id) => {
    const row = await readByPartitions(subjects, [teacherSub], id, LEGACY_SUBJECT_PK);
    if (row) list.push(subjectOut(row));
  });
  list.sort((a, b) => a.title.localeCompare(b.title));
  json(context, 200, { subjects: list });
};


// ---------- Parent <-> student links ----------

// No look-alike characters (no I, L, O, 0, 1): a parent reads this off
// WhatsApp and types it in. 31^8 is far too large to guess, and there is no
// endpoint that enumerates codes.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const INVITE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function newInviteCode() {
  let out = "";
  for (let i = 0; i < 8; i++) out += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
  return out;
}

/** Case and stray spaces/dashes only — never a lossy substitution, which
 *  could turn a valid code into one that cannot be found. */
function normaliseCode(input) {
  return String(input || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 12);
}

/** The children this account may see. Every parent read joins through these,
 *  never through a student id the client supplied. */
async function linkedChildren(who) {
  const links = tableClient("parentlinks");
  await ensureTable(links);
  const out = [];
  try {
    const iter = links.listEntities({
      queryOptions: {
        filter: `PartitionKey eq 'parent~${who.id.replace(/'/g, "''")}'`,
        select: ["PartitionKey", "RowKey", "studentName", "teacherSub", "linkedAt"],
      },
    });
    for await (const e of iter) {
      out.push({
        username: e.rowKey,
        name: e.studentName || e.rowKey,
        teacherSub: e.teacherSub || "",
        linkedAt: e.linkedAt || "",
      });
      if (out.length >= 20) break;
    }
  } catch {}
  out.sort((a, b) => a.name.localeCompare(b.name));
  return out;
}

/** The link row, or null. The gate on every parent read. */
async function childLink(who, username) {
  if (who.kind !== "google") return null;
  const links = tableClient("parentlinks");
  await ensureTable(links);
  try {
    const e = await links.getEntity(`parent~${who.id}`, String(username || "").trim().toLowerCase());
    return { username: e.rowKey, name: e.studentName || e.rowKey, teacherSub: e.teacherSub || "" };
  } catch {
    return null;
  }
}

handlers.parentlink = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });

  const invites = tableClient("invites");
  await ensureTable(invites);

  if (req.method === "POST") {
    const body = getBody(req) || {};
    const action = body.action || "redeem";

    // A teacher mints a code for one of their own students.
    if (action === "invite") {
      if (who.role !== "teacher" && who.role !== "admin") {
        return json(context, 403, { error: "Teachers only" });
      }
      const username = String(body.username || "").trim().toLowerCase();
      const students = tableClient("students");
      await ensureTable(students);
      let student;
      try {
        student = await students.getEntity("student", username);
      } catch {
        return json(context, 404, { error: "Student not found" });
      }
      if (student.teacherSub !== who.id) {
        return json(context, 403, { error: "Not your student" });
      }
      const now = Date.now();
      const row = {
        partitionKey: "invite",
        rowKey: "",
        studentUsername: username,
        studentName: student.name || username,
        teacherSub: who.id,
        createdAt: new Date(now).toISOString(),
        // A code is a key to this child's results. Unused, it stops working.
        expiresAt: new Date(now + INVITE_TTL_MS).toISOString(),
        usedAt: "",
        usedBySub: "",
      };
      // Retry once: a collision is vanishingly unlikely but would otherwise
      // surface to the teacher as an unexplained failure.
      let code = "";
      for (let attempt = 0; attempt < 2 && !code; attempt++) {
        const candidate = newInviteCode();
        try {
          await invites.createEntity({ ...row, rowKey: candidate });
          code = candidate;
        } catch (e) {
          if (e.statusCode !== 409) throw e;
        }
      }
      if (!code) return json(context, 500, { error: "Could not create an invite — try again" });
      return json(context, 201, { ok: true, code });
    }

    // A parent redeems one. Single use, and the row's etag makes that atomic:
    // with two parents racing the same code only the first write lands.
    if (action === "redeem") {
      if (who.kind !== "google") {
        return json(context, 403, { error: "Sign in with Google to link a child" });
      }
      const code = normaliseCode(body.code);
      if (code.length < 6) return json(context, 400, { error: "That code does not look right" });
      // 31^8 is far too large to walk, but an unthrottled guess loop is still
      // free traffic against a consumption plan. The bucket is the caller's,
      // not the code's: locking a code would let anyone shut out a real parent.
      const gate = await loginGate(req, `invite~${who.id}`);
      if (gate.lockMs > 0) return tooManyAttempts(context, gate.lockMs);
      let invite;
      try {
        invite = await invites.getEntity("invite", code);
      } catch {
        await noteLoginFailure(gate);
        return json(context, 404, { error: "No such code - check it and try again" });
      }
      if (invite.expiresAt && Date.parse(invite.expiresAt) < Date.now()) {
        return json(context, 410, { error: "That code has expired — ask for a new one" });
      }
      if (invite.usedAt) {
        // Redeemed by this same parent already? Then it is not an error.
        if (invite.usedBySub === who.id) {
          return json(context, 200, { ok: true, alreadyLinked: true, child: invite.studentName });
        }
        return json(context, 409, { error: "That code has already been used" });
      }
      invite.usedAt = new Date().toISOString();
      invite.usedBySub = who.id;
      try {
        await invites.updateEntity(invite, "Replace", { etag: invite.etag });
      } catch {
        return json(context, 409, { error: "That code has already been used" });
      }
      const links = tableClient("parentlinks");
      await ensureTable(links);
      await links.upsertEntity(
        {
          partitionKey: `parent~${who.id}`,
          rowKey: invite.studentUsername,
          studentName: invite.studentName || invite.studentUsername,
          teacherSub: invite.teacherSub || "",
          linkedAt: new Date().toISOString(),
        },
        "Replace"
      );
      return json(context, 201, { ok: true, child: invite.studentName || invite.studentUsername });
    }

    return json(context, 400, { error: `Unknown action: ${action}` });
  }

  json(context, 200, { children: await linkedChildren(who) });
};

// In-progress rows share the attempts table under a stable key, so each save
// replaces the last rather than piling up.
const PROGRESS_PREFIX = "progress~";
// A teacher's extra attempt, parked in the student's own attempt partition so
// that counting the attempts and reading the grant are ONE walk rather than
// two round trips. `progress~` already established that namespace.
const GRANT_PREFIX = "grant~";

function isProgressRow(e) {
  return String(e.rowKey || "").startsWith(PROGRESS_PREFIX);
}

function parseAnswers(raw) {
  try {
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/**
 * Every attempts partition that could be holding a progress row for this test.
 *
 * Its audience, and — the one easy to forget — **the owner themselves**, who
 * can be sitting their own test to preview it. A teacher's or admin's progress
 * row lands under their own id, never under `stu~`, so a check that walked the
 * roster alone would let them publish the paper out from under their own
 * half-finished preview.
 */
async function attemptPartitionsFor(entity) {
  const owner = String(entity.ownerSub || "");
  const out = owner ? [owner] : [];
  if (audienceOf(entity) === "selected") {
    for (const username of assignedList(entity)) out.push(`stu~${username}`);
    return out;
  }
  const students = tableClient("students");
  await ensureTable(students);
  const iter = students.listEntities({
    queryOptions: {
      filter: `PartitionKey eq 'student' and teacherSub eq '${owner.replace(/'/g, "''")}'`,
      select: ["PartitionKey", "RowKey"],
    },
  });
  for await (const e of iter) {
    out.push(`stu~${e.rowKey}`);
    if (out.length >= 501) break;
  }
  return out;
}

/**
 * Is anyone part-way through this test right now?
 *
 * The attempts table is partitioned per student, so asking by RowKey alone
 * meant a scan of every attempt ever written, by anybody, growing forever. Only
 * only this test's audience and its owner can be sitting it, and their progress
 * row has a known key — so this is a handful of point reads instead, run a few
 * at a time and abandoned the moment one answers yes.
 */
async function hasAttemptInProgress(entity) {
  const attempts = tableClient("attempts");
  await ensureTable(attempts);
  const rowKey = `${PROGRESS_PREFIX}${String(entity.rowKey).slice(0, 80)}`;
  try {
    const partitions = await attemptPartitionsFor(entity);
    for (let i = 0; i < partitions.length; i += 20) {
      const found = await Promise.all(
        partitions.slice(i, i + 20).map((partitionKey) =>
          attempts
            .getEntity(partitionKey, rowKey)
            .then(() => true)
            .catch(() => false)
        )
      );
      if (found.some(Boolean)) return true;
    }
  } catch {
    // A failed check must not block publishing.
  }
  return false;
}

/**
 * How many times this student has handed this test in, and how many extra
 * attempts their teacher has granted — in one walk of their own partition.
 *
 * **The attempt rows are the ledger.** This deliberately does not follow rule
 * 5's "stamp the count on write": a stamped counter can drift from the rows it
 * counts, and here the rows are what a teacher actually reads on the report,
 * so a disagreement would be a bug with two plausible answers. Counting them
 * cannot disagree with itself.
 *
 * Projected to `RowKey` alone — this asks how many, never what was answered.
 */
async function attemptTally(attempts, studentId, testId) {
  const safeId = String(studentId).replace(/'/g, "''");
  const safeTest = String(testId).replace(/'/g, "''");
  let used = 0;
  let extra = 0;
  const iter = attempts.listEntities({
    queryOptions: {
      filter: `PartitionKey eq '${safeId}' and testId eq '${safeTest}'`,
      select: ["RowKey", "testId", "extra"],
    },
  });
  for await (const row of iter) {
    const rk = String(row.rowKey || "");
    if (rk.startsWith(PROGRESS_PREFIX)) continue; // mid-paper, not a hand-in
    if (rk.startsWith(GRANT_PREFIX)) {
      extra += typeof row.extra === "number" ? row.extra : 0;
      continue;
    }
    used += 1;
  }
  return { used, extra };
}

/**
 * How many attempts this test allows, or 0 for unlimited.
 *
 * **`copiedFrom` is the whole test.** A row carrying it came from the built-in
 * library; a teacher's own test never does. That is why this needs no lineage
 * walk and no purchases read — the cap belongs to ready-made content however it
 * was obtained, so the shelf it descends from does not come into it.
 */
function attemptLimitFor(testRow, rules) {
  if (!testRow || !testRow.copiedFrom) return 0;
  const n = Number(rules.subjectAttempts);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

handlers.attempts = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });

  const attempts = tableClient("attempts");
  await ensureTable(attempts);

  if (req.method === "POST") {
    // A parent watches; they never write to their child's record, and their
    // own attempts would pollute the child's history.
    if (who.role === "parent") {
      return json(context, 403, { error: "Parent accounts cannot attempt tests" });
    }
    const body = getBody(req);
    if (!body || typeof body.testId !== "string") {
      return json(context, 400, { error: "Bad attempt payload" });
    }

    // Work in progress, saved after every answer. One row per (student, test),
    // upserted under a stable key, so a student who drops off mid-test — or
    // picks up a different device — loses nothing. Each write carries the WHOLE
    // answer map, so a dropped one is healed by the next answer.
    // A teacher hands back an attempt. The real case is a child whose
    // connection died mid-paper; without this every one of those becomes a
    // message to the person who runs the platform.
    if (body.action === "grant") {
      if (who.role !== "teacher" && who.role !== "admin") {
        return json(context, 403, { error: "Teachers only" });
      }
      const username = String(body.username || "").trim().toLowerCase();
      const refusal = await canSeeStudent(who, username);
      if (refusal) return refuse(context, refusal);
      const testId = String(body.testId || "").slice(0, 80);
      if (!testId) return json(context, 400, { error: "A test is needed" });
      const key = `${GRANT_PREFIX}${testId}`;
      let current = 0;
      try {
        const row = await attempts.getEntity(`stu~${username}`, key);
        current = typeof row.extra === "number" ? row.extra : 0;
      } catch {}
      await attempts.upsertEntity(
        {
          partitionKey: `stu~${username}`,
          rowKey: key,
          // `testId` matters: the tally filters on it, so a grant that did not
          // carry it would be invisible to the very walk that reads it.
          testId,
          extra: current + 1,
          grantedBy: who.id,
          grantedAt: new Date().toISOString(),
        },
        "Merge"
      );
      return json(context, 200, { ok: true, extra: current + 1 });
    }

    if (body.action === "progress") {
      if (typeof body.index !== "number") {
        return json(context, 400, { error: "Bad attempt payload" });
      }
      const blob =
        typeof body.answers === "string" && body.answers.length <= Q_CHUNK ? body.answers : "";
      await attempts.upsertEntity(
        {
          partitionKey: who.id,
          rowKey: `${PROGRESS_PREFIX}${body.testId.slice(0, 80)}`,
          testId: body.testId.slice(0, 80),
          answers: blob,
          index: Math.max(0, Math.min(1000, Math.round(body.index))),
          score: Math.max(0, Math.min(10000, Math.round(Number(body.score) || 0))),
          total: Math.max(0, Math.min(10000, Math.round(Number(body.total) || 0))),
          updatedAt: new Date().toISOString(),
          name: who.kind === "student" ? who.username : who.name,
          email: who.kind === "google" ? who.email : "",
          kind: who.kind,
        },
        "Replace"
      );
      return json(context, 200, { ok: true });
    }

    if (typeof body.score !== "number" || typeof body.total !== "number") {
      return json(context, 400, { error: "Bad attempt payload" });
    }
    const completedAt =
      typeof body.completedAt === "string"
        ? body.completedAt
        : new Date().toISOString();
    // The per-question answers, so review works on a device that never held
    // this attempt in localStorage. Oversized blobs are dropped rather than
    // failing the save — the score is what must never be lost.
    const answers =
      typeof body.answers === "string" && body.answers.length <= Q_CHUNK
        ? body.answers
        : "";
    // The cap, and only on a real student's hand-in. A teacher previewing
    // their own paper and a guest on the demo have nobody to be limited by —
    // `canHandIn()` draws the same line on the client.
    if (who.kind === "student") {
      const testId = body.testId.slice(0, 80);
      let testRow = null;
      try {
        // The student's own teacher's partition is the only one their test
        // can live in — the same set `visible()` allows them.
        const testsTbl = tableClient("tests");
        await ensureTable(testsTbl);
        testRow = await readByPartitions(
          testsTbl,
          [who.teacherSub || ""].filter(Boolean),
          testId,
          LEGACY_TEST_PK
        );
      } catch {
        testRow = null;
      }
      const limit = attemptLimitFor(testRow, await platformRules());
      if (limit > 0) {
        const tally = await attemptTally(attempts, who.id, testId);
        if (tally.used >= limit + tally.extra) {
          return json(context, 402, {
            error: `You have used all ${limit + tally.extra} attempts at this test. Your teacher can give you another.`,
            used: tally.used,
            limit: limit + tally.extra,
          });
        }
      }
    }

    // Inverted-time row key so newest attempts sort first in the table.
    const rowKey = `${String(9999999999999 - Date.now())}~${body.testId.slice(0, 80)}`;
    await attempts.createEntity({
      partitionKey: who.id,
      rowKey,
      testId: body.testId.slice(0, 80),
      score: Math.max(0, Math.min(10000, Math.round(body.score))),
      total: Math.max(0, Math.min(10000, Math.round(body.total))),
      completedAt,
      answers,
      name: who.kind === "student" ? who.username : who.name,
      email: who.kind === "google" ? who.email : "",
      kind: who.kind,
    });
    // The test is finished, so its in-progress row has nothing left to say.
    // Best effort: a leftover row is harmless because reads prefer the
    // completed one.
    try {
      await attempts.deleteEntity(who.id, `${PROGRESS_PREFIX}${body.testId.slice(0, 80)}`);
    } catch {}
    return json(context, 201, { ok: true });
  }

  // Someone may read another student's attempts instead of their own: a parent
  // for a linked child, a teacher for their own student, an admin for anyone.
  // canSeeStudent is the one place that decides, and it checks the row rather
  // than trusting the username the client sent.
  const wantedChild = String((req.query && req.query.student) || "").trim().toLowerCase();
  let readAs = who.id;
  if (wantedChild) {
    const reason = await canSeeStudent(who, wantedChild);
    if (reason) return refuse(context, reason);
    readAs = `stu~${wantedChild}`;
  }
  const partition = `PartitionKey eq '${readAs.replace(/'/g, "''")}'`;

  // ?testId= asks for one attempt in full. Row keys are an inverted timestamp,
  // so the first row for a test is the newest — a retake appends rather than
  // replacing, and the latest attempt is the one to review.
  const wantedTest = String((req.query && req.query.testId) || "").slice(0, 80);
  if (wantedTest) {
    const iter = attempts.listEntities({
      queryOptions: {
        filter: `${partition} and testId eq '${wantedTest.replace(/'/g, "''")}'`,
        // The one read that does want the answers blob — say so, rather than
        // leaving the projection off and taking whatever the row happens to hold.
        select: ATTEMPT_LIST_SELECT.concat("answers"),
      },
    });
    let done = null;
    let progress = null;
    for await (const e of iter) {
      const answers = parseAnswers(e.answers);
      if (isProgressRow(e)) {
        progress = { testId: e.testId, answers, index: e.index || 0, updatedAt: e.updatedAt || "" };
      } else if (!done) {
        done = {
          testId: e.testId,
          score: e.score,
          total: e.total,
          completedAt: e.completedAt,
          answers,
        };
      }
    }
    // A finished attempt always wins: a stale progress row left by a failed
    // delete must never send a student back into a test they completed.
    return json(context, 200, { attempt: done, progress: done ? null : progress });
  }

  const list = [];
  // Counted in the SAME walk the listing already makes: how many hand-ins per
  // test, and any extra the teacher granted. A second query would ask the same
  // partition the same question twice.
  const counts = {};
  const bump = (id, key, by) => {
    if (!id) return;
    counts[id] = counts[id] || { used: 0, extra: 0 };
    counts[id][key] += by;
  };
  const iter = attempts.listEntities({
    queryOptions: { filter: partition, select: ATTEMPT_LIST_SELECT },
  });
  for await (const e of iter) {
    // A grant is not an attempt. Left in the list it would read as a paper the
    // student handed in and never sat.
    if (String(e.rowKey || "").startsWith(GRANT_PREFIX)) {
      bump(e.testId, "extra", typeof e.extra === "number" ? e.extra : 0);
      continue;
    }
    if (!isProgressRow(e)) bump(e.testId, "used", 1);
    list.push(
      isProgressRow(e)
        ? {
            testId: e.testId,
            score: e.score || 0,
            total: e.total || 0,
            completedAt: e.updatedAt || "",
            status: "progress",
            index: e.index || 0,
          }
        : {
            testId: e.testId,
            score: e.score,
            total: e.total,
            completedAt: e.completedAt,
            status: "done",
          }
    );
    if (list.length >= 100) break;
  }
  json(context, 200, { attempts: list, counts, attemptRule: (await platformRules()).subjectAttempts });
};

// ---------- Answer photos for long questions ----------
//
// A long answer is no longer self-marked. The student hands in a photo of
// their working; the teacher awards the marks. Two stores are involved:
//
//   * the `answers` blob container holds the photos (Table Storage caps a
//     property at 64KB, so images can never live in a table row), and
//   * the `grading` table holds one row per (student, test, question) —
//     what was handed in, and what the teacher awarded.
//
// The attempt row is deliberately left alone: its `score` stays the
// auto-graded subtotal, and `parseAnswers`' blob is already dropped past
// Q_CHUNK, so widening it would eventually wipe a student's answer map.
// A teacher marking a paper therefore never writes to the student's row.

const ANSWER_CONTAINER = "answers";
const MAX_IMAGE_BYTES = 1500000;
const MAX_IMAGES_PER_ANSWER = 3;
const SAS_TTL_MS = 15 * 60 * 1000;

let blobServiceCache = null;
function blobService() {
  if (!blobServiceCache) {
    const { BlobServiceClient } = require("@azure/storage-blob");
    blobServiceCache = BlobServiceClient.fromConnectionString(STORAGE);
  }
  return blobServiceCache;
}

let containerReady = null;
async function answerContainer() {
  const c = blobService().getContainerClient(ANSWER_CONTAINER);
  // Private: no public access argument. Reads go through a short-lived SAS
  // minted below, never through a guessable URL.
  if (!containerReady) containerReady = c.createIfNotExists().catch(() => {});
  await containerReady;
  return c;
}

/** Ids reach blob paths and row keys, so keep them to a boring alphabet. */
function safeId(value, max) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "")
    .slice(0, max);
}

/** Trust the bytes, not the caller's content type. */
function sniffImage(buf) {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return "image/jpeg";
  }
  if (
    buf.length > 8 &&
    buf[0] === 0x89 &&
    buf[1] === 0x50 &&
    buf[2] === 0x4e &&
    buf[3] === 0x47
  ) {
    return "image/png";
  }
  return "";
}

function gradingKey(testId, questionId) {
  return `${testId}~${questionId}`;
}

function parseImages(raw) {
  try {
    const v = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const GRADING_SELECT = [
  "PartitionKey", "RowKey", "studentName", "testId", "testTitle", "questionId",
  "questionIndex", "maxMarks", "images", "status", "submittedAt", "awarded",
  "comment", "markedAt", "markedBy",
  // The AI's proposal. Deliberately separate from `awarded`: a suggestion is
  // not a mark, and only the teacher's own mark action writes that one.
  "aiAwarded", "aiComment", "aiReasoning", "aiAt", "aiModel",
];

function gradingOut(e) {
  const images = parseImages(e.images);
  return {
    studentId: e.partitionKey,
    username: String(e.partitionKey || "").replace(/^stu~/, ""),
    studentName: e.studentName || "",
    testId: e.testId || "",
    testTitle: e.testTitle || "",
    questionId: e.questionId || "",
    questionIndex: typeof e.questionIndex === "number" ? e.questionIndex : 0,
    maxMarks: typeof e.maxMarks === "number" ? e.maxMarks : 0,
    images,
    status: e.status || "submitted",
    submittedAt: e.submittedAt || "",
    awarded: typeof e.awarded === "number" ? e.awarded : null,
    comment: e.comment || "",
    markedAt: e.markedAt || "",
    markedBy: e.markedBy || "",
    aiAwarded: typeof e.aiAwarded === "number" ? e.aiAwarded : null,
    aiComment: e.aiComment || "",
    aiReasoning: e.aiReasoning || "",
    aiAt: e.aiAt || "",
    aiModel: e.aiModel || "",
  };
}

async function gradingTable() {
  const t = tableClient("grading");
  await ensureTable(t);
  return t;
}

/** Is this caller allowed to see `username`'s work? Returns a reason or "". */
async function canSeeStudent(who, username) {
  const user = String(username || "").trim().toLowerCase();
  if (!user) return "Unknown student";
  if (who.kind === "student") {
    return who.username === user ? "" : "Not your work";
  }
  if (who.role === "admin" || who.role === "teacher") {
    // Admins reach every student, but the student still has to exist —
    // otherwise a typo silently writes rows keyed to nobody.
    let rec;
    try {
      rec = await tableClient("students").getEntity("student", user);
    } catch {
      return "Student not found";
    }
    return who.role === "admin" || rec.teacherSub === who.id ? "" : "Not your student";
  }
  // Parents see only a child they have redeemed an invite code for.
  const link = await childLink(who, user);
  return link ? "" : "Not your child";
}

/** Turn a canSeeStudent reason into a response. Missing is 404, not 403. */
function refuse(context, reason) {
  return json(context, reason === "Student not found" ? 404 : 403, { error: reason });
}

handlers.answerimage = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) {
    return json(context, 401, { error: "Invalid token", reason: who.reason });
  }

  if (req.method === "GET") {
    const blobName = String((req.query && req.query.blob) || "");
    // "stu~ananya42/test-1/q-15/1699…​.jpg"
    const owner = blobName.split("/")[0] || "";
    if (!owner.startsWith("stu~")) {
      return json(context, 400, { error: "Unknown image" });
    }
    const refusal = await canSeeStudent(who, owner.slice(4));
    if (refusal) return refuse(context, refusal);
    const container = await answerContainer();
    const blob = container.getBlockBlobClient(blobName);
    if (!(await blob.exists())) {
      return json(context, 404, { error: "Image not found" });
    }
    let url;
    try {
      url = await blob.generateSasUrl({
        permissions: require("@azure/storage-blob").BlobSASPermissions.parse("r"),
        expiresOn: new Date(Date.now() + SAS_TTL_MS),
      });
    } catch (e) {
      return json(context, 500, { error: "Could not sign the image URL" });
    }
    // JSON rather than a 302: an <img src> cannot carry X-Vidai-Auth, so
    // the client fetches the signed URL first and points the image at that.
    return json(context, 200, { url, expiresIn: Math.floor(SAS_TTL_MS / 1000) });
  }

  if (req.method !== "POST") {
    return json(context, 405, { error: "Method not allowed" });
  }

  // Only a student hands work in. A teacher previewing their own test, or a
  // parent looking over a shoulder, must not be able to write a photo.
  if (who.kind !== "student") {
    return json(context, 403, { error: "Students only" });
  }

  const body = getBody(req) || {};
  const action = body.action || "upload";
  const testId = safeId(body.testId, 60);
  const questionId = safeId(body.questionId, 40);
  if (!testId || !questionId) {
    return json(context, 400, { error: "testId and questionId are required" });
  }

  const grading = await gradingTable();
  const rowKey = gradingKey(testId, questionId);
  let existing = null;
  try {
    existing = await grading.getEntity(who.id, rowKey);
  } catch {}
  const images = existing ? parseImages(existing.images) : [];

  if (action === "remove") {
    const blobName = String(body.blob || "");
    if (!images.includes(blobName)) {
      return json(context, 404, { error: "No such photo on this answer" });
    }
    if (existing && existing.status === "marked") {
      return json(context, 409, {
        error: "Your teacher has already marked this answer.",
      });
    }
    const container = await answerContainer();
    try {
      await container.getBlockBlobClient(blobName).deleteIfExists();
    } catch {}
    const left = images.filter((n) => n !== blobName);
    await grading.upsertEntity(
      { partitionKey: who.id, rowKey, images: JSON.stringify(left) },
      "Merge"
    );
    return json(context, 200, { ok: true, images: left });
  }

  if (existing && existing.status === "marked") {
    return json(context, 409, {
      error: "Your teacher has already marked this answer.",
    });
  }
  if (images.length >= MAX_IMAGES_PER_ANSWER) {
    return json(context, 409, {
      error: `At most ${MAX_IMAGES_PER_ANSWER} photos per answer`,
    });
  }

  const raw = String(body.image || "").replace(/^data:image\/[a-z+]+;base64,/, "");
  if (!raw) return json(context, 400, { error: "No image sent" });
  let buf;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return json(context, 400, { error: "Image is not valid base64" });
  }
  if (!buf.length) return json(context, 400, { error: "Image is empty" });
  if (buf.length > MAX_IMAGE_BYTES) {
    return json(context, 413, {
      error: "That photo is too large — try again with a smaller one",
    });
  }
  const contentType = sniffImage(buf);
  if (!contentType) {
    return json(context, 415, { error: "Only JPEG or PNG photos" });
  }

  const ext = contentType === "image/png" ? "png" : "jpg";
  const blobName = `${who.id}/${testId}/${questionId}/${Date.now()}-${b64url(
    crypto.randomBytes(6)
  )}.${ext}`;
  const container = await answerContainer();
  await container.getBlockBlobClient(blobName).uploadData(buf, {
    blobHTTPHeaders: { blobContentType: contentType },
  });

  const next = images.concat(blobName);
  const maxMarks = Math.max(0, Math.min(100, Number(body.maxMarks) || 0));
  const questionIndex = Math.max(0, Math.min(200, Number(body.questionIndex) || 0));
  await grading.upsertEntity(
    {
      partitionKey: who.id,
      rowKey,
      testId,
      questionId,
      testTitle: String(body.testTitle || "").slice(0, 120),
      questionIndex,
      maxMarks,
      images: JSON.stringify(next),
      status: "submitted",
      submittedAt: new Date().toISOString(),
      teacherId: who.teacherSub || "",
      studentName: who.username,
    },
    "Merge"
  );

  return json(context, 201, { blob: blobName, images: next });
};

handlers.grading = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) {
    return json(context, 401, { error: "Invalid token", reason: who.reason });
  }
  const grading = await gradingTable();

  if (req.method === "GET") {
    const q = req.query || {};

    // The teacher's marking queue: everything handed in by their students.
    if (q.queue) {
      if (who.role !== "teacher" && who.role !== "admin") {
        return json(context, 403, { error: "Teachers only" });
      }
      const clauses = ["status eq 'submitted'"];
      if (who.role !== "admin") {
        clauses.push(`teacherId eq '${who.id.replace(/'/g, "''")}'`);
      }
      const out = [];
      const iter = grading.listEntities({
        queryOptions: { filter: clauses.join(" and "), select: GRADING_SELECT },
      });
      for await (const e of iter) {
        out.push(gradingOut(e));
        if (out.length >= 200) break;
      }
      out.sort(
        (a, b) =>
          (a.testTitle || "").localeCompare(b.testTitle || "") ||
          a.questionIndex - b.questionIndex ||
          (a.studentName || "").localeCompare(b.studentName || "")
      );
      return json(context, 200, { answers: out });
    }

    // One student's rows, used to merge awarded marks into a score or review.
    const username =
      who.kind === "student" ? who.username : String(q.student || "").trim().toLowerCase();
    const refusal = await canSeeStudent(who, username);
    if (refusal) return refuse(context, refusal);
    const testId = safeId(q.testId, 60);
    const clauses = [`PartitionKey eq 'stu~${username.replace(/'/g, "''")}'`];
    if (testId) clauses.push(`testId eq '${testId}'`);
    const out = [];
    const iter = grading.listEntities({
      queryOptions: { filter: clauses.join(" and "), select: GRADING_SELECT },
    });
    for await (const e of iter) {
      out.push(gradingOut(e));
      if (out.length >= 200) break;
    }
    out.sort((a, b) => a.questionIndex - b.questionIndex);
    return json(context, 200, { answers: out });
  }

  if (req.method !== "POST") {
    return json(context, 405, { error: "Method not allowed" });
  }

  const body = getBody(req) || {};
  const action = body.action || "mark";
  if (action !== "mark") {
    return json(context, 400, { error: `Unknown action: ${action}` });
  }
  if (who.role !== "teacher" && who.role !== "admin") {
    return json(context, 403, { error: "Teachers only" });
  }

  const username = String(body.username || "").trim().toLowerCase();
  const refusal = await canSeeStudent(who, username);
  if (refusal) return refuse(context, refusal);

  const testId = safeId(body.testId, 60);
  const questionId = safeId(body.questionId, 40);
  let entity;
  try {
    entity = await grading.getEntity(`stu~${username}`, gradingKey(testId, questionId));
  } catch {
    return json(context, 404, { error: "Nothing handed in for that question" });
  }

  const maxMarks = typeof entity.maxMarks === "number" ? entity.maxMarks : 0;
  const awarded = Math.max(0, Math.min(maxMarks, Math.round(Number(body.awarded) || 0)));
  await grading.upsertEntity(
    {
      partitionKey: entity.partitionKey,
      rowKey: entity.rowKey,
      status: "marked",
      awarded,
      comment: String(body.comment || "").slice(0, 600),
      markedAt: new Date().toISOString(),
      markedBy: who.name || who.email || who.id,
    },
    "Merge"
  );

  return json(context, 200, { ok: true, awarded, maxMarks });
};

// ---------- The AI marking assistant (/api/assess) ----------
//
// A long answer is a photograph of a child's working. The model reads it
// against the question and the teacher's own model solution and proposes a
// mark with a short justification. **It never awards anything**: the proposal
// lands in aiAwarded/aiComment and only the teacher's own mark action writes
// `awarded` and moves status to "marked". That is the whole safety property —
// a wrong AI mark is a suggestion a teacher overrules, never a mark a student
// receives.
//
// Data minimisation: the model is sent the question, the model solution, the
// marks available and the photographs. **It is never sent the student's name,
// username or school** — it has no use for them and they are the part that
// would matter if the request leaked.
//
// Cost: one call per press of "Assess with AI", never automatic. At
// gpt-4.1-mini rates a typical two-photo answer is about a tenth of a rupee.
// Not gpt-4o-mini: it bills images at roughly 33x the tokens, which on a
// photograph-only workload like this one makes it the dearest of the three.

const AI_TIMEOUT_MS = 45000;
const AI_MAX_SOLUTION = 4000;

/**
 * The shape the model must answer in, so the reply is never free prose.
 *
 * Azure's strict structured outputs are stricter than JSON Schema at large:
 * **every** property must be listed in `required` and `additionalProperties`
 * must be `false`, or the request is rejected outright. `minimum`/`maximum` are
 * not supported either — the mark is clamped in code after it comes back,
 * which is where it has to be clamped anyway.
 */
const AI_SCHEMA = {
  type: "object",
  properties: {
    awarded: { type: "number" },
    comment: { type: "string" },
    reasoning: { type: "string" },
  },
  required: ["awarded", "comment", "reasoning"],
  additionalProperties: false,
};

function aiPrompt(question, solution, maxMarks) {
  return [
    "You are helping a CBSE mathematics teacher mark one handwritten answer.",
    "The photographs show a student's working. Read them and mark the answer.",
    "",
    `QUESTION (worth ${maxMarks} mark${maxMarks === 1 ? "" : "s"}):`,
    question || "(the question text is unavailable — mark from the working alone)",
    "",
    "THE TEACHER'S MODEL SOLUTION:",
    solution || "(none given — use standard CBSE marking)",
    "",
    "Mark it the way a CBSE examiner would:",
    `- Award a whole number from 0 to ${maxMarks}.`,
    "- Give method marks for correct working even when the final answer is wrong.",
    "- Do not deduct for untidy handwriting, spelling, or a different but valid method.",
    "- If the photograph is unreadable or shows no attempt, award 0 and say so in the comment.",
    "",
    "`comment` is written TO THE STUDENT: one or two sentences, plain, kind, and",
    "specific about what to fix. `reasoning` is for the teacher: why this mark.",
  ].join("\n");
}

/** Pull the answer's photographs back out of the private container. */
async function answerImages(blobNames) {
  const container = await answerContainer();
  const out = [];
  await inBatches(blobNames.slice(0, MAX_IMAGES_PER_ANSWER), 3, async (name) => {
    try {
      const buf = await container.getBlobClient(name).downloadToBuffer();
      const mime = sniffImage(buf);
      if (mime && buf.length <= MAX_IMAGE_BYTES) {
        // A data URI rather than a URL: the container is private, and handing
        // the model a SAS would put a link to a child's handwriting in someone
        // else's logs. `detail: "high"` is the point of the exercise — on the
        // low setting the model reads a 512px thumbnail, which is not enough
        // to tell a 6 from a b in pencil.
        out.push({
          type: "image_url",
          image_url: { url: `data:${mime};base64,${buf.toString("base64")}`, detail: "high" },
        });
      }
    } catch {
      // A missing blob is not worth failing the whole assessment over.
    }
  });
  return out;
}

/** Ask the model. Returns {awarded, comment, reasoning} or throws a message. */
async function askAssessor(question, solution, maxMarks, images) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);
  let res;
  try {
    // The v1 GA surface: no api-version to keep in step with, and the same
    // request shape as OpenAI's own, so the deployment can be swapped for a
    // stronger model from the portal without touching this file.
    res = await fetch(`${AZURE_AI_ENDPOINT}/openai/v1/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", "api-key": AZURE_AI_KEY },
      body: JSON.stringify({
        // The *deployment* name, not the model id.
        model: AZURE_AI_DEPLOYMENT,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: aiPrompt(question, solution, maxMarks) },
              ...images,
            ],
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: "vidai_mark", strict: true, schema: AI_SCHEMA },
        },
        // No token cap on purpose: the newer models want
        // `max_completion_tokens` where the older ones want `max_tokens`, and
        // guessing wrong is a 400 on every call. The schema is what bounds the
        // reply, and the two strings are truncated below in any case.
      }),
    });
  } catch (e) {
    throw new Error(
      e && e.name === "AbortError" ? "The assessment timed out" : "Could not reach the model"
    );
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    // Never echo the provider's *body* back: it can carry the request, and the
    // request carries a child's handwriting. The `error.message` alone is the
    // provider describing its own complaint ("deployment not found", "quota
    // exceeded") and carries none of that — and without it an operator has no
    // way to tell a wrong deployment name from a spent quota. Staff-only.
    let why = "";
    try {
      const body = JSON.parse(text);
      why = String((body.error && body.error.message) || "").slice(0, 200);
    } catch {}
    // A 404 says nothing on its own — the host, the path and the deployment
    // name are all candidates, and Azure answers a bad one of any of the three
    // with a bare "Resource not found". Naming what was tried turns an
    // afternoon of guessing into a glance. Neither is a secret: the key is not
    // here and neither is the handwriting.
    const tried =
      res.status === 404
        ? ` (tried deployment "${AZURE_AI_DEPLOYMENT}" at ${AZURE_AI_ENDPOINT}/openai/v1/chat/completions)`
        : "";
    throw new Error(
      `The model refused the request (${res.status})${why ? `: ${why}` : ""}${tried}`
    );
  }
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("The model sent something that was not JSON");
  }
  const message = (payload.choices && payload.choices[0] && payload.choices[0].message) || {};
  // A refusal is the model declining the whole request. It is not a mark of
  // zero, and must never be written as one.
  if (message.refusal) throw new Error("The model declined to mark this answer");
  let out;
  try {
    out = JSON.parse(message.content || "");
  } catch {
    throw new Error("The model did not answer in the shape asked for");
  }
  const awarded = Math.max(0, Math.min(maxMarks, Math.round(Number(out.awarded))));
  if (!Number.isFinite(awarded)) throw new Error("The model did not return a mark");
  // The token counts are the only record of what this actually cost, and they
  // exist for exactly one moment — this response. They used to be dropped on
  // the floor here, which is why no usage report was possible. A reply that
  // carries no `usage` yields zeros, and a zero is rendered as "not recorded"
  // rather than as free: see `costInr` below.
  const usage = payload.usage || {};
  return {
    awarded,
    comment: String(out.comment || "").slice(0, 600),
    reasoning: String(out.reasoning || "").slice(0, 600),
    promptTokens: Math.max(0, Math.round(Number(usage.prompt_tokens) || 0)),
    completionTokens: Math.max(0, Math.round(Number(usage.completion_tokens) || 0)),
  };
}

/**
 * How many assessments this teacher has had today, and whether that is enough.
 *
 * Same shape as the login throttle: PK is the bucket kind, RK is a digest of
 * the caller plus the date, so it is a point read and a point write and never
 * a scan. The row expires by being irrelevant — tomorrow has a different key —
 * which is the same reason `authattempts` rows are left to rot.
 */
const ASSESS_BUCKET = "assess";

function assessKey(teacherId) {
  return `${digestKey(teacherId)}~${new Date().toISOString().slice(0, 10)}`;
}

async function assessUsage(table, teacherId) {
  try {
    const row = await table.getEntity(ASSESS_BUCKET, assessKey(teacherId));
    return typeof row.count === "number" ? row.count : 0;
  } catch {
    return 0;
  }
}

async function noteAssess(table, teacherId, used) {
  await table.upsertEntity(
    {
      partitionKey: ASSESS_BUCKET,
      rowKey: assessKey(teacherId),
      count: used + 1,
      at: new Date().toISOString(),
    },
    "Merge"
  );
}

// ---------- AI credits, and what they actually cost ----------
//
// The daily cap above and this ledger guard different things, which is why
// both exist. The cap is a runaway brake — a loop, a stolen session — and is
// keyed by a *digest* of the caller, so it can never be reported on. Credits
// are an entitlement someone is accountable for, so this row names the teacher
// and carries the money.
//
// PK is the month, RK the teacher id. A credit check is therefore one point
// read, and the admin's whole-platform report for a month is one partition
// query — never a scan. A new month is simply a new partition, so nothing has
// to be swept.
const AIUSAGE_SELECT = [
  "PartitionKey",
  "RowKey",
  "used",
  "granted",
  "promptTokens",
  "completionTokens",
  "costMicroUsd",
  "email",
  "name",
  "updatedAt",
];

function usageMonth(when) {
  return (when instanceof Date ? when : new Date()).toISOString().slice(0, 7);
}

async function aiusageTable() {
  const t = tableClient("aiusage");
  await ensureTable(t);
  return t;
}

async function creditsFor(table, teacherId, month) {
  try {
    const row = await table.getEntity(month, teacherId);
    return {
      used: typeof row.used === "number" ? row.used : 0,
      granted: typeof row.granted === "number" ? row.granted : ASSESS_MONTHLY_CREDITS,
      etag: row.etag,
    };
  } catch {
    // No row yet is a teacher who has not spent anything this month, not an
    // error — and not zero credits.
    return { used: 0, granted: ASSESS_MONTHLY_CREDITS, etag: null };
  }
}

/**
 * Spend one credit and record what it cost.
 *
 * `noteAssess` is a read-modify-write with no ETag, which can lose one of two
 * concurrent writes. That is tolerable for a throttle and not for a ledger
 * somebody is held to, so this retries on a concurrency failure — bounded,
 * never a spin.
 */
async function noteCredit(table, who, month, spend) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    let row = null;
    try {
      row = await table.getEntity(month, who.id);
    } catch {
      row = null;
    }
    const next = {
      partitionKey: month,
      rowKey: who.id,
      used: (typeof row?.used === "number" ? row.used : 0) + 1,
      granted: typeof row?.granted === "number" ? row.granted : ASSESS_MONTHLY_CREDITS,
      promptTokens: (typeof row?.promptTokens === "number" ? row.promptTokens : 0) + spend.promptTokens,
      completionTokens:
        (typeof row?.completionTokens === "number" ? row.completionTokens : 0) + spend.completionTokens,
      costMicroUsd: (typeof row?.costMicroUsd === "number" ? row.costMicroUsd : 0) + spend.costMicroUsd,
      // Stamped so the report can name a person: the row key is a Google sub,
      // which tells an admin nothing.
      email: who.email || row?.email || "",
      name: who.name || row?.name || "",
      updatedAt: new Date().toISOString(),
    };
    try {
      if (row) {
        await table.updateEntity(next, "Merge", { etag: row.etag });
      } else {
        await table.createEntity(next);
      }
      return;
    } catch (e) {
      // 412 is someone else's write landing first; 409 is the row appearing
      // between our read and our create. Both mean re-read and try again.
      const code = e && (e.statusCode || e.status);
      if (code !== 412 && code !== 409) throw e;
    }
  }
  // Four collisions on one teacher's row is not a case worth failing the
  // assessment over — the mark is already made and the teacher has it.
}

handlers.assess = async (context, req) => {
  if (misconfigured(context)) return;
  if (req.method !== "POST") return json(context, 405, { error: "Method not allowed" });
  const who = await identify(req, context);
  if (!who.kind) {
    return json(context, 401, { error: "Invalid token", reason: who.reason });
  }
  if (who.role !== "teacher" && who.role !== "admin") {
    return json(context, 403, { error: "Teachers only" });
  }
  if (!aiConfigured()) {
    return json(context, 501, { error: "AI marking is not switched on for this site" });
  }

  // The cap is checked BEFORE the row read, the blob downloads and the model
  // call — the same reason loginGate runs before scrypt: the expensive work is
  // exactly what an abuser wants, so it must sit behind the gate, not in front.
  const gate = await attemptsTable();
  const used = await assessUsage(gate, who.id);
  if (used >= ASSESS_DAILY_CAP) {
    return json(context, 429, {
      error: `That is ${ASSESS_DAILY_CAP} AI assessments today, which is the daily limit. Mark the rest yourself, or try again tomorrow.`,
    });
  }

  // Credits sit beside the cap and in front of the same expensive work. An
  // exhausted teacher is refused in words they can act on — and only the AI
  // draft is refused: marking the answer by hand is never blocked.
  const month = usageMonth();
  const ledger = await aiusageTable();
  const credit = await creditsFor(ledger, who.id, month);
  if (credit.used >= credit.granted) {
    return json(context, 429, {
      error: `You have used all ${credit.granted} AI credits this month. You can still mark this answer yourself.`,
      credits: { used: credit.used, granted: credit.granted, left: 0 },
    });
  }

  const body = getBody(req) || {};
  const username = String(body.username || "").trim().toLowerCase();
  const refusal = await canSeeStudent(who, username);
  if (refusal) return refuse(context, refusal);

  const testId = safeId(body.testId, 60);
  const questionId = safeId(body.questionId, 40);
  const grading = await gradingTable();
  let entity;
  try {
    entity = await grading.getEntity(`stu~${username}`, gradingKey(testId, questionId));
  } catch {
    return json(context, 404, { error: "Nothing handed in for that question" });
  }

  const images = await answerImages(parseImages(entity.images));
  if (!images.length) {
    return json(context, 400, { error: "There is no readable photo to assess" });
  }

  const maxMarks = typeof entity.maxMarks === "number" ? entity.maxMarks : 0;
  let verdict;
  try {
    verdict = await askAssessor(
      String(body.question || "").slice(0, AI_MAX_SOLUTION),
      String(body.solution || "").slice(0, AI_MAX_SOLUTION),
      maxMarks,
      images
    );
  } catch (e) {
    return json(context, 502, { error: (e && e.message) || "The assessment failed" });
  }

  // Counted only once the model has actually answered: a failed call costs
  // nothing at Azure, so it should not cost the teacher a slot or a credit.
  await noteAssess(gate, who.id, used);
  await noteCredit(ledger, who, month, {
    promptTokens: verdict.promptTokens,
    completionTokens: verdict.completionTokens,
    costMicroUsd: costMicroUsd(verdict.promptTokens, verdict.completionTokens),
  });

  // The proposal is stored beside the answer, never on top of it: `awarded`
  // and `status` are the teacher's to move.
  await grading.updateEntity(
    {
      partitionKey: entity.partitionKey,
      rowKey: entity.rowKey,
      aiAwarded: verdict.awarded,
      aiComment: verdict.comment,
      aiReasoning: verdict.reasoning,
      aiAt: new Date().toISOString(),
      aiModel: AZURE_AI_DEPLOYMENT,
    },
    "Merge"
  );

  return json(context, 200, {
    awarded: verdict.awarded,
    comment: verdict.comment,
    reasoning: verdict.reasoning,
    model: AZURE_AI_DEPLOYMENT,
    credits: {
      used: credit.used + 1,
      granted: credit.granted,
      left: Math.max(0, credit.granted - credit.used - 1),
      low: creditsAreLow(credit.used + 1, credit.granted),
    },
  });
};

/**
 * The AI usage report, and a teacher's own balance.
 *
 * `GET ?me=1`    — what the caller has left, for the marking screen.
 * `GET ?month=`  — admin only: every teacher's row for that month.
 * `POST grant`   — admin only: top up one teacher, so somebody who runs out
 *                  mid-term is not waiting on a deploy.
 *
 * The route is deliberately not named `admin…`: Azure Functions reserves that
 * namespace and SWA serves such a route as a 404 with no warning anywhere.
 */
handlers.aiusage = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  if (who.role !== "teacher" && who.role !== "admin") {
    return json(context, 403, { error: "Teachers only" });
  }
  const table = await aiusageTable();

  if (req.method === "GET") {
    const asked = String((req.query && req.query.month) || "").trim();
    const month = /^\d{4}-\d{2}$/.test(asked) ? asked : usageMonth();

    // A teacher asks only about themselves, and is never shown the platform.
    if (who.role !== "admin" || String((req.query && req.query.me) || "")) {
      const mine = await creditsFor(table, who.id, month);
      return json(context, 200, {
        month,
        used: mine.used,
        granted: mine.granted,
        left: Math.max(0, mine.granted - mine.used),
        low: creditsAreLow(mine.used, mine.granted),
      });
    }

    // One partition query, explicitly projected (rule 1 and rule 2): the whole
    // platform's month without walking a single other row.
    const rows = [];
    const iter = table.listEntities({
      queryOptions: { filter: `PartitionKey eq '${month.replace(/'/g, "''")}'`, select: AIUSAGE_SELECT },
    });
    for await (const e of iter) {
      const used = typeof e.used === "number" ? e.used : 0;
      const granted = typeof e.granted === "number" ? e.granted : ASSESS_MONTHLY_CREDITS;
      const micros = typeof e.costMicroUsd === "number" ? e.costMicroUsd : 0;
      const promptTokens = typeof e.promptTokens === "number" ? e.promptTokens : 0;
      const completionTokens = typeof e.completionTokens === "number" ? e.completionTokens : 0;
      rows.push({
        teacherId: e.rowKey,
        name: e.name || "",
        email: e.email || "",
        used,
        granted,
        left: Math.max(0, granted - used),
        low: creditsAreLow(used, granted),
        promptTokens,
        completionTokens,
        // null, not 0. A model reply that carried no token counts is unknown
        // cost, and showing an unknown as free is the one wrong answer here.
        costInr: promptTokens + completionTokens > 0 ? (micros / 1e6) * USD_INR : null,
        updatedAt: e.updatedAt || "",
      });
      if (rows.length >= 500) break;
    }
    // Low first: the question this screen answers is "who needs topping up",
    // and that is read off the top rather than by scanning every row. Busiest
    // first is the tiebreak within each group, as before.
    rows.sort((a, b) => Number(b.low) - Number(a.low) || b.used - a.used);
    const totals = rows.reduce(
      (acc, r) => ({
        used: acc.used + r.used,
        promptTokens: acc.promptTokens + r.promptTokens,
        completionTokens: acc.completionTokens + r.completionTokens,
        costInr: acc.costInr + (r.costInr || 0),
      }),
      { used: 0, promptTokens: 0, completionTokens: 0, costInr: 0 }
    );
    return json(context, 200, { month, credits: ASSESS_MONTHLY_CREDITS, rows, totals });
  }

  if (who.role !== "admin") return json(context, 403, { error: "Admins only" });
  const body = getBody(req) || {};
  const action = String(body.action || "");
  if (action !== "grant") return json(context, 400, { error: `Unknown action: ${action}` });

  const teacherId = String(body.teacherId || "").trim();
  if (!teacherId || teacherId.length > 200 || /[/\\#?]/.test(teacherId)) {
    return json(context, 400, { error: "A teacher is needed" });
  }
  const granted = Math.round(Number(body.credits));
  if (!Number.isFinite(granted) || granted < 0 || granted > 100000) {
    return json(context, 400, { error: "Credits must be a number between 0 and 100000" });
  }
  const month = /^\d{4}-\d{2}$/.test(String(body.month || "")) ? String(body.month) : usageMonth();

  let row = null;
  try {
    row = await table.getEntity(month, teacherId);
  } catch {
    row = null;
  }
  const next = { partitionKey: month, rowKey: teacherId, granted, updatedAt: new Date().toISOString() };
  if (row) {
    await table.updateEntity(next, "Merge", { etag: row.etag });
  } else {
    await table.createEntity({ ...next, used: 0, promptTokens: 0, completionTokens: 0, costMicroUsd: 0 });
  }
  return json(context, 200, { ok: true, month, teacherId, granted });
};

/**
 * The account: which role they chose, and what their plan allows.
 *
 * `GET`  — the caller's own entitlements, so a screen can say what is left
 *          before they hit a wall. Admins may add `?all=1` for the roster.
 * `POST` — `choose` (once, at sign-up), and the admin's manual levers:
 *          `exempt`, `extend`, `seats`, `grant` (a shelf), `rules`.
 *
 * Not named `admin…`: Azure reserves that route namespace and serves it as a
 * 404 with no warning anywhere.
 */
handlers.accounts = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) return json(context, 401, { error: "Invalid token", reason: who.reason });
  if (who.kind === "student") return json(context, 403, { error: "Not for students" });
  const table = await accountsTable();

  if (req.method === "GET") {
    if (who.role === "admin" && String((req.query && req.query.all) || "")) {
      // Run the grandfathering here too, and not only from a gate.
      //
      // `entitlements` returns early for an admin, so without this the one
      // person who needs to CHECK that existing accounts were protected is the
      // one person who cannot trigger it. Opening this screen is how J
      // confirms the pilot class is safe before any limit starts biting.
      await exemptLegacyAccounts(table);
      const rows = [];
      const iter = table.listEntities({
        queryOptions: { filter: `PartitionKey eq '${ACCOUNT_PK}'`, select: ACCOUNT_SELECT },
      });
      for await (const e of iter) {
        rows.push({
          sub: e.rowKey,
          name: e.name || "",
          email: e.email || "",
          chose: e.chose || "",
          trialEndsAt: e.trialEndsAt || "",
          paidSeats: typeof e.paidSeats === "number" ? e.paidSeats : 0,
          exempt: !!e.exempt,
          createdAt: e.createdAt || "",
        });
        if (rows.length >= 500) break;
      }
      rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
      return json(context, 200, { accounts: rows, rules: await platformRules() });
    }
    const ent = await entitlements(who);
    const row = await accountRow(table, who.id);
    return json(context, 200, {
      plan: ent.plan,
      chose: String((row && row.chose) || ""),
      trialEndsAt: ent.trialEndsAt || "",
      limits: {
        subjects: ent.subjects,
        tests: ent.tests,
        students: ent.students,
        shelfTests: ent.shelfTests,
      },
      rules: ent.rules,
    });
  }

  const body = getBody(req) || {};
  const action = String(body.action || "");

  if (action === "choose") {
    const chose = body.chose === "teacher" ? "teacher" : body.chose === "parent" ? "parent" : "";
    if (!chose) return json(context, 400, { error: "Choose teacher or parent" });
    const existing = await accountRow(table, who.id);
    // The choice is made once. Letting it be re-picked would let somebody
    // restart the trial at will, and would move a roster of real children
    // between two kinds of account.
    if (existing && existing.chose) {
      return json(context, 409, { error: "You have already chosen", chose: existing.chose });
    }
    const rules = await platformRules();
    const now = new Date();
    const ends = new Date(now.getTime() + rules.trialDays * 24 * 60 * 60 * 1000);
    await table.upsertEntity(
      {
        partitionKey: ACCOUNT_PK,
        rowKey: who.id,
        chose,
        email: who.email || "",
        name: who.name || "",
        trialStartedAt: now.toISOString(),
        trialEndsAt: ends.toISOString(),
        paidSeats: 0,
        exempt: false,
        createdAt: (existing && existing.createdAt) || now.toISOString(),
      },
      "Merge"
    );
    return json(context, 200, { ok: true, chose, trialEndsAt: ends.toISOString() });
  }

  if (who.role !== "admin") return json(context, 403, { error: "Admins only" });

  if (action === "rules") {
    const next = { partitionKey: PLAN_PK, rowKey: PLAN_RK, updatedAt: new Date().toISOString() };
    for (const key of Object.keys(PLAN_DEFAULTS)) {
      const v = Number(body[key]);
      // Silently ignoring a bad number would save a price nobody typed.
      if (body[key] !== undefined) {
        if (!Number.isFinite(v) || v < 0) return json(context, 400, { error: `${key} must be a number` });
        next[key] = Math.round(v);
      }
    }
    await (await planTable()).upsertEntity(next, "Merge");
    // The instance that saved is right at once; the rest inside the TTL.
    planCache.drop(PLAN_RK);
    return json(context, 200, { ok: true, rules: await platformRules() });
  }

  const sub = String(body.sub || "").trim();
  if (!sub || sub.length > 200 || /[/\\#?]/.test(sub)) {
    return json(context, 400, { error: "An account is needed" });
  }

  if (action === "grant") {
    const shelfId = safeId(body.shelfId, 80);
    if (!shelfId) return json(context, 400, { error: "A subject is needed" });
    await (await purchasesTable()).upsertEntity(
      {
        partitionKey: sub,
        rowKey: shelfId,
        grantedBy: who.id,
        grantedAt: new Date().toISOString(),
        // Recorded even when nothing was charged, so the day payments arrive
        // the history reads the same.
        pricePaise: (await platformRules()).subjectPaise,
      },
      "Merge"
    );
    return json(context, 200, { ok: true, sub, shelfId });
  }

  const patch = { partitionKey: ACCOUNT_PK, rowKey: sub, updatedAt: new Date().toISOString() };
  if (action === "exempt") {
    patch.exempt = !!body.exempt;
  } else if (action === "seats") {
    const seats = Math.round(Number(body.seats));
    if (!Number.isFinite(seats) || seats < 0) return json(context, 400, { error: "Seats must be a number" });
    patch.paidSeats = seats;
  } else if (action === "extend") {
    const days = Math.round(Number(body.days));
    if (!Number.isFinite(days) || days < 0) return json(context, 400, { error: "Days must be a number" });
    patch.trialEndsAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  } else {
    return json(context, 400, { error: `Unknown action: ${action}` });
  }
  await table.upsertEntity(patch, "Merge");
  return json(context, 200, { ok: true, sub });
};

// ---------- Releasing the answers ----------
//
// Taking a test is silent: a student submits and nothing comes back — no
// verdict, no correct answer, no worked solution. The teacher decides when
// the paper opens, either for one student (from the marking queue) or for
// the whole class at once.
//
// Table `releases`: PK = testId, RK = username, or RK = CLASS_WIDE ("*") for
// everyone who sat it. Answering "can this student see the paper" is then two
// point reads, no scan.

const CLASS_WIDE = "*";

async function releasesTable() {
  const t = tableClient("releases");
  await ensureTable(t);
  return t;
}

/** Has `testId` been opened for `username`, individually or class-wide? */
async function isReleased(testId, username) {
  const t = await releasesTable();
  const user = String(username || "").trim().toLowerCase();
  const [cls, mine] = await Promise.all([
    t.getEntity(testId, CLASS_WIDE).then(() => true).catch(() => false),
    user ? t.getEntity(testId, user).then(() => true).catch(() => false) : Promise.resolve(false),
  ]);
  return cls || mine;
}

handlers.release = async (context, req) => {
  if (misconfigured(context)) return;
  const who = await identify(req, context);
  if (!who.kind) {
    return json(context, 401, { error: "Invalid token", reason: who.reason });
  }
  const releases = await releasesTable();

  if (req.method === "GET") {
    const q = req.query || {};

    // ?testIds=a,b,c — "which of these papers are open for me". The results
    // list asks about every test a student has handed in, and one request per
    // test would be an N+1 from a phone. Still only point reads: isReleased is
    // two getEntity calls against the test's own partition, run a few at a
    // time and capped, so this can never become a scan.
    const many = String(q.testIds || "").trim();
    if (many) {
      const ids = many
        .split(",")
        .map((id) => safeId(id, 60))
        .filter(Boolean)
        .slice(0, 50);
      const student =
        who.kind === "student" ? who.username : String(q.student || "").trim().toLowerCase();
      if (who.kind !== "student") {
        if (!student) return json(context, 400, { error: "student is required" });
        const refusal = await canSeeStudent(who, student);
        if (refusal) return refuse(context, refusal);
      }
      const released = {};
      await inBatches(ids, 10, async (id) => {
        released[id] = await isReleased(id, student);
      });
      return json(context, 200, { released });
    }

    const testId = safeId(q.testId, 60);
    if (!testId) return json(context, 400, { error: "testId is required" });

    // A student (or a parent reading a child) only needs the yes/no.
    if (who.kind === "student") {
      return json(context, 200, { released: await isReleased(testId, who.username) });
    }
    const student = String(q.student || "").trim().toLowerCase();
    if (student) {
      const refusal = await canSeeStudent(who, student);
      if (refusal) return refuse(context, refusal);
      return json(context, 200, { released: await isReleased(testId, student) });
    }

    // A teacher wants the state of the whole test.
    if (who.role !== "teacher" && who.role !== "admin") {
      return json(context, 403, { error: "Teachers only" });
    }
    const students = [];
    let classWide = null;
    const iter = releases.listEntities({
      queryOptions: {
        filter: `PartitionKey eq '${testId.replace(/'/g, "''")}'`,
        select: ["PartitionKey", "RowKey", "releasedAt", "releasedBy"],
      },
    });
    for await (const e of iter) {
      const row = { releasedAt: e.releasedAt || "", releasedBy: e.releasedBy || "" };
      if (e.rowKey === CLASS_WIDE) classWide = row;
      else students.push({ username: e.rowKey, ...row });
      if (students.length >= 500) break;
    }
    students.sort((a, b) => a.username.localeCompare(b.username));
    return json(context, 200, { testId, classWide, students });
  }

  if (req.method !== "POST") {
    return json(context, 405, { error: "Method not allowed" });
  }
  if (who.role !== "teacher" && who.role !== "admin") {
    return json(context, 403, { error: "Teachers only" });
  }

  const body = getBody(req) || {};
  const action = body.action || "release";
  if (action !== "release" && action !== "unrelease") {
    return json(context, 400, { error: `Unknown action: ${action}` });
  }
  const testId = safeId(body.testId, 60);
  if (!testId) return json(context, 400, { error: "testId is required" });

  // No username means the whole class.
  const username = String(body.username || "").trim().toLowerCase();
  if (username) {
    const refusal = await canSeeStudent(who, username);
    if (refusal) return refuse(context, refusal);
  }
  const rowKey = username || CLASS_WIDE;

  if (action === "unrelease") {
    try {
      await releases.deleteEntity(testId, rowKey);
    } catch {
      // Already closed; the caller asked for closed, so that is the outcome.
    }
    return json(context, 200, { ok: true, testId, username: username || null, released: false });
  }

  await releases.upsertEntity(
    {
      partitionKey: testId,
      rowKey,
      releasedAt: new Date().toISOString(),
      releasedBy: who.name || who.email || who.id,
    },
    "Replace"
  );
  return json(context, 200, { ok: true, testId, username: username || null, released: true });
};

// Every handler goes through the CSRF guard, rather than each one remembering
// to. Wrapping here means a handler added later is covered by default, which is
// the only way a rule like this survives.
for (const [name, fn] of Object.entries(handlers)) {
  if (SIGN_IN_HANDLERS.has(name)) continue;
  handlers[name] = async (context, req) => {
    if (csrfRefused(context, req)) return;
    return fn(context, req);
  };
}

module.exports = { handlers };
