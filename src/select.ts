// The app's own dropdown.
//
// A native <select> draws its OPTIONS LIST with the operating system, not with
// the page: a grey Mac sheet, a full-screen Android wheel, a Windows list, each
// in its own font and colour, none of them in ours. The box itself can be
// styled; the list cannot. So this replaces the list with one of our own, and
// leaves the native <select> in place underneath — visually hidden, still
// holding the value, still firing `change` — so every piece of code that reads
// `select.value` or listens for `change` keeps working untouched, and a test
// that calls `selectOption` still lands.
//
// One component, installed once: `installSelects()` watches the document and
// upgrades every <select> the moment a screen paints it, so a new screen gets
// the dropdown without asking — the same way the CSRF guard wraps every
// handler at export time rather than handler by handler.
//
// Keyboard and screen reader: the button is a combobox, the list a listbox
// with `aria-activedescendant`; arrows move, Enter or Space picks, Escape and
// Tab close, typing jumps to a matching option.

import { ICONS } from "./dom";

let openList: (() => void) | null = null;

/** Upgrade one native select. Safe to call twice. */
export function enhanceSelect(sel: HTMLSelectElement): void {
  if (sel.dataset.vs) return;
  sel.dataset.vs = "1";

  const wrap = document.createElement("div");
  wrap.className = "vs";
  sel.parentNode?.insertBefore(wrap, sel);
  wrap.appendChild(sel);

  // The native control stays in the tree for its value and its events, but it
  // is nobody's control any more: not focusable, not announced, not visible.
  // (Not `display: none`: Playwright's selectOption needs a box to act on.)
  sel.classList.add("vs-native");
  sel.tabIndex = -1;
  sel.setAttribute("aria-hidden", "true");

  const btn = document.createElement("button");
  btn.type = "button";
  // The select's own classes carry its sizing (.ed-select, .shellbar-select…);
  // the button wears them so the existing rules apply unchanged.
  btn.className = `vs-btn ${sel.className.replace("vs-native", "").trim()}`;
  btn.setAttribute("role", "combobox");
  btn.setAttribute("aria-haspopup", "listbox");
  btn.setAttribute("aria-expanded", "false");
  const label = sel.getAttribute("aria-label");
  if (label) btn.setAttribute("aria-label", label);
  if (sel.id) {
    // A <label for="…"> pointed at the select; point it at the button instead.
    document.querySelectorAll<HTMLLabelElement>(`label[for="${sel.id}"]`).forEach((l) => {
      l.setAttribute("for", `${sel.id}-vs`);
    });
    btn.id = `${sel.id}-vs`;
  }
  btn.innerHTML = `<span class="vs-label"></span>${ICONS.chevron}`;
  wrap.appendChild(btn);

  const list = document.createElement("ul");
  list.className = "vs-list";
  list.setAttribute("role", "listbox");
  list.tabIndex = -1;
  list.hidden = true;
  if (label) list.setAttribute("aria-label", label);
  wrap.appendChild(list);

  const labelEl = btn.querySelector<HTMLElement>(".vs-label")!;
  const options = () => Array.from(sel.options);
  let active = -1;

  const paintLabel = () => {
    const o = sel.selectedOptions[0];
    labelEl.textContent = o ? o.text : "";
    btn.disabled = sel.disabled;
  };

  const close = () => {
    if (list.hidden) return;
    list.hidden = true;
    wrap.classList.remove("vs-open", "vs-up");
    btn.setAttribute("aria-expanded", "false");
    btn.removeAttribute("aria-activedescendant");
    if (openList === close) openList = null;
  };

  const setActive = (i: number) => {
    const items = Array.from(list.children) as HTMLElement[];
    if (!items.length) return;
    active = Math.max(0, Math.min(items.length - 1, i));
    items.forEach((el, k) => el.classList.toggle("vs-active", k === active));
    const el = items[active];
    btn.setAttribute("aria-activedescendant", el.id);
    el.scrollIntoView({ block: "nearest" });
  };

  const pick = (i: number) => {
    const o = options()[i];
    if (!o || o.disabled) return;
    const changed = sel.value !== o.value;
    sel.value = o.value;
    paintLabel();
    close();
    btn.focus();
    if (changed) sel.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const open = () => {
    if (sel.disabled || !list.hidden) return;
    openList?.();
    // Read the options at open time: a screen may have rewritten them.
    const base = btn.id || `vs${Math.random().toString(36).slice(2, 8)}`;
    list.innerHTML = options()
      .map(
        (o, i) =>
          `<li id="${base}-o${i}" role="option" class="vs-opt${o.disabled ? " vs-disabled" : ""}" aria-selected="${o.selected ? "true" : "false"}" data-i="${i}">${
            o.selected ? ICONS.check : ""
          }<span>${o.text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</span></li>`
      )
      .join("");
    list.hidden = false;
    wrap.classList.add("vs-open");
    // Flip upward when the floor is closer than the list is tall.
    const room = window.innerHeight - btn.getBoundingClientRect().bottom;
    wrap.classList.toggle("vs-up", room < Math.min(list.scrollHeight, 280) + 12);
    btn.setAttribute("aria-expanded", "true");
    openList = close;
    setActive(Math.max(0, sel.selectedIndex));
  };

  btn.addEventListener("click", () => (list.hidden ? open() : close()));
  btn.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key === " " || e.key === "Enter") {
      if (list.hidden) {
        e.preventDefault();
        open();
        return;
      }
    }
    if (list.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive(active - 1);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActive(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActive(options().length - 1);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      pick(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close();
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Jump to the next option starting with the typed letter.
      const opts = options();
      const from = active + 1;
      const hit = [...opts.slice(from), ...opts.slice(0, from)].findIndex((o) =>
        o.text.toLowerCase().startsWith(e.key.toLowerCase())
      );
      if (hit >= 0) setActive((from + hit) % opts.length);
    }
  });
  list.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus on the button
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li) pick(Number(li.dataset.i));
  });
  list.addEventListener("mousemove", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li && Number(li.dataset.i) !== active) setActive(Number(li.dataset.i));
  });
  btn.addEventListener("blur", () => {
    // A click on an option keeps focus on the button (mousedown is
    // prevented), so losing focus means the person went elsewhere.
    setTimeout(() => {
      if (document.activeElement !== btn) close();
    }, 0);
  });

  // The page can change the value or the disabled state behind our back —
  // a re-render, a readOnly() pass, a test's selectOption — so mirror both.
  sel.addEventListener("change", paintLabel);
  new MutationObserver(paintLabel).observe(sel, { attributes: true, attributeFilter: ["disabled"], childList: true, subtree: true });
  paintLabel();
}

