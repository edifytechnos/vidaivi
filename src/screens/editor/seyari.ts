// Seyari AI — the chat panel a teacher writes a test with.
//
// A side panel docked to the right edge of the authoring editor, shaped like
// the chat panels people already know: a slim header, a transcript, and a
// rounded composer at the foot with "+" for attachments on the left and send on
// the right. The teacher asks for questions, or attaches a paper — a PDF, a
// photograph, a picture taken right now — and the model answers with question
// CARDS. Nothing reaches the draft until the teacher presses **Add** on a card:
// the AI drafts, the teacher accepts. That is the same line marking draws
// ("the AI proposes, the teacher awards"), and for the same reason — a number
// a teacher has to choose gets reviewed; one already in the box gets
// rubber-stamped.
//
// It lives OUTSIDE `#app`, appended to the body. The editor repaints `#app`
// on every question click, and a panel inside it would be torn down with each
// repaint, taking the conversation with it. A MutationObserver watches for the
// editor leaving the screen instead — `[data-authoring]` on the editor's root
// is the thing it looks for — and closes the panel when it does.
//
// The conversation is held HERE, in the page, for the session, and nowhere
// else. Earlier turns go back to the model as text so "make the third one
// harder" works; the photographs go once, with the message they belong to,
// and are never stored by anyone.

import { downscale } from "../../answerphotos";
import { fetchMyCredits } from "../../auth";
import { generateQuestions, newQuestionId } from "../../api";
import type { GenerateTurn, Proposed } from "../../api";
import { ICONS, escapeHtml, formatText, renderMath } from "../../dom";
import { pdfPagesToJpeg } from "../../pdfpages";
import type { Question } from "../../types";

/** What the editor hands the panel: where it is, and what to do with an accepted question. */
export interface SeyariHost {
  context(): { subject: string; title: string; chapter: string; existing: number; hasTest: boolean };
  /** Put accepted questions into the open draft. */
  accept(questions: Question[]): void;
  /** No draft open: make one holding these, named as suggested. */
  create(questions: Question[], title: string, chapter: string): Promise<void>;
}

/** Ten pages or photographs per message — the server's own cap. */
const MAX_IMAGES = 10;

interface Attachment {
  name: string;
  kind: "photo" | "pdf";
  images: string[];
  thumb: string;
  note: string;
}

interface Card {
  q: Proposed;
  state: "pending" | "added" | "dropped";
}

type Turn =
  | { role: "user"; text: string; attachments: { name: string; thumb: string; note: string }[] }
  | { role: "assistant"; reply: string; title: string; chapter: string; cards: Card[] }
  | { role: "error"; text: string };

let host: SeyariHost | null = null;
let panel: HTMLElement | null = null;
let observer: MutationObserver | null = null;
let transcript: Turn[] = [];
let pending: Attachment[] = [];
let busy = false;
let preparing = 0;
let credits: { left: number; low: boolean; on: boolean } | null = null;

/** Open the panel, or bring it back if it was hidden. */
export function openSeyari(h: SeyariHost): void {
  host = h;
  if (!panel) build();
  panel!.hidden = false;
  document.body.classList.add("sy-open");
  document.getElementById("ed-seyari")?.setAttribute("aria-pressed", "true");
  if (!credits) void loadCredits();
  (document.getElementById("sy-input") as HTMLTextAreaElement | null)?.focus();
}

/** Hide the panel; the conversation stays for when it is opened again. */
export function hideSeyari(): void {
  if (panel) panel.hidden = true;
  document.body.classList.remove("sy-open");
  document.getElementById("ed-seyari")?.setAttribute("aria-pressed", "false");
}

export function seyariOpen(): boolean {
  return !!panel && !panel.hidden;
}

export function toggleSeyari(h: SeyariHost): void {
  if (seyariOpen()) hideSeyari();
  else openSeyari(h);
}

/** Tear the panel down and forget the conversation — the editor is gone. */
export function closeSeyari(): void {
  observer?.disconnect();
  observer = null;
  panel?.remove();
  panel = null;
  host = null;
  transcript = [];
  pending = [];
  busy = false;
  preparing = 0;
  document.body.classList.remove("sy-open");
}

