// The teacher's marking queue: every long answer a student has handed in and
// nobody has marked yet, worked through one at a time.
//
// It reuses the shared shell like every other page — this is a rail item, not
// a screen with its own chrome. The question text and the model solution are
// not in the grading row (they belong to the test), so the test is fetched
// once per test id and cached for the session.

import { track } from "../analytics";
import {
  fetchMarkingQueue,
  fetchReleaseState,
  saveMark,
  setReleased,
  type GradedAnswer,
} from "../auth";
import { fetchServerTest } from "../api";
import { TESTS } from "../data";
import { app, escapeHtml, formatText, ICONS, renderMath, setUrl } from "../dom";
import { hydrateThumbs, photoStrip } from "../answerphotos";
import { mount, skeleton } from "../shell";
import type { Question, Test } from "../types";

const testCache = new Map<string, Test | null>();

async function loadTest(id: string): Promise<Test | null> {
  if (testCache.has(id)) return testCache.get(id)!;
  const bundled = TESTS.find((t) => t.id === id) ?? null;
  const test = bundled ?? (await fetchServerTest(id));
  testCache.set(id, test);
  return test;
}

function queueMarkup(rows: GradedAnswer[], activeIndex: number): string {
  let lastTest = "";
  const items = rows
    .map((r, i) => {
      const head =
        r.testId === lastTest
          ? ""
          : `<div class="queue-group">${escapeHtml(r.testTitle || r.testId)}</div>`;
      lastTest = r.testId;
      return `${head}
      <button type="button" class="qitem${i === activeIndex ? " active" : ""}" data-mark-i="${i}">
        <span class="qitem-top">
          <span class="qitem-name">${escapeHtml(r.studentName || r.username)}</span>
          <span class="qitem-marks">/${r.maxMarks}</span>
        </span>
        <span class="qitem-sub">Q${r.questionIndex + 1} · ${r.images.length} photo${r.images.length === 1 ? "" : "s"}</span>
      </button>`;
    })
    .join("");
  return `<aside class="queue" id="mark-queue">
    <div class="queue-head">${rows.length} waiting</div>
    ${items}
  </aside>`;
}

function detailMarkup(row: GradedAnswer, q: Question | null, position: string): string {
  const initials = (row.studentName || row.username)
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  return `
    <section class="detail" id="mark-detail">
      <div class="detail-head">
        <span class="avatar">${escapeHtml(initials)}</span>
        <div>
          <div class="detail-name">${escapeHtml(row.studentName || row.username)}
            <span class="detail-user">· ${escapeHtml(row.username)}</span></div>
          <div class="detail-sub">${escapeHtml(row.testTitle || row.testId)} · Question ${row.questionIndex + 1}
            ${row.submittedAt ? `· handed in ${new Date(row.submittedAt).toLocaleString()}` : ""}</div>
        </div>
      </div>

      <div class="pane">
        <div class="pane-title"><span>The question</span><span class="chip">${row.maxMarks} marks</span></div>
        ${q ? `<div class="question-text">${formatText(q.q)}</div>` : `<p class="hint">This question is no longer in the test — mark from the photo.</p>`}
      </div>

      <div class="split">
        <div class="pane">
          <div class="pane-title"><span>${escapeHtml(row.studentName || row.username)}'s working</span></div>
          ${row.images.length ? photoStrip(row.images, "Handed-in working") : `<p class="hint">No photo was handed in.</p>`}
        </div>
        <div class="pane">
          <div class="pane-title"><span>Model solution</span></div>
          ${q ? `<div class="sol">${formatText(q.solution)}</div>` : `<p class="hint">Not available.</p>`}
        </div>
      </div>

      <div class="pane pane-award">
        <div class="pane-title"><span>Award marks</span></div>
        <p class="hint">Nothing is shown to ${escapeHtml(row.studentName || row.username)} until you save a mark.</p>
        <div class="marks-row" id="mark-buttons">
          ${Array.from({ length: row.maxMarks + 1 })
            .map((_, n) => `<button type="button" class="mbtn" data-award="${n}">${n}</button>`)
            .join("")}
          <span class="mof">out of ${row.maxMarks}</span>
        </div>
        <textarea id="mark-comment" class="ta" rows="2"
                  placeholder="Comment for ${escapeHtml(row.studentName || row.username)} (optional)…"></textarea>
        <p class="login-error" id="mark-error" hidden></p>
        <div class="detail-foot">
          <button type="button" class="btn btn-primary" id="mark-save" disabled>Save mark</button>
          <button type="button" class="btn btn-ghost" id="mark-skip">Skip for now</button>
          <span class="pos">${position}</span>
        </div>
      </div>

      <div class="pane">
        <div class="pane-title">
          <span>Answers and explanations</span>
          <span id="rel-chip" class="status-chip status-new">Checking…</span>
        </div>
        <p class="hint">${escapeHtml(row.studentName || row.username)} can see their marks
        but not the answers or the worked solutions. Release when you are ready for them
        to study the paper.</p>
        <div class="detail-foot" style="margin-top:12px">
          <button type="button" class="btn btn-ghost" id="rel-one" disabled>Release to ${escapeHtml(row.studentName || row.username)}</button>
          <button type="button" class="btn btn-ghost" id="rel-all" disabled>Release to the whole class</button>
        </div>
      </div>
    </section>`;
}

