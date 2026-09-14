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
import { app, escapeHtml, formatText, ICONS, renderMath, setUrl, testLabelMarkup } from "../dom";
import { bindTreeDrawer, drawerToggleMarkup, mount, skeleton } from "../shell";
import type { Attempt, Question, Test } from "../types";
import { showReview } from "./review";
import { showSubjects } from "./subjects";

/** One test as the tree knows it, before its questions are fetched. */
export interface WorkTest {
  id: string;
  title: string;
  chapter: string;
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
              <span class="ed-tree-name">${testLabelMarkup(t.title, t.chapter)}</span>
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
    : TESTS.map((t) => ({ id: t.id, title: t.title, chapter: t.chapter || "", questionCount: t.questions.length }));
  const server = (list?.tests ?? [])
    .filter(
      (t) =>
        t.status === "published" &&
        (subjectId ? t.subjectId === subjectId : !t.subjectId) &&
        !bundled.some((b) => b.id === t.id)
    )
    .map((t) => ({ id: t.id, title: t.title, chapter: t.chapter || "", questionCount: t.questionCount }));
  workTests = [...bundled, ...server];
}

/** Nothing picked yet: the tree, and a panel that says what to do with it. */
function renderOverview(): void {
  const busy = openTestId();
  const justHandedIn = takeHandedIn();
  const handedTitle = workTests.find((t) => t.id === justHandedIn)?.title ?? "";
  mount(
    `
    <div class="editor ed-readonly ed-student" data-pane="question">
      <div class="ed-cols overview st-workspace">
        ${studentTreeMarkup()}
        <div class="ed-center">
          <div class="ed-crumbrow">
            ${drawerToggleMarkup("Tests")}
            <span class="ed-crumb-test">${escapeHtml(subjectTitle)}</span>
          </div>
          <div class="ed-body">
            ${
              justHandedIn
                ? `<div class="note st-handed">
                     ${ICONS.check}
                     <span><strong>Handed in${handedTitle ? ` — ${escapeHtml(handedTitle)}` : ""}.</strong>
                     Your teacher marks it next. You can open it here any time to see what you
                     answered; the marks and worked solutions appear once they release it.</span>
                   </div>`
                : ""
            }
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
                            <div class="test-card-title">${locked ? ICONS.lock : ""}${testLabelMarkup(t.title, t.chapter)}</div>
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
      <div class="ed-scrim"></div>
    </div>`,
    { title: subjectTitle, active: "subjects", full: true }
  );
  bindTree();
  bindDrawer();
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
      { id: test.id, title: test.title, chapter: test.chapter || "", questionCount: test.questions.length },
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
              ${drawerToggleMarkup()}
              <button class="ed-crumb-link" id="st-back">${escapeHtml(subjectTitle)}</button>
              <span class="ed-crumb-sep">›</span>
              <span class="ed-crumb-mid">
                <span class="ed-crumb-test">${escapeHtml(test.title)}</span>
                <span class="ed-crumb-sep">›</span>
              </span>
              <span class="ed-crumb-current">Question ${index + 1} of ${test.questions.length}</span>
              <span class="ed-spacer"></span>
              <button id="st-submit" class="btn btn-primary st-handin">Hand in<span class="st-long"> test</span></button>
            </div>
            <div class="ed-body">
              <section class="ed-panel">
                <div class="ed-panel-head">
                  <span class="ed-panel-label">Question ${index + 1}</span>
                  <div class="ed-spacer"></div>
                  <span class="ed-hint">${escapeHtml(q.topic)} · ${q.marks} mark${q.marks > 1 ? "s" : ""}</span>
                  ${q.source ? `<span class="chip chip-source">${escapeHtml(q.source)}</span>` : ""}
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
                <div class="st-navrow">
                  <button class="btn btn-ghost st-step" id="st-prev"${index === 0 ? " disabled" : ""}>‹ Previous</button>
                  <span class="ed-hint st-count">${done} of ${test.questions.length} answered</span>
                  <span class="ed-spacer"></span>
                  <span class="st-save" id="st-actions"></span>
                  <button class="btn btn-ghost st-step" id="st-next"${index === test.questions.length - 1 ? " disabled" : ""}>Next ›</button>
                </div>
              </section>

              <p class="hint quiet-note">${ICONS.lock} Answers and worked solutions open when
              your teacher releases them. Your work is saved as you go.</p>
            </div>
          </div>
        </div>
        <div class="ed-scrim"></div>
      </div>`,
      { title: test.title, sub: "In progress", active: "subjects", full: true }
    );

    renderAnswer(test, attempt, q, index, render);

    bindTree((i) => {
      index = i;
      render();
    });
    bindDrawer();
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
          { id: test.id, title: test.title, chapter: test.chapter || "", questionCount: test.questions.length },
          ...workTests,
        ];
      }
      render();
    });
  }
}

/**
 * Repaint what an answer changes, without rebuilding the page.
 *
 * Saving happens on every keystroke and every option tap now, so a full
 * re-render is both wasteful on a cheap phone and wrong: it would tear the
 * number input out from under the student mid-number. Only the four things an
 * answer actually moves are touched — the tick in the tree, the Answered chip,
 * the count in the nav row, and whether Clear is offered.
 */
function refreshProgress(test: Test, attempt: Attempt, q: Question, index: number): void {
  const done = answeredCount(test, attempt);
  const answered = !!attempt.answers[q.id];

  const count = document.querySelector(".st-navrow .st-count");
  if (count) count.textContent = `${done} of ${test.questions.length} answered`;

  const head = document.querySelectorAll(".ed-panel-head")[1];
  const chip = head?.querySelector(".status-chip");
  if (answered && !chip && head) {
    head.insertAdjacentHTML("beforeend", `<span class="status-chip status-done">Answered</span>`);
  } else if (!answered && chip) {
    chip.remove();
  }

  const dot = document.querySelectorAll("#st-tree .ed-tree-q")[index]?.querySelector(".st-dot");
  if (dot) {
    dot.className = `st-dot ${answered ? "st-answered" : "st-todo"}`;
    dot.textContent = answered ? "✓" : "";
  }

  const clear = document.getElementById("st-clear");
  if (clear) clear.hidden = !answered;
}

/** The type-adaptive answer control. Answers save themselves. */
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
    persist();
    track("question_answered", { test: test.id, question: q.id, correct });
  };

  /** Take the answer back off the paper, so the question can be left for later. */
  const clear = () => {
    delete attempt.answers[q.id];
    persist();
    track("question_cleared", { test: test.id, question: q.id });
  };

  function persist(): void {
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
    refreshProgress(test, attempt, q, index);
  }

  /**
   * The one control in the actions slot. There is no Save button: an answer is
   * saved the moment it is given, which is what a student expects and what
   * stops a tapped-but-unsaved answer being lost on Next. What is left is the
   * way back out — Clear, so a question can be revisited later.
   */
  const actionsMarkup = (answered: boolean): string =>
    `<button id="st-clear" class="btn btn-ghost st-clear"${answered ? "" : " hidden"}>Clear answer</button>`;

  const bindClear = (reset: () => void): void => {
    document.getElementById("st-clear")!.addEventListener("click", () => {
      clear();
      reset();
    });
  };

  if (q.type === "mcq") {
    area.innerHTML = `
      <div class="options">
        ${q.options!
          .map(
            (opt, i) => `
          <button class="option${i === (existing?.given ?? -1) ? " selected" : ""}" data-i="${i}">
            <span class="option-letter">${String.fromCharCode(65 + i)}</span>
            <span class="option-text">${escapeHtml(opt)}</span>
          </button>`
          )
          .join("")}
      </div>`;
    actions.innerHTML = actionsMarkup(!!existing);
    const select = (i: number): void => {
      area.querySelectorAll(".option").forEach((b, n) => b.classList.toggle("selected", n === i));
    };
    area.querySelectorAll<HTMLButtonElement>(".option").forEach((btn) => {
      btn.addEventListener("click", () => {
        const i = Number(btn.dataset.i);
        select(i);
        record(i);
      });
    });
    bindClear(() => select(-1));
    renderMath(area);
    return;
  }

  if (q.type === "numeric") {
    area.innerHTML = `
      <input id="st-num" class="numeric-input" type="number" step="any" inputmode="decimal"
             placeholder="Enter your answer" value="${existing?.given ?? ""}" />`;
    actions.innerHTML = actionsMarkup(!!existing);
    const input = document.getElementById("st-num") as HTMLInputElement;
    // A number is typed a digit at a time, and "1" on the way to "12" is a
    // wrong answer. So it settles before it is saved — and blur and Enter save
    // at once, because leaving the box means the student is done with it.
    let timer = 0;
    const commit = (): void => {
      window.clearTimeout(timer);
      const text = input.value.trim();
      if (text === "") {
        if (attempt.answers[q.id]) clear();
        return;
      }
      const val = parseFloat(text);
      record(Number.isFinite(val) ? val : null);
    };
    input.addEventListener("input", () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(commit, 800);
    });
    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") commit();
    });
    bindClear(() => {
      input.value = "";
      input.focus();
    });
    return;
  }

  // long: photograph the working; the teacher awards the marks. A photo *is*
  // the answer here, so adding one saves it and removing the last one takes it
  // back — the uploader's own ✕ is the Clear button for this type, and there is
  // no second one, because the photo also has to be deleted server-side.
  area.innerHTML = `
    <div class="note">
      ${ICONS.mark}
      <span><strong>Your teacher marks this one.</strong> Work it out on paper, then add a
      photo so they can see your method.</span>
    </div>
    <div class="section-label">Your working</div>
    <div id="st-upload"></div>`;
  let first = true;
  mountUploader(document.getElementById("st-upload")!, {
    testId: test.id,
    testTitle: test.title,
    questionId: q.id,
    questionIndex: index,
    maxMarks: q.marks,
    initial: existing?.images ?? [],
    onChange: (images) => {
      // The uploader paints once on mount; that first call is the state we
      // were given, not a change the student made.
      if (first) {
        first = false;
        return;
      }
      if (images.length) record(1, { images, review: "pending" });
      else if (attempt.answers[q.id]) clear();
    },
  });
  actions.innerHTML = `<span class="ed-hint st-autosave">Saved as you go</span>`;
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
  // No score screen. A student hands the paper in and goes back to their
  // subject: marks are the teacher's to give, and a number on the way out
  // would be a half-truth anyway while every long answer is still unmarked.
  // The test stays open to them read-only — what they answered, nothing more.
  handedIn = test.id;
  void showStudentSubject(subjectId, subjectTitle);
}

/**
 * The test just handed in, for the one render of the subject page that
 * follows. It is a note on a screen, not state worth keeping: a reload has
 * nothing to say about it, and the tree already says "Done".
 */
let handedIn = "";

export function takeHandedIn(): string {
  const id = handedIn;
  handedIn = "";
  return id;
}

/** Small screens: the tree slides in from the left over the question. */
function bindDrawer(): void {
  const editor = document.querySelector<HTMLElement>(".ed-student");
  if (editor) bindTreeDrawer(editor);
}

/** Back to the subject grid — the rail's Subjects item, for this screen. */
export function backToSubjects(): void {
  void showSubjects();
}
