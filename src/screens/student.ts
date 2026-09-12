// The student's workspace — the same shape their teacher authors in.
//
// A subject opens a tree of its tests; every test is a root node and its
// questions are the level beneath. Picking a question shows it in the panel
// next to the tree, one question per page, never a single scrolling paper.
//
// Two modes share the layout:
//   sitting the test  — tree + question. No explanation panel, no discussion:
//                       nothing comes back until the teacher releases it.
//   reading the result — src/screens/review.ts, which adds the explanation on
//                       the right (and, next phase, the discussion under it).
//
// Questions may be answered in any order and revisited. Only one test may be
// in progress at a time: the others stay locked in the tree until this one is
// handed in. A running timer and forced-order questions come later.

import { track } from "../analytics";
import { mountUploader } from "../answerphotos";
import { fetchMyAttempts, getProfile, isLoggedIn, saveProgress, submitAttempt } from "../auth";
import { fetchServerTest, fetchTestList } from "../api";
import { loadAttempt, newAttempt, saveAttempt } from "../attempts";
import { gradeAnswer, TESTS, totalMarks } from "../data";
import { app, escapeHtml, formatText, ICONS, renderMath, setUrl } from "../dom";
import { mount, skeleton } from "../shell";
import type { Attempt, Question, Test } from "../types";
import { showReview } from "./review";
import { showScore } from "./test";
import { showSubjects } from "./subjects";

/** One test as the tree knows it, before its questions are fetched. */
export interface WorkTest {
  id: string;
  title: string;
  questionCount: number;
}

/**
 * Which subject the student is working in. Kept on the device, not only in
 * module state: a refresh inside a test lands straight back on the question,
 * and the crumb and the tree still have to know where "back" goes.
 */
const SUBJECT_KEY = "vidai:subject";

let subjectId: string | null = null;
let subjectTitle = "Tests";
let workTests: WorkTest[] = [];

try {
  const saved = JSON.parse(localStorage.getItem(SUBJECT_KEY) || "null");
  if (saved && typeof saved.title === "string") {
    subjectId = saved.id ?? null;
    subjectTitle = saved.title;
  }
} catch {
  // Storage unavailable — the built-in subject is a fine default.
}

function rememberSubject(id: string | null, title: string): void {
  subjectId = id;
  subjectTitle = title;
  try {
    localStorage.setItem(SUBJECT_KEY, JSON.stringify({ id, title }));
  } catch {}
}
/** testId → how far the server says this student got, for another device. */
const serverIndex = new Map<string, number>();
const serverDone = new Set<string>();

/** Is this person a student sitting tests, rather than a teacher or a guest? */
export function isStudentViewer(): boolean {
  return isLoggedIn() && getProfile()?.kind === "student";
}

// ---------- Test states ----------

type TestState = "done" | "progress" | "new";

function stateOf(id: string): TestState {
  const local = loadAttempt(id);
  if (local?.completed || serverDone.has(id)) return "done";
  if ((local && Object.keys(local.answers).length > 0) || (serverIndex.get(id) ?? 0) > 0) {
    return "progress";
  }
  return "new";
}

/** The one test already under way, if any — nothing else may be started. */
function openTestId(): string | null {
  return workTests.find((t) => stateOf(t.id) === "progress")?.id ?? null;
}

// ---------- The tree ----------

interface TreeOpts {
  activeTest?: string;
  /** Questions of the active test, once it is loaded. */
  questions?: Question[];
  activeQuestion?: number;
  answered?: (q: Question) => boolean;
}

