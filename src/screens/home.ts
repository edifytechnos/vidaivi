// Home screen: test list, profile row, cloud-saved results.

import { track } from "../analytics";
import {
  authEnabled,
  fetchMyAttempts,
  fetchReleasedMany,
  getProfile,
  isLoggedIn,
} from "../auth";
import { fetchTestList } from "../api";
import { loadAttempt, requiresLogin, setGuest } from "../attempts";
import { TESTS, totalMarks } from "../data";
import { escapeHtml, gotoTest, ICONS, setUrl, testLabelMarkup } from "../dom";
import { mount, skeleton } from "../shell";
import { showWelcome } from "./auth";

function profileRow(): string {
  const p = getProfile();
  if (!p) {
    if (!authEnabled) return "";
    return `
    <div class="profile-row">
      <div class="profile-main">
        <div class="profile-name">Browsing as guest</div>
        <div class="profile-sub">Sign in to save scores to your profile</div>
      </div>
      <button id="signin-btn" class="btn-link">Sign in</button>
    </div>`;
  }
  const sub =
    p.kind === "student"
      ? [p.sub, p.grade, p.school].filter(Boolean).join(" · ")
      : `${p.email ?? ""}${p.role === "teacher" ? " · Teacher" : ""}`;
  return `
    <div class="profile-row">
      ${p.picture ? `<img class="profile-pic" src="${escapeHtml(p.picture)}" alt="" referrerpolicy="no-referrer">` : ""}
      <div class="profile-main">
        <div class="profile-name">${escapeHtml(p.name || p.email || p.sub)}</div>
        <div class="profile-sub">${escapeHtml(sub)}</div>
      </div>
    </div>`;
}

let activeSubject: string | null = null;
/** Server-side scores, so a test finished on another device reads as done. */
const serverScores = new Map<string, { score: number; total: number }>();
/** Server-side progress, so an unfinished test reads as in progress anywhere. */
const serverProgress = new Map<string, number>();
/**
 * Which papers the teacher has opened. A mark is the teacher's to give, so a
 * score is shown only once they release it — before that a student sees that
 * the paper is in, and nothing that could be mistaken for a result.
 * Absent means shut: this fails closed like `fetchReleased` itself.
 */
const releasedTests = new Set<string>();

/**
 * The status chip for one test. localStorage knows about a half-finished
 * attempt on THIS device; the server knows every completed one, wherever it
 * was taken — so the server wins for "done" and local fills in progress.
 */
function statusChip(testId: string, questionCount: number, total: number): string {
  const done = serverScores.get(testId);
  const open = releasedTests.has(testId);
  if (done) {
    return open
      ? `<span class="status-chip status-done">Score ${done.score}/${done.total}</span>`
      : `<span class="status-chip status-progress">Handed in</span>`;
  }
  const attempt = loadAttempt(testId);
  if (attempt?.completed) {
    return open
      ? `<span class="status-chip status-done">Score ${attempt.score}/${total}</span>`
      : `<span class="status-chip status-progress">Handed in</span>`;
  }
  const at = attempt && attempt.index > 0 ? attempt.index : serverProgress.get(testId) ?? 0;
  if (at > 0) {
    return `<span class="status-chip status-progress">In progress · Q${at + 1} of ${questionCount}</span>`;
  }
  return `<span class="status-chip status-new">Not started</span>`;
}

export function currentSubject(): string | null {
  return activeSubject;
}

/** Set the working subject without rendering — the caller picks the screen. */
export function setSubject(subjectId: string | null): void {
  activeSubject = subjectId;
}

/** The tests page. `subjectId` null means the built-in (bundled) tests. */
export function showHome(subjectId: string | null = activeSubject) {
  setUrl();
  activeSubject = subjectId;
  track("home_open", subjectId ? { subject: subjectId } : {});
  const host = mount(
    `
    ${profileRow()}
    <p class="tagline">Chapter-wise practice tests. Attempt, get instant solutions, review any time — right from this link.</p>
    <div class="test-list">
      ${(activeSubject ? [] : TESTS).map((t) => {
        const total = totalMarks(t);
        const status = statusChip(t.id, t.questions.length, total);
        const locked = requiresLogin(t);
        return `
        <button class="test-card" data-test="${t.id}">
          <div class="test-card-main">
            <div class="test-card-title">${locked ? ICONS.lock : ""}${testLabelMarkup(t.title, t.chapter)}</div>
            <div class="test-card-sub">${t.questions.length} questions · ${total} marks${locked ? " · sign in to attempt" : ""}</div>
          </div>
          ${status}
        </button>`;
      }).join("")}
      ${authEnabled && isLoggedIn() ? skeleton.list(2) : ""}
    </div>
    ${authEnabled && isLoggedIn() ? `<div id="server-results">${skeleton.card(3)}</div>` : ""}`,
    { title: activeSubject ? "Tests" : "Practice tests", active: "subjects", width: "narrow" }
  );
  host.querySelectorAll<HTMLButtonElement>(".test-card[data-test]").forEach((card) => {
    card.dataset.bound = "1";
    card.addEventListener("click", () => gotoTest(card.dataset.test!));
  });
  document.getElementById("signin-btn")?.addEventListener("click", () => {
    setGuest(false);
    showWelcome();
  });
  void renderServerTests();
  void renderServerResults();
}

