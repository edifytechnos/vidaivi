// Authoring shell: tests tree, question editor and test overview in one screen.
// Desktop shows three columns; below 900px the editing surfaces become three
// bottom tabs and the tree opens as a drawer.

import { track } from "../../analytics";
import { fetchServerTest, fetchTestList, mutateTest, setTestStatus, type TestProblem } from "../../api";
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

type Pane = "question" | "answer" | "explain";

let onExit: () => void = () => {};
let selectedIndex = -1; // -1 = the test overview
let pane: Pane = "question";
let siblings: { id: string; title: string; status: string }[] = [];
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
    .map((t) => ({ id: t.id, title: t.title, status: t.status }));
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

  app.innerHTML = `
    ${topbar(true)}
    <div class="editor">
      <aside class="ed-tree" id="ed-tree">${treeMarkup(test)}</aside>
      <div class="ed-main">
        <header class="ed-header">
          <button class="ed-icon-btn ed-tree-toggle" id="ed-tree-toggle" aria-label="Show tests">
            ${ICONS.users}
          </button>
          <div class="ed-crumbs">
            <span class="ed-crumb-test">${escapeHtml(test.title || "Untitled test")}</span>
            ${selectedIndex >= 0 ? `<span class="ed-crumb-sep">/</span><span>Question ${selectedIndex + 1}</span>` : ""}
          </div>
          <div class="ed-spacer"></div>
          <span class="ed-save" id="ed-save"></span>
          <span class="status-chip ${statusClass(test.status ?? "draft")}">${statusLabel(test)}</span>
          <button class="btn btn-ghost ed-exit" id="ed-exit">
            <span class="ed-exit-full">My tests</span><span class="ed-exit-short">Back</span>
          </button>
        </header>
        <div class="ed-body" id="ed-body"></div>
        ${selectedIndex >= 0 ? tabsMarkup() : ""}
      </div>
    </div>`;

  renderBody();
  bindChrome();
  renderSaveState();
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

function treeMarkup(test: Test): string {
  const others = siblings.filter((s) => s.id !== test.id);
  return `
    <div class="ed-tree-head">
      <span class="ed-tree-title">Tests &amp; questions</span>
      <button class="btn-link" id="ed-new-question"${readOnly() ? " disabled" : ""}>Add question</button>
    </div>
    <button class="ed-tree-test${selectedIndex < 0 ? " active" : ""}" id="ed-open-overview">
      <span class="ed-tree-caret">${ICONS.home}</span>
      <span class="ed-tree-name">${escapeHtml(test.title || "Untitled test")}</span>
      <span class="status-chip ${statusClass(test.status ?? "draft")}">${statusLabel(test)}</span>
    </button>
    <div class="ed-tree-questions">
      ${test.questions
        .map(
          (q, i) => `
        <button class="ed-tree-q${i === selectedIndex ? " active" : ""}" data-i="${i}">
          <span class="ed-dot${isComplete(q) ? " done" : ""}"></span>
          <span class="ed-tree-name">${escapeHtml(q.topic || `Question ${i + 1}`)}</span>
          <span class="ed-tree-marks">${q.marks || 0} m</span>
        </button>`
        )
        .join("")}
      ${test.questions.length === 0 ? `<p class="ed-empty ed-tree-empty">No questions yet.</p>` : ""}
    </div>
    ${
      others.length
        ? `<div class="ed-tree-others">
             <span class="ed-tree-title">Your other tests</span>
             ${others
               .map(
                 (s) => `<button class="ed-tree-test ed-tree-other" data-test="${escapeHtml(s.id)}">
                   <span class="ed-tree-name">${escapeHtml(s.title)}</span>
                 </button>`
               )
               .join("")}
           </div>`
        : ""
    }`;
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
    <div class="ed-panes" data-pane="${pane}">
      <div class="ed-pane" data-pane="question">
        ${questionBody(q)}
        ${topicRow(q.topic)}
      </div>
      <div class="ed-pane" data-pane="answer">${answerPanel(q)}</div>
      <div class="ed-pane" data-pane="explain">${explanationPanel(q)}</div>
    </div>`;

  // Bind first even when read-only: binding is what paints the previews, and a
  // published test with empty preview boxes looks broken.
  bindQuestionEditor(body, selectedIndex, renderBody, refreshTree);
  if (readOnly()) {
    body.querySelectorAll<HTMLElement>("input, textarea, select, .ed-panel button").forEach((el) => {
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

function topicRow(topic: string): string {
  return `
    <label class="ed-field ed-topic">
      <span class="ed-panel-label">Topic</span>
      <input class="ed-input" id="ed-topic" type="text" maxlength="60"
             placeholder="e.g. Inverse of a matrix" value="${escapeHtml(topic)}" />
    </label>`;
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
  document.getElementById("ed-new-question")?.addEventListener("click", () => {
    const test = currentTest();
    if (!test) return;
    edit(() => test.questions.push(blankQuestion(test.chapter || "", test.title)));
    selectedIndex = test.questions.length - 1;
    pane = "question";
    render();
  });
}

function bindChrome(): void {
  bindTree();
  document.getElementById("ed-exit")?.addEventListener("click", () => {
    void save().then(onExit);
  });
  document.getElementById("ed-tree-toggle")?.addEventListener("click", () => {
    document.querySelector(".editor")?.classList.toggle("tree-open");
  });
  document.querySelectorAll<HTMLElement>(".ed-tab").forEach((el) =>
    el.addEventListener("click", () => {
      pane = el.dataset.pane as Pane;
      document.querySelectorAll(".ed-tab").forEach((t) => t.classList.remove("active"));
      el.classList.add("active");
      const panes = document.querySelector<HTMLElement>(".ed-panes");
      if (panes) panes.dataset.pane = pane;
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
  });
  if (!result.ok) {
    alert(result.message);
    return;
  }
  await showEditor(result.test.id, null, back);
}
