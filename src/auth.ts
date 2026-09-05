// Two kinds of signed-in identity:
//  - "google": teachers and parents, via Google Identity Services popup.
//  - "student": teacher-issued username/password, via /api/student-login,
//    kept alive by a signed session token (~30 days).
// Auth is disabled entirely when VITE_GOOGLE_CLIENT_ID is unset (local dev).

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
  credential: string; // Google ID token or student session token
  profile: Profile;
  savedAt: number;
}

export interface ServerAttempt {
  testId: string;
  score: number;
  total: number;
  completedAt: string;
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

const AUTH_KEY = "vidaivi:auth";
const PENDING_KEY = "vidaivi:pendingAttempts";

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

export function isAdmin(): boolean {
  return getProfile()?.role === "admin";
}

function saveAuth(state: AuthState): void {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify(state));
  } catch {}
}

export function signOut(): void {
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {}
}

function authHeader(): Record<string, string> {
  const auth = getAuth();
  return auth ? { Authorization: `Bearer ${auth.credential}` } : {};
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

async function apiLogin(credential: string, phone?: string): Promise<Profile> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`,
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
        saveAuth({
          kind: "google",
          credential: response.credential,
          profile,
          savedAt: Date.now(),
        });
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
    const profile = await apiLogin(auth.credential, phone);
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
    const res = await fetch("/api/student-login", {
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
      credential: data.token,
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
    const res = await fetch("/api/admin-login", {
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
      kind: "admin",
      credential: data.token,
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
    const res = await fetch("/api/teachers", { headers: authHeader() });
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
    const res = await fetch("/api/teachers", {
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
    const res = await fetch("/api/students", { headers: authHeader() });
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
    const res = await fetch("/api/students", {
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

export async function resetStudentPassword(
  username: string
): Promise<{ username: string; password: string } | null> {
  try {
    const res = await fetch("/api/students", {
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

// ---------- Attempts (fire-and-forget with offline queue) ----------

interface PendingAttempt {
  testId: string;
  score: number;
  total: number;
  completedAt: string;
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
    const res = await fetch("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify(a),
    });
    return res.ok;
  } catch {
    return false;
  }
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

export async function fetchMyAttempts(): Promise<ServerAttempt[] | null> {
  if (!isLoggedIn()) return null;
  try {
    const res = await fetch("/api/attempts", { headers: authHeader() });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.attempts as ServerAttempt[]) ?? null;
  } catch {
    return null;
  }
}