export function studentTreeMarkup(opts: TreeOpts = {}): string {
  const busy = openTestId();
  const nodes = workTests
    .map((t) => {
      const state = stateOf(t.id);
      const active = t.id === opts.activeTest;
      const locked = state === "new" && !!busy && busy !== t.id;
      const chip =
        state === "done"
          ? `<span class="status-chip status-done">Done</span>`
          : state === "progress"
            ? `<span class="status-chip status-progress">In progress</span>`
            : locked
              ? `<span class="st-lock" title="Finish the test you have open first">${ICONS.lock}</span>`
              : `<span class="status-chip status-new">${t.questionCount} Q</span>`;
      const rows =
        active && opts.questions
          ? `<div class="ed-tree-questions">${opts.questions
              .map((q, i) => {
                const ok = opts.answered?.(q) ?? false;
                return `
                <div class="ed-tree-row">
                  <button class="ed-tree-q${i === opts.activeQuestion ? " active" : ""}" data-i="${i}">
                    <span class="st-dot ${ok ? "st-answered" : "st-todo"}">${ok ? "✓" : ""}</span>
                    <span class="ed-tree-name">${i + 1}. ${escapeHtml(q.topic)}</span>
                    <span class="ed-tree-marks">${q.marks}</span>
                  </button>
                </div>`;
              })
              .join("")}</div>`
          : "";
      return `
        <div class="ed-node${active ? " open" : ""}">
          <div class="ed-node-head${active ? " active" : ""}">
            <button class="ed-tree-test st-test${locked ? " st-locked" : ""}" data-test="${escapeHtml(t.id)}"${locked ? " disabled" : ""}>
              ${ICONS.folder}
              <span class="ed-tree-name">${escapeHtml(t.title)}</span>
              ${chip}
            </button>
          </div>
          ${rows}
        </div>`;
    })
    .join("");

  return `
    <aside class="ed-tree" id="st-tree">
      <div class="ed-tree-head"><span class="ed-tree-title">${escapeHtml(subjectTitle)}</span></div>
      <div class="ed-tree-body">
        ${nodes || `<p class="ed-tree-empty hint">No tests here yet.</p>`}
      </div>
    </aside>`;
}

/** Wire the tree: a test root opens that test, a question row jumps to it. */
function bindTree(onQuestion?: (i: number) => void): void {
  document.getElementById("st-tree")?.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const qrow = target.closest<HTMLElement>(".ed-tree-q[data-i]");
    if (qrow && onQuestion) {
      onQuestion(Number(qrow.dataset.i));
      return;
    }
    const test = target.closest<HTMLElement>(".st-test[data-test]");
    if (test && !(test as HTMLButtonElement).disabled) void openTest(test.dataset.test!);
  });
}

// ---------- Subject → tests ----------

/** The tests in one subject, as a tree. `null` is the built-in subject. */
export async function showStudentSubject(id: string | null, title?: string): Promise<void> {
  rememberSubject(id, title ?? (id === subjectId ? subjectTitle : id ? "Tests" : "CBSE Class 12 Maths"));
  setUrl(id ? { subject: id } : {});
  track("subject_open", id ? { subject: id } : {});

  mount(skeleton.editor(), { title: subjectTitle, active: "subjects", full: true });

  await loadWorkTests();
  renderOverview();
}

async function loadWorkTests(): Promise<void> {
  const [list, attempts] = await Promise.all([
    fetchTestList(subjectId ?? undefined),
    fetchMyAttempts(),
  ]);
  serverIndex.clear();
  serverDone.clear();
  for (const a of attempts ?? []) {
    if (a.status === "progress") serverIndex.set(a.testId, a.index ?? 0);
    else serverDone.add(a.testId);
  }
  const bundled = subjectId
    ? []
    : TESTS.map((t) => ({ id: t.id, title: t.title, questionCount: t.questions.length }));
  const server = (list?.tests ?? [])
    .filter(
      (t) =>
        t.status === "published" &&
        (subjectId ? t.subjectId === subjectId : !t.subjectId) &&
        !bundled.some((b) => b.id === t.id)
    )
    .map((t) => ({ id: t.id, title: t.title, questionCount: t.questionCount }));
  workTests = [...bundled, ...server];
}

