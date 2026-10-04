// A tab left open across a deploy heals itself.
//
// Every deploy replaces the whole site, and the previous build's hashed files
// go with it. A tab loaded before the deploy still runs the old bundle, and
// the first time it needs a part it had not loaded yet — KaTeX for a question
// with maths, Browse tests, the PDF reader — that file is gone: two 404s, an
// unhandled rejection, and a button that does nothing. Five releases landed
// in one afternoon and a teacher reported the app as crashed.
//
// Vite dispatches `vite:preloadError` on the window whenever a dynamic import
// or its CSS fails to load. The page itself is served `no-cache`, so one
// reload picks up the new build, and the address bar carries the place — a
// student's `?test=&q=`, a teacher's `?edit=&q=` — so the reload lands where
// the tap was aimed. Only the Seyari AI conversation is lost, since it lives
// in the page.
//
// Once, not forever: a build that is genuinely broken must not spin the tab
// in a reload loop. A reload within `RELOAD_WINDOW_MS` of the last one is
// refused and the error is left to surface as it did before.

const KEY = "vidai:staleReload";
const RELOAD_WINDOW_MS = 30_000;

function lastReload(): number {
  try {
    return Number(sessionStorage.getItem(KEY) || 0);
  } catch {
    return 0;
  }
}

function noteReload(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {}
}

/** True when a reload is allowed now — the first failure, or one long after the last reload. */
export function shouldReload(now = Date.now()): boolean {
  return now - lastReload() > RELOAD_WINDOW_MS;
}

/** Call once at boot. Reloads the page on the first chunk-load failure, and never twice in a row. */
export function installStaleBuildRecovery(): void {
  window.addEventListener("vite:preloadError", (event) => {
    if (!shouldReload()) return;
    // Stop Vite re-throwing it — the reload is the handling. One failed
    // import usually arrives as two events (the chunk's CSS, then the chunk);
    // the second lands inside the window, is left to throw its own clear
    // "Failed to fetch dynamically imported module" in a page that is
    // already unloading, and that line is what App Insights records.
    event.preventDefault();
    noteReload();
    location.reload();
  });
}
