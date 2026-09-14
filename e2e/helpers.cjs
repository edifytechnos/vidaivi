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
    " newRecoveryCodes, currentStep, TOTP_STEP_S };"
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

// --- Bounded parallelism keeps input order ---
h.inBatches([1, 2, 3, 4, 5], 2, async (n) => n * 2).then((out) => {
  check(JSON.stringify(out) === "[2,4,6,8,10]", "inBatches keeps the input order");
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
});