/** Upgrade every select under `root` that is not already upgraded. */
export function enhanceSelects(root: ParentNode = document): void {
  root.querySelectorAll<HTMLSelectElement>("select:not([data-vs])").forEach(enhanceSelect);
}

/**
 * Watch the document and upgrade selects as screens paint them. One call at
 * boot; nothing else has to remember.
 */
export function installSelects(): void {
  enhanceSelects();
  const mo = new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (!(n instanceof Element)) return;
        if (n instanceof HTMLSelectElement) enhanceSelect(n);
        else enhanceSelects(n);
      });
    }
  });
  mo.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("pointerdown", (e) => {
    if (openList && !(e.target as HTMLElement).closest(".vs")) openList();
  });
}

// ---------- A text field with suggestions: the combobox ----------
//
// A <datalist> is the native way to suggest values under a free-text field,
// and Safari and Android barely show it. This is the same list the dropdown
// draws, filtered as you type, under an input that stays free text — a
// suggestion, never a closed set, which is what the modal's `options` has
// always meant.

export function enhanceCombobox(input: HTMLInputElement, options: string[]): void {
  if (input.dataset.vs || !options.length) return;
  input.dataset.vs = "1";
  const wrap = document.createElement("div");
  wrap.className = "vs vs-combo";
  input.parentNode?.insertBefore(wrap, input);
  wrap.appendChild(input);
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  input.autocomplete = "off";

  const list = document.createElement("ul");
  list.className = "vs-list";
  list.setAttribute("role", "listbox");
  list.hidden = true;
  wrap.appendChild(list);
  const base = input.id || input.name || `vc${Math.random().toString(36).slice(2, 8)}`;
  let shown: string[] = [];
  let active = -1;

  const close = () => {
    if (list.hidden) return;
    list.hidden = true;
    wrap.classList.remove("vs-open");
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    if (openList === close) openList = null;
  };
  const setActive = (i: number) => {
    const items = Array.from(list.children) as HTMLElement[];
    // -1 is a real state here: nothing highlighted, Enter keeps what was typed.
    active = !items.length || i < 0 ? -1 : Math.min(items.length - 1, i);
    items.forEach((el, k) => el.classList.toggle("vs-active", k === active));
    if (active >= 0) {
      input.setAttribute("aria-activedescendant", items[active].id);
      items[active].scrollIntoView({ block: "nearest" });
    } else input.removeAttribute("aria-activedescendant");
  };
  const show = () => {
    const q = input.value.trim().toLowerCase();
    shown = options.filter((o) => !q || o.toLowerCase().includes(q));
    if (!shown.length) {
      close();
      return;
    }
    list.innerHTML = shown
      .map(
        (o, i) =>
          `<li id="${base}-c${i}" role="option" class="vs-opt" aria-selected="false" data-i="${i}"><span>${o
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")}</span></li>`
      )
      .join("");
    if (list.hidden) {
      openList?.();
      list.hidden = false;
      wrap.classList.add("vs-open");
      input.setAttribute("aria-expanded", "true");
      openList = close;
    }
    setActive(-1);
  };
  const pick = (i: number) => {
    const o = shown[i];
    if (o === undefined) return;
    input.value = o;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    close();
  };

  input.addEventListener("focus", show);
  input.addEventListener("input", show);
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (list.hidden) show();
      else setActive(active + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (!list.hidden) setActive(active - 1);
    } else if (e.key === "Enter") {
      if (!list.hidden && active >= 0) {
        e.preventDefault();
        pick(active);
      } else close();
    } else if (e.key === "Escape") {
      if (!list.hidden) {
        e.preventDefault();
        e.stopPropagation(); // the dialog around it stays open
        close();
      }
    } else if (e.key === "Tab") close();
  });
  list.addEventListener("mousedown", (e) => e.preventDefault());
  list.addEventListener("click", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li) pick(Number(li.dataset.i));
  });
  list.addEventListener("mousemove", (e) => {
    const li = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
    if (li && Number(li.dataset.i) !== active) setActive(Number(li.dataset.i));
  });
  input.addEventListener("blur", () => setTimeout(close, 0));
}
