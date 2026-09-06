// Authoring shell: tests tree, question editor and test overview in one screen.
// Desktop shows three columns; below 900px the editing surfaces become three
// bottom tabs and the tree opens as a drawer.

import { track } from "../../analytics";
import { fetchServerTest, fetchTestList, mutateTest, newQuestionId, setTestStatus, type TestProblem } from "../../api";
import { app, escapeHtml, ICONS, topbar } from "../../dom";
import type { Test } from "../../types";
import {
  currentSaveState,
  currentTest,
  edit,
  isComplete,
  loadTest,
  onSaveState,
  save,
  totalMarks,
} from "./state";
import { answerPanel, bindQuestionEditor, blankQuestion, explanationPanel, questionBody } from "./panels";
import { currentSubject } from "../home";

type Pane = "question" | "answer" | "explain";

let onExit: () => void = () => {};
let selectedIndex = -1; // -1 = the test overview
let pane: Pane = "question";
let siblings: { id: string; title: string; status: string; questionCount: number }[] = [];
const expanded = new Set<string>();
const treeQuestions = new Map<string, { id: string; topic: string; marks: number; complete: boolean }[]>();
let unsubscribe: (() => void) | null = null;
let problems: TestProblem[] = [];
let publishError = "";

/** Open the authoring screen on a test, optionally focused on one question. */
export async function showEditor(testId: string, questionId: string | null, back: () => void) {
  onExit = back;
  track("editor_open", { test: testId });
  app.innerHTML = `${topbar(true)}<main class="card"><p class="hint">Loading…</p></main>`;

  const [loaded, list] = await Promise.all([fetchServerTest(testId), fetchTestList()]);
  if (!loaded) {
    app.innerHTML = `${topbar(true)}<main class="card">
      <p class="login-error">Could not open that test.</p>
      <div class="actions"><button id="ed-back" class="btn btn-ghost">Back to my tests</button></div></main>`;
    document.getElementById("ed-back")!.addEventListener("click", back);
    return;
  }
  siblings = (list?.tests ?? [])
    .filter((t) => !t.platform)
    .map((t) => ({ id: t.id, title: t.title, status: t.status, questionCount: t.questionCount }));
  expanded.add(loaded.id);
  loadTest(loaded);
  problems = [];
  publishError = "";
  selectedIndex = questionId ? loaded.questions.findIndex((q) => q.id === questionId) : -1;
  pane = "question";

  unsubscribe?.();
  unsubscribe = onSaveState(renderSaveState);
  render();
}

function readOnly(): boolean {
  return currentTest()?.status !== "draft";
}

function syncUrl(): void {
  const test = currentTest();
  if (!test) return;
  const q = selectedIndex >= 0 ? `&q=${encodeURIComponent(test.questions[selectedIndex].id)}` : "";
  history.replaceState(null, "", `./?edit=${encodeURIComponent(test.id)}${q}`);
}

function render(): void {
  const test = currentTest();
  if (!test) return;
  syncUrl();

  const q = selectedIndex >= 0 ? test.questions[selectedIndex] : null;
  app.innerHTML = `
    <div class="editor" data-pane="${pane}">
      ${appBar(test)}
      <div class="ed-cols${selectedIndex < 0 ? " overview" : ""}">
        <aside class="ed-tree" id="ed-tree">${treeMarkup(test)}</aside>
        <div class="ed-center">
          <div class="ed-crumbrow">
            <button class="ed-crumb-link" id="ed-exit">My tests</button>
            <span class="ed-crumb-sep">/</span>
            <button class="ed-crumb-link ed-crumb-test" id="ed-crumb-overview">${escapeHtml(test.title || "Untitled test")}</button>
            ${selectedIndex >= 0 ? `<span class="ed-crumb-sep">/</span><span class="ed-crumb-current">Question ${selectedIndex + 1}</span>` : ""}
            <div class="ed-spacer"></div>
            <span class="ed-save" id="ed-save"></span>
          </div>
          <div class="ed-body" id="ed-body"></div>
        </div>
        ${q ? `<aside class="ed-explain" id="ed-explain">${explanationPanel(q)}</aside>` : ""}
      </div>
      ${selectedIndex >= 0 ? tabsMarkup() : ""}
    </div>`;

  renderBody();
  bindChrome();
  renderSaveState();
}

