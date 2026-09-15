// Reviewing a finished test: one question per page, in the same three-column
// shape the teacher authors in — questions list · question · explanation.
//
// This deliberately does NOT reuse src/screens/editor/. Those panels render
// textareas and selects (there is no read-only renderer), and editor/state.ts
// is a single module-level working copy that autosaves — a student opening a
// test through it would queue writes against the teacher's draft. What is
// reused is the layout: the .ed-* classes, under an .ed-readonly modifier so
// the editor's own geometry assertions keep their meaning.

import { track } from "../analytics";
import { hydrateThumbs, photoStrip } from "../answerphotos";
import {
  assessAnswer,
  fetchGrading,
  fetchReleased,
  fetchReleaseState,
  getProfile,
  isLoggedIn,
  isTeacher,
  saveMark,
  setReleased,
  type GradedAnswer,
} from "../auth";
import { clearAttempt, newAttempt } from "../attempts";
import { totalMarks } from "../data";
import { app, escapeHtml, formatText, ICONS, renderMath, setUrl, testLabelMarkup } from "../dom";
import { bindTreeDrawer, drawerToggleMarkup, mount } from "../shell";
import type { Attempt, Question, StoredAnswer, Test } from "../types";
import { hydrateMarks, startTest } from "./test";

export interface ReviewOpts {
  /** Viewer mode (a parent): where Back goes. Retake is hidden. */
  back?: () => void;
  /** Whose paper this is, when the viewer is not the student themselves. */
  student?: string;
  /** That student's name, for the labels that would otherwise say "Your". */
  studentName?: string;
  /**
   * The teacher is marking, not just reading. Turns the long answers into
   * markable ones — the AI's proposal, the marks row, the comment — and adds
   * Release to the crumb. The layout does not change: the whole point is that
   * a teacher evaluates a paper on the same screen the student reads it on.
   */
  marking?: boolean;
}

/**
 * Whose paper this is, in the second person or the third. "Your answer" is
 * wrong on a teacher's screen, and the same three labels are used in four
 * places, so the word is decided once.
 */
let owner = "Your";

/** What the student put down. */
function describeGiven(q: Question, a: StoredAnswer | undefined): string {
  if (!a) return "Not answered";
  if (q.type === "mcq") {
    const i = a.given ?? -1;
    const letter = i >= 0 ? String.fromCharCode(65 + i) : "?";
    return `${owner} answer: <strong>${letter}.</strong> ${escapeHtml(q.options?.[i] ?? "")}`;
  }
  if (q.type === "numeric") return `${owner} answer: <strong>${a.given}</strong>`;
  if (a.review === "pending") {
    const n = a.images?.length ?? 0;
    return `Handed in${n ? ` · ${n} photo${n > 1 ? "s" : ""}` : ""} — waiting for your teacher`;
  }
  if (a.review === "marked") return "Marked by your teacher";
  return a.correct ? "Self-assessed: got it right" : "Self-assessed: got it wrong";
}

/** What the right answer was — the first thing a student asks after a cross. */
function correctLine(q: Question, a: StoredAnswer | undefined): string {
  if (a?.correct || q.type === "long") return "";
  if (q.type === "mcq") {
    const i = q.answer ?? -1;
    if (i < 0) return "";
    return `<p class="review-correct">Correct answer: <strong>${String.fromCharCode(65 + i)}.</strong> ${escapeHtml(q.options?.[i] ?? "")}</p>`;
  }
  if (q.type === "numeric" && q.answer !== undefined) {
    return `<p class="review-correct">Correct answer: <strong>${q.answer}</strong></p>`;
  }
  return "";
}

