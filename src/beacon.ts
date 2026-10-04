// The version beacon: an open tab learns a new build is live, and moves onto
// it at a moment nobody is in the middle of anything.
//
// Every build stamps its own id into the bundle (__VIDAI_BUILD__) and writes
// the same id to /version.json. A tab asks for that file every few minutes,
// and again when it comes back into view; a different id means a newer build
// is live. Nothing happens then — the update is only *armed*.
//
// The reload happens at the next move the person makes from one screen to
// another (a question, a subject, Back), because the screen is changing under
// them anyway and the address bar already names where they are going, so the
// reload lands exactly there. It is refused while anything would be lost:
//
//   - a write is still on its way to the server (an answer, a photo, a mark,
//     the editor's autosave) — it is waited out for a few seconds, never
//     aborted;
//   - a dialog is open, or a text field has focus;
//   - a screen says it holds unsaved work (`holdUpdatesWhile`): the editor
//     while a save is pending, Seyari while a conversation exists.
//
// Refused is not lost: the update stays armed and the next move tries again.
// After the reload a one-line notice says what happened.
//
// Since the deploy carries the previous builds' chunks forward
// (scripts/carry-assets.sh) an old tab no longer breaks, so this is the
// nicety on top: everyone is on the current build within one move of it
// shipping, instead of whenever they next happen to reload.

import { track } from "./analytics";
import { clarityEvent, tagBuild } from "./clarity";
import { notice } from "./dialog";
import { onNavigate } from "./dom";

declare const __VIDAI_BUILD__: string;

/** The build this tab is running. */
export const BUILD = typeof __VIDAI_BUILD__ === "string" ? __VIDAI_BUILD__ : "dev";

const POLL_MS = 5 * 60_000;
/** Coming back to the tab checks again, but not more often than this. */
const RECHECK_MS = 60_000;
/** How long a move waits for writes in flight before giving up until the next. */
const WRITE_WAIT_MS = 5_000;
/** One reload per target build in this window, so a stale edge cannot loop a tab. */
const SAME_TARGET_MS = 30 * 60_000;

const RELOADED_KEY = "vidai:beaconReload";
const NOTICE_KEY = "vidai:updated";

let latest: string | null = null;
let lastCheck = 0;
let writes = 0;
const holds: (() => boolean)[] = [];

/**
 * A screen with work the reload would throw away registers a check here; while
 * it answers true, the update waits.
 */
export function holdUpdatesWhile(check: () => boolean): void {
  holds.push(check);
}

/**
 * Count a write while it is in flight. A reload aborts every request the page
 * has open, and a read is simply asked again by the new page — a write is
 * somebody's answer.
 */
export function trackWrite<T>(request: Promise<T>): Promise<T> {
  writes += 1;
  return request.finally(() => {
    writes -= 1;
  });
}

/** True when a newer build than this one is live. */
export function updateArmed(): boolean {
  return latest !== null && latest !== BUILD;
}

function readReloaded(): { build: string; at: number } | null {
  try {
    const raw = localStorage.getItem(RELOADED_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Already reloaded for this very build, recently, and still not on it. */
function alreadyTried(target: string): boolean {
  const last = readReloaded();
  return !!last && last.build === target && Date.now() - last.at < SAME_TARGET_MS;
}

/** Ask which build is live. Never throws; a failed check changes nothing. */
export async function checkVersion(): Promise<void> {
  lastCheck = Date.now();
  try {
    const res = await fetch("/version.json", { cache: "no-store" });
    if (!res.ok) return;
    const { build } = (await res.json()) as { build?: unknown };
    if (typeof build !== "string" || !build || build === BUILD) return;
    if (alreadyTried(build)) return;
    if (latest !== build) {
      track("update_armed", { from: BUILD, to: build });
      clarityEvent("update_armed");
    }
    latest = build;
  } catch {
    // Offline, or the file is not there: nothing to learn this time.
  }
}

/** Anything on screen that a reload would lose. */
function somethingOpen(): boolean {
  if (document.body.classList.contains("modal-open")) return true;
  const el = document.activeElement as HTMLElement | null;
  if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) {
    const type = (el as HTMLInputElement).type;
    if (!/^(button|submit|radio|checkbox|reset)$/.test(type)) return true;
  }
  return holds.some((check) => {
    try {
      return check();
    } catch {
      return true;
    }
  });
}

function reloadNow(): void {
  try {
    localStorage.setItem(RELOADED_KEY, JSON.stringify({ build: latest, at: Date.now() }));
    sessionStorage.setItem(NOTICE_KEY, "1");
  } catch {
    // Without storage there is no loop guard, so do not reload at all.
    return;
  }
  track("update_applied", { from: BUILD, to: latest ?? "" });
  clarityEvent("update_applied");
  location.reload();
}

let waiting = false;

/** A move was made: if an update is armed and nothing would be lost, take it. */
function atMove(): void {
  if (!updateArmed() || waiting || somethingOpen()) return;
  if (writes === 0) return reloadNow();
  // A save went out with the tap that moved them. Wait for it rather than
  // abort it, but only while the person does nothing else: any input means
  // they are working again, and the next move is the next chance.
  waiting = true;
  const started = Date.now();
  let touched = false;
  const onInput = () => (touched = true);
  document.addEventListener("pointerdown", onInput, true);
  document.addEventListener("keydown", onInput, true);
  const tick = () => {
    const done = () => {
      waiting = false;
      document.removeEventListener("pointerdown", onInput, true);
      document.removeEventListener("keydown", onInput, true);
    };
    if (touched || Date.now() - started > WRITE_WAIT_MS) return done();
    if (writes === 0) {
      done();
      if (!somethingOpen()) reloadNow();
      return;
    }
    setTimeout(tick, 150);
  };
  setTimeout(tick, 150);
}

/** Boot: say so if this load was an update, and start listening. */
export function installBeacon(): void {
  // Every Clarity session carries the build it ran, so recordings either side
  // of a deploy can be told apart.
  tagBuild(BUILD);
  try {
    if (sessionStorage.getItem(NOTICE_KEY)) {
      sessionStorage.removeItem(NOTICE_KEY);
      // The new page's half of the move: a Clarity recording that starts with
      // this is one the beacon reloaded, not one somebody opened.
      clarityEvent("update_landed");
      // After the first paint, so the notice is not painted over by the boot.
      setTimeout(() => notice("Vidai has been updated to the latest version.", "info"), 600);
    }
  } catch {}

  // `npm run dev` has no version file and hot-reloads anyway.
  if (import.meta.env.DEV) return;
  onNavigate(atMove);
  void checkVersion();
  setInterval(() => {
    if (document.visibilityState === "visible") void checkVersion();
  }, POLL_MS);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && Date.now() - lastCheck > RECHECK_MS) void checkVersion();
  });
}
