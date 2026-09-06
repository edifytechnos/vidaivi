// Home screen: test list, profile row, cloud-saved results.

import { track } from "../analytics";
import {
  authEnabled,
  fetchMyAttempts,
  getProfile,
  isAdmin,
  isLoggedIn,
  isTeacher,
  signOut,
} from "../auth";
import { fetchServerTests } from "../api";
import { loadAttempt, requiresLogin, setGuest } from "../attempts";
import { TESTS, totalMarks } from "../data";
import { app, escapeHtml, gotoTest, ICONS, topbar } from "../dom";
import { showWelcome } from "./auth";
import { showAdmin, showTeacher } from "./console";

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
      <button id="signout-btn" class="btn-link">Sign out</button>
    </div>`;
}

export function showHome() {
  track("home_open");
  app.innerHTML = `
    ${topbar(false)}
    ${profileRow()}
    ${
      isAdmin()
        ? `<button id="admin-btn" class="test-card teacher-entry">
             <div class="test-card-row">
               <span class="nav-icon">${ICONS.shield}</span>
               <div class="test-card-main">
                 <div class="test-card-title">Teacher access</div>
                 <div class="test-card-sub">Manage which Google accounts have the teacher role</div>
               </div>
             </div>
           </button>`
        : ""
    }
    ${
      isTeacher()
        ? `<button id="teacher-btn" class="test-card teacher-entry">
             <div class="test-card-row">
               <span class="nav-icon">${ICONS.users}</span>
               <div class="test-card-main">
                 <div class="test-card-title">My students</div>
                 <div class="test-card-sub">Add students, share logins, view progress reports</div>
               </div>
             </div>
           </button>`
        : ""
    }
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
        const locked = requiresLogin(t);
        return `
        <button class="test-card" data-test="${t.id}">
          <div class="test-card-main">
            <div class="test-card-title">${locked ? ICONS.lock : ""}${escapeHtml(t.title)}</div>
            <div class="test-card-sub">${t.questions.length} questions · ${total} marks${locked ? " · sign in to attempt" : ""}</div>
          </div>
          ${status}
        </button>`;
      }).join("")}
    </div>`;
  app.querySelectorAll<HTMLButtonElement>(".test-card[data-test]").forEach((card) => {
    card.dataset.bound = "1";
    card.addEventListener("click", () => gotoTest(card.dataset.test!));
  });
  document.getElementById("signout-btn")?.addEventListener("click", () => {
    track("sign_out");
    signOut();
    setGuest(false);
    showWelcome();
  });
  document.getElementById("signin-btn")?.addEventListener("click", () => {
    setGuest(false);
    showWelcome();
  });
  document.getElementById("teacher-btn")?.addEventListener("click", showTeacher);
  document.getElementById("admin-btn")?.addEventListener("click", showAdmin);
  void renderServerTests();
  void renderServerResults();
}

// DB-backed published tests (teacher-authored / platform) merged into the
// same list, skipping ids already bundled in the build.
async function renderServerTests(): Promise<void> {
  if (!authEnabled || !isLoggedIn()) return;
  const server = await fetchServerTests();
  if (!server?.length) return;
  const bundled = new Set(TESTS.map((t) => t.id));
  const fresh = server.filter((t) => t.status === "published" && !bundled.has(t.id));
  if (!fresh.length) return;
  const list = document.querySelector(".test-list");
  if (!list) return;
  list.insertAdjacentHTML(
    "beforeend",
    fresh
      .map((t) => {
        const attempt = loadAttempt(t.id);
        let status = `<span class="status-chip status-new">Not started</span>`;
        if (attempt?.completed) {
          status = `<span class="status-chip status-done">Score ${attempt.score}/${t.totalMarks}</span>`;
        } else if (attempt && attempt.index > 0) {
          status = `<span class="status-chip status-progress">In progress · Q${attempt.index + 1} of ${t.questionCount}</span>`;
        }
        return `
        <button class="test-card" data-test="${escapeHtml(t.id)}">
          <div class="test-card-main">
            <div class="test-card-title">${escapeHtml(t.title)}</div>
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
