// scripts/carry-assets.sh against a stubbed `gh`.
//
// No network and no GitHub: a stub `gh` on PATH answers `run list` with a
// fixed set of run ids and `run download` from fixture directories, so what
// is proved is the script's contract: the last `keep` runs that HAVE the
// artifact are carried, a run without one is skipped and does not use up a
// slot, a run beyond `keep` is ignored, this build's own file is never
// overwritten, the job summary is written, and a `gh` that fails leaves the
// build exactly as it was and exits 0 — nothing here may fail a deploy.
//
//   node e2e/carry.cjs

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const SCRIPT = path.join(ROOT, "scripts/carry-assets.sh");

let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-carry-"));
const bin = path.join(dir, "bin");
const fixtures = path.join(dir, "fixtures");
fs.mkdirSync(bin);
fs.mkdirSync(fixtures);

// The stub: `gh run list …` prints $RUNS (one id per line, or fails when
// $GH_FAIL is set); `gh run download <id> -n <name> -D <dir>` copies the
// fixture for that id, or fails when there is none.
fs.writeFileSync(
  path.join(bin, "gh"),
  `#!/bin/sh
echo "$@" >> "$GH_LOG"
if [ -n "\${GH_FAIL:-}" ]; then exit 1; fi
case "$1 $2" in
  "run list") printf '%s\\n' "$RUNS" ;;
  "run download")
    src="$FIXTURES/$3"
    [ -d "$src" ] || exit 1
    mkdir -p "$7" && cp -R "$src"/. "$7"/ ;;
  *) exit 2 ;;
esac
`
);
fs.chmodSync(path.join(bin, "gh"), 0o755);

function fixture(id, files) {
  const d = path.join(fixtures, String(id));
  fs.mkdirSync(d, { recursive: true });
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(d, name), body);
}
// Newest first, as gh lists them. 103 has no artifact; 105 is beyond keep=3.
fixture(101, { "chunk-a1.js": "a1", "index-new.js": "FROM 101 — must not win" });
fixture(102, { "chunk-b2.js": "b2", "chunk-b3.js": "b3", "font-same.woff2": "font" });
fixture(104, { "chunk-d4.js": "d4", "font-same.woff2": "font" });
fixture(105, { "chunk-e5.js": "e5" });

function run(env, dest, extra = []) {
  const summary = path.join(dir, `summary-${Math.random().toString(36).slice(2)}.md`);
  const log = path.join(dir, `gh-${Math.random().toString(36).slice(2)}.log`);
  let out = "";
  let code = 0;
  try {
    out = execFileSync("bash", [SCRIPT, "prod-assets", dest, ...extra], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FIXTURES: fixtures, GITHUB_STEP_SUMMARY: summary, GH_LOG: log, ...env },
      encoding: "utf8",
    });
  } catch (e) {
    code = e.status;
    out = String(e.stdout || "") + String(e.stderr || "");
  }
  return { out, code, summary: fs.existsSync(summary) ? fs.readFileSync(summary, "utf8") : "", log: fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "" };
}

// ---------- The ordinary deploy ----------
const dest = path.join(dir, "dist-assets");
fs.mkdirSync(dest);
fs.writeFileSync(path.join(dest, "index-new.js"), "THIS BUILD");
fs.writeFileSync(path.join(dest, "font-same.woff2"), "font");
const r = run({ RUNS: "101\n102\n103\n104\n105" }, dest, ["main"]);
const have = fs.readdirSync(dest).sort();
check(r.code === 0, `exits 0 (${r.code})`);
check(["chunk-a1.js", "chunk-b2.js", "chunk-b3.js", "chunk-d4.js"].every((f) => have.includes(f)), `the last three builds' chunks are carried (${have.join(", ")})`);
check(!have.includes("chunk-e5.js"), "a fourth build is not (keep=3), and the run with no artifact did not use a slot");
check(fs.readFileSync(path.join(dest, "index-new.js"), "utf8") === "THIS BUILD", "this build's own file is never overwritten");
check(/carried 4 file\(s\) from 3 previous build\(s\)/.test(r.out), `the count is right (${r.out.trim()})`);
// 102 carries two, not three: its font already exists in this build.
check(/run 101: 1 file/.test(r.summary) && /run 102: 2 file/.test(r.summary) && /run 104: 1 file/.test(r.summary), `the job summary lists each run and its count (${r.summary.replace(/\n/g, " | ")})`);
check(/--branch main/.test(r.log), "the listing is filtered to the branch asked for");
check(/--status success/.test(r.log), "and to successful runs only");

// ---------- No branch filter (QA) ----------
const dest2 = path.join(dir, "qa-assets");
fs.mkdirSync(dest2);
const r2 = run({ RUNS: "104" }, dest2);
check(r2.code === 0 && !/--branch/.test(r2.log) && fs.existsSync(path.join(dest2, "chunk-d4.js")), "without a branch, every successful run of the workflow is a candidate");

// ---------- Nothing to carry yet ----------
const dest3 = path.join(dir, "first");
fs.mkdirSync(dest3);
const r3 = run({ RUNS: "103" }, dest3);
check(r3.code === 0 && fs.readdirSync(dest3).length === 0 && /Nothing yet/.test(r3.summary), "a first deploy with no artifacts anywhere ships as it is and says so");

// ---------- gh itself fails ----------
const dest4 = path.join(dir, "broken");
fs.mkdirSync(dest4);
fs.writeFileSync(path.join(dest4, "index-new.js"), "THIS BUILD");
const r4 = run({ RUNS: "101", GH_FAIL: "1" }, dest4);
check(r4.code === 0, "a gh failure exits 0 — it can never fail the deploy");
check(fs.readdirSync(dest4).join() === "index-new.js" && /nothing carried forward/.test(r4.out), "and leaves the build exactly as it was");

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
