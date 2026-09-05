import questions from "./questions.json";
import "./style.css";

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

declare global {
  interface Window {
    renderMathInElement?: (el: HTMLElement, opts?: object) => void;
  }
}

const QUESTIONS = questions as Question[];
const TOTAL_MARKS = QUESTIONS.reduce((s, q) => s + q.marks, 0);

const app = document.getElementById("app")!;

let index = 0;
let score = 0;
const results: { id: string; correct: boolean; earned: number }[] = [];

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
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// Minimal formatting for solution text: **bold** and paragraphs.
function formatText(s: string): string {
  return escapeHtml(s)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .split("\n\n")
    .map((p) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function progressBar(): string {
  const pct = (index / QUESTIONS.length) * 100;
  return `
    <div class="progress">
      <div class="progress-label">Question ${index + 1} of ${QUESTIONS.length}</div>
      <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>
    </div>`;
}

function showQuestion() {
  const q = QUESTIONS[index];
  app.innerHTML = `
    <header class="topbar">
      <h1>Matrices Practice</h1>
      <span class="chip">CBSE Class 12</span>
    </header>
    ${progressBar()}
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
      finishQuestion(q, correct);
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
      finishQuestion(q, correct);
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
      document
        .getElementById("self-right")!
        .addEventListener("click", () => recordAndNext(q, true, false));
      document
        .getElementById("self-wrong")!
        .addEventListener("click", () => recordAndNext(q, false, false));
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

function finishQuestion(q: Question, correct: boolean) {
  const feedback = document.getElementById("feedback")!;
  feedback.innerHTML = `
    <div class="verdict ${correct ? "verdict-correct" : "verdict-incorrect"}">
      ${correct ? "✓ Correct" : "✗ Incorrect"} · ${correct ? `+${q.marks}` : "0"} / ${q.marks} marks
    </div>`;
  showSolution(q);
  recordAndNext(q, correct, true);
}

function recordAndNext(q: Question, correct: boolean, waitForNext: boolean) {
  results.push({ id: q.id, correct, earned: correct ? q.marks : 0 });
  if (correct) score += q.marks;

  const advance = () => {
    index++;
    if (index < QUESTIONS.length) showQuestion();
    else showScore();
  };

  if (waitForNext) {
    const actions = document.getElementById("actions")!;
    actions.innerHTML = `<button id="next-btn" class="btn btn-primary">
      ${index < QUESTIONS.length - 1 ? "Next question" : "See my score"}
    </button>`;
    document.getElementById("next-btn")!.addEventListener("click", advance);
    document.getElementById("next-btn")!.scrollIntoView({ behavior: "smooth", block: "nearest" });
  } else {
    advance();
  }
}

function showScore() {
  const pct = Math.round((score / TOTAL_MARKS) * 100);
  const message =
    pct >= 80 ? "Excellent work! 🎉" : pct >= 50 ? "Good effort — keep practising!" : "Keep at it — review the solutions and try again.";
  app.innerHTML = `
    <header class="topbar">
      <h1>Matrices Practice</h1>
      <span class="chip">CBSE Class 12</span>
    </header>
    <main class="card score-card">
      <div class="score-big">${score} / ${TOTAL_MARKS}</div>
      <div class="score-pct">${pct}%</div>
      <p class="score-message">${message}</p>
      <ul class="score-breakdown">
        ${results
          .map((r, i) => {
            const q = QUESTIONS[i];
            return `<li class="${r.correct ? "row-correct" : "row-incorrect"}">
              <span>${r.correct ? "✓" : "✗"} Q${i + 1} · ${escapeHtml(q.topic)}</span>
              <span>${r.earned}/${q.marks}</span>
            </li>`;
          })
          .join("")}
      </ul>
      <button id="restart-btn" class="btn btn-primary">Try again</button>
    </main>`;
  document.getElementById("restart-btn")!.addEventListener("click", () => {
    index = 0;
    score = 0;
    results.length = 0;
    showQuestion();
  });
}

showQuestion();
