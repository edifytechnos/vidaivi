// The feedback dialog every Seyali app opens: Report a problem · Suggest an
// idea · Review · My tickets. Plain DOM and no framework, so the React apps
// (seyali.app, Mesai, Kadai) and Vidai (no framework) share one file.
//
// A report shows the person exactly what goes with it — a page snapshot, the
// console and network log, a recording if they made one, screenshots and
// files — each a box they can untick, before anything leaves the device.
import { ensureStyle } from "./style";
import { installCapture, traces, digestOf, deviceContext } from "./capture";
import * as replay from "./replay";
import { mountPlayer, type PlayerHandle, type Highlight } from "./player";
import { pickElement, type PickedElement } from "./pick";
import {
  fb, sendReport, jsonAttachment, setBase, platformFor, siteUrl, keysFragment, votedSet, STATUS_LABEL, fileEvents, fileUrl,
  setAccountSource, setToken, forgetDevice, type Account,
  type Attachment, type Ticket, type BoardItem, type Comment, type Kind, type Status, type Triage, type TicketFile,
} from "./client";

export type AppId = "seyali" | "mesai" | "kadai" | "karkai" | "vidai" | "thunai" | "parai" | "medai";
export type View = "issue" | "feature" | "review" | "mine";
export type FeedbackOptions = {
  app: AppId;
  /** The platform's origin; by default worked out from this page's host. */
  api?: string;
  /** Which screens: studio, kitchen, student… — a word, never a person. */
  surface?: () => string | undefined;
  build?: string;
  /**
   * "buffer" keeps the last one to two minutes of the page all the time (the
   * dashcam); "on-demand" records only after the person presses Record;
   * "off" never records. A page a child is on is "off" (Vidai's rule).
   */
  replay?: "off" | "on-demand" | "buffer";
  /** The page snapshot (rrweb's DOM copy of the screen). */
  snapshot?: boolean;
  /** Who is reporting, as the app knows them: shown to the team, never on a public page. */
  reporter?: () => { name?: string; contact?: string; role?: string } | null | undefined;
  onOpen?: () => void;
  onClose?: () => void;
  /**
   * Who is signed in on this app — null when nobody is. Given, every entry
   * asks for a sign-in first (J, 29 Oct): the dialog opens only for an
   * account, and a ticket is that account's. `hostAccount` in client.ts asks
   * this host's /api/auth (seyali.app, Mesai, Kadai). Vidai gives none yet.
   */
  account?: () => Promise<Account | null>;
  /** The app's own sign-in dialog: true once signed in, false if closed. */
  signIn?: () => Promise<boolean>;
};

const NAMES: Record<AppId, string> = { seyali: "Seyali", mesai: "Mesai", kadai: "Kadai", karkai: "Karkai", vidai: "Vidai", thunai: "Thunai", parai: "Parai", medai: "Medai" };
const MAX_RECORDING_MS = 3 * 60_000;
const MAX_FILE = 4 * 1024 * 1024;

let opts: FeedbackOptions = { app: "seyali" };
let installed = false;

/** Call once at boot, as early as possible: the log starts here. */
export function installFeedback(o: FeedbackOptions): void {
  opts = { replay: "on-demand", snapshot: true, ...o };
  if (installed) return;
  installed = true;
  setBase(o.api ?? platformFor(location.hostname));
  setAccountSource(opts.account ?? null);
  installCapture((u) => u.includes("/api/feedback"));
  ensureStyle();
  if (opts.replay === "buffer") whenIdle(() => void replay.startBuffer().catch(() => {}));
}

/** Change what may be captured, as the page learns who is on it (a student signs in: replay off). */
export function setFeedback(change: Partial<FeedbackOptions>): void {
  const before = opts.replay;
  opts = { ...opts, ...change };
  if (before === opts.replay) return;
  if (opts.replay === "buffer") whenIdle(() => void replay.startBuffer().catch(() => {}));
  else if (replay.recording().mode === "buffer" || opts.replay === "off") { replay.stopAll(); manual = null; }
}

const whenIdle = (fn: () => void) => ("requestIdleCallback" in window ? (window as unknown as { requestIdleCallback: (f: () => void, o?: unknown) => void }).requestIdleCallback(fn, { timeout: 4000 }) : setTimeout(fn, 2000));

// --- a tiny element builder -----------------------------------------------------
type Kid = Node | string | null | false | undefined;
function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, unknown> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
    else if (k === "class") el.className = String(v);
    else if (k === "text") el.textContent = String(v);
    else if (k === "value") (el as HTMLInputElement).value = String(v);
    else if (k === "checked") (el as HTMLInputElement).checked = !!v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids) if (kid !== null && kid !== undefined && kid !== false) el.append(kid);
  return el;
}
const svg = (path: string, size = 18) => {
  const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  el.setAttribute("viewBox", "0 0 24 24"); el.setAttribute("width", String(size)); el.setAttribute("height", String(size));
  el.setAttribute("fill", "none"); el.setAttribute("stroke", "currentColor"); el.setAttribute("stroke-width", "2");
  el.setAttribute("stroke-linecap", "round"); el.setAttribute("stroke-linejoin", "round"); el.setAttribute("aria-hidden", "true");
  el.innerHTML = path;
  return el;
};
const I = {
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  bug: '<path d="M8 2l1.9 1.9M16 2l-1.9 1.9M9 7.1A3 3 0 0 1 15 7.1M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6zM12 20v-9M6 13H2M22 13h-4M3 21l3.5-2.5M21 21l-3.5-2.5M3 7l3.5 2M21 7l-3.5 2"/>',
  idea: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V17h8v-2.3A7 7 0 0 0 12 2z"/>',
  star: '<path d="m12 2 3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1z" fill="currentColor"/>',
  up: '<path d="m6 15 6-6 6 6"/>',
  screen: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8M12 17v4"/>',
  clip: '<path d="m21.4 11-8.5 8.5a5.5 5.5 0 0 1-7.8-7.8l9.2-9.2a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  back: '<path d="m15 18-6-6 6-6"/>',
  out: '<path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 1v4M12 19v4M1 12h4M19 12h4"/>',
  play: '<path d="M7 5v14l11-7z" fill="currentColor"/>',
  spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>',
};

