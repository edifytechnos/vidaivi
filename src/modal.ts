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
  /** "cards" only: the promise on the tile — "14 ready-made tests". */
  badge?: string;
  /** "cards" only: span the full row. For an option that is deliberately the
   *  lesser one, like "Something else". */
  wide?: boolean;
}

export interface ModalField {
  /** Key in the values object handed to onSubmit. */
  name: string;
  label: string;
  /**
   * "text" (the default) is a single input. "radio" picks one of `choices`,
   * and "checklist" ticks any number of them — a checklist's picks arrive as
   * the second argument to onSubmit, since one field yields many values.
   * "cards" is a radio that looks like a tile: use it when the choice is about
   * CONTENT (which subject to teach) rather than a setting.
   */
  kind?: "text" | "radio" | "checklist" | "cards";
  choices?: ModalChoice[];
  /** Show this field only while another field holds this value. */
  showWhen?: { field: string; value: string };
  /** What to say when a checklist has nothing to tick. */
  empty?: string;
  /** Checklist only: a Select all / Clear row and a live count. Worth it past
   *  a handful of choices, and the lists here only get longer. */
  bulk?: boolean;
  placeholder?: string;
  value?: string;
  type?: "text" | "email" | "tel";
  required?: boolean;
  /** Free-text suggestions, as a datalist — never a closed set. */
  options?: string[];
  hint?: string;
  inputmode?: string;
  /** Something to read and copy out, not fill in — a setup key, a list of
   *  recovery codes. Still selectable; never submitted as an answer. */
  readonly?: boolean;
  /** Several lines of it. Goes with `readonly`. */
  textarea?: boolean;
}

/**
 * A label that can answer to what has been filled in so far, so the button can
 * say "Create with 3 tests" rather than something generic.
 */
export type ModalLabel = string | ((values: Record<string, string>, picks: Record<string, string[]>) => string);

/**
 * One screen of a multi-step dialog. Ask ONE thing per step: the dialog this
 * replaced asked a content choice, a taxonomy chore and a second content choice
 * at once, in one scrolling box.
 */
export interface ModalStep {
  title?: string;
  description?: string;
  fields: ModalField[];
  /** The forward button. Defaults to "Next", or `submitLabel` on the last step. */
  submitLabel?: ModalLabel;
}

export interface ModalOpts {
  title: string;
  description?: string;
  /** A single-step dialog. Ignored when `steps` is given. */
  fields?: ModalField[];
  /** Two or more screens, with Back and a "Step 1 of 2" counter. */
  steps?: ModalStep[];
  submitLabel: ModalLabel;
  /**
   * Return a message to keep the modal open and show it, or nothing to close.
   * Throwing is treated the same as returning a message.
   */
  onSubmit: (
    values: Record<string, string>,
    picks: Record<string, string[]>
  ) => Promise<string | null | void>;
}

/** Select all / Clear, and a live count of what is ticked. */
function bulkRow(f: ModalField): string {
  const n = (f.choices ?? []).length;
  return `
    <div class="modal-bulk" data-bulk="${escapeHtml(f.name)}">
      <button type="button" class="modal-bulk-btn" data-bulk-all>Select all ${n}</button>
      <button type="button" class="modal-bulk-btn" data-bulk-none>Clear</button>
      <span class="modal-bulk-count"></span>
    </div>`;
}