/** Nothing picked yet: the tree, and a panel that says what to do with it. */
function renderOverview(): void {
  const busy = openTestId();
  mount(
    `
    <div class="editor ed-readonly ed-student" data-pane="question">
      <div class="ed-cols overview st-workspace">
        ${studentTreeMarkup()}
        <div class="ed-center">
          <div class="ed-crumbrow"><span class="ed-crumb-test">${escapeHtml(subjectTitle)}</span></div>
          <div class="ed-body">
            <section class="ed-panel">
              <div class="ed-panel-head"><span class="ed-panel-label">Your tests</span></div>
              <p class="hint">Pick a test on the left. Questions open one at a time,
              and you can move between them in any order.</p>
              ${
                busy
                  ? `<p class="hint quiet-note">${ICONS.lock} One test at a time — finish and
                     hand in the test you have open before starting another.</p>`
                  : ""
              }
              ${
                workTests.length
                  ? `<div class="test-list">${workTests
                      .map((t) => {
                        const state = stateOf(t.id);
                        const locked = state === "new" && !!busy && busy !== t.id;
                        return `
                        <button class="test-card" data-test="${escapeHtml(t.id)}"${locked ? " disabled" : ""}>
                          <div class="test-card-main">
                            <div class="test-card-title">${locked ? ICONS.lock : ""}${escapeHtml(t.title)}</div>
                            <div class="test-card-sub">${t.questionCount} questions${locked ? " · finish your open test first" : ""}</div>
                          </div>
                          <span class="status-chip status-${state === "progress" ? "progress" : state === "done" ? "done" : "new"}">${
                            state === "done" ? "Done" : state === "progress" ? "In progress" : "Not started"
                          }</span>
                        </button>`;
                      })
                      .join("")}</div>`
                  : `<p class="hint">Your teacher has not published a test here yet.</p>`
              }
            </section>
          </div>
        </div>
      </div>
      <div class="ed-tabs">
        <button class="ed-tab" data-pane="tree">Tests</button>
        <button class="ed-tab active" data-pane="question">Test</button>
      </div>
    </div>`,
    { title: subjectTitle, active: "subjects", full: true }
  );
  bindTree();
  bindTabs();
  // The cards say the same thing as the tree, so they must do the same thing.
  document.querySelector(".ed-center .test-list")?.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLButtonElement>(".test-card[data-test]");
    if (card && !card.disabled) void openTest(card.dataset.test!);
  });
}

/** Load one test and send the student to the right view for its state. */
export async function openTest(testId: string): Promise<void> {
  const bundled = TESTS.find((t) => t.id === testId);
  let test: Test | null = bundled ?? null;
  if (!test) {
    mount(skeleton.editor(), { title: "Test", active: "subjects", full: true });
    test = await fetchServerTest(testId);
  }
  if (!test) {
    renderOverview();
    return;
  }
  const attempt = loadAttempt(test.id);
  if (attempt?.completed) {
    track("review_open", { test: test.id });
    void showReview(test, attempt, { back: () => void showStudentSubject(subjectId, subjectTitle) });
    return;
  }
  track(attempt ? "test_resume" : "test_start", { test: test.id });
  showAttempt(test, attempt ?? newAttempt());
}

// ---------- Sitting the test ----------

function answeredCount(test: Test, attempt: Attempt): number {
  return test.questions.filter((q) => attempt.answers[q.id]).length;
}

/** Score is recomputed, never accumulated — a changed answer must not double. */
function recomputeScore(test: Test, attempt: Attempt): void {
  attempt.score = test.questions.reduce((n, q) => n + (attempt.answers[q.id]?.earned ?? 0), 0);
}

