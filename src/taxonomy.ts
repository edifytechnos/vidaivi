// What a subject can be: a school board, or an entrance exam.
//
// **An entrance exam is a `board` value.** "JEE Main Physics" is
// `{board: "JEE Main", klass: "2027", subject: "Physics"}` — the same three
// fields every subject already has, stored the same way, gated the same way.
// That is not a shortcut: it is how NEET has been modelled since the library
// was seeded, and it means offering four more exams changes a screen rather
// than a table.
//
// The alternative was a fourth axis (`exam` beside board/klass/subject), which
// is more truthful to how a Class 12 student works — the same Physics
// chapters, two question styles — and is a storage-shape change, which
// CLAUDE.md is explicit cannot be exercised on QA before it merges. It stays
// the right shape for the day somebody wants "JEE questions from the chapter I
// am teaching".
//
// **An exam stores its attempt year where a board stores its class**, because
// the year is what an exam's batches are told apart by: a teacher running a
// 2027 batch and a 2028 batch gets two subjects, two rosters and two sets of
// attempts, instead of one subject that quietly accumulates both. `klass` is
// already a free string — "Another class" has always taken whatever a teacher
// types — so this needs no new field and no migration. `subjectTitle` on the
// server renders a four-digit year bare ("JEE Main 2027 Physics") and anything
// else as a class ("CBSE Class 12 Maths"), which is a rule about the value and
// so has no list to keep in step with this file.
//
// This module is the ONE place that knows the shape of that taxonomy, because
// the New subject flow, the board suggestions and anything that groups
// subjects later must not each keep their own copy.

/** An entrance exam a Class 12 student sits alongside their board. */
export interface Exam {
  /** Stored as `board`. Never change one after a subject exists under it. */
  board: string;
  /** One line under the pill: who it is for. */
  hint: string;
  /** The papers it has. A subject is one of these. */
  papers: string[];
}

export const EXAMS: Exam[] = [
  {
    board: "JEE Main",
    hint: "Engineering entrance",
    papers: ["Physics", "Chemistry", "Maths"],
  },
  {
    board: "JEE Advanced",
    hint: "For the IITs — harder, same three papers",
    papers: ["Physics", "Chemistry", "Maths"],
  },
  {
    board: "NEET",
    hint: "Medical entrance",
    papers: ["Physics", "Chemistry", "Biology"],
  },
  {
    board: "CUET",
    hint: "Central university admissions",
    papers: ["Physics", "Chemistry", "Maths", "Biology", "English", "General Test"],
  },
];

const EXAM_BOARDS = new Set(EXAMS.map((x) => x.board.toLowerCase()));

/**
 * Is this `board` an entrance exam rather than a school board?
 *
 * Read off the known list and **not** guessed from the string. A heuristic
 * would have to decide what "State Board" and "Cambridge A Level" are, and
 * would get a board nobody here has heard of wrong in whichever direction is
 * least convenient. An unknown board is a school board, which is the answer
 * that puts a teacher's own typed subject where they expect it.
 */
export function isExamBoard(board: string | undefined | null): boolean {
  return EXAM_BOARDS.has(String(board ?? "").trim().toLowerCase());
}

export function examFor(board: string | undefined | null): Exam | undefined {
  const key = String(board ?? "").trim().toLowerCase();
  return EXAMS.find((x) => x.board.toLowerCase() === key);
}

/**
 * The attempt years to offer an exam, newest first.
 *
 * Derived from the clock rather than listed, so this does not quietly start
 * offering last year's sitting. A paper sat in the spring belongs to the year
 * it is sat in, and somebody preparing in September is preparing for next
 * year — so the current year is offered only up to June.
 */
export function examYears(now = new Date()): string[] {
  const y = now.getFullYear();
  const first = now.getMonth() < 6 ? y : y + 1;
  return [String(first), String(first + 1)];
}

/** A four-digit year reads as a year; anything else reads as a class. */
export function isYear(klass: string | undefined | null): boolean {
  return /^(19|20)\d{2}$/.test(String(klass ?? "").trim());
}

/** How a subject is named, mirroring `subjectTitle` on the server. */
export function subjectTitle(board: string, klass: string, subject: string): string {
  const middle = !klass ? "" : isYear(klass) ? klass : `Class ${klass}`;
  return [board, middle, subject].filter(Boolean).join(" ");
}

// ---------------------------------------------------------------- the groups
//
// Step 1 of the New subject flow. A group is a heading you press; its boards
// appear beneath it as pills, so the board resolves in ONE step rather than
// two — which is the whole reason the old flat list of eleven shelves is
// going away.

export interface BoardGroup {
  id: string;
  name: string;
  hint: string;
  boards: string[];
  /** An exam group asks for an attempt year where a board asks for a class. */
  exam?: boolean;
}

export const BOARD_GROUPS: BoardGroup[] = [
  {
    id: "national",
    name: "National",
    hint: "CBSE and ICSE",
    boards: ["CBSE", "ICSE"],
  },
  {
    id: "intl",
    name: "International",
    hint: "Cambridge IGCSE and A Level",
    boards: ["Cambridge IGCSE", "Cambridge A Level"],
  },
  {
    id: "exam",
    name: "Entrance exam",
    hint: "JEE, NEET and CUET — sat alongside a board",
    boards: EXAMS.map((x) => x.board),
    exam: true,
  },
  {
    id: "state",
    name: "State Board",
    hint: "Tamil Nadu and Kerala",
    // Only the states with shelves being written. Another state is one entry
    // here once its syllabus and papers are in hand — a board listed with
    // nothing behind it reads as a promise the library cannot keep.
    boards: ["Tamil Nadu", "Kerala"],
  },
];

export function groupFor(board: string): BoardGroup | undefined {
  const key = board.trim().toLowerCase();
  return BOARD_GROUPS.find((g) => g.boards.some((b) => b.toLowerCase() === key));
}

/** School classes, for the tiles and the suggestions. */
export const CLASSES = ["8", "9", "10", "11", "12"];

/** Every board worth suggesting. Still only suggestions, never a closed set. */
export const ALL_BOARDS = BOARD_GROUPS.flatMap((g) => g.boards);

export const SUBJECTS = [
  "Maths",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "Computer Science",
];
