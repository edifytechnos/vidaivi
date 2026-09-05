// Auth-related screens: welcome, student login, admin login, phone capture.

import { track } from "../analytics";
import {
  adminLogin,
  getProfile,
  renderGoogleButton,
  savePhone,
  studentLogin,
} from "../auth";
import { setGuest } from "../attempts";
import { app, escapeHtml, topbar } from "../dom";
import { showHome } from "./home";
import { showAdmin } from "./console";

export function showWelcome(next?: () => void) {
  const done = next ?? showHome;
  track("welcome_open");
  app.innerHTML = `
    ${topbar(false)}
    <main class="card welcome">
      <div class="welcome-logo">V</div>
      <h2 class="welcome-title">Welcome to Vidaivi</h2>
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
      if (!profile.phone) showPhoneForm(done);
      else done();
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
  track("admin_login_open");
  app.innerHTML = `
    ${topbar(true)}
    <main class="card landing">
      <h2 class="landing-title">Admin login</h2>
      <input id="ad-user" class="numeric-input" type="text" autocomplete="username"
             autocapitalize="none" spellcheck="false" placeholder="Username" />
      <input id="ad-pass" class="numeric-input" type="password" autocomplete="current-password"
             placeholder="Password" />
      <p id="ad-error" class="login-error" hidden></p>
      <div class="actions">
        <button id="ad-submit" class="btn btn-primary" disabled>Login</button>
        <button id="ad-back" class="btn btn-ghost">Back</button>
      </div>
    </main>`;
  const user = document.getElementById("ad-user") as HTMLInputElement;
  const pass = document.getElementById("ad-pass") as HTMLInputElement;
  const submit = document.getElementById("ad-submit") as HTMLButtonElement;
  const errEl = document.getElementById("ad-error") as HTMLElement;
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
    const result = await adminLogin(user.value.trim(), pass.value);
    if (result.ok) {
      track("admin_login_success");
      setGuest(false);
      showAdmin();
    } else {
      errEl.textContent = result.message;
      errEl.hidden = false;
      submit.disabled = false;
      submit.textContent = "Login";
    }
  });
  document.getElementById("ad-back")!.addEventListener("click", () => showWelcome(next));
}

export function showPhoneForm(next: () => void) {
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
