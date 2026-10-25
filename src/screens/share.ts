// Share a test by link — the dialog behind "Share by link" in the editor's
// toolbar and on My tests.
//
// Anyone with the link AND the access code joins the test by signing in with
// Google, and becomes a student of this teacher for that test (and any other
// they join the same way). The link names the test; the code is what the
// teacher reads out, so a forwarded link alone opens nothing.
//
// This is not `openModal` — that dialog is a form you fill in and submit once,
// while this one talks to the server while it is open: sharing is switched on
// or off, the code is remade, and the link and code are copied out of it.
// What it borrows is the modal's manners, as `buy.ts` does: the scrim, Escape,
// the focus trap, `body.modal-open`, and an action row that ends at the right.

import { track } from "../analytics";
import { joinLink, shareTest, type ShareState } from "../api";
import { copyText, escapeHtml } from "../dom";

let open = false;

export interface ShareTarget {
  id: string;
  title: string;
  share?: ShareState;
}

/** ABC-DEF: the code as it is read out. */
export function codeLabel(code: string): string {
  const c = String(code || "").toUpperCase();
  return c.length > 3 ? `${c.slice(0, 3)}-${c.slice(3)}` : c;
}

/** The WhatsApp message, link and code together, ready to paste. */
export function shareMessage(title: string, share: ShareState): string {
  return (
    `Take the test "${title}" on Vidai:\n\n${joinLink(share.token)}\n\n` +
    `Sign in with Google and enter this access code: ${codeLabel(share.code)}`
  );
}

/**
 * Open the dialog. `onChange` gets the share state after every change, so the
 * caller's working copy stays right without another round trip.
 */
export function openShareLink(test: ShareTarget, onChange?: (share: ShareState) => void): void {
  if (open) return;
  open = true;
  const restoreFocusTo = document.activeElement as HTMLElement | null;
  let share: ShareState = test.share ?? { on: false, token: "", code: "" };
  let busy = false;

  const host = document.createElement("div");
  host.className = "modal-scrim";
  host.innerHTML = `
    <div class="modal share" role="dialog" aria-modal="true" aria-labelledby="share-title">
      <div class="modal-head">
        <h2 class="modal-title" id="share-title">Share by link</h2>
        <button class="modal-x" data-close aria-label="Close">✕</button>
      </div>
      <p class="hint modal-desc">${escapeHtml(test.title)} — anyone with the link <strong>and</strong> the access code can join by signing in with Google. They become a student of yours for this test only, and take a seat like any other student.</p>
      <div class="modal-body" id="share-body"></div>
    </div>`;
  document.body.appendChild(host);
  document.body.classList.add("modal-open");
  const body = host.querySelector<HTMLElement>("#share-body")!;

  function close(): void {
    if (!open) return;
    open = false;
    host.remove();
    document.body.classList.remove("modal-open");
    restoreFocusTo?.focus?.();
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = Array.from(host.querySelectorAll<HTMLElement>("button, input, a[href]")).filter(
      (el) => !el.hasAttribute("disabled")
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  document.addEventListener("keydown", onKey);
  host.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === host || t.closest("[data-close]")) close();
  });

  async function change(opts: { on: boolean; rotate?: boolean }): Promise<void> {
    if (busy) return;
    busy = true;
    render();
    const result = await shareTest(test.id, opts);
    busy = false;
    if (!result.ok) {
      render(result.message);
      return;
    }
    share = result.share;
    onChange?.(share);
    track(opts.rotate ? "share_code_rotated" : opts.on ? "share_on" : "share_off", { test: test.id });
    render();
  }

  function render(error = ""): void {
    const link = share.token ? joinLink(share.token) : "";
    body.innerHTML = `
      <div class="share-switch">
        <div>
          <div class="share-state">${share.on ? "Sharing is on" : "Sharing is off"}</div>
          <p class="hint">${
            share.on
              ? "Students can join with the link and the code below."
              : share.token
                ? "The link and the code are kept. Switch on to let students join again — anyone who joined already keeps the test."
                : "Switch on to get a link and an access code for this test."
          }</p>
        </div>
        <button class="btn ${share.on ? "btn-ghost" : "btn-primary"}" id="share-toggle" ${busy ? "disabled" : ""}>${
          busy ? "…" : share.on ? "Turn off" : "Turn on"
        }</button>
      </div>
      ${
        share.on
          ? `
        <div class="share-field">
          <label class="modal-label" for="share-link">Link</label>
          <div class="share-row">
            <input class="modal-input modal-readonly" id="share-link" value="${escapeHtml(link)}" readonly />
            <button class="btn btn-ghost share-copy" data-copy="link">Copy</button>
          </div>
        </div>
        <div class="share-field">
          <label class="modal-label" for="share-code">Access code</label>
          <div class="share-row">
            <input class="modal-input modal-readonly share-code" id="share-code" value="${escapeHtml(codeLabel(share.code))}" readonly />
            <button class="btn btn-ghost share-copy" data-copy="code">Copy</button>
            <button class="btn btn-ghost" id="share-rotate" ${busy ? "disabled" : ""}>New code</button>
          </div>
          <p class="hint">Read it out in class, or send it with the link. A new code stops the old one for anyone who has not joined yet; students who already joined keep the test.</p>
        </div>
        <div class="modal-actions">
          <span class="modal-actions-gap"></span>
          <button class="btn btn-primary share-copy" data-copy="message">Copy message with link and code</button>
        </div>`
          : ""
      }
      ${error ? `<p class="login-error">${escapeHtml(error)}</p>` : ""}`;

    body.querySelector<HTMLButtonElement>("#share-toggle")?.addEventListener("click", () => void change({ on: !share.on }));
    body.querySelector<HTMLButtonElement>("#share-rotate")?.addEventListener("click", () => void change({ on: true, rotate: true }));
    body.querySelectorAll<HTMLButtonElement>(".share-copy").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const what = btn.dataset.copy;
        const text =
          what === "link" ? link : what === "code" ? codeLabel(share.code) : shareMessage(test.title, share);
        const was = btn.textContent;
        btn.textContent = (await copyText(text)) ? "Copied" : "Copy failed";
        track("share_copied", { what: what || "" });
        setTimeout(() => {
          btn.textContent = was;
        }, 1600);
      })
    );
  }

  render();
  host.querySelector<HTMLElement>("#share-toggle")?.focus();
}
