# Class 10 · Real Numbers — where each question came from

The library test **Class 10 · Real Numbers — Chapter Test 1**
(`lib-c10-real-numbers`, `content/class10-maths/01-real-numbers.json`) carries a
`source` tag on every question. This file is the evidence behind those tags, so
the teacher can check them before the test reaches a class.

**The rule:** a question is tagged with a year only if it was read verbatim out
of a full CBSE **Mathematics (Standard)** question paper for that year, with its
Q.P. code. Nothing is tagged from a compilation, a coaching sheet, or memory.

## The corpus these tags were checked against

45 full papers, read as text (`pdftotext -layout`):

| Year | Q.P. codes read |
|---|---|
| 2024 | 30/2/1–3, 30/3/1–3, 30/4/1–3, 30/5/1–3 (12 papers) |
| 2025 | 30/1/1–3 … 30/6/1–3 (18 papers) |
| 2026 | 30/1/1–3 … 30/5/1–3 (15 papers) |

Most of the 2025 and 2026 files are the paper **and** its official marking
scheme, which is how surds and fractions lost by text extraction were recovered
and how the intended answers were confirmed.

## The tags

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | $a = 2^{2}3^{x}$, LCM$(a,b,c) = 3780$, find $x$ | CBSE 2024 | 30/3/1, Q5 |
| 2 | LCM of 28, 44, 132 | CBSE 2024 | 30/5/1, Q13 |
| 3 | Assertion–Reason: $(\sqrt{3}+\sqrt{5})$ is irrational | CBSE 2026 | 30/4/1, Q20 |
| 4 | HCF of 65 and 104 is 13, LCM $= 40x$ | CBSE 2024 | 30/4/1, Q2 |
| 5 | HCF$(98,28) = m$, LCM $= n$, find $n - 7m$ | CBSE 2025 | 30/1/1, Q6 |
| 6 | HCF of 40, 110 and 360 | CBSE 2025 | 30/2/1, Q18 |
| 7 | Assertion–Reason: H.C.F.$(36m^{2},18m) = 18m$ | CBSE 2026 | 30/5/1, Q20 |
| 8 | Product of two co-primes is 553, find HCF | CBSE 2024 | 30/5/1, Q14 |
| 9 | HCF of 210 and 55 as $210 \times 5 + 55m$ | CBSE 2026 | 30/4/1, Q24(b) |
| 10 | Greatest number dividing 70 and 125, remainders 5 and 8 | CBSE 2025 | 30/1/2, Q14 |
| 11 | Prove $2 + 3\sqrt{5}$ irrational | CBSE 2026 | 30/4/1, Q24(a) |
| 12 | Can $8^{n}$ end with the digit 0? | CBSE 2024 | 30/2/3, Q25 |
| 13 | Prove $2 - 5\sqrt{3}$ irrational | CBSE 2026 | 30/5/1, Q21 |
| 14 | Prove $\sqrt{5}$ is irrational | CBSE 2025 | 30/1/3, Q26 |
| 15 | Is $pqr + q$ composite, plus examples | CBSE 2025 | 30/6/1, Q26(b) |

Five questions from each of the three years. Every numeric answer was
recomputed independently in Python — the paper's own key was never taken on
trust.

## Four questions that were dropped, and why

The first version of this test was built from a smaller set of papers. When the
full 45-paper corpus was read, four of its questions could not be found in any
of them and three more were unusable. They were removed rather than left
carrying a year that could not be shown:

| Dropped question | Why |
|---|---|
| HCF of 960 and 432 | Tagged CBSE 2026. Neither 960 nor 432 appears in any paper in the corpus; plain integers survive text extraction reliably, so its absence is real evidence. |
| $6^{n}$ ends with the digit … | Tagged CBSE 2026. The genuine board questions of this shape are "Can $(15)^{n}$ end with 0?" (2024, 30/2/1 Q21) and "Can $8^{n}$ end with 0?" (2024, 30/2/3 Q25). The second replaced it. |
| $\sqrt{0.4}$ is a/an … | Tagged CBSE 2025, not found. |
| Assertion–Reason: HCF of two primes is 1 and LCM is $p+q$ | Tagged CBSE 2025, not found. The real 2026 Assertion–Reason on HCF is the $36m^{2}$ one, now question 7. |
| HCF$(2520,6600) = 40$, LCM $= 252k$ | **Found** (2024, 30/2/1 Q5), but dropped: the paper's premise is false. HCF$(2520,6600)$ is 120, not 40. The question only works if a student takes a wrong number on trust. |
| Least number that is a perfect square and divisible by 16, 20, 50 | **Found** (2025, 30/2/1 Q4), but dropped: CBSE's own marking scheme reads *"The correct option is not available in the given options. Full marks may be awarded to every attempt."* The answer is 400, which is not offered. |
| Smallest number divisible by 306 and 657 | Shipped untagged before. Not in the corpus, and there were enough evidenced questions to replace it. |

## Changes of form, stated plainly

- Three questions that are MCQs in the paper (**8**, **9** and **10**) are asked
  here as numeric entry, because the app grades a typed number directly. The
  wording and the answer are the paper's.
- Assertion–Reason options are written out in full rather than abbreviated, so a
  student reading on a phone does not have to hold four letters in mind.
- Maths is re-typeset in KaTeX. No question's content was changed.

## If a tag looks wrong

Correct it in `content/class10-maths/01-real-numbers.json` and re-run
`node scripts/seed-library.mjs content/class10-maths` — that replaces the
library copy. Every question also has a **Source** field in the editor, so a
teacher can fix their own copy directly; clearing the field removes the chip.
