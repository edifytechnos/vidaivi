// Boot only — all screens live in src/screens/, shared helpers in
// src/{types,data,dom,attempts,auth,analytics}.ts.

import "./style.css";
import { initAnalytics, track } from "./analytics";
import { initClarity, tagRole } from "./clarity";
import { fetchServerTest } from "./api";
import {
  authEnabled,
  flushPendingAttempts,
  handleSessionExpiry,
  isLoggedIn,
  getProfile,
  isParent,
} from "./auth";
import { isGuest, migrateStorage } from "./attempts";
import { TESTS } from "./data";
import { showHome } from "./screens/home";
import { showWelcome } from "./screens/auth";
import { showLanding } from "./screens/test";
import { showMarking } from "./screens/marking";
import { showEditor } from "./screens/editor";
import { showStudentReport } from "./screens/console";
import { showSubjects } from "./screens/subjects";
import { isStudentViewer, showStudentSubject } from "./screens/student";
import { openChildResults, showChildren } from "./screens/parent";
import { installShell, openRail } from "./screens/menu";
import { installHistory } from "./dom";
import { installSelects } from "./select";
import { installStaleBuildRecovery } from "./staleload";
import { installPwa } from "./install";
import { installBeacon } from "./beacon";
import { mount, skeleton } from "./shell";
import { showTourOnFirstRun } from "./tour";

// Before anything reads storage: carry this device across the Vidaivi → Vidai
// rename, or every signed-in student is silently signed out.
migrateStorage();

// A tab open across a deploy reloads once when a chunk it needs is gone,
// instead of leaving a button that does nothing.
installStaleBuildRecovery();
initAnalytics();
// Never a student, and never a guest who opened a test link (they may be a
// child): those pages do not load Clarity at all — see recordsAudience.
initClarity({
  role: getProfile()?.role,
  sittingAsGuest: !isLoggedIn() && new URLSearchParams(location.search).has("test"),
});
// A returning visitor's session is tagged from the stored profile; a fresh
// sign-in tags itself in saveAuth. Either way the role is all that is sent.
tagRole(getProfile()?.role);
installShell();
// Installable from the browser: the service worker, and the install button's
// one listener.
installPwa();
// An open tab learns of a new build and moves onto it at the next screen
// change, never mid-answer — see src/beacon.ts.
installBeacon();
// Every <select> gets the app's own dropdown, now and on every screen painted
// from here on — the options list is ours, not the operating system's.
installSelects();

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

/**
 * Paint the screen the address bar names. Run once at boot and again on
 * every popstate, so the browser's Back and Forward move through the app
 * instead of out of it — `setUrl` in `src/dom.ts` is what pushes the entries
 * they walk. A parameter it does not know lands on the entry screen.
 */
function route(): void {
  const params = new URLSearchParams(location.search);
  const clean = (v: string | null) => (v ?? "").replace(/[^A-Za-z0-9-]+$/g, "");
  const signedIn = authEnabled && isLoggedIn();

  // A test shared by link: the join screen, signed in or not — it is the one
  // address a student may arrive at with no account at all.
  const joinToken = clean(params.get("join"));
  if (joinToken) {
    void import("./screens/join").then((m) => m.showJoin(joinToken));
    return;
  }

  // A teacher refreshing mid-edit lands back on the same question.
  const editId = clean(params.get("edit"));
  if (editId && signedIn) {
    void showEditor(editId, params.get("q"), () => void showSubjects());
    return;
  }

  // A student refreshing inside a subject stays in that subject's tests tree.
  const subjectId = clean(params.get("subject"));

  // A teacher refreshing inside Browse stays there: ?browse with no value is the
  // shelf list, ?browse=<id> is one shelf. Old ?library=<id> links land the same
  // place, which is where reading a built-in lives now.
  const browsing = params.has("browse") || params.has("library");
  const browseId = clean(params.get("browse") || params.get("library"));

  // A teacher refreshing the marking queue stays on it.
  const markMode = params.get("mark") === "1";

  // The console screens, a student's report, a test's results and a parent's
  // child each name themselves, so Back can find its way back to them.
  const view = params.get("view") ?? "";
  const report = clean(params.get("report"));
  const results = clean(params.get("results"));
  const child = clean(params.get("child"));

  // Tolerate links mangled by messaging apps (trailing "?", "/", punctuation).
  const rawTestId = params.get("test") ?? "";
  const testId = clean(rawTestId);
  const test = TESTS.find((t) => t.id === testId);
  if (subjectId && !rawTestId && signedIn && isStudentViewer()) {
    void showStudentSubject(subjectId);
  } else if (browsing && signedIn) {
    void import("./screens/browse").then((m) =>
      browseId ? m.showShelf(browseId) : m.showBrowse()
    );
  } else if (markMode && signedIn) {
    void showMarking();
  } else if (report && signedIn) {
    showStudentReport(report);
  } else if (results && signedIn) {
    void import("./screens/results").then((m) => m.showTestResults(results));
  } else if (child && signedIn) {
    void openChildResults(child);
  } else if (view && signedIn && openRail(view)) {
    // painted by openRail
  } else if (test) {
    track("test_open", { test: test.id });
    showLanding(test);
  } else if (testId && signedIn) {
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
}

installHistory(route);
route();

// Somebody's first sign-in gets the five-card tour. It waits for the screen to
// paint and stands down if a dialog is already open, because the role choice
// and the phone-number step land on exactly this load.
showTourOnFirstRun();
