// "Your subjects" — the card grid a teacher or student lands on after signing
// in. A subject is a board + class + subject that owns tests; picking one opens
// its tests.

import { track } from "../analytics";
import {
  adoptTests,
  fetchLibrary,
  fetchSubjects,
  fetchTestList,
  mutateSubject,
  seedSampleTests,
  type Subject,
} from "../api";
import { isTeacher } from "../auth";
import { TESTS } from "../data";
import { escapeHtml, ICONS, setUrl } from "../dom";
import { openModal, type ModalField } from "../modal";
import { mount, skeleton } from "../shell";
import { showWelcome } from "./auth";
import { showEditorForSubject } from "./editor";
import { setSubject, showHome } from "./home";
import { isStudentViewer, showStudentSubject } from "./student";

const BOARDS = ["CBSE", "ICSE", "State Board", "IGCSE"];
const CLASSES = ["8", "9", "10", "11", "12"];
const SUBJECTS = ["Maths", "Physics", "Chemistry", "Biology", "English", "Computer Science"];

export async function showSubjects() {
  setUrl();
  track("subjects_open");
  // The shell paints at once; the grid shows its shape until the data lands.
  mount(
    `
    <main class="subjects">
      <div class="subjects-head"><h2 class="subjects-title">Your subjects</h2></div>
      <div id="sub-grid">${skeleton.cards(3)}</div>
    </main>`,
    {
      title: "Subjects",
      active: "subjects",
      width: "wide",
      actions: isTeacher() ? `<button id="sub-new" class="btn btn-primary">+ Subject</button>` : "",
    }
  );
  document.getElementById("sub-new")?.addEventListener("click", () => void openForm());

  await refresh();
}

async function refresh(): Promise<void> {
  const grid = document.getElementById("sub-grid");
  if (!grid) return;
  await seedSamplesOnce(grid);
  const subjects = (await fetchSubjects()) ?? [];
  // The hardcoded "built in" card is gone: the library is a real platform
  // subject now, served to every teacher by /api/subjects. A student never gets
  // one — their subjects are their own teacher's.
  const cards = subjects.map(cardFor);
  // A teacher who owns nothing yet needs to be told what a subject is FOR, not
  // shown an empty grid with a button in the corner. Built-in shelves do not
  // count as owning one, or this would never appear.
  const ownsNone = isTeacher() && !subjects.some((x) => !x.platform);
  grid.innerHTML = ownsNone
    ? firstRunMarkup()
    : cards.length
      ? `<div class="subject-grid">${cards.join("")}</div>`
      : `<p class="hint">No subjects yet — your teacher will share tests with you here.</p>`;
  document.getElementById("sub-first")?.addEventListener("click", () => void openForm());

  grid.querySelectorAll<HTMLElement>(".subject-card").forEach((el) =>
    el.addEventListener("click", () => {
      const id = el.dataset.subject!;
      track("subject_open", { subject: id });
      setSubject(id);
      // A teacher goes where they build tests — the editor, scoped to this
      // subject. A student goes to their tests tree: the same shape, read-only,
      // one question at a time.
      if (isTeacher()) void showEditorForSubject(id, () => void showSubjects());
      else if (isStudentViewer()) void showStudentSubject(id, el.dataset.title || undefined);
      else showHome(id);
    })
  );
  grid.querySelectorAll<HTMLButtonElement>(".subject-del").forEach((el) =>
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Remove this subject? Its tests must be moved or deleted first.")) return;
      const result = await mutateSubject("delete", { id: el.dataset.subject! });
      if (!result.ok) alert(result.message);
      void refresh();
    })
  );
}

/**
 * A teacher's first visit copies the bundled tests in as their own editable
 * drafts, so they always have a worked example to learn from. Once ever — the
 * server holds the flag.
 *
 * Runs before the subjects are fetched: seeded tests are written without a
 * subject, and the subjects endpoint adopts orphans into the default subject
 * it creates. A teacher who already made a subject skips that adoption, so we
 * hand the seed their first subject instead.
 */
async function seedSamplesOnce(grid: HTMLElement): Promise<void> {
  if (!isTeacher()) return;
  const list = await fetchTestList();
  if (!list?.needsSamples) return;
  grid.innerHTML = skeleton.cards(3);
  const owned = (await fetchSubjects()) ?? [];
  await seedSampleTests(TESTS, owned[0]?.id);
}

