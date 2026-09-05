import type { Test } from "./types";

// Test registry: every JSON file in src/tests/ is a test — adding a file
// adds the test, no code change (see CLAUDE.md schema).
const modules = import.meta.glob("./tests/*.json", { eager: true }) as Record<
  string,
  { default: Test }
>;

export const TESTS: Test[] = Object.values(modules)
  .map((m) => m.default)
  .sort((a, b) => (a.order ?? 99) - (b.order ?? 99));

export function totalMarks(test: Test): number {
  return test.questions.reduce((s, q) => s + q.marks, 0);
}

export function testTitle(testId: string): string {
  return TESTS.find((t) => t.id === testId)?.title ?? testId;
}
