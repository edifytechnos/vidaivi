// Offline checks for the pure helpers in api/shared/core.js. No browser, no
// network, no storage account — run it any time:
//
//   node e2e/helpers.cjs
//
// It guards the invariants that the performance work depends on: the question
// counts stamped on every write (so a listing can project them instead of
// pulling every question body off the wire), and the in-process cache that
// keeps token, role and student lookups off the hot path.

process.env.STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
process.env.SESSION_SECRET = "test-secret-not-a-real-one";
// misconfigured() gates every handler on these two; the values are never used
// against a real service, since storage is faked in the handler checks below.
process.env.GOOGLE_CLIENT_ID = "e2e.apps.googleusercontent.com";

const fs = require("fs");
const path = require("path");

const CORE = path.join(__dirname, "..", "api", "shared", "core.js");
const API = path.join(__dirname, "..", "api");

// core.js exports handlers only, so evaluate it with the helpers exposed.
const mod = { exports: {} };
new Function(
  "module",
  "exports",
  "require",
  fs.readFileSync(CORE, "utf8") +
    "\nmodule.exports.__helpers = { makeCache, chunkQuestions, unchunkQuestions," +
    " storedCounts, countsFromQuestions, inBatches, lockMsFor, ipKey, digestKey," +
    " generatePassword, PW_WORDS, LOCK_AFTER, timingDecoyHash, checkPassword," +
    " signSession, verifySession, readCookie, sessionCookie, clearedCookie," +
    " renewIfStale, csrfRefused, SESSION_COOKIE, STUDENT_TOKEN_TTL_MS," +
    " totpCode, totpMatchStep, base32Encode, base32Decode, newTotpSecret," +
    " newRecoveryCodes, currentStep, TOTP_STEP_S, handlers, hashPassword };"
)(mod, mod.exports, (id) =>
  id.startsWith("@azure/") ? require(path.join(API, "node_modules", id)) : require(id)
);

const h = mod.exports.__helpers;
let failures = 0;

function check(pass, name) {
  console.log(`${pass ? "PASS " : "FAIL "} ${name}`);
  if (!pass) failures++;
}

// --- The counts are stamped on every write of questions ---
const small = {};
h.chunkQuestions(small, [{ id: "a", marks: 1 }, { id: "b", marks: 4 }]);
check(small.questionCount === 2, "chunkQuestions stamps questionCount");
check(small.totalMarks === 5, "chunkQuestions stamps totalMarks");
check(h.unchunkQuestions(small).length === 2, "questions still round-trip through the chunks");
check(
  JSON.stringify(h.storedCounts(small)) === '{"questionCount":2,"totalMarks":5}',
  "storedCounts reads the stamped counts back"
);
check(h.storedCounts({ title: "row written before this" }) === null, "storedCounts is null for a legacy row");

// A paper too big for one 30KB property must still chunk, and still count.
const big = Array.from({ length: 40 }, (_, i) => ({ id: `q${i}`, marks: 2, q: "x".repeat(2000) }));
const large = {};
h.chunkQuestions(large, big);
check(large.chunkCount > 1, "a large paper spans several chunks");
check(large.questionCount === 40 && large.totalMarks === 80, "the counts are right across chunks");
check(h.unchunkQuestions(large).length === 40, "a multi-chunk paper round-trips");

// --- The in-process cache ---
const cache = h.makeCache(2);
cache.set("a", 1, 1000);
check(cache.get("a") === 1, "cache returns a live entry");
cache.set("b", null, 1000);
check(cache.get("b") === null, "a cached absence is not a miss");
cache.set("c", 3, 1000);
check(cache.get("a") === undefined, "cache evicts past its bound");
cache.set("d", 4, -1);
check(cache.get("d") === undefined, "an expired entry is a miss");
cache.set("e", 5, 1000);
cache.drop("e");
check(cache.get("e") === undefined, "drop invalidates at once");