// --- what this visit has typed and gathered (kept while the page lives) ----------
const draft = {
  issue: { title: "", body: "", contact: "" },
  feature: { title: "", body: "" },
  review: { rating: 0, body: "" },
  withSnapshot: true, withTraces: true, withReplay: true,
};
type Shot = Attachment & { url?: string };
let shots: Shot[] = [];
let manual: replay.Recording | null = null;
let snapEvents: Promise<unknown[] | null> | null = null;
let showLog = false;

let root: HTMLDivElement | null = null;
let card: HTMLDivElement | null = null;
let view: View = "issue";
let detail: string | null = null;
let doneTicket: Ticket | null = null;
let error = "";
let busy = "";
let returnFocus: HTMLElement | null = null;
let pill: HTMLDivElement | null = null;
// The part of the screen the person pointed at ("Point at it").
let picked: PickedElement | null = null;
// A recording or snapshot being watched inside the dialog, and its player.
let preview: { title: string; load: () => Promise<unknown[] | null>; at?: "start" | "end"; highlight?: Highlight | null } | null = null;
let player: PlayerHandle | null = null;
// Seyari writing up the report just sent.
let triageState: { id: string; status: "working" | "done" | "off"; triage?: Triage } | null = null;

/** Open the dialog. `ticket` opens one ticket (a feature from the board, or one of mine). */
export function openFeedback(start: View = "issue", ticket?: string): void {
  if (!installed) installFeedback(opts);
  if (pill) return; // a recording is running: its pill is the way back
  if (root) { showDialog(start, ticket); return; } // already open: signed in
  void signedInThen(() => showDialog(start, ticket));
}

// Sign in first, then go (J, 29 Oct). Signed out, this device forgets the
// tickets and votes it remembered, so the next person to use it sees none.
let gating = false;
async function signedInThen(go: () => void): Promise<void> {
  if (!opts.account) { go(); return; }
  if (gating) return; // a second click while the sign-in is up
  gating = true;
  try {
    let who = await opts.account().catch(() => null);
    if (!who) {
      forgetDevice();
      if (!opts.signIn || !(await opts.signIn().catch(() => false))) return;
      who = await opts.account().catch(() => null);
      if (!who) return;
    }
    setToken(who.token || "");
    go();
  } finally { gating = false; }
}

function showDialog(start: View, ticket?: string): void {
  view = start; detail = ticket || null; doneTicket = null; error = ""; busy = ""; preview = null;
  if (!draft.issue.contact) draft.issue.contact = opts.reporter?.()?.contact || "";
  // The snapshot is of the page as it is now, the dialog blocked out of it.
  if (start === "issue" && opts.snapshot) takeSnapshot();
  if (!root) {
    returnFocus = document.activeElement as HTMLElement | null;
    root = h("div", { class: "fb-root" });
    // On the document, not the dialog: a button that disables itself while
    // it works drops focus to the body, and Escape must still close.
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(root);
    lockPage(true);
    opts.onOpen?.();
  }
  paint();
}

/**
 * The five ways in, one list, so every app's menus offer the same set in the
 * same order and words: the four views of the dialog and the public board.
 */
export type EntryKey = View | "board";
export const FEEDBACK_ENTRIES: { key: EntryKey; label: string; hint: string }[] = [
  { key: "issue", label: "Report a problem", hint: "Something broke or looks wrong" },
  { key: "feature", label: "Suggest an idea", hint: "What would help you most" },
  { key: "review", label: "Write a review", hint: "How it is going for you" },
  { key: "mine", label: "My tickets", hint: "What you sent, and where it has got to" },
  { key: "board", label: "Ideas board", hint: "Vote for what others have asked" },
];
/** The public ideas board, filtered to this app. */
export function ideasBoardUrl(): string {
  if (!installed) setBase(opts.api ?? platformFor(location.hostname));
  return `${siteUrl()}/feedback?app=${opts.app}`;
}
/** Open one of FEEDBACK_ENTRIES: the dialog on that view, or the board in a new tab. */
export function openFeedbackEntry(key: EntryKey): void {
  if (key !== "board") { openFeedback(key); return; }
  void signedInThen(() => {
    // After a sign-in the browser may count the new tab as a pop-up: then
    // the board opens here instead. (With "noopener" open() always answers
    // null, so the opener is cut by hand to tell the two apart.)
    const tab = window.open(ideasBoardUrl(), "_blank");
    if (tab) tab.opener = null; else location.assign(ideasBoardUrl());
  });
}

export function closeFeedback(): void {
  if (!root) return;
  player?.destroy(); player = null; preview = null;
  root.remove(); root = null; card = null;
  document.removeEventListener("keydown", onKey, true);
  lockPage(false);
  opts.onClose?.();
  returnFocus?.focus?.();
}

function takeSnapshot() {
  snapEvents = replay.snapshot().catch(() => null);
}

let savedOverflow = "";
function lockPage(on: boolean) {
  const el = document.documentElement;
  if (on) { savedOverflow = el.style.overflow; el.style.overflow = "hidden"; }
  else el.style.overflow = savedOverflow;
}

