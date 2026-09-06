// The three editing surfaces: question body, the type-adaptive Answer Expected
// panel, and the explanation. Each renders into a host element and reports
// edits through the state module's `edit`, which drives autosave.

import { newQuestionId } from "../../api";
import { escapeHtml, formatText, renderMath } from "../../dom";
import type { Question, QType } from "../../types";
import { currentTest, edit } from "./state";

export function questionBody(q: Question): string {
  return `
    <section class="ed-panel" data-panel="question">
      <div class="ed-panel-head">
        <span class="ed-panel-label">Question</span>
        <div class="ed-spacer"></div>
        <span class="ed-panel-label">Topic</span>
        <input class="ed-input ed-topic-input" id="ed-topic" type="text" maxlength="60"
               placeholder="e.g. Inverse of a matrix" value="${escapeHtml(q.topic)}" />
      </div>
      <textarea class="ed-text" id="ed-q" rows="4"
        placeholder="Type the question. Wrap maths in $…$ and bold in **stars**.">${escapeHtml(q.q)}</textarea>
      <div class="ed-preview-label">Student sees</div>
      <div class="ed-preview" id="ed-q-preview"></div>
    </section>`;
}

export function answerPanel(q: Question): string {
  const typeOpt = (value: QType, label: string) =>
    `<option value="${value}"${q.type === value ? " selected" : ""}>${label}</option>`;
  return `
    <section class="ed-panel" data-panel="answer">
      <div class="ed-panel-head">
        <span class="ed-panel-label">Answer expected</span>
        <select class="ed-select" id="ed-type">
          ${typeOpt("mcq", "Multiple choice")}
          ${typeOpt("numeric", "Numeric")}
          ${typeOpt("long", "Long answer")}
        </select>
        <div class="ed-spacer"></div>
        <span class="ed-panel-label">Marks</span>
        <input class="ed-marks" id="ed-marks" type="number" min="1" max="20" value="${q.marks || ""}" />
      </div>
      <div id="ed-answer-fields">${answerFields(q)}</div>
    </section>`;
}

function answerFields(q: Question): string {
  if (q.type === "mcq") {
    const options = q.options?.length ? q.options : ["", "", "", ""];
    return `
      <div class="ed-options">
        ${options
          .map(
            (opt, i) => `
          <div class="ed-option${q.answer === i ? " correct" : ""}">
            <input type="radio" name="ed-correct" class="ed-correct" data-i="${i}"${q.answer === i ? " checked" : ""} />
            <span class="ed-option-letter">${String.fromCharCode(65 + i)}</span>
            <input class="ed-option-text" data-i="${i}" type="text" maxlength="500"
                   placeholder="Option ${String.fromCharCode(65 + i)}" value="${escapeHtml(opt)}" />
            ${options.length > 2 ? `<button class="btn-link ed-option-del" data-i="${i}" aria-label="Remove option">Remove</button>` : ""}
          </div>`
          )
          .join("")}
      </div>
      ${options.length < 6 ? `<button class="btn-link" id="ed-option-add">Add option</button>` : ""}`;
  }
  if (q.type === "numeric") {
    return `
      <div class="ed-numeric">
        <label class="ed-field">
          <span class="ed-panel-label">Correct answer</span>
          <input class="ed-input" id="ed-answer" type="number" step="any"
                 value="${Number.isFinite(q.answer) ? q.answer : ""}" placeholder="e.g. 4.5" />
        </label>
        <label class="ed-field">
          <span class="ed-panel-label">Tolerance (± accepted)</span>
          <input class="ed-input" id="ed-tolerance" type="number" step="any" min="0" value="${q.tolerance ?? 0}" />
        </label>
      </div>`;
  }
  return `<p class="ed-empty">Nothing to fill in. The student works it out on paper,
    reveals your explanation and marks themselves.</p>`;
}

export function explanationPanel(q: Question): string {
  return `
    <section class="ed-panel" data-panel="explain">
      <div class="ed-panel-head">
        <span class="ed-panel-label">Explanation</span>
        <span class="ed-hint">Shown after the student answers</span>
      </div>
      <textarea class="ed-text" id="ed-solution" rows="8"
        placeholder="Work the answer through. A blank line starts a new paragraph.">${escapeHtml(q.solution)}</textarea>
      <div class="ed-preview-label">Student sees</div>
      <div class="ed-preview" id="ed-s-preview"></div>
    </section>`;
}

