// Two kinds of signed-in identity:
//  - "google": teachers and parents, via Google Identity Services popup.
//  - "student": teacher-issued username/password, via /api/studentauth.
// Auth is disabled entirely when VITE_GOOGLE_CLIENT_ID is unset (local dev).
//
// THE PAGE NEVER HOLDS THE SESSION TOKEN. It lives in an httpOnly cookie the
// server sets and the browser attaches to every same-origin request on its own,
// so script -- ours or an injected one -- cannot read it. What is kept here is
// the profile: a name, a role, a picture. Losing it costs a sign-in screen,
// never an account.
//
// The server also re-issues the cookie once a session is past halfway, so
// signing in lasts until someone signs out rather than until Google's token
// expires an hour later.

import type { StoredAnswer } from "./types";

export interface Profile {
  kind: "google" | "student" | "admin";
  sub: string; // google sub or student username
  name: string;
  email?: string;
  picture?: string;
  phone?: string;
  role?: "teacher" | "parent" | "student" | "admin";
  school?: string;
  grade?: string;
}

interface AuthState {
  kind: "google" | "student" | "admin";
  profile: Profile;
  savedAt: number;
  /**
   * Pre-cookie sessions only. A tab that signed in before the cookie shipped
   * still has its token here, and the API accepts it in the header for one
   * release so that tab keeps working. Nothing writes this any more — delete
   * the field, and the header path in `api/shared/core.js`, once everyone has
   * reloaded.
   */
  credential?: string;
}

export interface ServerAttempt {
  testId: string;
  score: number;
  total: number;
  completedAt: string;
  /** "progress" rows are part-way through; "done" rows are finished. */
  status?: "progress" | "done";
  /** Progress rows only: the next unanswered question. */
  index?: number;
}

export interface ServerProgress {
  testId: string;
  answers: Record<string, StoredAnswer> | null;
  index: number;
  updatedAt: string;
}

export interface StudentRecord {
  username: string;
  name: string;
  school: string;
  grade: string;
  parentPhone: string;
  createdAt?: string;
  password?: string; // only present right after create/reset
}

const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined;
export const authEnabled = !!CLIENT_ID;

const AUTH_KEY = "vidai:auth";
const PENDING_KEY = "vidai:pendingAttempts";

export function getAuth(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    return raw ? (JSON.parse(raw) as AuthState) : null;
  } catch {
    return null;
  }
}

export function isLoggedIn(): boolean {
  return !!getAuth();
}

export function getProfile(): Profile | null {
  return getAuth()?.profile ?? null;
}

export function isTeacher(): boolean {
  const role = getProfile()?.role;
  return role === "teacher" || role === "admin";
}

export function isParent(): boolean {
  return getProfile()?.role === "parent";
}

export function isAdmin(): boolean {
  return getProfile()?.role === "admin";
}

function saveAuth(state: AuthState): void {
  expiring = false;
  try {
    localStorage.removeItem(EXPIRED_KEY);
  } catch {}
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(state));
  } catch {}
}

const EXPIRED_KEY = "vidai:sessionExpired";

// Signing in is the one place a 401 means "wrong credentials" rather than
// "your session is over" — there is no session yet to end.
const SIGN_IN_ENDPOINTS = ["/api/login", "/api/studentauth", "/api/manageauth"];

let expiring = false;
let onExpired: (() => void) | null = null;

/** Let the app say where an expired session should land. Wired in main.ts. */
export function handleSessionExpiry(fn: () => void): void {
  onExpired = fn;
}

/**
 * Reading this does NOT clear it — the welcome screen can render more than once
 * around an expiry, and a consuming read meant the second render silently
 * dropped the explanation. It is cleared when someone signs in, in `saveAuth`.
 */
