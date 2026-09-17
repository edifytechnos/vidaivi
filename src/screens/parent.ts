// Parent view: this account's children, and one child's results.
//
// A parent reaches a child two ways, and they are genuinely different. They can
// **add their own** — a login this account issues, capped at `parentMaxChildren`
// — or **link one their teacher already registered**, with a one-time code. For
// a release only the second existed, so the plan a parent was sold (up to three
// children of their own) had no button anywhere and the screen was a dead end
// for anyone without a teacher.
//
// A parent still never marks or edits somebody else's student: a linked child is
// read-only exactly as before. What changed is that their OWN child is theirs.

import { track } from "../analytics";
import {
  fetchChildren,
  fetchServerTest,
  fetchTestList,
  redeemParentInvite,
  type Child,
} from "../api";
import {
  assessWholePaper,
  createStudentOrReason,
  fetchGrading,
  fetchMyAttempt,
  fetchMyAttempts,
  fetchMyCredits,
  getProfile,
} from "../auth";
import { openBuyCredits } from "./buy";
import { paymentsAvailable } from "../payments";
import { copyText, escapeHtml, setUrl } from "../dom";
import { openModal } from "../modal";
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
      <div id="pa-grid">${skeleton.cards(2)}</div>
    </main>`,
    {
      title: "My children",
      active: "children",
      width: "wide",
      actions: `<button id="pa-add" class="btn btn-primary">+ Add a child</button>`,
    }
  );
  document.getElementById("pa-add")!.addEventListener("click", () => openAddChild());

  const grid = document.getElementById("pa-grid")!;
  const children = (await fetchChildren()) ?? [];

  if (!children.length) {
    // Every Google account that is not a teacher carries the parent role, so
    // this is also where a brand-new signin lands. It must not be a dead end.
    grid.innerHTML = `
      <div class="card">
        <p class="hint">No children yet. Use <strong>Add a child</strong> above to
        create a login for your own child, or to link one with a code from their
        teacher.</p>
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

/**
 * One dialog, two ways in.
 *
 * The choice is about *which child this is* — mine, or one a teacher already
 * has on their roster — so it is a `cards` field rather than a setting, and the
 * fields under each branch appear only on that branch (`showWhen`).
 */
function openAddChild(): void {
  openModal({
    title: "Add a child",
    description: "Either create a login for your child, or link one their teacher already set up.",
    fields: [
      {
        name: "how",
        label: "",
        kind: "cards",
        required: true,
        choices: [
          {
            value: "own",
            label: "Create a login for my child",
            hint: "You get a username and password to give them. They sign in and sit the tests you pick.",
          },
          {
            value: "code",
            label: "Link a child my teacher registered",
            hint: "Use the one-time code their teacher gave you. You watch their results; the teacher marks.",
          },
        ],
      },
      {
        name: "name",
        label: "Child's name",
        required: true,
        showWhen: { field: "how", value: "own" },
        placeholder: "Priya",
      },
      {
        name: "grade",
        label: "Class",
        showWhen: { field: "how", value: "own" },
        placeholder: "12",
      },
      {
        name: "code",
        label: "Invite code",
        required: true,
        showWhen: { field: "how", value: "code" },
        placeholder: "ABCD2345",
        hint: "From your child's teacher.",
      },
    ],
    submitLabel: (values) => (values.how === "code" ? "Link my child" : "Create the login"),
    onSubmit: async (values) => {
      if (values.how === "code") {
        const result = await redeemParentInvite(values.code || "");
        if (!result.ok) return result.message;
        track("parent_link_redeemed");
        void showChildren(true);
        return;
      }
      const { student, message } = await createStudentOrReason({
        name: (values.name || "").trim(),
        school: "",
        grade: (values.grade || "").trim(),
        // Their own number: this is the parent, and score reports go to them.
        parentPhone: getProfile()?.phone || "",
      });
      // The server's own words — a seat limit names the price, and "waiting to
      // be approved" is not the same thing as a failure.
      if (!student) return message || "Could not add that child.";
      track("parent_child_created");
      // AFTER this one closes, not during. `onSubmit` returning nothing makes
      // the caller close this dialog — which removes `modal-open` from the body
      // and restores focus to whatever opened it. Opening the next dialog from
      // inside the handler means that teardown lands on top of it.
      setTimeout(() => showNewLogin(student.name, student.username, student.password || ""), 0);
    },
  });
}

