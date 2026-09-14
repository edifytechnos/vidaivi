// The teacher's marking queue: **a list of what is waiting, and nothing more.**
//
// It used to carry its own detail pane — a bespoke screen with the photo, the
// model solution and a marks row, laid out unlike anywhere else in the app. A
// teacher could mark from it but could not see the rest of the paper: not the
// MCQs the student got wrong, not the marks already earned. So the queue now
// answers only "who is waiting", and opening one lands in the ordinary paper
// view (src/screens/review.ts) with marking switched on — the same screen the
// student reads their result on, which is the one shape everybody already
// knows.

import { track } from "../analytics";
import { fetchMarkingQueue, fetchMyAttempt, type GradedAnswer } from "../auth";
import { fetchServerTest } from "../api";
import { TESTS } from "../data";
import { escapeHtml, ICONS, setUrl } from "../dom";
import { mount, skeleton } from "../shell";
import { showReviewFor } from "./test";
import type { Attempt, Test } from "../types";

const testCache = new Map<string, Test | null>();

async function loadTest(id: string): Promise<Test | null> {
  if (testCache.has(id)) return testCache.get(id)!;
  const bundled = TESTS.find((t) => t.id === id) ?? null;
  const test = bundled ?? (await fetchServerTest(id));
  testCache.set(id, test);
  return test;
}

/**
 * Open one student's paper with marking switched on, at a chosen question.
 *
 * The one way into marking, used by the queue and by the student's report, so
 * a teacher only ever learns one screen. `showReview` reads the question from
 * the address bar, so the place is set before it paints.
 */
export async function openStudentPaper(opts: {
  testId: string;
  username: string;
  name?: string;
  questionId?: string;
  back: () => void;
}): Promise<void> {
  mount(skeleton.editor(), { title: "Marking", active: "mark", full: true, scroll: "page" });
  const [test, remote] = await Promise.all([
    loadTest(opts.testId),
    fetchMyAttempt(opts.testId, opts.username),
  ]);
  if (!test) {
    mount(
      `<main class="card">
         <p class="login-error">That paper could not be opened.</p>
         <p class="hint">The test it belongs to has been deleted, so there is nothing left
         to mark against. The answer stays in the queue until the test comes back or the
         student is removed.</p>
         <div class="actions"><button id="mk-back" class="btn btn-ghost">Back to the queue</button></div>
       </main>`,
      { title: "Marking", active: "mark", width: "narrow" }
    );
    document.getElementById("mk-back")!.addEventListener("click", opts.back);
    return;
  }
  // A photo reaches the queue as soon as it is uploaded, which can be long
  // before the paper is handed in — so there may be no finished attempt to
  // open. Fall back to the work in progress, and to an empty paper after
  // that: the long answer still has to be markable, and the rest of the
  // questions honestly read "Not answered" until the student gets to them.
  const done = remote.attempt;
  const attempt: Attempt = done?.answers
    ? {
        answers: done.answers,
        index: test.questions.length,
        completed: true,
        score: done.score,
        completedAt: done.completedAt,
        updatedAt: done.completedAt,
      }
    : {
        answers: remote.progress?.answers ?? {},
        index: remote.progress?.index ?? 0,
        completed: false,
        score: 0,
        updatedAt: remote.progress?.updatedAt ?? "",
      };
  if (opts.questionId) setUrl({ test: opts.testId, review: opts.questionId });
  track("marking_paper_open", { test: opts.testId });
  showReviewFor(test, attempt, opts.back, opts.username, opts.name, true);
}

/** One card per student-and-test, however many answers are waiting inside it. */
interface QueueGroup {
  username: string;
  name: string;
  testId: string;
  testTitle: string;
  questionIds: string[];
}

function groupQueue(rows: GradedAnswer[]): QueueGroup[] {
  const groups = new Map<string, QueueGroup>();
  for (const r of rows) {
    const key = `${r.username}~${r.testId}`;
    const g = groups.get(key) ?? {
      username: r.username,
      name: r.studentName || r.username,
      testId: r.testId,
      testTitle: r.testTitle || r.testId,
      questionIds: [],
    };
    g.questionIds.push(r.questionId);
    groups.set(key, g);
  }
  return [...groups.values()].sort(
    (a, b) => a.testTitle.localeCompare(b.testTitle) || a.name.localeCompare(b.name)
  );
}

export async function showMarking(): Promise<void> {
  setUrl({ mark: "1" });
  track("marking_open");
  mount(`<main class="card">${skeleton.card(4)}</main>`, {
    title: "To mark",
    active: "mark",
    width: "narrow",
  });

  const rows = await fetchMarkingQueue();
  if (!rows) {
    mount(
      `<main class="card"><p class="login-error">Could not load the marking queue. Try again in a moment.</p></main>`,
      { title: "To mark", active: "mark", width: "narrow" }
    );
    return;
  }
  if (!rows.length) {
    mount(
      `<main class="card empty-state">
         ${ICONS.mark}
         <h2 class="landing-title">Nothing to mark</h2>
         <p class="hint">When your students hand in a long answer with a photo of their
         working, it turns up here for you to mark.</p>
       </main>`,
      { title: "To mark", active: "mark", sub: "All caught up", width: "narrow" }
    );
    return;
  }

  const groups = groupQueue(rows);
  mount(
    `<main class="card">
       <h1 class="page-title">To mark</h1>
       <p class="hint">${rows.length} answer${rows.length === 1 ? "" : "s"} waiting across
       ${groups.length} paper${groups.length === 1 ? "" : "s"}. Opening one shows the whole
       paper — the marks already earned as well as the answers still to mark.</p>
       <div class="test-list">
         ${groups
           .map(
             (g) => `
           <button class="test-card" data-user="${escapeHtml(g.username)}"
                   data-test="${escapeHtml(g.testId)}" data-name="${escapeHtml(g.name)}"
                   data-q="${escapeHtml(g.questionIds[0])}">
             <div class="test-card-main">
               <div class="test-card-title">${escapeHtml(g.name)}</div>
               <div class="test-card-sub">${escapeHtml(g.testTitle)}</div>
             </div>
             <span class="status-chip status-progress">${g.questionIds.length} to mark</span>
           </button>`
           )
           .join("")}
       </div>
     </main>`,
    {
      title: "To mark",
      active: "mark",
      sub: `${rows.length} waiting`,
      width: "narrow",
    }
  );

  document.querySelector(".test-list")!.addEventListener("click", (e) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".test-card[data-test]");
    if (!card) return;
    void openStudentPaper({
      testId: card.dataset.test!,
      username: card.dataset.user!,
      name: card.dataset.name,
      questionId: card.dataset.q,
      back: () => void showMarking(),
    });
  });
}