/** The editor's own app bar, as designed: identity, taxonomy, state, actions. */
function appBar(test: Test): string {
  const published = test.status === "published";
  return `
    <header class="ed-appbar">
      <button class="ed-icon-btn ed-tree-toggle" id="ed-tree-toggle" aria-label="Show tests and questions">
        ${ICONS.users}
      </button>
      <div class="ed-brand">
        <span class="brand-mark">V</span><span class="ed-brand-name">Vidaivi</span>
      </div>
      <div class="ed-taxonomy">
        <span class="ed-taxonomy-board">CBSE</span>
        <span class="ed-taxonomy-sub">Mathematics 12</span>
      </div>
      <div class="ed-spacer"></div>
      <span class="status-chip ${statusClass(test.status ?? "draft")}">${statusLabel(test)}</span>
      <button class="ed-bar-btn" id="ed-preview">
        <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
        <span class="ed-bar-btn-label">Preview</span>
      </button>
      ${
        published
          ? `<button class="ed-bar-btn primary" id="ed-unpublish-bar">Unpublish</button>`
          : `<button class="ed-bar-btn primary" id="ed-publish-bar">Publish test</button>`
      }
    </header>`;
}

function typeLabel(type: string): string {
  return type === "mcq" ? "Multiple choice" : type === "numeric" ? "Numeric" : "Long answer";
}

