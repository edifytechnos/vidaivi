// Authoring shell: tests tree, question editor and test overview in one screen.
// Desktop shows three columns; below 900px the editing surfaces become three
// bottom tabs and the tree opens as a drawer.

import { track } from "../../analytics";
import {
  adoptTests,
  fetchLibrary,
  fetchServerTest,
  fetchSubjects,
  fetchTestList,
  mutateTest,
  newQuestionId,
  setTestStatus,
  type TestProblem,
} from "../../api";
import { isAdmin } from "../../auth";
import { ICONS, escapeHtml, setUrl, testLabelMarkup } from "../../dom";
import { mount, setShellbar, skeleton } from "../../shell";
import { openModal } from "../../modal";
import { openAssign } from "../assign";
import type { Test } from "../../types";
import {
  clearTest,
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
import { currentSubject, setSubject } from "../home";
import { showBuilder } from "../builder";

type Pane = "question" | "answer" | "explain";

let onExit: () => void = () => {};
let selectedIndex = -1; // -1 = the test overview
let pane: Pane = "question";
let siblings: { id: string; title: string; chapter: string; status: string; questionCount: number }[] = [];
/** The teacher's own subjects, for the app bar picker. Fetched once per open. */
let ownSubjects: { id: string; title: string; platform: boolean }[] = [];
/**
 * Every built-in shelf's id, from the *full* subject list. `ownSubjects` holds
 * only the teacher's own subjects, so shelf-ness cannot be read from it — and
 * a shelf that looked like an ordinary subject would be editable.
 */
let shelfIds = new Set<string>();
const expanded = new Set<string>();
const treeQuestions = new Map<string, { id: string; topic: string; marks: number; complete: boolean }[]>();
let treeSubject: string | null = null;
let unsubscribe: (() => void) | null = null;
let problems: TestProblem[] = [];
let publishError = "";

/** Open the authoring screen on a test, optionally focused on one question. */
export async function showEditor(testId: string, questionId: string | null, back: () => void) {
  onExit = back;
  treeSubject = currentSubject();
  track("editor_open", { test: testId });
  // The shell and the editor's shape paint at once; the document fills it in.
  mount(skeleton.editor({ add: true }), { title: "Loading…", active: "subjects", full: true });

  // The tree shows the subject you came in through, not every test you own.
  const [loaded, list, subjectList] = await Promise.all([
    fetchServerTest(testId),
    fetchTestList(treeSubject ?? undefined),
    fetchSubjects(),
  ]);
  if (!loaded) {
    mount(
      `<main class="card">
      <p class="login-error">Could not open that test.</p>
      <div class="actions"><button id="ed-back" class="btn btn-ghost">Back to subjects</button></div></main>`,
      { title: "Test", active: "subjects", width: "narrow" }
    );
    document.getElementById("ed-back")!.addEventListener("click", back);
    return;
  }
  // Built-in shelves are offered here alongside a teacher's own subjects. They
  // open read-only unless you are an admin — see readOnly(). This must be set
  // BEFORE viewingShelf() is asked anything, since that is what it reads.
  shelfIds = new Set((subjectList ?? []).filter((x) => x.platform).map((x) => x.id));
  shelfTitles = new Map((subjectList ?? []).filter((x) => x.platform).map((x) => [x.id, x.title]));
  // The picker lists what you own. Built-in shelves are read from Browse and
  // picked when creating a subject or a test; they do not crowd this control.
  ownSubjects = (subjectList ?? [])
    .filter((x) => !x.platform)
    .map((x) => ({ id: x.id, title: x.title, platform: !!x.platform }));
  // A shelf's tree holds its masters; an ordinary subject's holds the teacher's
  // own tests. Never both, or a teacher's tree fills up with library copies.
  const shelf = viewingShelf();
  siblings = (list?.tests ?? [])
    .filter((t) => (shelf ? !!t.platform : !t.platform))
    .map((t) => ({
      id: t.id,
      title: t.title,
      chapter: t.chapter || "",
      status: t.status,
      questionCount: t.questionCount,
    }));
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

/**
 * Open the authoring shell on a subject: its first test, or — when the subject
 * holds none — the same shell with an empty tree. A subject always opens the
 * same screen, whether or not there is anything in it yet.
 */
export async function showEditorForSubject(
  subjectId: string | null,
  back: () => void
): Promise<void> {
  onExit = back;
  treeSubject = subjectId;
  takeCopiedNote();
  track("editor_subject_open", { subject: subjectId ?? "" });
  mount(skeleton.editor({ add: true }), { title: "Loading…", active: "subjects", full: true });

  const list = await fetchTestList(subjectId ?? undefined);
  // Scoped to one subject, the tests returned all belong to it, so platform-ness
  // follows the subject. With no subject, keep library masters out.
  const mine = subjectId
    ? (list?.tests ?? [])
    : (list?.tests ?? []).filter((t) => !t.platform);
  if (!mine.length) {
    siblings = [];
    clearTest();
    unsubscribe?.();
    unsubscribe = null;
    renderEmptyShell();
    return;
  }
  // A draft is the one you can actually edit, so prefer it over a published one.
  const first = mine.find((t) => t.status === "draft") ?? mine[0];
  await showEditor(first.id, null, back);
}

/**
 * The shell with no test in it. A separate renderer rather than making the
 * whole shell tolerate a null test: render, appBar, the crumb row, treeMarkup,
 * renderBody, bindOverview and bindTree all read the document.
 */
function renderEmptyShell(): void {
  setUrl();
  mount(
    `
    <div class="editor" data-pane="question">
      <div class="ed-cols overview">
        <aside class="ed-tree" id="ed-tree">
          <div class="ed-tree-head">
            <span class="ed-tree-title">Tests &amp; questions</span>
            ${canAddHere() ? `<button class="ed-tree-add" id="ed-new-test" title="Add a test" aria-label="Add a test">${ICONS.plus}</button>` : ""}
          </div>
          <p class="ed-empty ed-tree-empty">No tests yet.</p>
        </aside>
        <div class="ed-center">
          <div class="ed-crumbrow">
            <button class="ed-crumb-link" id="ed-exit">All subjects</button>
          </div>
          <div class="ed-body">
            <section class="ed-panel">
              <div class="ed-panel-head"><span class="ed-panel-label">No tests in this subject yet</span></div>
              <p class="ed-hint">Create your first test and its questions appear here, beneath it in the tree.</p>
              <div class="actions"><button class="btn btn-primary" id="ed-empty-create">Create the first test</button></div>
            </section>
          </div>
        </div>
      </div>
    </div>`,
    { title: "New subject", sub: "No tests yet", active: "subjects", full: true }
  );

  const create = () => void newTestHere(onExit);
  document.getElementById("ed-new-test")?.addEventListener("click", create);
  document.getElementById("ed-empty-create")?.addEventListener("click", create);
  document.getElementById("ed-exit")!.addEventListener("click", () => onExit());
}

/** Only an admin may add to the built-in library. */
function canAddHere(): boolean {
  return !viewingShelf() || isAdmin();
}

/**
 * A one-off greeting after a subject is created from the library: the copies
 * are drafts, students see nothing yet, and + adds more. Written by
 * src/screens/subjects.ts, read and cleared here so it shows exactly once —
 * "where did my test go?" is the confusion it exists to answer.
 */
const COPIED_KEY = "vidai:justCopied";
let copiedNote = 0;

function takeCopiedNote(): void {
  try {
    const raw = localStorage.getItem(COPIED_KEY);
    if (raw) {
      copiedNote = Number(raw) || 0;
      localStorage.removeItem(COPIED_KEY);
    }
  } catch {}
}

function copiedBanner(): string {
  if (copiedNote < 1) return "";
  const n = copiedNote;
  return `
    <div class="ed-welcome" id="ed-welcome">
      <span class="ed-welcome-mark">${ICONS.check}</span>
      <span class="ed-welcome-body">
        <strong>${n} test${n === 1 ? "" : "s"} copied into this subject</strong>
        <span>They are <strong>yours now, as drafts</strong> — change any question you like.
        Students see nothing until you press <strong>Publish</strong>. Need another paper?
        Use <strong>+</strong> to add one, blank or from the built-in set.</span>
      </span>
      <button class="btn btn-ghost ed-welcome-x" id="ed-welcome-x">Got it</button>
    </div>`;
}

/** Is the subject in the tree a built-in shelf rather than one of your own? */
function viewingShelf(): boolean {
  return shelfIds.has(treeSubject ?? "");
}

/**
 * Nothing here may be edited unless it is a draft — and a library master may
 * only ever be edited by an admin.
 *
 * The platform clause is the one that matters: `editor/state.ts` autosaves ~1s
 * after a keystroke, so a teacher who could type into a master would queue
 * writes the server then rejects with 403. The server's `canManageTest` is the
 * real gate; this keeps the client from ever asking.
 */
function readOnly(): boolean {
  const test = currentTest();
  if (!test) return true;
  if (test.platform && !isAdmin()) return true;
  return test.status !== "draft";
}

function syncUrl(): void {
  const test = currentTest();
  if (!test) return;
  const params: Record<string, string> = { edit: test.id };
  if (selectedIndex >= 0) params.q = test.questions[selectedIndex].id;
  setUrl(params);
}

function render(): void {
  const test = currentTest();
  if (!test) return;
  syncUrl();

  const q = selectedIndex >= 0 ? test.questions[selectedIndex] : null;
  mount(
    `
    <div class="editor" data-pane="${pane}">
      <div class="ed-cols${selectedIndex < 0 ? " overview" : ""}">
        <aside class="ed-tree" id="ed-tree">${treeMarkup(test)}</aside>
        <div class="ed-center">
          <div class="ed-crumbrow">
            <button class="ed-crumb-link" id="ed-exit">All subjects</button>
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
    </div>`,
    {
      title: test.title || "Untitled test",
      sub: audienceNote(test),
      active: "subjects",
      full: true,
      lead: subjectLead(),
      actions: editorActions(test),
    }
  );

  renderBody();
  bindChrome();
  renderSaveState();
}

/**
 * The subject this teacher is working in, as a picker. Switching reloads the
 * tree through the same path Your subjects uses, so there is one way in.
 * Only their own subjects: a built-in shelf is read-only and opens elsewhere.
 */
function subjectLead(): string {
  const here = treeSubject ?? "";
  // An admin arriving from Browse is *in* a shelf, which is not one of their
  // own subjects. Carry it as a transient entry so the control never lies
  // about where you are.
  const list = viewingShelf()
    ? [{ id: here, title: shelfTitle(here), platform: true }, ...ownSubjects]
    : ownSubjects;
  if (list.length < 1) return "";
  const options = list
    .map(
      (x) =>
        `<option value="${escapeHtml(x.id)}"${x.id === here ? " selected" : ""}>${escapeHtml(
          x.platform ? `${x.title} (built in)` : x.title
        )}</option>`
    )
    .join("");
  return `<select class="shellbar-select" id="ed-subject" aria-label="Subject">${options}</select>`;
}

/** The open shelf's name, for the transient picker entry. */
let shelfTitles = new Map<string, string>();
function shelfTitle(id: string): string {
  return shelfTitles.get(id) || "Built-in subject";
}

/** The editor's controls sit in the shell's top bar, not in a bar of their own. */
function editorActions(test: Test): string {
  // Identity and state only. Every *action* lives in the pane's toolbar, so a
  // teacher is not choosing between two buttons that do the same thing.
  return `
      <button class="ed-icon-btn ed-tree-toggle" id="ed-tree-toggle" aria-label="Show tests and questions">${ICONS.menu}</button>
      <span class="status-chip ${statusClass(test.status ?? "draft")}" title="${escapeHtml(audienceNote(test))}">${statusLabel(test)}</span>`;
}

/**
 * The one row of actions, at the top right of the pane. Icons with tooltips:
 * the labels said the same thing twice over, once here and once in the app bar.
 */
function toolbarMarkup(test: Test): string {
  const draft = test.status === "draft";
  const btn = (id: string, icon: string, label: string, cls = "") =>
    `<button class="ed-tool${cls ? " " + cls : ""}" id="${id}" title="${escapeHtml(label)}" aria-label="${escapeHtml(label)}">${icon}</button>`;

  // A teacher reading a library master can only look at it. Publishing, the
  // audience picker and quick edit would all fail at the server, so they are
  // not offered — the copy is taken when a subject or a test is created.
  if (test.platform && !isAdmin()) {
    return `<div class="ed-toolbar">${btn("ov-preview", ICONS.eye, "Preview as student")}</div>`;
  }

  return `
    <div class="ed-toolbar">
      ${btn("ed-audience", ICONS.users, "Who sees this")}
      ${btn("ov-preview", ICONS.eye, "Preview as student")}
      ${draft ? btn("ov-quick", ICONS.pencil, "Quick edit (card view)") : ""}
      ${
        draft
          ? btn("ov-publish", ICONS.send, "Publish to students", "primary")
          : btn("ed-unpublish-bar", ICONS.undo, "Move back to draft")
      }
    </div>`;
}

/**
 * What the status actually means for students. A draft reaches nobody however
 * it is assigned — that is the sentence a teacher needs and never had.
 */
function audienceNote(test: Test): string {
  if (test.status !== "published") {
    return "Students cannot see this yet — publish it to share it.";
  }
  return test.audience === "selected"
    ? `Published to ${test.assignedCount ?? 0} selected student${(test.assignedCount ?? 0) === 1 ? "" : "s"}.`
    : "Published to everyone you teach.";
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
    : [
        ...siblings,
        {
          id: test.id,
          title: test.title,
          chapter: test.chapter || "",
          status: test.status ?? "draft",
          questionCount: test.questions.length,
        },
      ];

  return `
    <div class="ed-tree-head">
      <span class="ed-tree-title">Tests &amp; questions</span>
      ${canAddHere() ? `<button class="ed-tree-add" id="ed-new-test" title="Add a test" aria-label="Add a test">${ICONS.plus}</button>` : ""}
    </div>
    <div class="ed-tree-body">
      ${rows.map((row) => testNode(row, test)).join("")}
    </div>`;
}

function testNode(
  row: { id: string; title: string; chapter?: string; status: string; questionCount: number },
  test: Test
): string {
  const isCurrent = row.id === test.id;
  const open = expanded.has(row.id);
  const title = isCurrent ? test.title || "Untitled test" : row.title;
  const chapter = isCurrent ? test.chapter || "" : row.chapter;
  const status = isCurrent ? test.status ?? "draft" : row.status;
  return `
    <div class="ed-node${open ? " open" : ""}" data-test="${escapeHtml(row.id)}">
      <div class="ed-node-head${isCurrent && selectedIndex < 0 ? " active" : ""}">
        <button class="ed-caret-btn" data-toggle="${escapeHtml(row.id)}" aria-label="${open ? "Collapse" : "Expand"} ${escapeHtml(title)}" aria-expanded="${open}">
          <svg class="ed-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>
        </button>
        <button class="ed-tree-test${isCurrent ? "" : " ed-tree-other"}"${isCurrent ? ' id="ed-open-overview"' : ` data-test="${escapeHtml(row.id)}"`}>
          <span class="ed-tree-name">${testLabelMarkup(title, chapter)}</span>
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
  const test = currentTest();
  // A master is not "published to students" — it reaches no student directly,
  // and a teacher never edits one. Saying so beats an Unpublish button that
  // would 403.
  if (test?.platform && !isAdmin()) {
    return `
      <div class="ed-banner">
        <span>This is a built-in Vidai test, so it cannot be changed. To use it with
        your class, pick it when you create a subject or add a test.</span>
      </div>`;
  }
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
      ${copiedBanner()}
      <section class="ed-panel">
        <div class="ed-panel-head">
          <span class="ed-panel-label">Test details</span>
          <div class="ed-spacer"></div>
          ${toolbarMarkup(test)}
        </div>
        <p id="ov-publish-error" class="login-error"${publishError ? "" : " hidden"}>${escapeHtml(publishError)}</p>
        <div class="ed-grid">
          <label class="ed-field">
            <span class="ed-panel-label">Title</span>
            <input class="ed-input" id="ov-title" type="text" maxlength="120" value="${escapeHtml(test.title)}" />
          </label>
          <label class="ed-field">
            <span class="ed-panel-label">Subtitle</span>
            <input class="ed-input" id="ov-chapter" type="text" maxlength="60" placeholder="e.g. Chapter Test 1" value="${escapeHtml(test.chapter || "")}" />
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
  document.getElementById("ed-welcome-x")?.addEventListener("click", () => {
    copiedNote = 0;
    document.getElementById("ed-welcome")?.remove();
  });
  document.getElementById("ov-preview")?.addEventListener("click", () => {
    window.open(`./?test=${encodeURIComponent(test.id)}`, "_blank");
  });
  document.getElementById("ov-quick")?.addEventListener("click", () => {
    // The card builder is the fast bulk-entry mode; flush edits before handing over.
    const id = test.id;
    void save().then(() => showBuilder(id, () => void showEditor(id, null, onExit)));
  });
  document.getElementById("ov-publish")?.addEventListener("click", publish);
  document.getElementById("ed-unpublish")?.addEventListener("click", unpublish);
}

async function publish(): Promise<void> {
  const test = currentTest();
  const btn = document.getElementById("ov-publish") as HTMLButtonElement | null;
  if (!test || !btn) return;
  // An icon button: it says "publishing" by going dim, not by changing its label.
  btn.disabled = true;
  await save(); // publish validates what is stored, so flush pending edits first
  const result = await setTestStatus(test.id, "publish");
  btn.disabled = false;
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
    void save().then(() => newTestHere(onExit));
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
  const subjectSel = document.getElementById("ed-subject") as HTMLSelectElement | null;
  subjectSel?.addEventListener("change", () => {
    const id = subjectSel.value;
    if (!id || id === treeSubject) return;
    setSubject(id);
    void save().then(() => showEditorForSubject(id, onExit));
  });
  document.getElementById("ed-crumb-overview")?.addEventListener("click", () => {
    selectedIndex = -1;
    render();
  });
  document.getElementById("ed-audience")?.addEventListener("click", () => {
    const test = currentTest();
    if (!test) return;
    void openAssign(test, (result) => {
      // The picker wrote to the server; mirror it on the working copy so the
      // bar reads right without a reload. This is metadata, not question
      // content, so it never needs to go back through autosave.
      test.audience = result.audience;
      test.assignedCount = result.assignedCount;
      test.assignedTo = result.assignedTo;
      render();
    });
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

/** Keep the top bar's status chip and publish button in step with the document. */
function refreshShellbar(): void {
  const test = currentTest();
  if (test) {
    setShellbar({
      title: test.title || "Untitled test",
      sub: audienceNote(test),
      actions: editorActions(test),
    });
  }
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
/**
 * The + in the tree. A teacher can start blank or take a copy of a built-in
 * test straight into the subject they are working in — the library is not a
 * place you go, it is an option where you already are.
 *
 * On a built-in shelf (admins only) it always makes a blank master: copying a
 * master into the library itself is meaningless.
 */
export async function newTestHere(back: () => void): Promise<void> {
  const into = treeSubject ?? currentSubject();
  if (viewingShelf()) return createTestAndEdit(back);

  const [subjects, masters] = await Promise.all([fetchSubjects(), fetchLibrary()]);
  const shelves = (subjects ?? []).filter((x) => x.platform);
  const library = masters ?? [];
  const usable = shelves.filter((sh) => library.some((t) => t.subjectId === sh.id));
  if (!usable.length) return createTestAndEdit(back);

  openModal({
    title: "Add a test",
    description: "Start from nothing, or take your own copy of a built-in test.",
    submitLabel: "Add test",
    fields: [
      {
        name: "from",
        label: "Start from",
        kind: "radio",
        choices: [
          { value: "blank", label: "A blank test", hint: "Write the questions yourself" },
          ...usable.map((sh) => ({
            value: sh.id,
            label: sh.title,
            hint: "Copy a built-in test",
          })),
        ],
      },
      ...usable.map((sh) => ({
        name: `tests_${sh.id}`,
        label: `Tests to copy from ${sh.title}`,
        kind: "checklist" as const,
        showWhen: { field: "from", value: sh.id },
        empty: "This built-in subject has no published tests yet.",
        choices: library
          .filter((t) => t.subjectId === sh.id)
          .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
          .map((t) => ({
            value: t.id,
            label: t.title,
            hint: `${t.chapter ? `${t.chapter} · ` : ""}${t.questionCount} questions · ${t.totalMarks} marks`,
          })),
      })),
    ],
    onSubmit: async (v, picks) => {
      const from = v.from || "blank";
      if (from === "blank") {
        void createTestAndEdit(back);
        return;
      }
      const wanted = picks[`tests_${from}`] ?? [];
      if (!wanted.length) return "Tick at least one test to copy.";
      const copied = await adoptTests(wanted, into);
      if (!copied.ok) return copied.message;
      track("test_adopted", { count: String(copied.tests?.length ?? 0) });
      // Land on the first copy — it is theirs now, and editable.
      const first = copied.tests?.[0];
      if (first) void showEditor(first.id, null, back);
    },
  });
}

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
