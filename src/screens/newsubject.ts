// New subject: board → class → subjects → tests.
//
// **This is not `openModal`.** That dialog is a list of fields you fill in and
// submit once. This one branches (an entrance exam asks a different second
// question from a school board), reveals (a board group opens its own pills),
// collapses (a chapter list per subject), fetches while it is open (Peek reads
// the first question of a test) and ends by creating SEVERAL things. What it
// borrows is the modal's manners — the scrim, Escape, the focus trap,
// `body.modal-open`, and the action row that ends at the right — the same
// trade `buy.ts` and `photoviewer.ts` make.
//
// What it replaces was one flat column of eleven shelf tiles, ungrouped and
// unsearchable, that asked "what do you teach?" and could only be answered by
// scrolling. The taxonomy is now four short questions, each with one answer.
//
// **The entrance exams are the point of the redesign.** NEET was already in
// the library and had nowhere to live in a board-and-class shape — it is not a
// class of school. An exam is its own board group, and where a school board
// asks for a class it asks for the attempt year, so a 2027 batch and a 2028
// batch are two subjects with two rosters rather than one that quietly
// accumulates both.

import { track } from "../analytics";
import {
  adoptTests,
  fetchLibrary,
  fetchServerTest,
  fetchSubjects,
  mutateSubject,
  type ServerTestMeta,
  type Subject,
} from "../api";
import { escapeHtml, formatText } from "../dom";
import { paymentsAvailable } from "../payments";
import { openBuyShelf } from "./buy";
import { noteCopied } from "./subjects";
import {
  BOARD_GROUPS,
  CLASSES,
  examFor,
  examYears,
  isExamBoard,
  subjectTitle,
  type BoardGroup,
} from "../taxonomy";

let open = false;

type Step = "board" | "class" | "subjects" | "tests" | "done";

/** One row on step 3: a subject you can take, ready-made or empty. */
interface Paper {
  /** The `subject` field. Also the key everything else is held by. */
  name: string;
  /** The shelf its ready-made tests come from, if there is one. */
  shelfId: string;
  tests: ServerTestMeta[];
}

interface Made {
  title: string;
  sub: string;
}