function onKey(e: KeyboardEvent) {
  if (e.key === "Escape" && !busy) { e.stopPropagation(); e.preventDefault(); closeFeedback(); return; }
  if (e.key !== "Tab" || !card) return;
  const list = [...card.querySelectorAll<HTMLElement>("button, input, textarea, a[href], [tabindex]:not([tabindex='-1'])")].filter((x) => !x.hasAttribute("disabled") && x.offsetParent !== null);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

// --- painting --------------------------------------------------------------------
function paint(focusSel?: string) {
  if (!root) return;
  const appName = NAMES[opts.app];
  const tabs: [View, string][] = [["issue", "Problem"], ["feature", "Idea"], ["review", "Review"], ["mine", "My tickets"]];
  player?.destroy(); player = null;
  const heading = preview ? preview.title : doneTicket ? "Sent" : detail ? "Ticket" : { issue: "Report a problem", feature: "Suggest an idea", review: `Review ${appName}`, mine: "My tickets" }[view];
  const body = h("div", { class: "fb-body" });
  const foot = h("div", { class: "fb-foot" });
  card = h("div", { class: "fb-card", role: "dialog", "aria-modal": "true", "aria-labelledby": "fb-h" },
    h("div", { class: "fb-head" },
      h("h2", { class: "fb-title", id: "fb-h", text: heading }),
      h("button", { class: "fb-x", type: "button", "aria-label": "Close", onclick: () => !busy && closeFeedback() }, svg(I.x))),
    !doneTicket && !detail && !preview && h("div", { class: "fb-tabs", role: "tablist", "aria-label": "What is it about?" },
      ...tabs.map(([v, label]) => h("button", { class: "fb-tab", type: "button", role: "tab", "aria-selected": String(view === v), onclick: () => { if (busy) return; view = v; error = ""; if (v === "issue" && opts.snapshot && !snapEvents) takeSnapshot(); paint(); } }, label))),
    body, foot);
  const scrim = h("div", { class: "fb-scrim", onclick: (e: Event) => { if (e.target === scrim && !busy) closeFeedback(); } }, card);
  root.replaceChildren(scrim);
  if (error) body.append(h("p", { class: "fb-error", role: "alert", text: error }));
  if (preview) paintPreview(body, foot);
  else if (doneTicket) paintDone(body, foot, doneTicket);
  else if (detail) paintDetail(body, foot, detail);
  else ({ issue: paintIssue, feature: paintFeature, review: paintReview, mine: paintMine }[view])(body, foot);
  const target = (focusSel && card.querySelector<HTMLElement>(focusSel)) || card.querySelector<HTMLElement>(".fb-body input, .fb-body textarea, .fb-body button") || card.querySelector<HTMLElement>(".fb-x");
  target?.focus();
}

const field = (label: string, control: HTMLElement, hint?: string) => h("label", { class: "fb-field" }, h("span", { class: "fb-label", text: label }), control, hint && h("span", { class: "fb-hint", text: hint }));
const check = (title: string, sub: string | Node, on: boolean, set: (v: boolean) => void, extra?: Node) =>
  h("label", { class: "fb-check" },
    h("input", { type: "checkbox", checked: on, onchange: (e: Event) => set((e.target as HTMLInputElement).checked) }),
    h("span", { class: "fb-check-main" }, h("span", { class: "fb-check-t", text: title }), h("span", { class: "fb-check-s" }, sub), extra || null));
const secs = (ms: number) => { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

function paintIssue(body: HTMLElement, foot: HTMLElement) {
  const t = traces();
  const d = digestOf(t);
  const buffered = replay.buffered();
  body.append(
    field("What went wrong?", h("input", { class: "fb-input", id: "fb-title", maxlength: "120", placeholder: "e.g. Hand in does nothing", value: draft.issue.title, oninput: (e: Event) => { draft.issue.title = (e.target as HTMLInputElement).value; } })),
    field("What did you expect instead?", h("textarea", { class: "fb-area", maxlength: "4000", placeholder: "A few words are enough", oninput: (e: Event) => { draft.issue.body = (e.target as HTMLTextAreaElement).value; } }, draft.issue.body),
      opts.replay !== "off" || opts.snapshot ? "Seyari writes up the steps and details from what you send with it." : undefined),
  );
  const sec = h("div", { class: "fb-sec" }, h("p", { class: "fb-sec-h", text: "Sent with it, to help us fix it" }));
  const watch = (label: string, open: () => void) => h("button", { class: "fb-link", type: "button", style: "margin-right:12px", onclick: (e: Event) => { e.preventDefault(); open(); } }, svg(I.play, 12), ` ${label}`);
  if (opts.snapshot) sec.append(check("Page snapshot", "This screen as page elements. Anything typed is hidden.", draft.withSnapshot, (v) => { draft.withSnapshot = v; },
    watch("View", () => openPreview({ title: "Page snapshot", load: () => snapEvents || Promise.resolve(null), at: "end", highlight: picked?.rect || null }))));
  if (picked) {
    const p = picked;
    sec.append(h("div", { class: "fb-check" }, h("span", { class: "fb-kind", style: "width:20px;height:20px;background:none;color:var(--fb-primary)" }, svg(I.target, 18)),
      h("span", { class: "fb-check-main" }, h("span", { class: "fb-check-t", text: "The part you pointed at" }),
        h("span", { class: "fb-check-s", text: `${p.tag}${p.text ? ` "${p.text.slice(0, 40)}"` : p.label ? ` "${p.label.slice(0, 40)}"` : ""} · ${p.rect.w}×${p.rect.h}, font ${p.styles["font-size"] || "?"}` }),
        h("span", {}, h("button", { class: "fb-link", type: "button", style: "margin-right:12px", onclick: (e: Event) => { e.preventDefault(); pointAt(); } }, "Point again"),
          h("button", { class: "fb-link", type: "button", onclick: (e: Event) => { e.preventDefault(); picked = null; paint(); } }, "Remove")))));
  }
  const logLine = `${d.errors.length} error${d.errors.length === 1 ? "" : "s"} · ${t.network.length} request${t.network.length === 1 ? "" : "s"} · ${t.trail.length} page${t.trail.length === 1 ? "" : "s"}`;
  sec.append(check("Console and network log", logLine, draft.withTraces, (v) => { draft.withTraces = v; },
    h("button", { class: "fb-link", type: "button", onclick: (e: Event) => { e.preventDefault(); showLog = !showLog; paint(); } }, showLog ? "Hide" : "See what is in it")));
  if (showLog) sec.append(h("pre", { class: "fb-pre", text: [...d.errors, ...d.failed, ...d.trail].join("\n") || "Nothing went wrong in the log — only ordinary requests." }));
  if (manual) {
    const rec = manual;
    sec.append(check(`Your recording · ${secs(manual.ms)}`, "What you showed us. Typed text is hidden.", draft.withReplay, (v) => { draft.withReplay = v; },
      h("span", {}, watch("Play", () => openPreview({ title: "Your recording", load: async () => rec.events })),
        h("button", { class: "fb-link", type: "button", onclick: (e: Event) => { e.preventDefault(); manual = null; paint(); } }, "Remove"))));
  } else if (buffered && opts.replay === "buffer") {
    sec.append(check(`The last ${secs(buffered.ms)} on screen`, "What happened before you opened this. Typed text is hidden.", draft.withReplay, (v) => { draft.withReplay = v; },
      watch("Play", () => openPreview({ title: "The last moments on screen", load: async () => buffered.events }))));
  }
  const tools = h("div", { class: "fb-tools" });
  tools.append(h("button", { class: "fb-btn fb-btn-sm", type: "button", onclick: pointAt }, svg(I.target, 16), picked ? "Point again" : "Point at it"));
  if (opts.replay !== "off" && !manual) tools.append(h("button", { class: "fb-btn fb-btn-sm", type: "button", onclick: startRecording }, h("span", { class: "fb-rec-dot" }), "Record the problem"));
  if (navigator.mediaDevices && "getDisplayMedia" in navigator.mediaDevices && opts.snapshot) tools.append(h("button", { class: "fb-btn fb-btn-sm", type: "button", onclick: captureScreen }, svg(I.screen, 16), "Capture screen"));
  const picker = h("input", { type: "file", multiple: true, accept: "image/*,video/*,application/pdf,text/plain,.log,.txt,.json", class: "fb-sr", tabindex: "-1", "aria-hidden": "true", onchange: (e: Event) => addFiles((e.target as HTMLInputElement).files) });
  tools.append(h("button", { class: "fb-btn fb-btn-sm", type: "button", onclick: () => picker.click() }, svg(I.clip, 16), "Attach a file"), picker);
  sec.append(tools);
  if (shots.length) sec.append(h("div", { class: "fb-files" }, ...shots.map((s, i) => h("span", { class: "fb-file" },
    s.url ? h("img", { src: s.url, alt: "" }) : null,
    h("span", { class: "fb-file-name", text: `${s.name} · ${kb(s.bytes.length)}` }),
    h("button", { class: "fb-x", type: "button", "aria-label": `Remove ${s.name}`, onclick: () => { if (s.url) URL.revokeObjectURL(s.url); shots.splice(i, 1); paint(); } }, svg(I.x, 14))))));
  body.append(sec,
    field("Your email or WhatsApp (optional)", h("input", { class: "fb-input", maxlength: "80", autocomplete: "email", value: draft.issue.contact, oninput: (e: Event) => { draft.issue.contact = (e.target as HTMLInputElement).value; } }), "Only if we may ask you more. The team sees it; nobody else does."));
  foot.append(
    h("span", { class: "fb-foot-note", text: busy || "Goes to the Seyali team. Follow it in My tickets." }),
    h("button", { class: "fb-btn", type: "button", disabled: !!busy, onclick: closeFeedback }, "Cancel"),
    h("button", { class: "fb-btn fb-primary", type: "button", disabled: !!busy, onclick: sendIssue }, busy ? "Sending…" : "Send report"));
}

function paintFeature(body: HTMLElement, foot: HTMLElement) {
  const list = h("div", { "aria-live": "polite" });
  let timer = 0;
  const look = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(async () => {
      const text = draft.feature.title.trim();
      if (text.length < 4) { list.replaceChildren(); return; }
      try {
        const { similar } = await fb.similar(text, draft.feature.body, opts.app);
        if (text !== draft.feature.title.trim()) return;
        list.replaceChildren(...(similar.length ? [h("div", { class: "fb-similar" }, h("p", { class: "fb-similar-h", text: "Already asked? Vote for it, or add what you need" }), ...similar.map(similarRow))] : []));
      } catch { list.replaceChildren(); }
    }, 350);
  };
  body.append(
    field("What would you like?", h("input", { class: "fb-input", id: "fb-title", maxlength: "120", placeholder: "e.g. Print the kitchen ticket by itself", value: draft.feature.title, oninput: (e: Event) => { draft.feature.title = (e.target as HTMLInputElement).value; look(); } })),
    list,
    field("Tell us more", h("textarea", { class: "fb-area", maxlength: "4000", placeholder: "What it would help you do, and how you do it today", oninput: (e: Event) => { draft.feature.body = (e.target as HTMLTextAreaElement).value; } }, draft.feature.body),
      "Ideas are public on the Seyali ideas board, so others can vote. Your name is not shown."),
  );
  if (draft.feature.title.trim().length >= 4) look();
  foot.append(
    h("a", { class: "fb-foot-note", href: `${siteUrl()}/feedback?app=${opts.app}`, target: "_blank", rel: "noopener" }, "See every idea"),
    h("button", { class: "fb-btn", type: "button", disabled: !!busy, onclick: closeFeedback }, "Cancel"),
    h("button", { class: "fb-btn fb-primary", type: "button", disabled: !!busy, onclick: sendFeature }, busy ? "Sending…" : "Send idea"));
}

function voteButton(id: string, votes: number, voted: boolean, after?: (votes: number, on: boolean) => void) {
  const label = () => `${voted ? "Remove your vote" : "Vote"} · ${votes} vote${votes === 1 ? "" : "s"}`;
  const btn = h("button", { class: "fb-vote", type: "button", "aria-pressed": String(voted), "aria-label": label() }, svg(I.up), String(votes));
  btn.addEventListener("click", async () => {
    btn.disabled = true;
    try {
      const out = await fb.vote(id, !voted);
      voted = out.voted; votes = out.votes;
      btn.setAttribute("aria-pressed", String(voted)); btn.setAttribute("aria-label", label());
      btn.replaceChildren(svg(I.up), String(votes));
      after?.(votes, voted);
    } catch (e) { error = (e as Error).message; paint(); }
    btn.disabled = false;
  });
  return btn;
}
function similarRow(f: BoardItem) {
  return h("div", { class: "fb-item" },
    voteButton(f.id, f.votes, votedSet().has(f.id)),
    h("span", { class: "fb-item-main" },
      h("button", { class: "fb-link", type: "button", style: "font-size:14px;text-align:left;text-decoration:none;color:inherit", onclick: () => { detail = f.id; paint(); } }, f.title),
      h("span", { class: "fb-item-s", text: `${f.appName} · ${STATUS_LABEL[f.status]}${f.comments ? ` · ${f.comments} comment${f.comments === 1 ? "" : "s"}` : ""}` })));
}

function paintReview(body: HTMLElement, foot: HTMLElement) {
  const stars = h("div", { class: "fb-stars", role: "radiogroup", "aria-label": "Your rating" },
    ...[1, 2, 3, 4, 5].map((n) => h("button", { class: "fb-star", type: "button", role: "radio", "aria-checked": String(draft.review.rating >= n), "aria-label": `${n} star${n === 1 ? "" : "s"}`, onclick: () => { draft.review.rating = n; paint(`.fb-star:nth-child(${n})`); } }, svg(I.star, 26))));
  body.append(h("span", { class: "fb-label", text: `How is ${NAMES[opts.app]} for you?` }), stars,
    field("What do you like, and what would make it better?", h("textarea", { class: "fb-area", maxlength: "4000", oninput: (e: Event) => { draft.review.body = (e.target as HTMLTextAreaElement).value; } }, draft.review.body)));
  foot.append(
    h("span", { class: "fb-foot-note", text: "Goes to the Seyali team." }),
    h("button", { class: "fb-btn", type: "button", disabled: !!busy, onclick: closeFeedback }, "Cancel"),
    h("button", { class: "fb-btn fb-primary", type: "button", disabled: !!busy || !draft.review.rating, onclick: sendReview }, busy ? "Sending…" : "Send review"));
}

const KIND_ICON: Record<Kind, string> = { issue: I.bug, feature: I.idea, review: I.star };
const KIND_LABEL: Record<Kind, string> = { issue: "Problem", feature: "Idea", review: "Review" };
const statusChip = (s: Status) => h("span", { class: `fb-chip ${s === "done" ? "fb-chip-done" : s === "planned" || s === "in_progress" ? "fb-chip-on" : ""}`, text: STATUS_LABEL[s] });
const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }) : "");