export function showAttempt(test: Test, attempt: Attempt, at?: number): void {
  const wanted = new URLSearchParams(location.search).get("q");
  let index = at ?? Math.max(0, test.questions.findIndex((qq) => qq.id === wanted));

  // A shared ?test= link opens the test with no subject loaded — the tree would
  // otherwise be empty under the question the student is looking at. Seed it
  // with this test, and fill the rest of the subject in when it arrives.
  const known = workTests.some((t) => t.id === test.id);
  if (!known) {
    workTests = [
      { id: test.id, title: test.title, questionCount: test.questions.length },
      ...workTests,
    ];
  }

  const render = (): void => {
    const q = test.questions[index];
    const a = attempt.answers[q.id];
    setUrl({ test: test.id, q: q.id });
    const done = answeredCount(test, attempt);

    mount(
      `
      <div class="editor ed-readonly ed-student" data-pane="question">
        <div class="ed-cols overview st-workspace">
          ${studentTreeMarkup({
            activeTest: test.id,
            questions: test.questions,
            activeQuestion: index,
            answered: (qq) => !!attempt.answers[qq.id],
          })}
          <div class="ed-center">
            <div class="ed-crumbrow">
              <button class="ed-crumb-link" id="st-back">${escapeHtml(subjectTitle)}</button>
              <span class="ed-crumb-sep">›</span>
              <span class="ed-crumb-test">${escapeHtml(test.title)}</span>
              <span class="ed-crumb-sep">›</span>
              <span class="ed-crumb-current">Question ${index + 1} of ${test.questions.length}</span>
            </div>
            <div class="ed-body">
              <section class="ed-panel">
                <div class="ed-panel-head">
                  <span class="ed-panel-label">Question ${index + 1}</span>
                  <div class="ed-spacer"></div>
                  <span class="ed-hint">${escapeHtml(q.topic)} · ${q.marks} mark${q.marks > 1 ? "s" : ""}</span>
                </div>
                <div class="question-text">${formatText(q.q)}</div>
              </section>

              <section class="ed-panel">
                <div class="ed-panel-head">
                  <span class="ed-panel-label">Your answer</span>
                  <div class="ed-spacer"></div>
                  ${a ? `<span class="status-chip status-done">Answered</span>` : ""}
                </div>
                <div id="st-answer"></div>
                <div class="actions" id="st-actions"></div>
              </section>

              <div class="rv-nav">
                <button class="btn btn-ghost" id="st-prev"${index === 0 ? " disabled" : ""}>‹ Previous</button>
                <span class="ed-spacer"></span>
                <span class="ed-hint">${done} of ${test.questions.length} answered</span>
                <span class="ed-spacer"></span>
                <button class="btn btn-ghost" id="st-next"${index === test.questions.length - 1 ? " disabled" : ""}>Next ›</button>
              </div>

              <div class="actions">
                <button id="st-submit" class="btn btn-primary">Hand in test</button>
              </div>
              <p class="hint quiet-note">${ICONS.lock} Answers and worked solutions open when
              your teacher releases them. Your work is saved as you go.</p>
            </div>
          </div>
        </div>
        <div class="ed-tabs">
          <button class="ed-tab" data-pane="tree">Questions</button>
          <button class="ed-tab active" data-pane="question">Question</button>
        </div>
      </div>`,
      { title: test.title, sub: "In progress", active: "subjects", full: true }
    );

    renderAnswer(test, attempt, q, index, render);

    bindTree((i) => {
      index = i;
      render();
    });
    bindTabs();
    document.getElementById("st-back")!.addEventListener("click", () =>
      void showStudentSubject(subjectId, subjectTitle)
    );
    document.getElementById("st-prev")!.addEventListener("click", () => {
      if (index > 0) { index -= 1; render(); }
    });
    document.getElementById("st-next")!.addEventListener("click", () => {
      if (index < test.questions.length - 1) { index += 1; render(); }
    });
    document.getElementById("st-submit")!.addEventListener("click", () => handIn(test, attempt));

    renderMath(app);
  };

  render();

  if (!known) {
    void loadWorkTests().then(() => {
      // Still on this test? A slow list must not redraw over a student who has
      // since moved on, and must not lose the seeded node either.
      if (!document.querySelector(".ed-student")) return;
      if (!workTests.some((t) => t.id === test.id)) {
        workTests = [
          { id: test.id, title: test.title, questionCount: test.questions.length },
          ...workTests,
        ];
      }
      render();
    });
  }
}

