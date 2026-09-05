// Google Identity Services (client-side popup) + our /api for verification
// and storage. Auth is disabled entirely when VITE_GOOGLE_CLIENT_ID is unset
// (local dev, forks) — the app then behaves as guest-only.

export interface Profile {
  sub: string;
  name: string;
  email: string;
  picture?: string;
  phone?: string;
}

interface AuthState {
  credential: string; // Google ID token (JWT, ~1h validity)
  profile: Profile;
  savedAt: number;
}

export interface ServerAttempt {
  testId: string;
  score: number;
  total: number;
  completedAt: string;
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

// ---------- Google Identity Services ----------

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

async function apiLogin(
  credential: string,
  phone?: string
): Promise<Profile> {
  const res = await fetch("/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${credential}`,
    },
    body: JSON.stringify(phone ? { phone } : {}),
  });
  if (!res.ok) throw new Error(`Login failed (${res.status})`);
  return (await res.json()) as Profile;
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
  if (!auth) return false;
  try {
    const profile = await apiLogin(auth.credential, phone);
    saveAuth({ ...auth, profile });
    return true;
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
  const auth = getAuth();
  if (!auth) return false;
  try {
    const res = await fetch("/api/attempts", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${auth.credential}`,
      },
      body: JSON.stringify(a),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Save a completed attempt to the student's profile. Never blocks the UI;
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
  const auth = getAuth();
  if (!auth) return null;
  try {
    const res = await fetch("/api/attempts", {
      headers: { Authorization: `Bearer ${auth.credential}` },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return (data.attempts as ServerAttempt[]) ?? null;
  } catch {
    return null;
  }
}
