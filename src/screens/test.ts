// Test player: landing, per-test login gate, question flow, score, review.

import { track } from "../analytics";
import {
  authEnabled,
  fetchGrading,
  fetchMyAttempt,
  getProfile,
  isLoggedIn,
  renderGoogleButton,
  saveProgress,
  submitAttempt,
} from "../auth";
import { mountUploader } from "../answerphotos";
import {
  clearAttempt,
  loadAttempt,
  newAttempt,
  requiresLogin,
  saveAttempt,
  setGuest,
} from "../attempts";
import { totalMarks } from "../data";
import { app, escapeHtml, formatText, ICONS, renderMath, setUrl } from "../dom";
import { mount } from "../shell";
import { showReview } from "./review";
import type { Attempt, Question, StoredAnswer, Test } from "../types";
import { showPhoneForm } from "./auth";
import { showAttempt } from "./student";

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
  // Read the address bar before touching it: setUrl below drops every
  // parameter but ?test=, and ?q= is what says where a student was.
  const onQuestion = new URLSearchParams(location.search).get("q");
  // The one screen with a URL worth keeping — this is the link teachers share.
  setUrl({ test: test.id });
  if (requiresLogin(test)) {
    showLogin(test);
    return;
  }
  const attempt = loadAttempt(test.id);
  // A student refreshing mid-test lands back on the question they were on.
  // The landing card has nothing to offer someone already part-way through:
  // their work is in the workspace, and ?q= says which question.
  if (onQuestion && canHandIn() && attempt && !attempt.completed) {
    // setUrl above has already dropped ?q=, so hand the position over rather
    // than leaving showAttempt to read an address bar we just rewrote.
    const at = test.questions.findIndex((qq) => qq.id === onQuestion);
    showAttempt(test, attempt, at < 0 ? 0 : at);
    return;
  }
  // A finished test opens straight into read-only review — the landing card
  // has nothing left to offer once there is a score to look at.
  if (attempt?.completed) {
    void showReview(test, attempt);
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
        void showReview(test, attempt);
      },
    };
    secondary = `<button id="retake-btn" class="btn btn-ghost">Retake test</button>`;
  } else if (attempt && attempt.index > 0) {
    primary = {
      label: `Continue — Question ${attempt.index + 1} of ${test.questions.length}`,
      action: () => {
        track("test_resume", { test: test.id, at: attempt.index });
        startTest(test, attempt);
      },
    };
    secondary = `<button id="retake-btn" class="btn btn-ghost">Start over</button>`;
  } else {
    primary = {
      label: "Start test",
      action: () => {
        track("test_start", { test: test.id });
        startTest(test, newAttempt());
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
        <li>${
          canHandIn()
            ? "Answers and worked solutions open when your teacher releases them"
            : "Instant solutions after every question"
        }</li>
        <li>${
          canHandIn()
            ? "Your work is saved as you go — close and come back on any device"
            : "Your progress is saved on this phone — close and come back any time"
        }</li>
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
    startTest(test, newAttempt());
  });
}

/**
 * Which player. A signed-in student sits the test in the workspace — the tree
 * of questions beside one question at a time, answerable in any order. A guest
 * on the demo keeps the linear player below, because the demo's whole value is
 * the instant verdict and solution after each question.
 */
export function startTest(test: Test, attempt: Attempt): void {
  if (canHandIn()) showAttempt(test, attempt);
  else showQuestion(test, attempt);
}

