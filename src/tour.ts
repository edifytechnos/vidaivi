// The self-guided tour: five cards on first sign-in, per role, ending at the
// help centre.
//
// It is `openModal`'s multi-step dialog and nothing else — no new dependency,
// no spotlight library. A coach mark anchored to a real element looks better
// and breaks the first time a button moves or a screen is a skeleton, which on
// a cold start on a cheap Android phone is most of the first second. Cards say
// the same things and cannot be wrong about where anything is, because they
// never claim to point at it.
//
// It is also not the place to explain the whole product. Five cards, then the
// door to /help, which is where the detail lives.

import { getProfile, isAdmin, isLoggedIn, isParent, isTeacher } from "./auth";
import { openModal } from "./modal";
import { track } from "./analytics";

export type TourRole = "student" | "parent" | "teacher" | "admin";

/** The help centre. One place, so a rename is one edit. */
export const HELP_BASE = "/help/";
// Note: Azure treats `/help` and `/help/` as one route — declaring both in
// staticwebapp.config.json fails validation at deploy time with "a duplicate
// route". The config has `/help` alone; this trailing slash resolves to it.

const FIRST_PAGE: Record<TourRole, string> = {
  student: "student/01-signing-in.html",
  parent: "parent/01-getting-started.html",
  teacher: "teacher/01-getting-started.html",
  admin: "admin/01-teachers-and-accounts.html",
};

export function helpUrl(role?: TourRole): string {
  return HELP_BASE + (role ? FIRST_PAGE[role] : "");
}

/** Which tour to run. A student is decided by their login kind, not a role. */
export function tourRole(): TourRole | null {
  if (!isLoggedIn()) return null;
  if (getProfile()?.kind === "student") return "student";
  if (isAdmin()) return "admin";
  if (isParent()) return "parent";
  if (isTeacher()) return "teacher";
  return null;
}

interface Card {
  title: string;
  body: string;
}

// One idea per card, in the order somebody actually meets it. The last card is
// always the handover to /help — a tour that ends by simply closing has taught
// somebody five things and told them nowhere to go for the sixth.
const TOURS: Record<TourRole, Card[]> = {
  student: [
    {
      title: "Your subjects",
      body: "Each subject is a folder of tests your teacher or your parent has set. Open one to see what is waiting for you.",
    },
    {
      title: "One question at a time",
      body: "Answer them in any order and change your mind as often as you like. There is no Save button — tapping an option saves it, and a typed answer saves a second after you stop typing.",
    },
    {
      title: "Photograph your working",
      body: "A long answer is marked by a person, so they need to see your method. Tap the photo after you take it and check you can read it zoomed in — if it is blurry, take it again.",
    },
    {
      title: "Hand in, then wait",
      body: "After you hand in you see nothing at first: no score, no answers. That is on purpose. Your teacher marks the paper and releases it, and then everything opens at once.",
    },
    {
      title: "Then read the solutions",
      body: "Once it is released you get your marks, the correct answers and the full worked solution for every question. Read the solutions for the ones you got right too — on a board paper the method carries the marks.",
    },
  ],
  parent: [
    {
      title: "Add your child",
      body: "Children is your home screen. Add a child to create a login you give them, or redeem a code from their teacher to watch a child the teacher already registered.",
    },
    {
      title: "Give them something to practise",
      body: "Browse tests is the ready-made library — chapter papers written to the board's pattern. Read one before you take it; copies land in your own subjects, yours to edit.",
    },
    {
      title: "Mark it in one press",
      body: "When a paper comes back, Mark & release reads every written answer, marks it and opens the paper to your child. The marks are yours, not the machine's — open the paper and change any of them.",
    },
    {
      title: "Credits",
      body: "One credit marks one written answer. Multiple choice is always free. You start with a trial grant, and your balance sits above your children's papers, turning amber before it runs out.",
    },
    {
      title: "Why a test can be locked",
      body: "Your child cannot start a paper you could not afford to mark — better to stop at the door than to lose an evening's work. They are never told it is about money; the number is on your screen, not theirs.",
    },
  ],
  teacher: [
    {
      title: "Subjects hold everything",
      body: "Your subjects is the way in. A subject holds tests, a test holds questions, and your students sit whatever you publish.",
    },
    {
      title: "Start from a ready-made subject",
      body: "New subject offers the built-in subjects and a tick list of their chapters. Take the ones you are teaching this month — they arrive as your own drafts, yours to edit, and nothing syncs back.",
    },
    {
      title: "A draft reaches nobody",
      body: "Publishing is the act of sharing. Until you publish, a test is invisible however it is assigned — that is the answer to 'where did my test go'. Who sees this narrows it to named students.",
    },
    {
      title: "Mark inside the paper",
      body: "To mark opens the student's whole paper, with the multiple choice already graded. Tap a photograph to read it full screen. Assess with AI proposes a mark and a comment; you award it.",
    },
    {
      title: "Release when you are ready",
      body: "Nothing reaches the student until you press Release — not even their score. You see every answer as soon as it is handed in, because you have to read a paper before deciding to open it.",
    },
  ],
  admin: [
    {
      title: "You have every teacher power",
      body: "Plus the library, the allowlist, the prices and the payments. Everything a teacher can do, you can do, on anybody's account.",
    },
    {
      title: "Approving a teacher",
      body: "Anyone may call themselves a teacher and write tests. Issuing a login to a real child needs you to add their address to the allowlist — that separation is deliberate.",
    },
    {
      title: "Plans & pricing",
      body: "Every price and every limit is a row you edit here, not a number in the code, so changing one changes what the next person is quoted. A limit of 0 means no limit.",
    },
    {
      title: "Payments and credits",
      body: "Payments is the queue of UPI transfers waiting to be checked against your bank and confirmed. AI usage shows who is spending and flags who is running low, with a grant button on each row.",
    },
    {
      title: "The library is files, not the editor",
      body: "You can correct a built-in test in the editor, but the lasting fix is the chapter file in the repository — re-seeding replaces each test by id, so an editor-only fix is one the next seed overwrites.",
    },
  ],
};