/** Bind every field of the currently shown question. `redraw` re-renders the
 *  answer fields when the type changes; `onStructureChange` refreshes the tree. */
export function bindQuestionEditor(
  root: HTMLElement,
  index: number,
  redraw: () => void,
  onStructureChange: () => void
): void {
  const test = currentTest();
  const q = test?.questions[index];
  if (!test || !q) return;

  const preview = () => {
    const qp = root.querySelector<HTMLElement>("#ed-q-preview");
    const sp = root.querySelector<HTMLElement>("#ed-s-preview");
    if (qp) {
      qp.innerHTML = q.q.trim() ? formatText(q.q) : `<span class="ed-empty">Question preview appears here.</span>`;
    }
    if (sp) {
      sp.innerHTML = q.solution.trim()
        ? formatText(q.solution)
        : `<span class="ed-empty">Explanation preview appears here.</span>`;
    }
    renderMath(root);
  };

  const qEl = root.querySelector<HTMLTextAreaElement>("#ed-q");
  qEl?.addEventListener("input", () => {
    edit(() => {
      q.q = qEl.value;
    });
    preview();
    onStructureChange();
  });

  const sEl = root.querySelector<HTMLTextAreaElement>("#ed-solution");
  sEl?.addEventListener("input", () => {
    edit(() => {
      q.solution = sEl.value;
    });
    preview();
    onStructureChange();
  });

  const marksEl = root.querySelector<HTMLInputElement>("#ed-marks");
  marksEl?.addEventListener("input", () => {
    edit(() => {
      q.marks = Number(marksEl.value) || 0;
    });
    onStructureChange();
  });

  const typeEl = root.querySelector<HTMLSelectElement>("#ed-type");
  typeEl?.addEventListener("change", () => {
    edit(() => {
      q.type = typeEl.value as QType;
      if (q.type === "mcq") {
        if (!q.options?.length) q.options = ["", "", "", ""];
        if (typeof q.answer !== "number" || q.answer < 0) q.answer = 0;
        delete q.tolerance;
      } else if (q.type === "numeric") {
        delete q.options;
        q.tolerance = q.tolerance ?? 0;
      } else {
        delete q.options;
        delete q.answer;
        delete q.tolerance;
      }
    });
    redraw();
    onStructureChange();
  });

  root.querySelectorAll<HTMLInputElement>(".ed-option-text").forEach((el) =>
    el.addEventListener("input", () => {
      edit(() => {
        q.options![Number(el.dataset.i)] = el.value;
      });
      onStructureChange();
    })
  );
  root.querySelectorAll<HTMLInputElement>(".ed-correct").forEach((el) =>
    el.addEventListener("change", () => {
      edit(() => {
        q.answer = Number(el.dataset.i);
      });
      redraw();
      onStructureChange();
    })
  );
  root.querySelector<HTMLButtonElement>("#ed-option-add")?.addEventListener("click", () => {
    edit(() => q.options!.push(""));
    redraw();
  });
  root.querySelectorAll<HTMLButtonElement>(".ed-option-del").forEach((el) =>
    el.addEventListener("click", () => {
      const i = Number(el.dataset.i);
      edit(() => {
        q.options!.splice(i, 1);
        const answer = q.answer ?? 0;
        if (answer >= q.options!.length) q.answer = q.options!.length - 1;
        else if (answer > i) q.answer = answer - 1;
      });
      redraw();
      onStructureChange();
    })
  );

  const ansEl = root.querySelector<HTMLInputElement>("#ed-answer");
  ansEl?.addEventListener("input", () => {
    edit(() => {
      const value = Number(ansEl.value);
      if (ansEl.value.trim() === "" || !Number.isFinite(value)) delete q.answer;
      else q.answer = value;
    });
    onStructureChange();
  });
  const tolEl = root.querySelector<HTMLInputElement>("#ed-tolerance");
  tolEl?.addEventListener("input", () => {
    edit(() => {
      q.tolerance = Number(tolEl.value) || 0;
    });
  });

  preview();
}

export function blankQuestion(chapter: string, title: string): Question {
  return {
    id: newQuestionId(title),
    chapter,
    topic: "",
    type: "mcq",
    q: "",
    options: ["", "", "", ""],
    answer: 0,
    solution: "",
    marks: 1,
  };
}
