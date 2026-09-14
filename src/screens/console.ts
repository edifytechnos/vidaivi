// Teacher/admin console: shell + nav, teacher allowlist (admin),
// student roster, and per-student progress report.

import { track } from "../analytics";
import {
  createStudent,
  fetchReleaseState,
  fetchReports,
  isAdmin,
  listStudents,
  listTeachers,
  modifyTeacher,
  removeStudent,
  resetStudentPassword,
  setReleased,
  signOut,
  fetchTotpState,
  totpDisable,
  totpEnable,
  totpInit,
} from "../auth";
import { setGuest } from "../attempts";
import { TESTS, testTitle } from "../data";
import { copyText, escapeHtml, pct, setUrl } from "../dom";
import { openModal } from "../modal";
import { mount, skeleton } from "../shell";
import { createParentInvite, fetchTestList, mutateTest, setTestStatus } from "../api";
import { currentSubject } from "./home";
import { showBuilder } from "./builder";
import { newTestHere, showEditor } from "./editor";
import { audienceLabel, openAssign } from "./assign";
import { showSubjects } from "./subjects";
import { openStudentPaper } from "./marking";

type ConsolePage = "admin" | "students" | "report" | "tests";

const CONSOLE_TITLES: Record<ConsolePage, string> = {
  admin: "Teacher access",
  students: "My students",
  report: "Student report",
  tests: "My tests",
};

/** The console pages share the app shell; nothing is bespoke about their chrome. */
function consoleShell(active: ConsolePage, content: string, sub?: string): void {
  mount(content, {
    title: CONSOLE_TITLES[active],
    sub,
    active: active === "report" ? "students" : active === "tests" ? "mytests" : active,
    width: "wide",
  });
}

function bindConsoleNav(): void {
  // Navigation is the rail's now; nothing to bind per page.
}

// ---------- Teacher: my tests (DB-backed) ----------

