// Test player: landing, per-test login gate, question flow, score, review.

import { track } from "../analytics";
import {
  authEnabled,
  fetchMyAttempt,
  isLoggedIn,
  renderGoogleButton,
  saveProgress,
  submitAttempt,
} from "../auth";
import {
  clearAttempt,
  loadAttempt,
  newAttempt,
  requiresLogin,
  saveAttempt,
  setGuest,
} from "../attempts";
import { totalMarks } from "../data";
import { app, escapeHtml, formatText, renderMath, setUrl } from "../dom";
import { mount } from "../shell";
import type { Attempt, Question, StoredAnswer, Test } from "../types";
import { showPhoneForm } from "./auth";

function showLogin(test: Test) {
  track("login_open", { test: test.id });
  mount(
    `
    <main class="card landing">
      <div class="chip chip-topic">${escapeHtml(test.chapter)}</div>
      <h2 class="landing-title">${escapeHtml(test.title)}</h2>
      <p class="hint">Sign in once with Google to take this test — your scores
      are saved to your profile and follow you on any device.</p>
      <div id="google-btn" class="google-btn-slot"></div>
      <p id="login-error" class="login-error" hidden></p>
      <p class="hint">Just exploring? Try the free demo test from the
      <a href="./">home page</a> — no sign-in needed.</p>
    </main>`,
    { title: test.title, active: "subjects", width: "narrow" }
  );
  const slot = document.getElementById("google-btn")!;
  const errEl = document.getElementById("login-error") as HTMLElement;
  void renderGoogleButton(
    slot,
    (profile) => {
      track("login_success", { test: test.id });
      setGuest(false);
      if (!profile.phone) showPhoneForm(() => showLanding(test));
      else showLanding(test);
    },
    (message) => {
      errEl.textContent = message;
      errEl.hidden = false;
    }
  );
}

export function showLanding(test: Test) {
  // The one screen with a URL worth keeping — this is the link teachers share.
  setUrl({ test: test.id });
  if (requiresLogin(test)) {
    showLogin(test);
    return;
  }
  const attempt = loadAttempt(test.id);
  // A finished test opens straight into read-only review — the landing card
  // has nothing left to offer once there is a score to look at.
  if (attempt?.completed) {
    showReview(test, attempt);
    return;
  }
  // Nothing here, but it may have been started or finished on another device.
  if (!attempt && authEnabled && isLoggedIn()) void resumeFromServer(test);
  const total = totalMarks(test);
  const counts = {
    mcq: test.questions.filter((q) => q.type === "mcq").length,
    numeric: test.questions.filter((q) => q.type === "numeric").length,
    long: test.questions.filter((q) => q.type === "long").length,
  };

  let primary: { label: string; action: () => void };
  let secondary = "";

  if (attempt?.completed) {
    primary = {
      label: "Review my answers",
      action: () => {
        track("review_open", { test: test.id });
        showReview(test, attempt);
      },
    };
    secondary = `<button id="retake-btn" class="btn btn-ghost">Retake test</button>`;
  } else if (attempt && attempt.index > 0) {
    primary = {
      label: `Continue — Question ${attempt.index + 1} of ${test.questions.length}`,
      action: () => {
        track("test_resume", { test: test.id, at: attempt.index });
        showQuestion(test, attempt);
      },
    };
    secondary = `<button id="retake-btn" class="btn btn-ghost">Start over</button>`;
  } else {
    primary = {
      label: "Start test",
      action: () => {
        track("test_start", { test: test.id });
        showQuestion(test, newAttempt());
      },
    };
  }

  mount(
    `
    <main class="card landing">
      <div class="chip chip-topic">${escapeHtml(test.chapter)}</div>
      <h2 class="landing-title">${escapeHtml(test.title)}</h2>
      ${test.teacher ? `<p class="landing-teacher">Curated by ${escapeHtml(test.teacher)}</p>` : ""}
      <ul class="landing-facts">
        <li><strong>${test.questions.length}</strong> questions · <strong>${total}</strong> marks</li>
        <li>${counts.mcq} MCQ · ${counts.numeric} numeric · ${counts.long} long answer</li>
        <li>Instant solutions after every question</li>
        <li>Your progress is saved on this phone — close and come back any time</li>
      </ul>
      <div class="actions">
        <button id="primary-btn" class="btn btn-primary">${primary.label}</button>
        ${secondary}
      </div>
    </main>`,
    { title: test.title, active: "subjects", width: "narrow" }
  );

  document.getElementById("primary-btn")!.addEventListener("click", primary.action);
  document.getElementById("retake-btn")?.addEventListener("click", () => {
    track("test_retake", { test: test.id });
    clearAttempt(test.id);
    showQuestion(test, newAttempt());
  });
}