/** A tile per choice: what you get, not just what it is called. */
function cardRows(f: ModalField): string {
  const choices = f.choices ?? [];
  if (!choices.length) {
    return `<p class="modal-hint">${escapeHtml(f.empty ?? "Nothing to choose from yet.")}</p>`;
  }
  return `<div class="modal-cards">${choices
    .map(
      (c, i) => `
      <label class="modal-card${c.wide ? " modal-card-wide" : ""}">
        <input type="radio" name="${escapeHtml(f.name)}" value="${escapeHtml(c.value)}"
               class="modal-choice-input modal-card-input"${
                 c.checked || (i === 0 && !choices.some((x) => x.checked)) ? " checked" : ""
               } />
        <span class="modal-card-body">
          <span class="modal-card-label">${escapeHtml(c.label)}</span>
          ${c.hint ? `<span class="modal-card-hint">${escapeHtml(c.hint)}</span>` : ""}
          ${c.badge ? `<span class="modal-card-badge">${escapeHtml(c.badge)}</span>` : ""}
        </span>
      </label>`
    )
    .join("")}</div>`;
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
  if (f.kind === "radio" || f.kind === "checklist" || f.kind === "cards") {
    return `
      <fieldset class="modal-field modal-fieldset" data-field="${escapeHtml(f.name)}"${
        f.showWhen ? ` data-when-field="${escapeHtml(f.showWhen.field)}" data-when-value="${escapeHtml(f.showWhen.value)}"` : ""
      }${hidden}>
        <legend class="modal-label">${escapeHtml(f.label)}${
          f.required ? ` <span class="modal-req" aria-hidden="true">*</span>` : ""
        }</legend>
        ${f.bulk && (f.choices ?? []).length ? bulkRow(f) : ""}
        ${f.kind === "cards" ? cardRows(f) : choiceRows(f)}
        ${f.hint ? `<span class="modal-hint">${escapeHtml(f.hint)}</span>` : ""}
      </fieldset>`;
  }
  return `
    <label class="modal-field" data-field="${escapeHtml(f.name)}"${
      f.showWhen
        ? ` data-when-field="${escapeHtml(f.showWhen.field)}" data-when-value="${escapeHtml(f.showWhen.value)}"`
        : ""
    }${hidden}>
      <span class="modal-label">${escapeHtml(f.label)}${
        f.required ? ` <span class="modal-req" aria-hidden="true">*</span>` : ""
      }</span>
      ${
        f.textarea
          ? `<textarea class="modal-input modal-readonly" name="${escapeHtml(f.name)}" rows="${
              (f.value ?? "").split("\n").length
            }" readonly>${escapeHtml(f.value ?? "")}</textarea>`
          : `<input class="modal-input${f.readonly ? " modal-readonly" : ""}" name="${escapeHtml(f.name)}"
             type="${f.type ?? "text"}"
             ${f.readonly ? "readonly" : ""}
             ${f.inputmode ? `inputmode="${escapeHtml(f.inputmode)}"` : ""}
             ${f.options?.length ? `list="modal-list-${escapeHtml(f.name)}"` : ""}
             ${f.type === "email" ? 'autocapitalize="none" spellcheck="false"' : ""}
             placeholder="${escapeHtml(f.placeholder ?? "")}"
             value="${escapeHtml(f.value ?? "")}" />`
      }
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

  // One shape internally: a single-step dialog is a one-entry step list, so
  // everything below has exactly one path to maintain.
  const steps: ModalStep[] = opts.steps?.length
    ? opts.steps
    : [{ fields: opts.fields ?? [], submitLabel: opts.submitLabel }];
  const multi = steps.length > 1;
  let at = 0;

  const host = document.createElement("div");
  host.className = "modal-scrim";
  host.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <div class="modal-head">
        <h2 class="modal-title" id="modal-title">${escapeHtml(opts.title)}</h2>
        ${multi ? `<span class="modal-count" id="modal-count"></span>` : ""}
        <button class="modal-x" data-close aria-label="Close">✕</button>
      </div>
      <p class="hint modal-desc" id="modal-desc"${opts.description ? "" : " hidden"}>${escapeHtml(opts.description ?? "")}</p>
      <form class="modal-body" novalidate>
        ${steps
          .map(
            (st, i) => `<div class="modal-step" data-step="${i}"${i === 0 ? "" : " hidden"}>
              ${st.fields.map((f) => fieldMarkup(f)).join("")}
            </div>`
          )
          .join("")}
        <p class="login-error modal-error" hidden></p>
        <div class="modal-actions">
          <button type="submit" class="btn btn-primary modal-submit"></button>
          <button type="button" class="btn btn-ghost modal-back" hidden>Back</button>
          <button type="button" class="btn btn-ghost" data-close>Cancel</button>
        </div>
      </form>
    </div>`;
  document.body.appendChild(host);
  document.body.classList.add("modal-open");

  const form = host.querySelector("form")!;
  const error = host.querySelector<HTMLElement>(".modal-error")!;
  const submit = host.querySelector<HTMLButtonElement>(".modal-submit")!;
  const back = host.querySelector<HTMLButtonElement>(".modal-back")!;
  const titleEl = host.querySelector<HTMLElement>("#modal-title")!;
  const descEl = host.querySelector<HTMLElement>("#modal-desc")!;
  const countEl = host.querySelector<HTMLElement>("#modal-count");
  const inputs = Array.from(host.querySelectorAll<HTMLInputElement>(".modal-input"));

  /** Everything filled in so far, across every step — never just this one. */
  function collect(): { values: Record<string, string>; picks: Record<string, string[]> } {
    const values: Record<string, string> = {};
    for (const input of inputs) values[input.name] = input.value.trim();
    // One checklist yields many values, so they travel separately; a radio
    // (and a card, which is a radio) also reports its single pick in `values`.
    const picks: Record<string, string[]> = {};
    for (const st of steps) {
      for (const f of st.fields) {
        if (f.kind !== "radio" && f.kind !== "checklist" && f.kind !== "cards") continue;
        const chosen = Array.from(
          host.querySelectorAll<HTMLInputElement>(`input[name="${f.name}"]:checked`)
        ).map((el) => el.value);
        picks[f.name] = chosen;
        if (f.kind !== "checklist") values[f.name] = chosen[0] ?? "";
      }
    }
    return { values, picks };
  }

  const labelFor = (l: ModalLabel | undefined, fallback: string): string => {
    if (!l) return fallback;
    if (typeof l === "string") return l;
    const { values, picks } = collect();
    return l(values, picks);
  };

  /** The button answers to what is ticked: "Create with 3 tests". */
  function relabel(): void {
    const st = steps[at];
    const last = at === steps.length - 1;
    submit.textContent = last
      ? labelFor(st.submitLabel ?? opts.submitLabel, "Save")
      : labelFor(st.submitLabel, "Next");
  }

  /** Paint whichever step is current: its fields, its heading, its button. */
  function paintStep(): void {
    host.querySelectorAll<HTMLElement>(".modal-step").forEach((el) => {
      el.hidden = Number(el.dataset.step) !== at;
    });
    const st = steps[at];
    titleEl.textContent = st.title ?? opts.title;
    const desc = st.description ?? (at === 0 ? opts.description : "");
    descEl.textContent = desc ?? "";
    descEl.hidden = !desc;
    if (countEl) countEl.textContent = `Step ${at + 1} of ${steps.length}`;
    back.hidden = at === 0;
    relabel();
    error.hidden = true;
  }

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
      relabel();
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
  /** Keep every bulk row's count honest, whatever changed it. */
  function recount(): void {
    host.querySelectorAll<HTMLElement>(".modal-bulk").forEach((row) => {
      const name = row.dataset.bulk!;
      const all = host.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`);
      const on = host.querySelectorAll(`input[name="${name}"]:checked`).length;
      const count = row.querySelector<HTMLElement>(".modal-bulk-count");
      if (count) count.textContent = on ? `${on} of ${all.length} selected` : "";
    });
  }

  host.querySelectorAll<HTMLElement>(".modal-bulk").forEach((row) => {
    const name = row.dataset.bulk!;
    const setAll = (on: boolean) => {
      host.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`).forEach((i) => {
        i.checked = on;
      });
      recount();
      relabel();
      error.hidden = true;
    };
    row.querySelector("[data-bulk-all]")?.addEventListener("click", () => setAll(true));
    row.querySelector("[data-bulk-none]")?.addEventListener("click", () => setAll(false));
  });

  host.querySelectorAll<HTMLInputElement>(".modal-choice-input").forEach((el) =>
    el.addEventListener("change", () => {
      applyConditions();
      recount();
      relabel();
      error.hidden = true;
      el.closest(".modal-field")?.classList.remove("modal-field-bad");
    })
  );
  applyConditions();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const { values, picks } = collect();

    // Only THIS step is being answered, so only its fields are checked — and
    // name the one that is actually empty rather than listing all of them.
    const missing = steps[at].fields.find((f) => {
      if (!f.required) return false;
      const el = host.querySelector<HTMLElement>(`[data-field="${f.name}"]`);
      if (el?.hidden) return false;
      if (f.kind === "checklist" || f.kind === "radio" || f.kind === "cards") {
        return !(picks[f.name] ?? []).length;
      }
      return !values[f.name];
    });
    if (missing) {
      fail(
        missing.kind === "checklist" ? `Pick at least one ${missing.label.toLowerCase()}.` : `${missing.label} is needed.`,
        missing
      );
      return;
    }

    // Not the last screen yet: move on rather than submitting.
    if (at < steps.length - 1) {
      at += 1;
      paintStep();
      host.querySelector<HTMLElement>(`.modal-step[data-step="${at}"] input`)?.focus();
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

  back.addEventListener("click", () => {
    if (at === 0) return;
    at -= 1;
    paintStep();
  });

  recount();
  paintStep();
  const firstInput = host.querySelector<HTMLInputElement>('.modal-step[data-step="0"] .modal-input');
  firstInput?.focus();
  firstInput?.select();
}