export function showMyTests() {
  setUrl();
  track("mytests_open");
  consoleShell(
    "tests",
    `
      <div class="card">
        <h2 class="landing-title">My tests</h2>
        <p class="hint">Tests you author live in the cloud: build one as a draft,
        then publish to make it visible to your students on their home screen.</p>
        <div id="mt-import" style="display:none">
          <textarea id="mt-json" class="numeric-input" rows="8" spellcheck="false"
            placeholder='{"id":"my-test","title":"…","chapter":"…","questions":[…]}'></textarea>
          <p id="mt-error" class="login-error" hidden></p>
          <div class="actions">
            <button id="mt-create" class="btn btn-primary">Create draft</button>
            <button id="mt-cancel" class="btn btn-ghost">Cancel</button>
          </div>
        </div>
        <div class="actions" id="mt-open-import-row">
          <button id="mt-new" class="btn btn-primary">Create test</button>
          <button id="mt-quick" class="btn btn-ghost">Quick add</button>
          <button id="mt-open-import" class="btn btn-ghost">Import JSON instead</button>
        </div>
      </div>
      <div class="card">
        <div class="solution-title">Built-in tests</div>
        <p class="hint">Ready-made chapter tests live in the built-in subjects on
        <strong>Your subjects</strong>. Open one to read a chapter, then take your
        own copy — you can change anything in the copy before publishing it to
        your class. The library copy never changes — pick built-in tests when you
        create a subject, or with + in the tests tree.</p>
        <div class="actions">
          <button id="mt-library-open" class="btn btn-ghost">See built-in subjects</button>
        </div>
      </div>
      <div class="card roster-card">
        <div class="solution-title">Your tests</div>
        <div id="mt-list">${skeleton.table(3, 5)}</div>
      </div>`
  );
  bindConsoleNav();

  const importBox = document.getElementById("mt-import") as HTMLElement;
  const openRow = document.getElementById("mt-open-import-row") as HTMLElement;
  const jsonEl = document.getElementById("mt-json") as HTMLTextAreaElement;
  const errEl = document.getElementById("mt-error") as HTMLElement;
  const listEl = document.getElementById("mt-list")!;

  document.getElementById("mt-new")!.addEventListener("click", () => {
    void newTestHere(showMyTests);
  });
  document.getElementById("mt-quick")!.addEventListener("click", () => {
    void showBuilder(null, showMyTests);
  });
  document.getElementById("mt-library-open")!.addEventListener("click", () => {
    void showSubjects();
  });
  document.getElementById("mt-open-import")!.addEventListener("click", () => {
    importBox.style.display = "";
    openRow.style.display = "none";
  });
  document.getElementById("mt-cancel")!.addEventListener("click", () => {
    importBox.style.display = "none";
    openRow.style.display = "";
    errEl.hidden = true;
  });

  async function refresh() {
    // Seeding the sample drafts lives on the subjects screen now — that is the
    // one screen every signed-in teacher passes through.
    const list = await fetchTestList(currentSubject() ?? undefined);
    const tests = list?.tests ?? null;
    if (!tests) {
      listEl.innerHTML = `<p class="login-error">Could not load tests — refresh to retry.</p>`;
      return;
    }
    const mine = tests.filter((t) => !t.platform || isAdmin());
    if (!mine.length) {
      listEl.innerHTML = `<p class="hint">No cloud tests yet — create your first above.</p>`;
      return;
    }
    listEl.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr><th>Title</th><th>Chapter</th><th>Questions</th><th>Marks</th><th>Status</th><th>Seen by</th><th></th></tr></thead>
          <tbody>
            ${mine
              .map((t) => {
                const chip =
                  t.status === "published"
                    ? `<span class="status-chip status-done">Published</span>`
                    : t.status === "archived"
                      ? `<span class="status-chip status-wrong">Archived</span>`
                      : `<span class="status-chip status-progress">Draft</span>`;
                // A draft reaches nobody, whoever it is assigned to — say so
                // here rather than leaving a teacher to wonder where it went.
                const seenBy =
                  t.status === "published"
                    ? escapeHtml(audienceLabel(t))
                    : `<span class="cell-quiet">nobody yet</span>`;
                const actions =
                  t.status === "published"
                    ? `<button class="btn-link mt-act" data-act="unpublish" data-id="${escapeHtml(t.id)}">Unpublish</button>
                       <button class="btn-link mt-act" data-act="archive" data-id="${escapeHtml(t.id)}">Archive</button>`
                    : t.status === "draft"
                      ? `<button class="btn-link mt-edit" data-id="${escapeHtml(t.id)}">Edit</button>
                         <button class="btn-link mt-quickedit" data-id="${escapeHtml(t.id)}">Quick edit</button>
                         <button class="btn-link mt-act" data-act="publish" data-id="${escapeHtml(t.id)}">Publish</button>
                         <button class="btn-link mt-act" data-act="delete" data-id="${escapeHtml(t.id)}">Delete</button>`
                      : `<button class="btn-link mt-act" data-act="unpublish" data-id="${escapeHtml(t.id)}">Back to draft</button>`;
                return `<tr>
                  <td class="cell-strong">${escapeHtml(t.title)}${t.platform ? ` <span class="chip">platform</span>` : ""}${t.sample ? ` <span class="chip">sample</span>` : ""}</td>
                  <td>${escapeHtml(t.chapter || "—")}</td>
                  <td>${t.questionCount}</td>
                  <td class="cell-mono">${t.totalMarks}</td>
                  <td>${chip}</td>
                  <td>${seenBy}<br><button class="btn-link mt-assign" data-id="${escapeHtml(t.id)}">Change</button></td>
                  <td class="cell-actions">${actions}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`;
    listEl.querySelectorAll<HTMLButtonElement>(".mt-assign").forEach((btn) =>
      btn.addEventListener("click", () => {
        const test = mine.find((t) => t.id === btn.dataset.id);
        if (test) void openAssign(test, () => void refresh());
      })
    );
    listEl.querySelectorAll<HTMLButtonElement>(".mt-edit").forEach((btn) =>
      btn.addEventListener("click", () => {
        void showEditor(btn.dataset.id!, null, showMyTests);
      })
    );
    listEl.querySelectorAll<HTMLButtonElement>(".mt-quickedit").forEach((btn) =>
      btn.addEventListener("click", () => {
        void showBuilder(btn.dataset.id!, showMyTests);
      })
    );
    listEl.querySelectorAll<HTMLButtonElement>(".mt-act").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const act = btn.dataset.act as "publish" | "unpublish" | "archive" | "delete";
        if (act === "delete" && !confirm("Delete this draft permanently?")) return;
        btn.textContent = "…";
        const result = await setTestStatus(btn.dataset.id!, act);
        if (!result.ok) alert(result.message || "Action failed");
        void refresh();
      })
    );
  }

  document.getElementById("mt-create")!.addEventListener("click", async () => {
    errEl.hidden = true;
    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonEl.value);
    } catch {
      errEl.textContent = "Not valid JSON — check for missing commas or quotes.";
      errEl.hidden = false;
      return;
    }
    const result = await mutateTest("create", parsed as never);
    if (!result.ok) {
      errEl.textContent = result.message;
      errEl.hidden = false;
      return;
    }
    track("test_created", { test: result.test.id });
    jsonEl.value = "";
    importBox.style.display = "none";
    openRow.style.display = "";
    void refresh();
  });

  void refresh();
}