function showQuestion(test: Test, attempt: Attempt) {
  const index = attempt.index;
  const q = test.questions[index];
  const pct = (index / test.questions.length) * 100;

  mount(
    `
    <div class="progress">
      <div class="progress-label">${escapeHtml(test.title)} — Question ${index + 1} of ${test.questions.length}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>
    <main class="card">
      <div class="meta">
        <span class="chip chip-topic">${escapeHtml(q.topic)}</span>
        <span class="chip chip-marks">${q.marks} mark${q.marks > 1 ? "s" : ""}</span>
      </div>
      <div class="question-text">${formatText(q.q)}</div>
      <div id="answer-area"></div>
      <div id="feedback"></div>
      <div class="actions" id="actions"></div>
    </main>`,
    { title: test.title, active: "subjects", width: "narrow" }
  );

  const answerArea = document.getElementById("answer-area")!;
  const actions = document.getElementById("actions")!;

  if (q.type === "mcq") {
    answerArea.innerHTML = `
      <div class="options">
        ${q.options!
          .map(
            (opt, i) => `
          <button class="option" data-i="${i}">
            <span class="option-letter">${String.fromCharCode(65 + i)}</span>
            <span class="option-text">${escapeHtml(opt)}</span>
          </button>`
          )
          .join("")}
      </div>`;
    let selected = -1;
    answerArea.querySelectorAll<HTMLButtonElement>(".option").forEach((btn) => {
      btn.addEventListener("click", () => {
        answerArea
          .querySelectorAll(".option")
          .forEach((b) => b.classList.remove("selected"));
        btn.classList.add("selected");
        selected = Number(btn.dataset.i);
        (document.getElementById("submit-btn") as HTMLButtonElement).disabled = false;
      });
    });
    actions.innerHTML = `<button id="submit-btn" class="btn btn-primary" disabled>Submit</button>`;
    document.getElementById("submit-btn")!.addEventListener("click", () => {
      const correct = selected === q.answer;
      answerArea.querySelectorAll<HTMLButtonElement>(".option").forEach((b) => {
        b.disabled = true;
        const i = Number(b.dataset.i);
        if (i === q.answer) b.classList.add("correct");
        else if (i === selected && !correct) b.classList.add("incorrect");
      });
      finishQuestion(test, attempt, q, correct, selected);
    });
  } else if (q.type === "numeric") {
    answerArea.innerHTML = `
      <input id="numeric-input" class="numeric-input" type="number" step="any"
             inputmode="decimal" placeholder="Enter your answer" />`;
    actions.innerHTML = `<button id="submit-btn" class="btn btn-primary" disabled>Submit</button>`;
    const input = document.getElementById("numeric-input") as HTMLInputElement;
    const submit = document.getElementById("submit-btn") as HTMLButtonElement;
    input.addEventListener("input", () => {
      submit.disabled = input.value.trim() === "";
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !submit.disabled) submit.click();
    });
    submit.addEventListener("click", () => {
      const val = parseFloat(input.value);
      const tol = q.tolerance ?? 0;
      const correct = Number.isFinite(val) && Math.abs(val - q.answer!) <= tol;
      input.disabled = true;
      input.classList.add(correct ? "correct" : "incorrect");
      finishQuestion(test, attempt, q, correct, val);
    });
  } else {
    // long: attempt on paper, reveal the model solution, self-assess
    answerArea.innerHTML = `
      <p class="hint">Work this out on paper, then reveal the solution and mark yourself honestly.</p>`;
    actions.innerHTML = `<button id="reveal-btn" class="btn btn-primary">Show solution</button>`;
    document.getElementById("reveal-btn")!.addEventListener("click", () => {
      showSolution(q);
      actions.innerHTML = `
        <button id="self-right" class="btn btn-success">I got it right</button>
        <button id="self-wrong" class="btn btn-danger">I got it wrong</button>`;
      document.getElementById("self-right")!.addEventListener("click", () =>
        recordAndNext(test, attempt, q, true, 1, false)
      );
      document.getElementById("self-wrong")!.addEventListener("click", () =>
        recordAndNext(test, attempt, q, false, 0, false)
      );
    });
  }

  renderMath(app);
}