function countLabel(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

/** A plain-text gist for table rows: the raw $…$ and ** markers read as noise. */
function summarise(text: string): string {
  const plain = text.replace(/\$\$?/g, "").replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (!plain) return "Untitled question";
  return plain.length > 70 ? `${plain.slice(0, 70)}…` : plain;
}

function statusClass(status: string): string {
  if (status === "published") return "status-done";
  if (status === "archived") return "status-wrong";
  return "status-progress";
}

function statusLabel(test: Test): string {
  return test.status === "published" ? "Published" : test.status === "archived" ? "Archived" : "Draft";
}

/** Every test is a root node; its questions are the level beneath it. */
function treeMarkup(test: Test): string {
  const rows = siblings.some((s) => s.id === test.id)
    ? siblings
    : [...siblings, { id: test.id, title: test.title, status: test.status ?? "draft", questionCount: test.questions.length }];

  return `
    <div class="ed-tree-head">
      <span class="ed-tree-title">Tests &amp; questions</span>
    </div>
    <button class="ed-tree-add" id="ed-new-test">
      <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
      Create
    </button>
    <div class="ed-tree-body">
      ${rows.map((row) => testNode(row, test)).join("")}
    </div>`;
}

function testNode(
  row: { id: string; title: string; status: string; questionCount: number },
  test: Test
): string {
  const isCurrent = row.id === test.id;
  const open = expanded.has(row.id);
  const title = isCurrent ? test.title || "Untitled test" : row.title;
  const status = isCurrent ? test.status ?? "draft" : row.status;
  return `
    <div class="ed-node${open ? " open" : ""}" data-test="${escapeHtml(row.id)}">
      <div class="ed-node-head${isCurrent && selectedIndex < 0 ? " active" : ""}">
        <button class="ed-caret-btn" data-toggle="${escapeHtml(row.id)}" aria-label="${open ? "Collapse" : "Expand"} ${escapeHtml(title)}" aria-expanded="${open}">
          <svg class="ed-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
        <button class="ed-tree-test${isCurrent ? "" : " ed-tree-other"}"${isCurrent ? ' id="ed-open-overview"' : ` data-test="${escapeHtml(row.id)}"`}>
          <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
          <span class="ed-tree-name">${escapeHtml(title)}</span>
          <span class="status-chip ${statusClass(status)}">${status === "published" ? "Live" : status === "archived" ? "Archived" : "Draft"}</span>
        </button>
      </div>
      ${open ? `<div class="ed-tree-questions">${isCurrent ? currentQuestionRows(test) : otherQuestionRows(row)}</div>` : ""}
    </div>`;
}

function currentQuestionRows(test: Test): string {
  const insert = (at: number) =>
    readOnly()
      ? ""
      : `<div class="ed-insert" data-at="${at}">
           <span class="ed-insert-line"></span>
           <button class="ed-insert-btn" data-at="${at}" title="Insert a question here" aria-label="Insert a question here">
             <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
           </button>
         </div>`;
  if (!test.questions.length) {
    return `${insert(0)}<p class="ed-empty ed-tree-empty">No questions yet — use + to add one.</p>`;
  }
  return (
    insert(0) +
    test.questions
      .map(
        (q, i) => `
        <div class="ed-tree-row" data-i="${i}"${readOnly() ? "" : ' draggable="true"'}>
          <span class="ed-grip" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg>
          </span>
          <button class="ed-tree-q${i === selectedIndex ? " active" : ""}" data-i="${i}">
            <span class="ed-dot${isComplete(q) ? " done" : ""}"></span>
            <span class="ed-tree-name">${escapeHtml(q.topic || `Question ${i + 1}`)}</span>
            <span class="ed-tree-marks">${q.marks || 0} m</span>
          </button>
          ${
            readOnly()
              ? ""
              : `<button class="ed-row-menu" data-i="${i}" title="More" aria-label="More actions for this question">
                   <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8"/><circle cx="12" cy="12" r="1.8"/><circle cx="19" cy="12" r="1.8"/></svg>
                 </button>`
          }
        </div>
        ${insert(i + 1)}`
      )
      .join("")
  );
}

/** Another test's questions: navigation only until you switch to it. */
function otherQuestionRows(row: { id: string; questionCount: number }): string {
  const loaded = treeQuestions.get(row.id);
  if (!loaded) {
    return `<p class="ed-empty ed-tree-empty">Loading ${row.questionCount} question${row.questionCount === 1 ? "" : "s"}…</p>`;
  }
  if (!loaded.length) return `<p class="ed-empty ed-tree-empty">No questions yet.</p>`;
  return loaded
    .map(
      (q, i) => `
      <div class="ed-tree-row ed-tree-row-other">
        <button class="ed-tree-q ed-tree-q-other" data-test="${escapeHtml(row.id)}" data-qid="${escapeHtml(q.id)}">
          <span class="ed-dot${q.complete ? " done" : ""}"></span>
          <span class="ed-tree-name">${escapeHtml(q.topic || `Question ${i + 1}`)}</span>
          <span class="ed-tree-marks">${q.marks || 0} m</span>
        </button>
      </div>`
    )
    .join("");
}

function tabsMarkup(): string {
  const tab = (id: Pane, label: string) =>
    `<button class="ed-tab${pane === id ? " active" : ""}" data-pane="${id}">${label}</button>`;
  return `<nav class="ed-tabs">${tab("question", "Question")}${tab("answer", "Answer")}${tab("explain", "Explain")}</nav>`;
}

function renderBody(): void {
  const test = currentTest();
  const body = document.getElementById("ed-body");
  if (!test || !body) return;

  if (selectedIndex < 0) {
    body.innerHTML = overviewMarkup(test);
    bindOverview();
    return;
  }
  const q = test.questions[selectedIndex];
  if (!q) {
    selectedIndex = -1;
    renderBody();
    return;
  }
  body.innerHTML = `
    ${readOnly() ? readOnlyBanner() : ""}
    <div class="ed-pane ed-pane-question">${questionBody(q)}</div>
    <div class="ed-pane ed-pane-answer">${answerPanel(q)}</div>`;

  // Bind first even when read-only: binding is what paints the previews, and a
  // published test with empty preview boxes looks broken.
  const editorRoot = document.querySelector<HTMLElement>(".editor") ?? body;
  bindQuestionEditor(editorRoot, selectedIndex, renderBody, refreshTree);
  if (readOnly()) {
    editorRoot.querySelectorAll<HTMLElement>("input, textarea, select, .ed-panel button").forEach((el) => {
      (el as HTMLInputElement).disabled = true;
    });
    document.getElementById("ed-unpublish")?.addEventListener("click", unpublish);
    return;
  }

  const topicEl = body.querySelector<HTMLInputElement>("#ed-topic");
  topicEl?.addEventListener("input", () => {
    edit(() => {
      q.topic = topicEl.value;
    });
    refreshTree();
  });
}

function readOnlyBanner(): string {
  return `
    <div class="ed-banner">
      <span>This test is published, so students are reading it right now. Move it back to a draft to make changes.</span>
      <button class="btn btn-ghost" id="ed-unpublish">Unpublish to edit</button>
    </div>`;
}

function overviewMarkup(test: Test): string {
  const problemFor = (id: string) => problems.filter((p) => p.questionId === id);
  return `
    <div class="ed-overview">
      <section class="ed-panel">
        <div class="ed-panel-head"><span class="ed-panel-label">Test details</span></div>
        <div class="ed-grid">
          <label class="ed-field">
            <span class="ed-panel-label">Title</span>
            <input class="ed-input" id="ov-title" type="text" maxlength="120" value="${escapeHtml(test.title)}" />
          </label>
          <label class="ed-field">
            <span class="ed-panel-label">Chapter</span>
            <input class="ed-input" id="ov-chapter" type="text" maxlength="60" value="${escapeHtml(test.chapter || "")}" />
          </label>
          <label class="ed-field">
            <span class="ed-panel-label">Curated by</span>
            <input class="ed-input" id="ov-teacher" type="text" maxlength="60" value="${escapeHtml(test.teacher || "")}" />
          </label>
          <label class="ed-field">
            <span class="ed-panel-label">Who can attempt it</span>
            <select class="ed-input" id="ov-access">
              <option value="login"${test.access !== "open" ? " selected" : ""}>Signed-in students only</option>
              <option value="open"${test.access === "open" ? " selected" : ""}>Anyone with the link</option>
            </select>
          </label>
        </div>
      </section>

      <section class="ed-panel">
        <div class="ed-panel-head">
          <span class="ed-panel-label">Questions</span>
          <div class="ed-spacer"></div>
          <span class="ed-hint">${countLabel(test.questions.length, "question")} · ${countLabel(totalMarks(test), "mark")}</span>
        </div>
        <div class="table-wrap">
          <table class="data-table">
            <thead><tr><th></th><th>Question</th><th>Type</th><th>Topic</th><th>Marks</th></tr></thead>
            <tbody>
              ${test.questions
                .map((q, i) => {
                  const issues = problemFor(q.id);
                  return `<tr class="ov-row" data-i="${i}">
                    <td class="cell-mono">${i + 1}</td>
                    <td class="cell-strong">${escapeHtml(summarise(q.q))}${
                      issues.length ? `<div class="ov-problem">${escapeHtml(issues.map((p) => p.reason).join(" · "))}</div>` : ""
                    }</td>
                    <td>${typeLabel(q.type)}</td>
                    <td>${escapeHtml(q.topic || "—")}</td>
                    <td class="cell-mono">${q.marks || 0}</td>
                  </tr>`;
                })
                .join("")}
            </tbody>
          </table>
        </div>
        ${test.questions.length === 0 ? `<p class="ed-empty">No questions yet — add the first from the tree.</p>` : ""}
      </section>

      <section class="ed-panel">
        <div class="ed-panel-head"><span class="ed-panel-label">Publishing</span></div>
        <p id="ov-publish-error" class="login-error"${publishError ? "" : " hidden"}>${escapeHtml(publishError)}</p>
        <div class="actions">
          ${
            test.status === "draft"
              ? `<button class="btn btn-primary" id="ov-publish">Publish to students</button>`
              : `<button class="btn btn-ghost" id="ed-unpublish">Move back to draft</button>`
          }
          <button class="btn btn-ghost" id="ov-preview">Preview as student</button>
        </div>
      </section>
    </div>`;
}

function bindOverview(): void {
  const test = currentTest();
  if (!test) return;
  const bind = (id: string, apply: (value: string) => void) => {
    const el = document.getElementById(id) as HTMLInputElement | HTMLSelectElement | null;
    el?.addEventListener("input", () => {
      edit(() => apply(el.value));
      refreshTree();
    });
    el?.addEventListener("change", () => {
      edit(() => apply(el.value));
      refreshTree();
    });
    if (el && readOnly()) (el as HTMLInputElement).disabled = true;
  };
  bind("ov-title", (v) => (test.title = v));
  bind("ov-chapter", (v) => (test.chapter = v));
  bind("ov-teacher", (v) => (test.teacher = v));
  bind("ov-access", (v) => (test.access = v === "open" ? "open" : "login"));

  document.querySelectorAll<HTMLElement>(".ov-row").forEach((row) =>
    row.addEventListener("click", () => {
      selectedIndex = Number(row.dataset.i);
      pane = "question";
      render();
    })
  );
  document.getElementById("ov-preview")?.addEventListener("click", () => {
    window.open(`./?test=${encodeURIComponent(test.id)}`, "_blank");
  });
  document.getElementById("ov-publish")?.addEventListener("click", publish);
  document.getElementById("ed-unpublish")?.addEventListener("click", unpublish);
}

async function publish(): Promise<void> {
  const test = currentTest();
  const btn = document.getElementById("ov-publish") as HTMLButtonElement | null;
  if (!test || !btn) return;
  btn.disabled = true;
  btn.textContent = "Publishing…";
  await save(); // publish validates what is stored, so flush pending edits first
  const result = await setTestStatus(test.id, "publish");
  btn.disabled = false;
  btn.textContent = "Publish to students";
  if (!result.ok) {
    // Held in state: renderBody() rebuilds the overview, so a message written
    // straight into the DOM would be wiped by the very next render.
    problems = result.problems ?? [];
    publishError = result.message || "Could not publish.";
    renderBody();
    return;
  }
  problems = [];
  publishError = "";
  track("test_published", { test: test.id });
  test.status = "published";
  render();
}

async function unpublish(): Promise<void> {
  const test = currentTest();
  if (!test) return;
  const result = await setTestStatus(test.id, "unpublish");
  if (!result.ok) return;
  test.status = "draft";
  render();
}

function refreshTree(): void {
  const test = currentTest();
  const tree = document.getElementById("ed-tree");
  if (!test || !tree) return;
  tree.innerHTML = treeMarkup(test);
  bindTree();
}

/** Pull another test's questions in so the tree can show them beneath it. */
async function loadTreeQuestions(testId: string): Promise<void> {
  const loaded = await fetchServerTest(testId);
  treeQuestions.set(
    testId,
    (loaded?.questions ?? []).map((q) => ({
      id: q.id,
      topic: q.topic,
      marks: q.marks,
      complete: isComplete(q),
    }))
  );
  if (expanded.has(testId)) refreshTree();
}

function insertQuestion(at: number): void {
  const test = currentTest();
  if (!test || readOnly()) return;
  edit(() => test.questions.splice(at, 0, blankQuestion(test.chapter || "", test.title)));
  selectedIndex = at;
  pane = "question";
  render();
}

function closeRowMenus(): void {
  document.querySelectorAll(".ed-row-actions").forEach((m) => m.remove());
}

function openRowMenu(anchor: HTMLElement, index: number): void {
  closeRowMenus();
  const test = currentTest();
  if (!test) return;
  const menu = document.createElement("div");
  menu.className = "ed-row-actions";
  menu.innerHTML = `
    <button data-act="duplicate">Duplicate</button>
    <button data-act="up"${index === 0 ? " disabled" : ""}>Move up</button>
    <button data-act="down"${index === test.questions.length - 1 ? " disabled" : ""}>Move down</button>
    <button data-act="delete" class="danger">Delete</button>`;
  anchor.parentElement?.appendChild(menu);

  menu.querySelectorAll<HTMLButtonElement>("button").forEach((btn) =>
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const act = btn.dataset.act;
      if (act === "duplicate") {
        const copy = { ...test.questions[index], id: newQuestionId(test.title) };
        edit(() => test.questions.splice(index + 1, 0, copy));
        selectedIndex = index + 1;
      } else if (act === "up" || act === "down") {
        const to = act === "up" ? index - 1 : index + 1;
        if (to < 0 || to >= test.questions.length) return;
        edit(() => {
          const [moved] = test.questions.splice(index, 1);
          test.questions.splice(to, 0, moved);
        });
        selectedIndex = to;
      } else if (act === "delete") {
        edit(() => test.questions.splice(index, 1));
        if (selectedIndex >= test.questions.length) selectedIndex = test.questions.length - 1;
      }
      closeRowMenus();
      render();
    })
  );
}