export function sessionJustExpired(): boolean {
  try {
    return localStorage.getItem(EXPIRED_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Every call to our API goes through here.
 *
 * A 401 from this API can only mean `identify()` rejected the token: real
 * permission refusals are 403, and a network failure throws rather than
 * answering. So a 401 is an unambiguous "this session is over" — and it has to
 * be acted on, because a Google ID token expires after about an hour and every
 * helper below quietly turns a 401 into an empty list. That made an hour-old
 * session look exactly like a teacher whose students had all been deleted.
 */
export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const res = await fetch(path, init);
  const signIn = SIGN_IN_ENDPOINTS.some((p) => path.startsWith(p));
  if (res.status === 401 && !signIn && getAuth()) expireSession();
  return res;
}

/** End the session once, however many calls came back 401 together. */
function expireSession(): void {
  if (expiring) return;
  expiring = true;
  // Leave vidai:pendingAttempts alone: unsynced answers are meant to outlive
  // an expired session and flush on the next sign-in.
  signOut();
  try {
    localStorage.setItem(EXPIRED_KEY, "1");
  } catch {}
  onExpired?.();
}

/**
 * True once a 401 has ended the session, until someone signs in again.
 *
 * `mount()` checks this and refuses to paint. Without that, the screen whose
 * call was refused is still awaiting its own fetch, and when that resolves it
 * renders its empty state straight over the welcome message — which is how the
 * teacher case lost "your sign-in timed out" while admin and parent kept it.
 * The welcome screen writes to `app` directly rather than through `mount()`,
 * so it is unaffected.
 */
export function sessionIsExpired(): boolean {
  return expiring;
}

/** Forget the profile. Local only — see `endSession` for the cookie. */
export function signOut(): void {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {}
}

/**
 * Sign out properly: the server clears the session cookie, then the profile
 * goes. `everywhere` moves the account's token epoch instead, which ends every
 * session on every device — the answer to a lost phone.
 *
 * The local half runs whatever the network did. A sign-out that left the user
 * apparently signed in because the request failed would be the worse outcome.
 */
export async function endSession(everywhere = false): Promise<void> {
  try {
    await fetch("/api/signout", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(everywhere ? { everywhere: true } : {}),
    });
  } catch {}
  signOut();
}

/**
 * The header that goes out with every API call.
 *
 * It no longer carries the session — the cookie does. What it carries now is a
 * marker, and the marker is the CSRF defence: a cross-origin page cannot set a
 * custom header without a CORS preflight this API never answers, so a request
 * that arrives without it is not one of ours. `SameSite=Strict` on the cookie
 * is the first lock; this is the second.
 *
 * A session from before the cookie still sends its token here (see AuthState).
 */
export function authHeader(): Record<string, string> {
  const legacy = getAuth()?.credential;
  const value = legacy || "1";
  // Both names for one release: this bundle may be talking to an API that
  // predates the Vidaivi → Vidai rename, and the deploy is not atomic.
  return { "X-Vidai-Auth": value, "X-Vidaivi-Auth": value };
}

// ---------- Google Identity Services (teachers / parents) ----------

let gisLoading: Promise<void> | null = null;

function loadGis(): Promise<void> {
  if (!gisLoading) {
    gisLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = "https://accounts.google.com/gsi/client";
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Google sign-in failed to load"));
      document.head.appendChild(s);
    });
  }
  return gisLoading;
}

/**
 * Exchange a Google ID token for a Vidai session, or — with no credential —
 * update the signed-in profile using the session already in the cookie.
 *
 * The Google token is handed over exactly once and never stored: the response
 * carries the session as a cookie the page cannot read.
 */
async function apiLogin(credential: string | null, phone?: string): Promise<Profile> {
  const res = await apiFetch("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(credential
        ? { "X-Vidai-Auth": credential, "X-Vidaivi-Auth": credential }
        : authHeader()),
    },
    body: JSON.stringify(phone ? { phone } : {}),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  const p = await res.json();
  return { kind: "google", ...p } as Profile;
}