export function showQuestion(test: Test, attempt: Attempt) {
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
        ${q.source ? `<span class="chip chip-source">${escapeHtml(q.source)}</span>` : ""}
      </div>
      <div class="question-text">${formatText(q.q)}</div>
      <div id="answer-area"></div>
      <div id="feedback"></div>
      <div class="actions" id="actions"></div>
      ${
        canHandIn()
          ? `<p class="hint quiet-note">${ICONS.lock} Answers and explanations open when your
             teacher releases them. Your work is saved as you go.</p>`
          : ""
      }
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
  } else if (canHandIn()) {
    // long, signed in as a student: work on paper, hand in a photo, and the
    // teacher awards the marks. Nothing here is auto-graded.
    answerArea.innerHTML = `
      <div class="note">
        ${ICONS.mark}
        <span><strong>Your teacher marks this one.</strong> Work it out on paper,
        then add a photo so they can see your method. The marks appear once they
        have reviewed it.</span>
      </div>
      <div class="section-label">Your working</div>
      <div id="uploader"></div>
      `;
    const readImages = mountUploader(document.getElementById("uploader")!, {
      testId: test.id,
      testTitle: test.title,
      questionId: q.id,
      questionIndex: index,
      maxMarks: q.marks,
      initial: attempt.answers[q.id]?.images ?? [],
      onChange: () => {},
    });
    actions.innerHTML = `<button id="handin-btn" class="btn btn-primary">Hand in answer</button>`;
    actions.insertAdjacentHTML(
      "afterend",
      `<p class="hint" id="handin-note">No photo? You can still hand in — but there
       is nothing for your teacher to mark, so this question scores 0.</p>`
    );
    document.getElementById("handin-btn")!.addEventListener("click", () => {
      const images = readImages();
      recordAndNext(test, attempt, q, false, images.length ? 1 : 0, false, {
        images,
        review: images.length ? "pending" : undefined,
      });
    });
  } else {
    // long, without a student sign-in (the guest demo, or a teacher previewing
    // their own test): no one is going to mark this, so keep the honour system.
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
  // A signed-in student is sitting a test, not drilling: nothing comes back.
  // No verdict, no correct answer, no worked solution — their teacher decides
  // when the paper opens. A guest on the demo has no teacher, so they keep the
  // instant feedback that makes the demo worth sharing.
  if (canHandIn()) {
    recordAndNext(test, attempt, q, correct, given, false);
    return;
  }
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
  waitForNext: boolean,
  extra?: Partial<StoredAnswer>
) {
  attempt.answers[q.id] = {
    given,
    correct,
    earned: correct ? q.marks : 0,
    ...extra,
  };
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

/**
 * Can this person actually hand work in? Only a signed-in student has a
 * teacher to mark it. A guest on the demo, or a teacher previewing their own
 * test, keeps the old self-assessment — there is nobody to mark theirs.
 */
export function canHandIn(): boolean {
  return isLoggedIn() && getProfile()?.kind === "student";
}

/** Marks still with the teacher, and what they are worth. */
function pendingMarks(test: Test, attempt: Attempt): { count: number; marks: number } {
  let count = 0;
  let marks = 0;
  for (const q of test.questions) {
    if (attempt.answers[q.id]?.review === "pending") {
      count++;
      marks += q.marks;
    }
  }
  return { count, marks };
}

/**
 * Fold the teacher's marks into a local attempt. The attempt row on the
 * server keeps only the auto-graded score; awarded marks live in their own
 * rows, so they are merged in on read. Returns true if anything changed.
 */
export async function hydrateMarks(
  test: Test,
  attempt: Attempt,
  student?: string
): Promise<boolean> {
  // Only a student's own paper, or a named student's, has marks to fetch. A
  // teacher previewing their own test has nobody to ask about, and asking
  // anyway earns a 403 on every open.
  if (!student && !canHandIn()) return false;
  const rows = await fetchGrading({ testId: test.id, student });
  if (!rows.length) return false;
  let changed = false;
  for (const row of rows) {
    const a = attempt.answers[row.questionId];
    if (!a) continue;
    if (row.images.length && (a.images ?? []).join() !== row.images.join()) {
      a.images = row.images;
      changed = true;
    }
    if (row.status === "marked" && a.review !== "marked") {
      const awarded = row.awarded ?? 0;
      attempt.score += awarded - a.earned;
      a.earned = awarded;
      a.correct = awarded > 0;
      a.review = "marked";
      a.comment = row.comment;
      changed = true;
    }
  }
  if (changed && !student) saveAttempt(test.id, attempt);
  return changed;
}

/**
 * The guest's score screen, and only the guest's. A signed-in student never
 * lands here: they hand the paper in and go back to their subject, because a
 * mark is the teacher's to give and a number on the way out would be a
 * half-truth while every long answer is unmarked. The locked variant this used
 * to render — a score with the detail behind a padlock, and Try again beside
 * it — is what that replaced.
 */
export function showScore(test: Test, attempt: Attempt) {
  const total = totalMarks(test);
  const waiting = pendingMarks(test, attempt);
  // With marks still out, the percentage would be a lie — the denominator is
  // what has actually been graded, and the pill says what is missing.
  const graded = total - waiting.marks;
  // The big number is MARKS, and it was read as questions answered — 4/14 on a
  // paper of 15 questions where 12 marks were still with the teacher. The unit
  // is now on the number, and the count it was mistaken for is its own line.
  const answered = test.questions.filter((q) => attempt.answers[q.id]).length;
  const pct = graded > 0 ? Math.round((attempt.score / graded) * 100) : 0;
  const message = waiting.count
    ? "Handed in — your teacher marks the long answers next."
    : pct >= 80
      ? "Excellent work! 🎉"
      : pct >= 50
        ? "Good effort — keep practising!"
        : "Keep at it — review the solutions and try again.";
  mount(
    `
    <main class="card score-card">
      <div class="score-big">${attempt.score} / ${waiting.count ? graded : total}<span class="score-unit"> marks</span></div>
      <div class="score-pct">${pct}%${waiting.count ? " of the marks given so far" : ""}</div>
      <p class="score-answered">${answered} of ${test.questions.length} question${
        test.questions.length === 1 ? "" : "s"
      } answered</p>
      <p class="score-message">${message}</p>
      ${
        waiting.count
          ? `<div class="await-pill">${ICONS.mark}<span>+${waiting.marks} marks awaiting your teacher's review —
             ${waiting.count} long answer${waiting.count > 1 ? "s" : ""}</span></div>`
          : ""
      }
      <ul class="score-breakdown">
        ${test.questions
          .map((q, i) => {
            const a = attempt.answers[q.id];
            const pending = a?.review === "pending";
            const ok = a?.correct ?? false;
            return `<li class="${pending ? "row-pending" : ok ? "row-correct" : "row-incorrect"}">
              <span>${pending ? "⏳" : ok ? "✓" : "✗"} Q${i + 1} · ${escapeHtml(q.topic)}</span>
              <span>${pending ? `— /${q.marks}` : `${a?.earned ?? 0}/${q.marks}`}</span>
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
  document.getElementById("review-btn")?.addEventListener("click", () => {
    track("review_open", { test: test.id });
    void showReview(test, attempt);
  });
  document.getElementById("restart-btn")!.addEventListener("click", () => {
    track("test_retake", { test: test.id });
    clearAttempt(test.id);
    startTest(test, newAttempt());
  });
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
    void showReview(test, attempt);
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

/**
 * Read-only review of someone else's attempt — what a parent sees. Same screen,
 * minus every control that would write to their child's record.
 */
export function showReviewFor(
  test: Test,
  attempt: Attempt,
  back: () => void,
  student?: string,
  studentName?: string,
  marking?: boolean
): void {
  void showReview(test, attempt, { back, student, studentName, marking });
}