// ---------- Admin: teacher allowlist ----------

export function showAdmin() {
  setUrl();
  track("admin_open");
  consoleShell(
    "admin",
    `
      <div class="card">
        <h2 class="landing-title">Teacher access</h2>
        <p class="hint">Gmail addresses listed here get the teacher role when
        they sign in with Google — they can manage students and share logins.</p>
        <div class="actions">
          <button id="te-add" class="btn btn-primary">Add teacher</button>
        </div>
      </div>
      <div class="card roster-card">
        <div class="solution-title">Allowed teachers</div>
        <div id="te-list">${skeleton.table(2, 3)}</div>
      </div>
      <div class="card">
        <h2 class="landing-title">Two-step verification</h2>
        <p class="hint">The admin password opens every teacher, every student and
        every answer photo on Vidai. A code from your phone means a leaked
        password is not enough on its own.</p>
        <div id="totp-state" class="hint">Checking…</div>
        <div class="actions" id="totp-actions"></div>
      </div>`
  );
  bindConsoleNav();

  const addBtn = document.getElementById("te-add") as HTMLButtonElement;
  const listEl = document.getElementById("te-list")!;
  void refreshTotp();

  async function refresh() {
    const teachers = await listTeachers();
    if (!teachers) {
      listEl.innerHTML = `<p class="login-error">Could not load — refresh to retry.</p>`;
      return;
    }
    if (!teachers.length) {
      listEl.innerHTML = `<p class="hint">No teachers added yet.</p>`;
      return;
    }
    listEl.innerHTML = teachers
      .map(
        (t) => `
      <div class="roster-row">
        <div class="roster-main"><div class="roster-name">${escapeHtml(t.email)}</div></div>
        <button class="btn-link te-remove" data-email="${escapeHtml(t.email)}">Remove</button>
      </div>`
      )
      .join("");
    listEl.querySelectorAll<HTMLButtonElement>(".te-remove").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.textContent = "Removing…";
        await modifyTeacher("remove", btn.dataset.email!);
        void refresh();
      })
    );
  }

  /**
   * Setup is two modals because it is two steps for the person doing it: read
   * the key into the app, then prove the app is working before anything is
   * switched on. Enabling on the strength of the key alone would lock the admin
   * out of their own platform if they mistyped it.
   */
  async function refreshTotp() {
    const stateEl = document.getElementById("totp-state");
    const actionsEl = document.getElementById("totp-actions");
    if (!stateEl || !actionsEl) return;
    const state = await fetchTotpState();
    if (!state) {
      stateEl.innerHTML = `<span class="login-error">Could not load — refresh to retry.</span>`;
      actionsEl.innerHTML = "";
      return;
    }
    stateEl.innerHTML = state.enabled
      ? `<b>On.</b> Signing in asks for a code. ${state.recoveryLeft} recovery
         code${state.recoveryLeft === 1 ? "" : "s"} left.`
      : `<b>Off.</b> The password alone signs you in.`;
    actionsEl.innerHTML = state.enabled
      ? `<button id="totp-off" class="btn btn-ghost">Turn off</button>`
      : `<button id="totp-on" class="btn btn-primary">Set up</button>`;

    document.getElementById("totp-on")?.addEventListener("click", async () => {
      const started = await totpInit();
      if (!started.ok || !started.secret) {
        stateEl.innerHTML = `<span class="login-error">${escapeHtml(started.message || "Could not start setup.")}</span>`;
        return;
      }
      openModal({
        title: "Add Vidai to your authenticator",
        description:
          "In Google Authenticator, Authy or 1Password, add an account by hand and " +
          "type this key. Then enter the 6-digit code it shows.",
        fields: [
          { name: "key", label: "Setup key", value: started.secret, readonly: true },
          { name: "code", label: "6-digit code", required: true, placeholder: "123456" },
        ],
        submitLabel: "Turn on",
        onSubmit: async (values) => {
          const done = await totpEnable(String(values.code || ""));
          if (!done.ok) return done.message || "That did not work.";
          const codes = done.recoveryCodes || [];
          openModal({
            title: "Save these recovery codes",
            description:
              "Each one signs you in once, if your phone is lost. They are shown " +
              "now and never again — put them somewhere other than your phone.",
            fields: [{ name: "codes", label: "Recovery codes", value: codes.join("\n"), textarea: true, readonly: true }],
            submitLabel: "I have saved them",
            onSubmit: async () => {
              await refreshTotp();
            },
          });
        },
      });
    });

    document.getElementById("totp-off")?.addEventListener("click", () => {
      openModal({
        title: "Turn off two-step verification",
        description:
          "Enter a current code to confirm. A code is asked for rather than just " +
          "your password, so somebody who has taken your session cannot switch " +
          "this off.",
        fields: [{ name: "code", label: "6-digit code", required: true, placeholder: "123456" }],
        submitLabel: "Turn off",
        onSubmit: async (values) => {
          const done = await totpDisable(String(values.code || ""));
          if (!done.ok) return done.message || "That did not work.";
          await refreshTotp();
        },
      });
    });
  }

  addBtn.addEventListener("click", () =>
    openModal({
      title: "Add teacher",
      description:
        "This Gmail address gets the teacher role the next time they sign in with Google.",
      submitLabel: "Add teacher",
      fields: [
        {
          name: "email",
          label: "Gmail address",
          type: "email",
          placeholder: "teacher@gmail.com",
          required: true,
        },
      ],
      onSubmit: async (v) => {
        if (!v.email.includes("@")) return "That does not look like an email address.";
        const result = await modifyTeacher("add", v.email);
        if (!result.ok) return result.message || "Could not add teacher.";
        void refresh();
      },
    })
  );

  void refresh();
}

