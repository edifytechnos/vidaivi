// The one layout every signed-in role gets: a left rail (icons only,
// expandable) and a top bar, around whichever page is showing. Rail items and
// top-bar actions are filtered by role; the pages themselves are shared.
//
// The shell is built ONCE and kept in the DOM. Screens swap only the page
// content, the title and the actions, so moving between screens never
// re-lays-out the chrome — and on a hard reload the rail paints synchronously
// from the cached profile before any request is made.

import { getProfile, isAdmin, isLoggedIn, isParent, isTeacher, sessionIsExpired } from "./auth";
import type { Profile } from "./auth";
import { app, escapeHtml, ICONS } from "./dom";

export type RailKey =
  | "subjects"
  | "browse"
  | "mark"
  | "students"
  | "mytests"
  | "admin"
  | "aiusage"
  | "plans"
  | "payments"
  | "results"
  | "children";

interface RailItem {
  key: RailKey;
  label: string;
  icon: string;
  show: () => boolean;
}

// A parent buys a subject and gives it to their own children, so they need the
// same two doors a teacher does: the library to pick from, and the subject the
// copies land in. Browse was shown to teachers only, which left the parent plan
// with nothing to buy and nowhere to put it.
const owns = () => isTeacher() || isParent();

const RAIL_ITEMS: RailItem[] = [
  { key: "children", label: "My children", icon: ICONS.users, show: isParent },
  // A parent gets this too: it is where the tests they take from the library
  // land, and without it their copies exist with no door into them.
  { key: "subjects", label: "Subjects", icon: ICONS.folder, show: () => owns() },
  { key: "results", label: "My results", icon: ICONS.check, show: () => getProfile()?.kind === "student" },
  { key: "browse", label: "Browse tests", icon: ICONS.book, show: owns },
  { key: "mark", label: "To mark", icon: ICONS.mark, show: owns },
  { key: "students", label: "My students", icon: ICONS.users, show: isTeacher },
  { key: "mytests", label: "My tests", icon: ICONS.home, show: isAdmin },
  { key: "admin", label: "Teacher access", icon: ICONS.shield, show: isAdmin },
  { key: "aiusage", label: "AI usage", icon: ICONS.chart, show: isAdmin },
  { key: "plans", label: "Plans & pricing", icon: ICONS.lock, show: isAdmin },
  { key: "payments", label: "Payments", icon: ICONS.check, show: isAdmin },
];

