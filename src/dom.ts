// DOM root, rendering helpers, and icons. The signed-in chrome lives in shell.ts.

import type { RenderMathInElement } from "./types";

export const app = document.getElementById("app")!;

// KaTeX is bundled rather than pulled from a CDN. Same origin means no extra
// DNS + TLS handshake on the cheap Android phones this is built for, a school
// network that blocks jsDelivr can no longer silently kill maths rendering, and
// Vite fingerprints the files so they cache immutably. The import is dynamic so
// none of it sits in the first bundle — nothing loads until maths is on screen.
let katex: Promise<RenderMathInElement> | null = null;

function loadKatex(): Promise<RenderMathInElement> {
  if (!katex) {
    katex = Promise.all([
      import("katex/contrib/auto-render"),
      import("katex/dist/katex.min.css"),
    ]).then(([mod]) => mod.default);
  }
  return katex;
}

export function renderMath(el: HTMLElement) {
  void loadKatex().then((render) =>
    render(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    })
  );
}

/**
 * Escape for HTML, quotes included.
 *
 * The quotes are not optional decoration: this is interpolated into attribute
 * positions all over the app — `value="${escapeHtml(opt)}"` and friends — and
 * escaping only `& < >` leaves a `"` free to close the attribute and open an
 * event handler. Text positions never needed them; attribute positions always
 * did, and one helper serves both.
 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Minimal formatting for question/solution text: **bold** and paragraphs.
export function formatText(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/**
 * How a test is named in a list: the **title** on top, the **subtitle** beneath
 * in smaller, lighter type. Both come straight from what the teacher typed —
 * line one is the Title box, line two is the Subtitle box, and nothing is
 * derived, stripped or rearranged.
 *
 * It used to put the chapter first and try to work the rest out of the title by
 * substring-matching and stripping a "Class 10 ·" prefix. That was clever and
 * unpredictable: the teacher could not tell what either line would say without
 * running it. Two boxes, two lines, in that order.
 *
 * (The second field is still `chapter` in the JSON — the stored schema has not
 * changed, only the label above the box and where it renders.)
 */
export function testLabel(title: string, subtitle?: string): { main: string; sub: string } {
  return { main: String(title || "").trim(), sub: String(subtitle || "").trim() };
}

/** The same label as markup, so every list renders it identically. */
export function testLabelMarkup(title: string, subtitle?: string): string {
  const { main, sub } = testLabel(title, subtitle);
  return `<span class="tl"><span class="tl-main">${escapeHtml(main)}</span>${
    sub ? `<span class="tl-sub">${escapeHtml(sub)}</span>` : ""
  }</span>`;
}

export const ICONS = {
  book: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/></svg>`,
  home: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>`,
  logout: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`,
  lock: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  users: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  menu: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>`,
  file: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6M9 13h6M9 17h4"/></svg>`,
  folder: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`,
  check: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>`,
  back: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5"/><path d="M12 19l-7-7 7-7"/></svg>`,
  chevron: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`,
  eye: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`,
  camera: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>`,
  mark: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  caretDown: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`,
  shield: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
  chart: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 3v18h18"/><path d="M7 15l4-5 3 3 5-7"/></svg>`,
  plus: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>`,
  pencil: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>`,
  send: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2 11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>`,
  undo: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M3.5 13a9 9 0 1 0 2.1-5.7L3 10"/></svg>`,
};

export function brand(): string {
  return `<span class="brand-mark">V</span>Vidai`;
}


/** The brand bar for screens shown before sign-in. Signed-in screens use the shell. */
/**
 * Paint a screen that is NOT inside the app shell — the sign-in steps and the
 * guest player.
 *
 * `mount()` stamps `has-shell` on `#app`, and that class drops the 720px cap
 * and the page padding so the shell can run edge to edge. **Nothing ever took
 * it off**, so any of these screens rendered after a shelled one inherited a
 * full-bleed container: the phone-number step was one input stretched across
 * the whole window. Clearing the class is what makes the cap apply again, so
 * every direct write to `app` goes through here rather than setting
 * `innerHTML` and hoping.
 */
/**
 * A date a person reads, or "—" when there isn't one.
 *
 * `new Date("")` is Invalid Date and `new Date(0)` is the Unix epoch, which in
 * IST prints as **"1 Jan, 5:30 am"** — a real-looking timestamp for a row that
 * simply has no date. That is what a teacher's report showed against a paper
 * still being written. An absent date must read as absent.
 */
export function whenLabel(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime()) || d.getTime() <= 0) return "—";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

export function paintPlain(html: string): void {
  app.className = "";
  app.innerHTML = html;
}

export function topbar(showHome: boolean): string {
  return `
    <header class="topbar">
      <h1>${showHome ? `<a class="home-link" href="./">${brand()}</a>` : brand()}</h1>
    </header>`;
}

/**
 * Point the address bar at the CURRENT screen and nothing else. Every screen
 * calls this as it renders, so a parameter left by an earlier screen (the
 * editor's ?edit=, a ?test= that did not resolve) cannot ride along and
 * reopen that screen on the next refresh.
 */
export function setUrl(params?: Record<string, string>): void {
  const q = new URLSearchParams(params ?? {}).toString();
  history.replaceState(null, "", q ? `./?${q}` : "./");
}

export function gotoTest(testId: string): void {
  location.href = `./?test=${encodeURIComponent(testId)}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function pct(score: number, total: number): number {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}