// ---------- Teacher: student progress report ----------

export function showStudentReport(username: string) {
  setUrl();
  track("report_open", { student: username });
  consoleShell("report", `${skeleton.card(2)}${skeleton.table(3, 4)}`);
  bindConsoleNav();

  void (async () => {
    const students = await fetchReports(username);
    const s = students?.[0];
    if (!s) {
      document.querySelector(".shell-main .page")!.innerHTML = `
        <div class="card"><p class="login-error">Could not load the report — go back and retry.</p>
        <div class="actions"><button id="rep-back" class="btn btn-ghost">Back</button></div></div>`;
      document.getElementById("rep-back")!.addEventListener("click", showTeacher);
      return;
    }

    const attempts = s.attempts ?? [];
    const attempted = new Set(attempts.map((a) => a.testId));
    const best = new Map<string, number>();
    for (const a of attempts) {
      best.set(a.testId, Math.max(best.get(a.testId) ?? 0, pct(a.score, a.total)));
    }
    const avgBest = best.size
      ? Math.round([...best.values()].reduce((x, y) => x + y, 0) / best.size)
      : 0;

    document.querySelector(".shell-main .page")!.innerHTML = `
      <div class="card">
        <h2 class="landing-title">${escapeHtml(s.name)}</h2>
        <p class="hint">${escapeHtml([s.username, s.grade, s.school].filter(Boolean).join(" · "))}${s.parentPhone ? ` · Parent: ${escapeHtml(s.parentPhone)}` : ""}</p>
        <div class="report-stats">
          <div class="report-stat"><div class="report-stat-num">${attempted.size}/${TESTS.filter((t) => t.access === "login").length || TESTS.length}</div><div class="report-stat-label">tests attempted</div></div>
          <div class="report-stat"><div class="report-stat-num">${attempts.length}</div><div class="report-stat-label">total attempts</div></div>
          <div class="report-stat"><div class="report-stat-num">${avgBest}%</div><div class="report-stat-label">avg best score</div></div>
        </div>
      </div>
      <div class="card roster-card">
        <div class="solution-title">Attempts (newest first)</div>
        ${
          attempts.length
            ? `<div class="table-wrap"><table class="data-table">
                <thead><tr><th>Test</th><th>Completed</th><th>Score</th><th>Result</th><th>Answers</th><th></th></tr></thead>
                <tbody>${attempts
                  .map((a) => {
                    const p = pct(a.score, a.total);
                    return `<tr>
                      <td class="cell-strong">${escapeHtml(testTitle(a.testId))}</td>
                      <td>${new Date(a.completedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                      <td class="cell-mono">${a.score}/${a.total}</td>
                      <td><span class="status-chip ${p >= 50 ? "status-done" : "status-wrong"}">${p}%</span></td>
                      <td class="rel-cell" data-test="${escapeHtml(a.testId)}"><span class="status-chip status-new">…</span></td>
                      <td class="cell-actions">
                        <button class="btn-link rep-paper" data-test="${escapeHtml(a.testId)}"
                                data-user="${escapeHtml(s.username)}" data-name="${escapeHtml(s.name)}">Open &amp; mark</button>
                        <button class="btn-link rel-toggle" data-test="${escapeHtml(a.testId)}" data-user="${escapeHtml(s.username)}">Release</button>
                      </td>
                    </tr>`;
                  })
                  .join("")}</tbody>
              </table></div>`
            : `<p class="hint">No attempts yet — share the login and the test link.</p>`
        }
      </div>
      ${
        attempts.length
          ? `<div class="card">
        <div class="solution-title">Release answers to the whole class</div>
        <p class="hint">Until you release a test, students see their marks but not the
        answers or the worked solutions. This opens it for everyone who sat it.</p>
        <div class="rel-rows" id="rel-class">${[...attempted]
          .map(
            (id) => `<div class="rel-row" data-test="${escapeHtml(id)}">
              <span class="rel-name">${escapeHtml(testTitle(id))}</span>
              <span class="rel-meta rel-state">Checking…</span>
              <button class="btn btn-ghost rel-class-toggle" data-test="${escapeHtml(id)}">Release to class</button>
            </div>`
          )
          .join("")}</div>
      </div>`
          : ""
      }
      <div class="actions">
        <button id="rep-back" class="btn btn-ghost">Back to students</button>
      </div>`;
    document.getElementById("rep-back")!.addEventListener("click", showTeacher);
    document.querySelectorAll<HTMLButtonElement>(".rep-paper").forEach((btn) =>
      btn.addEventListener("click", () =>
        void openStudentPaper({
          testId: btn.dataset.test!,
          username: btn.dataset.user!,
          name: btn.dataset.name,
          back: () => showStudentReport(btn.dataset.user!),
        })
      )
    );
    void paintRelease(s.username, [...attempted]);
  })();
}

