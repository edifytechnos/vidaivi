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

  // Enrol against the clock as the SERVER will read it, not a value captured
  // earlier: `totpMatchStep` allows +/-1 step, so a code two steps stale is
  // refused and every assertion hanging off this enrolment fails with it.
  const step = t.currentStep();
  r = await callAs("twostep", { action: "enable", code: t.totpCode(secret, t.currentStep()) });
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
  //
  // Read the clock AGAIN here rather than trusting `step + 1`. A TOTP step is
  // 30 seconds and the server re-reads its own clock on every call, so a block
  // that captures the step once and derives every later code from it breaks
  // whenever the suite happens to straddle a boundary — intermittently, and in
  // a group, because the assertions after it all depend on this one.
  const next = Math.max(step + 1, t.currentStep() + 1);
  r = await call("adminlogin", { username: "e2e-admin", password: "e2e-password", code: t.totpCode(secret, next) });
  check(r.status === 200, `a fresh code signs in (${r.status})`);
  r = await call("adminlogin", { username: "e2e-admin", password: "e2e-password", code: t.totpCode(secret, next) });
  check(r.status === 401, `and the same one is dead the second time (${r.status}: ${r.data.error})`);

  // A recovery code, exactly once.
  const recoveryLogin = ctx();
  await t.handlers.adminlogin(recoveryLogin, {
    method: "POST",
    headers: { "x-vidai-auth": "1" },
    body: { username: "e2e-admin", password: "e2e-password", code: recovery[0] },
  });
  check(recoveryLogin.res.status === 200, `a recovery code signs in (${recoveryLogin.res.status})`);
  // The session it hands back has to WORK. A live probe saw session_revoked
  // right after a recovery-code login, which would mean signing in with the
  // code you kept for a lost phone signs you straight back out again.
  const recoveryCookie = /vidai_session=([^;]+)/.exec(
    String((recoveryLogin.res.headers || {})["Set-Cookie"] || "")
  );
  const useRecoverySession = ctx();
  await t.handlers.twostep(useRecoverySession, {
    method: "GET",
    headers: { "x-vidai-auth": "1", cookie: `vidai_session=${recoveryCookie ? recoveryCookie[1] : ""}` },
    body: {},
  });
  check(
    useRecoverySession.res.status === 200,
    `and the session it hands back actually works (${useRecoverySession.res.status}: ${JSON.stringify(useRecoverySession.res.body)})`
  );
  r = { status: recoveryLogin.res.status };
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