const RAIL_KEY = "vidai:rail";

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
      ${items}
      <div class="rail-spacer"></div>
      <button class="rail-toggle" id="rail-toggle" aria-label="Expand navigation" aria-expanded="${railExpanded()}">${ICONS.chevron}</button>
    </nav>`;
}

/** Two letters for the avatar — a name if we have one, else the username. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function roleLabel(profile: Profile): string {
  if (profile.kind === "student") return "Student";
  if (profile.role === "admin") return "Admin";
  if (profile.role === "teacher") return "Teacher";
  if (profile.role === "parent") return "Parent";
  return "";
}

/**
 * The profile chip and its menu, at the far right of the window-wide top bar.
 * Sign out lives here rather than at the foot of the rail — where a signed-in
 * person looks for it.
 */
function profileMarkup(): string {
  const profile = getProfile();
  if (!profile) return "";
  const name = profile.name || profile.sub;
  const role = roleLabel(profile);
  return `
    <div class="tb-profile-wrap">
      <button class="tb-profile" id="profile-btn" aria-haspopup="menu" aria-expanded="false">
        <span class="tb-avatar">${escapeHtml(initials(name))}</span>
        <span class="tb-name">${escapeHtml(name)}</span>
        ${role ? `<span class="tb-role">· ${role}</span>` : ""}
        ${ICONS.caretDown}
      </button>
      <div class="profile-menu" id="profile-menu" role="menu" hidden>
        <div class="pm-head">
          <b>${escapeHtml(name)}</b>
          <span>${escapeHtml(profile.email || profile.sub)}${role ? ` · ${role}` : ""}</span>
        </div>
        <button class="pm-item" data-rail="signout" role="menuitem">${ICONS.logout}Sign out</button>
        <button class="pm-item pm-quiet" data-rail="signout-all" role="menuitem">${ICONS.logout}Sign out everywhere</button>
      </div>
    </div>`;
}

export interface ShellOpts {
  title: string;
  sub?: string;
  /** Page-specific buttons for the top bar's right side. */
  actions?: string;
  /** A control between the brand and the title — the editor's subject picker. */
  lead?: string;
  active?: RailKey;
  /** The editor: content fills the page area edge to edge, no gutter. */
  full?: boolean;
  /**
   * Let the document scroll instead of a box inside it (phones and tablets).
   *
   * The shell is normally locked to the window (`height: 100dvh`) with
   * `.ed-center` as the scroller, which means the app bar can never scroll
   * away. A student wants it to: the bar is identity, and the row below it —
   * Back, Questions, Hand in — is what has to stay. Opt in per screen, so the
   * authoring editor keeps its fixed shell.
   */
  scroll?: "page";
  /** Reading width for card pages; "wide" for grids and tables. */
  width?: "narrow" | "wide";
}

/**
 * Put `content` on screen inside the shell (signed in) or on a plain page
 * (guest). Returns the element the content went into, so a screen can keep
 * writing to it — a skeleton first, the real thing when the data lands.
 */
export function mount(content: string, opts: ShellOpts): HTMLElement {
  // A screen whose call was refused is still awaiting its own fetch; when that
  // resolves it must not paint over the "your sign-in timed out" message.
  if (sessionIsExpired()) return document.createElement("div");

  // Whatever is painted next, the page is not still being held for a drawer
  // that no longer exists.
  dropHold();

  if (!isLoggedIn()) {
    // Guests: no rail. A plain brand bar and the page, as before.
    app.className = "";
    app.innerHTML = `
      <header class="topbar"><h1><a class="home-link" href="./"><span class="brand-mark">V</span>Vidai</a></h1></header>
      <main id="shell-main" class="guest-main"><div class="page page-narrow">${content}</div></main>`;
    return document.querySelector<HTMLElement>("#shell-main .page")!;
  }

  let shell = app.querySelector<HTMLElement>(".shell");
  if (!shell) {
    app.className = "has-shell";
    app.innerHTML = `
      <div class="shell${railExpanded() ? " rail-open" : ""}">
        <header class="shellbar">
          <button class="shellbar-brand" id="shellbar-home" title="Your subjects" aria-label="Your subjects"><span class="brand-mark">V</span><span class="brand-word">Vidai</span></button>
          <span class="shellbar-div"></span>
          <span class="shellbar-lead" id="shellbar-lead"></span>
          <span class="shellbar-title" id="shellbar-title"></span>
          <span class="shellbar-sub" id="shellbar-sub"></span>
          <div class="shellbar-actions" id="shellbar-actions"></div>
          ${profileMarkup()}
        </header>
        <div class="shell-body">
          ${railMarkup()}
          <div class="shell-page">
            <main class="shell-main" id="shell-main"></main>
          </div>
        </div>
      </div>`;
    shell = app.querySelector<HTMLElement>(".shell")!;
  }

  document.getElementById("shellbar-title")!.textContent = opts.title;
  const lead = document.getElementById("shellbar-lead")!;
  lead.innerHTML = opts.lead ?? "";
  lead.hidden = !opts.lead;
  const sub = document.getElementById("shellbar-sub")!;
  sub.textContent = opts.sub ?? "";
  sub.hidden = !opts.sub;
  document.getElementById("shellbar-actions")!.innerHTML = opts.actions ?? "";
  shell.querySelectorAll<HTMLElement>(".rail-item[data-rail]").forEach((el) => {
    el.classList.toggle("active", el.dataset.rail === opts.active);
  });

  const main = document.getElementById("shell-main")!;
  main.classList.toggle("shell-main-full", !!opts.full);
  // A full-bleed screen owns the whole window, and on a phone it takes the
  // rail's 56px too: the bottom bar belongs to the subject picker, which is
  // the only screen that is *not* full-bleed. Inside a subject or a test the
  // crumb row already carries the way back and the Questions drawer, so the
  // rail would be a duplicate costing a sixth of a 320px screen. Both classes
  // sit on .shell because the rail is a sibling of the page, not a child.
  shell.classList.toggle("shell-full", !!opts.full);
  shell.classList.toggle("shell-scroll", opts.scroll === "page");
  main.innerHTML = opts.full ? content : `<div class="page page-${opts.width ?? "narrow"}">${content}</div>`;
  main.scrollTop = 0;
  return opts.full ? main : main.querySelector<HTMLElement>(".page")!;
}

/** Update only the top bar — the editor does this as its status changes. */
export function setShellbar(opts: Pick<ShellOpts, "title" | "sub" | "actions" | "lead">): void {
  const title = document.getElementById("shellbar-title");
  if (!title) return;
  title.textContent = opts.title;
  const sub = document.getElementById("shellbar-sub")!;
  sub.textContent = opts.sub ?? "";
  sub.hidden = !opts.sub;
  // Only when given: a re-render that omits it must not wipe the subject picker
  // out from under an open dropdown.
  if (opts.lead !== undefined) {
    const lead = document.getElementById("shellbar-lead")!;
    lead.innerHTML = opts.lead;
    lead.hidden = !opts.lead;
  }
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
  /**
   * The full-bleed working screen, as a ghost.
   *
   * **It must match the screen the caller is about to paint.** A skeleton that
   * draws a column or a row the real screen does not have is worse than no
   * skeleton: the page jumps the moment the data lands, which is the one thing
   * it exists to prevent. Three screens share this shell and they no longer
   * have the same furniture, so each says what it will paint:
   *
   * - `tree`  — the list beside the question (the subject page has none).
   * - `add`   — the **+** in the tree's head, which only the authoring editor
   *             has. It is a 26px square in the head's right-hand slot, the
   *             same size and place as the real button; it used to be a
   *             60px bone in a row of its own *below* the head, which is how
   *             it came to sit under the title rather than beside it.
   * - `crumb` — the row of controls above the question.
   */
  editor(opts: { tree?: boolean; add?: boolean; crumb?: boolean } = {}): string {
    const { tree = true, add = false, crumb = true } = opts;
    const treeRow = () => `<div class="ed-tree-row"><span class="ed-tree-q">${bone("7px", "7px", "border-radius:50%")}${bone("65%", "13px")}</span></div>`;
    const treeCol = tree
      ? `<aside class="ed-tree">
            <div class="ed-tree-head">
              ${bone("110px", "11px")}
              ${add ? `<span class="ed-spacer"></span>${bone("26px", "26px", "border-radius:var(--radius-sm);flex:none")}` : ""}
            </div>
            <div class="ed-tree-body">${treeRow()}${treeRow()}${treeRow()}${treeRow()}</div>
          </aside>`
      : "";
    return `
      <div class="editor sk-wrap" aria-busy="true">
        <div class="ed-cols overview${tree ? "" : " st-subject"}">
          ${treeCol}
          <div class="ed-center">
            ${crumb ? `<div class="ed-crumbrow">${bone("80px", "12px")}</div>` : ""}
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