function build(): void {
  panel = document.createElement("aside");
  panel.className = "sy-panel";
  panel.id = "sy-panel";
  panel.setAttribute("role", "complementary");
  panel.setAttribute("aria-label", "Seyari AI");
  panel.innerHTML = `
    <div class="sy-head">
      <span class="sy-brand">${ICONS.spark}<span>Seyari AI</span></span>
      <div class="ed-spacer"></div>
      <button class="sy-icon" id="sy-close" aria-label="Close Seyari AI">${ICONS.close}</button>
    </div>
    <div class="sy-body" id="sy-body"></div>
    <div class="sy-composer">
      <div class="sy-attachments" id="sy-attachments" hidden></div>
      <textarea id="sy-input" class="sy-input" rows="1" placeholder="Ask for questions, or attach a paper…" aria-label="Message Seyari AI"></textarea>
      <div class="sy-bar">
        <div class="sy-plus-wrap">
          <button class="sy-icon sy-plus" id="sy-plus" aria-label="Attach a paper or photo" aria-haspopup="menu" aria-expanded="false">${ICONS.plus}</button>
          <div class="sy-menu" id="sy-menu" role="menu" hidden>
            <button role="menuitem" id="sy-pick">${ICONS.upload}<span>Upload a PDF or photos</span></button>
            <button role="menuitem" id="sy-shoot">${ICONS.camera}<span>Take a photo</span></button>
          </div>
        </div>
        <span class="sy-credits" id="sy-credits"></span>
        <button class="sy-send" id="sy-send" aria-label="Send">${ICONS.arrowUp}</button>
      </div>
      <input type="file" id="sy-file" accept="image/*,application/pdf" multiple hidden>
      <input type="file" id="sy-cam" accept="image/*" capture="environment" hidden>
    </div>`;
  document.body.appendChild(panel);
  bind();
  renderBody();

  // Close when the authoring editor leaves the screen. The check is deferred
  // a microtask because an editor REPAINT also replaces its root — by the time
  // the microtask runs the new root is in place, and a screen change is not.
  // A ghost loader (`.editor.sk-wrap`) is the editor on its way in — opening
  // another test paints one — so it keeps the panel too.
  const app = document.getElementById("app");
  if (app) {
    observer = new MutationObserver(() => {
      queueMicrotask(() => {
        if (panel && !document.querySelector("[data-authoring], .editor.sk-wrap")) closeSeyari();
      });
    });
    observer.observe(app, { childList: true });
  }
}

function bind(): void {
  const p = panel!;
  const input = p.querySelector<HTMLTextAreaElement>("#sy-input")!;
  const plus = p.querySelector<HTMLButtonElement>("#sy-plus")!;
  const menu = p.querySelector<HTMLElement>("#sy-menu")!;
  const file = p.querySelector<HTMLInputElement>("#sy-file")!;
  const cam = p.querySelector<HTMLInputElement>("#sy-cam")!;

  p.querySelector("#sy-close")!.addEventListener("click", hideSeyari);
  p.querySelector("#sy-send")!.addEventListener("click", () => void send());

  const closeMenu = () => {
    menu.hidden = true;
    plus.setAttribute("aria-expanded", "false");
  };
  plus.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    plus.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", (e) => {
    if (!menu.hidden && !(e.target as HTMLElement).closest("#sy-menu")) closeMenu();
  });
  p.querySelector("#sy-pick")!.addEventListener("click", () => {
    closeMenu();
    file.click();
  });
  p.querySelector("#sy-shoot")!.addEventListener("click", () => {
    closeMenu();
    cam.click();
  });
  file.addEventListener("change", () => {
    void addFiles(Array.from(file.files ?? []));
    file.value = "";
  });
  cam.addEventListener("change", () => {
    void addFiles(Array.from(cam.files ?? []));
    cam.value = "";
  });

  // Enter sends on a keyboard; on a touch screen Enter is a new line and the
  // send button is the way to send, because there is no Shift to hold.
  const coarse = matchMedia("(pointer: coarse)").matches;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !coarse) {
      e.preventDefault();
      void send();
    }
    if (e.key === "Escape") hideSeyari();
  });
  input.addEventListener("input", () => grow(input));

  p.querySelector("#sy-attachments")!.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-remove]");
    if (!btn) return;
    pending.splice(Number(btn.dataset.remove), 1);
    renderAttachments();
  });

  // One delegated handler for every card button, since the transcript is
  // re-rendered as cards change state.
  p.querySelector("#sy-body")!.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-act]");
    if (!btn) return;
    const turn = Number(btn.dataset.turn);
    const act = btn.dataset.act;
    if (act === "add") void addCards(turn, [Number(btn.dataset.card)]);
    else if (act === "drop") dropCard(turn, Number(btn.dataset.card));
    else if (act === "add-all") {
      const t = transcript[turn];
      if (t?.role === "assistant") {
        void addCards(
          turn,
          t.cards.map((c, i) => (c.state === "pending" ? i : -1)).filter((i) => i >= 0)
        );
      }
    } else if (act === "retry") {
      transcript.splice(turn, 1);
      renderBody();
      void send(true);
    }
  });
}