// --- Login throttling ---
check(h.lockMsFor(0) === 0 && h.lockMsFor(h.LOCK_AFTER.user - 1) === 0, "the first few attempts are free");
check(h.lockMsFor(h.LOCK_AFTER.user) === 30000, "the first lock is 30 seconds");
let previous = 0;
let monotonic = true;
for (let fails = h.LOCK_AFTER.user; fails < h.LOCK_AFTER.user + 10; fails++) {
  const now = h.lockMsFor(fails);
  if (now < previous) monotonic = false;
  previous = now;
}
check(monotonic, "each further failure locks for at least as long");
check(h.lockMsFor(999) === 30 * 60 * 1000, "the lock caps at 30 minutes rather than growing forever");

// A whole school behind one NAT address must not be locked out by one student
// fumbling their password — the shared bucket is far more forgiving.
check(h.LOCK_AFTER.ip > h.LOCK_AFTER.user * 5, `the IP bucket is much looser (${h.LOCK_AFTER.ip} vs ${h.LOCK_AFTER.user})`);
check(h.lockMsFor(h.LOCK_AFTER.user, "ip") === 0, "one student's five wrong tries never lock their classmates");
check(h.lockMsFor(h.LOCK_AFTER.ip, "ip") > 0, "but someone walking many accounts from one address is still stopped");

// The bucket key must never be a raw address — these are children.
const ip = h.ipKey({ headers: { "x-forwarded-for": "203.0.113.4:51514, 10.0.0.1" } });
check(/^[0-9a-f]{32}$/.test(ip), "an IP bucket key is a hex digest, not an address");
check(!ip.includes("203"), "the raw IP does not survive into the key");
check(
  ip === h.ipKey({ headers: { "x-forwarded-for": "203.0.113.4:9999" } }),
  "the same client hits the same bucket whatever the source port"
);
check(
  ip !== h.ipKey({ headers: { "x-forwarded-for": "203.0.113.5:51514" } }),
  "a different client gets a different bucket"
);
check(/^[0-9a-f]{32}$/.test(h.ipKey({ headers: {} })), "a missing header still yields a usable key");

// --- Generated passwords ---
const shape = /^[a-z]+[0-9]{2}[a-z]+$/;
const sample = new Set();
let shapeOk = true;
for (let i = 0; i < 500; i++) {
  const pw = h.generatePassword();
  if (!shape.test(pw)) shapeOk = false;
  sample.add(pw);
}
check(shapeOk, "a generated password is words and two digits, typeable off WhatsApp");
check(sample.size > 480, `500 draws are near-all distinct (${sample.size})`);
check(h.PW_WORDS.length === 64, `the word list is 64 long (${h.PW_WORDS.length})`);
check(
  new Set(h.PW_WORDS).size === h.PW_WORDS.length,
  "no word is repeated, so the space is what it claims"
);
// 64^3 x 90 = 23,592,960, against 16^2 x 90 = 23,040 before.
const space = Math.pow(h.PW_WORDS.length, 3) * 90;
check(space / 23040 === 1024, `the space is 1024x what it was (${space.toLocaleString()})`);

// --- The timing decoy really is a usable hash ---
check(h.checkPassword("timing-parity-decoy", h.timingDecoyHash()), "the decoy hash verifies its own input");
check(!h.checkPassword("something-else", h.timingDecoyHash()), "and rejects anything else");

