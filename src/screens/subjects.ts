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
import { escapeHtml, setUrl } from "../dom";
import { openModal } from "../modal";
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
  grid.innerHTML = cards.length
    ? `<div class="subject-grid">${cards.join("")}</div>`
    : `<p class="hint">No subjects yet — your teacher will share tests with you here.</p>`;

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

function initials(s: Subject): string {
  return `${(s.subject || "?").slice(0, 1)}${s.klass || ""}`.toUpperCase();
}

/**
 * New subject, in the shared modal. Board and class carry sensible defaults;
 * subject does not, and is marked required — the old inline form pre-filled two
 * of the three and left the third showing only a placeholder, so a form that
 * looked complete failed with "Board, class and subject are all needed".
 */
async function openForm(): Promise<void> {
  // One round of fetches when the dialog opens, in parallel: the shelves to
  // offer, and every built-in test so each shelf can list its own.
  const [subjects, masters] = await Promise.all([fetchSubjects(), fetchLibrary()]);
  const shelves = (subjects ?? []).filter((x) => x.platform);
  const library = masters ?? [];

  // One checklist per shelf, each shown only while that shelf is chosen. The
  // modal's showWhen compares against a fixed value, so this is how a dependent
  // list is expressed without inventing a second dialog.
  const shelfTests = shelves.map((sh) => ({
    name: `tests_${sh.id}`,
    label: `Tests to copy from ${sh.title}`,
    kind: "checklist" as const,
    showWhen: { field: "from", value: sh.id },
    empty: "This built-in subject has no published tests yet.",
    choices: library
      .filter((t) => t.subjectId === sh.id)
      .sort((a, b) => (a.order ?? 99) - (b.order ?? 99))
      .map((t) => ({
        value: t.id,
        label: t.title,
        hint: `${t.chapter ? `${t.chapter} · ` : ""}${t.questionCount} questions · ${t.totalMarks} marks`,
      })),
  }));

  openModal({
    title: "New subject",
    description:
      "A subject is one board, class and subject — the tests you write live inside it.",
    submitLabel: "Create subject",
    fields: [
      ...(shelves.length
        ? [
            {
              name: "from",
              label: "Start from",
              kind: "radio" as const,
              choices: [
                { value: "blank", label: "A blank subject", hint: "Write your own tests" },
                ...shelves.map((sh) => ({
                  value: sh.id,
                  label: sh.title,
                  hint: "Copy tests from this built-in subject",
                })),
              ],
            },
          ]
        : []),
      {
        name: "board",
        label: "Board",
        value: "CBSE",
        options: BOARDS,
        required: true,
        ...(shelves.length ? { showWhen: { field: "from", value: "blank" } } : {}),
      },
      {
        name: "klass",
        label: "Class",
        value: "12",
        options: CLASSES,
        required: true,
        ...(shelves.length ? { showWhen: { field: "from", value: "blank" } } : {}),
      },
      {
        name: "subject",
        label: "Subject",
        placeholder: "e.g. Maths",
        options: SUBJECTS,
        required: true,
        ...(shelves.length ? { showWhen: { field: "from", value: "blank" } } : {}),
      },
      ...shelfTests,
    ],
    onSubmit: async (v, picks) => {
      const from = v.from || "blank";
      const shelf = shelves.find((x) => x.id === from);

      if (!shelf) {
        const result = await mutateSubject("create", {
          board: v.board,
          klass: v.klass,
          subject: v.subject,
        });
        if (!result.ok) return result.message;
        track("subject_created");
        void refresh();
        return;
      }

      // From a shelf: the new subject inherits the shelf's taxonomy, so the
      // teacher never retypes what they just picked.
      const wanted = picks[`tests_${shelf.id}`] ?? [];
      if (!wanted.length) return "Tick at least one test to copy.";

      const made = await mutateSubject("create", {
        board: shelf.board,
        klass: shelf.klass,
        subject: shelf.subject,
      });
      if (!made.ok) return made.message;
      const into = made.subject?.id;
      if (!into) return "The subject was created but could not be opened.";

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
      void refresh();
    },
  });
}