/** The type-adaptive answer control, plus what saving it does. */
function renderAnswer(
  test: Test,
  attempt: Attempt,
  q: Question,
  index: number,
  rerender: () => void
): void {
  const area = document.getElementById("st-answer")!;
  const actions = document.getElementById("st-actions")!;
  const existing = attempt.answers[q.id];

  const record = (given: number | null, extra?: Partial<(typeof attempt.answers)[string]>) => {
    const correct = gradeAnswer(q, given);
    attempt.answers[q.id] = { given, correct, earned: correct ? q.marks : 0, ...extra };
    recomputeScore(test, attempt);
    // `index` stays the furthest question reached, so another device resumes
    // somewhere sensible; it is no longer a gate on what can be opened.
    attempt.index = Math.max(attempt.index, answeredCount(test, attempt));
    saveAttempt(test.id, attempt);
    saveProgress({
      testId: test.id,
      answers: JSON.stringify(attempt.answers),
      index: attempt.index,
      score: attempt.score,
      total: totalMarks(test),
    });
    track("question_answered", { test: test.id, question: q.id, correct });
    rerender();
  };

  if (q.type === "mcq") {
    let selected = existing?.given ?? -1;
    area.innerHTML = `
      <div class="options">
        ${q.options!
          .map(
            (opt, i) => `
          <button class="option${i === selected ? " selected" : ""}" data-i="${i}">
            <span class="option-letter">${String.fromCharCode(65 + i)}</span>
            <span class="option-text">${escapeHtml(opt)}</span>
          </button>`
          )
          .join("")}
      </div>`;
    actions.innerHTML = `<button id="st-save" class="btn btn-primary"${selected < 0 ? " disabled" : ""}>${
      existing ? "Update answer" : "Save answer"
    }</button>`;
    const save = document.getElementById("st-save") as HTMLButtonElement;
    area.querySelectorAll<HTMLButtonElement>(".option").forEach((btn) => {
      btn.addEventListener("click", () => {
        area.querySelectorAll(".option").forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selected = Number(btn.dataset.i);
        save.disabled = false;
      });
    });
    save.addEventListener("click", () => record(selected));
    renderMath(area);
    return;
  }

  if (q.type === "numeric") {
    area.innerHTML = `
      <input id="st-num" class="numeric-input" type="number" step="any" inputmode="decimal"
             placeholder="Enter your answer" value="${existing?.given ?? ""}" />`;
    actions.innerHTML = `<button id="st-save" class="btn btn-primary">${
      existing ? "Update answer" : "Save answer"
    }</button>`;
    const input = document.getElementById("st-num") as HTMLInputElement;
    const save = document.getElementById("st-save") as HTMLButtonElement;
    save.disabled = input.value.trim() === "";
    input.addEventListener("input", () => { save.disabled = input.value.trim() === ""; });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !save.disabled) save.click();
    });
    save.addEventListener("click", () => {
      const val = parseFloat(input.value);
      record(Number.isFinite(val) ? val : null);
    });
    return;
  }

  // long: photograph the working; the teacher awards the marks.
  area.innerHTML = `
    <div class="note">
      ${ICONS.mark}
      <span><strong>Your teacher marks this one.</strong> Work it out on paper, then add a
      photo so they can see your method.</span>
    </div>
    <div class="section-label">Your working</div>
    <div id="st-upload"></div>`;
  const readImages = mountUploader(document.getElementById("st-upload")!, {
    testId: test.id,
    testTitle: test.title,
    questionId: q.id,
    questionIndex: index,
    maxMarks: q.marks,
    initial: existing?.images ?? [],
    onChange: () => {},
  });
  actions.innerHTML = `<button id="st-save" class="btn btn-primary">${
    existing ? "Update working" : "Hand in answer"
  }</button>`;
  document.getElementById("st-save")!.addEventListener("click", () => {
    const images = readImages();
    record(images.length ? 1 : 0, {
      images,
      review: images.length ? "pending" : undefined,
    });
  });
}

/** Hand the paper in: the score screen, and the marks the teacher still owes. */
function handIn(test: Test, attempt: Attempt): void {
  const missing = test.questions.length - answeredCount(test, attempt);
  if (missing && !confirm(`${missing} question${missing > 1 ? "s are" : " is"} still unanswered. Hand in anyway?`)) {
    return;
  }
  recomputeScore(test, attempt);
  attempt.completed = true;
  attempt.index = test.questions.length;
  attempt.completedAt = new Date().toISOString();
  saveAttempt(test.id, attempt);
  track("test_complete", { test: test.id, score: attempt.score, total: totalMarks(test) });
  submitAttempt({
    testId: test.id,
    score: attempt.score,
    total: totalMarks(test),
    completedAt: attempt.completedAt,
    answers: JSON.stringify(attempt.answers),
  });
  showScore(test, attempt);
}

/**
 * Phone layout: the tree is a drawer, not a pane. Below 900px `.ed-tree` is
 * positioned off-screen until the editor carries `tree-open`, so the Tests tab
 * toggles that class rather than the `data-pane` the other tabs use.
 */
function bindTabs(): void {
  const editor = document.querySelector<HTMLElement>(".ed-student");
  editor?.querySelector(".ed-tabs")?.addEventListener("click", (e) => {
    const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-pane]");
    if (!tab) return;
    const pane = tab.dataset.pane!;
    editor.classList.toggle("tree-open", pane === "tree");
    if (pane !== "tree") editor.setAttribute("data-pane", pane);
    editor.querySelectorAll(".ed-tab").forEach((t) => t.classList.toggle("active", t === tab));
  });
  // Picking anything in the drawer closes it again.
  editor?.querySelector(".ed-tree")?.addEventListener("click", () => {
    editor.classList.remove("tree-open");
    editor.querySelectorAll(".ed-tab").forEach((t) =>
      t.classList.toggle("active", (t as HTMLElement).dataset.pane !== "tree")
    );
  });
}

/** Back to the subject grid — the rail's Subjects item, for this screen. */
export function backToSubjects(): void {
  void showSubjects();
}