// DB-backed published tests (teacher-authored / platform) merged into the
// same list, skipping ids already bundled in the build.
async function renderServerTests(): Promise<void> {
  if (!authEnabled || !isLoggedIn()) return;
  // Built-in view shows only the bundled tests; a subject shows only its own.
  const payload = await fetchTestList(activeSubject ?? undefined);
  const server = payload?.tests ?? null;
  document.querySelector(".test-list .sk-wrap")?.remove();
  if (!server?.length) return;
  const bundled = new Set(TESTS.map((t) => t.id));
  const fresh = server.filter(
    (t) =>
      t.status === "published" &&
      !bundled.has(t.id) &&
      (activeSubject ? t.subjectId === activeSubject : !t.subjectId)
  );
  if (!fresh.length) return;
  const list = document.querySelector(".test-list");
  if (!list) return;
  list.insertAdjacentHTML(
    "beforeend",
    fresh
      .map((t) => {
        const status = statusChip(t.id, t.questionCount, t.totalMarks);
        return `
        <button class="test-card" data-test="${escapeHtml(t.id)}">
          <div class="test-card-main">
            <div class="test-card-title">${testLabelMarkup(t.title, t.chapter)}</div>
            <div class="test-card-sub">${t.questionCount} questions · ${t.totalMarks} marks</div>
          </div>
          ${status}
        </button>`;
      })
      .join("")
  );
  list.querySelectorAll<HTMLButtonElement>(".test-card[data-test]").forEach((card) => {
    if (!card.dataset.bound) {
      card.dataset.bound = "1";
      card.addEventListener("click", () => gotoTest(card.dataset.test!));
    }
  });
}

/** Repaint every card's chip once the server's attempts have arrived. */
function refreshStatusChips(): void {
  document.querySelectorAll<HTMLElement>(".test-card[data-test]").forEach((card) => {
    const id = card.dataset.test!;
    const chip = card.querySelector(".status-chip");
    if (!chip) return;
    const done = serverScores.get(id);
    if (done) {
      const open = releasedTests.has(id);
      chip.className = `status-chip ${open ? "status-done" : "status-progress"}`;
      chip.textContent = open ? `Score ${done.score}/${done.total}` : "Handed in";
      return;
    }
    // Only the server knows a test started on another device.
    const at = serverProgress.get(id);
    if (at && at > 0 && !loadAttempt(id)) {
      chip.className = "status-chip status-progress";
      chip.textContent = `In progress · Q${at + 1}`;
    }
  });
}

// Cloud-saved results for the logged-in student, appended under the test list.
async function renderServerResults(): Promise<void> {
  if (!authEnabled || !isLoggedIn()) return;
  const attempts = await fetchMyAttempts();
  // One request for every paper's release state, not one per paper.
  releasedTests.clear();
  const finished = (attempts ?? []).filter((a) => a.status !== "progress").map((a) => a.testId);
  for (const [id, open] of Object.entries(await fetchReleasedMany(finished))) {
    if (open) releasedTests.add(id);
  }
  const slot = document.getElementById("server-results");
  if (!attempts?.length) {
    slot?.remove();
    refreshStatusChips();
    return;
  }
  // Newest first, so a retake's score is the one shown.
  for (const a of [...attempts].reverse()) {
    if (a.status === "progress") serverProgress.set(a.testId, a.index ?? 0);
    else serverScores.set(a.testId, { score: a.score, total: a.total });
  }
  refreshStatusChips();
  // A cloud test is not in TESTS, so fall back to the list we just fetched
  // rather than printing a raw test id at the student.
  const serverTitles = new Map(
    ((await fetchTestList(activeSubject ?? undefined))?.tests ?? []).map((t) => [t.id, t.title])
  );
  const titleOf = (id: string) =>
    TESTS.find((t) => t.id === id)?.title ?? serverTitles.get(id) ?? id;
  if (!slot) return;
  slot.outerHTML = `<div class="card server-results">
      <div class="solution-title">Your saved results</div>
      <ul class="score-breakdown">
        ${attempts
          .filter((a) => a.status !== "progress")
          .slice(0, 10)
          .map((a) => {
            const when = new Date(a.completedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
            // A score only once the teacher has opened the paper. Until then
            // the row says the work is in, which is all a student can know.
            // A released paper is the thing to open: answers, correct answers
            // and worked solutions. One that is still shut opens nothing.
            const open = releasedTests.has(a.testId);
            return `<li class="${open ? "res-open" : "row-pending"}"${
              open ? ` data-result="${escapeHtml(a.testId)}" role="button" tabindex="0"` : ""
            }>
              <span>${escapeHtml(titleOf(a.testId))}</span>
              <span>${
                open
                  ? `${a.score}/${a.total} · ${when} ${ICONS.chevron}`
                  : `Handed in ${when} · waiting for your teacher`
              }</span>
            </li>`;
          })
          .join("")}
      </ul>
    </div>`;

  document.querySelectorAll<HTMLElement>("[data-result]").forEach((row) => {
    const open = () => gotoTest(row.dataset.result!);
    row.addEventListener("click", open);
    row.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    });
  });
}
