// Fetch client for the DB-backed tests API (/api/tests).
// Bundled JSON tests (src/tests/*.json) remain the platform seed; DB tests
// merge in alongside them for logged-in users.

import { authHeader, isLoggedIn, apiFetch } from "./auth";
import type { Test } from "./types";

/** New question ids carry a random suffix: positional ids collide when a
 *  question is deleted and another added (the new one is handed an index that
 *  a surviving question already owns, and the server rejects the save). */
export function newQuestionId(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 32) || "q";
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${slug}-${suffix}`;
}

export interface ServerTestMeta {
  /** "class" = everyone this teacher teaches; "selected" = `assignedTo` only. */
  audience?: "class" | "selected";
  assignedCount?: number;
  /** Staff only — a student never receives the class list. */
  assignedTo?: string[];
  id: string;
  title: string;
  chapter: string;
  teacher: string | null;
  order: number;
  access: "open" | "login";
  status: "draft" | "published" | "archived";
  platform: boolean;
  sample: boolean;
  subjectId: string;
  ownerSub: string;
  questionCount: number;
  totalMarks: number;
  updatedAt?: string;
  /** Library listing only: this teacher already has a copy of this master. */
  adopted?: boolean;
}

export interface TestProblem {
  index: number;
  questionId: string;
  reason: string;
}

export async function fetchServerTests(): Promise<ServerTestMeta[] | null> {
  return (await fetchTestList())?.tests ?? null;
}

/** The list plus whether this teacher still needs their starter samples. */
/** `student` asks for a linked child's view — the server checks the link. */
/**
 * `withPlatform` asks for the library's masters as well. They are left out by
 * default: every caller of this list bar one discards them (`!t.platform`), and
 * that was 125 rows and 65 KB on every render. A shelf-scoped `subjectId` gets
 * them without asking, since a shelf holds nothing else.
 */
export async function fetchTestList(
  subjectId?: string,
  student?: string,
  withPlatform?: boolean
): Promise<{ tests: ServerTestMeta[]; needsSamples: boolean } | null> {
  if (!isLoggedIn()) return null;
  try {
    const params = new URLSearchParams();
    if (subjectId) params.set("subjectId", subjectId);
    if (student) params.set("student", student);
    if (withPlatform) params.set("platform", "1");
    const q = params.toString() ? `?${params}` : "";
    const res = await apiFetch(`/api/tests${q}`, { headers: authHeader() });
    if (!res.ok) return null;
    const data = await res.json();
    return { tests: data.tests as ServerTestMeta[], needsSamples: !!data.needsSamples };
  } catch {
    return null;
  }
}

/** Copy the bundled tests in as this teacher's own editable drafts. The server
 *  only honours this once per teacher, so calling it again is harmless. */
/**
 * Copy the bundled tests in as this teacher's own editable drafts, once ever.
 * `subjectId` files them under an existing subject; without it the server's
 * orphan adoption puts them under the default one it creates.
 */
export async function seedSampleTests(tests: Test[], subjectId?: string): Promise<number> {
  try {
    const res = await apiFetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "seedSamples", tests, subjectId }),
    });
    if (!res.ok) return 0;
    return (await res.json()).seeded ?? 0;
  } catch {
    return 0;
  }
}

export interface Child {
  username: string;
  name: string;
  teacherSub: string;
  linkedAt: string;
  /**
   * True when this account issued the login itself, false when it was linked
   * with a teacher's invite code. The two are genuinely different: your own
   * child is yours to mark and to reset a password for, a linked one belongs
   * to their teacher and you only watch.
   */
  own?: boolean;
}

/** The children linked to the signed-in parent. */
export async function fetchChildren(): Promise<Child[] | null> {
  if (!isLoggedIn()) return null;
  try {
    const res = await apiFetch("/api/parentlink", { headers: authHeader() });
    if (!res.ok) return null;
    return (await res.json()).children ?? [];
  } catch {
    return null;
  }
}

/** Teacher: mint a one-time code to hand a parent. */
export async function createParentInvite(
  username: string
): Promise<{ ok: true; code: string } | { ok: false; message: string }> {
  try {
    const res = await apiFetch("/api/parentlink", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "invite", username }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Could not create an invite" };
    return { ok: true, code: data.code };
  } catch {
    return { ok: false, message: "Network error — try again" };
  }
}

/** Parent: redeem a code and link the child it names. */
export async function redeemParentInvite(
  code: string
): Promise<{ ok: true; child: string } | { ok: false; message: string }> {
  try {
    const res = await apiFetch("/api/parentlink", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "redeem", code }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Could not use that code" };
    return { ok: true, child: data.child || "your child" };
  } catch {
    return { ok: false, message: "Network error — try again" };
  }
}

export interface Subject {
  id: string;
  board: string;
  klass: string;
  subject: string;
  title: string;
  /** A built-in library shelf: every teacher sees it, only an admin owns it. */
  platform?: boolean;
  ownerSub: string;
  collaborators: string[];
  testCount?: number;
  createdAt?: string;
}

export async function fetchSubjects(): Promise<Subject[] | null> {
  if (!isLoggedIn()) return null;
  try {
    const res = await apiFetch("/api/subjects", { headers: authHeader() });
    if (!res.ok) return null;
    return (await res.json()).subjects as Subject[];
  } catch {
    return null;
  }
}

export async function mutateSubject(
  action: "create" | "update" | "delete",
  input: { id?: string; board?: string; klass?: string; subject?: string }
): Promise<{ ok: true; subject?: Subject } | { ok: false; message: string }> {
  try {
    const res = await apiFetch("/api/subjects", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action, ...input }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Request failed" };
    return { ok: true, subject: data.subject };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

/**
 * One full test.
 *
 * `student` asks for it **as that child**, which is the only way a parent can
 * read a paper their child sat: the server resolves the child's teacher from
 * the link and looks in that partition. Without it the read only ever names the
 * caller's own partition and the library, so a parent opening their child's
 * result got a 404 and the screen said "That attempt could not be opened".
 */
/**
 * One full test.
 *
 * `student` reads **as** that child — a parent's route, judged by the student's
 * own visibility rules. `markFor` is the other thing: a teacher or an admin
 * opening that student's paper to mark it, judged by their own staff rules, so
 * an unpublished or narrowly-assigned paper still opens. They are separate
 * because conflating them 404s a marker on exactly the papers they mark.
 */
export async function fetchServerTest(
  id: string,
  student?: string,
  markFor?: string
): Promise<Test | null> {
  if (!isLoggedIn()) return null;
  try {
    const params = new URLSearchParams({ id });
    if (student) params.set("student", student);
    if (markFor) params.set("forStudent", markFor);
    const res = await apiFetch(`/api/tests?${params}`, {
      headers: authHeader(),
    });
    if (!res.ok) return null;
    return (await res.json()).test as Test;
  } catch {
    return null;
  }
}

export async function mutateTest(
  action: "create" | "update",
  test: Partial<Test> & { platform?: boolean }
): Promise<
  | { ok: true; test: ServerTestMeta }
  | { ok: false; message: string; problems?: TestProblem[] }
> {
  try {
    const res = await apiFetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action, test }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: data.error || "Request failed", problems: data.problems };
    }
    return { ok: true, test: data.test };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

/**
 * Who sits this test. "class" is everyone the teacher created; "selected" is
 * the named students and nobody else. The server re-checks every username.
 */
export async function assignTest(
  id: string,
  audience: "class" | "selected",
  usernames: string[]
): Promise<{ ok: true; assignedCount: number } | { ok: false; message: string }> {
  try {
    const res = await apiFetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "assign", id, audience, usernames }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Could not save who sees this test" };
    return { ok: true, assignedCount: data.assignedCount ?? 0 };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

/** The built-in library: published master tests any teacher may copy. */
export async function fetchLibrary(subjectId?: string): Promise<ServerTestMeta[] | null> {
  if (!isLoggedIn()) return null;
  try {
    const q = subjectId ? `&subjectId=${encodeURIComponent(subjectId)}` : "";
    const res = await apiFetch(`/api/tests?library=1${q}`, { headers: authHeader() });
    if (!res.ok) return null;
    return (await res.json()).tests as ServerTestMeta[];
  } catch {
    return null;
  }
}

/** Take your own editable draft copy of a built-in test. */
/**
 * Take a copy of one or more built-in tests. `into` files them under a subject
 * the caller owns; without it the server picks the caller's subject with the
 * same board/class/subject, creating one if they have none.
 *
 * Many ids go in ONE request — a teacher building a subject from the library
 * picks several chapters, and that must not be a POST per chapter.
 */
export async function adoptTests(
  ids: string[],
  into?: string | null
): Promise<{ ok: boolean; message?: string; tests?: ServerTestMeta[] }> {
  try {
    const res = await apiFetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "adopt", ids, ...(into ? { subjectId: into } : {}) }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Request failed" };
    return { ok: true, tests: (data.tests ?? []) as ServerTestMeta[] };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

export async function adoptTest(
  id: string,
  into?: string | null
): Promise<{ ok: boolean; message?: string; test?: ServerTestMeta }> {
  const result = await adoptTests([id], into);
  return { ok: result.ok, message: result.message, test: result.tests?.[0] };
}

/** Who is part-way through a test, when publishing is refused because of it. */
export interface InProgressHolder {
  /** Empty when it is the caller's own unfinished preview. */
  username: string;
  self: boolean;
}

export async function setTestStatus(
  id: string,
  action: "publish" | "unpublish" | "archive" | "delete"
): Promise<{
  ok: boolean;
  message?: string;
  problems?: TestProblem[];
  inProgress?: InProgressHolder[];
}> {
  try {
    const res = await apiFetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action, id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return {
        ok: false,
        message: data.error || "Request failed",
        problems: data.problems,
        inProgress: data.inProgress,
      };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

/**
 * Throw away an unfinished attempt so the test can be published.
 *
 * Omit `username` for the caller's own preview. Destructive: the answers in
 * that row go with it, which is why every caller asks first.
 */
export async function discardAttempt(
  testId: string,
  username?: string
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await apiFetch("/api/attempts", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "discard", testId, username }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Could not discard that attempt" };
    return { ok: true };
  } catch {
    return { ok: false, message: "Network error" };
  }
}