// ---------- The questions tree as a drawer ----------
// Below 900px `.ed-tree` is positioned off-canvas and slides in when its editor
// carries `tree-open` (see the .ed-tree rules in style.css). Every screen that
// shows the tree binds it the same way, so the behaviour cannot drift apart.

let escBound = false;

/**
 * Wire the drawer for one screen: the toggle opens it, and the scrim, a pick
 * inside the tree, or Escape closes it.
 */
/** Where the page was when the drawer took it out of flow. */
let heldAt = 0;

/** Only below 900px is the tree a drawer; above it, it is a column. */
const isDrawer = (): boolean => window.matchMedia("(max-width: 899px)").matches;

/**
 * Hold the page still behind the open drawer, and put it back afterwards.
 *
 * A question list shorter than the drawer is not a scroller, so a drag inside
 * it went straight to the document and the whole screen moved under the sheet.
 * `overflow: hidden` on the body does not stop that on iOS Safari; taking the
 * body out of flow at its current offset does, and the negative `top` is what
 * stops the screen jumping to the top as it happens.
 */
function holdPage(): void {
  if (!isDrawer() || document.body.classList.contains("drawer-open")) return;
  heldAt = window.scrollY;
  document.body.style.top = `-${heldAt}px`;
  document.body.classList.add("drawer-open");
}