const KEY = "vidai:tour";

function seen(role: TourRole): boolean {
  try {
    return localStorage.getItem(`${KEY}:${role}`) === "1";
  } catch {
    // No storage (private window, blocked site data) means we cannot remember.
    // Say it HAS been seen: a tour that reopens on every load is worse than one
    // somebody has to ask for.
    return true;
  }
}

function markSeen(role: TourRole): void {
  try {
    localStorage.setItem(`${KEY}:${role}`, "1");
  } catch {}
}

/** Open the tour for whoever is signed in. Returns false if there is none. */
export function showTour(role = tourRole()): boolean {
  if (!role) return false;
  const cards = TOURS[role];
  markSeen(role);
  track("tour_open", { role });

  openModal({
    title: cards[0].title,
    submitLabel: "Read the help centre",
    cancelLabel: "Skip",
    steps: cards.map((c, i) => ({
      title: c.title,
      description: c.body,
      fields: [],
      submitLabel: i === cards.length - 1 ? "Read the help centre" : "Next",
    })),
    onSubmit: async () => {
      track("tour_finish", { role });
      // A new tab: somebody part-way through setting their account up should
      // not lose the screen they were on to read about it.
      window.open(helpUrl(role), "_blank", "noopener");
    },
  });
  return true;
}

/**
 * The first-run tour. Called once at boot, after the role is known.
 *
 * Deliberately does nothing at all when the tour has been seen, when nobody is
 * signed in, or when a dialog is already up — the sign-up role choice and the
 * phone-number step both open on exactly this load, and landing a tour on top
 * of a question somebody has to answer is the one way this could be harmful.
 */
export function showTourOnFirstRun(): void {
  const role = tourRole();
  if (!role || seen(role)) return;
  if (document.body.classList.contains("modal-open")) return;
  // A tick, so the screen underneath has painted and the tour reads as an
  // overlay on the app rather than as the app.
  setTimeout(() => {
    if (document.body.classList.contains("modal-open")) return;
    if (tourRole() === role) showTour(role);
  }, 700);
}
