// Browse: the read-only catalogue. Built-in shelves and the tests on them, laid
// out so a teacher can *evaluate* one — read every question and its worked
// solution — before taking their own copy of it.
//
// It exists because built-ins no longer sit on Your subjects: that grid means
// "subjects you own", so the library needs a home of its own. It is also where
// an admin reaches a master to correct it (Edit), which is the route that moved.
//
// Shaped as a catalogue rather than a list of ours: today every row is Vidai's
// and free, and when teacher-to-teacher sharing arrives those tests join the
// same list with a different byline. `rowMarkup` is the one row renderer, so a
// price or a rating joins it without touching the page.
//
// Like src/screens/review.ts, this reuses the editor's LAYOUT only — the .ed-*
// classes under an .ed-readonly modifier. It must never reach into
// src/screens/editor/: those panels are all inputs, and editor/state.ts is one
// shared working copy that autosaves, so browsing through it would queue writes
// against a master no teacher is allowed to change.

import { track } from "../analytics";
import {
  adoptTest,
  fetchLibrary,
  fetchServerTest,
  fetchSubjects,
  type ServerTestMeta,
  type Subject,
} from "../api";
import { isAdmin } from "../auth";
import { app, escapeHtml, formatText, ICONS, renderMath, setUrl, testLabelMarkup } from "../dom";
import { bindTreeDrawer, drawerToggleMarkup, mount, skeleton } from "../shell";
import type { Test } from "../types";
import { showEditor } from "./editor";
import { showSubjects } from "./subjects";

let shelves: Subject[] = [];
let shelf: ServerTestMeta[] = [];
let shelfId = "";
let shelfTitle = "Built-in tests";

/** Every chapter as a root node; the open one shows its questions beneath. */
function treeMarkup(activeTest?: string, test?: Test, activeQuestion = 0): string {
  const nodes = shelf
    .map((t) => {
      const active = t.id === activeTest;
      const rows =
        active && test
          ? `<div class="ed-tree-questions">${test.questions
              .map(
                (q, i) => `
                <div class="ed-tree-row">
                  <button class="ed-tree-q${i === activeQuestion ? " active" : ""}" data-i="${i}">
                    <span class="ed-tree-name">${i + 1}. ${escapeHtml(q.topic)}</span>
                    <span class="ed-tree-marks">${q.marks}</span>
                  </button>
                </div>`
              )
              .join("")}</div>`
          : "";
      return `
        <div class="ed-node${active ? " open" : ""}">
          <div class="ed-node-head${active ? " active" : ""}">
            <button class="ed-tree-test br-test" data-test="${escapeHtml(t.id)}">
              <span class="ed-tree-name">${testLabelMarkup(t.title, t.chapter)}</span>
              ${
                t.adopted
                  ? `<span class="status-chip status-done">Copied</span>`
                  : `<span class="status-chip status-new">${t.questionCount} Q</span>`
              }
            </button>
          </div>
          ${rows}
        </div>`;
    })
    .join("");

  return `
    <aside class="ed-tree" id="br-tree">
      <div class="ed-tree-head"><span class="ed-tree-title">${escapeHtml(shelfTitle)}</span></div>
      <div class="ed-tree-body">
        ${nodes || `<p class="ed-tree-empty hint">No tests here yet.</p>`}
      </div>
    </aside>`;
}

function bindTree(onQuestion?: (i: number) => void): void {
  document.getElementById("br-tree")?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const qrow = target.closest<HTMLElement>(".ed-tree-q[data-i]");
    if (qrow && onQuestion) {
      onQuestion(Number(qrow.dataset.i));
      return;
    }
    const node = target.closest<HTMLElement>(".br-test[data-test]");
    if (node) void openTest(node.dataset.test!);
  });
}

/**
 * One catalogue row. Everything that will one day vary between authors — the
 * byline, the price, whether you already hold it — is decided here and nowhere
 * else, so the marketplace shape lands in this function alone.
 */
function rowMarkup(t: ServerTestMeta): string {
  return `
    <div class="br-row" data-test="${escapeHtml(t.id)}">
      <button class="br-open" data-test="${escapeHtml(t.id)}">
        <span class="br-main">
          ${testLabelMarkup(t.title, t.chapter)}
          <span class="br-meta">${t.questionCount} question${t.questionCount === 1 ? "" : "s"} · ${t.totalMarks} marks</span>
          <span class="br-by"><span class="br-badge">VIDAI</span>${
            t.adopted ? `<span class="br-have">Already in your tests</span>` : ""
          }</span>
        </span>
      </button>
      <span class="br-actions">
        <span class="br-price">Free</span>
        <button class="btn btn-ghost br-preview" data-test="${escapeHtml(t.id)}">Preview</button>
        ${
          isAdmin()
            ? `<button class="btn btn-ghost br-edit" data-test="${escapeHtml(t.id)}">Edit</button>`
            : ""
        }
        <button class="btn btn-primary br-use" data-test="${escapeHtml(t.id)}">Use this test</button>
      </span>
    </div>`;
}

