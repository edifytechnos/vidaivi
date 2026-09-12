// One modal for every small "create a thing" flow — a subject, a student, a
// teacher. They were inline forms sitting above the list they add to, which
// pushed the content down and, worse, made a pre-filled field and an empty one
// look identical: the subject form shipped Board and Class with real values and
// Subject with only a placeholder, so "Board, class and subject are all needed"
// fired on a form that looked completely filled in.
//
// Here a required field is marked, and the error names the one field that is
// actually empty and puts the cursor in it.

import { escapeHtml } from "./dom";

export interface ModalField {
  /** Key in the values object handed to onSubmit. */
  name: string;
  label: string;
  placeholder?: string;
  value?: string;
  type?: "text" | "email" | "tel";
  required?: boolean;
  /** Free-text suggestions, as a datalist — never a closed set. */
  options?: string[];
  hint?: string;
  inputmode?: string;
}

export interface ModalOpts {
  title: string;
  description?: string;
  fields: ModalField[];
  submitLabel: string;
  /**
   * Return a message to keep the modal open and show it, or nothing to close.
   * Throwing is treated the same as returning a message.
   */
  onSubmit: (values: Record<string, string>) => Promise<string | null | void>;
}

let open = false;

export function openModal(opts: ModalOpts): void {
  if (open) return;
  open = true;
  const restoreFocusTo = document.activeElement as HTMLElement | null;

  const host = document.createElement("div");
  host.className = "modal-scrim";
  host.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h2 class="modal-title" id="modal-title">${escapeHtml(opts.title)}</h2>
        <button class="modal-x" data-close aria-label="Close">✕</button>
      </div>
      ${opts.description ? `<p class="hint modal-desc">${escapeHtml(opts.description)}</p>` : ""}
      <form class="modal-body" novalidate>
        ${opts.fields
          .map(
            (f) => `
          <label class="modal-field" data-field="${escapeHtml(f.name)}">
            <span class="modal-label">${escapeHtml(f.label)}${
              f.required ? ` <span class="modal-req" aria-hidden="true">*</span>` : ""
            }</span>
            <input class="modal-input" name="${escapeHtml(f.name)}"
                   type="${f.type ?? "text"}"
                   ${f.inputmode ? `inputmode="${escapeHtml(f.inputmode)}"` : ""}
                   ${f.options?.length ? `list="modal-list-${escapeHtml(f.name)}"` : ""}
                   ${f.type === "email" ? 'autocapitalize="none" spellcheck="false"' : ""}
                   placeholder="${escapeHtml(f.placeholder ?? "")}"
                   value="${escapeHtml(f.value ?? "")}" />
            ${
              f.options?.length
                ? `<datalist id="modal-list-${escapeHtml(f.name)}">${f.options
                    .map((o) => `<option value="${escapeHtml(o)}"></option>`)
                    .join("")}</datalist>`
                : ""
            }
            ${f.hint ? `<span class="modal-hint">${escapeHtml(f.hint)}</span>` : ""}
          </label>`
          )
          .join("")}
        <p class="login-error modal-error" hidden></p>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary modal-submit">${escapeHtml(opts.submitLabel)}</button>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(host);
  document.body.classList.add("modal-open");

  const form = host.querySelector("form")!;
  const error = host.querySelector<HTMLElement>(".modal-error")!;
  const submit = host.querySelector<HTMLButtonElement>(".modal-submit")!;
  const inputs = Array.from(host.querySelectorAll<HTMLInputElement>(".modal-input"));

  function close(): void {
    open = false;
    host.remove();
    document.body.classList.remove("modal-open");
    document.removeEventListener("keydown", onKey);
    restoreFocusTo?.focus?.();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key !== "Tab") return;
    // Keep focus inside the dialog.
    const focusable = Array.from(
      host.querySelectorAll<HTMLElement>("button, input, [href], select, textarea")
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

  function fail(message: string, field?: ModalField): void {
    error.textContent = message;
    error.hidden = false;
    if (!field) return;
    const el = inputs.find((i) => i.name === field.name);
    el?.closest(".modal-field")?.classList.add("modal-field-bad");
    el?.focus();
  }

  host.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    // The scrim itself closes; a click inside the dialog does not.
    if (target === host || target.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", onKey);
  inputs.forEach((i) =>
    i.addEventListener("input", () => {
      i.closest(".modal-field")?.classList.remove("modal-field-bad");
      error.hidden = true;
    })
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values: Record<string, string> = {};
    for (const input of inputs) values[input.name] = input.value.trim();

    // Name the field that is actually empty, rather than listing all of them.
    const missing = opts.fields.find((f) => f.required && !values[f.name]);
    if (missing) {
      fail(`${missing.label} is needed.`, missing);
      return;
    }

    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = "Saving…";
    let message: string | null | void = null;
    try {
      message = await opts.onSubmit(values);
    } catch (err) {
      message = err instanceof Error ? err.message : "That did not work — try again.";
    }
    submit.disabled = false;
    submit.textContent = label;
    if (message) fail(String(message));
    else close();
  });

  inputs[0]?.focus();
  inputs[0]?.select();
}
