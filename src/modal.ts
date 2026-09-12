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

export interface ModalChoice {
  value: string;
  label: string;
  hint?: string;
  checked?: boolean;
}

export interface ModalField {
  /** Key in the values object handed to onSubmit. */
  name: string;
  label: string;
  /**
   * "text" (the default) is a single input. "radio" picks one of `choices`,
   * and "checklist" ticks any number of them — a checklist's picks arrive as
   * the second argument to onSubmit, since one field yields many values.
   */
  kind?: "text" | "radio" | "checklist";
  choices?: ModalChoice[];
  /** Show this field only while another field holds this value. */
  showWhen?: { field: string; value: string };
  /** What to say when a checklist has nothing to tick. */
  empty?: string;
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
  onSubmit: (
    values: Record<string, string>,
    picks: Record<string, string[]>
  ) => Promise<string | null | void>;
}

function choiceRows(f: ModalField): string {
  const choices = f.choices ?? [];
  if (!choices.length) {
    return `<p class="modal-hint">${escapeHtml(f.empty ?? "Nothing to choose from yet.")}</p>`;
  }
  const type = f.kind === "radio" ? "radio" : "checkbox";
  return `<div class="modal-choices">${choices
    .map(
      (c, i) => `
      <label class="modal-choice">
        <input type="${type}" name="${escapeHtml(f.name)}" value="${escapeHtml(c.value)}"
               class="modal-choice-input"${c.checked || (type === "radio" && i === 0 && !choices.some((x) => x.checked)) ? " checked" : ""} />
        <span class="modal-choice-main">
          <span class="modal-choice-label">${escapeHtml(c.label)}</span>
          ${c.hint ? `<span class="modal-hint">${escapeHtml(c.hint)}</span>` : ""}
        </span>
      </label>`
    )
    .join("")}</div>`;
}

function fieldMarkup(f: ModalField): string {
  const hidden = f.showWhen ? " hidden" : "";
  if (f.kind === "radio" || f.kind === "checklist") {
    return `
      <fieldset class="modal-field modal-fieldset" data-field="${escapeHtml(f.name)}"${
        f.showWhen ? ` data-when-field="${escapeHtml(f.showWhen.field)}" data-when-value="${escapeHtml(f.showWhen.value)}"` : ""
      }${hidden}>
        <legend class="modal-label">${escapeHtml(f.label)}${
          f.required ? ` <span class="modal-req" aria-hidden="true">*</span>` : ""
        }</legend>
        ${choiceRows(f)}
        ${f.hint ? `<span class="modal-hint">${escapeHtml(f.hint)}</span>` : ""}
      </fieldset>`;
  }
  return `
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
    </label>`;
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
        ${opts.fields.map((f) => fieldMarkup(f)).join("")}
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
    const el =
      inputs.find((i) => i.name === field.name) ??
      host.querySelector<HTMLInputElement>(`input[name="${field.name}"]`);
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

  // A field with showWhen follows the field it depends on, live.
  const applyConditions = (): void => {
    host.querySelectorAll<HTMLElement>("[data-when-field]").forEach((el) => {
      const on = el.dataset.whenField!;
      const want = el.dataset.whenValue!;
      const picked = host.querySelector<HTMLInputElement>(`input[name="${on}"]:checked`);
      el.hidden = (picked?.value ?? "") !== want;
    });
  };
  host.querySelectorAll<HTMLInputElement>(".modal-choice-input").forEach((el) =>
    el.addEventListener("change", () => {
      applyConditions();
      error.hidden = true;
      el.closest(".modal-field")?.classList.remove("modal-field-bad");
    })
  );
  applyConditions();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const values: Record<string, string> = {};
    for (const input of inputs) values[input.name] = input.value.trim();
    // One checklist yields many values, so they travel separately; a radio
    // also reports its single pick in `values` for callers that want it.
    const picks: Record<string, string[]> = {};
    for (const f of opts.fields) {
      if (f.kind !== "radio" && f.kind !== "checklist") continue;
      const chosen = Array.from(
        host.querySelectorAll<HTMLInputElement>(`input[name="${f.name}"]:checked`)
      ).map((el) => el.value);
      picks[f.name] = chosen;
      if (f.kind === "radio") values[f.name] = chosen[0] ?? "";
    }

    // Name the field that is actually empty, rather than listing all of them.
    const missing = opts.fields.find((f) => {
      if (!f.required) return false;
      const hiddenNow = host.querySelector<HTMLElement>(`[data-field="${f.name}"]`)?.hidden;
      if (hiddenNow) return false;
      if (f.kind === "checklist" || f.kind === "radio") return !(picks[f.name] ?? []).length;
      return !values[f.name];
    });
    if (missing) {
      fail(
        missing.kind === "checklist" ? `Pick at least one ${missing.label.toLowerCase()}.` : `${missing.label} is needed.`,
        missing
      );
      return;
    }

    submit.disabled = true;
    const label = submit.textContent;
    submit.textContent = "Saving…";
    let message: string | null | void = null;
    try {
      message = await opts.onSubmit(values, picks);
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
