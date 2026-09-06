// Fetch client for the DB-backed tests API (/api/tests).
// Bundled JSON tests (src/tests/*.json) remain the platform seed; DB tests
// merge in alongside them for logged-in users.

import { authHeader, isLoggedIn } from "./auth";
import type { Test } from "./types";

export interface ServerTestMeta {
  id: string;
  title: string;
  chapter: string;
  teacher: string | null;
  order: number;
  access: "open" | "login";
  status: "draft" | "published" | "archived";
  platform: boolean;
  ownerSub: string;
  questionCount: number;
  totalMarks: number;
  updatedAt?: string;
}

export async function fetchServerTests(): Promise<ServerTestMeta[] | null> {
  if (!isLoggedIn()) return null;
  try {
    const res = await fetch("/api/tests", { headers: authHeader() });
    if (!res.ok) return null;
    return (await res.json()).tests as ServerTestMeta[];
  } catch {
    return null;
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
): Promise<{ ok: true; test: ServerTestMeta } | { ok: false; message: string }> {
  try {
    const res = await fetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action, test }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, message: data.error || "Request failed" };
    return { ok: true, test: data.test };
  } catch {
    return { ok: false, message: "Network error" };
  }
}

export async function setTestStatus(
  id: string,
  action: "publish" | "unpublish" | "archive" | "delete"
): Promise<{ ok: boolean; message?: string }> {
  try {
    const res = await fetch("/api/tests", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeader() },
      body: JSON.stringify({ action, id }),
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