function cardFor(s: Subject): string {
  const count = s.testCount ?? 0;
  // A built-in shelf is not the teacher's to remove, and says what it is.
  const built = !!s.platform;
  return `
    <button class="subject-card${built ? " subject-card-builtin" : ""}" data-subject="${escapeHtml(s.id)}" data-title="${escapeHtml(s.title)}"${built ? ` data-platform="1"` : ""}>
      <span class="subject-mark">${escapeHtml(initials(s))}</span>
      <span class="subject-name">${escapeHtml(s.title)}</span>
      <span class="subject-meta">
        <span class="subject-count">${built ? "Built in" : `${count} test${count === 1 ? "" : "s"}`}</span>
        ${isTeacher() && !built ? `<span class="btn-link subject-del" data-subject="${escapeHtml(s.id)}" role="button">Remove</span>` : ""}
      </span>
    </button>`;
}

/**
 * The first thing a teacher ever sees. It has one job: make it obvious that a
 * subject is the container their tests live in, and that starting is one click
 * and needs no question-writing.
 */
function firstRunMarkup(): string {
  const beat = (icon: string, text: string) => `
    <div class="fr-beat">
      <span class="fr-icon">${icon}</span>
      <span class="fr-beat-text">${escapeHtml(text)}</span>
    </div>`;
  const arrow = `<svg class="fr-arrow" viewBox="0 0 22 14" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M1 7h18M15 3l4 4-4 4"/></svg>`;
  return `
    <div class="first-run">
      <div class="fr-beats">
        ${beat(ICONS.folder, "A subject")}
        ${arrow}
        ${beat(ICONS.file, "holds your tests")}
        ${arrow}
        ${beat(ICONS.users, "students sit them")}
      </div>
      <h3 class="fr-title">Start with a subject</h3>
      <p class="fr-text">A subject is what you teach — like <strong>CBSE Class 10 Maths</strong>.
      Your tests live inside it, and your students see the ones you publish.</p>
      <button id="sub-first" class="btn btn-primary fr-cta">Create your first subject</button>
      <p class="fr-note">${ICONS.check} Ready-made CBSE tests are included — no question-writing needed to start</p>
    </div>`;
}

function initials(s: Subject): string {
  return `${(s.subject || "?").slice(0, 1)}${s.klass || ""}`.toUpperCase();
}

/**
 * New subject, in two steps: **what do you teach**, then **which tests**.
 *
 * The move this turns on is that the taxonomy stops being a question — picking
 * "CBSE Class 10 Maths" IS the board, the class and the subject, so only
 * "Something else" has to ask for them. The dialog this replaced put a content
 * choice, a taxonomy chore and a second content choice in one scrolling box,
 * and asked for the taxonomy even when it already knew the answer.
 */
