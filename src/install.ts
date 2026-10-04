// Installing Vidai as an app: the service worker, and the "Install the app"
// button.
//
// The worker (public/sw.js) is registered on every production load: a browser
// will offer to install a site only once it has one. What it does is
// deliberately small: see the file.
//
// The browser fires `beforeinstallprompt` when it is ready to install, and
// Vidai keeps that event to replay from its own button. It does NOT call
// preventDefault, so Chrome's own "Add Vidai to Home screen" bar still shows
// as usual; the button is a second door, not a replacement. iPhones never fire
// the event (Safari installs only through Share → Add to Home Screen), so on
// iOS the button explains those two taps instead.

import { track } from "./analytics";
import { clarityEvent, tagDisplay } from "./clarity";
import { confirmDialog } from "./dialog";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;

/** Running as the installed app, not in a browser tab. */
export function isStandalone(): boolean {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  // iPadOS reports itself as a Mac, so a touch screen settles it.
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (/macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

/** Whether the button has anything to do on this device right now. */
export function canInstall(): boolean {
  if (isStandalone()) return false;
  return deferred !== null || isIos();
}

/**
 * The attributes an install button is painted with. Painted in the right state
 * from the start, and moved by refreshButtons() when the browser's readiness
 * changes under a screen that is already up.
 */
export function installButtonAttrs(): string {
  return `data-install${canInstall() ? "" : " hidden"}`;
}

/** Show or hide every install button on the screen, as installability moves. */
function refreshButtons(): void {
  const show = canInstall();
  document.querySelectorAll<HTMLElement>("[data-install]").forEach((el) => {
    el.hidden = !show;
  });
}

/** Ask the browser to install, or explain how on an iPhone. */
export async function installApp(): Promise<void> {
  if (deferred) {
    const event = deferred;
    // A prompt can be shown once; the browser fires a fresh event if the
    // person dismisses it and it is willing to ask again later.
    deferred = null;
    refreshButtons();
    await event.prompt();
    const { outcome } = await event.userChoice;
    track("install_prompt", { outcome });
    clarityEvent(`install_prompt_${outcome}`);
    return;
  }
  if (isIos()) {
    track("install_prompt", { outcome: "ios_help" });
    clarityEvent("install_prompt_ios_help");
    await confirmDialog({
      title: "Add Vidai to your Home Screen",
      message:
        "Tap the Share button (the square with an arrow pointing up), then choose “Add to Home Screen”. Vidai then opens from its own icon, full screen. You will be asked to sign in once more the first time.",
      confirmLabel: "Got it",
      cancelLabel: "",
    });
  }
}

/** Boot: register the worker and start listening for installability. */
export function installPwa(): void {
  window.addEventListener("beforeinstallprompt", (e) => {
    deferred = e as InstallPromptEvent;
    refreshButtons();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    refreshButtons();
    track("app_installed");
    clarityEvent("app_installed");
  });
  // Delegated, so nothing has to re-bind: a screen paints the button with
  // installButtonAttrs() and this one listener serves every copy of it.
  document.addEventListener("click", (e) => {
    if ((e.target as HTMLElement | null)?.closest("[data-install]")) void installApp();
  });

  // Both analytics hear how the app was opened. Clarity's tag is on every
  // session either way, so an installed open is a filter there, not an
  // absence; initClarity() has already run, so its queue is waiting.
  const installed = isStandalone();
  if (installed) track("app_open_installed");
  tagDisplay(installed ? "installed" : "browser");

  // Not under `npm run dev`: a worker outliving a hot-reload session only
  // confuses. Localhost is still a secure context, so the built site served
  // by the suite registers it exactly as production does.
  if (import.meta.env.DEV || !("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Not installable then, which is what the site was before. Never an
      // error worth showing anybody.
    });
  });
}
