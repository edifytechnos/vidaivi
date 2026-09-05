import type { Attempt, Test } from "./types";
import { authEnabled, isLoggedIn } from "./auth";

// ---------- Attempt storage (this phone's notebook) ----------

function storageKey(testId: string): string {
  return `vidaivi:attempt:${testId}`;
}

export function loadAttempt(testId: string): Attempt | null {
  try {
    const raw = localStorage.getItem(storageKey(testId));
    return raw ? (JSON.parse(raw) as Attempt) : null;
  } catch {
    return null;
  }
}

export function saveAttempt(testId: string, attempt: Attempt): void {
  attempt.updatedAt = new Date().toISOString();
  try {
    localStorage.setItem(storageKey(testId), JSON.stringify(attempt));
  } catch {
    // storage unavailable (private mode etc.) — test still works, just no resume
  }
}

export function clearAttempt(testId: string): void {
  try {
    localStorage.removeItem(storageKey(testId));
  } catch {}
}

export function newAttempt(): Attempt {
  return {
    answers: {},
    index: 0,
    completed: false,
    score: 0,
    updatedAt: new Date().toISOString(),
  };
}

// ---------- Guest mode ----------

const GUEST_KEY = "vidaivi:guestMode";

export function isGuest(): boolean {
  try {
    return localStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}

export function setGuest(on: boolean): void {
  try {
    if (on) localStorage.setItem(GUEST_KEY, "1");
    else localStorage.removeItem(GUEST_KEY);
  } catch {}
}

export function requiresLogin(test: Test): boolean {
  return authEnabled && test.access === "login" && !isLoggedIn();
}