async function openForm(): Promise<void> {
  // One round of fetches when the dialog opens, in parallel: the shelves to
  // offer, and every built-in test so each shelf can list its own.
  //
  // This is the piece that has to change first if the library ever grows: at a
  // few shelves it is one small response, at a few hundred it is every test on
  // the platform before the teacher sees anything. Search would move server
  // side and the tests would load only for the shelf actually picked.
  const [subjects, masters] = await Promise.all([fetchSubjects(), fetchLibrary()]);
  const library = masters ?? [];
  const shelves = (subjects ?? [])
    .filter((x) => x.platform)
    .filter((sh) => library.some((t) => t.subjectId === sh.id));

  const testsOf = (shelfId: string) =>
    library
      .filter((t) => t.subjectId === shelfId)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

  // No library at all: there is nothing to choose between, so ask the three
  // fields directly rather than showing a step with one option on it.
  if (!shelves.length) {
    openModal({
      title: "New subject",
      description: "A subject is what you teach — the tests you write live inside it.",
      submitLabel: "Create subject",
      fields: taxonomyFields(),
      onSubmit: async (v) => createBlank(v),
    });
    return;
  }

  const CUSTOM = "__custom__";

  openModal({
    title: "New subject",
    submitLabel: "Create subject",
    steps: [
      {
        title: "New subject",
        description: "A subject is what you teach. Your tests live inside it.",
        fields: [
          {
            name: "from",
            label: "What do you teach?",
            kind: "cards",
            choices: [
              ...shelves.map((sh) => ({
                value: sh.id,
                label: sh.title.replace(/^CBSE\s+/i, "") || sh.title,
                hint: sh.board,
                badge: `${testsOf(sh.id).length} ready-made tests`,
              })),
              {
                value: CUSTOM,
                label: "Something else",
                hint: "Choose your own board, class and subject",
                wide: true,
              },
            ],
          },
        ],
      },
      {
        // Which tests — one checklist per shelf, each shown only while that
        // shelf is the one chosen on step one.
        fields: [
          ...shelves.map((sh) => ({
            name: `tests_${sh.id}`,
            label: `Which tests from ${sh.title}?`,
            kind: "checklist" as const,
            bulk: true,
            showWhen: { field: "from", value: sh.id },
            hint: "They arrive as your own drafts. Edit anything, delete what you don’t need, and add your own later.",
            empty: "This built-in subject has no published tests yet.",
            choices: testsOf(sh.id).map((t, i) => ({
              value: t.id,
              label: `${i + 1}. ${t.title}`,
              hint: `${t.chapter ? `${t.chapter} · ` : ""}${t.questionCount} questions · ${t.totalMarks} marks`,
            })),
          })),
          ...taxonomyFields({ showWhen: { field: "from", value: CUSTOM } }),
        ],
        // The button says what is about to happen. With nothing ticked it
        // creates the subject empty, which is also the "I'll write my own" path.
        submitLabel: (values, picks) => {
          if (values.from === CUSTOM) return "Create subject";
          const n = (picks[`tests_${values.from}`] ?? []).length;
          return n ? `Create with ${n} test${n === 1 ? "" : "s"}` : "Create subject";
        },
      },
    ],
    onSubmit: async (v, picks) => {
      const shelf = shelves.find((x) => x.id === v.from);
      if (!shelf) return createBlank(v);

      // From a shelf: the new subject inherits the shelf's taxonomy, so the
      // teacher never retypes what they just picked.
      const made = await mutateSubject("create", {
        board: shelf.board,
        klass: shelf.klass,
        subject: shelf.subject,
      });
      if (!made.ok) return made.message;
      const into = made.subject?.id;
      if (!into) return "The subject was created but could not be opened.";

      const wanted = picks[`tests_${shelf.id}`] ?? [];
      if (!wanted.length) {
        track("subject_created", { from: "library-empty" });
        void refresh();
        return;
      }

      const copied = await adoptTests(wanted, into);
      if (!copied.ok) {
        // The subject exists; say so rather than implying nothing happened.
        void refresh();
        return `Subject created, but the tests could not be copied: ${copied.message}`;
      }
      track("subject_created_from_library", {
        subject: shelf.id,
        copied: String(copied.tests?.length ?? 0),
      });
      // Land where the work is, with the copies in the tree and a note saying
      // they are drafts — "where did my test go" is the confusion this answers.
      noteCopied(copied.tests?.length ?? 0);
      setSubject(into);
      void showEditorForSubject(into, () => void showSubjects());
    },
  });
}

/**
 * Tell the editor to greet the teacher with what just happened. Read and
 * cleared once by the editor, so it cannot reappear on a later visit.
 */
const COPIED_KEY = "vidai:justCopied";

function noteCopied(count: number): void {
  try {
    localStorage.setItem(COPIED_KEY, String(count));
  } catch {}
}

/** The three fields, used alone when nothing ready-made fits. */
function taxonomyFields(extra: Partial<ModalField> = {}): ModalField[] {
  return [
    { name: "board", label: "Board", value: "CBSE", options: BOARDS, required: true, ...extra },
    { name: "klass", label: "Class", value: "12", options: CLASSES, required: true, ...extra },
    {
      name: "subject",
      label: "Subject",
      placeholder: "e.g. Physics",
      options: SUBJECTS,
      required: true,
      ...extra,
    },
  ];
}

async function createBlank(v: Record<string, string>): Promise<string | void> {
  const result = await mutateSubject("create", {
    board: v.board,
    klass: v.klass,
    subject: v.subject,
  });
  if (!result.ok) return result.message;
  track("subject_created");
  void refresh();
}
