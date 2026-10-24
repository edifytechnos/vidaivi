// Joining a test by link: `?join=<token>`.
//
// A teacher shares a link and reads out an access code. The student opens the
// link, sees what it is — the test's name, how many questions, whose it is —
// signs in with Google, types the code, and the test opens. From then on they
// are a student of that teacher (a student session like any other), and the
// link is also the way back in once the session has run out.
//
// It is NOT the welcome screen's Google button: that one signs a teacher or a
// parent in, asks them to choose which, and asks for a phone number. Here the
// credential goes to `/api/join`, which makes a student and nothing else.
//
// A student of the same teacher who is already signed in needs only the code
// — and no code at all for a test they have joined already, which simply
// opens. Anybody signed in as somebody else is told to sign out first: joining
// would replace their session mid-whatever-they-were-doing.

import { track } from "../analytics";
import { fetchJoinInfo, joinTest, type JoinInfo } from "../api";
import { authEnabled, endSession, isLoggedIn, renderGoogleCredentialButton, saveStudentSession } from "../auth";
import { setGuest } from "../attempts";
import { ICONS, escapeHtml, paintPlain, setUrl, topbar } from "../dom";

/** The test, once joined: a full load, so the student workspace boots clean. */
function openTest(testId: string): void {
  location.assign(`./?test=${encodeURIComponent(testId)}`);
}

