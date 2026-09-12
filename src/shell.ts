// The one layout every signed-in role gets: a left rail (icons only,
// expandable) and a top bar, around whichever page is showing. Rail items and
// top-bar actions are filtered by role; the pages themselves are shared.
//
// The shell is built ONCE and kept in the DOM. Screens swap only the page
// content, the title and the actions, so moving between screens never
// re-lays-out the chrome — and on a hard reload the rail paints synchronously
// from the cached profile before any request is made.

import { getProfile, isAdmin, isLoggedIn, isParent, isTeacher } from "./auth";
import { app, ICONS } from "./dom";

export type RailKey =
  | "subjects"
  | "mark"
  | "students"
  | "mytests"
  | "admin"
  | "results"
  | "children";

interface RailItem {
  key: RailKey;
  label: string;
  icon: string;
  show: () => boolean;
}

const RAIL_ITEMS: RailItem[] = [
  { key: "children", label: "My children", icon: ICONS.users, show: isParent },
  { key: "subjects", label: "Subjects", icon: ICONS.folder, show: () => isLoggedIn() && !isParent() },
  { key: "results", label: "My results", icon: ICONS.check, show: () => getProfile()?.kind === "student" },
  { key: "mark", label: "To mark", icon: ICONS.mark, show: isTeacher },
  { key: "students", label: "My students", icon: ICONS.users, show: isTeacher },
  { key: "mytests", label: "My tests", icon: ICONS.home, show: isAdmin },
  { key: "admin", label: "Teacher access", icon: ICONS.shield, show: isAdmin },
];

const RAIL_KEY = "vidaivi:rail";

export function railExpanded(): boolean {
  try {
    return localStorage.getItem(RAIL_KEY) === "open";
  } catch {
    return false;
  }
}

export function setRailExpanded(open: boolean): void {
  try {
    localStorage.setItem(RAIL_KEY, open ? "open" : "closed");
  } catch {}
  document.querySelector(".shell")?.classList.toggle("rail-open", open);
  document.getElementById("rail-toggle")?.setAttribute("aria-expanded", String(open));
}

function railMarkup(): string {
  const items = RAIL_ITEMS.filter((i) => i.show())
    .map(
      (i) => `<button class="rail-item" data-rail="${i.key}" title="${i.label}" aria-label="${i.label}">
        ${i.icon}<span class="rail-label">${i.label}</span></button>`
    )
    .join("");
  return `
    <nav class="rail" aria-label="Main">
      <div class="rail-brand"><span class="brand-mark">V</span><span class="rail-label">Vidaivi</span></div>
      ${items}
      <div class="rail-spacer"></div>
      <button class="rail-item" data-rail="signout" title="Sign out" aria-label="Sign out">${ICONS.logout}<span class="rail-label">Sign out</span></button>
      <button class="rail-toggle" id="rail-toggle" aria-label="Expand navigation" aria-expanded="${railExpanded()}">${ICONS.chevron}</button>
    </nav>`;
}

export interface ShellOpts {
  title: string;
  sub?: string;
  /** Page-specific buttons for the top bar's right side. */
  actions?: string;
  active?: RailKey;
  /** The editor: content fills the page area edge to edge, no gutter. */
  full?: boolean;
  /** Reading width for card pages; "wide" for grids and tables. */
  width?: "narrow" | "wide";
}

/**
 * Put `content` on screen inside the shell (signed in) or on a plain page
 * (guest). Returns the element the content went into, so a screen can keep
 * writing to it — a skeleton first, the real thing when the data lands.
 */
export function mount(content: string, opts: ShellOpts): HTMLElement {
  if (!isLoggedIn()) {
    // Guests: no rail. A plain brand bar and the page, as before.
    app.className = "";
    app.innerHTML = `
      <header class="topbar"><h1><a class="home-link" href="./"><span class="brand-mark">V</span>Vidaivi</a></h1></header>
      <main id="shell-main" class="guest-main"><div class="page page-narrow">${content}</div></main>`;
    return document.querySelector<HTMLElement>("#shell-main .page")!;
  }

  let shell = app.querySelector<HTMLElement>(".shell");
  if (!shell) {
    app.className = "has-shell";
    app.innerHTML = `
      <div class="shell${railExpanded() ? " rail-open" : ""}">
        ${railMarkup()}
        <div class="shell-page">
          <header class="shellbar">
            <span class="shellbar-title" id="shellbar-title"></span>
            <span class="shellbar-sub" id="shellbar-sub"></span>
            <div class="shellbar-actions" id="shellbar-actions"></div>
          </header>
          <main class="shell-main" id="shell-main"></main>
        </div>
      </div>`;
    shell = app.querySelector<HTMLElement>(".shell")!;
  }

  document.getElementById("shellbar-title")!.textContent = opts.title;
  const sub = document.getElementById("shellbar-sub")!;
  sub.textContent = opts.sub ?? "";
  sub.hidden = !opts.sub;
  document.getElementById("shellbar-actions")!.innerHTML = opts.actions ?? "";
  shell.querySelectorAll<HTMLElement>(".rail-item[data-rail]").forEach((el) => {
    el.classList.toggle("active", el.dataset.rail === opts.active);
  });

  const main = document.getElementById("shell-main")!;
  main.classList.toggle("shell-main-full", !!opts.full);
  main.innerHTML = opts.full ? content : `<div class="page page-${opts.width ?? "narrow"}">${content}</div>`;
  main.scrollTop = 0;
  return opts.full ? main : main.querySelector<HTMLElement>(".page")!;
}

