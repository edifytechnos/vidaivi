// Teacher/admin console: shell + nav, teacher allowlist (admin),
// student roster, and per-student progress report.

import { track } from "../analytics";
import {
  createStudent,
  fetchReports,
  isAdmin,
  listStudents,
  listTeachers,
  modifyTeacher,
  removeStudent,
  resetStudentPassword,
  signOut,
} from "../auth";
import { setGuest } from "../attempts";
import { TESTS, testTitle } from "../data";
import { app, copyText, escapeHtml, ICONS, pct, topbar } from "../dom";
import { fetchServerTests, mutateTest, setTestStatus } from "../api";
import { showWelcome } from "./auth";
import { showHome } from "./home";
import { showBuilder } from "./builder";

function consoleShell(
  active: "admin" | "students" | "report" | "tests",
  content: string
): string {
  return `
    ${topbar(true)}
    <div class="console">
      <aside class="console-nav">
        <div class="console-nav-title">Console</div>
        <button class="console-link${active === "students" || active === "report" ? " active" : ""}" id="nav-students">${ICONS.users}<span>My students</span></button>
        <button class="console-link${active === "tests" ? " active" : ""}" id="nav-tests">${ICONS.home}<span>My tests</span></button>
        ${isAdmin() ? `<button class="console-link${active === "admin" ? " active" : ""}" id="nav-admin">${ICONS.shield}<span>Teacher access</span></button>` : ""}
        <button class="console-link" id="nav-home">${ICONS.home}<span>All tests</span></button>
        <button class="console-link" id="nav-signout">${ICONS.logout}<span>Sign out</span></button>
      </aside>
      <main class="console-main">${content}</main>
    </div>`;
}

function bindConsoleNav(): void {
  document.getElementById("nav-students")?.addEventListener("click", showTeacher);
  document.getElementById("nav-tests")?.addEventListener("click", showMyTests);
  document.getElementById("nav-admin")?.addEventListener("click", showAdmin);
  document.getElementById("nav-home")?.addEventListener("click", showHome);
  document.getElementById("nav-signout")?.addEventListener("click", () => {
    track("sign_out");
    signOut();
    setGuest(false);
    showWelcome();
  });
}

// ---------- Teacher: my tests (DB-backed) ----------