// --- The session cookie carries what it claims, and nothing script can read ---
const cookie = h.sessionCookie("vst.aaa.bbb", 30 * 24 * 60 * 60 * 1000);
check(cookie.startsWith(`${h.SESSION_COOKIE}=vst.aaa.bbb;`), "the cookie holds the token");
check(/;\s*HttpOnly/i.test(cookie), "HttpOnly — script cannot read the session");
check(/;\s*Secure/i.test(cookie), "Secure — never sent over plain http");
check(/;\s*SameSite=Strict/i.test(cookie), "SameSite=Strict — no cross-site request carries it");
check(/;\s*Path=\//i.test(cookie), "Path=/ — the app and the API share an origin");
check(/Max-Age=2592000/.test(cookie), "Max-Age is the session's own lifetime");
check(/Max-Age=0/.test(h.clearedCookie()), "signing out expires the cookie rather than editing it");

// --- Reading one cookie out of the header ---
const req = (cookieHeader, method, headers) => ({
  method: method || "GET",
  headers: { cookie: cookieHeader, ...(headers || {}) },
});
check(h.readCookie(req("a=1; vidai_session=tok; z=2"), "vidai_session") === "tok", "readCookie finds it mid-header");
check(h.readCookie(req("vidai_session=tok"), "vidai_session") === "tok", "readCookie finds it alone");
check(h.readCookie(req("othersession=tok"), "vidai_session") === "", "readCookie does not match a longer name");
check(h.readCookie(req("vidai_session_x=tok"), "vidai_session") === "", "nor a name with a suffix");
check(h.readCookie({ headers: {} }, "vidai_session") === "", "no cookie header is not a crash");

// --- Tokens verify, and a tampered one does not ---
const tok = h.signSession("vst", "asha42", 60 * 60 * 1000, { ep: 3 });
const seen = h.verifySession("vst", tok);
check(seen && seen.username === "asha42", "a signed session verifies");
check(seen && seen.epoch === 3, "the token carries the epoch it was minted at");
check(h.verifySession("vad", tok) === null, "a student token is not an admin token");
check(h.verifySession("vst", tok.slice(0, -2) + "xx") === null, "a tampered signature is refused");
check(h.verifySession("vst", "vst.short") === null, "a malformed token is refused, not thrown");
// A signature of the wrong length used to throw out of timingSafeEqual.
check(h.verifySession("vst", "vst.YWJj.YQ") === null, "a short signature is refused, not a 500");
check(h.verifySession("vst", h.signSession("vst", "asha42", -1000, {})) === null, "an expired token is refused");

// --- Silent renewal happens once past halfway, and not before ---
const ttl = h.STUDENT_TOKEN_TTL_MS;
const fresh = { username: "asha42", issuedAt: Date.now(), expiresAt: Date.now() + ttl };
let ctx = {};
h.renewIfStale(ctx, "vst", fresh, { ep: 0 });
check(!ctx.__renewCookie, "a fresh session is not re-issued");
const stale = { username: "asha42", issuedAt: Date.now() - ttl * 0.9, expiresAt: Date.now() + ttl * 0.1 };
ctx = {};
h.renewIfStale(ctx, "vst", stale, { ep: 0 });
check(!!ctx.__renewCookie, "a session past halfway is re-issued silently");
const renewed = h.verifySession("vst", String(ctx.__renewCookie).split("=")[1].split(";")[0]);
check(renewed && renewed.expiresAt > stale.expiresAt, "and the new one runs from now, not from the old expiry");

// --- CSRF: a state-changing cookie request must carry our header ---
const captured = () => {
  const c = { res: null };
  return c;
};
let c = captured();
check(
  h.csrfRefused(c, req("vidai_session=tok", "POST")) === true && c.res.status === 403,
  "a cookie POST with no custom header is refused"
);
c = captured();
check(
  h.csrfRefused(c, req("vidai_session=tok", "POST", { "x-vidai-auth": "1" })) === false,
  "a cookie POST carrying the header is allowed"
);
c = captured();
check(
  h.csrfRefused(c, req("vidai_session=tok", "GET")) === false,
  "a read is never refused — nothing here changes state on a GET"
);
c = captured();
check(
  h.csrfRefused(c, req("", "POST")) === false,
  "a header-authenticated POST is untouched, so old tabs keep working"
);

// --- TOTP against the RFC 6238 test vectors ---
//
// This is the whole reason a hand-rolled implementation is defensible: the
// standard ships known answers, so "it agrees with my authenticator app today"
// is not what it rests on. Secret is the RFC's ASCII "12345678901234567890";
// the vectors are 8-digit, hence the explicit digits argument.
const rfcSecret = h.base32Encode(Buffer.from("12345678901234567890"));
for (const [t, want] of [
  [59, "94287082"],
  [1111111109, "07081804"],
  [1111111111, "14050471"],
  [1234567890, "89005924"],
  [2000000000, "69279037"],
  [20000000000, "65353130"], // past 2^32: proves the 64-bit counter split
]) {
  check(h.totpCode(rfcSecret, Math.floor(t / 30), 8) === want, `RFC 6238 vector at T=${t}`);
}

// --- base32 round-trips, because a mistyped key is the whole setup ---
check(h.base32Decode(h.base32Encode(Buffer.from("abc"))).toString() === "abc", "base32 round-trips a short buffer");
check(
  h.base32Decode(h.base32Encode(Buffer.from("12345678901234567890"))).toString() === "12345678901234567890",
  "and a 20-byte secret"
);
check(h.newTotpSecret().length === 32, `a generated secret is 160 bits (${h.newTotpSecret().length} base32 chars)`);
check(/^[A-Z2-7]+$/.test(h.newTotpSecret()), "and is plain base32, typeable into any authenticator");

// --- Matching accepts the window, and nothing outside it ---
const mySecret = h.newTotpSecret();
const now = Date.now();
const step = h.currentStep(now);
check(h.totpMatchStep(mySecret, h.totpCode(mySecret, step), now) === step, "the current code matches");
check(
  h.totpMatchStep(mySecret, h.totpCode(mySecret, step - 1), now) === step - 1,
  "the previous code still matches, for a slow clock"
);
check(
  h.totpMatchStep(mySecret, h.totpCode(mySecret, step + 1), now) === step + 1,
  "and the next one, for a fast clock"
);
check(
  h.totpMatchStep(mySecret, h.totpCode(mySecret, step - 2), now) === 0,
  "two steps back is refused — the window is one, not open-ended"
);
// A code that is definitely none of the three valid ones. "000000" would have
// been a one-in-a-few-hundred-thousand flake, and a test that can fail on a
// Tuesday teaches people to ignore it.
const valid = new Set([step - 1, step, step + 1].map((x) => h.totpCode(mySecret, x)));
let wrong = "000000";
for (let n = 0; valid.has(wrong); n++) wrong = String(n).padStart(6, "0");
check(h.totpMatchStep(mySecret, wrong, now) === 0, `a wrong code is refused (${wrong})`);
check(h.totpMatchStep(mySecret, "12345", now) === 0, "a five-digit code is refused without hashing anything");
check(h.totpMatchStep(mySecret, "abcdef", now) === 0, "and letters are refused");
check(h.totpMatchStep(mySecret, "", now) === 0, "and an empty code is refused");
// Returning the step, not a boolean, is what makes replay detectable: the
// caller stores it and refuses anything at or below it next time.
check(h.totpMatchStep(mySecret, h.totpCode(mySecret, step), now) > 0, "a match reports which step it was");

// --- Recovery codes ---
const codes = h.newRecoveryCodes();
check(codes.length === 8, `eight recovery codes (${codes.length})`);
check(new Set(codes).size === 8, "all distinct");
check(codes.every((c) => /^[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{2}$/.test(c)), "grouped so they can be read aloud");
check(
  codes.every((c) => c.replace(/-/g, "").length === 10),
  "40 bits each — a guess is not worth attempting against the lockout"
);

// --- The second factor, driven through the real handlers ---
//
// The pure helpers above prove the arithmetic. This proves the endpoint: that
// enabling needs a matching code, that a used code is refused the second time,
// that a wrong one is counted against the lockout while a missing one is not,
// and that a recovery code works exactly once. It runs against a fake Table
// Storage rather than Azure, so it needs no account and no network — and it
// covers the paths that would otherwise only ever be tried by hand.
async function totpHandlerChecks() {
  const rows = new Map(); // "table/pk/rk" -> entity
  const key = (t, pk, rk) => `${t}/${pk}/${rk}`;
  const fakeTable = (name) => ({
    tableName: name,
    createTable: async () => {},
    getEntity: async (pk, rk) => {
      const row = rows.get(key(name, pk, rk));
      if (!row) { const e = new Error("not found"); e.statusCode = 404; throw e; }
      return { ...row };
    },
    upsertEntity: async (e, mode) => {
      const k = key(name, e.partitionKey, e.rowKey);
      rows.set(k, mode === "Merge" ? { ...(rows.get(k) || {}), ...e } : { ...e });
    },
    updateEntity: async (e) => {
      const k = key(name, e.partitionKey, e.rowKey);
      rows.set(k, { ...(rows.get(k) || {}), ...e });
    },
    deleteEntity: async (pk, rk) => { rows.delete(key(name, pk, rk)); },
    listEntities: () => ({ [Symbol.asyncIterator]: async function* () {} }),
  });

  // These are read into consts when the module loads, so they have to be set
  // before it is built, not before it is called.
  process.env.ADMIN_USERNAME = "e2e-admin";
  process.env.ADMIN_PASSWORD = "e2e-password";
  process.env.ADMIN_EMAILS = "e2e-owner@example.com";

  // The module under test, with storage and identity swapped for fakes. Only
  // those two: everything else is the real code path, including the CSRF
  // wrapper the handlers are exported through.
  const mod2 = { exports: {} };
  const src = fs.readFileSync(CORE, "utf8")
    .replace("function tableClient(name) {", "function tableClient(name) { return __fakeTable(name); // eslint-disable-line\n  //")
    + "\nmodule.exports.__t = { handlers, adminTotp, totpCode, currentStep, newTotpSecret," +
      " signSession, GOOGLE_SESSION_TTL_MS };";
  new Function("module", "exports", "require", "__fakeTable", src)(
    mod2, mod2.exports,
    (id) => (id.startsWith("@azure/") ? require(path.join(API, "node_modules", id)) : require(id)),
    fakeTable
  );
  const t = mod2.exports.__t;

  const ctx = () => ({ res: null });
  const admin = { method: "POST", headers: { "x-vidai-auth": "1" }, body: {} };
  const call = async (name, body, method = "POST") => {
    const c = ctx();
    await t.handlers[name](c, { ...admin, method, body: body || {} });
    return { status: c.res.status, data: c.res.body || {} };
  };

  let r = await call("adminlogin", { username: "e2e-admin", password: "e2e-password" });
  check(r.status === 200, `password alone signs in while the factor is off (${r.status})`);
  const cookie = String(
    (await (async () => {
      const c = ctx();
      await t.handlers.adminlogin(c, { ...admin, body: { username: "e2e-admin", password: "e2e-password" } });
      return c.res.headers["Set-Cookie"];
    })())
  ).split("=")[1].split(";")[0];
  // The session the admin screens run as. It is a `let` because turning the
  // second factor on deliberately ends every older admin session — the request
  // that does it is handed a new cookie, and anything still holding the old one
  // is meant to be refused. Following it here is how that re-issue is tested.
  let session = cookie;
  const callAs = async (name, body, method = "POST") => {
    const c = ctx();
    await t.handlers[name](c, {
      method,
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${session}` },
      body: body || {},
    });
    const set = c.res.headers && c.res.headers["Set-Cookie"];
    return { status: c.res.status, data: c.res.body || {}, setCookie: String(set || "") };
  };

  r = await callAs("twostep", {}, "GET");
  check(r.status === 200 && r.data.enabled === false, `it starts off (${JSON.stringify(r.data)})`);

  r = await callAs("twostep", { action: "init" });
  const secret = r.data.secret;
  check(!!secret && String(r.data.uri).startsWith("otpauth://totp/"), "init hands back a secret and an otpauth uri");

  r = await callAs("twostep", { action: "enable", code: "000000" });
  check(r.status === 400, `a code that does not match will not turn it on (${r.status})`);

  const step = t.currentStep();
  r = await callAs("twostep", { action: "enable", code: t.totpCode(secret, step) });
  const recovery = r.data.recoveryCodes || [];
  check(r.status === 200, `a matching code turns it on (${r.status})`);
  check(recovery.length === 8, `and hands back eight recovery codes (${recovery.length})`);
  const reissued = /vidai_session=([^;]+)/.exec(r.setCookie);
  check(!!reissued, "turning it on re-issues this session, rather than signing the admin out of the screen they are on");
  const staleSession = session;
  if (reissued) session = reissued[1];

  // The other half of that: a session minted before the factor existed is dead.
  const stale = ctx();
  await t.handlers.twostep(stale, {
    method: "GET",
    headers: { "x-vidai-auth": "1", cookie: `vidai_session=${staleSession}` },
    body: {},
  });
  check(stale.res.status === 401, `and every other admin session is ended (${stale.res.status})`);

  // Signing in now needs the code.
  r = await call("adminlogin", { username: "e2e-admin", password: "e2e-password" });
  check(r.status === 401 && r.data.needsCode === true, `the password alone is now refused (${r.status})`);

  // The step used at enrolment is already spent — replay is refused.
  r = await call("adminlogin", { username: "e2e-admin", password: "e2e-password", code: t.totpCode(secret, step) });
  check(r.status === 401, `the code used to enrol cannot be replayed (${r.status}: ${r.data.error})`);

  // The next step's code works, once.
  const next = step + 1;
  r = await call("adminlogin", { username: "e2e-admin", password: "e2e-password", code: t.totpCode(secret, next) });
  check(r.status === 200, `a fresh code signs in (${r.status})`);
  r = await call("adminlogin", { username: "e2e-admin", password: "e2e-password", code: t.totpCode(secret, next) });
  check(r.status === 401, `and the same one is dead the second time (${r.status}: ${r.data.error})`);

  // A recovery code, exactly once.
  r = await call("adminlogin", { username: "e2e-admin", password: "e2e-password", code: recovery[0] });
  check(r.status === 200, `a recovery code signs in (${r.status})`);
  r = await call("adminlogin", { username: "e2e-admin", password: "e2e-password", code: recovery[0] });
  check(r.status === 401, `and is spent (${r.status})`);
  r = await callAs("twostep", {}, "GET");
  check(r.data.recoveryLeft === 7, `seven recovery codes left (${r.data.recoveryLeft})`);

  // The lost-phone path: an admin who signed in with Google clears it without a
  // code. They already hold every power on the platform, through an account
  // with a second factor of its own — and without this the only way back is
  // deleting a row in the Azure portal.
  const googleCookie = t.signSession("vgo", "google-sub-1", t.GOOGLE_SESSION_TTL_MS, {
    ep: 0,
    e: "e2e-owner@example.com",
    n: "Owner",
  });
  const asGoogle = ctx();
  await t.handlers.twostep(asGoogle, {
    method: "POST",
    headers: { "x-vidai-auth": "1", cookie: `vidai_session=${googleCookie}` },
    body: { action: "disable" },
  });
  check(asGoogle.res.status === 200, `a Google admin clears a stuck factor without a code (${asGoogle.res.status})`);

  // Put it back for the checks below, which are about the password session.
  // Enabling ends older admin sessions and re-issues this one, so follow it —
  // the same thing that caught the test out the first time.
  await callAs("twostep", { action: "init" });
  const again = await t.adminTotp();
  const re = await callAs("twostep", { action: "enable", code: t.totpCode(again.secret, t.currentStep() + 1) });
  const reCookie = /vidai_session=([^;]+)/.exec(re.setCookie);
  check(!!reCookie, `re-enrolling after a reset works (${re.status}: ${re.data.error || ""})`);
  if (reCookie) session = reCookie[1];
  const recovery2 = re.data.recoveryCodes || [];

  // Turning it off from the PASSWORD session needs a code, not just a session:
  // that is the case the factor exists for.
  r = await callAs("twostep", { action: "disable" });
  check(r.status === 400, `a session alone cannot switch it off (${r.status})`);
  // A code that has been used is refused here too, exactly as at sign-in.
  r = await callAs("twostep", { action: "disable", code: t.totpCode(again.secret, t.currentStep() + 1) });
  check(r.status === 400, `nor a code that has already been used (${r.status}: ${r.data.error})`);
  // Inside one 30-second window every code the skew allows has now been spent,
  // which is the rule working rather than a gap in the test. A recovery code is
  // not step-bound, and is the other thing disable accepts.
  r = await callAs("twostep", { action: "disable", code: recovery2[1] });
  check(r.status === 200, `a recovery code switches it off (${r.status}: ${r.data.error || ""})`);
  // Switching it off ends every admin session too, and re-issues this one.
  const afterOff = /vidai_session=([^;]+)/.exec(r.setCookie);
  check(!!afterOff, "and re-issues this session as well");
  if (afterOff) session = afterOff[1];
  r = await callAs("twostep", {}, "GET");
  check(r.data.enabled === false, "and it reads as off again");
}

// --- Bounded parallelism keeps input order ---
h.inBatches([1, 2, 3, 4, 5], 2, async (n) => n * 2)
  .then((out) => {
    check(JSON.stringify(out) === "[2,4,6,8,10]", "inBatches keeps the input order");
    return totpHandlerChecks();
  })
  .then(() => {
    console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.log(`FAIL  the second-factor handler checks threw: ${e.message}`);
    process.exit(1);
  });
