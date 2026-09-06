// Boot only — all screens live in src/screens/, shared helpers in
// src/{types,data,dom,attempts,auth,analytics}.ts.

import "./style.css";
import { initAnalytics, track } from "./analytics";
import { fetchServerTest } from "./api";
import { authEnabled, isLoggedIn, flushPendingAttempts } from "./auth";
import { isGuest } from "./attempts";
import { TESTS } from "./data";
import { showHome } from "./screens/home";
import { showWelcome } from "./screens/auth";
import { showLanding } from "./screens/test";
import { showEditor } from "./screens/editor";
import { showMyTests } from "./screens/console";
import { showSubjects } from "./screens/subjects";

initAnalytics();
if (authEnabled && isLoggedIn()) void flushPendingAttempts();

function showEntry(): void {
  // Signed-in users land on their subjects; guests go straight to the
  // built-in tests, since subjects are something you own.
  if (authEnabled && !isLoggedIn() && !isGuest()) showWelcome();
  else if (authEnabled && isLoggedIn()) void showSubjects();
  else showHome(null);
}

// A teacher refreshing mid-edit lands back on the same question.
const editId = (new URLSearchParams(location.search).get("edit") ?? "").replace(/[^A-Za-z0-9-]+$/g, "");
if (editId && authEnabled && isLoggedIn()) {
  const questionId = new URLSearchParams(location.search).get("q");
  void showEditor(editId, questionId, showMyTests);
}

// Tolerate links mangled by messaging apps (trailing "?", "/", punctuation).
const rawTestId = new URLSearchParams(location.search).get("test") ?? "";
const testId = rawTestId.replace(/[^A-Za-z0-9-]+$/g, "");
const test = TESTS.find((t) => t.id === testId);
if (editId) {
  // handled above
} else if (test) {
  track("test_open", { test: test.id });
  showLanding(test);
} else if (testId && authEnabled && isLoggedIn()) {
  // Not in the bundle — could be a DB-backed test shared by a teacher.
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
