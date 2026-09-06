// Visual test builder: metadata + question cards with live maths preview.
// Content stays in the documented text format ($…$ maths, **bold**), so what
// a teacher writes here renders identically in the student player. The rich
// editor drops into these same text fields next.

import { track } from "../analytics";
import { mutateTest, fetchServerTest, newQuestionId } from "../api";
import { app, escapeHtml, formatText, renderMath, topbar } from "../dom";
import type { Question, QType, Test } from "../types";

interface DraftQuestion extends Question {
  _key: string; // stable DOM key while ids are still being edited
}

let draft: {
  id: string;
  title: string;
  chapter: string;
  teacher: string;
  access: "open" | "login";
  questions: DraftQuestion[];
  existing: boolean;
};

let onDone: () => void = () => {};
let keySeq = 0;

function blankQuestion(chapter: string): DraftQuestion {
  keySeq += 1;
  return {
    _key: `k${keySeq}`,
    id: "",
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

/** Open the builder for a new test, or an existing one by id. */
export async function showBuilder(testId: string | null, back: () => void) {
  onDone = back;
  if (testId) {
    app.innerHTML = `${topbar(true)}<main class="card"><p class="hint">Loading test…</p></main>`;
    const loaded = await fetchServerTest(testId);
    if (!loaded) {
      app.innerHTML = `${topbar(true)}<main class="card">
        <p class="login-error">Could not load that test.</p>
        <div class="actions"><button id="b-back" class="btn btn-ghost">Back</button></div></main>`;
      document.getElementById("b-back")!.addEventListener("click", back);
      return;
    }
    draft = {
      id: loaded.id,
      title: loaded.title,
      chapter: loaded.chapter || "",
      teacher: loaded.teacher || "",
      access: loaded.access === "open" ? "open" : "login",
      questions: loaded.questions.map((q) => {
        keySeq += 1;
        return { ...q, _key: `k${keySeq}` } as DraftQuestion;
      }),
      existing: true,
    };
  } else {
    track("builder_new");
    draft = {
      id: "",
      title: "",
      chapter: "",
      teacher: "",
      access: "login",
      questions: [blankQuestion("")],
      existing: false,
    };
  }
  render();
}

function totalMarks(): number {
  return draft.questions.reduce((s, q) => s + (Number(q.marks) || 0), 0);
}

function render() {
  app.innerHTML = `
    ${topbar(true)}
    <main class="builder">
      <div class="card">
        <h2 class="landing-title">${draft.existing ? "Edit test" : "New test"}</h2>
        <p class="hint">Maths goes between dollar signs — <code>$x^2$</code> inline,
        <code>$$…$$</code> on its own line. Wrap <code>**text**</code> to bold it.
        Every field previews exactly as students will see it.</p>
        <label class="field-label" for="b-title">Title</label>
        <input id="b-title" class="numeric-input" type="text" maxlength="120"
               placeholder="e.g. Relations and Functions — Test 1" value="${escapeHtml(draft.title)}" />
        <label class="field-label" for="b-chapter">Chapter</label>
        <input id="b-chapter" class="numeric-input" type="text" maxlength="60"
               placeholder="e.g. Relations and Functions" value="${escapeHtml(draft.chapter)}" />
        <label class="field-label" for="b-teacher">Curated by (optional)</label>
        <input id="b-teacher" class="numeric-input" type="text" maxlength="60"
               placeholder="Teacher name shown to students" value="${escapeHtml(draft.teacher)}" />
        <label class="field-label" for="b-access">Who can attempt it</label>
        <select id="b-access" class="numeric-input">
          <option value="login"${draft.access === "login" ? " selected" : ""}>Signed-in students only</option>
          <option value="open"${draft.access === "open" ? " selected" : ""}>Anyone with the link</option>
        </select>
      </div>

      <div id="b-questions"></div>

      <div class="card builder-footer">
        <div class="builder-total"><strong>${draft.questions.length}</strong> questions ·
          <strong>${totalMarks()}</strong> marks</div>
        <p id="b-error" class="login-error" hidden></p>
        <div class="actions">
          <button id="b-add" class="btn btn-ghost">Add question</button>
          <button id="b-save" class="btn btn-primary">${draft.existing ? "Save changes" : "Save as draft"}</button>
          <button id="b-cancel" class="btn btn-ghost">Cancel</button>
        </div>
      </div>
    </main>`;

  bindMeta();
  renderQuestions();

  document.getElementById("b-add")!.addEventListener("click", () => {
    draft.questions.push(blankQuestion(draft.chapter));
    render();
    app.querySelector(".builder-q:last-of-type")?.scrollIntoView({ behavior: "smooth", block: "center" });
  });
  document.getElementById("b-save")!.addEventListener("click", save);
  document.getElementById("b-cancel")!.addEventListener("click", () => onDone());
}

function bindMeta() {
  const bind = (id: string, key: "title" | "chapter" | "teacher") => {
    const el = document.getElementById(id) as HTMLInputElement;
    el.addEventListener("input", () => {
      draft[key] = el.value;
    });
  };
  bind("b-title", "title");
  bind("b-chapter", "chapter");
  bind("b-teacher", "teacher");
  const access = document.getElementById("b-access") as HTMLSelectElement;
  access.addEventListener("change", () => {
    draft.access = access.value === "open" ? "open" : "login";
  });
}

function renderQuestions() {
  const host = document.getElementById("b-questions")!;
  host.innerHTML = draft.questions
    .map((q, i) => questionCard(q, i, draft.questions.length))
    .join("");

  draft.questions.forEach((q) => bindQuestion(q));

  host.querySelectorAll<HTMLButtonElement>(".bq-move").forEach((btn) =>
    btn.addEventListener("click", () => {
      const i = Number(btn.dataset.i);
      const to = btn.dataset.dir === "up" ? i - 1 : i + 1;
      if (to < 0 || to >= draft.questions.length) return;
      const [moved] = draft.questions.splice(i, 1);
      draft.questions.splice(to, 0, moved);
      render();
    })
  );
  host.querySelectorAll<HTMLButtonElement>(".bq-delete").forEach((btn) =>
    btn.addEventListener("click", () => {
      if (draft.questions.length === 1) return;
      draft.questions.splice(Number(btn.dataset.i), 1);
      render();
    })
  );
}

function questionCard(q: DraftQuestion, i: number, total: number): string {
  const typeOpt = (value: QType, label: string) =>
    `<option value="${value}"${q.type === value ? " selected" : ""}>${label}</option>`;
  return `
  <div class="card builder-q" data-key="${q._key}">
    <div class="builder-q-head">
      <span class="chip">Q${i + 1}</span>
      <div class="cell-actions">
        <button class="btn-link bq-move" data-i="${i}" data-dir="up"${i === 0 ? " disabled" : ""}>Move up</button>
        <button class="btn-link bq-move" data-i="${i}" data-dir="down"${i === total - 1 ? " disabled" : ""}>Move down</button>
        <button class="btn-link bq-delete" data-i="${i}"${total === 1 ? " disabled" : ""}>Delete</button>
      </div>
    </div>
    <div class="builder-row">
      <div>
        <label class="field-label">Type</label>
        <select class="numeric-input bq-type">
          ${typeOpt("mcq", "Multiple choice")}
          ${typeOpt("numeric", "Numeric answer")}
          ${typeOpt("long", "Long answer (self-assessed)")}
        </select>
      </div>
      <div>
        <label class="field-label">Topic</label>
        <input class="numeric-input bq-topic" type="text" maxlength="60"
               placeholder="e.g. Inverse of a matrix" value="${escapeHtml(q.topic)}" />
      </div>
      <div>
        <label class="field-label">Marks</label>
        <input class="numeric-input bq-marks" type="number" min="1" max="20" value="${q.marks}" />
      </div>
    </div>
    <label class="field-label">Question</label>
    <textarea class="numeric-input bq-q" rows="3"
      placeholder="If $A=\\begin{pmatrix}1&2\\\\3&4\\end{pmatrix}$, find $|A|$.">${escapeHtml(q.q)}</textarea>
    <div class="builder-preview-label">Student sees</div>
    <div class="builder-preview bq-preview-q"></div>
    <div class="bq-typed"></div>
    <label class="field-label">Worked solution</label>
    <textarea class="numeric-input bq-solution" rows="4"
      placeholder="Shown after the student answers. Blank line starts a new paragraph.">${escapeHtml(q.solution)}</textarea>
    <div class="builder-preview-label">Student sees</div>
    <div class="builder-preview bq-preview-s"></div>
  </div>`;
}

function typedFields(q: DraftQuestion): string {
  if (q.type === "mcq") {
    const opts = q.options?.length ? q.options : ["", "", "", ""];
    return `
      <label class="field-label">Options — select the correct one</label>
      ${opts
        .map(
          (opt, i) => `
        <div class="builder-option">
          <input type="radio" name="ans-${q._key}" class="bq-correct" data-i="${i}"${q.answer === i ? " checked" : ""} />
          <span class="option-letter">${String.fromCharCode(65 + i)}</span>
          <input class="numeric-input bq-option" data-i="${i}" type="text" maxlength="500"
                 placeholder="Option ${String.fromCharCode(65 + i)}" value="${escapeHtml(opt)}" />
          ${opts.length > 2 ? `<button class="btn-link bq-option-del" data-i="${i}">Remove</button>` : ""}
        </div>`
        )
        .join("")}
      ${opts.length < 6 ? `<button class="btn-link bq-option-add">Add option</button>` : ""}`;
  }
  if (q.type === "numeric") {
    return `
      <div class="builder-row">
        <div>
          <label class="field-label">Correct answer</label>
          <input class="numeric-input bq-answer" type="number" step="any"
                 value="${q.answer ?? ""}" placeholder="e.g. 4.5" />
        </div>
        <div>
          <label class="field-label">Tolerance (± accepted)</label>
          <input class="numeric-input bq-tolerance" type="number" step="any" min="0"
                 value="${q.tolerance ?? 0}" />
        </div>
      </div>`;
  }
  return `<p class="hint">Long answers are not auto-graded: the student works it out,
    reveals your solution and marks themselves.</p>`;
}

function bindQuestion(q: DraftQuestion) {
  const card = app.querySelector<HTMLElement>(`.builder-q[data-key="${q._key}"]`);
  if (!card) return;

  const typedHost = card.querySelector<HTMLElement>(".bq-typed")!;
  typedHost.innerHTML = typedFields(q);

  const preview = () => {
    card.querySelector<HTMLElement>(".bq-preview-q")!.innerHTML = q.q.trim()
      ? formatText(q.q)
      : `<span class="hint">Question preview appears here.</span>`;
    card.querySelector<HTMLElement>(".bq-preview-s")!.innerHTML = q.solution.trim()
      ? formatText(q.solution)
      : `<span class="hint">Solution preview appears here.</span>`;
    renderMath(card);
  };

  const qEl = card.querySelector<HTMLTextAreaElement>(".bq-q")!;
  qEl.addEventListener("input", () => {
    q.q = qEl.value;
    preview();
  });
  const sEl = card.querySelector<HTMLTextAreaElement>(".bq-solution")!;
  sEl.addEventListener("input", () => {
    q.solution = sEl.value;
    preview();
  });
  const topicEl = card.querySelector<HTMLInputElement>(".bq-topic")!;
  topicEl.addEventListener("input", () => {
    q.topic = topicEl.value;
  });
  const marksEl = card.querySelector<HTMLInputElement>(".bq-marks")!;
  marksEl.addEventListener("input", () => {
    q.marks = Number(marksEl.value) || 0;
    const totalEl = document.querySelector(".builder-total");
    if (totalEl) {
      totalEl.innerHTML = `<strong>${draft.questions.length}</strong> questions · <strong>${totalMarks()}</strong> marks`;
    }
  });
  const typeEl = card.querySelector<HTMLSelectElement>(".bq-type")!;
  typeEl.addEventListener("change", () => {
    q.type = typeEl.value as QType;
    if (q.type === "mcq") {
      if (!q.options?.length) q.options = ["", "", "", ""];
      if (typeof q.answer !== "number" || q.answer < 0) q.answer = 0;
    } else if (q.type === "numeric") {
      delete q.options;
      q.answer = Number.isFinite(q.answer) ? q.answer : 0;
      q.tolerance = q.tolerance ?? 0;
    } else {
      delete q.options;
      delete q.answer;
      delete q.tolerance;
    }
    bindQuestion(q);
  });

  bindTypedFields(q, card, preview);
  preview();
}

function bindTypedFields(q: DraftQuestion, card: HTMLElement, preview: () => void) {
  card.querySelectorAll<HTMLInputElement>(".bq-option").forEach((el) =>
    el.addEventListener("input", () => {
      q.options![Number(el.dataset.i)] = el.value;
    })
  );
  card.querySelectorAll<HTMLInputElement>(".bq-correct").forEach((el) =>
    el.addEventListener("change", () => {
      q.answer = Number(el.dataset.i);
    })
  );
  card.querySelector<HTMLButtonElement>(".bq-option-add")?.addEventListener("click", () => {
    q.options!.push("");
    bindQuestion(q);
  });
  card.querySelectorAll<HTMLButtonElement>(".bq-option-del").forEach((el) =>
    el.addEventListener("click", () => {
      const i = Number(el.dataset.i);
      q.options!.splice(i, 1);
      if ((q.answer ?? 0) >= q.options!.length) q.answer = q.options!.length - 1;
      else if ((q.answer ?? 0) > i) q.answer = (q.answer ?? 0) - 1;
      bindQuestion(q);
    })
  );
  const ansEl = card.querySelector<HTMLInputElement>(".bq-answer");
  ansEl?.addEventListener("input", () => {
    q.answer = Number(ansEl.value);
  });
  const tolEl = card.querySelector<HTMLInputElement>(".bq-tolerance");
  tolEl?.addEventListener("input", () => {
    q.tolerance = Number(tolEl.value) || 0;
  });
  preview();
}

/** Mirror of the server's rules, so problems surface before the round trip. */
function validate(): string | null {
  if (!draft.title.trim()) return "Give the test a title.";
  if (!draft.questions.length) return "Add at least one question.";
  for (let i = 0; i < draft.questions.length; i++) {
    const q = draft.questions[i];
    const at = `Question ${i + 1}`;
    if (!q.q.trim()) return `${at}: write the question text.`;
    if (!q.solution.trim()) return `${at}: write the worked solution.`;
    if (!(q.marks >= 1 && q.marks <= 20)) return `${at}: marks must be between 1 and 20.`;
    if (q.type === "mcq") {
      const opts = (q.options ?? []).map((o) => o.trim());
      if (opts.length < 2) return `${at}: needs at least two options.`;
      if (opts.some((o) => !o)) return `${at}: fill in every option, or remove the blank ones.`;
      if (typeof q.answer !== "number" || q.answer < 0 || q.answer >= opts.length) {
        return `${at}: mark which option is correct.`;
      }
    }
    if (q.type === "numeric" && !Number.isFinite(q.answer)) {
      return `${at}: enter the correct numeric answer.`;
    }
  }
  return null;
}

async function save() {
  const errEl = document.getElementById("b-error") as HTMLElement;
  const btn = document.getElementById("b-save") as HTMLButtonElement;
  const problem = validate();
  if (problem) {
    errEl.textContent = problem;
    errEl.hidden = false;
    errEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }
  errEl.hidden = true;
  btn.disabled = true;
  btn.textContent = "Saving…";

  // Question ids must be stable and unique. They cannot be positional: deleting
  // a question and adding another would hand the new one an index a surviving
  // question already owns, and the server rejects the duplicate.
  const questions = draft.questions.map((q) => {
    const { _key, ...rest } = q;
    return { ...rest, id: q.id || newQuestionId(draft.title), chapter: q.chapter || draft.chapter };
  });

  const payload: Partial<Test> = {
    title: draft.title.trim(),
    chapter: draft.chapter.trim(),
    teacher: draft.teacher.trim(),
    access: draft.access,
    questions: questions as Question[],
  };
  if (draft.existing) payload.id = draft.id;

  const result = await mutateTest(draft.existing ? "update" : "create", payload);
  if (!result.ok) {
    errEl.textContent = result.message;
    errEl.hidden = false;
    btn.disabled = false;
    btn.textContent = draft.existing ? "Save changes" : "Save as draft";
    return;
  }
  track(draft.existing ? "test_updated" : "test_created", { test: result.test.id });
  onDone();
}
