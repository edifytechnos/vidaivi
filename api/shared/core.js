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
      await students.deleteEntity("student", username);
      studentCache.drop(username); // revoke this instance's copy at once
      return json(context, 200, { ok: true, username, removedAttempts });
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
// Table "tests": PK "test", RK = test id. Questions are stored as JSON
// chunked across qc0..qcN string properties (Table Storage caps one string
// property at 64KB). Taxonomy fields (board/klass/subject) are stored from
// day one even though the UI is fixed to CBSE/12/Maths for now.

const TEST_STATUSES = ["draft", "published", "archived"];

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
    const counts = countsFromQuestions(unchunkQuestions(await tests.getEntity("test", e.rowKey)));
    await tests.updateEntity({ partitionKey: "test", rowKey: e.rowKey, ...counts }, "Merge");
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
  const iter = subjects.listEntities({
    queryOptions: { filter: `PartitionKey eq 'subject'`, select: SUBJECT_SELECT },
  });
  for await (const e of iter) {
    if (e.ownerSub !== who.id) continue;
    if ((e.board || "") === board && (e.klass || "") === klass && (e.subject || "") === subject) {
      return e.rowKey;
    }
  }
  const id = `${slugify(`${board}${klass}${subject}`)}-${crypto.randomBytes(3).toString("hex")}`;
  const entity = {
    partitionKey: "subject",
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

  if (req.method === "POST") {
    if (!isStaff) return json(context, 403, { error: "Teachers only" });
    const body = getBody(req);
    const action = body.action || "create";

    if (["publish", "unpublish", "archive", "delete"].includes(action)) {
      const id = String(body.id || "").trim();
      let entity;
      try {
        entity = await tests.getEntity("test", id);
      } catch {
        return json(context, 404, { error: "Test not found" });
      }
      if (!canManageTest(who, entity)) return json(context, 403, { error: "Not your test" });
      if (action === "delete") {
        if (entity.status !== "draft") return json(context, 400, { error: "Only drafts can be deleted — archive instead" });
        await tests.deleteEntity("test", id);
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
      await tests.updateEntity(entity, "Replace");
      return json(context, 200, { ok: true, status: entity.status });
    }

    if (action === "assign") {
      const id = String(body.id || "").trim();
      let entity;
      try {
        entity = await tests.getEntity("test", id);
      } catch {
        return json(context, 404, { error: "Test not found" });
      }
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
      await tests.updateEntity(entity, "Merge");
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
        try {
          const row = await subjects.getEntity("subject", wantSubject);
          if (row.ownerSub === who.id && !row.platform) intoSubject = row.rowKey;
        } catch {}
        if (!intoSubject) return json(context, 403, { error: "Not your subject" });
      }

      const copies = [];
      const failed = [];
      await inBatches(ids, 10, async (id) => {
        let master;
        try {
          master = await tests.getEntity("test", id);
        } catch {
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
          partitionKey: "test",
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
          partitionKey: "test",
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
      let id = String(t.id || "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "").slice(0, 60);
      if (!id) id = `${slugify(title)}-${crypto.randomInt(100, 1000)}`;
      try {
        await tests.getEntity("test", id);
        return json(context, 409, { error: `Test id already exists: ${id}` });
      } catch {}
      const entity = {
        partitionKey: "test",
        rowKey: id,
        title,
        chapter: String(t.chapter || "").slice(0, 60),
        teacher: String(t.teacher || "").slice(0, 60),
        order: Number.isFinite(Number(t.order)) ? Number(t.order) : 99,
        access: t.access === "open" ? "open" : "login",
        status: "draft",
        platform: !!t.platform && who.role === "admin",
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
        try {
          const sub = await tableClient("subjects").getEntity("subject", entity.subjectId);
          entity.board = sub.board || entity.board;
          entity.klass = sub.klass || entity.klass;
          entity.subject = sub.subject || entity.subject;
        } catch {}
      }
      chunkQuestions(entity, checked.questions);
      await tests.createEntity(entity);
      return json(context, 201, { test: testMeta(entity) });
    }

    // update
    const id = String(t.id || "").trim();
    let entity;
    try {
      entity = await tests.getEntity("test", id);
    } catch {
      return json(context, 404, { error: "Test not found" });
    }
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
    await tests.updateEntity(entity, "Replace");
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

  if (wantedId) {
    let entity;
    try {
      entity = await tests.getEntity("test", wantedId);
    } catch {
      return json(context, 404, { error: "Test not found" });
    }
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
    const it = tests.listEntities({
      queryOptions: { filter: `PartitionKey eq 'test'`, select: TEST_META_SELECT },
    });
    for await (const e of it) {
      if (e.platform && e.status === "published") {
        if (!onlySubject || (e.subjectId || "") === onlySubject) {
          masters.push(testMeta(await backfillCounts(tests, e, budget)));
        }
      } else if (e.ownerSub === who.id && e.copiedFrom) mine.add(e.copiedFrom);
    }
    for (const m of masters) m.adopted = mine.has(m.id);
    masters.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
    return json(context, 200, { tests: masters });
  }

  const wantedSubject = String((req.query && req.query.subjectId) || "").trim();
  const list = [];
  let ownedCount = 0;
  const budget = { left: COUNT_BACKFILL_BUDGET };
  const iter = tests.listEntities({
    queryOptions: { filter: `PartitionKey eq 'test'`, select: TEST_META_SELECT },
  });
  for await (const row of iter) {
    if (isStaff && row.ownerSub === who.id) ownedCount++;
    if (wantedSubject && (row.subjectId || "") !== wantedSubject) continue;
    if (!visible(row)) continue;
    const e = await backfillCounts(tests, row, budget);
    list.push(isStaff && !asChild ? testMetaForStaff(e) : testMeta(e));
    if (list.length >= 200) break;
  }
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
// can be shared later without a migration. Table "subjects": PK "subject",
// RK = subject id.

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
  const iter = subjects.listEntities({
    queryOptions: { filter: `PartitionKey eq 'subject'`, select: SUBJECT_SELECT },
  });
  for await (const e of iter) {
    // A platform subject is the library shelf: every teacher sees it, nobody
    // but an admin owns it. Students never reach here.
    if (e.platform || canUseSubject(who, e)) out.push(e);
    if (out.length >= 200) break;
  }
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
      const slug = slugify(`${board}${klass}${subject}`);
      const id = `${slug}-${crypto.randomBytes(3).toString("hex")}`;
      const entity = {
        partitionKey: "subject",
        rowKey: id,
        board,
        klass,
        subject,
        title: subjectTitle(board, klass, subject),
        platform: !!body.platform && who.role === "admin",
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
    let entity;
    try {
      entity = await subjects.getEntity("subject", id);
    } catch {
      return json(context, 404, { error: "Subject not found" });
    }
    // Same rule as canManageTest: the library shelf is the admins' to curate.
    const mayManage = entity.platform ? who.role === "admin" : entity.ownerSub === who.id;
    if (!mayManage) return json(context, 403, { error: "Not your subject" });

    if (action === "update") {
      if (board) entity.board = board;
      if (klass) entity.klass = klass;
      if (subject) entity.subject = subject;
      entity.title = subjectTitle(entity.board, entity.klass, entity.subject);
      entity.updatedAt = new Date().toISOString();
      await subjects.updateEntity(entity, "Replace");
      return json(context, 200, { subject: subjectOut(entity) });
    }

    if (action === "delete") {
      // Refuse while tests still point at it — deleting would orphan them.
      let used = 0;
      const iter = tests.listEntities({
        queryOptions: {
          filter: `PartitionKey eq 'test' and subjectId eq '${id.replace(/'/g, "''")}'`,
          select: ["PartitionKey", "RowKey"],
        },
      });
      for await (const _ of iter) {
        used++;
        break;
      }
      if (used) {
        return json(context, 400, { error: "Move or delete this subject's tests before removing it" });
      }
      await subjects.deleteEntity("subject", id);
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
      const iter = tests.listEntities({
        queryOptions: {
          filter: `PartitionKey eq 'test' and ownerSub eq '${who.id.replace(/'/g, "''")}'`,
          select: ["PartitionKey", "RowKey", "subjectId"],
        },
      });
      for await (const t of iter) {
        if (!t.subjectId) orphans.push(t);
      }
      if (orphans.length) {
        const id = `cbse12maths-${crypto.randomBytes(3).toString("hex")}`;
        const entity = {
          partitionKey: "subject",
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
            { partitionKey: "test", rowKey: t.rowKey, subjectId: id },
            "Merge"
          );
        }
        owned = [entity];
      }
    }

    const list = owned.map(subjectOut);
    // How many tests sit in each, for the card.
    const counts = {};
    const iter2 = tests.listEntities({
      queryOptions: {
        filter: `PartitionKey eq 'test'`,
        select: ["PartitionKey", "RowKey", "subjectId"],
      },
    });
    for await (const t of iter2) {
      if (t.subjectId) counts[t.subjectId] = (counts[t.subjectId] || 0) + 1;
    }
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
  const iter = tests.listEntities({
    queryOptions: {
      // A student only ever sees their own teacher's published tests, so ask
      // the table for those rather than filtering the whole platform in memory.
      filter: `PartitionKey eq 'test' and ownerSub eq '${teacherSub.replace(/'/g, "''")}' and status eq 'published'`,
      select: ["PartitionKey", "RowKey", "status", "subjectId", "platform", "ownerSub", "audience", "assignedTo"],
    },
  });
  for await (const t of iter) {
    if (t.status !== "published" || !t.subjectId) continue;
    // A subject the student has no test in is not their subject — assignment
    // included, or a narrowed test would still light up its subject card.
    if (t.platform) continue; // masters belong to the library, not to a class
    if (teacherSub && t.ownerSub === teacherSub && assignedTo(t, who.username)) {
      wanted.add(t.subjectId);
    }
  }
  const list = [];
  for (const id of wanted) {
    try {
      list.push(subjectOut(await subjects.getEntity("subject", id)));
    } catch {}
  }
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

  // A parent may read one linked child's attempts instead of their own. The
  // link row is the authority — never the username the client sent.
  const wantedChild = String((req.query && req.query.student) || "").trim().toLowerCase();
  let readAs = who.id;
  if (wantedChild) {
    const link = await childLink(who, wantedChild);
    if (!link) return json(context, 403, { error: "Not your child" });
    readAs = `stu~${link.username}`;
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
  const iter = attempts.listEntities({
    queryOptions: { filter: partition, select: ATTEMPT_LIST_SELECT },
  });
  for await (const e of iter) {
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
  json(context, 200, { attempts: list });
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
