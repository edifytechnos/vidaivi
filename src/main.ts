// Boot only — all screens live in src/screens/, shared helpers in
// src/{types,data,dom,attempts,auth,analytics}.ts.

import "./style.css";
import { initAnalytics, track } from "./analytics";
import { authEnabled, isLoggedIn, flushPendingAttempts } from "./auth";
import { isGuest } from "./attempts";
import { TESTS } from "./data";
import { showHome } from "./screens/home";
import { showWelcome } from "./screens/auth";
import { showLanding } from "./screens/test";

initAnalytics();
if (authEnabled && isLoggedIn()) void flushPendingAttempts();

// Tolerate links mangled by messaging apps (trailing "?", "/", punctuation).
const rawTestId = new URLSearchParams(location.search).get("test") ?? "";
const testId = rawTestId.replace(/[^A-Za-z0-9-]+$/g, "");
const test = TESTS.find((t) => t.id === testId);
if (test) {
  track("test_open", { test: test.id });
  showLanding(test);
} else if (authEnabled && !isLoggedIn() && !isGuest()) {
  showWelcome();
} else {
  showHome();
}
