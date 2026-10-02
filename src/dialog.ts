// The app's own "are you sure?" and its own "something happened".
//
// `confirm()` and `alert()` are drawn by the operating system: a grey sheet
// on a Mac, a modal the page cannot style on Android that reads like a crash,
// and in every case the page is frozen behind it. Twenty call sites used them
// — delete a draft, remove a student, hand in with unanswered questions,
// every error. This replaces both.
//
// A confirmation is the shared modal with no fields: the same card, the same
// manners (Escape, the scrim, focus trapped and restored), with the primary
// drawn red when the thing cannot be undone. A notice is a toast at the foot
// of the screen that never blocks anything: it is announced, it can be
// dismissed, and it goes away on its own.

import { escapeHtml, ICONS } from "./dom";
import { openModal } from "./modal";

export interface ConfirmOpts {
  title: string;
  message: string;
  /** What the primary says. A verb — "Delete", "Hand in" — never "OK". */
  confirmLabel: string;
  cancelLabel?: string;
  /** Cannot be undone: the primary is red. */
  danger?: boolean;
}

/** Ask once. Resolves true on the primary, false on any other way out. */
export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    openModal({
      title: opts.title,
      description: opts.message,
      fields: [],
      submitLabel: opts.confirmLabel,
      cancelLabel: opts.cancelLabel,
      danger: opts.danger,
      onSubmit: async () => {
        answered = true;
        resolve(true);
      },
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    // A dialog with nothing to fill in puts focus on its question's answer,
    // so Enter confirms and Tab reaches Cancel.
    document.querySelector<HTMLButtonElement>(".modal-submit")?.focus();
  });
}

export type NoticeKind = "error" | "info" | "success";

const DEFAULT_MS: Record<NoticeKind, number> = { error: 8000, info: 6000, success: 4000 };

let region: HTMLElement | null = null;

function toastRegion(): HTMLElement {
  if (!region || !region.isConnected) {
    region = document.createElement("div");
    region.className = "toasts";
    region.id = "toasts";
    region.setAttribute("role", "status");
    region.setAttribute("aria-live", "polite");
    document.body.appendChild(region);
  }
  return region;
}

/**
 * Say something without stopping anything. Errors stay longest; nothing stays
 * forever, and every one has a ✕ for somebody who has read it.
 */
export function notice(message: string, kind: NoticeKind = "error", ms = DEFAULT_MS[kind]): void {
  const host = toastRegion();
  const el = document.createElement("div");
  el.className = `toast toast-${kind}`;
  el.innerHTML = `<span class="toast-text">${escapeHtml(message)}</span><button type="button" class="toast-x" aria-label="Dismiss">${ICONS.close}</button>`;
  const remove = () => {
    if (!el.isConnected) return;
    el.classList.add("toast-out");
    setTimeout(() => el.remove(), 180);
  };
  el.querySelector(".toast-x")!.addEventListener("click", remove);
  host.appendChild(el);
  // Only a handful at once: the oldest goes when a sixth arrives.
  while (host.children.length > 5) host.firstElementChild?.remove();
  setTimeout(remove, ms);
}
