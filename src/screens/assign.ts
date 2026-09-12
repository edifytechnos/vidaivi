// "Who sees this test" — the one dialog both the editor and My tests open.
//
// Publishing is still the act of sharing: the default audience is everyone the
// teacher created, so a published test reaches the class without a second step.
// This narrows it to named students when a teacher wants to.

import { assignTest, type ServerTestMeta } from "../api";
import { listStudents } from "../auth";
import { openModal } from "../modal";

export interface AssignTarget {
  id: string;
  title: string;
  audience?: "class" | "selected";
  assignedTo?: string[];
}

export interface AssignResult {
  audience: "class" | "selected";
  assignedCount: number;
  assignedTo: string[];
}

/** Opens the picker. `onDone` gets what was saved, so a caller holding a
 *  working copy can update it without another round trip. */
export async function openAssign(
  test: AssignTarget,
  onDone?: (result: AssignResult) => void
): Promise<void> {
  const students = (await listStudents()) ?? [];
  const already = new Set((test.assignedTo ?? []).map((u) => u.toLowerCase()));
  const selected = test.audience === "selected";

  openModal({
    title: "Who sees this test",
    description: `${test.title} — only published tests reach students, whichever you pick here.`,
    submitLabel: "Save",
    fields: [
      {
        name: "audience",
        label: "Share with",
        kind: "radio",
        required: true,
        choices: [
          {
            value: "class",
            label: "Everyone I teach",
            hint: "Including students you add later.",
            checked: !selected,
          },
          {
            value: "selected",
            label: "Only the students I pick",
            checked: selected,
          },
        ],
      },
      {
        name: "students",
        label: "Students",
        kind: "checklist",
        required: true,
        showWhen: { field: "audience", value: "selected" },
        empty: "You have no students yet — add them under My students first.",
        choices: students.map((s) => ({
          value: s.username,
          label: s.name || s.username,
          hint: s.username,
          checked: already.has(s.username.toLowerCase()),
        })),
      },
    ],
    onSubmit: async (values, picks) => {
      const audience = values.audience === "selected" ? "selected" : "class";
      const usernames = audience === "selected" ? picks.students ?? [] : [];
      const result = await assignTest(test.id, audience, usernames);
      if (!result.ok) return result.message;
      onDone?.({ audience, assignedCount: result.assignedCount, assignedTo: usernames });
    },
  });
}

/** "Everyone you teach" or "3 students" — what a test's audience reads as. */
export function audienceLabel(test: Pick<ServerTestMeta, "audience" | "assignedCount">): string {
  if (test.audience !== "selected") return "everyone you teach";
  const n = test.assignedCount ?? 0;
  return `${n} student${n === 1 ? "" : "s"}`;
}
