# Class 12 · Relations and Functions — where each question came from

The library test **Class 12 · Relations and Functions — Chapter Test 1**
(`lib-relations-functions`, `content/class12-maths/01-relations-and-functions.json`)
carries a `source` tag on every question. This file is the evidence behind those
tags, so the teacher can check them before the test reaches a class.

**The rule:** a question is tagged with a year only if it was read verbatim out
of a full CBSE **Mathematics (041)** board question paper for that year, with its
Q.P. code. Nothing is tagged from a compilation, a coaching sheet, or memory.

## The corpus these tags were checked against

70 full Class XII Mathematics board papers, downloaded from CBSE's own archive
at `https://www.cbse.gov.in/cbsenew/question-paper.html` and read as text:

| Year | Q.P. codes read |
|---|---|
| 2023 | 65/1/1–3, 65/2/1–3, 65/3/1–3, 65/4/1–3, 65/5/1–3, 65/B (16 papers) |
| 2024 | 65/1/1–3, 65/2/1–3, 65/3/1–3, 65/4/1–3, 65/5/1–3, 65/B (19 papers) |
| 2025 | 65/1/1–3 … 65/7/1–3, 65/B (19 papers) |
| 2026 | 65/1/1–3 … 65/5/1–3, 65/B (16 papers) |

These are the papers the class actually sat, not sample papers.

## The tags

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | $R = \{(1,1),(2,2),(1,2)\}$ on $\{1,2,3\}$ | CBSE 2026 | 65/2/1, Q1 |
| 2 | $R = \{(1,2),(2,1),(2,2)\}$ on $\{1,2,3\}$ | CBSE 2026 | 65/2/2, Q12 |
| 3 | $R = \{(1,3),(3,3),(1,1),(2,2),(3,1)\}$ | CBSE 2026 | 65/2/3, Q5 |
| 4 | "$x$ is 5 cm shorter than $y$" | CBSE 2024 | 65/1/3, Q7 |
| 5 | Which is **not** true of equivalence classes | CBSE 2024 | 65/2/2, Q14 |
| 6 | Assertion–Reason: 30 onto functions, $5 \to 2$ | CBSE 2023 | 65/1/2, Q20 |
| 7 | Equivalence classes of $x = y$ on $\{0,\dots,10\}$ | CBSE 2024 | 65/1/2, Q13 |
| 8 | $f(x) = 2x$ one-one and onto, find $B$ | CBSE 2023 | 65/1/1, Q21 |
| 9 | $x + y$ divisible by 2 on $\{-4,\dots,4\}$, class $[2]$ | CBSE 2024 | 65/3/1, Q32 |
| 10 | $(x - y)$ divisible by 5 on $\{-10,\dots,10\}$, class $[5]$ | CBSE 2024 | 65/3/2, Q35 |
| 11 | Smallest $R_1$ making $R \cup R_1$ an equivalence relation | CBSE 2026 | 65/3/2, Q22(b) |
| 12 | $\lvert x^2 - y^2 \rvert < 8$ on $\{1,\dots,5\}$ | CBSE 2024 | 65/1/1, Q26(a) |
| 13 | $f(x) = ax + b$, $f(1) = 1$, $f(2) = 3$ | CBSE 2024 | 65/1/1, Q26(b) |
| 14 | $(a - b)$ divisible by 4 on $\{0,\dots,12\}$ | CBSE 2024 | 65/B, Q32(a) |
| 15 | $ad(b + c) = bc(a + d)$ on $\mathbb{N} \times \mathbb{N}$ | CBSE 2023 | 65/4/1, Q34(a) |

Every answer was recomputed independently rather than taken from a key — the
relation in question 12, for instance, was enumerated in full to confirm that it
is reflexive and symmetric but **not** transitive, and that the counterexample
is $(1,2)$ with $(2,3)$, where $\lvert 1 - 9 \rvert = 8$ is not less than 8.

## Changes of form, stated plainly

- Four questions that are MCQs or short-answer in the paper (**7**, **8**, **9**
  and **10**) are asked here as numeric entry, because the app grades a typed
  number directly. Where the paper asks for a **set**, the question asks for a
  number that identifies it — the sum of the elements of $B$, or the size of an
  equivalence class — so the work a student does is the same.
- Assertion–Reason options are written out in full rather than abbreviated, so a
  student reading on a phone does not have to hold four letters in mind.
- Question 11 is the second half of a two-part "OR" question; only that half is
  asked here.
- Maths is re-typeset in KaTeX. No question's content was changed.

## If a tag looks wrong

Correct it in `content/class12-maths/01-relations-and-functions.json` and re-run
`node scripts/seed-library.mjs content/class12-maths` — that replaces the
library copy. Every question also has a **Source** field in the editor, so a
teacher can fix their own copy directly; clearing the field removes the chip.
