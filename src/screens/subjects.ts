// "Your subjects" — the card grid a teacher or student lands on after signing
// in. A subject is a board + class + subject that owns tests; picking one opens
// its tests.

import { track } from "../analytics";
import { fetchSubjects, mutateSubject, type Subject } from "../api";
import { getProfile, isTeacher, signOut } from "../auth";
import { setGuest } from "../attempts";
import { app, escapeHtml, ICONS, topbar } from "../dom";
import { showWelcome } from "./auth";
import { showHome } from "./home";

const BOARDS = ["CBSE", "ICSE", "State Board", "IGCSE"];
const CLASSES = ["8", "9", "10", "11", "12"];
const SUBJECTS = ["Maths", "Physics", "Chemistry", "Biology", "English", "Computer Science"];

/** The built-in tests that ship with the app, shown as a subject of their own. */
export const BUILT_IN_SUBJECT = {
  id: "builtin",
  title: "CBSE Class 12 Maths",
  board: "CBSE",
  klass: "12",
  subject: "Maths",
};

export async function showSubjects() {
  track("subjects_open");
  const profile = getProfile();
  app.innerHTML = `
    ${topbar(false)}
    <main class="subjects">
      <div class="subjects-head">
        <h2 class="subjects-title">Your subjects</h2>
        ${isTeacher() ? `<button id="sub-new" class="btn btn-primary subjects-new">+ Subject</button>` : ""}
      </div>
      <div id="sub-form" class="card subject-form" hidden></div>
      <div id="sub-grid" class="subject-grid"><p class="hint">Loading…</p></div>
      <div class="subjects-foot">
        <span class="hint">${escapeHtml(profile?.name || profile?.email || "")}</span>
        <button id="sub-signout" class="btn-link">Sign out</button>
      </div>
    </main>`;

  document.getElementById("sub-signout")!.addEventListener("click", () => {
    track("sign_out");
    signOut();
    setGuest(false);
    showWelcome();
  });
  document.getElementById("sub-new")?.addEventListener("click", () => openForm());

  await refresh();
}

async function refresh(): Promise<void> {
  const grid = document.getElementById("sub-grid");
  if (!grid) return;
  const subjects = (await fetchSubjects()) ?? [];
  const cards = [...subjects.map(cardFor), builtInCard()];
  grid.innerHTML = cards.join("");

  grid.querySelectorAll<HTMLElement>(".subject-card").forEach((el) =>
    el.addEventListener("click", () => {
      const id = el.dataset.subject!;
      track("subject_open", { subject: id });
      showHome(id === BUILT_IN_SUBJECT.id ? null : id);
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

function cardFor(s: Subject): string {
  const count = s.testCount ?? 0;
  return `
    <button class="subject-card" data-subject="${escapeHtml(s.id)}">
      <span class="subject-mark">${escapeHtml(initials(s))}</span>
      <span class="subject-name">${escapeHtml(s.title)}</span>
      <span class="subject-meta">
        <span class="subject-count">${count} test${count === 1 ? "" : "s"}</span>
        ${isTeacher() ? `<span class="btn-link subject-del" data-subject="${escapeHtml(s.id)}" role="button">Remove</span>` : ""}
      </span>
    </button>`;
}

function builtInCard(): string {
  return `
    <button class="subject-card subject-card-builtin" data-subject="${BUILT_IN_SUBJECT.id}">
      <span class="subject-mark">${escapeHtml(BUILT_IN_SUBJECT.board.slice(0, 2))}</span>
      <span class="subject-name">${escapeHtml(BUILT_IN_SUBJECT.title)}</span>
      <span class="subject-meta">
        <span class="subject-count">Built in</span>
      </span>
    </button>`;
}

function initials(s: Subject): string {
  return `${(s.subject || "?").slice(0, 1)}${s.klass || ""}`.toUpperCase();
}

function openForm(): void {
  const host = document.getElementById("sub-form");
  if (!host) return;
  host.hidden = false;
  const options = (values: string[], name: string) =>
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("") +
    `<option value="__other">Something else…</option>`.replace("__other", `other-${name}`);

  host.innerHTML = `
    <h3 class="subject-form-title">New subject</h3>
    <p class="hint">A subject is one board, class and subject — the tests you write live inside it.</p>
    <div class="subject-form-row">
      <label class="ed-field">
        <span class="ed-panel-label">Board</span>
        <input class="ed-input" id="sf-board" list="sf-boards" placeholder="CBSE" value="CBSE" />
        <datalist id="sf-boards">${options(BOARDS, "board")}</datalist>
      </label>
      <label class="ed-field">
        <span class="ed-panel-label">Class</span>
        <input class="ed-input" id="sf-class" list="sf-classes" placeholder="12" value="12" />
        <datalist id="sf-classes">${options(CLASSES, "class")}</datalist>
      </label>
      <label class="ed-field">
        <span class="ed-panel-label">Subject</span>
        <input class="ed-input" id="sf-subject" list="sf-subjects" placeholder="Maths" />
        <datalist id="sf-subjects">${options(SUBJECTS, "subject")}</datalist>
      </label>
    </div>
    <p id="sf-error" class="login-error" hidden></p>
    <div class="actions">
      <button id="sf-save" class="btn btn-primary">Create subject</button>
      <button id="sf-cancel" class="btn btn-ghost">Cancel</button>
    </div>`;

  const err = document.getElementById("sf-error") as HTMLElement;
  document.getElementById("sf-cancel")!.addEventListener("click", () => {
    host.hidden = true;
  });
  document.getElementById("sf-save")!.addEventListener("click", async () => {
    const board = (document.getElementById("sf-board") as HTMLInputElement).value.trim();
    const klass = (document.getElementById("sf-class") as HTMLInputElement).value.trim();
    const subject = (document.getElementById("sf-subject") as HTMLInputElement).value.trim();
    if (!board || !klass || !subject) {
      err.textContent = "Board, class and subject are all needed.";
      err.hidden = false;
      return;
    }
    const result = await mutateSubject("create", { board, klass, subject });
    if (!result.ok) {
      err.textContent = result.message;
      err.hidden = false;
      return;
    }
    track("subject_created");
    host.hidden = true;
    void refresh();
  });
}
