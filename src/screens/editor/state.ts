// The editor's working copy of a test, plus debounced autosave.
//
// The API replaces the whole test on every write, so a save is always the
// complete document. Saves are serialised: while one is in flight the next
// edit is held until it returns, so two writes can never race each other.

import { mutateTest } from "../../api";
import type { Question, Test } from "../../types";

export type SaveState = "clean" | "dirty" | "saving" | "saved" | "error";

const AUTOSAVE_DELAY_MS = 1000;

let test: Test | null = null;
let saveState: SaveState = "clean";
let timer: ReturnType<typeof setTimeout> | null = null;
let inFlight = false;
let pending = false;
let listeners: (() => void)[] = [];

export function loadTest(loaded: Test): void {
  test = loaded;
  saveState = "clean";
  pending = false;
  if (timer) clearTimeout(timer);
  timer = null;
}

export function currentTest(): Test | null {
  return test;
}

export function currentSaveState(): SaveState {
  return saveState;
}

/** Subscribe to save-state changes; returns an unsubscribe function. */
export function onSaveState(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    listeners = listeners.filter((l) => l !== fn);
  };
}

function emit(next: SaveState): void {
  saveState = next;
  for (const fn of listeners) fn();
}

/** Mutate the working copy and schedule a save. */
export function edit(change: (t: Test) => void): void {
  if (!test) return;
  change(test);
  emit("dirty");
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void save(), AUTOSAVE_DELAY_MS);
}

export async function save(): Promise<boolean> {
  if (!test) return false;
  if (inFlight) {
    pending = true;
    return false;
  }
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  inFlight = true;
  emit("saving");
  const result = await mutateTest("update", {
    id: test.id,
    title: test.title,
    chapter: test.chapter,
    teacher: test.teacher ?? "",
    access: test.access,
    questions: test.questions,
  });
  inFlight = false;

  if (!result.ok) {
    emit("error");
    return false;
  }
  if (pending) {
    // An edit landed mid-flight — save again rather than leaving it unsaved.
    pending = false;
    return save();
  }
  emit("saved");
  return true;
}

export function questionAt(index: number): Question | null {
  return test?.questions[index] ?? null;
}

export function indexOfQuestion(questionId: string): number {
  return test?.questions.findIndex((q) => q.id === questionId) ?? -1;
}

/** What the tree's completeness dot reflects, and the publish gate mirrors. */
export function isComplete(q: Question): boolean {
  if (!q.q.trim() || !q.solution.trim() || !(q.marks >= 1)) return false;
  if (q.type === "mcq") {
    const filled = (q.options ?? []).filter((o) => o.trim());
    if (filled.length < 2) return false;
    const answer = q.answer ?? -1;
    return answer >= 0 && answer < (q.options ?? []).length && !!(q.options ?? [])[answer]?.trim();
  }
  if (q.type === "numeric") return Number.isFinite(q.answer);
  return true;
}

export function totalMarks(t: Test): number {
  return t.questions.reduce((s, q) => s + (Number(q.marks) || 0), 0);
}
