// Auth-related screens: welcome, student login, admin login, phone capture.

import { track } from "../analytics";
import {
  adminLogin,
  chooseRole,
  fetchEntitlements,
  getProfile,
  isLoggedIn,
  isParent,
  renderGoogleButton,
  savePhone,
  sessionJustExpired,
  studentLogin,
} from "../auth";
import { setGuest } from "../attempts";
import { openModal } from "../modal";
import { app, escapeHtml, setUrl, topbar } from "../dom";
import { showHome } from "./home";
import { showSubjects } from "./subjects";
import { showChildren } from "./parent";

export function showWelcome(next?: () => void) {
  setUrl();
  // Where a finished (or skipped) sign-in lands: your subjects if you own
  // some, the built-in tests if you are only browsing. Guests share this, so
  // "Continue as guest" never drops onto an empty "Your subjects" grid — even
  // when the welcome screen was reached back from the student-login screen.
  const done =
    next ??
    (() => {
      if (isParent()) void showChildren();
      else if (isLoggedIn()) void showSubjects();
      else showHome(null);
    });
  track("welcome_open");
  // A sign-in that timed out, not a failure — and nothing of theirs is lost.
  const expired = sessionJustExpired();
  app.innerHTML = `
    ${topbar(false)}
    <main class="card welcome">
      <div class="welcome-logo">V</div>
      ${
        expired
          ? `<p class="welcome-expired">Your sign-in timed out, so please sign in
             again. Nothing is lost — your tests, students and answers are all
             saved.</p>`
          : ""
      }
      <h2 class="welcome-title">Welcome to Vidai</h2>
      <p class="welcome-sub">Chapter-wise CBSE Class 12 Maths practice with instant
      worked solutions. Sign in to keep your scores on your profile,
      or explore as a guest.</p>
      <button id="student-btn" class="btn btn-primary">Student login</button>
      <p class="hint">Use the username and password your teacher shared.</p>
      <div class="welcome-divider"><span>teachers &amp; parents</span></div>
      <div id="google-btn" class="google-btn-slot"></div>
      <p id="login-error" class="login-error" hidden></p>
      <div class="welcome-divider"><span>or</span></div>
      <button id="guest-btn" class="btn btn-ghost">Continue as guest</button>
      <p class="hint welcome-note">Guests can take the free demo test. Scores
      stay on this device only.</p>
      <p class="admin-link-row"><button id="admin-link" class="btn-link">Admin</button></p>
    </main>`;
  document.getElementById("admin-link")!.addEventListener("click", () => {
    showAdminLogin(done);
  });
  document.getElementById("student-btn")!.addEventListener("click", () => {
    showStudentLogin(done);
  });
  const slot = document.getElementById("google-btn")!;
  const errEl = document.getElementById("login-error") as HTMLElement;
  void renderGoogleButton(
    slot,
    (profile) => {
      track("login_success", { from: "welcome" });
      setGuest(false);
      // The role comes first: it decides which app they land in, and the
      // phone number is a detail by comparison. The *server* decides whether
      // to ask — the absence of a stored choice — so a reload or a second
      // device cannot skip past it.
      void showRoleChoiceIfNeeded(() => {
        if (!profile.phone) showPhoneForm(done);
        else done();
      });
    },
    (message) => {
      errEl.textContent = message;
      errEl.hidden = false;
    }
  );
  document.getElementById("guest-btn")!.addEventListener("click", () => {
    track("guest_continue");
    setGuest(true);
    done();
  });
}

export function showStudentLogin(next: () => void) {
  setUrl();
  track("student_login_open");
  app.innerHTML = `
    ${topbar(true)}
    <main class="card landing">
      <h2 class="landing-title">Student login</h2>
      <p class="hint">Enter the username and password your teacher shared with you.</p>
      <input id="su-user" class="numeric-input" type="text" autocomplete="username"
             autocapitalize="none" spellcheck="false" placeholder="Username" />
      <input id="su-pass" class="numeric-input" type="password" autocomplete="current-password"
             placeholder="Password" />
      <p id="su-error" class="login-error" hidden></p>
      <div class="actions">
        <button id="su-submit" class="btn btn-primary" disabled>Login</button>
        <button id="su-back" class="btn btn-ghost">Back</button>
      </div>
      <p class="hint">Forgot your password? Ask your teacher to reset it.</p>
    </main>`;
  const user = document.getElementById("su-user") as HTMLInputElement;
  const pass = document.getElementById("su-pass") as HTMLInputElement;
  const submit = document.getElementById("su-submit") as HTMLButtonElement;
  const errEl = document.getElementById("su-error") as HTMLElement;
  const update = () => {
    submit.disabled = !user.value.trim() || !pass.value;
  };
  user.addEventListener("input", update);
  pass.addEventListener("input", update);
  pass.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !submit.disabled) submit.click();
  });
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    submit.textContent = "Logging in…";
    const result = await studentLogin(user.value.trim(), pass.value);
    if (result.ok) {
      track("student_login_success");
      setGuest(false);
      next();
    } else {
      errEl.textContent = result.message;
      errEl.hidden = false;
      submit.disabled = false;
      submit.textContent = "Login";
    }
  });
  document.getElementById("su-back")!.addEventListener("click", () => showWelcome(next));
}

