// The built-in library shelf: a platform subject opened read-only, so a teacher
// can read a chapter test before deciding to take their own copy of it.
//
// Like src/screens/review.ts, this reuses the editor's LAYOUT only — the .ed-*
// classes under an .ed-readonly modifier. It must never reach into
// src/screens/editor/: those panels are all inputs, and editor/state.ts is one
// shared working copy that autosaves, so browsing through it would queue writes
// against a master no teacher is allowed to change.

import { track } from "../analytics";
import { adoptTest, fetchLibrary, fetchServerTest, type ServerTestMeta } from "../api";
import { app, escapeHtml, formatText, ICONS, renderMath, setUrl, testLabelMarkup } from "../dom";
import { bindTreeDrawer, drawerToggleMarkup, mount, skeleton } from "../shell";
import type { Test } from "../types";
import { showEditor } from "./editor";
import { showSubjects } from "./subjects";

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
            <button class="ed-tree-test lib-test" data-test="${escapeHtml(t.id)}">
              ${ICONS.folder}
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
    <aside class="ed-tree" id="lib-tree">
      <div class="ed-tree-head"><span class="ed-tree-title">${escapeHtml(shelfTitle)}</span></div>
      <div class="ed-tree-body">
        ${nodes || `<p class="ed-tree-empty hint">No chapters here yet.</p>`}
      </div>
    </aside>`;
}

function bindTree(onQuestion?: (i: number) => void): void {
  document.getElementById("lib-tree")?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const qrow = target.closest<HTMLElement>(".ed-tree-q[data-i]");
    if (qrow && onQuestion) {
      onQuestion(Number(qrow.dataset.i));
      return;
    }
    const node = target.closest<HTMLElement>(".lib-test[data-test]");
    if (node) void openChapter(node.dataset.test!);
  });
}

/** Take a copy and land in the editor on it — the copy is what they can change. */
async function useTest(id: string, btn: HTMLButtonElement): Promise<void> {
  btn.disabled = true;
  btn.textContent = "…";
  const result = await adoptTest(id);
  if (!result.ok || !result.test) {
    alert(result.message || "Could not copy this test");
    btn.disabled = false;
    btn.textContent = "Use this test";
    return;
  }
  track("test_adopted", { test: id });
  await showEditor(result.test.id, null, () => void showLibrary(shelfId, shelfTitle));
}

function useButton(meta: ServerTestMeta | undefined): string {
  if (!meta) return "";
  return `<button id="lib-use" class="btn btn-primary st-handin" data-id="${escapeHtml(meta.id)}">Use this<span class="st-long"> test</span></button>`;
}

function bindUse(): void {
  const btn = document.getElementById("lib-use") as HTMLButtonElement | null;
  btn?.addEventListener("click", () => void useTest(btn.dataset.id!, btn));
}

/** The shelf itself: the chapter list, and what to do with it. */
function renderOverview(): void {
  mount(
    `
    <div class="editor ed-readonly ed-student" data-pane="question">
      <div class="ed-cols overview">
        ${treeMarkup()}
        <div class="ed-center">
          <div class="ed-crumbrow">
            ${drawerToggleMarkup("Chapters")}
            <button class="ed-crumb-link" id="lib-back">Subjects</button>
            <span class="ed-crumb-mid">
              <span class="ed-crumb-sep">›</span>
              <span class="ed-crumb-test">${escapeHtml(shelfTitle)}</span>
            </span>
          </div>
          <div class="ed-body">
            <section class="ed-panel">
              <div class="ed-panel-head">
                <span class="ed-panel-label">Built-in chapters</span>
                <div class="ed-spacer"></div>
                <span class="chip">Built in</span>
              </div>
              <p class="hint">These are the Vidai library's chapter tests. Read one,
              then take your own copy — you can change anything in the copy before
              publishing it to your class. The library copy never changes.</p>
              ${
                shelf.length
                  ? `<div class="test-list">${shelf
                      .map(
                        (t) => `
                        <button class="test-card" data-test="${escapeHtml(t.id)}">
                          <div class="test-card-main">
                            <div class="test-card-title">${testLabelMarkup(t.title, t.chapter)}</div>
                            <div class="test-card-sub">${escapeHtml(t.chapter || "")} · ${t.questionCount} questions · ${t.totalMarks} marks</div>
                          </div>
                          <span class="status-chip status-${t.adopted ? "done" : "new"}">${t.adopted ? "In My tests" : "Not copied"}</span>
                        </button>`
                      )
                      .join("")}</div>`
                  : `<p class="hint">No chapters have been published to the library yet.</p>`
              }
            </section>
          </div>
        </div>
      </div>
      <div class="ed-scrim"></div>
    </div>`,
    { title: shelfTitle, sub: "Built in", active: "subjects", full: true }
  );
  bindTree();
  bindTreeDrawer(document.querySelector<HTMLElement>(".editor")!);
  document.getElementById("lib-back")!.addEventListener("click", () => void showSubjects());
  document.querySelector(".ed-center .test-list")?.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".test-card[data-test]");
    if (card) void openChapter(card.dataset.test!);
  });
}

/** One chapter, one question at a time, with its worked solution beside it. */
function renderChapter(test: Test, index: number): void {
  const meta = shelf.find((t) => t.id === test.id);
  const q = test.questions[index];
  // Only the shelf is in the URL: a "test" param here would be caught by the
  // shared-link route on refresh and open the test player instead.
  setUrl({ library: shelfId });

  mount(
    `
    <div class="editor ed-readonly" data-pane="question">
      <div class="ed-cols">
        ${treeMarkup(test.id, test, index)}
        <div class="ed-center">
          <div class="ed-crumbrow">
            ${drawerToggleMarkup("Chapters")}
            <button class="ed-crumb-link" id="lib-back">
              <span class="crumb-wide">${escapeHtml(shelfTitle)}</span>
              <span class="crumb-tight">‹ Back</span>
            </button>
            <span class="ed-crumb-mid">
              <span class="ed-crumb-sep">›</span>
              <span class="ed-crumb-test">${escapeHtml(test.title)}</span>
            </span>
            <span class="ed-spacer"></span>
            ${useButton(meta)}
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
                    ? `<p class="review-correct">Answer: <strong>${q.answer}</strong>${
                        q.tolerance ? ` (±${q.tolerance})` : ""
                      }</p>`
                    : `<p class="hint">Long answer — the student photographs their working and you award the marks.</p>`
              }
              <div class="st-navrow">
                <button class="btn btn-ghost st-step" id="lib-prev"${index === 0 ? " disabled" : ""}>‹ Previous</button>
                <span class="ed-hint st-count">${index + 1} of ${test.questions.length}</span>
                <span class="ed-spacer"></span>
                <button class="btn btn-ghost st-step" id="lib-next"${index === test.questions.length - 1 ? " disabled" : ""}>Next ›</button>
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
    { title: test.title, sub: "Built in", active: "subjects", full: true }
  );

  bindTree((i) => renderChapter(test, i));
  bindTreeDrawer(document.querySelector<HTMLElement>(".editor")!);
  bindUse();
  document.getElementById("lib-back")!.addEventListener("click", () => renderOverview());
  document.getElementById("lib-prev")!.addEventListener("click", () => {
    if (index > 0) renderChapter(test, index - 1);
  });
  document.getElementById("lib-next")!.addEventListener("click", () => {
    if (index < test.questions.length - 1) renderChapter(test, index + 1);
  });
  document.querySelector(".ed-tabs")!.addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-pane]");
    if (!tab) return;
    document.querySelector(".editor")!.setAttribute("data-pane", tab.dataset.pane!);
    document.querySelectorAll(".ed-tab").forEach((t) => t.classList.toggle("active", t === tab));
  });
  renderMath(app);
}

async function openChapter(id: string): Promise<void> {
  const test = await fetchServerTest(id);
  if (!test) {
    alert("Could not open this chapter — refresh to retry.");
    return;
  }
  renderChapter(test, 0);
}

/** Open a built-in subject: its chapters, read-only, each with Use this test. */
export async function showLibrary(subjectId: string, title?: string): Promise<void> {
  shelfId = subjectId;
  if (title) shelfTitle = title;
  setUrl({ library: subjectId });
  track("library_open", { subject: subjectId });
  mount(`<main class="subjects">${skeleton.cards(3)}</main>`, {
    title: shelfTitle,
    sub: "Built in",
    active: "subjects",
  });
  shelf = (await fetchLibrary(subjectId)) ?? [];
  renderOverview();
}
