// Fetch client for the DB-backed tests API (/api/tests).
// Bundled JSON tests (src/tests/*.json) remain the platform seed; DB tests
// merge in alongside them for logged-in users.

import { authHeader, isLoggedIn } from "./auth";
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
  id: string;
  title: string;
  chapter: string;
  teacher: string | null;
  order: number;
  access: "open" | "login";
  status: "draft" | "published" | "archived";
  platform: boolean;
  sample: boolean;
  ownerSub: string;
  questionCount: number;
  totalMarks: number;
  updatedAt?: string;
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
export async function fetchTestList(): Promise<{ tests: ServerTestMeta[]; needsSamples: boolean } | null> {
  if (!isLoggedIn()) return null;
  try {
    const res = await fetch("/api/tests", { headers: authHeader() });
    if (!res.ok) return null;
    const data = await res.json();
    return { tests: data.tests as ServerTestMeta[], needsSamples: !!data.needsSamples };
  } catch {
    return null;
  }
}

/** Copy the bundled tests in as this teacher's own editable drafts. The server
 *  only honours this once per teacher, so calling it again is harmless. */
export async function seedSampleTests(tests: Test[]): Promise<number> {
  try {
    const res = await fetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action: "seedSamples", tests }),
    });
    if (!res.ok) return 0;
    return (await res.json()).seeded ?? 0;
  } catch {
    return 0;
  }
}

export async function fetchServerTest(id: string): Promise<Test | null> {
  if (!isLoggedIn()) return null;
  try {
    const res = await fetch(`/api/tests?id=${encodeURIComponent(id)}`, {
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
    const res = await fetch("/api/tests", {
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

export async function setTestStatus(
  id: string,
  action: "publish" | "unpublish" | "archive" | "delete"
): Promise<{ ok: boolean; message?: string; problems?: TestProblem[] }> {
  try {
    const res = await fetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action, id }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      return { ok: false, message: data.error || "Request failed", problems: data.problems };
    }
    return { ok: true };
  } catch {
    return { ok: false, message: "Network error" };
  }
}