export function openNewSubject(onDone?: () => void): void {
  if (open) return;
  open = true;
  const restoreFocusTo = document.activeElement as HTMLElement | null;

  const host = document.createElement("div");
  host.className = "modal-scrim";
  host.innerHTML = `
    <div class="modal ns" role="dialog" aria-modal="true" aria-labelledby="ns-title">
      <div class="modal-head">
        <div class="ns-head">
          <p class="modal-step" id="ns-step"></p>
          <h2 class="modal-title" id="ns-title">New subject</h2>
          <p class="ns-crumbs" id="ns-crumbs" hidden></p>
        </div>
        <button class="modal-x" data-close aria-label="Close">✕</button>
      </div>
      <p class="hint modal-desc" id="ns-blurb"></p>
      <div class="modal-body" id="ns-body"></div>
      <div class="modal-actions">
        <button class="btn btn-ghost ns-back" id="ns-back" hidden>Back</button>
        <span class="modal-actions-gap"></span>
        <button class="btn btn-ghost" data-close id="ns-cancel">Cancel</button>
        <button class="btn btn-primary" id="ns-next"></button>
      </div>
    </div>`;
  document.body.appendChild(host);
  document.body.classList.add("modal-open");

  const body = host.querySelector<HTMLElement>("#ns-body")!;
  const stepEl = host.querySelector<HTMLElement>("#ns-step")!;
  const titleEl = host.querySelector<HTMLElement>("#ns-title")!;
  const crumbEl = host.querySelector<HTMLElement>("#ns-crumbs")!;
  const blurbEl = host.querySelector<HTMLElement>("#ns-blurb")!;
  const nextBtn = host.querySelector<HTMLButtonElement>("#ns-next")!;
  const backBtn = host.querySelector<HTMLButtonElement>("#ns-back")!;
  const cancelBtn = host.querySelector<HTMLButtonElement>("#ns-cancel")!;

  // ------------------------------------------------------------------ state

  let step: Step = "board";
  let group: BoardGroup | null = null;
  let board = "";
  let klass = "";
  let otherClass = false;
  /** Subjects ticked on step 3, by name. Null until the teacher touches it. */
  let picked: Set<string> | null = null;
  let extra = "";
  /** Chapters UNticked on step 4, by test id — everything starts ticked. */
  const dropped = new Set<string>();
  let openSec = "";
  let peekId = "";
  let busy = false;
  let error = "";
  let made: Made[] = [];
  let firstSubjectId = "";

  // Fetched once when the dialog opens, in parallel. This is the piece that
  // has to change first if the library ever grows past a few shelves: search
  // moves server-side and the tests load only for the board actually picked.
  let shelves: Subject[] = [];
  let library: ServerTestMeta[] = [];
  let loading = true;

  /** The first question of a test, once Peek has fetched it. */
  const peeked = new Map<string, string>();

  // ------------------------------------------------------------- the model

  /**
   * The subjects available under the current board and class.
   *
   * An exam matches on the board ALONE. Its shelf carries whatever class it
   * was seeded with — NEET's says 12 — while the teacher has just chosen an
   * attempt year, so matching on both would hide the one exam the library
   * actually has behind a number nobody typed.
   */
  function papers(): Paper[] {
    const exam = isExamBoard(board);
    const mine = shelves.filter(
      (sh) => sh.board === board && (exam || sh.klass === klassValue())
    );
    const out: Paper[] = mine.map((sh) => ({
      name: sh.subject,
      shelfId: sh.id,
      tests: library
        .filter((t) => t.subjectId === sh.id)
        .sort((a, b) => (a.order ?? 99) - (b.order ?? 99)),
    }));
    // An exam's own papers, so a teacher sees Physics, Chemistry and Maths
    // under JEE Main before anybody has written a question for them.
    //
    // **Only when the board has no shelf at all.** NEET's shelf is a single
    // lumped subject, "Physics, Chemistry & Biology", left over from before an
    // exam had papers — so adding the three on top of it offered FOUR rows,
    // one of them holding every test and three of them empty. The rule is one
    // sentence with nothing to guess at: what the library has, or what the
    // exam is made of, never both. A paper that is genuinely missing is what
    // "Not listed? Add your own" is for.
    if (!out.length) {
      for (const name of examFor(board)?.papers ?? [])
        out.push({ name, shelfId: "", tests: [] });
    }
    return out;
  }

  const klassValue = () => (otherClass ? klass.trim() : klass);
  const isExam = () => !!group?.exam;

  /**
   * Everything answered ABOUT a board and class, forgotten when either moves.
   *
   * `extra` is on this list and was not, which is the whole reason it is a
   * function rather than two assignments: a teacher who typed "Zoology" under
   * NEET, went Back and chose JEE Main was about to create a JEE Main Zoology
   * they had never asked for — and the button said "Create 4 subjects" with
   * only three ticked, which is the tell.
   */
  function reset(): void {
    picked = null;
    extra = "";
    dropped.clear();
    openSec = "";
    peekId = "";
  }

  function chosen(): string[] {
    const all = papers();
    if (picked) return all.filter((p) => picked!.has(p.name)).map((p) => p.name);
    // Nothing touched yet: everything with tests behind it is ticked, which is
    // the answer for a teacher who picked a board because of its content.
    return all.filter((p) => p.tests.length).map((p) => p.name);
  }

  const withTests = () => papers().filter((p) => chosen().includes(p.name) && p.tests.length);

  function keptIds(): string[] {
    return withTests().flatMap((p) => p.tests.filter((t) => !dropped.has(t.id)).map((t) => t.id));
  }

  function extraName(): string {
    return extra.trim();
  }

  // ------------------------------------------------------------ the chrome

  function labelFor(): string {
    const total = isExam() ? 4 : 4;
    const n = { board: 1, class: 2, subjects: 3, tests: 4, done: 0 }[step];
    return n ? `Step ${n} of ${total}` : "";
  }

  function crumbs(): string {
    const parts: string[] = [];
    if (board) parts.push(board);
    if (klassValue() && step !== "class")
      parts.push(isExam() ? klassValue() : `Class ${klassValue()}`);
    return step === "board" ? "" : parts.join("  ›  ");
  }

  const HEADINGS: Record<Step, string> = {
    board: "Which board do you teach?",
    class: "Which class?",
    subjects: "Which subjects?",
    tests: "Which ready-made tests?",
    done: "",
  };

  const BLURBS: Record<Step, string> = {
    board: "A subject is what you teach. Start with the board — the class and the subjects follow from it.",
    class: "Class 10 and Class 12 have ready-made tests today. Any other class is yours to write.",
    subjects: "Each subject you pick becomes its own subject card, with its own tests and its own students.",
    tests: "These arrive as your own drafts. Edit anything, delete what you do not need, and add your own later.",
    done: "They are on Your subjects now.",
  };

  function heading(): string {
    if (step === "done")
      return `${made.length} subject${made.length === 1 ? "" : "s"} created`;
    if (step === "class" && isExam()) return "Which attempt?";
    return HEADINGS[step];
  }

  function blurb(): string {
    if (step === "class" && isExam())
      return "An exam is not a class. The year you are preparing them for keeps each batch separate — a 2027 group and a 2028 group are two subjects, with their own tests and their own results.";
    return BLURBS[step];
  }

  // ------------------------------------------------------------- the steps

  function boardStep(): string {
    return `
      <div class="ns-scroll">
        ${BOARD_GROUPS.map((g) => {
          const on = group?.id === g.id;
          return `
          <div class="ns-group">
            <button class="ns-tile ns-tile-wide" type="button" data-group="${escapeHtml(g.id)}" aria-pressed="${on}">
              <span class="ns-tile-name">${escapeHtml(g.name)}</span>
              <span class="ns-tile-hint">${escapeHtml(g.hint)}</span>
            </button>
            ${
              on
                ? `<div class="ns-pills">${g.boards
                    .map(
                      (b) =>
                        `<button class="ns-pill" type="button" data-board="${escapeHtml(b)}" aria-pressed="${board === b}">${escapeHtml(b)}</button>`
                    )
                    .join("")}</div>`
                : ""
            }
          </div>`;
        }).join("")}
      </div>`;
  }

  function classStep(): string {
    if (isExam()) {
      const years = examYears();
      return `
        <div class="ns-tiles">
          ${years
            .map(
              (y, i) => `
            <button class="ns-tile" type="button" data-klass="${escapeHtml(y)}" aria-pressed="${!otherClass && klass === y}">
              <span class="ns-tile-name">${escapeHtml(y)}</span>
              <span class="ns-tile-hint">${i === 0 ? "The next sitting" : "The year after"}</span>
            </button>`
            )
            .join("")}
          <button class="ns-tile ns-tile-wide" type="button" data-other="1" aria-pressed="${otherClass}">
            <span class="ns-tile-name">Another year</span>
            <span class="ns-tile-hint">Type the year you are preparing them for</span>
          </button>
        </div>
        ${
          otherClass
            ? `<div class="field ns-field">
                 <label class="label" for="ns-kc">Which year? <span class="label-req" aria-hidden="true">*</span></label>
                 <input class="modal-input" id="ns-kc" inputmode="numeric" placeholder="e.g. 2029" value="${escapeHtml(klass)}" />
               </div>`
            : ""
        }`;
    }

    const tiles = ["10", "12"].map((k) => {
      const n = shelves.filter((sh) => sh.board === board && sh.klass === k).length;
      return `
        <button class="ns-tile" type="button" data-klass="${k}" aria-pressed="${!otherClass && klass === k}">
          <span class="ns-tile-name">Class ${k}</span>
          <span class="ns-tile-hint">${n ? `${n} subject${n === 1 ? "" : "s"} ready-made` : "Nothing ready-made yet"}</span>
        </button>`;
    });
    return `
      <div class="ns-tiles">
        ${tiles.join("")}
        <button class="ns-tile ns-tile-wide" type="button" data-other="1" aria-pressed="${otherClass}">
          <span class="ns-tile-name">Another class</span>
          <span class="ns-tile-hint">Type any class you teach — nothing ready-made yet, and you can write your own tests</span>
        </button>
      </div>
      ${
        otherClass
          ? `<div class="field ns-field">
               <label class="label" for="ns-kc">Which class? <span class="label-req" aria-hidden="true">*</span></label>
               <input class="modal-input" id="ns-kc" list="ns-classes" placeholder="e.g. 9" value="${escapeHtml(klass)}" />
               <datalist id="ns-classes">${CLASSES.map((c) => `<option value="${c}"></option>`).join("")}</datalist>
             </div>`
          : ""
      }`;
  }

  function subjectsStep(): string {
    const all = papers();
    const on = chosen();
    const rows = all
      .map((p) => {
        const ticked = on.includes(p.name);
        const meta = p.tests.length
          ? `${p.tests.length} ready-made test${p.tests.length === 1 ? "" : "s"} · ${p.tests.reduce((n, t) => n + (t.questionCount || 0), 0)} questions`
          : "Nothing ready-made yet — created empty";
        return `
        <label class="choice ns-choice">
          <input class="checkbox" type="checkbox" data-paper="${escapeHtml(p.name)}"${ticked ? " checked" : ""} />
          <span class="choice-text">
            <span class="choice-label">${escapeHtml(p.name)}</span>
            <span class="choice-desc">${escapeHtml(meta)}</span>
          </span>
        </label>`;
      })
      .join("");

    return `
      ${
        all.length
          ? `<p class="ns-grp">Pick every subject you teach — each becomes its own subject</p>
             <div class="ns-scroll ns-scroll-tight">${rows}</div>`
          : `<div class="ns-alert" role="status"><b>Nothing ready-made here yet.</b>
               No ready-made tests exist for ${escapeHtml(board || "this board")} ${escapeHtml(klassValue() ? (isExam() ? klassValue() : `Class ${klassValue()}`) : "")} yet.
               Name the subject and it is created empty — you can write tests in it straight away.</div>`
      }
      <div class="field ns-field">
        <label class="label" for="ns-extra">Not listed? Add your own</label>
        <input class="modal-input" id="ns-extra" placeholder="e.g. Computer Science" value="${escapeHtml(extra)}" aria-describedby="ns-extra-h" />
        <span class="hint" id="ns-extra-h">Created empty, with no ready-made tests.</span>
      </div>`;
  }

  function testsStep(): string {
    const secs = withTests();
    const total = keptIds().length;
    return `
      <div class="ns-total">
        <span class="ns-total-n">${total} test${total === 1 ? "" : "s"} across ${secs.length} subject${secs.length === 1 ? "" : "s"}</span>
        <span class="ns-total-gap"></span>
        <button class="btn-link" type="button" data-all="1">Select all</button>
        <button class="btn-link" type="button" data-none="1">Clear</button>
      </div>
      <div class="ns-scroll">
        ${secs
          .map((p, i) => {
            const isOpen = openSec ? openSec === p.name : i === 0;
            const kept = p.tests.filter((t) => !dropped.has(t.id)).length;
            return `
          <div class="ns-sec">
            <button class="ns-sechead" type="button" data-sec="${escapeHtml(p.name)}" aria-expanded="${isOpen}">
              <span class="ns-sechead-text">
                <span class="ns-sec-name">${escapeHtml(p.name)}</span>
                <span class="ns-sec-meta">${kept} of ${p.tests.length} chosen</span>
              </span>
              <svg class="icon ns-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>
            </button>
            ${isOpen ? `<div class="ns-secbody">${p.tests.map((t, n) => chapLine(t, n)).join("")}</div>` : ""}
          </div>`;
          })
          .join("")}
      </div>`;
  }

  function chapLine(t: ServerTestMeta, n: number): string {
    const on = !dropped.has(t.id);
    const showing = peekId === t.id;
    const label = `${n + 1}. ${t.title}`;
    const stem = peeked.get(t.id);
    return `
      <div class="ns-chap">
        <div class="ns-chapline">
          <input class="checkbox" type="checkbox" data-test="${escapeHtml(t.id)}"${on ? " checked" : ""} aria-label="${escapeHtml(label)}" />
          <span class="choice-text">
            <span class="choice-label">${escapeHtml(label)}</span>
            <span class="choice-desc">${t.questionCount} questions · ${t.totalMarks} marks</span>
          </span>
          <button class="btn-link" type="button" data-peek="${escapeHtml(t.id)}">${showing ? "Hide" : "Peek"}</button>
        </div>
        ${
          showing
            ? `<div class="ns-peek">
                 <div class="ns-peek-box">${stem === undefined ? `<p class="hint">Loading…</p>` : stem ? formatText(stem) : `<p class="hint">This test has no questions yet.</p>`}</div>
                 <p class="hint">First of ${t.questionCount} questions. Read the whole test from Browse tests.</p>
               </div>`
            : ""
        }
      </div>`;
  }

  function doneStep(): string {
    return `
      <div class="ns-alert" role="status">Every copied test is a draft, so students cannot see them yet. Publish the ones you want to share.</div>
      <div class="ns-made">
        ${made
          .map(
            (m) => `
          <div class="test-card ns-madecard">
            <span class="test-card-main">
              <span class="test-card-title">${escapeHtml(m.title)}</span>
              <span class="test-card-sub">${escapeHtml(m.sub)}</span>
            </span>
            <span class="status-chip status-new">Draft</span>
          </div>`
          )
          .join("")}
      </div>`;
  }

  // -------------------------------------------------------------- painting

  function render(): void {
    if (loading) {
      stepEl.textContent = "";
      titleEl.textContent = "New subject";
      crumbEl.hidden = true;
      blurbEl.textContent = "";
      body.innerHTML = `<p class="hint">Loading what is available…</p>`;
      nextBtn.disabled = true;
      nextBtn.textContent = "Continue";
      backBtn.hidden = true;
      return;
    }

    stepEl.textContent = labelFor();
    stepEl.hidden = !labelFor();
    titleEl.textContent = heading();
    const c = crumbs();
    crumbEl.textContent = c;
    crumbEl.hidden = !c;
    blurbEl.textContent = blurb();
    blurbEl.hidden = !blurb();

    body.innerHTML =
      (error ? `<p class="login-error ns-error">${escapeHtml(error)}</p>` : "") +
      (step === "board"
        ? boardStep()
        : step === "class"
          ? classStep()
          : step === "subjects"
            ? subjectsStep()
            : step === "tests"
              ? testsStep()
              : doneStep());

    nextBtn.textContent = nextLabel();
    nextBtn.disabled = busy || blocked();
    backBtn.hidden = !(step === "class" || step === "subjects" || step === "tests");
    cancelBtn.hidden = step === "done";
  }

  function blocked(): boolean {
    if (step === "board") return !board;
    if (step === "class") return !klassValue();
    if (step === "subjects") return !chosen().length && !extraName();
    return false;
  }

  function nextLabel(): string {
    if (busy) return "Creating…";
    if (step === "board" || step === "class") return "Continue";
    if (step === "subjects") {
      if (withTests().length) return "Choose tests";
      const n = chosen().length + (extraName() ? 1 : 0);
      return `Create ${n} subject${n === 1 ? "" : "s"}`;
    }
    if (step === "tests") {
      const n = keptIds().length;
      return n ? `Create with ${n} test${n === 1 ? "" : "s"}` : "Create empty";
    }
    return firstSubjectId ? "Open the first subject" : "Done";
  }

  // --------------------------------------------------------------- actions

  async function doPeek(id: string): Promise<void> {
    peekId = peekId === id ? "" : id;
    render();
    if (!peekId || peeked.has(id)) return;
    // One fetch, when a teacher asks for it. The library listing projects the
    // question chunks away, so the stem is genuinely not in hand until now.
    const test = await fetchServerTest(id);
    peeked.set(id, test?.questions?.[0]?.q ?? "");
    if (peekId === id) render();
  }

  /**
   * Create every chosen subject, and copy its chapters into it.
   *
   * Sequential on purpose. It is a handful of subjects, each one a create and
   * then an adopt that has to name the id the create returned; running them
   * together would buy nothing a teacher could perceive and would make a
   * partial failure impossible to report honestly.
   */
  async function create(): Promise<void> {
    busy = true;
    error = "";
    render();

    const all = papers();
    const wanted = [
      ...all.filter((p) => chosen().includes(p.name)),
      ...(extraName() ? [{ name: extraName(), shelfId: "", tests: [] as ServerTestMeta[] }] : []),
    ];

    made = [];
    firstSubjectId = "";
    const k = klassValue();

    for (const p of wanted) {
      const res = await mutateSubject("create", { board, klass: k, subject: p.name });
      if (!res.ok) {
        error = `${p.name}: ${res.message}`;
        break;
      }
      const into = res.subject?.id ?? "";
      if (!firstSubjectId) firstSubjectId = into;

      const ids = p.tests.filter((t) => !dropped.has(t.id)).map((t) => t.id);
      if (!ids.length) {
        made.push({ title: subjectTitle(board, k, p.name), sub: "Empty — write your own tests" });
        continue;
      }
      const copied = await adoptTests(ids, into);
      if (!copied.ok) {
        // The subject exists. Say what happened to the tests rather than
        // implying nothing did — and if it is the free allowance that ran out,
        // the price has a door on it.
        made.push({ title: subjectTitle(board, k, p.name), sub: "Created — tests could not be copied" });
        if (copied.payment && paymentsAvailable()) {
          const pay = copied.payment;
          const shelf = shelves.find((s) => s.id === pay.shelfId);
          setTimeout(() => openBuyShelf({ shelfId: pay.shelfId, title: shelf?.title }), 0);
          break;
        }
        error = `${p.name}: ${copied.message ?? "the tests could not be copied"}`;
        break;
      }
      const n = copied.tests?.length ?? ids.length;
      made.push({
        title: subjectTitle(board, k, p.name),
        sub: `${n} test${n === 1 ? "" : "s"} copied in`,
      });
    }

    busy = false;
    if (made.length) {
      // The editor greets them with how many tests landed in the one it opens
      // on. The Done step names the SUBJECTS; the banner names the tests.
      const total = keptIds().length;
      if (total) noteCopied(total);
      track("subject_created_from_library", {
        board,
        klass: k,
        subjects: String(made.length),
        exam: isExam() ? "1" : "",
      });
      step = "done";
      onDone?.();
    }
    render();
  }

  function next(): void {
    error = "";
    if (step === "board") {
      step = "class";
      return render();
    }
    if (step === "class") {
      step = "subjects";
      return render();
    }
    if (step === "subjects") {
      if (withTests().length) {
        step = "tests";
        return render();
      }
      return void create();
    }
    if (step === "tests") return void create();
    // Done: land where the work is.
    close();
    if (firstSubjectId) {
      void import("./editor").then((m) =>
        m.showEditorForSubject(firstSubjectId, () => void import("./subjects").then((s) => s.showSubjects()))
      );
    }
  }

  function back(): void {
    error = "";
    step = step === "class" ? "board" : step === "subjects" ? "class" : "subjects";
    render();
  }

  // ---------------------------------------------------------------- wiring

  body.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    const g = t.closest<HTMLElement>("[data-group]");
    if (g) {
      const found = BOARD_GROUPS.find((x) => x.id === g.dataset.group);
      group = group?.id === found?.id ? null : (found ?? null);
      board = "";
      klass = "";
      otherClass = false;
      return render();
    }
    const b = t.closest<HTMLElement>("[data-board]");
    if (b) {
      board = b.dataset.board ?? "";
      klass = "";
      otherClass = false;
      reset();
      return render();
    }
    const k = t.closest<HTMLElement>("[data-klass]");
    if (k) {
      klass = k.dataset.klass ?? "";
      otherClass = false;
      reset();
      return render();
    }
    if (t.closest("[data-other]")) {
      otherClass = true;
      klass = "";
      reset();
      render();
      body.querySelector<HTMLInputElement>("#ns-kc")?.focus();
      return;
    }
    const sec = t.closest<HTMLElement>("[data-sec]");
    if (sec) {
      const name = sec.dataset.sec ?? "";
      const showing = openSec ? openSec === name : withTests()[0]?.name === name;
      openSec = showing ? "\u0000" : name;
      return render();
    }
    const peek = t.closest<HTMLElement>("[data-peek]");
    if (peek) return void doPeek(peek.dataset.peek ?? "");
    if (t.closest("[data-all]")) {
      dropped.clear();
      return render();
    }
    if (t.closest("[data-none]")) {
      for (const id of withTests().flatMap((p) => p.tests.map((x) => x.id))) dropped.add(id);
      return render();
    }
  });

  body.addEventListener("change", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.paper) {
      if (!picked) picked = new Set(chosen());
      if (t.checked) picked.add(t.dataset.paper);
      else picked.delete(t.dataset.paper);
      // Re-rendering here would tear the checkbox out from under the tap, so
      // only the button that depends on the count is refreshed.
      nextBtn.textContent = nextLabel();
      nextBtn.disabled = blocked();
      return;
    }
    if (t.dataset.test) {
      if (t.checked) dropped.delete(t.dataset.test);
      else dropped.add(t.dataset.test);
      return render();
    }
  });

  body.addEventListener("input", (e) => {
    const t = e.target as HTMLInputElement;
    if (t.id === "ns-kc") {
      klass = t.value;
      nextBtn.disabled = blocked();
    }
    if (t.id === "ns-extra") {
      extra = t.value;
      nextBtn.textContent = nextLabel();
      nextBtn.disabled = blocked();
    }
  });

  nextBtn.addEventListener("click", () => next());
  backBtn.addEventListener("click", () => back());

  // --------------------------------------------------------------- manners

  function close(): void {
    if (!open) return;
    open = false;
    host.remove();
    document.body.classList.remove("modal-open");
    restoreFocusTo?.focus?.();
    document.removeEventListener("keydown", onKey);
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key !== "Tab") return;
    const focusable = Array.from(
      host.querySelectorAll<HTMLElement>("button, input, a[href]")
    ).filter((el) => !el.hasAttribute("disabled") && !el.closest("[hidden]"));
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  host.addEventListener("click", (e) => {
    const t = e.target as HTMLElement;
    if (t === host || t.closest("[data-close]")) close();
  });
  document.addEventListener("keydown", onKey);

  render();
  track("new_subject_open");

  void Promise.all([fetchSubjects(), fetchLibrary()]).then(([subs, masters]) => {
    if (!open) return;
    shelves = (subs ?? []).filter((x) => x.platform);
    library = masters ?? [];
    loading = false;
    render();
  });
}