function showSolution(q: Question) {
  const feedback = document.getElementById("feedback")!;
  feedback.insertAdjacentHTML(
    "beforeend",
    `<div class="solution">
       <div class="solution-title">Solution</div>
       ${formatText(q.solution)}
     </div>`
  );
  renderMath(feedback);
}

function finishQuestion(
  test: Test,
  attempt: Attempt,
  q: Question,
  correct: boolean,
  given: number
) {
  const feedback = document.getElementById("feedback")!;
  feedback.innerHTML = `
    <div class="verdict ${correct ? "verdict-correct" : "verdict-incorrect"}">
      ${correct ? "✓ Correct" : "✗ Incorrect"} · ${correct ? `+${q.marks}` : "0"} / ${q.marks} marks
    </div>`;
  showSolution(q);
  recordAndNext(test, attempt, q, correct, given, true);
}

function recordAndNext(
  test: Test,
  attempt: Attempt,
  q: Question,
  correct: boolean,
  given: number,
  waitForNext: boolean
) {
  attempt.answers[q.id] = { given, correct, earned: correct ? q.marks : 0 };
  if (correct) attempt.score += q.marks;
  attempt.index += 1;
  track("question_answered", {
    test: test.id,
    question: q.id,
    correct,
  });

  const advance = () => {
    if (attempt.index < test.questions.length) showQuestion(test, attempt);
    else {
      attempt.completed = true;
      attempt.completedAt = new Date().toISOString();
      saveAttempt(test.id, attempt);
      track("test_complete", {
        test: test.id,
        score: attempt.score,
        total: totalMarks(test),
      });
      submitAttempt({
        testId: test.id,
        score: attempt.score,
        total: totalMarks(test),
        completedAt: attempt.completedAt!,
        // Carried so review works on a device that never held this attempt.
        answers: JSON.stringify(attempt.answers),
      });
      showScore(test, attempt);
      return;
    }
  };

  saveAttempt(test.id, attempt);
  // Saved after every answer, not only at the end: a student who closes the
  // tab here picks up where they left off, on this device or another.
  if (!attempt.completed) {
    saveProgress({
      testId: test.id,
      answers: JSON.stringify(attempt.answers),
      index: attempt.index,
      score: attempt.score,
      total: totalMarks(test),
    });
  }

  if (waitForNext) {
    const actions = document.getElementById("actions")!;
    actions.innerHTML = `<button id="next-btn" class="btn btn-primary">
      ${attempt.index < test.questions.length ? "Next question" : "See my score"}
    </button>`;
    document.getElementById("next-btn")!.addEventListener("click", advance);
    document
      .getElementById("next-btn")!
      .scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    advance();
  }
}

function showScore(test: Test, attempt: Attempt) {
  const total = totalMarks(test);
  const pct = Math.round((attempt.score / total) * 100);
  const message =
    pct >= 80
      ? "Excellent work! 🎉"
      : pct >= 50
        ? "Good effort — keep practising!"
        : "Keep at it — review the solutions and try again.";
  mount(
    `
    <main class="card score-card">
      <div class="score-big">${attempt.score} / ${total}</div>
      <div class="score-pct">${pct}%</div>
      <p class="score-message">${message}</p>
      <ul class="score-breakdown">
        ${test.questions
          .map((q, i) => {
            const a = attempt.answers[q.id];
            const ok = a?.correct ?? false;
            return `<li class="${ok ? "row-correct" : "row-incorrect"}">
              <span>${ok ? "✓" : "✗"} Q${i + 1} · ${escapeHtml(q.topic)}</span>
              <span>${a?.earned ?? 0}/${q.marks}</span>
            </li>`;
          })
          .join("")}
      </ul>
      <p class="hint">Your result is saved on this phone — open this link again any time to review the questions and solutions.</p>
      <div class="actions">
        <button id="review-btn" class="btn btn-primary">Review answers</button>
        <button id="restart-btn" class="btn btn-ghost">Try again</button>
      </div>
    </main>`,
    { title: test.title, active: "subjects", width: "narrow" }
  );
  document.getElementById("review-btn")!.addEventListener("click", () => {
    track("review_open", { test: test.id });
    showReview(test, attempt);
  });
  document.getElementById("restart-btn")!.addEventListener("click", () => {
    track("test_retake", { test: test.id });
    clearAttempt(test.id);
    showQuestion(test, newAttempt());
  });
}