export async function renderGoogleButton(
  container: HTMLElement,
  onLogin: (profile: Profile) => void,
  onError: (message: string) => void
): Promise<void> {
  try {
    await loadGis();
  } catch {
    onError("Could not load Google sign-in. Check your connection and reload.");
    return;
  }
  const google = (window as any).google;
  google.accounts.id.initialize({
    client_id: CLIENT_ID,
    callback: async (response: { credential: string }) => {
      try {
        const profile = await apiLogin(response.credential);
        saveAuth({ kind: "google", profile, savedAt: Date.now() });
        void flushPendingAttempts();
        onLogin(profile);
      } catch {
        onError("Sign-in could not be verified. Please try again.");
      }
    },
  });
  google.accounts.id.renderButton(container, {
    theme: "outline",
    size: "large",
    text: "continue_with",
    width: 280,
  });
}

export async function savePhone(phone: string): Promise<boolean> {
  const auth = getAuth();
  if (!auth || auth.kind !== "google") return false;
  try {
    const profile = await apiLogin(auth.credential ?? null, phone);
    saveAuth({ ...auth, profile });
    return true;
  } catch {
    return false;
  }
}

// ---------- Student login ----------

export async function studentLogin(
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await apiFetch("/api/studentauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data.error || "Login failed" };
    }
    const data = await res.json();
    saveAuth({
      kind: "student",
      profile: {
        kind: "student",
        sub: data.student.username,
        name: data.student.name,
        role: "student",
        school: data.student.school,
        grade: data.student.grade,
      },
      savedAt: Date.now(),
    });
    void flushPendingAttempts();
    return { ok: true };
  } catch {
    return { ok: false, message: "Network error — check your connection." };
  }
}

// ---------- Admin login and teacher allowlist ----------

export async function adminLogin(
  username: string,
  password: string
): Promise<{ ok: true } | { ok: false; message: string }> {
  try {
    const res = await apiFetch("/api/manageauth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data.error || "Login failed" };
    }
    await res.json().catch(() => ({}));
    saveAuth({
      kind: "admin",
      profile: { kind: "admin", sub: username, name: "Admin", role: "admin" },
      savedAt: Date.now(),
    });
    return { ok: true };
  } catch {
    return { ok: false, message: "Network error — check your connection." };
  }
}

export async function listTeachers(): Promise<{ email: string; addedAt?: string }[] | null> {
  try {
    const res = await apiFetch("/api/teachers", { headers: authHeader() });
    if (!res.ok) return null;
    return (await res.json()).teachers;
  } catch {
    return null;
  }
}

export async function modifyTeacher(
  action: "add" | "remove",
  email: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await apiFetch("/api/teachers", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action, email }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data.error || "Request failed" };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

// ---------- Teacher: student roster ----------

export async function listStudents(): Promise<StudentRecord[] | null> {
  try {
    const res = await apiFetch("/api/students", { headers: authHeader() });
    if (!res.ok) return null;
    const data = await res.json();
    return data.students as StudentRecord[];
  } catch {
    return null;
  }
}

export async function createStudent(input: {
  name: string;
  school: string;
  grade: string;
  parentPhone: string;
}): Promise<StudentRecord | null> {
  try {
    const res = await apiFetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "create", ...input }),
    });
    if (!res.ok) return null;
    return (await res.json()) as StudentRecord;
  } catch {
    return null;
  }
}

