// Boot only — all screens live in src/screens/, shared helpers in
// src/{types,data,dom,attempts,auth,analytics}.ts.

import "./style.css";
import { initAnalytics, track } from "./analytics";
import { fetchServerTest } from "./api";
import {
  authEnabled,
  flushPendingAttempts,
  handleSessionExpiry,
  isLoggedIn,
  isParent,
} from "./auth";
import { isGuest, migrateStorage } from "./attempts";
import { TESTS } from "./data";
import { showHome } from "./screens/home";
import { showWelcome } from "./screens/auth";
import { showLanding } from "./screens/test";
import { showMarking } from "./screens/marking";
import { showEditor } from "./screens/editor";
import { showSubjects } from "./screens/subjects";
import { isStudentViewer, showStudentSubject } from "./screens/student";
import { showChildren } from "./screens/parent";
import { installShell } from "./screens/menu";
import { mount, skeleton } from "./shell";

// Before anything reads storage: carry this device across the Vidaivi → Vidai
// rename, or every signed-in student is silently signed out.
migrateStorage();

initAnalytics();
installShell();

// A 401 anywhere means the session is over — land on the welcome screen, which
// explains it, rather than leaving screens to render "no data".
handleSessionExpiry(() => {
  track("session_expired");
  showWelcome();
});
if (authEnabled && isLoggedIn()) void flushPendingAttempts();

function showEntry(): void {
  // Signed-in users land on their subjects; guests go straight to the
  // built-in tests, since subjects are something you own.
  if (authEnabled && !isLoggedIn() && !isGuest()) showWelcome();
  // A parent owns no subjects — their landing is their children's results.
  else if (authEnabled && isParent()) void showChildren();
  else if (authEnabled && isLoggedIn()) void showSubjects();
  else showHome(null);
}

// A teacher refreshing mid-edit lands back on the same question.
const editId = (new URLSearchParams(location.search).get("edit") ?? "").replace(/[^A-Za-z0-9-]+$/g, "");
if (editId && authEnabled && isLoggedIn()) {
  const questionId = new URLSearchParams(location.search).get("q");
  void showEditor(editId, questionId, () => void showSubjects());
}

// A student refreshing inside a subject stays in that subject's tests tree.
const subjectId = (new URLSearchParams(location.search).get("subject") ?? "").replace(/[^A-Za-z0-9-]+$/g, "");

// A teacher refreshing the marking queue stays on it.
const markMode = new URLSearchParams(location.search).get("mark") === "1";

// Tolerate links mangled by messaging apps (trailing "?", "/", punctuation).
const rawTestId = new URLSearchParams(location.search).get("test") ?? "";
const testId = rawTestId.replace(/[^A-Za-z0-9-]+$/g, "");
const test = TESTS.find((t) => t.id === testId);
if (editId) {
  // handled above
} else if (subjectId && !rawTestId && authEnabled && isLoggedIn() && isStudentViewer()) {
  void showStudentSubject(subjectId);
} else if (markMode && authEnabled && isLoggedIn()) {
  void showMarking();
} else if (test) {
  track("test_open", { test: test.id });
  showLanding(test);
} else if (testId && authEnabled && isLoggedIn()) {
  // Not in the bundle — could be a DB-backed test shared by a teacher. Paint
  // the shell and a placeholder card now so the reload never shows a blank.
  mount(skeleton.card(4), { title: "Test", active: "subjects", width: "narrow" });
  void fetchServerTest(testId).then((serverTest) => {
    if (serverTest) {
      track("test_open", { test: serverTest.id });
      showLanding(serverTest);
    } else {
      showEntry();
    }
  });
} else {
  showEntry();
}