/**
 * Fill in who each test is open for, then wire the two Release controls.
 * State is read per test rather than assumed, so a teacher opening the report
 * on a second device sees the truth.
 */
async function paintRelease(username: string, testIds: string[]): Promise<void> {
  const states = new Map<string, { classWide: boolean; mine: boolean }>();

  const load = async (id: string) => {
    const state = await fetchReleaseState(id);
    states.set(id, {
      classWide: !!state?.classWide,
      mine: !!state?.students.some((x) => x.username === username),
    });
  };
  await Promise.all(testIds.map(load));

  const paint = () => {
    for (const [id, state] of states) {
      const open = state.classWide || state.mine;
      document.querySelectorAll<HTMLElement>(`.rel-cell[data-test="${CSS.escape(id)}"]`).forEach((cell) => {
        cell.innerHTML = `<span class="status-chip ${open ? "status-done" : "status-new"}">${open ? "Released" : "Locked"}</span>`;
      });
      document.querySelectorAll<HTMLElement>(`.rel-toggle[data-test="${CSS.escape(id)}"]`).forEach((btn) => {
        btn.textContent = state.mine ? "Hide again" : state.classWide ? "Open to class" : "Release";
        btn.toggleAttribute("disabled", state.classWide && !state.mine);
      });
      const row = document.querySelector<HTMLElement>(`.rel-row[data-test="${CSS.escape(id)}"]`);
      if (row) {
        row.querySelector(".rel-state")!.textContent = state.classWide
          ? "Open to the whole class"
          : "Locked — students see marks only";
        row.querySelector(".rel-class-toggle")!.textContent = state.classWide
          ? "Hide again"
          : "Release to class";
      }
    }
  };
  paint();

  const container = document.querySelector(".shell-main .page");
  container?.addEventListener("click", async (e) => {
    const target = e.target as HTMLElement;
    const one = target.closest<HTMLElement>(".rel-toggle");
    const all = target.closest<HTMLElement>(".rel-class-toggle");
    const btn = one ?? all;
    if (!btn || btn.hasAttribute("disabled")) return;
    const id = btn.dataset.test!;
    const state = states.get(id);
    if (!state) return;

    btn.setAttribute("disabled", "");
    const wantOpen = all ? !state.classWide : !state.mine;
    const ok = await setReleased(id, {
      username: all ? undefined : username,
      released: wantOpen,
    });
    btn.removeAttribute("disabled");
    if (!ok) return;
    track(wantOpen ? "answers_released" : "answers_hidden", { test: id, scope: all ? "class" : "student" });
    if (all) state.classWide = wantOpen;
    else state.mine = wantOpen;
    paint();
  });
}

