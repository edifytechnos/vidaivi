// Parent view: the children linked to this account, and one child's results.
// Strictly read-only — a parent watches, never writes. The server enforces
// that too; this screen simply never offers the controls.

import { track } from "../analytics";
import {
  fetchChildren,
  fetchServerTest,
  fetchTestList,
  redeemParentInvite,
  type Child,
} from "../api";
import { fetchMyAttempt, fetchMyAttempts } from "../auth";
import { escapeHtml, setUrl } from "../dom";
import { mount, skeleton } from "../shell";
import { showHome } from "./home";
import { showReviewFor } from "./test";
import type { Attempt } from "../types";

/** The children screen. One child goes straight through to their results. */
export async function showChildren(force = false): Promise<void> {
  setUrl();
  track("parent_children_open");
  mount(
    `
    <main class="subjects">
      <div class="subjects-head"><h2 class="subjects-title">Your children</h2></div>
      <div id="pa-form" class="card subject-form" hidden></div>
      <div id="pa-grid">${skeleton.cards(2)}</div>
    </main>`,
    {
      title: "My children",
      active: "children",
      width: "wide",
      actions: `<button id="pa-add" class="btn btn-primary">+ Add a child</button>`,
    }
  );
  document.getElementById("pa-add")!.addEventListener("click", () => openCodeForm());

  const grid = document.getElementById("pa-grid")!;
  const children = (await fetchChildren()) ?? [];

  if (!children.length) {
    // Every Google account that is not a teacher carries the parent role, so
    // this is also where a brand-new signin lands. It must not be a dead end.
    grid.innerHTML = `
      <div class="card">
        <p class="hint">No children linked yet. Ask your child's teacher for a code,
        then use <strong>Add a child</strong> above.</p>
        <div class="actions">
          <button id="pa-browse" class="btn btn-ghost">Browse the practice tests</button>
        </div>
      </div>`;
    document.getElementById("pa-browse")!.addEventListener("click", () => showHome(null));
    return;
  }
  // One child is not a choice worth making them click through.
  if (children.length === 1 && !force) {
    void showChildResults(children[0]);
    return;
  }
  grid.innerHTML = `<div class="subject-grid">${children
    .map(
      (c) => `
    <button class="subject-card" data-child="${escapeHtml(c.username)}">
      <span class="subject-mark">${escapeHtml((c.name || "?").slice(0, 1).toUpperCase())}</span>
      <span class="subject-name">${escapeHtml(c.name)}</span>
      <span class="subject-meta"><span class="subject-count">View results</span></span>
    </button>`
    )
    .join("")}</div>`;
  grid.querySelectorAll<HTMLElement>(".subject-card").forEach((el) =>
    el.addEventListener("click", () => {
      const child = children.find((c) => c.username === el.dataset.child);
      if (child) void showChildResults(child);
    })
  );
}

function openCodeForm(): void {
  const host = document.getElementById("pa-form");
  if (!host) return;
  host.hidden = false;
  host.innerHTML = `
    <h3 class="subject-form-title">Add a child</h3>
    <p class="hint">Enter the one-time code your child's teacher gave you.</p>
    <label class="ed-field">
      <span class="ed-panel-label">Invite code</span>
      <input class="ed-input" id="pa-code" placeholder="ABCD2345" autocapitalize="characters"
             autocomplete="off" spellcheck="false" maxlength="12" />
    </label>
    <p id="pa-error" class="login-error" hidden></p>
    <div class="actions">
      <button id="pa-redeem" class="btn btn-primary">Link my child</button>
      <button id="pa-cancel" class="btn btn-ghost">Cancel</button>
    </div>`;
  const err = document.getElementById("pa-error") as HTMLElement;
  const input = document.getElementById("pa-code") as HTMLInputElement;
  document.getElementById("pa-cancel")!.addEventListener("click", () => {
    host.hidden = true;
  });
  const submit = document.getElementById("pa-redeem") as HTMLButtonElement;
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    submit.textContent = "Linking…";
    const result = await redeemParentInvite(input.value);
    if (!result.ok) {
      err.textContent = result.message;
      err.hidden = false;
      submit.disabled = false;
      submit.textContent = "Link my child";
      return;
    }
    track("parent_link_redeemed");
    host.hidden = true;
    void showChildren(true);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") submit.click();
  });
}

/** One child's tests, with the score they actually got. */
export async function showChildResults(child: Child): Promise<void> {
  setUrl();
  track("parent_child_open");
  mount(
    `
    <div class="profile-row">
      <div class="profile-main">
        <div class="profile-name">${escapeHtml(child.name)}</div>
        <div class="profile-sub">Test results</div>
      </div>
    </div>
    <div id="pa-tests">${skeleton.list(3)}</div>`,
    { title: child.name, sub: "Test results", active: "children", width: "narrow" }
  );

  const [list, attempts] = await Promise.all([
    fetchTestList(undefined, child.username),
    fetchMyAttempts(child.username),
  ]);
  const host = document.getElementById("pa-tests")!;
  const tests = list?.tests ?? [];
  if (!tests.length) {
    host.innerHTML = `<p class="hint">No tests shared with ${escapeHtml(child.name)} yet.</p>`;
    return;
  }
  // Newest first, so a retake's score is the one shown.
  const scores = new Map<string, { score: number; total: number }>();
  for (const a of [...(attempts ?? [])].reverse()) {
    scores.set(a.testId, { score: a.score, total: a.total });
  }

  host.innerHTML = `<div class="test-list">${tests
    .map((t) => {
      const done = scores.get(t.id);
      const status = done
        ? `<span class="status-chip status-done">Score ${done.score}/${done.total}</span>`
        : `<span class="status-chip status-new">Not started</span>`;
      return `
      <button class="test-card" data-test="${escapeHtml(t.id)}" ${done ? "" : "disabled"}>
        <div class="test-card-main">
          <div class="test-card-title">${escapeHtml(t.title)}</div>
          <div class="test-card-sub">${t.questionCount} questions · ${t.totalMarks} marks</div>
        </div>
        ${status}
      </button>`;
    })
    .join("")}</div>`;

  host.querySelectorAll<HTMLButtonElement>(".test-card[data-test]:not([disabled])").forEach((card) =>
    card.addEventListener("click", () => void openChildReview(child, card.dataset.test!))
  );
}

/** The child's own answers and the worked solutions, read-only. */
async function openChildReview(child: Child, testId: string): Promise<void> {
  const [test, remote] = await Promise.all([
    fetchServerTest(testId),
    fetchMyAttempt(testId, child.username),
  ]);
  if (!test || !remote?.answers) {
    alert("That attempt could not be opened.");
    return;
  }
  const attempt: Attempt = {
    answers: remote.answers,
    index: test.questions.length,
    completed: true,
    score: remote.score,
    completedAt: remote.completedAt,
    updatedAt: remote.completedAt,
  };
  track("parent_review_open");
  showReviewFor(test, attempt, () => void showChildResults(child));
}