export function showAdminLogin(next: () => void) {
  setUrl();
  track("admin_login_open");
  app.innerHTML = `
    ${topbar(true)}
    <main class="card landing">
      <h2 class="landing-title">Admin login</h2>
      <input id="ad-user" class="numeric-input" type="text" autocomplete="username"
             autocapitalize="none" spellcheck="false" placeholder="Username" />
      <input id="ad-pass" class="numeric-input" type="password" autocomplete="current-password"
             placeholder="Password" />
      <input id="ad-code" class="numeric-input" type="text" inputmode="numeric"
             autocomplete="one-time-code" autocapitalize="none" spellcheck="false"
             placeholder="6-digit code from your authenticator" hidden />
      <p id="ad-error" class="login-error" hidden></p>
      <div class="actions">
        <button id="ad-submit" class="btn btn-primary" disabled>Login</button>
        <button id="ad-back" class="btn btn-ghost">Back</button>
      </div>
    </main>`;
  const user = document.getElementById("ad-user") as HTMLInputElement;
  const pass = document.getElementById("ad-pass") as HTMLInputElement;
  const submit = document.getElementById("ad-submit") as HTMLButtonElement;
  const code = document.getElementById("ad-code") as HTMLInputElement;
  const errEl = document.getElementById("ad-error") as HTMLElement;
  const update = () => {
    submit.disabled = !user.value.trim() || !pass.value;
  };
  user.addEventListener("input", update);
  pass.addEventListener("input", update);
  for (const el of [pass, code]) {
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !submit.disabled) submit.click();
    });
  }
  submit.addEventListener("click", async () => {
    submit.disabled = true;
    submit.textContent = "Logging in…";
    const result = await adminLogin(user.value.trim(), pass.value, code.value.trim() || undefined);
    if (result.ok) {
      track("admin_login_success");
      setGuest(false);
      // Admins land where everyone else does — the subjects grid. The console
      // is reached from the topbar menu, not by being dropped into it.
      next();
    } else {
      // The password was right and the second factor is next. Reveal the field
      // and put the cursor in it rather than making them find it.
      if (result.needsCode) {
        code.hidden = false;
        code.value = "";
        code.focus();
      }
      errEl.textContent = result.message;
      errEl.hidden = false;
      submit.disabled = false;
      submit.textContent = "Login";
    }
  });
  document.getElementById("ad-back")!.addEventListener("click", () => showWelcome(next));
}

/**
 * Parent or teacher, asked once.
 *
 * Only shown when the server says no choice is stored. An account that
 * predates plans has one implicitly and is never asked — the same reason it is
 * exempt from the limits.
 */
export async function showRoleChoiceIfNeeded(next: () => void): Promise<void> {
  const ent = await fetchEntitlements();
  // A failed call must not strand somebody on a chooser they cannot complete,
  // and must not silently make the choice for them. Carry on; the next screen
  // asks again.
  if (!ent || ent.chose || ent.plan === "exempt" || ent.plan === "admin") {
    next();
    return;
  }
  const days = Number(ent.rules?.trialDays) || 30;
  openModal({
    title: "How will you use Vidai?",
    description: `Pick the one that fits. Your ${days}-day trial starts now, and this is asked only once.`,
    fields: [
      {
        name: "chose",
        // The dialog's own title asks the question; the tiles answer it.
        label: "",
        kind: "cards",
        required: true,
        choices: [
          {
            value: "teacher",
            label: "I teach a class",
            hint: "Set tests, add your students, and mark what they hand in.",
            badge: `${days}-day trial`,
          },
          {
            value: "parent",
            label: "I'm a parent",
            hint: "Add your children and give them ready-made practice tests.",
            badge: "Free to try",
          },
        ],
      },
    ],
    // It cannot be dismissed: closing it left the account with no role at all,
    // and the app then fell back to the parent's shape — which is exactly what
    // "I picked teacher and landed as a parent" looked like from the outside.
    mandatory: true,
    submitLabel: "Start",
    onSubmit: async (values) => {
      const pick = values.chose === "teacher" ? "teacher" : "parent";
      const res = await chooseRole(pick);
      // 409 means it was already chosen — on another tab, most likely. That is
      // not an error worth stopping for.
      if (!res.ok && !/already/i.test(res.message || "")) return res.message || "Could not save that.";
      track("role_chosen", { role: pick });
      next();
    },
  });
}

export function showPhoneForm(next: () => void) {
  setUrl();
  const profile = getProfile();
  app.innerHTML = `
    ${topbar(true)}
    <main class="card landing">
      <h2 class="landing-title">Almost there${profile?.name ? `, ${escapeHtml(profile.name.split(" ")[0])}` : ""}!</h2>
      <p class="hint">One last thing — a WhatsApp number where score reports
      can be shared (yours or a parent's).</p>
      <input id="phone-input" class="numeric-input" type="tel" inputmode="tel"
             placeholder="10-digit mobile number" maxlength="15" />
      <p id="phone-error" class="login-error" hidden></p>
      <div class="actions">
        <button id="phone-save" class="btn btn-primary" disabled>Save and continue</button>
      </div>
    </main>`;
  const input = document.getElementById("phone-input") as HTMLInputElement;
  const save = document.getElementById("phone-save") as HTMLButtonElement;
  const errEl = document.getElementById("phone-error") as HTMLElement;
  input.addEventListener("input", () => {
    save.disabled = input.value.replace(/\D/g, "").length < 10;
  });
  save.addEventListener("click", async () => {
    save.disabled = true;
    save.textContent = "Saving…";
    const ok = await savePhone(input.value.trim());
    if (ok) {
      track("phone_saved");
      next();
    } else {
      errEl.textContent = "Could not save — check your connection and try again.";
      errEl.hidden = false;
      save.disabled = false;
      save.textContent = "Save and continue";
    }
  });
}