function describeGiven(q: Question, a: StoredAnswer | undefined): string {
  if (!a) return "Not answered";
  if (q.type === "mcq") {
    const i = a.given ?? -1;
    const letter = i >= 0 ? String.fromCharCode(65 + i) : "?";
    return `Your answer: <strong>${letter}.</strong> ${escapeHtml(q.options?.[i] ?? "")}`;
  }
  if (q.type === "numeric") return `Your answer: <strong>${a.given}</strong>`;
  return a.correct ? "Self-assessed: got it right" : "Self-assessed: got it wrong";
}

/**
 * Pull this student's work on the server: a finished attempt becomes the
 * review, an unfinished one becomes a Continue. The landing renders first so
 * the common case — a test they have never opened — is not held up by a fetch.
 */
async function resumeFromServer(test: Test): Promise<void> {
  const { attempt: done, progress } = await fetchMyAttempt(test.id);
  // Still on the same screen? A slow fetch must not yank a student out of a
  // test they have since started.
  if (loadAttempt(test.id)) return;

  if (done?.answers && done.completedAt) {
    const attempt: Attempt = {
      answers: done.answers,
      index: test.questions.length,
      completed: true,
      score: done.score,
      completedAt: done.completedAt,
      updatedAt: done.completedAt,
    };
    saveAttempt(test.id, attempt);
    showReview(test, attempt);
    return;
  }

  if (progress?.answers && progress.index > 0 && progress.index < test.questions.length) {
    const score = Object.values(progress.answers).reduce((n, a) => n + (a?.earned ?? 0), 0);
    const attempt: Attempt = {
      answers: progress.answers,
      index: progress.index,
      completed: false,
      score,
      updatedAt: progress.updatedAt || new Date().toISOString(),
    };
    saveAttempt(test.id, attempt);
    // Re-render the landing, which now offers Continue at the right question.
    showLanding(test);
  }
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

/**
 * Read-only review of someone else's attempt — what a parent sees. Same
 * screen, minus every control that would write to their child's record.
 */
export function showReviewFor(test: Test, attempt: Attempt, back: () => void): void {
  showReview(test, attempt, back);
}

function showReview(test: Test, attempt: Attempt, viewerBack?: () => void) {
  const total = totalMarks(test);
  mount(
    `
    <main>
      <div class="review-header card">
        <h2 class="landing-title">${escapeHtml(test.title)} — Review</h2>
        <div class="score-big score-big-small">${attempt.score} / ${total}</div>
      </div>
      ${test.questions
        .map((q, i) => {
          const a = attempt.answers[q.id];
          const ok = a?.correct ?? false;
          return `
        <div class="card review-item">
          <div class="meta">
            <span class="chip">${i + 1}</span>
            <span class="chip chip-topic">${escapeHtml(q.topic)}</span>
            <span class="status-chip ${ok ? "status-done" : "status-wrong"}">${ok ? `✓ ${a?.earned ?? 0}` : "✗ 0"}/${q.marks}</span>
          </div>
          <div class="question-text">${formatText(q.q)}</div>
          <p class="review-given">${describeGiven(q, a)}</p>
          ${correctLine(q, a)}
          <div class="solution">
            <div class="solution-title">Solution</div>
            ${formatText(q.solution)}
          </div>
        </div>`;
        })
        .join("")}
      <div class="actions">
        ${
          viewerBack
            ? `<button id="review-back" class="btn btn-ghost">Back</button>`
            : `<button id="retake-btn" class="btn btn-primary">Retake test</button>`
        }
      </div>
    </main>`,
    { title: test.title, active: "subjects", width: "narrow" }
  );
  document.getElementById("review-back")?.addEventListener("click", viewerBack ?? (() => {}));
  document.getElementById("retake-btn")?.addEventListener("click", () => {
    track("test_retake", { test: test.id });
    clearAttempt(test.id);
    showQuestion(test, newAttempt());
  });
  renderMath(app);
  window.scrollTo(0, 0);
}