function marksChip(q: Question, a: StoredAnswer | undefined, open: boolean): string {
  // Before the teacher releases the paper there is no verdict to give — not a
  // tick, not a mark, not "awaiting review" on one question and a cross on the
  // next. All a student sees is whether they answered it.
  if (!open) {
    return a
      ? `<span class="status-chip status-done">Answered</span>`
      : `<span class="status-chip status-new">Not answered</span>`;
  }
  if (a?.review === "pending") {
    return `<span class="status-chip status-progress">Awaiting review</span>`;
  }
  const ok = a?.correct ?? false;
  return `<span class="status-chip ${ok ? "status-done" : "status-wrong"}">${ok ? `✓ ${a?.earned ?? 0}` : "✗ 0"}/${q.marks}</span>`;
}

function treeMarkup(test: Test, attempt: Attempt, selected: number, open: boolean): string {
  const rows = test.questions
    .map((q, i) => {
      const a = attempt.answers[q.id];
      const pending = a?.review === "pending";
      const ok = a?.correct ?? false;
      const state = !open ? (a ? "given" : "blank") : pending ? "pending" : ok ? "done" : "wrong";
      const dot = !open ? (a ? "•" : "") : pending ? "…" : ok ? "✓" : "✗";
      return `
        <div class="ed-tree-row">
          <button class="ed-tree-q${i === selected ? " active" : ""}" data-i="${i}">
            <span class="rv-dot rv-${state}">${dot}</span>
            <span class="ed-tree-name">${i + 1}. ${escapeHtml(q.topic)}</span>
            <span class="ed-tree-marks">${
              !open ? `${q.marks}` : pending ? `—/${q.marks}` : `${a?.earned ?? 0}/${q.marks}`
            }</span>
          </button>
        </div>`;
    })
    .join("");

  // A flat list, like the workspace: one test is open, so naming it again as a
  // folder above its own questions was a row to scroll past on a phone. The
  // score chip moves to the head, where the list is titled.
  return `
    <aside class="ed-tree" id="rv-tree">
      <div class="ed-tree-head">
        <span class="ed-tree-title">${escapeHtml(owner)} answers</span>
        ${
          open
            ? `<span class="status-chip status-done">${attempt.score}/${totalMarks(test)}</span>`
            : `<span class="status-chip status-progress">Handed in</span>`
        }
      </div>
      <div class="ed-tree-body">${rows}</div>
    </aside>`;
}

/**
 * Release, on the same screen as the marking. A teacher finishes a paper and
 * opens it in one place; the state is read rather than assumed, because a
 * teacher marking on a second device must not be told the wrong thing.
 */
async function bindRelease(testId: string, username: string): Promise<void> {
  const btn = document.getElementById("mk-release") as HTMLButtonElement | null;
  if (!btn || !username) return;
  const state = await fetchReleaseState(testId);
  let classWide = !!state?.classWide;
  let mine = !!state?.students.some((x) => x.username === username);

  const paint = (): void => {
    btn.disabled = classWide && !mine;
    btn.textContent = classWide
      ? "Open to the class"
      : mine
        ? "Hide again"
        : "Release to this student";
    btn.title = classWide
      ? "This paper is open to everyone who sat it"
      : mine
        ? "This student can see their marks and the solutions"
        : "Let this student see their marks, the answers and the worked solutions";
  };
  paint();

  btn.addEventListener("click", async () => {
    btn.disabled = true;
    const want = !mine;
    const ok = await setReleased(testId, { username, released: want });
    if (ok) {
      mine = want;
      track("answers_released", { test: testId, scope: "student", open: want });
    }
    paint();
  });
}

/**
 * Wire the marking block. Everything here writes through the endpoints that
 * already existed: Assess with AI proposes, Save mark awards. There is no path
 * by which the model's number reaches a student without a teacher pressing
 * Save.
 */