/** Remove a student and their attempt history. Irreversible. */
export async function removeStudent(
  username: string
): Promise<{ ok: boolean; message?: string; removedAttempts?: number }> {
  try {
    const res = await apiFetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "remove", username }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Could not remove" };
    return { ok: true, removedAttempts: data.removedAttempts };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

export async function resetStudentPassword(
  username: string
): Promise<{ username: string; password: string } | null> {
  try {
    const res = await apiFetch("/api/students", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "reset", username }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export interface StudentReport extends StudentRecord {
  attempts: ServerAttempt[];
}

/** Teacher/admin: attempts for one student, or all students when username omitted. */
export async function fetchReports(username?: string): Promise<StudentReport[] | null> {
  try {
    const q = username ? `?username=${encodeURIComponent(username)}` : "";
    const res = await apiFetch(`/api/reports${q}`, { headers: authHeader() });
    if (!res.ok) return null;
    return (await res.json()).students as StudentReport[];
  } catch {
    return null;
  }
}

// ---------- Long-answer photos and teacher marking ----------

export interface GradedAnswer {
  studentId: string;
  username: string;
  studentName: string;
  testId: string;
  testTitle: string;
  questionId: string;
  questionIndex: number;
  maxMarks: number;
  images: string[];
  status: "submitted" | "marked";
  submittedAt: string;
  awarded: number | null;
  comment: string;
  markedAt: string;
  markedBy: string;
}

export interface UploadedAnswerImage {
  blob: string;
  images: string[];
}

/** Hand in one photo of a long answer. Throws with a readable message. */
export async function uploadAnswerImage(payload: {
  testId: string;
  testTitle: string;
  questionId: string;
  questionIndex: number;
  maxMarks: number;
  image: string;
}): Promise<UploadedAnswerImage> {
  const res = await apiFetch("/api/answerimage", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not upload that photo");
  return body as UploadedAnswerImage;
}

export async function removeAnswerImage(
  testId: string,
  questionId: string,
  blob: string
): Promise<string[]> {
  const res = await apiFetch("/api/answerimage", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ action: "remove", testId, questionId, blob }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || "Could not remove that photo");
  return (body.images || []) as string[];
}

/**
 * A short-lived signed URL for one photo. An <img> cannot carry the auth
 * header, so the URL is fetched first and the image points at that.
 */
export async function answerImageUrl(blob: string): Promise<string | null> {
  try {
    const res = await apiFetch(`/api/answerimage?blob=${encodeURIComponent(blob)}`, {
      headers: authHeader(),
    });
    if (!res.ok) return null;
    return (await res.json()).url as string;
  } catch {
    return null;
  }
}

/** Grading rows for one student — the caller's own unless `student` is given. */
export async function fetchGrading(opts: {
  student?: string;
  testId?: string;
} = {}): Promise<GradedAnswer[]> {
  try {
    const q = new URLSearchParams();
    if (opts.student) q.set("student", opts.student);
    if (opts.testId) q.set("testId", opts.testId);
    const suffix = q.toString() ? `?${q}` : "";
    const res = await apiFetch(`/api/grading${suffix}`, { headers: authHeader() });
    if (!res.ok) return [];
    return ((await res.json()).answers || []) as GradedAnswer[];
  } catch {
    return [];
  }
}

/** Teacher/admin: everything their students have handed in and not had marked. */
export async function fetchMarkingQueue(): Promise<GradedAnswer[] | null> {
  try {
    const res = await apiFetch("/api/grading?queue=1", { headers: authHeader() });
    if (!res.ok) return null;
    return ((await res.json()).answers || []) as GradedAnswer[];
  } catch {
    return null;
  }
}

export async function saveMark(payload: {
  username: string;
  testId: string;
  questionId: string;
  awarded: number;
  comment?: string;
}): Promise<boolean> {
  try {
    const res = await apiFetch("/api/grading", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "mark", ...payload }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Releasing the answers ----------

export interface ReleaseState {
  testId: string;
  classWide: { releasedAt: string; releasedBy: string } | null;
  students: { username: string; releasedAt: string; releasedBy: string }[];
}

/**
 * Has the teacher opened this paper? Answers, correct options and worked
 * solutions all hang off this — a test is silent until it comes back true.
 * Fails closed: a network error keeps the paper shut rather than leaking it.
 */
export async function fetchReleased(testId: string, student?: string): Promise<boolean> {
  try {
    const q = new URLSearchParams({ testId });
    if (student) q.set("student", student);
    const res = await apiFetch(`/api/release?${q}`, { headers: authHeader() });
    if (!res.ok) return false;
    return !!(await res.json()).released;
  } catch {
    return false;
  }
}

/** Teacher/admin: who this test is open for. */
export async function fetchReleaseState(testId: string): Promise<ReleaseState | null> {
  try {
    const res = await apiFetch(`/api/release?testId=${encodeURIComponent(testId)}`, {
      headers: authHeader(),
    });
    if (!res.ok) return null;
    return (await res.json()) as ReleaseState;
  } catch {
    return null;
  }
}

/** Open or close a paper — for one student, or for the whole class. */
export async function setReleased(
  testId: string,
  opts: { username?: string; released: boolean }
): Promise<boolean> {
  try {
    const res = await apiFetch("/api/release", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({
        action: opts.released ? "release" : "unrelease",
        testId,
        username: opts.username,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ---------- Attempts (fire-and-forget with offline queue) ----------

interface PendingAttempt {
  testId: string;
  score: number;
  total: number;
  completedAt: string;
  /** JSON of Attempt.answers, so review works on any device. */
  answers?: string;
}

function readPending(): PendingAttempt[] {
  try {
    return JSON.parse(localStorage.getItem(PENDING_KEY) || "[]");
  } catch {
    return [];
  }
}

function writePending(list: PendingAttempt[]): void {
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.slice(-20)));
  } catch {}
}

async function postAttempt(a: PendingAttempt): Promise<boolean> {
  if (!isLoggedIn()) return false;
  try {
    const res = await apiFetch("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(a),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Save what the student has answered so far. Deliberately NOT queued for
 * retry: every write carries the whole answer map, so the next answer heals a
 * dropped one, and a queue would only replay state that is already stale.
 */
export function saveProgress(a: {
  testId: string;
  answers: string;
  index: number;
  score: number;
  total: number;
}): void {
  if (!authEnabled || !isLoggedIn()) return;
  void fetch("/api/attempts", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeader() },
    body: JSON.stringify({ action: "progress", ...a }),
  }).catch(() => {});
}

/** Save a completed attempt to the signed-in identity. Never blocks the UI;
 *  failures are queued and retried after the next successful login. */
export function submitAttempt(a: PendingAttempt): void {
  if (!authEnabled || !isLoggedIn()) return;
  void postAttempt(a).then((ok) => {
    if (!ok) writePending([...readPending(), a]);
  });
}

export async function flushPendingAttempts(): Promise<void> {
  const pending = readPending();
  if (!pending.length) return;
  const still: PendingAttempt[] = [];
  for (const a of pending) {
    if (!(await postAttempt(a))) still.push(a);
  }
  writePending(still);
}

/**
 * The student's own latest attempt at one test, answers included — what makes
 * read-only review work on a device that never held it in localStorage.
 */
export async function fetchMyAttempt(
  testId: string,
  student?: string
): Promise<{
  attempt: (ServerAttempt & { answers: Record<string, StoredAnswer> | null }) | null;
  progress: ServerProgress | null;
}> {
  const none = { attempt: null, progress: null };
  if (!isLoggedIn()) return none;
  try {
    const q = `?testId=${encodeURIComponent(testId)}${student ? `&student=${encodeURIComponent(student)}` : ""}`;
    const res = await apiFetch(`/api/attempts${q}`, {
      headers: authHeader(),
    });
    if (!res.ok) return none;
    const data = await res.json();
    return { attempt: data.attempt ?? null, progress: data.progress ?? null };
  } catch {
    return none;
  }
}

export async function fetchMyAttempts(student?: string): Promise<ServerAttempt[] | null> {
  if (!isLoggedIn()) return null;
  try {
    const q = student ? `?student=${encodeURIComponent(student)}` : "";
    const res = await apiFetch(`/api/attempts${q}`, { headers: authHeader() });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.attempts as ServerAttempt[]) ?? null;
  } catch {
    return null;
  }
}