// ---------- Teacher: student roster ----------

function credentialMessage(s: { name: string; username: string; password: string }): string {
  return (
    `Hi! Here are ${s.name}'s login details for Vidai maths practice tests:\n\n` +
    `Username: ${s.username}\nPassword: ${s.password}\n\n` +
    `Open https://vidai.seyali.app , tap "Student login" and enter these to start.`
  );
}

function inviteMessage(s: { name: string; code: string }): string {
  return (
    `Hi! You can now follow ${s.name}'s maths practice results on Vidai.\n\n` +
    `Open https://vidai.seyali.app , sign in with Google, tap "Add a child" ` +
    `and enter this code:\n\n${s.code}\n\n` +
    `The code works once and is just for you.`
  );
}

export function showTeacher() {
  setUrl();
  track("teacher_open");
  consoleShell(
    "students",
    `
      <div class="card">
        <h2 class="landing-title">My students</h2>
        <p class="hint">Add a student to generate their username and password,
        then share it on WhatsApp. Passwords are shown only once — use Reset if lost.</p>
        <div class="actions">
          <button id="st-add" class="btn btn-primary">Add student</button>
        </div>
        <div id="st-created"></div>
      </div>
      <div class="card roster-card">
        <div class="solution-title">Students</div>
        <div id="st-list">${skeleton.table(3, 6)}</div>
      </div>`
  );
  bindConsoleNav();

  const addBtn = document.getElementById("st-add") as HTMLButtonElement;
  const createdEl = document.getElementById("st-created")!;
  const listEl = document.getElementById("st-list")!;

  function credentialCard(s: { name: string; username: string; password: string }): string {
    return `
      <div class="cred-card">
        <div class="cred-title">Login for ${escapeHtml(s.name)}</div>
        <div class="cred-line">Username: <strong>${escapeHtml(s.username)}</strong></div>
        <div class="cred-line">Password: <strong>${escapeHtml(s.password)}</strong></div>
        <button class="btn btn-primary cred-copy" data-name="${escapeHtml(s.name)}"
                data-user="${escapeHtml(s.username)}" data-pass="${escapeHtml(s.password)}">
          Copy WhatsApp message
        </button>
      </div>`;
  }

  function bindCopyButtons(root: HTMLElement) {
    root.querySelectorAll<HTMLButtonElement>(".cred-copy").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await copyText(
          credentialMessage({
            name: btn.dataset.name!,
            username: btn.dataset.user!,
            password: btn.dataset.pass!,
          })
        );
        btn.textContent = ok ? "Copied! Paste in WhatsApp" : "Copy failed — note it down manually";
      })
    );
  }

  function bindInviteCopy(root: HTMLElement) {
    root.querySelectorAll<HTMLButtonElement>(".invite-copy").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const ok = await copyText(
          inviteMessage({ name: btn.dataset.name!, code: btn.dataset.code! })
        );
        btn.textContent = ok ? "Copied! Paste in WhatsApp" : "Copy failed — note the code down";
      })
    );
  }

  async function refreshList() {
    const students = await listStudents();
    if (!students) {
      listEl.innerHTML = `<p class="login-error">Could not load students — refresh to retry.</p>`;
      return;
    }
    if (!students.length) {
      listEl.innerHTML = `<p class="hint">No students yet — add your first above.</p>`;
      return;
    }
    listEl.innerHTML = `
      <div class="table-wrap">
        <table class="data-table">
          <thead><tr>
            <th>Name</th><th>Username</th><th>Grade</th><th>School</th><th>Parent phone</th><th></th>
          </tr></thead>
          <tbody>
            ${students
              .map(
                (s) => `
              <tr>
                <td class="cell-strong">${escapeHtml(s.name)}</td>
                <td class="cell-mono">${escapeHtml(s.username)}</td>
                <td>${escapeHtml(s.grade || "—")}</td>
                <td>${escapeHtml(s.school || "—")}</td>
                <td>${escapeHtml(s.parentPhone || "—")}</td>
                <td class="cell-actions">
                  <button class="btn-link roster-report" data-user="${escapeHtml(s.username)}">Report</button>
                  <button class="btn-link roster-reset" data-user="${escapeHtml(s.username)}" data-name="${escapeHtml(s.name)}">Reset password</button>
                  <button class="btn-link roster-invite" data-user="${escapeHtml(s.username)}" data-name="${escapeHtml(s.name)}">Invite parent</button>
                  <button class="btn-link roster-remove" data-user="${escapeHtml(s.username)}" data-name="${escapeHtml(s.name)}">Remove</button>
                </td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
    listEl.querySelectorAll<HTMLButtonElement>(".roster-report").forEach((btn) =>
      btn.addEventListener("click", () => showStudentReport(btn.dataset.user!))
    );
    listEl.querySelectorAll<HTMLButtonElement>(".roster-invite").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.textContent = "Creating…";
        const result = await createParentInvite(btn.dataset.user!);
        btn.textContent = "Invite parent";
        if (!result.ok) {
          alert(result.message);
          return;
        }
        // A code is a key to this child's results — it is shown once, here,
        // for the teacher to hand over, and works for one parent only.
        createdEl.innerHTML = `
          <div class="cred-card">
            <div class="cred-title">Parent invite for ${escapeHtml(btn.dataset.name!)}</div>
            <div class="cred-line">Code: <strong>${escapeHtml(result.code)}</strong></div>
            <div class="cred-line cred-note">Works once, for one parent. They sign in with
            Google and enter it under “Add a child”.</div>
            <button class="btn btn-primary invite-copy" data-name="${escapeHtml(btn.dataset.name!)}"
                    data-code="${escapeHtml(result.code)}">
              Copy WhatsApp message
            </button>
          </div>`;
        bindInviteCopy(createdEl);
        createdEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
      })
    );
    listEl.querySelectorAll<HTMLButtonElement>(".roster-reset").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.textContent = "Resetting…";
        const result = await resetStudentPassword(btn.dataset.user!);
        if (result) {
          createdEl.innerHTML = credentialCard({
            name: btn.dataset.name!,
            username: result.username,
            password: result.password,
          });
          bindCopyButtons(createdEl);
          createdEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        btn.textContent = "Reset password";
      })
    );
    listEl.querySelectorAll<HTMLButtonElement>(".roster-remove").forEach((btn) =>
      btn.addEventListener("click", async () => {
        const name = btn.dataset.name!;
        if (
          !confirm(
            `Remove ${name} permanently?\n\nTheir login stops working and their ` +
              `test history is deleted. This cannot be undone.`
          )
        ) {
          return;
        }
        btn.textContent = "Removing…";
        const result = await removeStudent(btn.dataset.user!);
        if (!result.ok) {
          btn.textContent = "Remove";
          alert(result.message || "Could not remove this student.");
          return;
        }
        track("student_removed");
        void refreshList();
      })
    );
  }

  addBtn.addEventListener("click", () =>
    openModal({
      title: "Add student",
      description:
        "Their username and password are generated for you, and shown once — copy the WhatsApp message before you close it.",
      submitLabel: "Add student",
      fields: [
        { name: "name", label: "Student name", placeholder: "e.g. Ananya R", required: true },
        { name: "school", label: "School", placeholder: "e.g. DAV Public School" },
        { name: "grade", label: "Grade", placeholder: "e.g. 12-A" },
        {
          name: "parentPhone",
          label: "Parent's WhatsApp number",
          type: "tel",
          inputmode: "tel",
          placeholder: "e.g. 9876543210",
          hint: "Used to send the score report later.",
        },
      ],
      onSubmit: async (v) => {
        const created = await createStudent({
          name: v.name,
          school: v.school,
          grade: v.grade,
          parentPhone: v.parentPhone,
        });
        if (!created?.password) {
          return "Could not add student — check your connection and try again.";
        }
        track("student_created");
        createdEl.innerHTML = credentialCard({
          name: created.name,
          username: created.username,
          password: created.password,
        });
        bindCopyButtons(createdEl);
        void refreshList();
      },
    })
  );

  void refreshList();
}