function bindMarking(q: Question, rerender: () => void): void {
  const row = rows.get(q.id);
  if (!row || q.type !== "long") return;

  const buttons = document.getElementById("mk-buttons");
  const save = document.getElementById("mk-save") as HTMLButtonElement | null;
  const state = document.getElementById("mk-state");
  const comment = document.getElementById("mk-comment") as HTMLTextAreaElement | null;
  let chosen: number | null = row.status === "marked" ? row.awarded : null;

  const pick = (n: number): void => {
    chosen = n;
    buttons?.querySelectorAll(".mbtn").forEach((b) =>
      b.classList.toggle("chosen", Number((b as HTMLElement).dataset.award) === n)
    );
    if (save) save.disabled = false;
  };

  buttons?.addEventListener("click", (e) => {
    const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-award]");
    if (btn) pick(Number(btn.dataset.award));
  });

  document.getElementById("mk-use")?.addEventListener("click", () => {
    if (typeof row.aiAwarded === "number") pick(row.aiAwarded);
    // The AI's words are a starting point for the teacher's, not a signature:
    // they land in the box, editable, and only go to the student on Save.
    if (comment && !comment.value.trim()) comment.value = row.aiComment || "";
  });

  save?.addEventListener("click", async () => {
    if (chosen === null) return;
    save.disabled = true;
    const was = save.textContent;
    save.textContent = "Saving…";
    const ok = await saveMark({
      username: row.username,
      testId: row.testId,
      questionId: row.questionId,
      awarded: chosen,
      comment: comment?.value.trim() || "",
    });
    save.textContent = was;
    if (!ok) {
      if (state) state.textContent = "That did not save — try again.";
      save.disabled = false;
      return;
    }
    track("answer_marked", { test: row.testId, awarded: String(chosen) });
    row.status = "marked";
    row.awarded = chosen;
    row.comment = comment?.value.trim() || "";
    rerender();
  });

  const assess = document.getElementById("mk-assess") as HTMLButtonElement | null;
  assess?.addEventListener("click", async () => {
    assess.disabled = true;
    assess.textContent = "Reading the working…";
    const result = await assessAnswer({
      username: row.username,
      testId: row.testId,
      questionId: row.questionId,
      question: q.q,
      solution: q.solution,
    });
    if (result.ok && result.assessment) {
      track("answer_assessed", { test: row.testId });
      row.aiAwarded = result.assessment.awarded;
      row.aiComment = result.assessment.comment;
      row.aiReasoning = result.assessment.reasoning;
      row.aiModel = result.assessment.model;
      // Kept for after the rerender: a teacher who can see the balance falling
      // does not have to go looking for it when the button one day refuses.
      creditNote = result.assessment.credits
        ? `${result.assessment.credits.left} AI credits left this month`
        : "";
      rerender();
      return;
    }
    // No key configured: stop offering it for the rest of the session rather
    // than letting a teacher press a button that cannot work.
    if (result.off) aiOff = true;
    assess.disabled = false;
    assess.textContent = "Assess with AI";
    if (state) state.textContent = result.message || "The assessment failed.";
    if (result.off) rerender();
  });
}

/** The grading rows for the paper being marked, by question id. */
let rows = new Map<string, GradedAnswer>();
/** Whether this site has AI marking switched on. Unknown until first asked. */
let aiOff = false;
/** The balance after the last assessment, shown once so it is not a surprise
 *  the day the button starts refusing. Not state — it survives one rerender. */
let creditNote = "";

/**
 * The marking block under a long answer. Three things in one place, in the
 * order a teacher uses them: what the AI thinks, what you award, what the
 * student will read.
 *
 * The AI's number is deliberately never pre-filled into the marks row. A
 * proposal a teacher has to *choose* is reviewed; a proposal already sitting
 * in the box is rubber-stamped.
 */