function paintMine(body: HTMLElement, foot: HTMLElement) {
  const list = h("div", { class: "fb-list" }, h("p", { class: "fb-empty", text: "Loading your tickets…" }));
  body.append(list);
  fb.mine().then(({ tickets }) => {
    if (!tickets.length) { list.replaceChildren(h("p", { class: "fb-empty", text: "Nothing yet. A problem you report or an idea you send shows here, with its progress." })); return; }
    list.replaceChildren(...tickets.map((t) => h("button", { class: "fb-row", type: "button", onclick: () => { detail = t.id; paint(); } },
      h("span", { class: "fb-kind" }, svg(KIND_ICON[t.kind])),
      h("span", { class: "fb-item-main" }, h("span", { class: "fb-item-t", text: t.title }), h("span", { class: "fb-item-s", text: `${KIND_LABEL[t.kind]} · ${t.appName} · ${when(t.updatedAt || t.createdAt)}` })),
      statusChip(t.status))));
  }).catch((e) => list.replaceChildren(h("p", { class: "fb-error", text: (e as Error).message })));
  foot.append(
    h("span", { class: "fb-foot-note", text: opts.account ? "On your account." : "Kept on this device." }),
    h("a", { class: "fb-btn", href: `${siteUrl()}/my-tickets${keysFragment()}`, target: "_blank", rel: "noopener" }, "Open on seyali.app", svg(I.out, 15)));
}

