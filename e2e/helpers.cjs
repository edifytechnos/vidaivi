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
    " storedCounts, countsFromQuestions, inBatches };"
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

// --- Bounded parallelism keeps input order ---
h.inBatches([1, 2, 3, 4, 5], 2, async (n) => n * 2).then((out) => {
  check(JSON.stringify(out) === "[2,4,6,8,10]", "inBatches keeps the input order");
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
});
