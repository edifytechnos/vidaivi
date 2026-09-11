// DOM root, rendering helpers, and shared chrome (topbar, icons).

import { isAdmin, isLoggedIn, isTeacher } from "./auth";

export const app = document.getElementById("app")!;

export function renderMath(el: HTMLElement) {
  const run = () =>
    window.renderMathInElement?.(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  if (window.renderMathInElement) run();
  else window.addEventListener("DOMContentLoaded", run, { once: true });
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Minimal formatting for question/solution text: **bold** and paragraphs.
export function formatText(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

export const ICONS = {
  home: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M9 22V12h6v10"/></svg>`,
  logout: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="M16 17l5-5-5-5"/><path d="M21 12H9"/></svg>`,
  lock: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>`,
  users: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>`,
  menu: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M3 12h18"/><path d="M3 18h18"/></svg>`,
  shield: `<svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>`,
};

export function brand(): string {
  return `<span class="brand-mark">V</span>Vidaivi`;
}

/**
 * Account-level places — the roster, the teacher allowlist — belong to you, not
 * to whichever screen you happen to be on, so they live here and are reachable
 * everywhere. src/screens/menu.ts binds this; dom.ts cannot import screens.
 */
function topMenu(): string {
  const items: string[] = [];
  if (isLoggedIn()) items.push(`<button data-top-nav="subjects">${ICONS.home}<span>Your subjects</span></button>`);
  if (isTeacher()) items.push(`<button data-top-nav="students">${ICONS.users}<span>My students</span></button>`);
  if (isAdmin()) {
    items.push(`<button data-top-nav="mytests">${ICONS.home}<span>My tests</span></button>`);
    items.push(`<button data-top-nav="admin">${ICONS.shield}<span>Teacher access</span></button>`);
  }
  if (isLoggedIn()) items.push(`<button data-top-nav="signout">${ICONS.logout}<span>Sign out</span></button>`);
  if (!items.length) return "";
  return `
      <button id="top-menu-btn" class="top-menu-btn" aria-label="Menu" aria-expanded="false">${ICONS.menu}</button>
      <nav id="top-menu" class="top-menu" hidden>${items.join("")}</nav>`;
}

export function topbar(showHome: boolean): string {
  return `
    <header class="topbar">
      <h1>${showHome ? `<a class="home-link" href="./">${brand()}</a>` : brand()}</h1>
      <span class="chip">CBSE Class 12 Maths</span>
      ${topMenu()}
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