function paintDetail(body: HTMLElement, foot: HTMLElement, id: string) {
  body.append(h("button", { class: "fb-link fb-back", type: "button", onclick: () => { detail = null; paint(); } }, svg(I.back, 15), "Back"));
  const box = h("div", {}, h("p", { class: "fb-empty", text: "Loading…" }));
  body.append(box);
  fb.ticket(id).then(({ ticket: t, comments, voted, mine }) => {
    const kids: Node[] = [
      h("h3", { style: "margin:0 0 6px;font-size:17px;overflow-wrap:anywhere", text: t.title }),
      h("div", { style: "display:flex;flex-wrap:wrap;gap:6px;align-items:center" }, statusChip(t.status), h("span", { class: "fb-chip", text: t.appName }), h("span", { class: "fb-chip", text: KIND_LABEL[t.kind] }), mine ? h("span", { class: "fb-mono", style: "color:var(--fb-muted)", text: t.id }) : null),
    ];
    if (t.body) kids.push(h("p", { class: "fb-quote", text: t.body }));
    if (mine && t.kind === "issue") {
      if (t.triage) kids.push(triageBlock(t.triage));
      else if (t.status !== "uploading") {
        if (triageState?.id === t.id && triageState.status === "working") kids.push(triageWaiting());
        else {
          const ask = h("button", { class: "fb-btn fb-btn-sm", type: "button", style: "margin-top:12px" }, svg(I.spark, 15), "Ask Seyari to write up the steps");
          ask.addEventListener("click", () => { void startTriage(t.id); paint(); });
          kids.push(ask);
        }
      }
      kids.push(...evidenceRows(t));
    }
    if (t.kind === "feature") kids.push(h("div", { class: "fb-item", style: "border:0;padding:12px 0 0" }, voteButton(t.id, t.votes, voted ?? votedSet().has(t.id)), h("span", { class: "fb-item-s", text: "Vote if you need it too — the most wanted are built first." })));
    const updates = t.updates.filter((u) => u.status || u.note);
    if (updates.length) kids.push(h("p", { class: "fb-sec-h", style: "margin-top:16px", text: "Progress" }), h("ul", { class: "fb-tl" }, ...updates.map((u, i) => h("li", { class: i === updates.length - 1 ? "fb-tl-on" : "" },
      h("time", { text: when(u.at) }),
      u.status ? h("strong", { text: STATUS_LABEL[u.status] }) : null,
      u.note ? h("p", { class: "fb-quote", text: `${u.by === "reporter" ? "You: " : ""}${u.note}` }) : null))));
    const others = comments.filter((c: Comment) => t.kind === "feature" || c.team);
    if (t.kind === "feature" && others.length) kids.push(h("p", { class: "fb-sec-h", style: "margin-top:16px", text: `What others need (${others.length})` }), ...others.map((c: Comment) => h("div", { class: "fb-quote" }, h("strong", { text: `${c.team ? "Seyali team" : c.name || "Someone"} · ` }), c.text)));
    const canAdd = t.kind === "feature" ? t.status !== "wont_do" && t.status !== "duplicate" : mine;
    if (canAdd) {
      const area = h("textarea", { class: "fb-area", maxlength: "1000", placeholder: t.kind === "feature" ? "What you need it for, or what it should also do" : "Anything you have noticed since" });
      const name = t.kind === "feature" ? h("input", { class: "fb-input", maxlength: "40", placeholder: "Your first name (optional)", style: "margin-top:8px", value: opts.reporter?.()?.name?.split(" ")[0] || "" }) : null;
      const btn = h("button", { class: "fb-btn fb-btn-sm", type: "button", style: "margin-top:8px" }, t.kind === "feature" ? "Add my needs" : "Add details");
      btn.addEventListener("click", async () => {
        if (area.value.trim().length < 2) { area.focus(); return; }
        btn.disabled = true;
        try { await fb.comment(t.id, area.value.trim(), name?.value); paint(); } catch (e) { error = (e as Error).message; paint(); }
      });
      kids.push(h("label", { class: "fb-field", style: "margin-top:16px" }, h("span", { class: "fb-label", text: t.kind === "feature" ? "Add what you need" : "Add more details" }), area), ...(name ? [name] : []), btn);
    }
    box.replaceChildren(...kids);
  }).catch((e) => box.replaceChildren(h("p", { class: "fb-error", text: (e as Error).message })));
  foot.append(
    h("span", { class: "fb-foot-note" }),
    h("a", { class: "fb-btn", href: `${siteUrl()}/feedback/${encodeURIComponent(id)}`, target: "_blank", rel: "noopener" }, "Open on seyali.app", svg(I.out, 15)));
}

