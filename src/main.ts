import "./style.css";
import { initAnalytics, track } from "./analytics";
import {
  authEnabled,
  isLoggedIn,
  getProfile,
  signOut,
  renderGoogleButton,
  savePhone,
  submitAttempt,
  flushPendingAttempts,
  fetchMyAttempts,
} from "./auth";

type QType = "mcq" | "numeric" | "long";

interface Question {
  id: string;
  chapter: string;
  topic: string;
  type: QType;
  q: string;
  options?: string[];
  answer?: number;
  tolerance?: number;
  solution: string;
  marks: number;
}

interface Test {
  id: string;
  title: string;
  chapter: string;
  teacher?: string | null;
  order?: number;
  access?: "open" | "login"; // "login" requires Google sign-in; default "open"
  questions: Question[];
}

interface StoredAnswer {
  given: number | null; // mcq: option index; numeric: value; long: 1 right / 0 wrong
  correct: boolean;
  earned: number;
}

interface Attempt {
  answers: Record<string, StoredAnswer>;
  index: number; // next unanswered question
  completed: boolean;
  score: number;
  completedAt?: string;
  updatedAt: string;
}

declare global {
  interface Window {
    renderMathInElement?: (el: HTMLElement, opts?: object) => void;
  }
}

// ---------- Test registry ----------

const modules = import.meta.glob("./tests/*.json", { eager: true }) as Record<
  string,
  { default: Test }
>;
const TESTS: Test[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

function totalMarks(test: Test): number {
  return test.questions.reduce((s, q) => s + q.marks, 0);
}

// ---------- Attempt storage (this phone's notebook) ----------

function storageKey(testId: string): string {
  return `vidaivi:attempt:${testId}`;
}

function loadAttempt(testId: string): Attempt | null {
  try {
    const raw = localStorage.getItem(storageKey(testId));
    return raw ? (JSON.parse(raw) as Attempt) : null;
  } catch {
    return null;
  }
}

function saveAttempt(testId: string, attempt: Attempt): void {
  attempt.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(storageKey(testId), JSON.stringify(attempt));
  } catch {
    // storage unavailable (private mode etc.) — test still works, just no resume
  }
}

function clearAttempt(testId: string): void {
  try {
    localStorage.removeItem(storageKey(testId));
  } catch {}
}

function newAttempt(): Attempt {
  return {
    answers: {},
    index: 0,
    completed: false,
    score: 0,
    updatedAt: new Date().toISOString(),
  };
}

// ---------- Rendering helpers ----------

const app = document.getElementById("app")!;

