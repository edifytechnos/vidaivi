// Paying for a ready-made subject.
//
// This is not `openModal`. That dialog is a form you fill in and submit once;
// this one talks to the server while it is open — a code is applied and the
// price changes under it — and it ends in a payment link rather than a save.
// What it borrows is the modal's manners, the same trade `photoviewer.ts`
// makes: the scrim, Escape, the focus trap, `body.modal-open`, and the action
// row that ends at the right.
//
// There is no QR code, deliberately. Drawing one needs an encoder dependency,
// and the buyers are on Android phones where `upi://pay?…` opens GPay or
// PhonePe with the amount and the reference already filled in — which is the
// better affordance anyway. On a laptop the VPA is shown with a Copy button.

import { escapeHtml, copyText } from "../dom";
import {
  cancelOrder,
  claimOrder,
  money,
  quoteShelf,
  startOrder,
  type Quote,
  type StartedOrder,
} from "../payments";
import { track } from "../analytics";

let open = false;

interface BuyOpts {
  shelfId: string;
  /** Shown while the server's own title is still in flight. */
  title?: string;
  /** Run after the payment is claimed, so the caller can refresh. */
  onClaimed?: () => void;
}

/** The ₹499 subject, bought. Resolves when the dialog closes. */
export function openBuyShelf(opts: BuyOpts): void {
  if (open) return;
  open = true;
  const restoreFocusTo = document.activeElement as HTMLElement | null;

  const host = document.createElement("div");
  host.className = "modal-scrim";
  host.innerHTML = `
    <div class="modal buy" role="dialog" aria-modal="true" aria-labelledby="buy-title">
      <div class="modal-head">
        <h2 class="modal-title" id="buy-title">${escapeHtml(opts.title || "This subject")}</h2>
        <button class="modal-x" data-close aria-label="Close">✕</button>
      </div>
      <div class="modal-body" id="buy-body">
        <p class="hint">Loading the price…</p>
      </div>
    </div>`;
  document.body.appendChild(host);
  document.body.classList.add("modal-open");

  const body = host.querySelector<HTMLElement>("#buy-body")!;
  const titleEl = host.querySelector<HTMLElement>("#buy-title")!;

  // The order, once one exists. It is kept so Cancel can take it back out of
  // the way rather than leaving an unfinished row behind.
  let order: StartedOrder | null = null;
  let claimed = false;
  let code = "";

  function close(): void {
    if (!open) return;
    open = false;
    // An order that was opened and never paid is the buyer changing their
    // mind. Leaving it would eat one of their twenty open slots for nothing.
    if (order && !claimed) void cancelOrder(order.ref);
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
    const focusable = Array.from(
      host.querySelectorAll<HTMLElement>("button, input, a[href]")
    ).filter((el) => !el.hasAttribute("disabled"));
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

  host.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === host || t.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", onKey);

  // ---- The price, and a code against it -------------------------------

  function priceMarkup(q: Quote): string {
    const off = q.discountPaise > 0;
    return `
      <div class="buy-price">
        <div class="buy-amount">${escapeHtml(money(q.payablePaise))}</div>
        ${
          off
            ? `<div class="hint buy-was"><s>${escapeHtml(money(q.listPaise))}</s> ·
               ${escapeHtml(money(q.discountPaise))} off${
                 q.coupon ? ` with ${escapeHtml(q.coupon)}` : ""
               }</div>`
            : `<div class="hint">Every test in the subject, yours to edit.</div>`
        }
      </div>`;
  }

  function showQuote(q: Quote): void {
    titleEl.textContent = q.shelfTitle || opts.title || "This subject";
    body.innerHTML = `
      ${priceMarkup(q)}
      <div class="modal-field">
        <label class="modal-label" for="buy-code">Discount code</label>
        <div class="buy-coderow">
          <input class="modal-input" id="buy-code" value="${escapeHtml(q.coupon || code)}"
                 placeholder="If you have one" autocapitalize="characters" />
          <button type="button" class="btn btn-ghost" id="buy-apply">Apply</button>
        </div>
        <p class="hint buy-codemsg"${q.couponMessage ? "" : " hidden"}>${escapeHtml(
          q.couponMessage || ""
        )}</p>
      </div>
      <p class="login-error buy-error" hidden></p>
      <div class="modal-actions">
        <span class="modal-actions-gap"></span>
        <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        <button type="button" class="btn btn-primary" id="buy-go">Pay ${escapeHtml(
          money(q.payablePaise)
        )}</button>
      </div>`;

    const codeEl = body.querySelector<HTMLInputElement>("#buy-code")!;
    const apply = async (): Promise<void> => {
      code = codeEl.value.trim().toUpperCase();
      const next = await quoteShelf(opts.shelfId, code);
      if (!next.ok) return fail(next.message);
      showQuote(next.data);
    };
    body.querySelector("#buy-apply")!.addEventListener("click", () => void apply());
    codeEl.addEventListener("keydown", (e) => {
      if ((e as KeyboardEvent).key === "Enter") {
        e.preventDefault();
        void apply();
      }
    });
    body.querySelector("#buy-go")!.addEventListener("click", () => void begin());
  }

  function fail(message?: string): void {
    const el = body.querySelector<HTMLElement>(".buy-error");
    if (!el) return;
    el.textContent = message || "Something went wrong.";
    el.hidden = false;
  }

  // ---- Paying -----------------------------------------------------------

  async function begin(): Promise<void> {
    const started = await startOrder(opts.shelfId, code);
    if (!started.ok) return fail(started.message);
    order = started.data;
    track("purchase_started", { shelf: opts.shelfId });
    showPay(order);
  }

  function showPay(o: StartedOrder): void {
    body.innerHTML = `
      ${priceMarkup(o)}
      <p class="hint">Pay with any UPI app. The reference is already filled in —
      please leave it as it is, it is how your payment is matched to your account.</p>
      <div class="buy-pay">
        <a class="btn btn-primary buy-upi" href="${escapeHtml(o.upi.link)}">Open my UPI app</a>
        <div class="buy-vpa">
          <span class="buy-vpa-label">or pay <strong>${escapeHtml(o.upi.vpa)}</strong></span>
          <button type="button" class="btn-link" id="buy-copy">Copy</button>
        </div>
        <div class="hint">Reference: <code>${escapeHtml(o.upi.note)}</code></div>
      </div>
      <div class="modal-field">
        <label class="modal-label" for="buy-utr">UPI reference number</label>
        <input class="modal-input" id="buy-utr" placeholder="Optional — from your payment app" />
        <p class="hint">It helps us match your payment faster, but it is not needed.</p>
      </div>
      <p class="login-error buy-error" hidden></p>
      <div class="modal-actions">
        <span class="modal-actions-gap"></span>
        <button type="button" class="btn btn-ghost" data-close>Not now</button>
        <button type="button" class="btn btn-primary" id="buy-done">I have paid</button>
      </div>`;

    body.querySelector("#buy-copy")!.addEventListener("click", async (e) => {
      const btn = e.currentTarget as HTMLElement;
      btn.textContent = (await copyText(o.upi.vpa)) ? "Copied" : "Copy failed";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
    body.querySelector("#buy-done")!.addEventListener("click", async () => {
      const utr = (body.querySelector<HTMLInputElement>("#buy-utr")?.value || "").trim();
      const res = await claimOrder(o.ref, utr);
      if (!res.ok) return fail(res.message);
      claimed = true;
      track("purchase_claimed", { shelf: opts.shelfId });
      showWaiting();
      opts.onClaimed?.();
    });
  }

  function showWaiting(): void {
    body.innerHTML = `
      <div class="buy-done">
        <div class="buy-amount">Thank you</div>
        <p>We will check the payment and open the subject for you. It is usually
        the same day.</p>
        <p class="hint">Nothing is lost if you close this — the subject appears
        under Browse tests as soon as the payment is confirmed.</p>
      </div>
      <div class="modal-actions">
        <span class="modal-actions-gap"></span>
        <button type="button" class="btn btn-primary" data-close>Close</button>
      </div>`;
    body.querySelector<HTMLElement>("[data-close]")?.focus();
  }

  void (async () => {
    const first = await quoteShelf(opts.shelfId);
    if (!open) return;
    if (!first.ok) {
      body.innerHTML = `<p class="login-error">${escapeHtml(
        first.message || "The price could not be loaded."
      )}</p>
      <div class="modal-actions"><span class="modal-actions-gap"></span>
        <button type="button" class="btn btn-ghost" data-close>Close</button></div>`;
      return;
    }
    showQuote(first.data);
    body.querySelector<HTMLInputElement>("#buy-code")?.focus();
  })();
}