// What a ticket was sent with, to watch again: the recording, the snapshot
// (with the part they pointed at outlined), and their screenshots.
function evidenceRows(t: Ticket): Node[] {
  const files = (t.files || []).filter((f): f is TicketFile => !!f.id);
  if (!files.length && !t.element) return [];
  const rows: Node[] = [h("p", { class: "fb-sec-h", style: "margin-top:16px", text: "What you sent" })];
  const hl = t.element?.rect || null;
  for (const f of files) {
    if (f.kind === "replay" || f.kind === "snapshot") {
      const label = f.kind === "replay" ? `Your recording${f.ms ? ` · ${secs(f.ms)}` : ""}` : "Page snapshot";
      rows.push(h("button", { class: "fb-row", type: "button", onclick: () => openPreview({ title: label, load: () => fileEvents(t.id, f), at: f.kind === "snapshot" ? "end" : "start", highlight: f.kind === "snapshot" ? hl : null }) },
        h("span", { class: "fb-kind" }, svg(I.play, 16)), h("span", { class: "fb-item-main" }, h("span", { class: "fb-item-t", text: label }), h("span", { class: "fb-item-s", text: f.kind === "replay" ? "Play it back" : "See the screen as it was" }))));
    } else if (f.type.startsWith("image/")) {
      const img = h("img", { alt: f.name, style: "width:100%;max-height:220px;object-fit:contain;border-radius:10px;background:var(--fb-fill)" });
      fileUrl(t.id, f).then((u) => { img.src = u; }).catch(() => img.remove());
      rows.push(img);
    }
  }
  if (t.element) rows.push(h("p", { class: "fb-item-s", style: "margin:6px 0 0", text: `You pointed at: ${t.element.tag}${t.element.text ? ` "${t.element.text.slice(0, 40)}"` : ""} · ${t.element.rect.w}×${t.element.rect.h}` }));
  return rows;
}

