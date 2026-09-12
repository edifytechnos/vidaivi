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
import { fetchReleased, getProfile, isLoggedIn } from "../auth";
import { clearAttempt, newAttempt } from "../attempts";
import { totalMarks } from "../data";
import { app, escapeHtml, formatText, ICONS, renderMath, setUrl } from "../dom";
import { mount } from "../shell";
import type { Attempt, Question, StoredAnswer, Test } from "../types";
import { hydrateMarks, startTest } from "./test";

export interface ReviewOpts {
  /** Viewer mode (a parent): where Back goes. Retake is hidden. */
  back?: () => void;
  /** Whose paper this is, when the viewer is not the student themselves. */
  student?: string;
}

/** What the student put down. */
function describeGiven(q: Question, a: StoredAnswer | undefined): string {
  if (!a) return "Not answered";
  if (q.type === "mcq") {
    const i = a.given ?? -1;
    const letter = i >= 0 ? String.fromCharCode(65 + i) : "?";
    return `Your answer: <strong>${letter}.</strong> ${escapeHtml(q.options?.[i] ?? "")}`;
  }
  if (q.type === "numeric") return `Your answer: <strong>${a.given}</strong>`;
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

function marksChip(q: Question, a: StoredAnswer | undefined): string {
  if (a?.review === "pending") {
    return `<span class="status-chip status-progress">Awaiting review</span>`;
  }
  const ok = a?.correct ?? false;
  return `<span class="status-chip ${ok ? "status-done" : "status-wrong"}">${ok ? `✓ ${a?.earned ?? 0}` : "✗ 0"}/${q.marks}</span>`;
}

function treeMarkup(test: Test, attempt: Attempt, selected: number): string {
  const rows = test.questions
    .map((q, i) => {
      const a = attempt.answers[q.id];
      const pending = a?.review === "pending";
      const ok = a?.correct ?? false;
      const state = pending ? "pending" : ok ? "done" : "wrong";
      return `
        <div class="ed-tree-row">
          <button class="ed-tree-q${i === selected ? " active" : ""}" data-i="${i}">
            <span class="rv-dot rv-${state}">${pending ? "…" : ok ? "✓" : "✗"}</span>
            <span class="ed-tree-name">${i + 1}. ${escapeHtml(q.topic)}</span>
            <span class="ed-tree-marks">${pending ? `—/${q.marks}` : `${a?.earned ?? 0}/${q.marks}`}</span>
          </button>
        </div>`;
    })
    .join("");

  return `
    <aside class="ed-tree" id="rv-tree">
      <div class="ed-tree-head"><span class="ed-tree-title">Your answers</span></div>
      <div class="ed-tree-body">
        <div class="ed-node open">
          <div class="ed-node-head">
            <span class="ed-tree-test">
              <span class="ed-tree-name">${escapeHtml(test.title)}</span>
              <span class="status-chip status-done">${attempt.score}/${totalMarks(test)}</span>
            </span>
          </div>
          <div class="ed-tree-questions">${rows}</div>
        </div>
      </div>
    </aside>`;
}

function lockedMarkup(test: Test): string {
  return `
    <main class="card locked-page">
      <div class="locked">
        ${ICONS.lock}
        <span class="locked-title">Your teacher has not opened this paper yet</span>
        <span class="locked-hint">You handed in ${escapeHtml(test.title)} and your marks are
        saved. The answers and worked solutions appear here once your teacher releases
        them — usually after the whole class has sat the test.</span>
      </div>
    </main>`;
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
  const gated = viewerIsStudent || !!opts.student;
  const released = gated ? await fetchReleased(test.id, opts.student) : true;

  if (!released) {
    mount(lockedMarkup(test), {
      title: test.title,
      sub: "Handed in",
      active: "results",
      width: "narrow",
    });
    document.getElementById("review-back")?.addEventListener("click", opts.back ?? (() => {}));
    return;
  }

  const wanted = new URLSearchParams(location.search).get("review");
  let index = Math.max(0, test.questions.findIndex((q) => q.id === wanted));

  const render = (): void => {
    const q = test.questions[index];
    const a = attempt.answers[q.id];
    if (!opts.student) setUrl({ test: test.id, review: q.id });

    mount(
      `
      <div class="editor ed-readonly" data-pane="question">
        <div class="ed-cols review-item">
          ${treeMarkup(test, attempt, index)}
          <div class="ed-center">
            <div class="ed-crumbrow">
              <span class="ed-crumb-mid">
                <span class="ed-crumb-test">${escapeHtml(test.title)}</span>
                <span class="ed-crumb-sep">›</span>
              </span>
              <span class="ed-crumb-current">Question ${index + 1} of ${test.questions.length}</span>
              <span class="ed-spacer"></span>
              ${
                opts.back
                  ? `<button id="review-back" class="btn btn-ghost st-handin">Back</button>`
                  : `<button id="retake-btn" class="btn btn-primary st-handin">Retake<span class="st-long"> test</span></button>`
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
                  <span class="ed-panel-label">Your answer</span>
                  <div class="ed-spacer"></div>
                  ${marksChip(q, a)}
                </div>
                <p class="review-given">${describeGiven(q, a)}</p>
                ${correctLine(q, a)}
                ${photoStrip(a?.images ?? [], "Handed-in working")}
                ${
                  a?.review === "marked" && a.comment
                    ? `<p class="review-comment"><strong>Your teacher:</strong> ${escapeHtml(a.comment)}</p>`
                    : ""
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
          <aside class="ed-explain">
            <section class="ed-panel">
              <div class="ed-panel-head"><span class="ed-panel-label">Explanation</span></div>
              <div class="solution">${formatText(q.solution)}</div>
            </section>
          </aside>
        </div>
        <div class="ed-tabs">
          <button class="ed-tab active" data-pane="question">Question</button>
          <button class="ed-tab" data-pane="answer">Your answer</button>
          <button class="ed-tab" data-pane="explain">Explanation</button>
        </div>
      </div>`,
      { title: test.title, sub: "Review", active: "results", full: true }
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
    document.querySelector(".ed-tabs")!.addEventListener("click", (e) => {
      const tab = (e.target as HTMLElement).closest<HTMLElement>("[data-pane]");
      if (!tab) return;
      document.querySelector(".editor")!.setAttribute("data-pane", tab.dataset.pane!);
      document.querySelectorAll(".ed-tab").forEach((t) => t.classList.toggle("active", t === tab));
    });
    document.getElementById("review-back")?.addEventListener("click", opts.back ?? (() => {}));
    document.getElementById("retake-btn")?.addEventListener("click", () => {
      track("test_retake", { test: test.id });
      clearAttempt(test.id);
      setUrl({ test: test.id });
      startTest(test, newAttempt());
    });

    renderMath(app);
    void hydrateThumbs(app);
  };

  render();

  // Marks the teacher has awarded since this device last looked.
  void hydrateMarks(test, attempt, opts.student).then((changed) => {
    if (changed && document.querySelector(".ed-readonly")) render();
  });
}