function grow(input: HTMLTextAreaElement): void {
  input.style.height = "auto";
  input.style.height = `${Math.min(160, input.scrollHeight)}px`;
}

async function loadCredits(): Promise<void> {
  const c = await fetchMyCredits();
  // A failed fetch says nothing: the server's gate is the real limit, and a
  // blip must neither claim a teacher is out nor reassure them they are not.
  if (!c) return;
  credits = { left: c.left, low: c.low, on: c.on !== false };
  renderCredits();
  renderBody();
}

function renderCredits(): void {
  const el = document.getElementById("sy-credits");
  const send = document.getElementById("sy-send") as HTMLButtonElement | null;
  if (!el) return;
  if (!credits) {
    el.textContent = "";
    el.className = "sy-credits";
    return;
  }
  if (!credits.on) {
    el.textContent = "Not switched on for this site";
    el.className = "sy-credits sy-credits-off";
    if (send) send.disabled = true;
    return;
  }
  el.textContent = `${credits.left} credit${credits.left === 1 ? "" : "s"} left · 1 per message`;
  el.className = `sy-credits${credits.low ? " sy-credits-low" : ""}`;
}

// ---------- attachments ----------

async function addFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  preparing += files.length;
  renderAttachments();
  for (const f of files) {
    const room = MAX_IMAGES - pending.reduce((n, a) => n + a.images.length, 0);
    try {
      if (room <= 0) {
        pending.push({ name: f.name, kind: "photo", images: [], thumb: "", note: `Left out — ${MAX_IMAGES} pages is the most one message can carry` });
      } else if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
        const { pages, total } = await pdfPagesToJpeg(f, room);
        pending.push({
          name: f.name,
          kind: "pdf",
          images: pages,
          thumb: pages[0] ? `data:image/jpeg;base64,${pages[0]}` : "",
          note: total > pages.length ? `first ${pages.length} of ${total} pages` : `${total} page${total === 1 ? "" : "s"}`,
        });
      } else {
        const jpeg = await downscale(f);
        pending.push({ name: f.name || "Photo", kind: "photo", images: [jpeg], thumb: `data:image/jpeg;base64,${jpeg}`, note: "" });
      }
    } catch (e) {
      pending.push({ name: f.name, kind: "photo", images: [], thumb: "", note: `Could not read this file${e instanceof Error && e.message ? ` — ${e.message}` : ""}` });
    }
    preparing -= 1;
    renderAttachments();
  }
}

function renderAttachments(): void {
  const el = document.getElementById("sy-attachments");
  if (!el) return;
  el.hidden = !pending.length && !preparing;
  el.innerHTML =
    pending
      .map(
        (a, i) => `
      <span class="sy-chip${a.images.length ? "" : " sy-chip-bad"}">
        ${a.thumb ? `<img src="${a.thumb}" alt="">` : `<span class="sy-chip-ic">${ICONS.file}</span>`}
        <span class="sy-chip-text"><span class="sy-chip-name">${escapeHtml(a.name)}</span>${
          a.note ? `<span class="sy-chip-note">${escapeHtml(a.note)}</span>` : ""
        }</span>
        <button class="sy-chip-x" data-remove="${i}" aria-label="Remove ${escapeHtml(a.name)}">${ICONS.close}</button>
      </span>`
      )
      .join("") +
    (preparing ? `<span class="sy-chip sy-chip-wait">Reading ${preparing === 1 ? "the file" : `${preparing} files`}…</span>` : "");
}

// ---------- the conversation ----------

function historyForServer(): GenerateTurn[] {
  const turns: GenerateTurn[] = [];
  for (const t of transcript) {
    if (t.role === "user") {
      const files = t.attachments.length ? ` [attached: ${t.attachments.map((a) => a.name).join(", ")}]` : "";
      turns.push({ role: "user", text: `${t.text}${files}`.trim() });
    } else if (t.role === "assistant") {
      // The questions ride back as the model wrote them, so a follow-up can
      // point at "the third one" and the model knows which that is.
      turns.push({
        role: "assistant",
        text: `${t.reply}\n${JSON.stringify(t.cards.map((c) => c.q))}`,
      });
    }
  }
  return turns.slice(-12);
}

