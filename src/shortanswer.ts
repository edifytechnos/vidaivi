// How a short answer is graded. Its own module, with no imports but the types,
// so the regression suite can drive the rules directly — `data.ts` reaches for
// `import.meta.glob` and cannot be loaded outside a bundle.

import type { Question } from "./types";

// ---------- Short answers ----------
//
// The type is still called `numeric` in the JSON and in Table Storage — 573
// library questions carry it and the schema is stable — but what a student
// types is no longer required to be a number. A CBSE answer is very often a
// symbol: $\sqrt3/2$, $\pi/4$, $x=2$. A box that only accepts digits cannot
// hold those, so the box is a text box and the grading widened to match.
//
// **Nothing is ever marked wrong because the grader could not read it.** Two
// passes decide, and there is a third outcome:
//
//   1. both sides are numbers  → compare with the tolerance. A number is
//      decidable, so it is never sent to a teacher.
//   2. otherwise               → compare the normalised text against the
//      expected answer and every accepted variant.
//   3. no match, and not a number comparison → **review**: it goes to the
//      marking queue with `earned` 0, exactly as a long answer does.
//
// Outcome 3 is the whole point. A student who writes "root 3 over 2" where the
// teacher wrote "√3/2" has not got it wrong; the grader has run out of rules.

export type Verdict = "right" | "wrong" | "review";

/**
 * Two ways of writing the same answer, reduced to one string.
 *
 * Deliberately shallow: case, spaces, the handful of symbols a phone keyboard
 * and a textbook spell differently, and a trailing full stop. It is NOT a
 * maths engine — it will never know that 1/2 and 0.5 are the same, and it must
 * not pretend to, because a wrong "equivalent" is a mark wrongly taken away.
 * Anything it cannot settle goes to the teacher.
 */
export function normaliseAnswer(text: string): string {
  return String(text)
    .toLowerCase()
    .replace(/\$/g, "")
    .replace(/\\(?:sqrt|surd)\s*/g, "√")
    .replace(/\bsqrt\s*/g, "√")
    .replace(/\broot\s*/g, "√")
    .replace(/\\(?:pi)\b/g, "π")
    .replace(/\bpi\b/g, "π")
    .replace(/\\(?:times|cdot)\b/g, "*")
    .replace(/[×⋅·]/g, "*")
    .replace(/\\div\b/g, "/")
    .replace(/[÷]/g, "/")
    .replace(/[−–—]/g, "-")
    .replace(/\\frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, "($1)/($2)")
    .replace(/\bdegrees?\b|°/g, "deg")
    .replace(/[\s,]+/g, "")
    .replace(/\.$/, "");
}

/** Everything that counts as right: the answer itself, plus `accept`. */
function expectedFor(q: Question): { numbers: number[]; texts: string[] } {
  const numbers: number[] = [];
  const texts: string[] = [];
  const add = (v: unknown) => {
    if (typeof v === "number" && Number.isFinite(v)) {
      numbers.push(v);
      texts.push(normaliseAnswer(String(v)));
      return;
    }
    const raw = String(v ?? "").trim();
    if (!raw) return;
    const n = Number(raw);
    if (raw !== "" && Number.isFinite(n)) numbers.push(n);
    texts.push(normaliseAnswer(raw));
  };
  add(q.answer);
  for (const alt of q.accept ?? []) add(alt);
  return { numbers, texts: texts.filter(Boolean) };
}

/** Grade what the student typed. See the note above for the three outcomes. */
export function gradeShort(q: Question, typed: string): Verdict {
  const text = String(typed ?? "").trim();
  if (!text) return "wrong";
  const { numbers, texts } = expectedFor(q);
  const tol = q.tolerance ?? 0;

  const given = Number(text);
  if (numbers.length && text !== "" && Number.isFinite(given)) {
    // Both sides are numbers. This is decidable, so it is decided here and
    // never handed to a teacher — including when it is decidedly wrong.
    return numbers.some((n) => Math.abs(given - n) <= tol) ? "right" : "wrong";
  }

  const norm = normaliseAnswer(text);
  if (norm && texts.includes(norm)) return "right";

  // A question with nothing but a numeric answer, answered in words or
  // symbols: the grader has run out of rules, not the student out of luck.
  return "review";
}