/** Take a copy and land in the editor on it — the copy is what they can change. */
async function useTest(id: string, btn: HTMLButtonElement): Promise<void> {
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = "…";
  // No subjectId: the server files the copy under the caller's own subject with
  // matching board/class/subject, creating one if they have none.
  const result = await adoptTest(id);
  if (!result.ok || !result.test) {
    alert(result.message || "Could not copy this test");
    btn.disabled = false;
    btn.textContent = was;
    return;
  }
  track("test_adopted", { test: id });
  await showEditor(result.test.id, null, () => void showShelf(shelfId, shelfTitle));
}

function bindRows(root: ParentNode): void {
  root.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const use = target.closest<HTMLButtonElement>(".br-use[data-test]");
    if (use) {
      void useTest(use.dataset.test!, use);
      return;
    }
    const edit = target.closest<HTMLElement>(".br-edit[data-test]");
    if (edit) {
      // readOnly() in the editor already lets an admin through and blocks
      // everyone else; canManageTest on the server is still the real gate.
      void showEditor(edit.dataset.test!, null, () => void showShelf(shelfId, shelfTitle));
      return;
    }
    const open = target.closest<HTMLElement>("[data-test]");
    if (open) void openTest(open.dataset.test!);
  });
}

/** Level 2: one shelf's tests, as catalogue rows. */
function renderShelf(): void {
  mount(
    `
    <div class="editor ed-readonly" data-pane="question">
      <div class="ed-cols overview">
        ${treeMarkup()}
        <div class="ed-center">
          <div class="ed-crumbrow">
            ${drawerToggleMarkup("Tests")}
            <button class="ed-crumb-link" id="br-back">Browse</button>
            <span class="ed-crumb-mid">
              <span class="ed-crumb-sep">›</span>
              <span class="ed-crumb-test">${escapeHtml(shelfTitle)}</span>
            </span>
          </div>
          <div class="ed-body">
            <section class="ed-panel">
              <div class="ed-panel-head">
                <span class="ed-panel-label">Tests you can use</span>
                <div class="ed-spacer"></div>
                <span class="chip">Built in</span>
              </div>
              <p class="hint">Read a test before you take it. <strong>Use this test</strong> puts
              your own copy in your subject as a draft — change anything you like in the copy;
              the built-in one never changes.</p>
              ${
                shelf.length
                  ? `<div class="br-list">${shelf.map(rowMarkup).join("")}</div>`
                  : `<p class="hint">Nothing has been published here yet.</p>`
              }
            </section>
          </div>
        </div>
      </div>
      <div class="ed-scrim"></div>
    </div>`,
    { title: shelfTitle, sub: "Built in", active: "browse", full: true }
  );
  bindTree();
  bindTreeDrawer(document.querySelector<HTMLElement>(".editor")!);
  document.getElementById("br-back")!.addEventListener("click", () => void showBrowse());
  bindRows(document.querySelector(".br-list") ?? document.createElement("div"));
}

