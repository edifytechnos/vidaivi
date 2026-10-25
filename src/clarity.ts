// Microsoft Clarity: session recordings, heatmaps and user flows.
//
// Clarity's own snippet is an inline <script>, and this app ships none —
// `script-src 'self'` holds because the build has no inline script and no
// `eval`. So the same bootstrap is written here as a module instead: it
// creates the `clarity` queue the tag expects and loads the tag from
// clarity.ms, which the CSP in `public/staticwebapp.config.json` allows by
// name. The three lines of wiring are the snippet's three lines.
//
// The project id is not a secret — it is in the page of every site that
// uses Clarity — so it lives here rather than in a build-time variable.
//
// Nothing is sent from localhost: `npm run dev`, `npm run preview` and the
// e2e suite would otherwise fill the heatmaps with a developer's clicks.
// QA traffic *is* recorded, so the policy can be checked there before it
// is live; filter it out in Clarity by hostname when reading the numbers.

const PROJECT_ID = "yrc8jndnr4";

/** Hosts that record. Everything else — localhost, a preview — stays silent. */
const RECORDED_HOSTS = [
  "vidai.seyali.app",
  "vidaivi.seyali.app",
  "ambitious-plant-03e9c0f00-qa.eastasia.5.azurestaticapps.net",
];

type ClarityFn = ((...args: unknown[]) => void) & { q?: unknown[][] };

function clarity(): ClarityFn | null {
  return ((window as any).clarity as ClarityFn | undefined) ?? null;
}

/**
 * Whether this page should be recorded at all. Only on the live hosts, and
 * never in a browser driven by automation: `navigator.webdriver` is true in
 * Playwright, Selenium and every headless check, and false in a real
 * person's browser. Without this, every verification run against QA or
 * production — and every bot that admits to being one — lands in the
 * heatmaps and the recordings as if it were a student.
 */
export function shouldRecord(host: string, automated: boolean): boolean {
  return RECORDED_HOSTS.includes(host) && !automated;
}

function wanted(): boolean {
  return shouldRecord(location.hostname, navigator.webdriver === true);
}

/**
 * Whose session may be recorded at all. Never a student's, and never a test
 * sat as a guest, who may well be a child: a recording is behavioural
 * monitoring whatever it masks (every tap, scroll and pause, timed), and
 * the DPDP Act bars that for anyone under 18 (s.9(3), in force from about
 * May 2027; J, 19 Oct: stop now). Masking hides what is on the screen; it
 * does not stop the following. Faculty, parents and admins are adults and
 * stay recorded, and so does a guest browsing the home page.
 */
export function recordsAudience(role: string | undefined, sittingAsGuest: boolean): boolean {
  if (role === "student") return false;
  return !(!role && sittingAsGuest);
}

/** Load the tag. Call once at boot; a no-op anywhere Clarity is not wanted. */
export function initClarity(who: { role?: string; sittingAsGuest: boolean }): void {
  if (!wanted() || clarity() || !recordsAudience(who.role, who.sittingAsGuest)) return;
  const w = window as any;
  // The queue the tag drains once it has loaded — the snippet's first line.
  w.clarity = function (...args: unknown[]) {
    (w.clarity.q = w.clarity.q || []).push(args);
  };
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://www.clarity.ms/tag/${PROJECT_ID}`;
  document.head.appendChild(script);
}

/**
 * Tag the session with the signed-in role, so user flows can be read per
 * audience — a teacher's path through the editor is not a student's through
 * a paper. The role is the only thing sent: never a name, an email or an id.
 */
export function tagRole(role: string | undefined): void {
  const c = clarity();
  if (!c || !role) return;
  // A student who signs in on a page that was recording stops it there and
  // then: their session is not one we record (see recordsAudience).
  if (role === "student") { stopRecording(); return; }
  c("set", "role", role);
}

/**
 * End this page's recording, for the rest of its life. Used when the person
 * turns out to be someone we do not record — a student signing in, a guest
 * opening a test. Nothing is sent after it; a reload decides afresh.
 */
export function stopRecording(): void {
  clarity()?.("stop");
}

/**
 * Tag the session with how Vidai was opened — `installed` from its own icon,
 * `browser` in a tab — so recordings, heatmaps and flows can be split by it.
 * Every session carries one or the other, so "installed" is a filter, not a
 * guess from the absence of something. Only the mode is sent.
 */
export function tagDisplay(mode: "installed" | "browser"): void {
  clarity()?.("set", "display", mode);
}

/**
 * Tag the session with the build it is running, so a recording can be read
 * against the code that was live at the time — and the sessions on either
 * side of a deploy told apart. A build id names code, never a person.
 */
export function tagBuild(build: string): void {
  clarity()?.("set", "build", build);
}

/** A named moment in Clarity's own timeline — a smart event to filter on. */
export function clarityEvent(name: string): void {
  clarity()?.("event", name);
}