function releasePage(): void {
  if (!dropHold()) return;
  window.scrollTo(0, heldAt);
}

/**
 * Let the page go without putting it back where it was.
 *
 * `mount` calls this because Back sits in the crumb row, which stays tappable
 * beside the open drawer: leaving on it would strand the NEXT screen with a
 * fixed body and nothing able to scroll. A new screen starts at the top, so
 * there is no offset worth restoring.
 */
function dropHold(): boolean {
  if (!document.body.classList.contains("drawer-open")) return false;
  document.body.classList.remove("drawer-open");
  document.body.style.top = "";
  return true;
}

export function bindTreeDrawer(editor: HTMLElement): void {
  const close = (): void => {
    editor.classList.remove("tree-open");
    releasePage();
  };

  // The trigger stays in the crumb row, beside Hand in — the two things a
  // student reaches for while sitting a test, in one row. The drawer then
  // opens *under* that row rather than under the app bar, so the button and
  // the panel it opens read as one control. The row wraps at narrow widths,
  // so its height is measured rather than guessed.
  //
  // Measured **on open, not on bind**: the crumb row is sticky now, so once
  // the page has scrolled it sits at the top of the window rather than where
  // it was painted. A number taken at bind time would leave the drawer
  // floating below the row it belongs to.
  const placeDrawer = (): void => {
    const crumb = editor.querySelector<HTMLElement>(".ed-crumbrow");
    if (!crumb) return;
    editor.style.setProperty("--drawer-top", `${Math.round(crumb.getBoundingClientRect().bottom)}px`);
  };
  placeDrawer();
  editor.querySelector("[data-drawer-toggle]")?.addEventListener("click", () => {
    // Measured BEFORE the page is held: the crumb row is where it is now, and
    // holding the body must not move it.
    placeDrawer();
    if (editor.classList.toggle("tree-open")) holdPage();
    else releasePage();
  });
  editor.querySelector(".ed-scrim")?.addEventListener("click", close);
  // Picking a question is the end of what the drawer is for.
  editor.querySelector(".ed-tree")?.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button")) close();
  });

  // A repaint can carry `tree-open` across (the student workspace does exactly
  // that when the subject arrives late), and `mount` will have dropped the
  // hold on the way through. Re-take it, so an open drawer is never left with
  // a scrolling page behind it.
  if (editor.classList.contains("tree-open")) holdPage();

  // One listener for the life of the page, not one per render.
  if (escBound) return;
  escBound = true;
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    document.querySelectorAll(".editor.tree-open").forEach((el) => el.classList.remove("tree-open"));
    releasePage();
  });
}

/** The button that opens it — only rendered where the tree is not a column. */
export function drawerToggleMarkup(label = "Questions"): string {
  return `<button class="st-drawer-btn" data-drawer-toggle aria-label="Show ${escapeHtml(label.toLowerCase())}">
      ${ICONS.menu}<span>${escapeHtml(label)}</span>
    </button>`;
}
