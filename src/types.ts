// Shared domain types. The Question/Test shapes mirror the JSON schema
// documented in CLAUDE.md — do not rename or repurpose fields.

export type QType = "mcq" | "numeric" | "long";

export interface Question {
  id: string;
  chapter: string;
  topic: string;
  /**
   * Where the question came from, e.g. "CBSE 2025". Optional and free text —
   * shown as a chip beside the topic. Never graded, never required.
   */
  source?: string;
  type: QType;
  q: string;
  options?: string[];
  /**
   * mcq: the 0-based index of the correct option, always a number.
   * numeric (short answer): the expected answer — a number, or the text a
   * student is expected to write when the answer is a symbol ("√3/2").
   */
  answer?: number | string;
  /**
   * Short answers only: other ways of writing the same answer that count as
   * right ("root 3 / 2", "0.866"). Optional; comparison is on normalised text.
   */
  accept?: string[];
  tolerance?: number;
  solution: string;
  marks: number;
}

export interface Test {
  id: string;
  title: string;
  chapter: string;
  teacher?: string | null;
  order?: number;
  access?: "open" | "login"; // "login" requires Google sign-in; default "open"
  // Present only on tests fetched from the API; bundled JSON tests have neither.
  status?: "draft" | "published" | "archived";
  sample?: boolean;
  /** A master in the Vidai library. Only an admin may change one. */
  platform?: boolean;
  /** Who sits it: "class" is everyone the owner teaches; "selected" is `assignedTo`. */
  audience?: "class" | "selected";
  assignedCount?: number;
  /** Staff only — the server never sends this to a student. */
  assignedTo?: string[];
  questions: Question[];
}

export interface StoredAnswer {
  given: number | null; // mcq: option index; numeric: value; long: 1 right / 0 wrong
  /**
   * Short answers: exactly what the student typed. `given` holds the parsed
   * number when there is one and null otherwise, so this is the only record of
   * an answer written as a symbol — and the thing the teacher reads when one
   * lands in the marking queue.
   */
  text?: string;
  correct: boolean;
  earned: number;
  /** Long answers: blob names of the photos handed in. */
  images?: string[];
  /**
   * A long answer, or a short one the grader could not settle. "pending"
   * until the teacher awards marks — `earned`
   * stays 0 while it is, so the score screen can be honest about what is
   * still out for review.
   */
  review?: "pending" | "marked";
  /** What the teacher wrote when awarding the marks. */
  comment?: string;
}

export interface Attempt {
  answers: Record<string, StoredAnswer>;
  index: number; // next unanswered question
  completed: boolean;
  score: number;
  completedAt?: string;
  updatedAt: string;
}

/** KaTeX's auto-render contrib entry ships no type declarations of its own. */
export type RenderMathInElement = (el: HTMLElement, opts?: object) => void;
