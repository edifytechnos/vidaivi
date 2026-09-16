import { gradeShort } from "./shortanswer";
import type { Question, Test } from "./types";

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

/**
 * Is this answer right, and what is it worth? The one place the rules live —
 * the linear player and the student workspace both grade through it, so a
 * tolerance change can never apply to one screen and not the other.
 * A `long` answer is never auto-graded: the teacher awards those marks.
 */
/**
 * The correct option's index. `answer` is widened to `number | string` for
 * short answers; on an mcq it is always an index, and this is the one place
 * that says so rather than each caller casting.
 */
export function optionIndex(q: { answer?: number | string }): number {
  return typeof q.answer === "number" && Number.isInteger(q.answer) ? q.answer : -1;
}

export function gradeAnswer(q: Question, given: number | null): boolean {
  if (given === null || !Number.isFinite(given)) return false;
  if (q.type === "mcq") return given === q.answer;
  if (q.type === "numeric") return gradeShort(q, String(given)) === "right";
  return false;
}

export { gradeShort, normaliseAnswer, type Verdict } from "./shortanswer";