/**
 * The password is shown **once** — it is stored as a scrypt hash and cannot be
 * read back — so this says so plainly and puts Copy next to it rather than
 * leaving a parent to select it off the screen on a phone.
 */
function showNewLogin(name: string, username: string, password: string): void {
  openModal({
    title: `${name} can sign in now`,
    description: "Write this down or copy it — the password is not shown again. You can reset it later from this screen.",
    fields: [
      { name: "username", label: "Username", value: username, readonly: true },
      { name: "password", label: "Password", value: password, readonly: true },
    ],
    submitLabel: "Copy and finish",
    onSubmit: async () => {
      await copyText(`Vidai login for ${name}\nUsername: ${username}\nPassword: ${password}`);
      void showChildren(true);
    },
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
    <div id="pa-credits"></div>
    <div id="pa-tests">${skeleton.list(3)}</div>`,
    { title: child.name, sub: "Test results", active: "children", width: "narrow" }
  );

  // One render, four calls, in parallel. The grading rows come back for the
  // whole child rather than per test: one request per row would be an N+1 from
  // a phone, which is the same rule the results list already follows.
  const [list, attempts, graded, credits] = await Promise.all([
    fetchTestList(undefined, child.username),
    fetchMyAttempts(child.username),
    child.own ? fetchGrading({ student: child.username }) : Promise.resolve([]),
    child.own ? fetchMyCredits() : Promise.resolve(null),
  ]);
  const host = document.getElementById("pa-tests")!;
  const tests = list?.tests ?? [];

  // How many answers on each paper are still waiting to be marked. That number
  // IS the cost of the button, so it is what the button says.
  const waiting = new Map<string, number>();
  for (const g of graded) {
    if (g.status === "submitted") waiting.set(g.testId, (waiting.get(g.testId) ?? 0) + 1);
  }
  renderCredits(credits, child);

  if (!tests.length) {
    host.innerHTML = `<p class="hint">No tests shared with ${escapeHtml(child.name)} yet.</p>`;
    return;
  }
  // Newest first, so a retake's score is the one shown.
  const scores = new Map<string, { score: number; total: number }>();
  const started = new Map<string, number>();
  for (const a of [...(attempts ?? [])].reverse()) {
    if (a.status === "progress") started.set(a.testId, a.index ?? 0);
    else scores.set(a.testId, { score: a.score, total: a.total });
  }

  host.innerHTML = `<div class="test-list">${tests
    .map((t) => {
      const done = scores.get(t.id);
      const at = started.get(t.id) ?? 0;
      const status = done
        ? `<span class="status-chip status-done">Score ${done.score}/${done.total}</span>`
        : at > 0
          ? `<span class="status-chip status-progress">In progress · Q${at + 1} of ${t.questionCount}</span>`
          : `<span class="status-chip status-new">Not started</span>`;
      // The one click. It appears only on a paper with answers still waiting
      // and only for this parent's OWN child — a linked child's paper belongs
      // to the teacher who issued their login, and this parent marks nothing
      // on it.
      const todo = waiting.get(t.id) ?? 0;
      const mark =
        child.own && todo > 0
          ? `<button class="btn btn-primary pa-mark" data-test="${escapeHtml(t.id)}"
               data-todo="${todo}">Mark ${todo} &amp; release</button>`
          : "";
      return `
      <div class="pa-row">
        <button class="test-card" data-test="${escapeHtml(t.id)}" ${done ? "" : "disabled"}>
          <div class="test-card-main">
            <div class="test-card-title">${escapeHtml(t.title)}</div>
            <div class="test-card-sub">${t.questionCount} questions · ${t.totalMarks} marks</div>
          </div>
          ${status}
        </button>
        ${mark}
      </div>`;
    })
    .join("")}</div>`;

  host.querySelectorAll<HTMLButtonElement>(".test-card[data-test]:not([disabled])").forEach((card) =>
    card.addEventListener("click", () => void openChildReview(child, card.dataset.test!))
  );
  host.querySelectorAll<HTMLButtonElement>(".pa-mark").forEach((btn) =>
    btn.addEventListener("click", () => void markWholePaper(child, btn))
  );
}

/** The parent's balance, with the way to top it up beside it. */
function renderCredits(
  credits: { left: number; granted: number; low: boolean } | null,
  child: Child
): void {
  const host = document.getElementById("pa-credits");
  if (!host) return;
  // A balance that could not be read says NOTHING. The server's gate is the
  // real limit, and a network blip must neither claim a parent is out nor
  // reassure them that they are not — the same rule the teacher's note keeps.
  if (!credits || !child.own) {
    host.innerHTML = "";
    return;
  }
  const buy =
    paymentsAvailable()
      ? `<button id="pa-topup" class="btn-link">Top up</button>`
      : "";
  host.innerHTML = `
    <div class="pa-credits${credits.low ? " credit-low" : ""}">
      <span><strong>${credits.left}</strong> of ${credits.granted} AI credits left${
        credits.low ? " — running low" : ""
      }</span>
      ${buy}
    </div>`;
  document.getElementById("pa-topup")?.addEventListener("click", () =>
    openBuyCredits(() => void showChildResults(child))
  );
}

/**
 * Mark every outstanding answer on one paper and open it to the child.
 *
 * The AI's marks become the child's marks here — see the note on
 * `POST /api/assess {action:"test"}`. The parent is the marker, and every mark
 * this writes is still theirs to change on the paper afterwards.
 */
async function markWholePaper(child: Child, btn: HTMLButtonElement): Promise<void> {
  const todo = Number(btn.dataset.todo) || 0;
  if (
    !confirm(
      `Mark ${todo} answer${todo === 1 ? "" : "s"} with AI and show ${child.name} the result?\n\n` +
        `This uses ${todo} credit${todo === 1 ? "" : "s"}. You can change any mark afterwards.`
    )
  ) {
    return;
  }
  const was = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Marking…";
  const res = await assessWholePaper(child.username, btn.dataset.test!);
  if (!res.ok) {
    btn.disabled = false;
    btn.textContent = was;
    // Out of credits is a decision, not a failure: it names the shortfall and
    // opens the way to fix it.
    if (res.short && paymentsAvailable()) {
      if (confirm(`${res.message}\n\nTop up now?`)) openBuyCredits(() => void showChildResults(child));
      return;
    }
    alert(res.message || "Could not mark this paper");
    return;
  }
  track("parent_marked_paper", { assessed: String(res.assessed ?? 0) });
  if (res.failed) {
    alert(
      `${res.assessed} marked and shown to ${child.name}. ${res.failed} could not be read — ` +
        `open the paper to mark those yourself.`
    );
  }
  void showChildResults(child);
}

/** The child's own answers and the worked solutions, read-only. */
async function openChildReview(child: Child, testId: string): Promise<void> {
  const [test, remote] = await Promise.all([
    // As the child: the paper lives in their teacher's partition, not this
    // parent's, so a read that does not name them cannot find it.
    fetchServerTest(testId, child.username),
    fetchMyAttempt(testId, child.username),
  ]);
  // Only a finished attempt is reviewable; a parent never sees a part-answered
  // paper, and the card for one is not clickable in the first place.
  const done = remote.attempt;
  if (!test || !done?.answers) {
    alert("That attempt could not be opened.");
    return;
  }
  const attempt: Attempt = {
    answers: done.answers,
    index: test.questions.length,
    completed: true,
    score: done.score,
    completedAt: done.completedAt,
    updatedAt: done.completedAt,
  };
  track("parent_review_open");
  showReviewFor(test, attempt, () => void showChildResults(child), child.username);
}
