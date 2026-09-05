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
  questions: Question[];
}

export interface StoredAnswer {
  given: number | null; // mcq: option index; numeric: value; long: 1 right / 0 wrong
  correct: boolean;
  earned: number;
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