async function send(retry = false): Promise<void> {
  if (busy || !host) return;
  const input = document.getElementById("sy-input") as HTMLTextAreaElement | null;
  const text = retry ? "" : (input?.value ?? "").trim();
  const attached = retry ? [] : pending.filter((a) => a.images.length);
  if (!retry) {
    if (!text && !attached.length) {
      input?.focus();
      return;
    }
    if (preparing) return;
    transcript.push({
      role: "user",
      text,
      attachments: attached.map((a) => ({ name: a.name, thumb: a.thumb, note: a.note })),
    });
    pending = [];
    if (input) {
      input.value = "";
      grow(input);
    }
    renderAttachments();
  }
  // On a retry the last user turn is re-sent; its images are gone with the
  // message, so the retry is text only and says so.
  const last = [...transcript].reverse().find((t) => t.role === "user");
  const history = historyForServer();
  const mine = history.pop(); // the turn being sent is the message, not history
  busy = true;
  renderBody();
  const ctx = host.context();
  const res = await generateQuestions({
    prompt: retry ? (mine?.text ?? "") : text,
    images: retry ? [] : attached.flatMap((a) => a.images),
    history,
    context: { subject: ctx.subject, title: ctx.title, chapter: ctx.chapter, existing: ctx.existing },
  });
  busy = false;
  if (!res.ok) {
    if (res.status === 501) credits = { left: 0, low: false, on: false };
    transcript.push({ role: "error", text: res.message });
    renderCredits();
    renderBody();
    return;
  }
  const r = res.result;
  if (r.credits) credits = { left: r.credits.left, low: r.credits.low, on: true };
  transcript.push({
    role: "assistant",
    reply: r.reply || (r.questions.length ? "Here is what I have." : "I could not make anything from that."),
    title: r.title,
    chapter: r.chapter,
    cards: r.questions.map((q) => ({ q, state: "pending" })),
  });
  void last;
  renderCredits();
  renderBody();
}

function toQuestion(p: Proposed, title: string, chapter: string): Question {
  const { needs: _needs, ...rest } = p;
  return { ...rest, id: newQuestionId(title || "q"), chapter: rest.chapter || chapter } as Question;
}

async function addCards(turnIndex: number, which: number[]): Promise<void> {
  const t = transcript[turnIndex];
  if (!host || t?.role !== "assistant" || !which.length) return;
  const ctx = host.context();
  const title = ctx.title || t.title;
  const chapter = ctx.chapter || t.chapter;
  const picked = which.map((i) => t.cards[i]).filter((c) => c && c.state === "pending");
  const questions = picked.map((c) => toQuestion(c.q, title, chapter));
  if (ctx.hasTest) {
    host.accept(questions);
  } else {
    await host.create(questions, t.title, t.chapter);
  }
  picked.forEach((c) => (c.state = "added"));
  renderBody();
}

function dropCard(turnIndex: number, card: number): void {
  const t = transcript[turnIndex];
  if (t?.role !== "assistant") return;
  const c = t.cards[card];
  if (c && c.state === "pending") c.state = "dropped";
  renderBody();
}

// ---------- rendering ----------

function renderBody(): void {
  const body = document.getElementById("sy-body");
  if (!body) return;
  if (!transcript.length && !busy) {
    body.innerHTML = `
      <div class="sy-empty">
        <span class="sy-empty-mark">${ICONS.spark}</span>
        <p class="sy-empty-title">What shall we write?</p>
        <p class="sy-empty-hint">Ask for questions on a chapter, or attach a paper — a PDF, a photo, or
        a picture you take now — and I will read the questions off it. Each one comes back as a
        card; nothing goes into your test until you add it.</p>
        <div class="sy-starters">
          <button class="sy-starter" data-starter="Ten MCQs on this chapter at board exam level, 1 mark each, with worked solutions.">Ten board-level MCQs</button>
          <button class="sy-starter" data-starter="A 20-mark short test on this chapter: four 2-mark short answers, two 3-mark short answers, one 5-mark long answer, with worked solutions.">A 20-mark short test</button>
          <button class="sy-starter" data-starter="Read the attached paper and transcribe every question on it, keeping the marks shown.">Read a paper I attach</button>
        </div>
      </div>`;
    body.querySelectorAll<HTMLButtonElement>("[data-starter]").forEach((b) =>
      b.addEventListener("click", () => {
        const input = document.getElementById("sy-input") as HTMLTextAreaElement | null;
        if (!input) return;
        input.value = b.dataset.starter ?? "";
        grow(input);
        input.focus();
      })
    );
    return;
  }

  const hasTest = host?.context().hasTest ?? true;
  body.innerHTML =
    transcript.map((t, i) => turnMarkup(t, i, hasTest)).join("") +
    (busy
      ? `<div class="sy-turn sy-ai"><div class="sy-bubble sy-thinking" aria-live="polite"><span></span><span></span><span></span></div></div>`
      : "");
  renderMath(body);
  body.scrollTop = body.scrollHeight;
}