function bindTree(): void {
  document.getElementById("ed-open-overview")?.addEventListener("click", () => {
    selectedIndex = -1;
    render();
  });
  document.querySelectorAll<HTMLElement>(".ed-tree-q").forEach((el) =>
    el.addEventListener("click", () => {
      selectedIndex = Number(el.dataset.i);
      pane = "question";
      render();
    })
  );
  document.querySelectorAll<HTMLElement>(".ed-tree-other").forEach((el) =>
    el.addEventListener("click", () => {
      void save().then(() => showEditor(el.dataset.test!, null, onExit));
    })
  );
  document.querySelectorAll<HTMLElement>(".ed-caret-btn").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = el.dataset.toggle!;
      if (expanded.has(id)) expanded.delete(id);
      else {
        expanded.add(id);
        if (id !== currentTest()?.id && !treeQuestions.has(id)) void loadTreeQuestions(id);
      }
      refreshTree();
    })
  );
  document.querySelectorAll<HTMLElement>(".ed-tree-q-other").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      void save().then(() => showEditor(el.dataset.test!, el.dataset.qid ?? null, onExit));
    })
  );
  document.getElementById("ed-new-test")?.addEventListener("click", () => {
    void save().then(() => createTestAndEdit(onExit));
  });
  document.querySelectorAll<HTMLElement>(".ed-insert-btn").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      insertQuestion(Number(el.dataset.at));
    })
  );
  document.querySelectorAll<HTMLElement>(".ed-row-menu").forEach((el) =>
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const already = el.parentElement?.querySelector(".ed-row-actions");
      if (already) return closeRowMenus();
      openRowMenu(el, Number(el.dataset.i));
    })
  );
  document.addEventListener("click", closeRowMenus, { once: true });

  // Drag to reorder.
  let dragFrom = -1;
  document.querySelectorAll<HTMLElement>(".ed-tree-row").forEach((row) => {
    row.addEventListener("dragstart", (e) => {
      dragFrom = Number(row.dataset.i);
      row.classList.add("dragging");
      (e as DragEvent).dataTransfer?.setData("text/plain", String(dragFrom));
    });
    row.addEventListener("dragend", () => {
      row.classList.remove("dragging");
      document.querySelectorAll(".ed-drop").forEach((d) => d.classList.remove("ed-drop"));
    });
    row.addEventListener("dragover", (e) => {
      e.preventDefault();
      row.classList.add("ed-drop");
    });
    row.addEventListener("dragleave", () => row.classList.remove("ed-drop"));
    row.addEventListener("drop", (e) => {
      e.preventDefault();
      row.classList.remove("ed-drop");
      const test = currentTest();
      const to = Number(row.dataset.i);
      if (!test || dragFrom < 0 || dragFrom === to) return;
      edit(() => {
        const [moved] = test.questions.splice(dragFrom, 1);
        test.questions.splice(to, 0, moved);
      });
      selectedIndex = to;
      render();
    });
  });
}