// --- The AI assessor's daily cap, driven through the real handler ---
//
// The key is money: at about fifteen paise an assessment, a loaded key is a few
// thousand calls. This proves the brake — that the cap is counted per teacher
// per day, that the refusal is a 429, and (the part that matters) that a
// refused call never reaches the model, because the gate runs before the row
// read and the blob downloads, not after.
async function assessCapChecks() {
  const rows = new Map();
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
    createEntity: async (e) => {
      const k = key(name, e.partitionKey, e.rowKey);
      if (rows.has(k)) { const err = new Error("exists"); err.statusCode = 409; throw err; }
      rows.set(k, { ...e, etag: "W/\"1\"" });
    },
    // The real thing refuses a write whose etag has moved on. Without that
    // here, a test of the ledger's concurrency retry would pass vacuously.
    updateEntity: async (e, _mode, opts) => {
      const k = key(name, e.partitionKey, e.rowKey);
      const cur = rows.get(k);
      if (opts && opts.etag && cur && cur.etag !== opts.etag) {
        const err = new Error("stale"); err.statusCode = 412; throw err;
      }
      const version = Number(String((cur && cur.etag) || "W/\"0\"").replace(/\D/g, "")) + 1;
      rows.set(k, { ...(cur || {}), ...e, etag: `W/"${version}"` });
    },
    deleteEntity: async (pk, rk) => { rows.delete(key(name, pk, rk)); },
    listEntities: ({ queryOptions } = {}) => ({
      [Symbol.asyncIterator]: async function* () {
        const filter = (queryOptions && queryOptions.filter) || "";
        const want = /PartitionKey eq '([^']*)'/.exec(filter);
        // The real table applies a property clause too. Without this the fake
        // hands back the whole partition, and any test of "this test's
        // attempts, not that one's" passes without proving anything.
        const wantTest = /testId eq '([^']*)'/.exec(filter);
        for (const [k, row] of rows) {
          if (!k.startsWith(`${name}/`)) continue;
          if (want && row.partitionKey !== want[1]) continue;
          if (wantTest && String(row.testId || "") !== wantTest[1]) continue;
          yield { ...row };
        }
      },
    }),
  });

  // Both halves are needed to switch the feature on, so both are set here.
  process.env.AZURE_AI_ENDPOINT = "https://not-a-real-resource.openai.azure.com";
  process.env.AZURE_AI_KEY = "not-a-real-key";
  process.env.ASSESS_DAILY_CAP = "2";
  process.env.ADMIN_USERNAME = "e2e-admin";
  process.env.ADMIN_PASSWORD = "e2e-password";

  // Count what actually leaves the box. Nothing here may reach the model.
  let calls = 0;
  const realFetch = global.fetch;
  global.fetch = async () => {
    calls += 1;
    throw new Error("network is not available in this test");
  };

  const mod3 = { exports: {} };
  const src = fs.readFileSync(CORE, "utf8")
    .replace("function tableClient(name) {", "function tableClient(name) { return __fakeTable(name); // eslint-disable-line\n  //")
    + "\nmodule.exports.__t = { handlers, signSession, attemptsTable, ADMIN_TOKEN_TTL_MS, adminEpoch, aiusageTable, noteCredit, costMicroUsd, creditsFor, usageMonth, creditsAreLow, entitlements, platformRules, planCache, accountsTable, ACCOUNT_PK, GOOGLE_SESSION_TTL_MS, attemptTally, attemptLimitFor, GRANT_PREFIX, PROGRESS_PREFIX };";
  new Function("module", "exports", "require", "__fakeTable", src)(
    mod3, mod3.exports,
    (id) => (id.startsWith("@azure/") ? require(path.join(API, "node_modules", id)) : require(id)),
    fakeTable
  );
  const t = mod3.exports.__t;

  // The real shape: prefix, username (without the adm~), ttl, and the epoch
  // the handler checks the token against.
  const session = t.signSession("vad", "e2e-admin", t.ADMIN_TOKEN_TTL_MS, {
    ep: await t.adminEpoch(),
  });
  const call = async (body) => {
    const c = { res: null };
    await t.handlers.assess(c, {
      method: "POST",
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${session}` },
      body: body || {},
    });
    return { status: c.res.status, data: c.res.body || {} };
  };

  // No such student, so this stops at canSeeStudent — but only AFTER the cap
  // has been consulted, which is the ordering being proved.
  let r = await call({ username: "nobody-at-all", testId: "t", questionId: "q" });
  check(r.status === 404 || r.status === 403, `an unknown student is refused (${r.status})`);
  check(calls === 0, `and nothing was sent to the model (${calls} calls)`);

  // Spend the cap by hand, then prove the gate turns the next one away before
  // it can touch storage or the network.
  const table = await t.attemptsTable();
  const day = new Date().toISOString().slice(0, 10);
  const { createHash } = require("crypto");
  const digest = createHash("sha256").update("adm~e2e-admin").digest("hex").slice(0, 32);
  await table.upsertEntity(
    { partitionKey: "assess", rowKey: `${digest}~${day}`, count: 2 },
    "Merge"
  );

  r = await call({ username: "nobody-at-all", testId: "t", questionId: "q" });
  check(r.status === 429, `over the cap the assessor refuses (${r.status})`);
  check(
    /limit/i.test(r.data.error || ""),
    `and says why in words a teacher can act on ("${(r.data.error || "").slice(0, 60)}…")`
  );
  check(calls === 0, "a refused assessment never reaches the model");

  // --- The credit ledger ---
  //
  // Credits and the daily cap guard different things, so this clears the cap
  // first: what follows must be the credits refusing, not the cap again.
  await table.upsertEntity(
    { partitionKey: "assess", rowKey: `${digest}~${day}`, count: 0 },
    "Merge"
  );
  const ledger = await t.aiusageTable();
  const month = t.usageMonth();
  const who = { id: "adm~e2e-admin", email: "e2e@example.com", name: "E2E" };

  // Cost is computed from the token counts, in integer micro-dollars. The
  // formula's missing division is the 1e6s cancelling, so pin a known value.
  check(
    t.costMicroUsd(1_000_000, 0) === 400_000,
    `a million input tokens costs $0.40 (${t.costMicroUsd(1_000_000, 0) / 1e6})`
  );

  // Two writes landing at once must both be counted. The daily cap's
  // read-modify-write would lose one here; the ledger retries on the 412.
  await Promise.all([
    t.noteCredit(ledger, who, month, { promptTokens: 10, completionTokens: 2, costMicroUsd: 7 }),
    t.noteCredit(ledger, who, month, { promptTokens: 10, completionTokens: 2, costMicroUsd: 7 }),
  ]);
  let bal = await t.creditsFor(ledger, who.id, month);
  check(bal.used === 2, `two concurrent assessments both count (used ${bal.used})`);

  // A reply carrying no `usage` still spends the credit — and must not be
  // recorded as having cost nothing.
  await t.noteCredit(ledger, who, month, { promptTokens: 0, completionTokens: 0, costMicroUsd: 0 });
  bal = await t.creditsFor(ledger, who.id, month);
  check(bal.used === 3, `an assessment with no token counts still spends a credit (${bal.used})`);
  const report = { res: null };
  await t.handlers.aiusage(report, {
    method: "GET",
    query: {},
    headers: { "x-vidai-auth": "1", cookie: `vidai_session=${session}` },
  });
  const mine = (report.res.body.rows || []).find((r) => r.teacherId === who.id) || {};
  check(mine.costInr !== null && mine.costInr > 0, "the report prices what it knows");
  check(
    mine.promptTokens === 20 && mine.used === 3,
    `and totals tokens across calls (${mine.promptTokens} tokens, ${mine.used} used)`
  );

  // --- "Close to the limit" ---
  //
  // The boundary is the whole of this feature: one off-by-one and a teacher is
  // warned a credit too late, which is invisible until it happens to them.
  check(!t.creditsAreLow(79, 100), "79 of 100 used is not yet low");
  check(t.creditsAreLow(80, 100), "80 of 100 used is low (20% left)");
  check(t.creditsAreLow(100, 100), "and spent is still low");
  // A fraction, not a fixed ten: the same rule has to hold at another grant.
  check(!t.creditsAreLow(39, 50), "39 of 50 used is not yet low");
  check(t.creditsAreLow(40, 50), "40 of 50 used is low — the rule scales with the grant");
  check(!t.creditsAreLow(0, 0), "a grant of zero is not reported as low");

  // Spend the rest of the month's credits and prove the gate refuses in words
  // — before the network, exactly as the daily cap does.
  await ledger.upsertEntity(
    { partitionKey: month, rowKey: who.id, used: 100, granted: 100 },
    "Merge"
  );
  r = await call({ username: "nobody-at-all", testId: "t", questionId: "q" });
  check(r.status === 429, `out of credits the assessor refuses (${r.status})`);
  check(
    /credit/i.test(r.data.error || "") && /yourself/i.test(r.data.error || ""),
    `and says marking by hand still works ("${(r.data.error || "").slice(0, 70)}…")`
  );
  check(calls === 0, "no credit is spent reaching the model");

  // --- Plans, trials and limits ---
  //
  // The rules must be readable from the table rather than the code: J's
  // requirement was that a price changes without a deploy, and a test that
  // only ever sees the defaults would not notice if that broke.
  const accounts = await t.accountsTable();
  const planRows = await (async () => {
    const tbl = fakeTable("platform");
    return tbl;
  })();

  const teacher = { kind: "google", id: "goo~trial", role: "teacher", email: "t@example.com", name: "T" };
  const admin = { kind: "admin", id: "adm~e2e-admin", role: "admin" };

  let ent = await t.entitlements(teacher);
  check(ent.subjects === 1 && ent.tests === 3, `a new account gets the trial (${ent.subjects} subject, ${ent.tests} tests)`);
  check(ent.students === 3, `and the trial's student seats (${ent.students})`);

  ent = await t.entitlements(admin);
  check(ent.exempt === true, "an admin is never gated by the plan they set");

  // Chose teacher, trial expired yesterday → the paid plan's shape.
  await accounts.upsertEntity(
    {
      partitionKey: t.ACCOUNT_PK,
      rowKey: teacher.id,
      chose: "teacher",
      trialEndsAt: new Date(Date.now() - 86400000).toISOString(),
      paidSeats: 0,
      exempt: false,
    },
    "Merge"
  );
  ent = await t.entitlements(teacher);
  check(ent.plan === "teacher", `a lapsed trial with a choice becomes the paid plan (${ent.plan})`);
  check(ent.subjects === 0 && ent.tests === 0, "which lifts subjects and tests (0 means no limit)");
  check(ent.students === 2, `but keeps the free seats (${ent.students})`);

  // Paid seats add to the free ones.
  await accounts.upsertEntity(
    { partitionKey: t.ACCOUNT_PK, rowKey: teacher.id, paidSeats: 5 },
    "Merge"
  );
  ent = await t.entitlements(teacher);
  check(ent.students === 7, `paid seats add to the free ones (${ent.students})`);

  // The whole point of the settings row: a number changes without a deploy.
  await planRows.upsertEntity(
    { partitionKey: "plan", rowKey: "current", teacherFreeStudents: 10 },
    "Merge"
  );
  t.planCache.drop("current");
  ent = await t.entitlements(teacher);
  check(
    ent.students === 15,
    `an admin raising the free seats changes the limit with no deploy (${ent.students})`
  );

  // --- Choosing a role, through the real handler ---
  //
  // This is the one moment that decides which product a person gets, and it
  // happens exactly once. The UI cannot be driven without a real Google
  // account, so the rules that matter are proved here instead.
  const freshSub = "goo~fresh-signup";
  const goog = t.signSession("vgo", freshSub, t.GOOGLE_SESSION_TTL_MS, {
    ep: 0,
    e: "fresh@example.com",
    n: "Fresh",
  });
  const asGoogle = async (body, method) => {
    const c = { res: null };
    await t.handlers.accounts(c, {
      method: method || "POST",
      query: {},
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${goog}` },
      body: body || {},
    });
    return { status: c.res.status, data: c.res.body || {} };
  };

  let r2 = await asGoogle({ action: "choose", chose: "wizard" });
  check(r2.status === 400, `an unknown role is refused (${r2.status})`);

  r2 = await asGoogle({ action: "choose", chose: "teacher" });
  check(r2.status === 200 && r2.data.chose === "teacher", `choosing teacher works (${r2.status})`);
  check(
    Date.parse(r2.data.trialEndsAt) > Date.now(),
    `and starts the trial there and then (${String(r2.data.trialEndsAt).slice(0, 10)})`
  );

  // Once. Re-picking would restart the trial at will, and would move a roster
  // of real children between two kinds of account.
  r2 = await asGoogle({ action: "choose", chose: "parent" });
  check(r2.status === 409, `the choice cannot be made twice (${r2.status})`);
  r2 = await asGoogle(null, "GET");
  check(r2.data.chose === "teacher", `and the first choice stands (${r2.data.chose})`);
  check(r2.data.plan === "trial", `a fresh account is on trial, not exempt (${r2.data.plan})`);
  check(
    r2.data.limits.subjects === 1 && r2.data.limits.students === 3,
    `with the trial's limits (${r2.data.limits.subjects} subject, ${r2.data.limits.students} students)`
  );

  // A signed-in teacher must not be able to set the platform's prices.
  r2 = await asGoogle({ action: "rules", subjectPaise: 1 });
  check(r2.status === 403, `a teacher cannot change the pricing (${r2.status})`);

  // --- Two attempts per ready-made test ---
  //
  // `copiedFrom` is the whole test: a row carrying it came from the library.
  // A teacher's own paper has none and is never capped.
  const rulesNow = await t.platformRules();
  check(t.attemptLimitFor({ copiedFrom: "lib-c10-1" }, rulesNow) === 2, "a library copy allows 2 attempts");
  check(t.attemptLimitFor({ copiedFrom: "" }, rulesNow) === 0, "a teacher's own test is uncapped (0)");
  check(t.attemptLimitFor(null, rulesNow) === 0, "and a test that cannot be read is not capped by accident");

  // The tally reads hand-ins, and must not miscount the two other row shapes
  // that share the partition.
  const att = fakeTable("attempts");
  const stu = "stu~tally-kid";
  await att.upsertEntity({ partitionKey: stu, rowKey: "9999~t1", testId: "t1" }, "Merge");
  await att.upsertEntity({ partitionKey: stu, rowKey: "9998~t1", testId: "t1" }, "Merge");
  await att.upsertEntity(
    { partitionKey: stu, rowKey: `${t.PROGRESS_PREFIX}t1`, testId: "t1" },
    "Merge"
  );
  let tally = await t.attemptTally(att, stu, "t1");
  check(tally.used === 2, `two hand-ins count as two (${tally.used})`);
  check(tally.extra === 0, "and nothing is granted yet");

  // A paper still being written is not a hand-in — counting it would spend an
  // attempt on a student who is mid-question.
  await att.upsertEntity({ partitionKey: stu, rowKey: `${t.PROGRESS_PREFIX}t2`, testId: "t2" }, "Merge");
  tally = await t.attemptTally(att, stu, "t2");
  check(tally.used === 0, `a paper in progress spends nothing (${tally.used})`);

  // The teacher's grant lives in the same partition and must be read, never
  // counted as an attempt.
  await att.upsertEntity(
    { partitionKey: stu, rowKey: `${t.GRANT_PREFIX}t1`, testId: "t1", extra: 1 },
    "Merge"
  );
  tally = await t.attemptTally(att, stu, "t1");
  check(
    tally.used === 2 && tally.extra === 1,
    `a granted attempt is read, not counted (used ${tally.used}, extra ${tally.extra})`
  );

  // Another test in the same partition must not bleed into this one.
  await att.upsertEntity({ partitionKey: stu, rowKey: "9997~other", testId: "other" }, "Merge");
  tally = await t.attemptTally(att, stu, "t1");
  check(tally.used === 2, `another test's attempts stay out of this count (${tally.used})`);

  // Exempt lifts everything, and is what protects the pilot class.
  await accounts.upsertEntity(
    { partitionKey: t.ACCOUNT_PK, rowKey: teacher.id, exempt: true },
    "Merge"
  );
  ent = await t.entitlements(teacher);
  check(ent.exempt && ent.subjects === 0 && ent.students === 0, "an exempt account is gated by nothing");

  global.fetch = realFetch;
  delete process.env.AZURE_AI_ENDPOINT;
  delete process.env.AZURE_AI_KEY;
  delete process.env.ASSESS_DAILY_CAP;
}

// --- Removing a student removes their answers and their photographs ---
//
// `remove` used to delete the login and the attempts and stop, which left the
// `grading` rows and every uploaded photo behind for good — and nothing could
// reach them afterwards, because `answerimage`'s own remove keys on the
// caller's own partition. Vidai holds photographs of minors' handwriting, so
// "remove this student" has to mean the photographs go too.
//
// This drives the real handler against a fake Table Storage and a fake blob
// container, so it needs no account and no network.
async function studentRemoveCascadeChecks() {
  const rows = new Map();
  const key = (t, pk, rk) => `${t}/${pk}/${rk}`;
  const pkOf = (filter) => {
    const m = /PartitionKey eq '((?:[^']|'')*)'/.exec(String(filter || ""));
    return m ? m[1].replace(/''/g, "'") : null;
  };
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
    // Unlike the other harnesses this one really lists, because the cascade is
    // only meaningful if the rows it walks are actually there.
    listEntities: (opts) => {
      const want = pkOf(opts && opts.queryOptions && opts.queryOptions.filter);
      const hits = [];
      for (const [k, row] of rows) {
        if (!k.startsWith(`${name}/`)) continue;
        if (want !== null && row.partitionKey !== want) continue;
        hits.push({ ...row });
      }
      return { [Symbol.asyncIterator]: async function* () { for (const r of hits) yield r; } };
    },
  });

  // Every blob the handler asks to delete is recorded here.
  const deleted = [];
  const blobs = new Set();
  const fakeContainer = () => ({
    getBlockBlobClient: (name) => ({
      deleteIfExists: async () => {
        deleted.push(name);
        return { succeeded: blobs.delete(name) };
      },
    }),
  });

  process.env.ADMIN_USERNAME = "e2e-admin";
  process.env.ADMIN_PASSWORD = "e2e-password";

  const mod = { exports: {} };
  const src = fs.readFileSync(CORE, "utf8")
    .replace("function tableClient(name) {", "function tableClient(name) { return __fakeTable(name); // eslint-disable-line\n  //")
    .replace("async function answerContainer() {", "async function answerContainer() { return __fakeContainer(); // eslint-disable-line\n  //")
    + "\nmodule.exports.__t = { handlers, signSession, ADMIN_TOKEN_TTL_MS, adminEpoch };";
  new Function("module", "exports", "require", "__fakeTable", "__fakeContainer", src)(
    mod, mod.exports,
    (id) => (id.startsWith("@azure/") ? require(path.join(API, "node_modules", id)) : require(id)),
    fakeTable, fakeContainer
  );
  const t = mod.exports.__t;

  const session = t.signSession("vad", "e2e-admin", t.ADMIN_TOKEN_TTL_MS, {
    ep: await t.adminEpoch(),
  });

  // One student of this admin, with two attempts and three graded answers
  // carrying four photographs between them.
  const user = "cascadekid7";
  const pk = `stu~${user}`;
  rows.set(key("students", "student", user), {
    partitionKey: "student", rowKey: user, teacherSub: "adm~e2e-admin", name: "Cascade Kid",
  });
  rows.set(key("attempts", pk, "t1"), { partitionKey: pk, rowKey: "t1" });
  rows.set(key("attempts", pk, "t2"), { partitionKey: pk, rowKey: "t2" });
  const photo = (n) => `${pk}/t1/q${n}/1789000000000-abc${n}.jpg`;
  rows.set(key("grading", pk, "t1~q1"), {
    partitionKey: pk, rowKey: "t1~q1", images: JSON.stringify([photo(1), photo(2)]),
  });
  rows.set(key("grading", pk, "t1~q2"), {
    partitionKey: pk, rowKey: "t1~q2", images: JSON.stringify([photo(3)]), status: "marked",
  });
  rows.set(key("grading", pk, "t2~q1"), {
    partitionKey: pk, rowKey: "t2~q1", images: JSON.stringify([photo(4)]),
  });
  [1, 2, 3, 4].forEach((n) => blobs.add(photo(n)));

  // A second student's row, to prove the cascade stays inside one partition.
  const other = "stu~someoneelse9";
  rows.set(key("grading", other, "t9~q1"), {
    partitionKey: other, rowKey: "t9~q1", images: JSON.stringify([`${other}/t9/q1/keep.jpg`]),
  });
  blobs.add(`${other}/t9/q1/keep.jpg`);

  const c = { res: null };
  await t.handlers.students(c, {
    method: "POST",
    headers: { "x-vidai-auth": "1", cookie: `vidai_session=${session}` },
    body: { action: "remove", username: user },
  });
  const out = (c.res && c.res.body) || {};

  check(c.res.status === 200, `removing a student succeeds (${c.res.status})`);
  check(out.removedAttempts === 2, `its two attempts go (${out.removedAttempts})`);
  check(out.removedAnswers === 3, `its three graded answers go (${out.removedAnswers})`);
  check(out.removedPhotos === 4, `and all four photographs go (${out.removedPhotos})`);

  check(!rows.has(key("students", "student", user)), "the login itself is gone");
  const left = [...rows.keys()].filter((k) => k.startsWith("grading/") && k.includes(pk));
  check(left.length === 0, `no grading row is left behind (${left.length})`);
  check(blobs.size === 1, `no photograph is left in the container (${blobs.size} left)`);

  // The one that would have been a silent disaster: a cascade that walked the
  // whole table instead of one partition.
  check(
    rows.has(key("grading", other, "t9~q1")) && blobs.has(`${other}/t9/q1/keep.jpg`),
    "another student's answers and photos are untouched"
  );
  check(
    deleted.every((n) => n.startsWith(pk + "/")),
    `only this student's blobs were asked for (${deleted.length} deletes)`
  );

  delete process.env.ADMIN_USERNAME;
  delete process.env.ADMIN_PASSWORD;
}