function markingPanel(q: Question, row: GradedAnswer | undefined): string {
  if (q.type !== "long") return "";
  if (!row) {
    return `<p class="hint mk-none">Nothing was handed in for this question, so there is
      nothing to mark.</p>`;
  }
  const marked = row.status === "marked" && typeof row.awarded === "number";
  const ai = typeof row.aiAwarded === "number" ? row.aiAwarded : null;
  return `
    <div class="mk">
      ${
        ai !== null
          ? `<div class="mk-ai">
               <div class="mk-ai-head">
                 <span class="mk-ai-badge">AI</span>
                 <span class="mk-ai-mark">suggests ${ai} / ${row.maxMarks}</span>
                 <span class="ed-spacer"></span>
                 <button class="btn-link" id="mk-use">Use this mark</button>
               </div>
               ${row.aiReasoning ? `<p class="mk-ai-why">${escapeHtml(row.aiReasoning)}</p>` : ""}
               ${row.aiComment ? `<p class="mk-ai-say">For the student: “${escapeHtml(row.aiComment)}”</p>` : ""}
               <p class="mk-ai-foot">A suggestion, not a mark. Nothing reaches
                 ${escapeHtml(row.studentName || row.username)} until you save one.</p>
             </div>`
          : aiOff
            ? ""
            : `<button class="btn btn-ghost mk-assess" id="mk-assess">Assess with AI</button>`
      }
      <div class="mk-award">
        <div class="section-label">Award marks</div>
        <div class="mk-row" id="mk-buttons">
          ${Array.from({ length: row.maxMarks + 1 })
            .map(
              (_, n) =>
                `<button type="button" class="mbtn${
                  marked && row.awarded === n ? " chosen" : ""
                }" data-award="${n}">${n}</button>`
            )
            .join("")}
          <span class="mof">out of ${row.maxMarks}</span>
        </div>
        <textarea id="mk-comment" class="ta" rows="2"
                  placeholder="Comment for ${escapeHtml(row.studentName || row.username)} (optional)…">${escapeHtml(row.comment || "")}</textarea>
        <div class="mk-foot">
          <button type="button" class="btn btn-primary" id="mk-save" disabled>${
            marked ? "Update mark" : "Save mark"
          }</button>
          <span class="ed-hint" id="mk-state">${
            marked ? `Marked ${row.awarded}/${row.maxMarks}` : "Not marked yet"
          }${creditNote ? ` · ${escapeHtml(creditNote)}` : ""}</span>
        </div>
      </div>
    </div>`;
}

/**
 * The review. `showReviewFor` in test.ts forwards a parent here with `back`
 * and the child's username; a student's own review passes neither.
 */
export async function showReview(
  test: Test,
  attempt: Attempt,
  opts: ReviewOpts = {}
): Promise<void> {
  // Teachers and admins own the content, and a guest on the demo has no
  // teacher to release anything. Only a real student's paper is held back.
  const viewerIsStudent = isLoggedIn() && getProfile()?.kind === "student";
  // Release is the teacher's own switch, so it can never hide a paper from
  // them: a teacher marking the class needs to see what was answered *before*
  // deciding to open it. Only the student and their parent wait.
  const gated = !isTeacher() && (viewerIsStudent || !!opts.student);
  // `open` is the whole difference between the two things this screen is:
  //   false — a handed-in paper, read-only. What they put down, and nothing
  //           else: no verdict, no marks, no correct answer, no explanation,
  //           no retake. The teacher has not released it yet.
  //   true  — the result. Marks, correct answers, worked solutions, retake.
  // A blank page used to stand in for the first of these, which left a student
  // with no way to see what they had handed in.
  const open = gated ? await fetchReleased(test.id, opts.student) : true;

  owner = opts.student ? `${opts.studentName || opts.student}'s` : "Your";

  // Marking needs the grading rows themselves, not just the merged marks: the
  // AI's proposal, the photos and the teacher's own comment all live there.
  // One fetch, before the first paint.
  rows = new Map();
  if (opts.marking && opts.student) {
    for (const row of await fetchGrading({ testId: test.id, student: opts.student })) {
      rows.set(row.questionId, row);
    }
  }

  const wanted = new URLSearchParams(location.search).get("review");
  let index = Math.max(0, test.questions.findIndex((q) => q.id === wanted));

  const render = (): void => {
    const q = test.questions[index];
    const a = attempt.answers[q.id];
    if (!opts.student) setUrl({ test: test.id, review: q.id });

    mount(
      `
      <div class="editor ed-readonly ed-paper">
        <div class="ed-cols review-item${open ? "" : " overview"}">
          ${treeMarkup(test, attempt, index, open)}
          <div class="ed-center">
            <div class="ed-crumbrow">
              ${
                opts.back
                  ? `<button class="ed-crumb-back" id="review-back" aria-label="Back" title="Back">${ICONS.back}</button>`
                  : ""
              }
              ${drawerToggleMarkup()}
              <span class="ed-spacer"></span>
              ${
                opts.marking
                  ? `<button id="mk-release" class="btn btn-ghost st-handin" disabled>Release…</button>`
                  : ""
              }
              ${
                open && !opts.marking && !opts.student
                  ? `<button id="retake-btn" class="btn btn-primary st-handin">Retake<span class="st-long"> test</span></button>`
                  : ""
              }
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
                  <span class="ed-panel-label">${escapeHtml(owner)} answer</span>
                  <div class="ed-spacer"></div>
                  ${marksChip(q, a, open)}
                </div>
                <p class="review-given">${describeGiven(q, a)}</p>
                ${open ? correctLine(q, a) : ""}
                ${photoStrip(a?.images ?? [], "Handed-in working")}
                ${opts.marking ? markingPanel(q, rows.get(q.id)) : ""}
                ${
                  open && a?.review === "marked" && a.comment
                    ? `<p class="review-comment"><strong>${
                        opts.student ? "Teacher" : "Your teacher"
                      }:</strong> ${escapeHtml(a.comment)}</p>`
                    : ""
                }
                ${
                  open
                    ? ""
                    : `<p class="hint quiet-note">${ICONS.lock} Handed in. Your marks, the correct
                       answers and the worked solutions appear here once your teacher releases
                       them — usually after the whole class has sat the test.</p>`
                }
                <div class="st-navrow">
                  <button class="btn btn-ghost st-step" id="rv-prev"${index === 0 ? " disabled" : ""}>‹ Previous</button>
                  <span class="ed-hint st-count">${index + 1} of ${test.questions.length}</span>
                  <span class="ed-spacer"></span>
                  <button class="btn btn-ghost st-step" id="rv-next"${index === test.questions.length - 1 ? " disabled" : ""}>Next ›</button>
                </div>
              </section>
            </div>
          </div>
          ${
            open
              ? `<aside class="ed-explain">
            <section class="ed-panel">
              <div class="ed-panel-head"><span class="ed-panel-label">Explanation</span></div>
              <div class="solution">${formatText(q.solution)}</div>
            </section>
          </aside>`
              : ""
          }
        </div>
        <div class="ed-scrim"></div>
      </div>`,
      { title: test.title, sub: test.chapter || "", active: "results", full: true, scroll: "page" }
    );

    document.getElementById("rv-tree")!.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
      if (!btn) return;
      index = Number(btn.dataset.i);
      render();
    });
    document.getElementById("rv-prev")!.addEventListener("click", () => {
      if (index > 0) { index -= 1; render(); }
    });
    document.getElementById("rv-next")!.addEventListener("click", () => {
      if (index < test.questions.length - 1) { index += 1; render(); }
    });
    bindTreeDrawer(document.querySelector<HTMLElement>(".editor")!);
    document.getElementById("review-back")?.addEventListener("click", opts.back ?? (() => {}));
    document.getElementById("retake-btn")?.addEventListener("click", () => {
      track("test_retake", { test: test.id });
      clearAttempt(test.id);
      setUrl({ test: test.id });
      startTest(test, newAttempt());
    });

    if (opts.marking) {
      bindMarking(test.questions[index], render);
      void bindRelease(test.id, opts.student || "");
    }

    renderMath(app);
    void hydrateThumbs(app);
  };

  render();

  // Marks the teacher has awarded since this device last looked. Only worth
  // asking once the paper is open — while it is shut nothing on screen would
  // change, and a student refreshing a closed paper should not cost a fetch.
  if (open) {
    void hydrateMarks(test, attempt, opts.student).then((changed) => {
      if (changed && document.querySelector(".ed-readonly")) render();
    });
  }
}