/** Level 3: one test, one question at a time, with its worked solution beside it. */
function renderTest(test: Test, index: number): void {
  const q = test.questions[index];
  // Only the shelf is in the URL: a "test" param here would be caught by the
  // shared-link route on refresh and open the test player instead.
  setUrl({ browse: shelfId });

  mount(
    `
    <div class="editor ed-readonly" data-pane="question">
      <div class="ed-cols">
        ${treeMarkup(test.id, test, index)}
        <div class="ed-center">
          <div class="ed-crumbrow">
            ${drawerToggleMarkup("Tests")}
            <button class="ed-crumb-link" id="br-back">
              <span class="crumb-wide">${escapeHtml(shelfTitle)}</span>
              <span class="crumb-tight">‹ Back</span>
            </button>
            <span class="ed-crumb-mid">
              <span class="ed-crumb-sep">›</span>
              <span class="ed-crumb-test">${escapeHtml(test.title)}</span>
            </span>
            <span class="ed-spacer"></span>
            <button id="br-use" class="btn btn-primary br-use st-handin" data-test="${escapeHtml(test.id)}">Use this<span class="st-long"> test</span></button>
          </div>
          <div class="ed-body">
            <section class="ed-panel">
              <div class="ed-panel-head">
                <span class="ed-panel-label">Question ${index + 1} of ${test.questions.length}</span>
                <div class="ed-spacer"></div>
                <span class="ed-hint">${escapeHtml(q.topic)} · ${q.marks} mark${q.marks > 1 ? "s" : ""}</span>
                ${q.source ? `<span class="chip chip-source">${escapeHtml(q.source)}</span>` : ""}
              </div>
              <div class="question-text">${formatText(q.q)}</div>
              ${
                q.type === "mcq"
                  ? `<div class="lib-options">${(q.options ?? [])
                      .map(
                        (opt, i) => `
                        <div class="lib-option${i === q.answer ? " lib-correct" : ""}">
                          <span class="lib-letter">${String.fromCharCode(65 + i)}</span>
                          <span>${formatText(opt)}</span>
                          ${i === q.answer ? `<span class="status-chip status-done">Correct answer</span>` : ""}
                        </div>`
                      )
                      .join("")}</div>`
                  : q.type === "numeric"
                    ? `<p class="review-correct">Answer: <strong>${escapeHtml(String(q.answer ?? ""))}</strong>${
                        q.tolerance ? ` (±${q.tolerance})` : ""
                      }</p>`
                    : `<p class="hint">Long answer — the student photographs their working and you award the marks.</p>`
              }
              <div class="st-navrow">
                <button class="btn btn-ghost st-step" id="br-prev"${index === 0 ? " disabled" : ""}>‹ Previous</button>
                <span class="ed-hint st-count">${index + 1} of ${test.questions.length}</span>
                <span class="ed-spacer"></span>
                <button class="btn btn-ghost st-step" id="br-next"${index === test.questions.length - 1 ? " disabled" : ""}>Next ›</button>
              </div>
            </section>
          </div>
        </div>
        <aside class="ed-explain">
          <section class="ed-panel">
            <div class="ed-panel-head"><span class="ed-panel-label">Explanation</span></div>
            <div class="solution">${formatText(q.solution)}</div>
          </section>
        </aside>
      </div>
      <div class="ed-scrim"></div>
      <div class="ed-tabs">
        <button class="ed-tab active" data-pane="question">Question</button>
        <button class="ed-tab" data-pane="explain">Explanation</button>
      </div>
    </div>`,
    { title: test.title, sub: "Built in", active: "browse", full: true }
  );

  bindTree((i) => renderTest(test, i));
  bindTreeDrawer(document.querySelector<HTMLElement>(".editor")!);
  const use = document.getElementById("br-use") as HTMLButtonElement;
  use.addEventListener("click", () => void useTest(use.dataset.test!, use));
  document.getElementById("br-back")!.addEventListener("click", () => renderShelf());
  document.getElementById("br-prev")!.addEventListener("click", () => {
    if (index > 0) renderTest(test, index - 1);
  });
  document.getElementById("br-next")!.addEventListener("click", () => {
    if (index < test.questions.length - 1) renderTest(test, index + 1);
  });
  document.querySelector(".ed-tabs")!.addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-pane]");
    if (!tab) return;
    document.querySelector(".editor")!.setAttribute("data-pane", tab.dataset.pane!);
    document.querySelectorAll(".ed-tab").forEach((t) => t.classList.toggle("active", t === tab));
  });
  renderMath(app);
}

async function openTest(id: string): Promise<void> {
  const test = await fetchServerTest(id);
  if (!test) {
    alert("Could not open this test — refresh to retry.");
    return;
  }
  renderTest(test, 0);
}

/** Level 2 entry: open one shelf. */
export async function showShelf(subjectId: string, title?: string): Promise<void> {
  shelfId = subjectId;
  if (title) shelfTitle = title;
  setUrl({ browse: subjectId });
  track("browse_shelf", { subject: subjectId });
  mount(`<main class="subjects">${skeleton.cards(3)}</main>`, {
    title: shelfTitle,
    sub: "Built in",
    active: "browse",
  });
  shelf = (await fetchLibrary(subjectId)) ?? [];
  renderShelf();
}

/** Level 1: the shelves. */
export async function showBrowse(): Promise<void> {
  setUrl({ browse: "" });
  track("browse_open", {});
  mount(
    `<main class="subjects"><h1 class="page-title">Browse tests</h1>${skeleton.cards(2)}</main>`,
    { title: "Browse tests", active: "browse" }
  );
  shelves = ((await fetchSubjects()) ?? []).filter((s) => s.platform);
  mount(
    `
    <main class="subjects">
      <h1 class="page-title">Browse tests</h1>
      <p class="hint">Ready-made tests you can read in full and copy into one of your
      subjects. Your copy is yours to edit; the built-in one never changes.</p>
      ${
        shelves.length
          ? `<div class="subject-grid">${shelves
              .map(
                (s) => `
                <button class="subject-card subject-card-builtin" data-subject="${escapeHtml(s.id)}" data-title="${escapeHtml(s.title)}" data-platform="1">
                  <span class="subject-mark">${escapeHtml(initials(s))}</span>
                  <span class="subject-name">${escapeHtml(s.title)}</span>
                  <span class="subject-meta">
                    <span class="subject-count">${s.testCount ?? 0} test${(s.testCount ?? 0) === 1 ? "" : "s"}</span>
                    <span class="chip">Built in</span>
                  </span>
                </button>`
              )
              .join("")}</div>`
          : `<p class="hint">Nothing has been published to the library yet.</p>`
      }
      <p class="actions"><button class="btn btn-ghost" id="br-subjects">Back to your subjects</button></p>
    </main>`,
    { title: "Browse tests", active: "browse" }
  );
  document.getElementById("br-subjects")!.addEventListener("click", () => void showSubjects());
  document.querySelector(".subject-grid")?.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".subject-card[data-subject]");
    if (card) void showShelf(card.dataset.subject!, card.dataset.title || undefined);
  });
}

/** The same mark Your subjects uses: the subject's letter and the class. */
function initials(s: Subject): string {
  return `${(s.subject || "?").slice(0, 1)}${s.klass || ""}`.toUpperCase();
}