function triageBlock(t: Triage): HTMLElement {
  return h("div", { class: "fb-tri" },
    h("p", { class: "fb-tri-h" }, svg(I.spark, 14), "Written up by Seyari AI from your report"),
    t.summary ? h("p", { text: t.summary }) : null,
    t.steps.length ? h("ol", {}, ...t.steps.map((x) => h("li", { text: x }))) : null,
    h("dl", {}, h("dt", { text: "Expected" }), h("dd", { style: "margin:0", text: t.expected || "—" }), h("dt", { text: "Actual" }), h("dd", { style: "margin:0", text: t.actual || "—" })));
}

// Seyari reads what was sent and writes the steps; the team checks them.
// Started once per ticket; whatever screen is showing that ticket repaints
// when it lands. Off (no key on this platform) or failed, it says nothing.
const triageWaiting = () => h("div", { class: "fb-tri" }, h("span", { class: "fb-tri-wait" }, h("span", { class: "fb-spin" }), "Seyari is reading what you sent and writing up the steps…"));
async function startTriage(id: string) {
  if (triageState?.id === id && triageState.status === "working") return;
  triageState = { id, status: "working" };
  try { triageState = { id, status: "done", triage: (await fb.triage(id)).triage }; }
  catch { triageState = { id, status: "off" }; }
  if (root && !preview && (doneTicket?.id === id || detail === id)) paint();
}

function openPreview(p: NonNullable<typeof preview>) { preview = p; paint(); }
function paintPreview(body: HTMLElement, foot: HTMLElement) {
  const p = preview!;
  body.append(h("button", { class: "fb-link fb-back", type: "button", onclick: () => { preview = null; paint(); } }, svg(I.back, 15), "Back"));
  const host = h("div", {});
  body.append(host, h("p", { class: "fb-hint", text: "Typed text was hidden on your device before anything was kept." }));
  p.load().then(async (events) => {
    if (preview !== p || !host.isConnected) return;
    const handle = await mountPlayer(host, (events || []) as { type: number; timestamp: number }[], { at: p.at, highlight: p.highlight, maxHeight: Math.round(window.innerHeight * 0.55) });
    if (preview === p && host.isConnected) player = handle; else handle.destroy();
  }).catch((e) => { host.replaceChildren(h("p", { class: "fb-error", text: (e as Error).message })); });
  foot.append(h("span", { class: "fb-foot-note" }), h("button", { class: "fb-btn", type: "button", onclick: () => { preview = null; paint(); } }, "Done"));
}

function paintDone(body: HTMLElement, foot: HTMLElement, t: Ticket) {
  const said = { issue: "We have your report and everything you attached. You can follow it in My tickets.", feature: "Your idea is on the board. Others can vote for it, and you can follow it in My tickets.", review: "Thank you for the review. It goes straight to the team." }[t.kind];
  body.append(h("div", { class: "fb-done" },
    h("div", { class: "fb-done-mark" }, svg(I.check, 28)),
    h("h3", { text: "Thank you — it is with us" }),
    h("p", { text: said }),
    h("p", { class: "fb-mono", style: "margin-top:10px", text: t.id })));
  if (t.kind === "issue" && triageState?.id === t.id) {
    if (triageState.status === "done" && triageState.triage) body.append(triageBlock(triageState.triage));
    else if (triageState.status === "working") body.append(triageWaiting());
  }
  foot.append(h("span", { class: "fb-foot-note" }),
    h("button", { class: "fb-btn", type: "button", onclick: () => { doneTicket = null; view = "mine"; paint(); } }, "My tickets"),
    h("button", { class: "fb-btn fb-primary", type: "button", onclick: closeFeedback }, "Close"));
}

// --- gathering -----------------------------------------------------------------
// "Point at it": the dialog steps aside, the person taps the part that is
// wrong, and the dialog comes back with it named (and a fresh snapshot of
// the screen without the dialog over it, the part outlined when viewed).
function pointAt() {
  if (!root) return;
  closeFeedback();
  pickElement((p) => {
    if (p) picked = p.info;
    openFeedback("issue");
  });
}

function startRecording() {
  if (!root) return;
  const back = () => { manual = replay.stopManual(); pill?.remove(); pill = null; if (opts.replay === "buffer") void replay.startBuffer(); openFeedback("issue"); };
  closeFeedback();
  pill = h("div", { class: "fb-root fb-pill", role: "status" }, h("span", { class: "fb-rec-dot" }), h("span", { class: "fb-pill-t", text: "Recording 0:00" }),
    h("button", { class: "fb-btn", type: "button", onclick: back }, "Stop"));
  document.body.appendChild(pill);
  const label = pill.querySelector(".fb-pill-t")!;
  const started = Date.now();
  const tick = window.setInterval(() => { if (!pill) { clearInterval(tick); return; } label.textContent = `Recording ${secs(Date.now() - started)} · show us the problem`; }, 500);
  replay.startManual(MAX_RECORDING_MS, back).catch(() => { pill?.remove(); pill = null; error = "Recording could not start on this browser."; openFeedback("issue"); });
}