function renderMath(el: HTMLElement) {
  const run = () =>
    window.renderMathInElement?.(el, {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
      ],
      throwOnError: false,
    });
  if (window.renderMathInElement) run();
  else window.addEventListener("DOMContentLoaded", run, { once: true });
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Minimal formatting for question/solution text: **bold** and paragraphs.
function formatText(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function topbar(showHome: boolean): string {
  return `
    <header class="topbar">
      <h1>${showHome ? `<a class="home-link" href="./">Vidaivi</a>` : "Vidaivi"}</h1>
      <span class="chip">CBSE Class 12 Maths</span>
    </header>`;
}

function gotoTest(testId: string): void {
  location.href = `./?test=${encodeURIComponent(testId)}`;
}

// ---------- Screens ----------

function profileRow(): string {
  const p = getProfile();
  if (!p) return "";
  return `
    <div class="profile-row">
      ${p.picture ? `<img class="profile-pic" src="${escapeHtml(p.picture)}" alt="" referrerpolicy="no-referrer">` : ""}
      <div class="profile-main">
        <div class="profile-name">${escapeHtml(p.name || p.email)}</div>
        <div class="profile-sub">${escapeHtml(p.email)}</div>
      </div>
      <button id="signout-btn" class="btn-link">Sign out</button>
    </div>`;
}

function showHome() {
  track("home_open");
  app.innerHTML = `
    ${topbar(false)}
    ${profileRow()}
    <p class="tagline">Chapter-wise practice tests. Attempt, get instant solutions, review any time — right from this link.</p>
    <div class="test-list">
      ${TESTS.map((t) => {
        const attempt = loadAttempt(t.id);
        const total = totalMarks(t);
        let status = `<span class="status-chip status-new">Not started</span>`;
        if (attempt?.completed) {
          status = `<span class="status-chip status-done">Score ${attempt.score}/${total}</span>`;
        } else if (attempt && attempt.index > 0) {
          status = `<span class="status-chip status-progress">In progress · Q${attempt.index + 1} of ${t.questions.length}</span>`;
        }
        return `
        <button class="test-card" data-test="${t.id}">
          <div class="test-card-main">
            <div class="test-card-title">${escapeHtml(t.title)}</div>
            <div class="test-card-sub">${t.questions.length} questions · ${total} marks</div>
          </div>
          ${status}
        </button>`;
      }).join("")}
    </div>`;
  app.querySelectorAll<HTMLButtonElement>(".test-card").forEach((card) =>
    card.addEventListener("click", () => gotoTest(card.dataset.test!))
  );
  document.getElementById("signout-btn")?.addEventListener("click", () => {
    track("sign_out");
    signOut();
    showHome();
  });
  void renderServerResults();
}

// Cloud-saved results for the logged-in student, appended under the test list.
async function renderServerResults(): Promise<void> {
  if (!authEnabled || !isLoggedIn()) return;
  const attempts = await fetchMyAttempts();
  if (!attempts?.length) return;
  const titleOf = (id: string) =>
    TESTS.find((t) => t.id === id)?.title ?? id;
  const list = document.querySelector(".test-list");
  list?.insertAdjacentHTML(
    "afterend",
    `<div class="card server-results">
      <div class="solution-title">Your saved results</div>
      <ul class="score-breakdown">
        ${attempts
          .slice(0, 10)
          .map(
            (a) => `<li>
              <span>${escapeHtml(titleOf(a.testId))}</span>
              <span>${a.score}/${a.total} · ${new Date(a.completedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}</span>
            </li>`
          )
          .join("")}
      </ul>
    </div>`
  );
}

function requiresLogin(test: Test): boolean {
  return authEnabled && test.access === "login" && !isLoggedIn();
}

function showLogin(test: Test) {
  track("login_open", { test: test.id });
  app.innerHTML = `
    ${topbar(true)}
    <main class="card landing">
      <div class="chip chip-topic">${escapeHtml(test.chapter)}</div>
      <h2 class="landing-title">${escapeHtml(test.title)}</h2>
      <p class="hint">Sign in once with Google to take this test — your scores
      are saved to your profile and follow you on any device.</p>
      <div id="google-btn" class="google-btn-slot"></div>
      <p id="login-error" class="login-error" hidden></p>
      <p class="hint">Just exploring? Try the free demo test from the
      <a href="./">home page</a> — no sign-in needed.</p>
    </main>`;
  const slot = document.getElementById("google-btn")!;
  const errEl = document.getElementById("login-error") as HTMLElement;
  void renderGoogleButton(
    slot,
    (profile) => {
      track("login_success", { test: test.id });
      if (!profile.phone) showPhoneForm(test);
      else showLanding(test);
    },
    (message) => {
      errEl.textContent = message;
      errEl.hidden = false;
    }
  );
}

function showPhoneForm(test: Test) {
  const profile = getProfile();
  app.innerHTML = `
    ${topbar(true)}
    <main class="card landing">
      <h2 class="landing-title">Almost there${profile?.name ? `, ${escapeHtml(profile.name.split(" ")[0])}` : ""}!</h2>
      <p class="hint">One last thing — a WhatsApp number where score reports
      can be shared (yours or a parent's).</p>
      <input id="phone-input" class="numeric-input" type="tel" inputmode="tel"
             placeholder="10-digit mobile number" maxlength="15" />
      <p id="phone-error" class="login-error" hidden></p>
      <div class="actions">
        <button id="phone-save" class="btn btn-primary" disabled>Save and continue</button>
      </div>
    </main>`;
  const input = document.getElementById("phone-input") as HTMLInputElement;
  const save = document.getElementById("phone-save") as HTMLButtonElement;
  const errEl = document.getElementById("phone-error") as HTMLElement;
  input.addEventListener("input", () => {
    save.disabled = input.value.replace(/\D/g, "").length < 10;
  });
  save.addEventListener("click", async () => {
    save.disabled = true;
    save.textContent = "Saving…";
    const ok = await savePhone(input.value.trim());
    if (ok) {
      track("phone_saved", { test: test.id });
      showLanding(test);
    } else {
      errEl.textContent = "Could not save — check your connection and try again.";
      errEl.hidden = false;
      save.disabled = false;
      save.textContent = "Save and continue";
    }
  });
}

function showLanding(test: Test) {
  if (requiresLogin(test)) {
    showLogin(test);
    return;
  }
  const attempt = loadAttempt(test.id);
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

  app.innerHTML = `
    ${topbar(true)}
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
    </main>`;

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

  app.innerHTML = `
    ${topbar(true)}
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
    </main>`;

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
      });
      showScore(test, attempt);
      return;
    }
  };

  saveAttempt(test.id, attempt);

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
  app.innerHTML = `
    ${topbar(true)}
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
    </main>`;
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

function showReview(test: Test, attempt: Attempt) {
  const total = totalMarks(test);
  app.innerHTML = `
    ${topbar(true)}
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
          <div class="solution">
            <div class="solution-title">Solution</div>
            ${formatText(q.solution)}
          </div>
        </div>`;
        })
        .join("")}
      <div class="actions">
        <button id="retake-btn" class="btn btn-primary">Retake test</button>
      </div>
    </main>`;
  document.getElementById("retake-btn")!.addEventListener("click", () => {
    track("test_retake", { test: test.id });
    clearAttempt(test.id);
    showQuestion(test, newAttempt());
  });
  renderMath(app);
  window.scrollTo(0, 0);
}

// ---------- Boot ----------

initAnalytics();
if (authEnabled && isLoggedIn()) void flushPendingAttempts();

const testId = new URLSearchParams(location.search).get("test");
const test = TESTS.find((t) => t.id === testId);
if (test) {
  track("test_open", { test: test.id });
  showLanding(test);
} else {
  showHome();
}