/**
 * The re-partition: tests and subjects live in their owner's partition.
 *
 * The thing worth asserting is not that a listing returns the right rows —
 * a table scan returns those too, which is exactly how the old code passed —
 * but WHICH PARTITIONS IT ASKED FOR. So this harness records every filter the
 * handlers issue and checks the set, and the fake table refuses to answer a
 * query that names no PartitionKey at all, the way a well-keyed table should.
 */
async function partitionChecks() {
  const rows = new Map();
  const key = (t, pk, rk) => `${t}/${pk}/${rk}`;
  const pkOf = (filter) => {
    const m = /PartitionKey eq '((?:[^']|'')*)'/.exec(String(filter || ""));
    return m ? m[1].replace(/''/g, "'") : null;
  };
  // Every partition each table was asked about, in order.
  let asked = { tests: [], subjects: [] };
  const resetAsked = () => { asked = { tests: [], subjects: [] }; };

  const fakeTable = (name) => ({
    tableName: name,
    createTable: async () => {},
    getEntity: async (pk, rk) => {
      const row = rows.get(key(name, pk, rk));
      if (!row) { const e = new Error("not found"); e.statusCode = 404; throw e; }
      return { ...row };
    },
    createEntity: async (e) => {
      const k = key(name, e.partitionKey, e.rowKey);
      if (rows.has(k)) { const err = new Error("exists"); err.statusCode = 409; throw err; }
      rows.set(k, { ...e });
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
    listEntities: (opts) => {
      const filter = opts && opts.queryOptions && opts.queryOptions.filter;
      const want = pkOf(filter);
      // Rule 2 has teeth here: a query with no PartitionKey is the bug this
      // whole change removes, so the harness treats it as one.
      if (want === null) throw new Error(`unpartitioned query on ${name}: ${filter}`);
      if (asked[name]) asked[name].push(want);
      const hits = [];
      for (const [k, row] of rows) {
        if (!k.startsWith(`${name}/`)) continue;
        if (row.partitionKey !== want) continue;
        hits.push({ ...row });
      }
      return { [Symbol.asyncIterator]: async function* () { for (const r of hits) yield r; } };
    },
  });

  process.env.ADMIN_USERNAME = "e2e-admin";
  process.env.ADMIN_PASSWORD = "e2e-password";

  const mod = { exports: {} };
  const src = fs.readFileSync(CORE, "utf8")
    .replace("function tableClient(name) {", "function tableClient(name) { return __fakeTable(name); // eslint-disable-line\n  //")
    + "\nmodule.exports.__t = { handlers, signSession, ADMIN_TOKEN_TTL_MS, STUDENT_TOKEN_TTL_MS, adminEpoch, PLATFORM_PK, chunkQuestions };";
  new Function("module", "exports", "require", "__fakeTable", src)(
    mod, mod.exports,
    (id) => (id.startsWith("@azure/") ? require(path.join(API, "node_modules", id)) : require(id)),
    fakeTable
  );
  const t = mod.exports.__t;

  const ME = "adm~e2e-admin";
  const OTHER = "another-teacher-sub-99";
  const session = t.signSession("vad", "e2e-admin", t.ADMIN_TOKEN_TTL_MS, {
    ep: await t.adminEpoch(),
  });
  const call = async (method, opts = {}) => {
    const c = { res: null };
    await t.handlers[opts.handler || "tests"](c, {
      method,
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${opts.cookie || session}` },
      query: opts.query || {},
      body: opts.body,
    });
    return { status: c.res.status, body: c.res.body || {} };
  };
  const seed = (table, row) => rows.set(key(table, row.partitionKey, row.rowKey), row);
  const testRow = (over) => {
    const row = {
      title: "T", chapter: "C", teacher: "", order: 1, access: "login",
      status: "published", platform: false, audience: "class", assignedTo: "[]",
      board: "CBSE", klass: "12", subject: "Maths", subjectId: "",
      createdAt: "2026-01-01", updatedAt: "2026-01-01", ...over,
    };
    t.chunkQuestions(row, over.questions || [
      { id: "q1", chapter: "C", topic: "T", type: "numeric", q: "2+2?", answer: 4, tolerance: 0, solution: "four", marks: 2 },
    ]);
    delete row.questions;
    return row;
  };

  // --- a new test lands in its owner's partition ---------------------------
  const made = await call("POST", {
    body: { action: "create", test: { title: "Mine", questions: [
      { id: "q1", chapter: "C", topic: "T", type: "numeric", q: "1+1?", answer: 2, tolerance: 0, solution: "two", marks: 1 },
    ] } },
  });
  check(made.status === 201, `creating a test succeeds (${made.status})`);
  const mineId = made.body.test && made.body.test.id;
  check(!!rows.get(key("tests", ME, mineId)), "a new test lands in its owner's partition");
  check(!rows.get(key("tests", "test", mineId)), "and nothing is written to the old constant partition");

  // --- a master lands in the library's own partition -----------------------
  const master = await call("POST", {
    body: { action: "create", test: { title: "Master", platform: true, questions: [
      { id: "q1", chapter: "C", topic: "T", type: "numeric", q: "3+3?", answer: 6, tolerance: 0, solution: "six", marks: 1 },
    ] } },
  });
  const masterId = master.body.test && master.body.test.id;
  check(!!rows.get(key("tests", t.PLATFORM_PK, masterId)), "a master lands in the library's partition");
  check(!rows.get(key("tests", ME, masterId)), "and not in the admin's own");
  // Only a published master reaches the library listing, so publish it through
  // the handler — which also proves a status change finds a row by partition.
  const pub = await call("POST", { body: { action: "publish", id: masterId } });
  check(pub.status === 200, `a master can be published (${pub.status})`);
  check(
    (rows.get(key("tests", t.PLATFORM_PK, masterId)) || {}).status === "published",
    "and the status change lands on the row in the library's partition"
  );

  // --- another teacher's work, and a legacy row that predates the change ---
  seed("tests", testRow({ partitionKey: OTHER, rowKey: "theirs-1", ownerSub: OTHER, title: "Theirs" }));
  seed("tests", testRow({
    partitionKey: "test", rowKey: "legacy-1", ownerSub: ME, title: "Legacy",
    questions: [
      { id: "lq1", chapter: "C", topic: "T", type: "numeric", q: "9+9?", answer: 18, tolerance: 0, solution: "eighteen", marks: 3 },
    ],
  }));

  // --- the teacher's own listing ------------------------------------------
  resetAsked();
  const list = await call("GET");
  const ids = (list.body.tests || []).map((x) => x.id);
  check(ids.includes(mineId), "a teacher's listing carries their own test");
  check(ids.includes("legacy-1"), "and a row the re-partition has not reached yet");
  check(!ids.includes("theirs-1"), "and never another teacher's");
  check(
    !asked.tests.includes(OTHER),
    `the listing never asks for another teacher's partition (asked: ${asked.tests.join(", ")})`
  );
  check(
    asked.tests.every((pk) => [ME, t.PLATFORM_PK, "test"].includes(pk)),
    `it asks only for its own, the library's and the legacy partition (asked: ${asked.tests.join(", ")})`
  );

  // --- and that listing moved the legacy row, questions intact -------------
  const moved = rows.get(key("tests", ME, "legacy-1"));
  check(!!moved, "reading a legacy row moves it into its owner's partition");
  check(!rows.get(key("tests", "test", "legacy-1")), "and the legacy copy is gone");
  let carried = "";
  for (let i = 0; i < ((moved || {}).chunkCount || 0); i++) carried += moved[`qc${i}`] || "";
  check(
    JSON.parse(carried || "[]")[0] &&
      JSON.parse(carried)[0].q === "9+9?",
    "and every question came with it — the move is not built from the projection"
  );

  // --- another teacher's test is not reachable by id ----------------------
  const theirs = await call("GET", { query: { id: "theirs-1" } });
  check(theirs.status === 404, `another teacher's test reads as missing (${theirs.status})`);

  // --- the library listing asks the library, not the platform -------------
  resetAsked();
  const lib = await call("GET", { query: { library: "1" } });
  check(
    (lib.body.tests || []).some((x) => x.id === masterId),
    "the library listing finds the master"
  );
  check(
    asked.tests.every((pk) => [t.PLATFORM_PK, ME, "test"].includes(pk)),
    `and asks only the library, the caller and legacy (asked: ${asked.tests.join(", ")})`
  );

  // --- an edit to a legacy row moves it and keeps the new content ----------
  seed("tests", testRow({
    partitionKey: "test", rowKey: "legacy-2", ownerSub: ME, status: "draft", title: "Old name",
  }));
  const edited = await call("POST", {
    body: { action: "update", test: { id: "legacy-2", title: "New name", questions: [
      { id: "q1", chapter: "C", topic: "T", type: "numeric", q: "5+5?", answer: 10, tolerance: 0, solution: "ten", marks: 1 },
    ] } },
  });
  check(edited.status === 200, `a legacy row can still be edited (${edited.status})`);
  const after = rows.get(key("tests", ME, "legacy-2"));
  check(!!after && after.title === "New name", "the edit lands in the real partition");
  check(!rows.get(key("tests", "test", "legacy-2")), "and leaves no legacy twin to lose it to a drain");

  // --- a stale legacy twin never overwrites the newer row ------------------
  //
  // saveRow writes the real partition first and deletes the legacy twin
  // second, so an interrupted move leaves both — with the REAL one newer by
  // construction. A drain that copied the legacy copy across would undo the
  // edit that wrote it, which is the one way this migration could silently
  // lose a teacher's work.
  seed("tests", testRow({
    partitionKey: ME, rowKey: "twin-1", ownerSub: ME, status: "draft", title: "Edited since",
  }));
  seed("tests", testRow({
    partitionKey: "test", rowKey: "twin-1", ownerSub: ME, status: "draft", title: "Stale copy",
  }));
  await call("GET");
  const survivor = rows.get(key("tests", ME, "twin-1"));
  check(
    !!survivor && survivor.title === "Edited since",
    `the newer row survives a drain that meets its stale twin (${(survivor || {}).title})`
  );
  check(!rows.get(key("tests", "test", "twin-1")), "and the stale twin is dropped, not copied");

  // --- a student sees their own teacher's partition and nothing else -------
  const STUDENT = "partkid5";
  seed("students", {
    partitionKey: "student", rowKey: STUDENT, teacherSub: ME, name: "Part Kid", tokenEpoch: 0,
  });
  const stuCookie = t.signSession("vst", STUDENT, t.STUDENT_TOKEN_TTL_MS, { ep: 0 });
  seed("tests", testRow({
    partitionKey: ME, rowKey: "forclass-1", ownerSub: ME, status: "published", subjectId: "sub-a",
  }));
  seed("subjects", {
    partitionKey: ME, rowKey: "sub-a", board: "CBSE", klass: "12", subject: "Maths",
    title: "CBSE Class 12 Maths", ownerSub: ME, collaborators: "[]", createdAt: "2026-01-01",
  });
  resetAsked();
  const stuList = await call("GET", { cookie: stuCookie });
  const stuIds = (stuList.body.tests || []).map((x) => x.id);
  check(stuIds.includes("forclass-1"), "a student sees their teacher's published test");
  check(!stuIds.includes(masterId), "and never a library master directly");
  check(
    asked.tests.every((pk) => [ME, "test"].includes(pk)),
    `a student's listing asks only their teacher's partition (asked: ${asked.tests.join(", ")})`
  );
  check(
    !asked.tests.includes(t.PLATFORM_PK),
    "and never walks the library it cannot see"
  );

  resetAsked();
  const stuSubjects = await call("GET", { cookie: stuCookie, handler: "subjects" });
  check(
    (stuSubjects.body.subjects || []).some((x) => x.id === "sub-a"),
    "their subject list is derived from those tests"
  );
  check(
    asked.tests.every((pk) => [ME, "test"].includes(pk)),
    `and reads one teacher's test partition only (tests: ${asked.tests.join(", ")})`
  );
  // The subjects themselves are not listed at all: a test's subject is owned by
  // the same teacher, so each one is a point read in that partition.
  check(
    asked.subjects.length === 0,
    `the subjects behind them are point reads, never a listing (asked: ${asked.subjects.join(", ")})`
  );

  // --- the unscoped listing does not walk the library at all --------------
  //
  // Every client that asks for this list unscoped filters the masters out, so
  // sending them was 125 rows and 65 KB per render to discard. Asserting the
  // PARTITION is the point: filtering them out of the response would look
  // identical from the outside while still reading every one of them.
  resetAsked();
  const plain = await call("GET");
  check(
    !asked.tests.includes(t.PLATFORM_PK),
    `an unscoped staff listing never walks the library (asked: ${asked.tests.join(", ")})`
  );
  check(
    !(plain.body.tests || []).some((x) => x.platform),
    "and no master reaches the response"
  );
  check(
    (plain.body.tests || []).some((x) => x.id === mineId),
    "while the caller's own tests are all still there"
  );
  check(
    plain.body.needsSamples === false,
    `ownedCount still sees the caller's own work, so needsSamples is unchanged (${plain.body.needsSamples})`
  );

  // A master still sitting in the legacy partition must not slip through
  // either: the partition list cannot keep it out, because the legacy walk
  // reads whatever is there. Otherwise the answer would depend on how far the
  // migration had got.
  seed("tests", testRow({
    partitionKey: "test", rowKey: "legacy-master-1", ownerSub: ME,
    platform: true, status: "published",
  }));
  resetAsked();
  const plain2 = await call("GET");
  check(
    !(plain2.body.tests || []).some((x) => x.id === "legacy-master-1"),
    "nor does a master the drain has not reached yet"
  );

  // --- but an explicit ask still gets them --------------------------------
  resetAsked();
  const withPlat = await call("GET", { query: { platform: "1" } });
  check(
    asked.tests.includes(t.PLATFORM_PK),
    `platform=1 walks the library (asked: ${asked.tests.join(", ")})`
  );
  check(
    (withPlat.body.tests || []).some((x) => x.id === masterId),
    "and the masters come back"
  );

  // --- a shelf-scoped listing gets them without asking --------------------
  seed("subjects", {
    partitionKey: t.PLATFORM_PK, rowKey: "shelf-2", board: "CBSE", klass: "12", subject: "Maths",
    title: "A shelf", ownerSub: ME, platform: true, collaborators: "[]", createdAt: "2026-01-01",
  });
  seed("tests", testRow({
    partitionKey: t.PLATFORM_PK, rowKey: "shelf-master-1", ownerSub: ME,
    platform: true, status: "published", subjectId: "shelf-2",
  }));
  resetAsked();
  const shelfList = await call("GET", { query: { subjectId: "shelf-2" } });
  check(
    asked.tests.includes(t.PLATFORM_PK),
    `a shelf-scoped listing walks the library (asked: ${asked.tests.join(", ")})`
  );
  check(
    (shelfList.body.tests || []).some((x) => x.id === "shelf-master-1"),
    "so an admin opening a shelf still sees its masters"
  );

  // --- a teacher's own subject does not ------------------------------------
  seed("tests", testRow({
    partitionKey: ME, rowKey: "insub-1", ownerSub: ME, status: "draft", subjectId: "sub-a",
  }));
  resetAsked();
  const ownList = await call("GET", { query: { subjectId: "sub-a" } });
  check(
    !asked.tests.includes(t.PLATFORM_PK),
    `their own subject does not — the editor's every open (asked: ${asked.tests.join(", ")})`
  );
  check(
    (ownList.body.tests || []).some((x) => x.id === "insub-1"),
    "and still carries that subject's tests"
  );

  // --- a teacher's subject list ------------------------------------------
  seed("subjects", {
    partitionKey: OTHER, rowKey: "sub-theirs", board: "CBSE", klass: "10", subject: "Maths",
    title: "Theirs", ownerSub: OTHER, collaborators: "[]", createdAt: "2026-01-01",
  });
  seed("subjects", {
    partitionKey: t.PLATFORM_PK, rowKey: "shelf-1", board: "CBSE", klass: "10", subject: "Maths",
    title: "CBSE Class 10 Maths", ownerSub: ME, platform: true, collaborators: "[]", createdAt: "2026-01-01",
  });
  resetAsked();
  const subs = await call("GET", { handler: "subjects" });
  const subIds = (subs.body.subjects || []).map((x) => x.id);
  check(subIds.includes("sub-a"), "a teacher's subject list carries their own subject");
  check(subIds.includes("shelf-1"), "and every library shelf");
  check(!subIds.includes("sub-theirs"), "and never another teacher's");
  check(
    !asked.subjects.includes(OTHER) && !asked.tests.includes(OTHER),
    `without ever asking for their partition (subjects: ${asked.subjects.join(", ")})`
  );
}

/**
 * The role a Google account runs as, and what a parent may reach.
 *
 * Two bugs met here. Picking "I teach a class" wrote `chose` to the accounts
 * row and nothing ever read it back, so the role stayed the allowlist's
 * default and the teacher landed in the parent's app. And a parent — sold a
 * subject, three tests and three children — was refused at every gate that
 * asked "teacher or admin", so the plan they were sold could not be used.
 *
 * Driven through the real handlers against a fake table, because the thing to
 * prove is what a *request* is answered, not what a predicate returns.
 */
async function roleChoiceChecks() {
  const rows = new Map();
  const key = (t, pk, rk) => `${t}/${pk}/${rk}`;
  const pkOf = (filter) => {
    const m = /PartitionKey eq '((?:[^']|'')*)'/.exec(String(filter || ""));
    return m ? m[1].replace(/''/g, "'") : null;
  };
  const fakeTable = (name) => ({
    tableName: name,
    createTable: async () => {},
    getEntity: async (pk, rk) => {
      const row = rows.get(key(name, pk, rk));
      if (!row) { const e = new Error("not found"); e.statusCode = 404; throw e; }
      return { ...row };
    },
    createEntity: async (e) => {
      const k = key(name, e.partitionKey, e.rowKey);
      if (rows.has(k)) { const err = new Error("exists"); err.statusCode = 409; throw err; }
      rows.set(k, { ...e });
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
    listEntities: (opts) => {
      const filter = opts && opts.queryOptions && opts.queryOptions.filter;
      const want = pkOf(filter);
      if (want === null) throw new Error(`unpartitioned query on ${name}: ${filter}`);
      // Property clauses are honoured, not ignored. A fake that hands back the
      // whole partition makes "somebody else's child is not in this list" pass
      // while proving nothing — the same vacuity the `testId eq` clause had.
      const wantTeacher = /teacherSub eq '((?:[^']|'')*)'/.exec(filter);
      const hits = [];
      for (const [k, row] of rows) {
        if (!k.startsWith(`${name}/`)) continue;
        if (row.partitionKey !== want) continue;
        if (wantTeacher && String(row.teacherSub || "") !== wantTeacher[1].replace(/''/g, "'")) continue;
        hits.push({ ...row });
      }
      return { [Symbol.asyncIterator]: async function* () { for (const r of hits) yield r; } };
    },
  });

  const mod = { exports: {} };
  const src = fs.readFileSync(CORE, "utf8")
    .replace("function tableClient(name) {", "function tableClient(name) { return __fakeTable(name); // eslint-disable-line\n  //")
    + "\nmodule.exports.__t = { handlers, signSession, GOOGLE_SESSION_TTL_MS, PLATFORM_PK, chunkQuestions, resolveRole, roleCache };";
  new Function("module", "exports", "require", "__fakeTable", src)(
    mod, mod.exports,
    (id) => (id.startsWith("@azure/") ? require(path.join(API, "node_modules", id)) : require(id)),
    fakeTable
  );
  const t = mod.exports.__t;

  const SUB = "google-sub-1001";
  const EMAIL = "someone@example.com";
  const cookie = t.signSession("vgo", SUB, t.GOOGLE_SESSION_TTL_MS, { ep: 0, e: EMAIL, n: "Someone" });
  const call = async (handler, method, opts = {}) => {
    const c = { res: null };
    await t.handlers[handler](c, {
      method,
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${cookie}` },
      query: opts.query || {},
      body: opts.body,
    });
    return { status: c.res.status, body: c.res.body || {} };
  };

  // --- an account with no choice yet is not a teacher ----------------------
  check((await t.resolveRole(EMAIL, SUB)) === "parent", "an account that has chosen nothing is not a teacher");

  // --- choosing teacher makes the app the teacher's ------------------------
  const chose = await call("accounts", "POST", { body: { action: "choose", chose: "teacher" } });
  check(chose.status === 200, `choosing a role succeeds (${chose.status})`);
  check(chose.body.role === "teacher", "and the answer names the role, so the client can store it");
  check(
    (await t.resolveRole(EMAIL, SUB)) === "teacher",
    "and the very next request is served as a teacher — the cache was dropped, not left to expire"
  );

  // --- choosing once, and only once ----------------------------------------
  const again = await call("accounts", "POST", { body: { action: "choose", chose: "parent" } });
  check(again.status === 409, `the choice cannot be re-picked (${again.status})`);
  check((await t.resolveRole(EMAIL, SUB)) === "teacher", "and the refused pick changed nothing");

  // --- but the allowlist still guards issuing a login to a child -----------
  const issue = await call("students", "POST", { body: { action: "create", name: "A Child" } });
  check(issue.status === 403, `a self-declared teacher cannot issue a student login (${issue.status})`);
  check(
    /approv/i.test(issue.body.error || ""),
    `and is told it is waiting for approval, not simply refused ("${issue.body.error}")`
  );

  // --- a parent reaches the library and holds a subject --------------------
  const PSUB = "google-sub-2002";
  const PEMAIL = "parent@example.com";
  const pcookie = t.signSession("vgo", PSUB, t.GOOGLE_SESSION_TTL_MS, { ep: 0, e: PEMAIL, n: "A Parent" });
  const pcall = async (handler, method, opts = {}) => {
    const c = { res: null };
    await t.handlers[handler](c, {
      method,
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${pcookie}` },
      query: opts.query || {},
      body: opts.body,
    });
    return { status: c.res.status, body: c.res.body || {} };
  };
  const pchose = await pcall("accounts", "POST", { body: { action: "choose", chose: "parent" } });
  check(pchose.body.role === "parent", `picking parent answers parent (${pchose.status})`);

  // A shelf and one published master to read off it.
  rows.set(key("subjects", t.PLATFORM_PK, "shelf-x"), {
    partitionKey: t.PLATFORM_PK, rowKey: "shelf-x", board: "CBSE", klass: "10", subject: "Maths",
    title: "CBSE Class 10 Maths", platform: true, ownerSub: "", collaborators: "[]",
  });
  const masterRow = {
    partitionKey: t.PLATFORM_PK, rowKey: "lib-x-1", title: "Real Numbers", chapter: "1",
    status: "published", platform: true, ownerSub: "", audience: "class", assignedTo: "[]",
    board: "CBSE", klass: "10", subject: "Maths", subjectId: "shelf-x", order: 1,
  };
  t.chunkQuestions(masterRow, [
    { id: "q1", chapter: "1", topic: "HCF", type: "numeric", q: "HCF of 6 and 8?", answer: 2, tolerance: 0, solution: "two", marks: 1 },
  ]);
  rows.set(key("tests", t.PLATFORM_PK, "lib-x-1"), masterRow);

  const lib = await pcall("tests", "GET", { query: { library: "1" } });
  check(lib.status === 200, `a parent can read the built-in library (${lib.status})`);
  check(
    (lib.body.tests || []).some((x) => x.id === "lib-x-1"),
    "and the masters are actually in it — the thing a parent is meant to buy"
  );
  const shelves = await pcall("subjects", "GET");
  check(
    (shelves.body.subjects || []).some((x) => x.id === "shelf-x"),
    "a parent sees the library's shelves"
  );
  const took = await pcall("tests", "POST", { body: { action: "adopt", ids: ["lib-x-1"] } });
  check(took.status === 200 || took.status === 201, `a parent can take a copy of a built-in test (${took.status})`);
  const copy = [...rows.values()].find((r) => r.copiedFrom === "lib-x-1");
  check(!!copy && copy.ownerSub === PSUB, "and the copy is theirs, in their own partition");
  check(copy && copy.platform === false, "and is no longer a master");

  // --- a parent adds their own children, and the allowlist is not the gate --
  const child = await pcall("students", "POST", { body: { action: "create", name: "My Child" } });
  check(child.status === 201, `a parent can add their own child (${child.status})`);
  check(!!JSON.stringify(child.body).match(/"password"/), `and is shown the password once (${JSON.stringify(child.body).slice(0, 120)})`);

  // --- a child the parent CREATED appears in their own children list ------
  // This read only ever walked `parentlinks`, the invite-code route. A child
  // the parent issued themselves lands in `students` with teacherSub set to
  // their sub and no link row at all — so it was written, it counted against
  // their seats, and it appeared nowhere. "I added a child and nothing
  // happened" was exactly true.
  {
    const c = { res: null };
    await t.handlers.parentlink(c, {
      method: "GET",
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${pcookie}` },
      query: {},
    });
    const kids = (c.res.body.children || []);
    check(c.res.status === 200, `a parent reads their children (${c.res.status})`);
    check(kids.length === 1, `the child they just created is in the list (${kids.length})`);
    check(kids[0] && kids[0].name === "My Child", `and is named (${kids[0] && kids[0].name})`);
    check(kids[0] && kids[0].own === true, "and is marked as their own, not a linked one");
  }

  // --- somebody else's child is not in it ---------------------------------
  rows.set(key("students", "student", "someone-elses"), {
    partitionKey: "student", rowKey: "someone-elses", name: "Not Mine",
    teacherSub: "a-different-account", tokenEpoch: 0,
  });
  {
    const c = { res: null };
    await t.handlers.parentlink(c, {
      method: "GET",
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${pcookie}` },
      query: {},
    });
    const names = (c.res.body.children || []).map((k) => k.username);
    check(!names.includes("someone-elses"), `and another account's child is not (${names.join(", ")})`);
  }

  // --- a student still reaches none of it ---------------------------------
  const scookie = t.signSession("vst", "a-student", t.GOOGLE_SESSION_TTL_MS, { ep: 0 });
  rows.set(key("students", "student", "a-student"), {
    partitionKey: "student", rowKey: "a-student", name: "A Student",
    teacherSub: PSUB, tokenEpoch: 0, passwordHash: "x", salt: "y",
  });
  const sres = { res: null };
  await t.handlers.tests(sres, {
    method: "GET",
    headers: { "x-vidai-auth": "1", cookie: `vidai_session=${scookie}` },
    query: { library: "1" },
  });
  check(sres.res.status === 403, `a student is still refused the library (${sres.res.status})`);
}