async function captureScreen() {
  if (!root) return;
  root.style.visibility = "hidden";
  try {
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true } as DisplayMediaStreamOptions);
    const video = document.createElement("video");
    video.srcObject = stream; video.muted = true; await video.play();
    await new Promise((r) => setTimeout(r, 250));
    const scale = Math.min(1, 1920 / (video.videoWidth || 1920));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round((video.videoWidth || 1280) * scale); canvas.height = Math.round((video.videoHeight || 720) * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    stream.getTracks().forEach((t) => t.stop());
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", 0.85));
    if (blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); shots.push({ kind: "screenshot", name: "screen.jpg", type: "image/jpeg", bytes, url: URL.createObjectURL(blob) }); }
  } catch { /* they chose not to share */ }
  if (root) root.style.visibility = "";
  paint();
}

const TYPE_OK = /^(image\/(png|jpeg|webp)|video\/(webm|mp4)|application\/(pdf|json)|text\/plain)$/;
async function addFiles(list: FileList | null) {
  for (const f of Array.from(list || [])) {
    if (shots.length >= 4) { error = "Up to four files."; break; }
    if (f.size > MAX_FILE) { error = `${f.name} is over 4 MB.`; continue; }
    const type = TYPE_OK.test(f.type) ? f.type : /\.(log|txt)$/i.test(f.name) ? "text/plain" : f.type === "image/heic" ? "" : "";
    if (!type) { error = `${f.name} cannot be attached — a photo, a video, a PDF or a text file can.`; continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    shots.push({ kind: "upload", name: f.name.slice(0, 80), type, bytes, url: type.startsWith("image/") ? URL.createObjectURL(f) : undefined });
  }
  paint();
}

// A recording that will not fit is trimmed to the newest full snapshot that does.
async function replayAttachment(rec: replay.Recording): Promise<Attachment | null> {
  let events = rec.events as { type: number; timestamp: number }[];
  for (let tries = 0; tries < 6 && events.length; tries++) {
    const a = await jsonAttachment("replay", "replay.json", events, { events: events.length, ms: events.length ? events[events.length - 1].timestamp - events[0].timestamp : 0 });
    if (a.bytes.length <= MAX_FILE) return a;
    const next = events.findIndex((e, i) => i > 2 && e.type === 2);
    if (next < 0) return null;
    events = events.slice(Math.max(0, events[next - 1]?.type === 4 ? next - 1 : next));
  }
  return null;
}

function reportContext() {
  return { ...deviceContext(), surface: opts.surface?.() || "", build: opts.build || "", role: opts.reporter?.()?.role || "" };
}

async function sendIssue() {
  if (draft.issue.title.trim().length < 4) { error = "Say in a few words what went wrong."; paint("#fb-title"); return; }
  busy = "Getting everything ready…"; error = ""; paint();
  try {
    const files: Attachment[] = [];
    const t = traces();
    if (draft.withTraces) files.push(await jsonAttachment("traces", "traces.json", { ...t, context: reportContext() }));
    if (opts.snapshot && draft.withSnapshot) {
      const events = await snapEvents;
      if (events?.length) files.push(await jsonAttachment("snapshot", "snapshot.json", events, { events: events.length }));
    }
    const rec = draft.withReplay ? manual || (opts.replay === "buffer" ? replay.buffered() : null) : null;
    if (rec) { const a = await replayAttachment(rec); if (a) files.push(a); }
    files.push(...shots.map(({ url: _u, ...s }) => s));
    const me = opts.reporter?.() || {};
    const ticket = await sendReport({
      app: opts.app, kind: "issue", title: draft.issue.title, body: draft.issue.body,
      reporter: { name: me.name, role: me.role, contact: draft.issue.contact }, context: reportContext(), digest: draft.withTraces ? digestOf(t) : {},
      element: picked || undefined,
    }, files, (done, of) => { busy = `Sending ${done} of ${of}…`; const note = card?.querySelector(".fb-foot-note"); if (note) note.textContent = busy; });
    draft.issue = { title: "", body: "", contact: draft.issue.contact };
    for (const s of shots) if (s.url) URL.revokeObjectURL(s.url);
    shots = []; manual = null; snapEvents = null; picked = null;
    // Seyari writes up the steps while the thank-you is on screen.
    busy = ""; doneTicket = ticket;
    void startTriage(ticket.id);
    paint();
  } catch (e) { busy = ""; error = (e as Error).message; paint(); }
}

async function sendFeature() {
  if (draft.feature.title.trim().length < 4) { error = "Say in a few words what you would like."; paint("#fb-title"); return; }
  busy = "Sending…"; error = ""; paint();
  try {
    const me = opts.reporter?.() || {};
    const ticket = await sendReport({ app: opts.app, kind: "feature", title: draft.feature.title, body: draft.feature.body, reporter: { name: me.name, role: me.role, contact: me.contact }, context: reportContext() }, [], () => {});
    draft.feature = { title: "", body: "" };
    busy = ""; doneTicket = ticket; paint();
  } catch (e) { busy = ""; error = (e as Error).message; paint(); }
}

async function sendReview() {
  if (!draft.review.rating) return;
  busy = "Sending…"; error = ""; paint();
  try {
    const me = opts.reporter?.() || {};
    const ticket = await sendReport({ app: opts.app, kind: "review", rating: draft.review.rating, body: draft.review.body, reporter: { name: me.name, role: me.role, contact: me.contact }, context: reportContext() }, [], () => {});
    draft.review = { rating: 0, body: "" };
    busy = ""; doneTicket = ticket; paint();
  } catch (e) { busy = ""; error = (e as Error).message; paint(); }
}