function turnMarkup(t: Turn, index: number, hasTest: boolean): string {
  if (t.role === "user") {
    return `
      <div class="sy-turn sy-me">
        ${
          t.attachments.length
            ? `<div class="sy-sent-files">${t.attachments
                .map(
                  (a) =>
                    `<span class="sy-sent-file">${a.thumb ? `<img src="${a.thumb}" alt="">` : ""}<span>${escapeHtml(a.name)}${a.note ? ` · ${escapeHtml(a.note)}` : ""}</span></span>`
                )
                .join("")}</div>`
            : ""
        }
        ${t.text ? `<div class="sy-bubble">${formatText(t.text)}</div>` : ""}
      </div>`;
  }
  if (t.role === "error") {
    return `
      <div class="sy-turn sy-ai">
        <div class="sy-bubble sy-error">${escapeHtml(t.text)}
          <button class="btn-link" data-act="retry" data-turn="${index}">Try again</button>
        </div>
      </div>`;
  }
  const left = t.cards.filter((c) => c.state === "pending").length;
  return `
    <div class="sy-turn sy-ai">
      <div class="sy-bubble">${formatText(t.reply)}</div>
      ${t.cards.map((c, j) => cardMarkup(c, index, j, hasTest)).join("")}
      ${
        left > 1
          ? `<div class="sy-all"><button class="btn btn-primary" data-act="add-all" data-turn="${index}">${
              hasTest ? `Add all ${left} to the test` : `Create a test with all ${left}`
            }</button></div>`
          : ""
      }
    </div>`;
}

const TYPE_LABEL: Record<string, string> = { mcq: "MCQ", numeric: "Short answer", long: "Long answer" };

function cardMarkup(c: Card, turn: number, j: number, hasTest: boolean): string {
  const q = c.q;
  const answerIndex = typeof q.answer === "number" ? q.answer : -1;
  const options =
    q.type === "mcq" && q.options?.length
      ? `<ol class="sy-opts">${q.options
          .map(
            (o, k) =>
              `<li class="${k === answerIndex ? "sy-correct" : ""}"><span class="sy-opt-letter">${String.fromCharCode(65 + k)}</span><span>${formatText(o)}</span></li>`
          )
          .join("")}</ol>`
      : "";
  const short =
    q.type === "numeric"
      ? `<div class="sy-ans"><strong>Answer:</strong> ${escapeHtml(String(q.answer ?? ""))}${
          q.accept?.length ? ` <span class="sy-accept">also ${q.accept.map(escapeHtml).join(", ")}</span>` : ""
        }</div>`
      : "";
  const actions =
    c.state === "added"
      ? `<span class="sy-added">${ICONS.check}<span>${hasTest ? "Added to the test" : "In the new test"}</span></span>`
      : c.state === "dropped"
        ? `<span class="sy-dropped">Discarded</span>`
        : `<button class="btn btn-primary sy-add" data-act="add" data-turn="${turn}" data-card="${j}">${hasTest ? "Add to test" : "Create test with this"}</button>
           <button class="btn btn-ghost sy-drop" data-act="drop" data-turn="${turn}" data-card="${j}">Discard</button>`;
  return `
    <article class="sy-card sy-card-${c.state}">
      <div class="sy-card-head">
        <span class="sy-type">${TYPE_LABEL[q.type] ?? q.type}</span>
        <span class="sy-marks">${q.marks} mark${q.marks === 1 ? "" : "s"}</span>
        ${q.topic ? `<span class="sy-topic">${escapeHtml(q.topic)}</span>` : ""}
      </div>
      <div class="sy-q">${formatText(q.q)}</div>
      ${options}${short}
      ${q.solution ? `<details class="sy-sol"><summary>Worked solution</summary><div>${formatText(q.solution)}</div></details>` : ""}
      ${q.needs?.length ? `<div class="sy-needs">Needs work before publishing: ${q.needs.map(escapeHtml).join("; ")}</div>` : ""}
      <div class="sy-card-actions">${actions}</div>
    </article>`;
}