/**
 * The teacher's report says what a paper actually is.
 *
 * `handlers.reports` pushed every row in the student's partition with no
 * status, so a paper still being written — which carries a running auto-graded
 * subtotal and an EMPTY completedAt — was shown as a finished attempt scoring
 * 4/26 at "1 Jan, 5:30 am". A teacher's granted extra attempt was in there too,
 * reading as a test the student handed in and never sat.
 */
async function reportStatusChecks() {
  const rows = new Map();
  const key = (t, pk, rk) => `${t}/${pk}/${rk}`;
  const pkOf = (filter) => {
    const m = /PartitionKey eq '((?:[^']|'')*)'/.exec(String(filter || ""));
    return m ? m[1].replace(/''/g, "'") : null;
  };
  const fakeTable = (name) => ({
    tableName: name,
    createTable: async () => {},
    getEntity: async (pk, rk) => {
      const row = rows.get(key(name, pk, rk));
      if (!row) { const e = new Error("not found"); e.statusCode = 404; throw e; }
      return { ...row };
    },
    createEntity: async (e) => { rows.set(key(name, e.partitionKey, e.rowKey), { ...e }); },
    upsertEntity: async (e, mode) => {
      const k = key(name, e.partitionKey, e.rowKey);
      rows.set(k, mode === "Merge" ? { ...(rows.get(k) || {}), ...e } : { ...e });
    },
    updateEntity: async (e) => {
      const k = key(name, e.partitionKey, e.rowKey);
      rows.set(k, { ...(rows.get(k) || {}), ...e });
    },
    deleteEntity: async (pk, rk) => { rows.delete(key(name, pk, rk)); },
    listEntities: (opts) => {
      const filter = opts && opts.queryOptions && opts.queryOptions.filter;
      const want = pkOf(filter);
      if (want === null) throw new Error(`unpartitioned query on ${name}: ${filter}`);
      // Property clauses are honoured, not ignored. A fake that hands back the
      // whole partition makes "somebody else's child is not in this list" pass
      // while proving nothing — the same vacuity the `testId eq` clause had.
      const wantTeacher = /teacherSub eq '((?:[^']|'')*)'/.exec(filter);
      const hits = [];
      for (const [k, row] of rows) {
        if (!k.startsWith(`${name}/`)) continue;
        if (row.partitionKey !== want) continue;
        if (wantTeacher && String(row.teacherSub || "") !== wantTeacher[1].replace(/''/g, "'")) continue;
        hits.push({ ...row });
      }
      return { [Symbol.asyncIterator]: async function* () { for (const r of hits) yield r; } };
    },
  });

  // ADMIN_EMAILS and TEACHER_EMAILS are read at MODULE LOAD, so they have to be
  // set before the module is built — set afterwards they do nothing and every
  // call comes back 403.
  process.env.TEACHER_EMAILS = "t@example.com";
  process.env.ADMIN_EMAILS = "a@example.com";

  const mod = { exports: {} };
  const src = fs.readFileSync(CORE, "utf8")
    .replace("function tableClient(name) {", "function tableClient(name) { return __fakeTable(name); // eslint-disable-line\n  //")
    + "\nmodule.exports.__t = { handlers, signSession, GOOGLE_SESSION_TTL_MS, chunkQuestions };";
  new Function("module", "exports", "require", "__fakeTable", src)(
    mod, mod.exports,
    (id) => (id.startsWith("@azure/") ? require(path.join(API, "node_modules", id)) : require(id)),
    fakeTable
  );
  const t = mod.exports.__t;

  const TEACHER = "teacher-sub-3003";
  const cookie = t.signSession("vgo", TEACHER, t.GOOGLE_SESSION_TTL_MS, { ep: 0, e: "t@example.com", n: "T" });

  rows.set(key("students", "student", "priya"), {
    partitionKey: "student", rowKey: "priya", name: "Priya", school: "", grade: "10",
    parentPhone: "", teacherSub: TEACHER, tokenEpoch: 0,
  });
  // A finished paper.
  rows.set(key("attempts", "stu~priya", "89999~t1"), {
    partitionKey: "stu~priya", rowKey: "89999~t1", testId: "t1",
    score: 20, total: 26, completedAt: "2026-09-14T10:00:00.000Z",
  });
  // One still being written: a running subtotal and no completedAt.
  rows.set(key("attempts", "stu~priya", "progress~t2"), {
    partitionKey: "stu~priya", rowKey: "progress~t2", testId: "t2",
    score: 4, total: 26, completedAt: "", updatedAt: "2026-09-15T09:00:00.000Z", index: 3,
  });
  // And a teacher's granted extra attempt, which is a marker and not a paper.
  rows.set(key("attempts", "stu~priya", "grant~t1"), {
    partitionKey: "stu~priya", rowKey: "grant~t1", testId: "t1", extra: 1,
  });

  const c = { res: null };
  await t.handlers.reports(c, {
    method: "GET",
    headers: { "x-vidai-auth": "1", cookie: `vidai_session=${cookie}` },
    query: { username: "priya" },
  });
  const got = (c.res.body.students || [])[0] || {};
  const list = got.attempts || [];
  check(c.res.status === 200, `a teacher reads their student's report (${c.res.status})`);
  check(list.length === 2, `the grant row is not a paper (${list.length} rows, expected 2)`);
  const done = list.find((a) => a.testId === "t1");
  const live = list.find((a) => a.testId === "t2");
  check(done && done.status === "done", "a handed-in paper says so");
  check(live && live.status === "progress", "and one still being written says THAT, rather than nothing");
  check(
    live && live.score === 4 && !live.completedAt,
    "the running subtotal is still sent — the client decides not to show it as a mark"
  );
  check(live && live.updatedAt === "2026-09-15T09:00:00.000Z", "with when they last worked on it");

  // --- the admin's reset puts an account back to its FIRST screen ----------
  // The phone number lives on the profile, not the account row, so clearing
  // the choice alone left it behind — and phone capture only ever asks when
  // there is no number stored, so the step was silently skipped on every
  // retry of the sign-up flow.
  {
    const ADMIN = "admin-sub-4004";
    const acookie = t.signSession("vgo", ADMIN, t.GOOGLE_SESSION_TTL_MS, { ep: 0, e: "a@example.com", n: "A" });
    const SUB = "google-sub-5005";
    rows.set(key("accounts", "account", SUB), {
      partitionKey: "account", rowKey: SUB, chose: "teacher", email: "who@example.com",
      trialEndsAt: "2099-01-01T00:00:00.000Z", exempt: false,
    });
    rows.set(key("profiles", "profile", SUB), {
      partitionKey: "profile", rowKey: SUB, name: "Who", email: "who@example.com", phone: "9884948041",
    });
    const c3 = { res: null };
    await t.handlers.accounts(c3, {
      method: "POST",
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${acookie}` },
      query: {},
      body: { action: "reset", sub: SUB },
    });
    const acct = rows.get(key("accounts", "account", SUB)) || {};
    const prof = rows.get(key("profiles", "profile", SUB)) || {};
    check(c3.res.status === 200, `an admin can reset an account (${c3.res.status})`);
    check(!acct.chose && !acct.trialEndsAt, "the choice and the trial are cleared");
    check(!prof.phone, `and the saved phone number with them (got ${JSON.stringify(prof.phone)})`);
    check(prof.name === "Who", "while the rest of the profile is left alone");
  }

  // --- an unfinished attempt names its holder, and can be discarded --------
  // Publishing is refused while somebody is part-way through, which is right.
  // But the ONLY thing that cleared that row was the same account handing the
  // paper in, so an abandoned paper — or a teacher's own preview left open —
  // locked the test for good, and the refusal named nobody to chase.
  {
    const OWNER = TEACHER;
    const testRow = {
      partitionKey: OWNER, rowKey: "poly-1", title: "Polynomials", chapter: "Chapter Test 2",
      status: "draft", platform: false, ownerSub: OWNER, audience: "class", assignedTo: "[]",
      board: "CBSE", klass: "10", subject: "Maths", subjectId: "sub-1", order: 2,
    };
    t.chunkQuestions(testRow, [
      { id: "q1", chapter: "C", topic: "T", type: "numeric", q: "2+2?", answer: 4, tolerance: 0, solution: "four", marks: 1 },
    ]);
    rows.set(key("tests", OWNER, "poly-1"), testRow);
    // The author's own half-finished preview.
    rows.set(key("attempts", OWNER, "progress~poly-1"), {
      partitionKey: OWNER, rowKey: "progress~poly-1", testId: "poly-1", score: 0, total: 1, index: 0,
    });

    const blocked = { res: null };
    await t.handlers.tests(blocked, {
      method: "POST",
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${cookie}` },
      query: {},
      body: { action: "publish", id: "poly-1" },
    });
    check(blocked.res.status === 409, `publishing is refused while a paper is open (${blocked.res.status})`);
    check(
      /yourself/i.test(blocked.res.body.error || ""),
      `and says it is the author's own preview ("${blocked.res.body.error}")`
    );
    check(
      (blocked.res.body.inProgress || []).some((h) => h.self),
      "and hands back who is holding it, so the client can offer a way out"
    );

    const gone = { res: null };
    await t.handlers.attempts(gone, {
      method: "POST",
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${cookie}` },
      query: {},
      body: { action: "discard", testId: "poly-1" },
    });
    check(gone.res.status === 200, `the author can discard their own preview (${gone.res.status})`);
    check(!rows.get(key("attempts", OWNER, "progress~poly-1")), "and the row is actually gone");

    const ok = { res: null };
    await t.handlers.tests(ok, {
      method: "POST",
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${cookie}` },
      query: {},
      body: { action: "publish", id: "poly-1" },
    });
    check(ok.res.status === 200, `and the test publishes (${ok.res.status})`);
    check(
      (rows.get(key("tests", OWNER, "poly-1")) || {}).status === "published",
      "with the row actually published"
    );

    // --- and somebody else's test is not theirs to clear --------------------
    rows.set(key("tests", "another-owner", "theirs-9"), {
      partitionKey: "another-owner", rowKey: "theirs-9", title: "Theirs",
      status: "draft", platform: false, ownerSub: "another-owner",
    });
    rows.set(key("attempts", "another-owner", "progress~theirs-9"), {
      partitionKey: "another-owner", rowKey: "progress~theirs-9", testId: "theirs-9",
    });
    const nope = { res: null };
    await t.handlers.attempts(nope, {
      method: "POST",
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${cookie}` },
      query: {},
      body: { action: "discard", testId: "theirs-9" },
    });
    check(nope.res.status === 404 || nope.res.status === 403, `another owner's test cannot be cleared (${nope.res.status})`);
    check(
      !!rows.get(key("attempts", "another-owner", "progress~theirs-9")),
      "and their in-progress row is untouched"
    );
  }

  // --- an unusable completion time never reaches the row -------------------
  // `typeof "" === "string"`, so an empty one used to be stored as the moment
  // the paper was handed in — and an empty date renders as the Unix epoch,
  // which in IST reads "1 Jan, 5:30 am".
  const scookie = t.signSession("vst", "priya", t.GOOGLE_SESSION_TTL_MS, { ep: 0 });
  for (const [given, label] of [["", "an empty"], ["   ", "a blank"], ["not a date", "an unparseable"]]) {
    const c2 = { res: null };
    await t.handlers.attempts(c2, {
      method: "POST",
      headers: { "x-vidai-auth": "1", cookie: `vidai_session=${scookie}` },
      query: {},
      body: { testId: `t-${label.split(" ")[1]}`, score: 5, total: 10, completedAt: given },
    });
    const saved = [...rows.values()].find((r) => r.testId === `t-${label.split(" ")[1]}`);
    check(
      !!saved && Number.isFinite(Date.parse(saved.completedAt)) && Date.parse(saved.completedAt) > 0,
      `${label} completion time is replaced with a real one (got ${JSON.stringify(saved && saved.completedAt)})`
    );
  }
}

// --- Bounded parallelism keeps input order ---
h.inBatches([1, 2, 3, 4, 5], 2, async (n) => n * 2)
  .then((out) => {
    check(JSON.stringify(out) === "[2,4,6,8,10]", "inBatches keeps the input order");
    return totpHandlerChecks();
  })
  .then(() => assessCapChecks())
  .then(() => studentRemoveCascadeChecks())
  .then(() => partitionChecks())
  .then(() => roleChoiceChecks())
  .then(() => reportStatusChecks())
  .then(() => {
    console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
    process.exit(failures ? 1 : 0);
  })
  .catch((e) => {
    console.log(`FAIL  the second-factor handler checks threw: ${e.message}`);
    process.exit(1);
  });
