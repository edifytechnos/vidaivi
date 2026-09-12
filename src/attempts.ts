import type { Attempt, Test } from "./types";
import { authEnabled, isLoggedIn } from "./auth";

// ---------- Rename migration: vidaivi: → vidai: ----------

const OLD_PREFIX = "vidaivi:";
const NEW_PREFIX = "vidai:";

/**
 * Carry this device's data across the rename. Must run before anything reads
 * storage — `vidaivi:auth` holds the session, so skipping it would sign every
 * student out, and `vidaivi:pendingAttempts` holds saves that never reached the
 * server. The old keys are left in place: a student who opens an older cached
 * bundle still finds their data, and deleting them is a later release's job.
 */
export function migrateStorage(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(OLD_PREFIX)) stale.push(key);
    }
    for (const key of stale) {
      const next = NEW_PREFIX + key.slice(OLD_PREFIX.length);
      // Never overwrite: whatever is already under the new name is newer.
      if (localStorage.getItem(next) !== null) continue;
      const value = localStorage.getItem(key);
      if (value !== null) localStorage.setItem(next, value);
    }
  } catch {
    // Storage unavailable (private mode). Nothing to migrate, nothing to break.
  }
}

// ---------- Attempt storage (this phone's notebook) ----------

function storageKey(testId: string): string {
  return `vidai:attempt:${testId}`;
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

const GUEST_KEY = "vidai:guestMode";

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
