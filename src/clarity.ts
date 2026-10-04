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

function wanted(): boolean {
  return RECORDED_HOSTS.includes(location.hostname);
}

/** Load the tag. Call once at boot; a no-op anywhere Clarity is not wanted. */
export function initClarity(): void {
  if (!wanted() || clarity()) return;
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
  c("set", "role", role);
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

/** A named moment in Clarity's own timeline — a smart event to filter on. */
export function clarityEvent(name: string): void {
  clarity()?.("event", name);
}
