// Results for one test: who took it, how they did, and one button that opens
// the answers to everyone who did.
//
// The student report answers "how is Priya doing"; this answers "how did the
// class do on this test" — the question a teacher has the morning after a
// test shared by link, when the people who took it may not even be a class
// they know by name. One listing (`/api/reports?testId=`, the roster walked
// once with only this test's attempts kept), one release state, no N+1.
//
// Release is the existing class-wide switch for the test: "everyone who sat
// it" is what `*` has always meant, so nothing new is written.

import { track } from "../analytics";
import { fetchServerTest } from "../api";
import { fetchReleaseState, fetchReports, setReleased } from "../auth";
import { escapeHtml, pct, setUrl, whenLabel } from "../dom";
import { mount, skeleton } from "../shell";
import { notice } from "../dialog";
import { openStudentPaper } from "./marking";
import { showMyTests } from "./console";

export function showTestResults(testId: string, back?: () => void): void {
  setUrl({ results: testId });
  track("results_open", { test: testId });
  mount(`${skeleton.card(2)}${skeleton.table(3, 4)}`, { title: "Results", active: "mytests", width: "wide" });
  const leave = back ?? showMyTests;

  void (async () => {
    const [test, students, release] = await Promise.all([
      fetchServerTest(testId),
      fetchReports(undefined, testId),
      fetchReleaseState(testId),
    ]);
    const page = document.querySelector(".shell-main .page");
    if (!page) return;
    if (!test || !students) {
      page.innerHTML = `
        <div class="card"><p class="login-error">Could not load the results — go back and retry.</p>
        <div class="actions"><button id="res-back" class="btn btn-ghost">Back</button></div></div>`;
      document.getElementById("res-back")!.addEventListener("click", leave);
      return;
    }

    // One row per student who has anything on this test: their newest
    // finished attempt, or the paper in progress when there is none.
    const rows = students
      .map((s) => {
        const done = (s.attempts ?? []).filter((a) => a.status !== "progress");
        const inFlight = (s.attempts ?? []).find((a) => a.status === "progress");
        return { s, best: done[0] ?? null, tries: done.length, inFlight };
      })
      .filter((r) => r.best || r.inFlight);
    const finished = rows.filter((r) => r.best);
    const avg = finished.length
      ? Math.round(finished.reduce((sum, r) => sum + pct(r.best!.score, r.best!.total), 0) / finished.length)
      : 0;
    let classWide = !!release?.classWide;

    const rowMarkup = (r: (typeof rows)[number]) => {
      const who = `<td class="cell-strong">${escapeHtml(r.s.name || r.s.username)}<div class="hint">${escapeHtml(
        r.s.via === "google" ? r.s.email || "joined by link" : r.s.username
      )}</div></td>`;
      if (!r.best) {
        return `<tr class="row-inflight">${who}
          <td>${escapeHtml(whenLabel(r.inFlight?.updatedAt))}<div class="hint">last worked on</div></td>
          <td class="cell-mono">—</td>
          <td><span class="status-chip status-new">In progress</span></td>
          <td class="cell-actions"><button class="btn-link res-paper" data-user="${escapeHtml(r.s.username)}" data-name="${escapeHtml(r.s.name)}">See what they have so far</button></td>
        </tr>`;
      }
      const p = pct(r.best.score, r.best.total);
      return `<tr>${who}
        <td>${escapeHtml(whenLabel(r.best.completedAt))}${r.tries > 1 ? `<div class="hint">${r.tries} attempts</div>` : ""}</td>
        <td class="cell-mono">${r.best.score}/${r.best.total}</td>
        <td><span class="status-chip ${p >= 50 ? "status-done" : "status-wrong"}">${p}%</span></td>
        <td class="cell-actions"><button class="btn-link res-paper" data-user="${escapeHtml(r.s.username)}" data-name="${escapeHtml(r.s.name)}">Open &amp; mark</button></td>
      </tr>`;
    };

    page.innerHTML = `
      <div class="card">
        <h2 class="landing-title">${escapeHtml(test.title)}</h2>
        <p class="hint">${escapeHtml([test.chapter, `${test.questions.length} questions`].filter(Boolean).join(" · "))}</p>
        <div class="report-stats">
          <div class="report-stat"><div class="report-stat-num">${rows.length}</div><div class="report-stat-label">students took it</div></div>
          <div class="report-stat"><div class="report-stat-num">${finished.length}</div><div class="report-stat-label">handed in</div></div>
          <div class="report-stat"><div class="report-stat-num">${avg}%</div><div class="report-stat-label">average score</div></div>
        </div>
      </div>
      <div class="card">
        <div class="solution-title">Release the answers</div>
        <p class="hint">Until you release, students see neither their marks nor the answers. This opens the paper — marks, correct answers and worked solutions — to everyone who took it, and anyone who takes it later.</p>
        <div class="rel-rows"><div class="rel-row" data-test="${escapeHtml(testId)}">
          <span class="rel-meta rel-state" id="res-state"></span>
          <button class="btn ${classWide ? "btn-ghost" : "btn-primary"}" id="res-release"></button>
        </div></div>
      </div>
      <div class="card roster-card">
        <div class="solution-title">Who took it</div>
        ${
          rows.length
            ? `<div class="table-wrap"><table class="data-table">
                <thead><tr><th>Student</th><th>When</th><th>Score</th><th>Result</th><th></th></tr></thead>
                <tbody>${rows.map(rowMarkup).join("")}</tbody>
              </table></div>`
            : `<p class="hint">Nobody has taken this test yet. Share it by link, or publish it to your students.</p>`
        }
      </div>
      <div class="actions">
        <button id="res-back" class="btn btn-ghost">Back</button>
      </div>`;

    const stateEl = document.getElementById("res-state")!;
    const releaseBtn = document.getElementById("res-release") as HTMLButtonElement;
    const paintRelease = () => {
      stateEl.textContent = classWide ? "Open to everyone who took it" : "Locked — nothing shown yet";
      releaseBtn.textContent = classWide ? "Hide again" : "Release to everyone";
      releaseBtn.className = `btn ${classWide ? "btn-ghost" : "btn-primary"}`;
    };
    paintRelease();
    releaseBtn.addEventListener("click", async () => {
      releaseBtn.disabled = true;
      const ok = await setReleased(testId, { released: !classWide });
      releaseBtn.disabled = false;
      if (!ok) {
        notice("Could not change the release — try again.");
        return;
      }
      classWide = !classWide;
      track(classWide ? "answers_released" : "answers_hidden", { test: testId, scope: "class" });
      paintRelease();
    });

    document.getElementById("res-back")!.addEventListener("click", leave);
    document.querySelectorAll<HTMLButtonElement>(".res-paper").forEach((btn) =>
      btn.addEventListener("click", () =>
        void openStudentPaper({
          testId,
          username: btn.dataset.user!,
          name: btn.dataset.name,
          back: () => showTestResults(testId, back),
        })
      )
    );
  })();
}
