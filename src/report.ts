// Report a problem · Suggest an idea · Review · My tickets — the Seyali
// family's one feedback widget (src/feedback/, a copy of seyali's
// platform/web/src/feedback/; scripts/sync-feedback.sh). Reports go to
// seyali.app's /api/feedback and are filed as GitHub issues on this repo.
//
// What may be captured follows the Clarity rule (recordsAudience): a
// teacher, a parent or an admin is an adult, and the last minute or two of
// the page is kept for a report — the dashcam. A student, or a guest who
// opened a test (who may be a child), gets no recording and no page
// snapshot at all, not even one they press for: a recording is the
// behavioural monitoring the DPDP Act bars for anyone under 18. They can
// still write what went wrong, attach their own screenshot, and send the
// console and network log, which they see before it goes.
//
// Only the log (capture.ts) and the recorder's switch (replay.ts) load at
// boot; the dialog is its own chunk, fetched the first time it is opened,
// and rrweb its own again, fetched only for an adult.
import { installCapture } from "./feedback/capture";
import * as replay from "./feedback/replay";
import type { FeedbackOptions, View } from "./feedback/widget";
import { recordsAudience } from "./clarity";
import { getProfile } from "./auth";
import { BUILD } from "./beacon";

const capture = (role: string | undefined, sittingAsGuest: boolean) => {
  const adult = recordsAudience(role, sittingAsGuest);
  return { replay: adult ? ("buffer" as const) : ("off" as const), snapshot: adult };
};
let current = capture(undefined, false);

const whenIdle = (fn: () => void) => ("requestIdleCallback" in window ? (window as unknown as { requestIdleCallback: (f: () => void, o?: unknown) => void }).requestIdleCallback(fn, { timeout: 5000 }) : setTimeout(fn, 2500));

/** Once at boot, as early as the log should start. */
export function installReporting(sittingAsGuest: boolean): void {
  installCapture((u) => u.includes("/api/feedback"));
  current = capture(getProfile()?.role, sittingAsGuest);
  if (current.replay === "buffer") whenIdle(() => void replay.startBuffer().catch(() => {}));
}

/** The signed-in role changed (sign-in, sign-out), or a guest opened a test. */
export function reportingFor(role: string | undefined, sittingAsGuest = false): void {
  current = capture(role, sittingAsGuest);
  if (current.replay === "off") replay.stopAll();
  else whenIdle(() => void replay.startBuffer().catch(() => {}));
  if (widget) widget.setFeedback(current);
}

let widget: typeof import("./feedback/widget") | null = null;
export async function openReport(view: View = "issue"): Promise<void> {
  widget ??= await import("./feedback/widget");
  const opts: FeedbackOptions = {
    app: "vidai",
    build: BUILD,
    ...current,
    surface: () => new URLSearchParams(location.search).get("view") || location.search.match(/[?&](test|edit|review|results|browse|join)=/)?.[1] || "home",
    // The team sees who reported, to answer them; a public page never does.
    reporter: () => {
      const p = getProfile();
      return p ? { name: p.name, role: p.role, contact: p.role === "student" ? "" : p.email } : null;
    },
    // The beacon and the page lock read body.modal-open as "a dialog is up".
    onOpen: () => document.body.classList.add("modal-open"),
    onClose: () => document.body.classList.remove("modal-open"),
  };
  widget.installFeedback(opts);
  widget.setFeedback(current);
  widget.openFeedback(view);
}