/**
 * The two Release buttons under the marking pane. Read the real state first —
 * a teacher marking on a second device must not be told the wrong thing.
 */
async function wireRelease(row: GradedAnswer): Promise<void> {
  const chip = document.getElementById("rel-chip");
  const one = document.getElementById("rel-one") as HTMLButtonElement | null;
  const all = document.getElementById("rel-all") as HTMLButtonElement | null;
  if (!chip || !one || !all) return;

  const state = await fetchReleaseState(row.testId);
  let classWide = !!state?.classWide;
  let mine = !!state?.students.some((x) => x.username === row.username);

  const paint = () => {
    const open = classWide || mine;
    chip.className = `status-chip ${open ? "status-done" : "status-new"}`;
    chip.textContent = classWide ? "Open to the class" : mine ? "Released" : "Not released";
    one.textContent = mine
      ? `Hide again from ${row.studentName || row.username}`
      : `Release to ${row.studentName || row.username}`;
    one.disabled = classWide && !mine;
    all.textContent = classWide ? "Hide again from the class" : "Release to the whole class";
    all.disabled = false;
  };
  paint();

  const press = async (btn: HTMLButtonElement, scope: "student" | "class") => {
    btn.disabled = true;
    const wantOpen = scope === "class" ? !classWide : !mine;
    const ok = await setReleased(row.testId, {
      username: scope === "class" ? undefined : row.username,
      released: wantOpen,
    });
    if (ok) {
      track("answers_released", { test: row.testId, scope, open: wantOpen });
      if (scope === "class") classWide = wantOpen;
      else mine = wantOpen;
    }
    paint();
  };
  one.addEventListener("click", () => void press(one, "student"));
  all.addEventListener("click", () => void press(all, "class"));
}

export async function showMarking(): Promise<void> {
  setUrl({ mark: "1" });
  track("marking_open");
  mount(`<div class="mark-wrap">${skeleton.card(6)}</div>`, {
    title: "To mark",
    active: "mark",
    width: "wide",
  });

  const rows = await fetchMarkingQueue();
  if (!rows) {
    mount(
      `<main class="card"><p class="login-error">Could not load the marking queue. Try again in a moment.</p></main>`,
      { title: "To mark", active: "mark", width: "wide" }
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
      { title: "To mark", active: "mark", sub: "All caught up", width: "wide" }
    );
    return;
  }

  let index = 0;
  const remaining = rows.slice();

  async function render(): Promise<void> {
    if (!remaining.length) return void showMarking();
    if (index >= remaining.length) index = remaining.length - 1;
    const row = remaining[index];
    const test = await loadTest(row.testId);
    const q = test?.questions.find((x) => x.id === row.questionId) ?? null;

    mount(
      `<div class="mark-wrap">
         ${queueMarkup(remaining, index)}
         ${detailMarkup(row, q, `${index + 1} of ${remaining.length}`)}
       </div>`,
      {
        title: "To mark",
        active: "mark",
        sub: `${remaining.length} long answer${remaining.length === 1 ? "" : "s"} waiting`,
        width: "wide",
      }
    );
    renderMath(app);
    void hydrateThumbs(app);
    void wireRelease(row);

    let awarded: number | null = null;
    const save = document.getElementById("mark-save") as HTMLButtonElement;
    document.getElementById("mark-buttons")!.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-award]");
      if (!btn) return;
      awarded = Number(btn.dataset.award);
      document
        .querySelectorAll<HTMLElement>("#mark-buttons .mbtn")
        .forEach((b) => b.classList.toggle("sel", b === btn));
      save.disabled = false;
    });

    document.getElementById("mark-queue")!.addEventListener("click", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-mark-i]");
      if (!btn) return;
      index = Number(btn.dataset.markI);
      void render();
    });

    document.getElementById("mark-skip")!.addEventListener("click", () => {
      index = (index + 1) % remaining.length;
      void render();
    });

    save.addEventListener("click", async () => {
      if (awarded === null) return;
      save.disabled = true;
      save.textContent = "Saving…";
      const comment = (document.getElementById("mark-comment") as HTMLTextAreaElement).value.trim();
      const ok = await saveMark({
        username: row.username,
        testId: row.testId,
        questionId: row.questionId,
        awarded,
        comment,
      });
      if (!ok) {
        const err = document.getElementById("mark-error")!;
        err.textContent = "Could not save that mark. Try again.";
        err.hidden = false;
        save.disabled = false;
        save.textContent = "Save mark";
        return;
      }
      track("answer_marked", { test: row.testId, question: row.questionId, awarded });
      remaining.splice(index, 1);
      if (index >= remaining.length) index = 0;
      void render();
    });
  }

  await render();
}