/** Update only the top bar — the editor does this as its status changes. */
export function setShellbar(opts: Pick<ShellOpts, "title" | "sub" | "actions">): void {
  const title = document.getElementById("shellbar-title");
  if (!title) return;
  title.textContent = opts.title;
  const sub = document.getElementById("shellbar-sub")!;
  sub.textContent = opts.sub ?? "";
  sub.hidden = !opts.sub;
  if (opts.actions !== undefined) document.getElementById("shellbar-actions")!.innerHTML = opts.actions;
}

// ---------- Skeletons ----------
// Each takes the shape and height of what replaces it, so the swap from
// placeholder to data moves nothing.

function bone(w: string, h: string, extra = ""): string {
  return `<span class="sk" style="width:${w};height:${h};${extra}"></span>`;
}

export const skeleton = {
  /** The subjects / children grid. */
  cards(n = 3): string {
    return `<div class="subject-grid sk-wrap" aria-busy="true">${Array.from({ length: n })
      .map(
        () => `<div class="subject-card sk-card">
          ${bone("46px", "46px", "border-radius:12px")}
          ${bone("60%", "18px")}
          <span class="subject-meta">${bone("40%", "12px")}</span>
        </div>`
      )
      .join("")}</div>`;
  },
  /** A list of test cards. */
  list(n = 3): string {
    return `<div class="test-list sk-wrap" aria-busy="true">${Array.from({ length: n })
      .map(
        () => `<div class="test-card sk-card"><div class="test-card-main">
          ${bone("55%", "15px")}${bone("35%", "12px", "margin-top:6px")}</div>${bone("72px", "20px", "border-radius:5px")}</div>`
      )
      .join("")}</div>`;
  },
  /** A data table inside a card. */
  table(rows = 4, cols = 4): string {
    const row = () =>
      `<tr>${Array.from({ length: cols })
        .map((_, i) => `<td>${bone(i === 0 ? "70%" : "50%", "13px")}</td>`)
        .join("")}</tr>`;
    return `<div class="table-wrap sk-wrap" aria-busy="true"><table class="data-table"><thead><tr>${Array.from({ length: cols })
      .map(() => `<th>${bone("60px", "11px")}</th>`)
      .join("")}</tr></thead><tbody>${Array.from({ length: rows }).map(row).join("")}</tbody></table></div>`;
  },
  /** The editor: tree column and the overview panels. */
  editor(): string {
    const treeRow = () => `<div class="ed-tree-row"><span class="ed-tree-q">${bone("7px", "7px", "border-radius:50%")}${bone("65%", "13px")}</span></div>`;
    return `
      <div class="editor sk-wrap" aria-busy="true">
        <div class="ed-cols overview">
          <aside class="ed-tree">
            <div class="ed-tree-head">${bone("110px", "11px")}</div>
            <div class="ed-tree-add sk-btn">${bone("60px", "13px")}</div>
            <div class="ed-tree-body">${treeRow()}${treeRow()}${treeRow()}${treeRow()}</div>
          </aside>
          <div class="ed-center">
            <div class="ed-crumbrow">${bone("80px", "12px")}</div>
            <div class="ed-body">
              <section class="ed-panel"><div class="ed-panel-head">${bone("90px", "11px")}</div>
                <div class="ed-grid">${bone("100%", "40px")}${bone("100%", "40px")}${bone("100%", "40px")}${bone("100%", "40px")}</div></section>
              <section class="ed-panel"><div class="ed-panel-head">${bone("80px", "11px")}</div>${bone("100%", "140px")}</section>
            </div>
          </div>
        </div>
      </div>`;
  },
  /** A single card with a heading and a few lines. */
  card(lines = 3): string {
    return `<div class="card sk-wrap" aria-busy="true">${bone("40%", "20px", "margin-bottom:14px")}${Array.from({ length: lines })
      .map(() => bone("90%", "13px", "margin-top:10px"))
      .join("")}</div>`;
  },
};
