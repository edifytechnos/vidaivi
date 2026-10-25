// What a subject can be: a school board, an entrance exam, or a college
// course the teacher names themselves (College & other, below).
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
// server says "Class" only before a plain number ("CBSE Class 12 Maths") and
// renders anything else as typed ("JEE Main 2027 Physics", "MBBS Year 1
// Anatomy"), which is a rule about the value and so has no list to keep in
// step with this file. See `classWord`.
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

/**
 * The word for a class, as it is spoken.
 *
 * "Class" is prepended to a PLAIN NUMBER and nothing else — "12" reads "Class
 * 12", while "2027", "Year 1", "Semester 3" and "MBBS I" all read as they were
 * typed. A rule about the value, so it has no list of exams, courses or
 * boards to keep in step with: a college course that lives in the same three
 * fields as a school board gets a sensible name without being named here.
 * Mirrors `classWord` on the server, which is what actually stamps the title.
 */
export function classWord(klass: string | undefined | null): string {
  const k = String(klass ?? "").trim();
  if (!k) return "";
  return /^\d{1,2}$/.test(k) ? `Class ${k}` : k;
}

/** How a subject is named, mirroring `subjectTitle` on the server. */
export function subjectTitle(board: string, klass: string, subject: string): string {
  return [board, classWord(klass), subject].filter(Boolean).join(" ");
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
  /**
   * A free group has no boards to pick from: the teacher NAMES the course,
   * and that name is stored as the `board`. It asks for a year or semester
   * where a school board asks for a class, and lets that be skipped — a
   * freeform test bank has no year. Still the same three fields.
   */
  free?: boolean;
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
  {
    id: "college",
    name: "College & other",
    hint: "Medical, engineering, arts & science — or anything freeform",
    // No boards on purpose: there is no list of every course in every
    // college, and a list of a few would be a promise about the rest. The
    // teacher names the course and it is stored as the board — "MBBS Year 1
    // Anatomy" — in the same three fields a school subject uses. Before this
    // the only way in was a school board plus "Another class", which named a
    // medical course "Tamil Nadu Class MBBS I".
    boards: [],
    free: true,
  },
];

/**
 * Courses offered under College & other, as SUGGESTIONS beneath the box —
 * never a closed set. Short and common, so a tap beats typing on a phone;
 * anything else is typed as it is.
 */
export const COURSES = [
  "MBBS",
  "BDS",
  "B.Sc Nursing",
  "B.E.",
  "B.Tech",
  "Diploma",
  "B.Sc",
  "B.A.",
  "B.Com",
  "BCA",
  "BBA",
  "M.Sc",
  "MBA",
  "General",
];

/** The years a college course is offered as tiles; a semester is typed. */
export const COLLEGE_YEARS = ["Year 1", "Year 2", "Year 3", "Year 4"];

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
