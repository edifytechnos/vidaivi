// Who Clarity records (src/clarity.ts `shouldRecord`).
//
// No browser and no network: the real module is bundled with esbuild and its
// rule asserted directly. Clarity records the live hosts and nothing else,
// and never a browser driven by automation (`navigator.webdriver`) — so no
// verification run, suite or self-declared bot lands in the heatmaps.
//
//   node e2e/clarity.cjs

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
let failures = 0;
function check(pass, name) {
  console.log(`${pass ? "ok  " : "FAIL"} ${name}`);
  if (!pass) failures++;
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vidai-clarity-"));
const out = path.join(dir, "clarity.cjs");
execFileSync(
  path.join(ROOT, "node_modules/.bin/esbuild"),
  [path.join(ROOT, "src/clarity.ts"), "--bundle", "--format=cjs", "--platform=neutral", `--outfile=${out}`, "--log-level=error"],
  { stdio: ["ignore", "ignore", "inherit"] }
);
const { shouldRecord } = require(out);

check(shouldRecord("vidai.seyali.app", false), "a person on production is recorded");
check(shouldRecord("vidaivi.seyali.app", false), "and on the pre-rename host the class links still use");
check(shouldRecord("ambitious-plant-03e9c0f00-qa.eastasia.5.azurestaticapps.net", false), "and on QA");
check(!shouldRecord("vidai.seyali.app", true), "an automated browser on production is not (navigator.webdriver)");
check(!shouldRecord("ambitious-plant-03e9c0f00-qa.eastasia.5.azurestaticapps.net", true), "nor on QA, where the checks run");
check(!shouldRecord("localhost", false), "localhost never is — dev, preview and the suites");
check(!shouldRecord("evil.vidai.seyali.app.example.com", false), "a host that merely contains the name is not");

fs.rmSync(dir, { recursive: true, force: true });
console.log(failures ? `\n${failures} FAILED` : "\nall passed");
process.exit(failures ? 1 : 0);