export async function showJoin(token: string): Promise<void> {
  setUrl({ join: token });
  track("join_open");
  paintPlain(`
    ${topbar(false)}
    <main class="card join auth-step">
      <p class="hint">Opening the test…</p>
    </main>`);

  const info = await fetchJoinInfo(token);
  if (!info) {
    paintPlain(`
      ${topbar(false)}
      <main class="card join auth-step">
        <h2 class="landing-title">This link does not open a test</h2>
        <p class="hint">It may have been copied wrongly, or the test has been removed. Ask your teacher for a fresh link.</p>
        <div class="actions"><a class="btn btn-ghost" href="./">Go to Vidai</a></div>
      </main>`);
    return;
  }

  // Already theirs: nothing to ask.
  if (info.student?.joined) {
    openTest(info.testId);
    return;
  }

  if (info.otherSession) {
    const whom =
      info.otherSession === "student" ? "another student" : info.otherSession === "admin" ? "the admin" : "a teacher or parent";
    paintPlain(`
      ${topbar(false)}
      <main class="card join auth-step">
        ${headerMarkup(info)}
        <p class="hint">You are signed in on this device as ${whom}. To join this test as a student, sign out first and open the link again.</p>
        <div class="actions">
          <button id="join-signout" class="btn btn-primary">Sign out and continue</button>
          <a class="btn btn-ghost" href="./">Not now</a>
        </div>
      </main>`);
    document.getElementById("join-signout")!.addEventListener("click", async () => {
      await endSession();
      location.reload();
    });
    return;
  }

  if (!info.on) {
    paintPlain(`
      ${topbar(false)}
      <main class="card join auth-step">
        ${headerMarkup(info)}
        <p class="hint">This test is not open for joining right now. Ask your teacher for a new link.</p>
        <div class="actions"><a class="btn btn-ghost" href="./">Go to Vidai</a></div>
      </main>`);
    return;
  }

  // The join form. A student of this teacher already signed in skips the
  // Google step; anyone else does it first, and the code box waits for it.
  const needsGoogle = !info.student;
  paintPlain(`
    ${topbar(false)}
    <main class="card join auth-step">
      ${headerMarkup(info)}
      ${
        info.published
          ? ""
          : `<p class="join-note">Not open yet — your teacher has not published this test. You can join now and come back when it is.</p>`
      }
      ${
        needsGoogle
          ? `<div class="join-step${authEnabled ? "" : " join-step-off"}">
               <div class="join-step-label">1 · Sign in with Google</div>
               <div id="join-google" class="google-btn-slot"></div>
               <p id="join-who" class="hint" hidden></p>
             </div>`
          : ""
      }
      <div class="join-step" id="join-code-step">
        <div class="join-step-label">${needsGoogle ? "2 · " : ""}Enter the access code from your teacher</div>
        <input id="join-code" class="numeric-input join-code" type="text" inputmode="text" autocomplete="one-time-code"
               autocapitalize="characters" spellcheck="false" placeholder="ABC-DEF" maxlength="9" ${needsGoogle ? "disabled" : ""} />
        <p id="join-error" class="login-error" hidden></p>
      </div>
      <div class="actions">
        <button id="join-go" class="btn btn-primary" disabled>Join and open the test</button>
      </div>
      <p class="hint">Joining makes you a student of ${escapeHtml(info.teacher || "this teacher")} for this test. Your name and email from Google are shown to them and to nobody else.</p>
    </main>`);

  let credential = "";
  const codeEl = document.getElementById("join-code") as HTMLInputElement;
  const goEl = document.getElementById("join-go") as HTMLButtonElement;
  const errEl = document.getElementById("join-error") as HTMLElement;
  const ready = () => (needsGoogle ? !!credential : true) && normalise(codeEl.value).length === 6;
  const refresh = () => {
    goEl.disabled = !ready();
  };

  if (needsGoogle) {
    const slot = document.getElementById("join-google")!;
    const whoEl = document.getElementById("join-who") as HTMLElement;
    if (!authEnabled) {
      whoEl.textContent = "Google sign-in is not set up on this site.";
      whoEl.hidden = false;
    } else {
      void renderGoogleCredentialButton(
        slot,
        (cred) => {
          credential = cred;
          const name = nameFromCredential(cred);
          whoEl.textContent = name ? `Signed in as ${name}. Now the code.` : "Signed in. Now the code.";
          whoEl.hidden = false;
          slot.hidden = true;
          codeEl.disabled = false;
          codeEl.focus();
          refresh();
          track("join_google");
        },
        (message) => {
          errEl.textContent = message;
          errEl.hidden = false;
        }
      );
    }
  }

  codeEl.addEventListener("input", () => {
    // ABC-DEF as they type: the dash is for the eye and is dropped on send.
    const raw = normalise(codeEl.value);
    codeEl.value = raw.length > 3 ? `${raw.slice(0, 3)}-${raw.slice(3)}` : raw;
    errEl.hidden = true;
    refresh();
  });
  codeEl.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && ready()) goEl.click();
  });

  goEl.addEventListener("click", async () => {
    if (!ready()) return;
    goEl.disabled = true;
    goEl.textContent = "Joining…";
    errEl.hidden = true;
    const result = await joinTest({ token, code: normalise(codeEl.value), credential: needsGoogle ? credential : undefined });
    if (!result.ok) {
      goEl.textContent = "Join and open the test";
      goEl.disabled = false;
      errEl.textContent = result.message;
      errEl.hidden = false;
      track("join_refused", { reason: result.reason || (result.full ? "full" : "code") });
      return;
    }
    track("join_success");
    setGuest(false);
    if (needsGoogle || !isLoggedIn()) saveStudentSession(result.student);
    openTest(result.testId);
  });
}

function headerMarkup(info: JoinInfo): string {
  const size = `${info.questionCount} question${info.questionCount === 1 ? "" : "s"} · ${info.totalMarks} mark${info.totalMarks === 1 ? "" : "s"}`;
  return `
    <div class="join-head">
      <span class="join-icon">${ICONS.file}</span>
      <div>
        <h2 class="landing-title join-title">${escapeHtml(info.title)}</h2>
        ${info.chapter ? `<p class="join-sub">${escapeHtml(info.chapter)}</p>` : ""}
        <p class="hint">${info.teacher ? `By ${escapeHtml(info.teacher)} · ` : ""}${escapeHtml(size)}</p>
      </div>
    </div>`;
}

/** Case and the dash only — the server does the same. */
function normalise(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

/** The name on a Google credential, for the "Signed in as …" line only. The
 *  server verifies the token; this reads it for display and trusts nothing. */
function nameFromCredential(credential: string): string {
  try {
    const payload = credential.split(".")[1] || "";
    const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
    return String(json.name || json.email || "");
  } catch {
    return "";
  }
}
