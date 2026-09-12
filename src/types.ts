// Shared domain types. The Question/Test shapes mirror the JSON schema
// documented in CLAUDE.md — do not rename or repurpose fields.

export type QType = "mcq" | "numeric" | "long";

export interface Question {
  id: string;
  chapter: string;
  topic: string;
  type: QType;
  q: string;
  options?: string[];
  answer?: number;
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
  /** Who sits it: "class" is everyone the owner teaches; "selected" is `assignedTo`. */
  audience?: "class" | "selected";
  assignedCount?: number;
  /** Staff only — the server never sends this to a student. */
  assignedTo?: string[];
  questions: Question[];
}

export interface StoredAnswer {
  given: number | null; // mcq: option index; numeric: value; long: 1 right / 0 wrong
  correct: boolean;
  earned: number;
  /** Long answers: blob names of the photos handed in. */
  images?: string[];
  /**
   * Long answers only. "pending" until the teacher awards marks — `earned`
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

declare global {
  interface Window {
    renderMathInElement?: (el: HTMLElement, opts?: object) => void;
  }
}
