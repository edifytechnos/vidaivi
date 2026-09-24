// What a subject can be: a school board, or an entrance exam.
//
// **An entrance exam is a `board` value.** "JEE Main Physics" is
// `{board: "JEE Main", klass: "12", subject: "Physics"}` — the same three
// fields every subject already has, stored the same way, gated the same way.
// That is not a shortcut: it is how NEET has been modelled since the library
// was seeded, and it means offering four more exams changes a screen rather
// than a table.
//
// The alternative considered and rejected for now was a fourth axis (`exam`
// beside board/klass/subject), which is more truthful to how a Class 12
// student actually works — the same Physics chapters, two question styles —
// but is a storage-shape change, and CLAUDE.md is explicit that those cannot
// be exercised on QA before they merge. It stays the right shape for the day
// somebody wants "JEE questions from the chapter I am teaching".
//
// This module is the ONE place that knows which boards are exams and what
// subjects each exam has, because the New subject flow, the board suggestions
// and anything that groups subjects later must not each keep their own list.

/** An entrance exam a Class 12 student sits alongside their board. */
export interface Exam {
  /** Stored as `board`. Never change one after a subject exists under it. */
  board: string;
  /** What the tile says. */
  label: string;
  /** One line under the tile: who it is for. */
  hint: string;
  /** The papers it has. A subject is one of these. */
  subjects: string[];
  /** The class it is sat from, stored as `klass`. */
  klass: string;
}

export const EXAMS: Exam[] = [
  {
    board: "JEE Main",
    label: "JEE Main",
    hint: "Engineering entrance · Physics, Chemistry, Maths",
    subjects: ["Physics", "Chemistry", "Maths"],
    klass: "12",
  },
  {
    board: "JEE Advanced",
    label: "JEE Advanced",
    hint: "For the IITs · harder than JEE Main, same three subjects",
    subjects: ["Physics", "Chemistry", "Maths"],
    klass: "12",
  },
  {
    board: "NEET",
    label: "NEET",
    hint: "Medical entrance · Physics, Chemistry, Biology",
    subjects: ["Physics", "Chemistry", "Biology"],
    klass: "12",
  },
  {
    board: "CUET",
    label: "CUET",
    hint: "Central university admissions · pick the papers you teach",
    subjects: [
      "Physics",
      "Chemistry",
      "Maths",
      "Biology",
      "English",
      "General Test",
    ],
    klass: "12",
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

/** School boards, for the free-text suggestions. Never a closed set. */
export const SCHOOL_BOARDS = [
  "CBSE",
  "ICSE",
  "State Board",
  "Cambridge IGCSE",
  "Cambridge A Level",
];

/** Every board worth suggesting, exams included. Still only suggestions. */
export const ALL_BOARDS = [...SCHOOL_BOARDS, ...EXAMS.map((x) => x.board)];

export const CLASSES = ["8", "9", "10", "11", "12"];

export const SUBJECTS = [
  "Maths",
  "Physics",
  "Chemistry",
  "Biology",
  "English",
  "Computer Science",
];