function bindChrome(): void {
  bindTree();
  document.getElementById("ed-exit")?.addEventListener("click", () => {
    void save().then(onExit);
  });
  document.getElementById("ed-crumb-overview")?.addEventListener("click", () => {
    selectedIndex = -1;
    render();
  });
  document.getElementById("ed-preview")?.addEventListener("click", () => {
    const test = currentTest();
    if (test) window.open(`./?test=${encodeURIComponent(test.id)}`, "_blank");
  });
  document.getElementById("ed-publish-bar")?.addEventListener("click", () => {
    selectedIndex = -1;
    render();
    void publish();
  });
  document.getElementById("ed-unpublish-bar")?.addEventListener("click", unpublish);
  document.getElementById("ed-tree-toggle")?.addEventListener("click", () => {
    document.querySelector(".editor")?.classList.toggle("tree-open");
  });
  document.querySelectorAll<HTMLElement>(".ed-tab").forEach((el) =>
    el.addEventListener("click", () => {
      pane = el.dataset.pane as Pane;
      document.querySelectorAll(".ed-tab").forEach((t) => t.classList.remove("active"));
      el.classList.add("active");
      const editor = document.querySelector<HTMLElement>(".editor");
      if (editor) editor.dataset.pane = pane;
    })
  );
}

function renderSaveState(): void {
  const el = document.getElementById("ed-save");
  if (!el) return;
  const state = currentSaveState();
  const text: Record<string, string> = {
    clean: "",
    dirty: "Unsaved",
    saving: "Saving…",
    saved: "Saved",
    error: "Save failed — retry",
  };
  el.textContent = text[state] ?? "";
  el.className = `ed-save ed-save-${state}`;
  if (state === "error") {
    el.onclick = () => void save();
  } else {
    el.onclick = null;
  }
}

/** Create an empty draft and open it. */
export async function createTestAndEdit(back: () => void): Promise<void> {
  const result = await mutateTest("create", {
    title: "Untitled test",
    chapter: "",
    teacher: "",
    access: "login",
    questions: [],
    subjectId: currentSubject() ?? undefined,
  } as never);
  if (!result.ok) {
    alert(result.message);
    return;
  }
  await showEditor(result.test.id, null, back);
}
