# Tamil Nadu Class 12 Maths — which questions came from a real board paper

**The rule, unchanged:** a question is tagged with a year only if it was read
verbatim out of a full Tamil Nadu **HSE Second Year** Mathematics board paper
for that year, with its Q.P. code.

## The corpus

| Year | Q.P. code | File |
|---|---|---|
| 2023 | 6612 | `papers/tn12/maths-2023.pdf` |
| 2024 | 7412 | `papers/tn12/maths-2024.pdf` |
| 2025 | 8312 | `papers/tn12/maths-2025.pdf` |

All March main sitting. Tag: `TN HSE Mar <year>`; question ids carry the year
and the paper's own number (`tn12m-mat-24q3`).

**Read as page images, not as text.** Extraction drops the matrices, surds and
integrals, so every page was rendered (pypdfium2, scale 2.0) and read. The
papers print Tamil and English side by side, so the same read carries the
Tamil text for the Tamil-medium shelf.

## What is tagged, chapter by chapter

| Chapter | Sourced | Of |
|---|---|---|
| Matrices and Determinants | 6 | 15 |
| Complex Numbers | 6 | 15 |
| Theory of Equations | 3 | 15 |
| Inverse Trigonometric Functions | 4 | 15 |
| Two Dimensional Analytical Geometry II | 4 | 15 |
| Applications of Vector Algebra | 6 | 15 |
| Applications of Differential Calculus | 8 | 15 |
| Differentials and Partial Derivatives | 3 | 15 |
| Applications of Integration | 5 | 15 |
| Ordinary Differential Equations | 4 | 15 |
| Probability Distributions | 4 | 15 |
| Discrete Mathematics | 3 | 15 |
| **Total** | **56** | **180** |

## Left out on purpose

- **2023 Q11** repeats 2024 Q1, and **2025 Q2** repeats 2023 Q8 — tagged once.
- **2023 Q7 / 2025 Q10** (the $\sin^4 x$ question) is printed without "= 0",
  so as printed it has no answer. Not used.

Every untagged question is original and carries no `source`. All answers were
recomputed independently (sympy, 40 checks, 0 mismatches).

## The Tamil-medium shelf (`content/tn12-maths-ta`)

The same 180 questions, slot for slot (`tn12mt-` ids). The 56 tagged questions
carry the **board's own Tamil wording**, read off the same rendered pages,
since every paper prints both languages side by side. Everything else is a
translation of the English shelf.
