// "Your subjects" — the card grid a teacher or student lands on after signing
// in. A subject is a board + class + subject that owns tests; picking one opens
// its tests.

import { track } from "../analytics";
import {
  fetchSubjects,
  fetchTestList,
  mutateSubject,
  seedSampleTests,
  type Subject,
} from "../api";
import { canAuthor } from "../auth";
import { TESTS } from "../data";
import { escapeHtml, ICONS, setUrl } from "../dom";
import { confirmDialog, notice } from "../dialog";
import { mount, skeleton } from "../shell";
import { showWelcome } from "./auth";
import { showEditorForSubject } from "./editor";
import { setSubject, showHome } from "./home";
import { isStudentViewer, showStudentSubject } from "./student";
import { openNewSubject } from "./newsubject";

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
      actions: canAuthor() ? `<button id="sub-new" class="btn btn-primary">+ Subject</button>` : "",
    }
  );
  document.getElementById("sub-new")?.addEventListener("click", () => openNewSubject(() => void refresh()));

  await refresh();
}

async function refresh(): Promise<void> {
  const grid = document.getElementById("sub-grid");
  if (!grid) return;
  let all = (await fetchSubjects()) ?? [];
  // Seeding files tests under one of these, so its counts are read again.
  if (await seedSamplesOnce(grid, all)) all = (await fetchSubjects()) ?? all;
  // **Your subjects means subjects you own**, for every role — an admin
  // included. Built-in shelves are served to every teacher by /api/subjects,
  // but they are nobody's own work and they crowd out the one subject a teacher
  // actually teaches. They are reachable from Browse, and selectable when
  // creating a subject or a test; they do not belong in this grid.
  const subjects = all.filter((x) => !x.platform);
  const cards = subjects.map(cardFor);
  // A teacher who owns nothing yet needs to be told what a subject is FOR, not
  // shown an empty grid with a button in the corner.
  const ownsNone = canAuthor() && !subjects.length;
  grid.innerHTML = ownsNone
    ? firstRunMarkup()
    : cards.length
      ? `<div class="subject-grid">${cards.join("")}</div>`
      : `<p class="hint">No subjects yet — your teacher will share tests with you here.</p>`;
  document.getElementById("sub-first")?.addEventListener("click", () => openNewSubject(() => void refresh()));
  document
    .getElementById("sub-browse")
    ?.addEventListener("click", () => void import("./browse").then((x) => x.showBrowse()));

  grid.querySelectorAll<HTMLElement>(".subject-card").forEach((el) =>
    el.addEventListener("click", () => {
      const id = el.dataset.subject!;
      track("subject_open", { subject: id });
      setSubject(id);
      // A teacher goes where they build tests — the editor, scoped to this
      // subject. A student goes to their tests tree: the same shape, read-only,
      // one question at a time.
      if (canAuthor()) void showEditorForSubject(id, () => void showSubjects());
      else if (isStudentViewer()) void showStudentSubject(id, el.dataset.title || undefined);
      else showHome(id);
    })
  );
  grid.querySelectorAll<HTMLButtonElement>(".subject-del").forEach((el) =>
    el.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (
        !(await confirmDialog({
          title: "Remove this subject?",
          message: "Its tests must be moved or deleted first; an empty subject is removed for good.",
          confirmLabel: "Remove",
          danger: true,
        }))
      ) {
        return;
      }
      const result = await mutateSubject("delete", { id: el.dataset.subject! });
      if (!result.ok) notice(result.message);
      void refresh();
    })
  );
}

/**
 * A teacher with no tests of their own gets the bundled tests copied in as
 * their own editable drafts, so they have a worked example to learn from. Once
 * ever — the server holds the flag.
 *
 * The samples are CBSE Class 12 Maths papers, and they are filed under a
 * subject of the teacher's that IS that — never under whichever subject
 * happens to come first. This used to hand the seed `owned[0]` of the subject
 * list, which has had the library's shelves in it since Sep 2026 and is sorted
 * by title, so every new teacher's samples went under the first shelf, where
 * no tree of theirs could show them; and a teacher whose first subject is MBBS
 * would otherwise find two Maths tests in it. With no subject they fit there
 * is nothing to seed, and the server keeps the offer open (`needsSamples`)
 * until there is one. Returns whether anything was written.
 */
async function seedSamplesOnce(grid: HTMLElement, owned: Subject[]): Promise<boolean> {
  if (!canAuthor()) return false;
  const home = owned.find(samplesFit);
  if (!home) return false;
  const list = await fetchTestList();
  if (!list?.needsSamples) return false;
  grid.innerHTML = skeleton.cards(3);
  return (await seedSampleTests(TESTS, home.id)) > 0;
}

/** A subject the bundled samples belong in: the teacher's own CBSE Class 12 Maths. */
function samplesFit(s: Subject): boolean {
  return !s.platform && s.board === "CBSE" && s.klass === "12" && /^math/i.test(s.subject.trim());
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
        ${canAuthor() && !built ? `<span class="btn-link subject-del" data-subject="${escapeHtml(s.id)}" role="button">Remove</span>` : ""}
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
      <p class="fr-note"><button class="btn-link" id="sub-browse">Browse the ready-made tests first</button></p>
    </div>`;
}

function initials(s: Subject): string {
  return `${(s.subject || "?").slice(0, 1)}${s.klass || ""}`.toUpperCase();
}

/**
 * Tell the editor to greet the teacher with what just happened. Read and
 * cleared once by the editor, so it cannot reappear on a later visit.
 */
const COPIED_KEY = "vidai:justCopied";

export function noteCopied(count: number): void {
  try {
    localStorage.setItem(COPIED_KEY, String(count));
  } catch {}
}