export function showMyTests() {
  track("mytests_open");
  app.innerHTML = consoleShell(
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
          <button id="mt-open-import" class="btn btn-ghost">Import JSON instead</button>
        </div>
      </div>
      <div class="card roster-card">
        <div class="solution-title">Your tests</div>
        <div id="mt-list"><p class="hint">Loading…</p></div>
      </div>`
  );
  bindConsoleNav();

  const importBox = document.getElementById("mt-import") as HTMLElement;
  const openRow = document.getElementById("mt-open-import-row") as HTMLElement;
  const jsonEl = document.getElementById("mt-json") as HTMLTextAreaElement;
  const errEl = document.getElementById("mt-error") as HTMLElement;
  const listEl = document.getElementById("mt-list")!;

  document.getElementById("mt-new")!.addEventListener("click", () => {
    void showBuilder(null, showMyTests);
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
    const tests = await fetchServerTests();
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
          <thead><tr><th>Title</th><th>Chapter</th><th>Questions</th><th>Marks</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${mine
              .map((t) => {
                const chip =
                  t.status === "published"
                    ? `<span class="status-chip status-done">Published</span>`
                    : t.status === "archived"
                      ? `<span class="status-chip status-wrong">Archived</span>`
                      : `<span class="status-chip status-progress">Draft</span>`;
                const actions =
                  t.status === "published"
                    ? `<button class="btn-link mt-act" data-act="unpublish" data-id="${escapeHtml(t.id)}">Unpublish</button>
                       <button class="btn-link mt-act" data-act="archive" data-id="${escapeHtml(t.id)}">Archive</button>`
                    : t.status === "draft"
                      ? `<button class="btn-link mt-edit" data-id="${escapeHtml(t.id)}">Edit</button>
                         <button class="btn-link mt-act" data-act="publish" data-id="${escapeHtml(t.id)}">Publish</button>
                         <button class="btn-link mt-act" data-act="delete" data-id="${escapeHtml(t.id)}">Delete</button>`
                      : `<button class="btn-link mt-act" data-act="unpublish" data-id="${escapeHtml(t.id)}">Back to draft</button>`;
                return `<tr>
                  <td class="cell-strong">${escapeHtml(t.title)}${t.platform ? ` <span class="chip">platform</span>` : ""}</td>
                  <td>${escapeHtml(t.chapter || "—")}</td>
                  <td>${t.questionCount}</td>
                  <td class="cell-mono">${t.totalMarks}</td>
                  <td>${chip}</td>
                  <td class="cell-actions">${actions}</td>
                </tr>`;
              })
              .join("")}
          </tbody>
        </table>
      </div>`;
    listEl.querySelectorAll<HTMLButtonElement>(".mt-edit").forEach((btn) =>
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
  track("admin_open");
  app.innerHTML = consoleShell(
    "admin",
    `
      <div class="card">
        <h2 class="landing-title">Teacher access</h2>
        <p class="hint">Gmail addresses listed here get the teacher role when
        they sign in with Google — they can manage students and share logins.</p>
        <input id="te-email" class="numeric-input" type="email" autocapitalize="none"
               spellcheck="false" placeholder="teacher@gmail.com" />
        <p id="te-error" class="login-error" hidden></p>
        <div class="actions">
          <button id="te-add" class="btn btn-primary" disabled>Add teacher</button>
        </div>
      </div>
      <div class="card roster-card">
        <div class="solution-title">Allowed teachers</div>
        <div id="te-list"><p class="hint">Loading…</p></div>
      </div>`
  );
  bindConsoleNav();

  const emailEl = document.getElementById("te-email") as HTMLInputElement;
  const addBtn = document.getElementById("te-add") as HTMLButtonElement;
  const errEl = document.getElementById("te-error") as HTMLElement;
  const listEl = document.getElementById("te-list")!;

  emailEl.addEventListener("input", () => {
    addBtn.disabled = !emailEl.value.includes("@");
  });

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

  addBtn.addEventListener("click", async () => {
    addBtn.disabled = true;
    addBtn.textContent = "Adding…";
    errEl.hidden = true;
    const result = await modifyTeacher("add", emailEl.value.trim());
    addBtn.textContent = "Add teacher";
    if (result.ok) {
      emailEl.value = "";
      void refresh();
    } else {
      errEl.textContent = result.message || "Could not add teacher.";
      errEl.hidden = false;
      addBtn.disabled = false;
    }
  });

  void refresh();
}

// ---------- Teacher: student progress report ----------

export function showStudentReport(username: string) {
  track("report_open", { student: username });
  app.innerHTML = consoleShell(
    "report",
    `<div class="card"><p class="hint">Loading report…</p></div>`
  );
  bindConsoleNav();

  void (async () => {
    const students = await fetchReports(username);
    const s = students?.[0];
    if (!s) {
      app.querySelector(".console-main")!.innerHTML = `
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

    app.querySelector(".console-main")!.innerHTML = `
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
                <thead><tr><th>Test</th><th>Completed</th><th>Score</th><th>Result</th></tr></thead>
                <tbody>${attempts
                  .map((a) => {
                    const p = pct(a.score, a.total);
                    return `<tr>
                      <td class="cell-strong">${escapeHtml(testTitle(a.testId))}</td>
                      <td>${new Date(a.completedAt).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" })}</td>
                      <td class="cell-mono">${a.score}/${a.total}</td>
                      <td><span class="status-chip ${p >= 50 ? "status-done" : "status-wrong"}">${p}%</span></td>
                    </tr>`;
                  })
                  .join("")}</tbody>
              </table></div>`
            : `<p class="hint">No attempts yet — share the login and the test link.</p>`
        }
      </div>
      <div class="actions">
        <button id="rep-back" class="btn btn-ghost">Back to students</button>
      </div>`;
    document.getElementById("rep-back")!.addEventListener("click", showTeacher);
  })();
}

// ---------- Teacher: student roster ----------

function credentialMessage(s: { name: string; username: string; password: string }): string {
  return (
    `Hi! Here are ${s.name}'s login details for Vidaivi maths practice tests:\n\n` +
    `Username: ${s.username}\nPassword: ${s.password}\n\n` +
    `Open https://vidaivi.seyali.app , tap "Student login" and enter these to start.`
  );
}

export function showTeacher() {
  track("teacher_open");
  app.innerHTML = consoleShell(
    "students",
    `
      <div class="card">
        <h2 class="landing-title">My students</h2>
        <p class="hint">Add a student to generate their username and password,
        then share it on WhatsApp. Passwords are shown only once — use Reset if lost.</p>
        <input id="st-name" class="numeric-input" type="text" placeholder="Student name *" />
        <input id="st-school" class="numeric-input" type="text" placeholder="School name" />
        <input id="st-grade" class="numeric-input" type="text" placeholder="Grade (e.g. 12-A)" />
        <input id="st-phone" class="numeric-input" type="tel" inputmode="tel" placeholder="Parent's WhatsApp number" />
        <p id="st-error" class="login-error" hidden></p>
        <div class="actions">
          <button id="st-add" class="btn btn-primary" disabled>Add student</button>
        </div>
        <div id="st-created"></div>
      </div>
      <div class="card roster-card">
        <div class="solution-title">Students</div>
        <div id="st-list"><p class="hint">Loading…</p></div>
      </div>`
  );
  bindConsoleNav();

  const nameEl = document.getElementById("st-name") as HTMLInputElement;
  const schoolEl = document.getElementById("st-school") as HTMLInputElement;
  const gradeEl = document.getElementById("st-grade") as HTMLInputElement;
  const phoneEl = document.getElementById("st-phone") as HTMLInputElement;
  const addBtn = document.getElementById("st-add") as HTMLButtonElement;
  const errEl = document.getElementById("st-error") as HTMLElement;
  const createdEl = document.getElementById("st-created")!;
  const listEl = document.getElementById("st-list")!;

  nameEl.addEventListener("input", () => {
    addBtn.disabled = !nameEl.value.trim();
  });

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

  addBtn.addEventListener("click", async () => {
    addBtn.disabled = true;
    addBtn.textContent = "Adding…";
    errEl.hidden = true;
    const created = await createStudent({
      name: nameEl.value.trim(),
      school: schoolEl.value.trim(),
      grade: gradeEl.value.trim(),
      parentPhone: phoneEl.value.trim(),
    });
    addBtn.textContent = "Add student";
    if (created?.password) {
      track("student_created");
      createdEl.innerHTML = credentialCard({
        name: created.name,
        username: created.username,
        password: created.password,
      });
      bindCopyButtons(createdEl);
      nameEl.value = "";
      schoolEl.value = "";
      gradeEl.value = "";
      phoneEl.value = "";
      void refreshList();
    } else {
      errEl.textContent = "Could not add student — check your connection and try again.";
      errEl.hidden = false;
      addBtn.disabled = false;
    }
  });

  void refreshList();
}
