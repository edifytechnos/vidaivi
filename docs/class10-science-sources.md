# Class 10 Science — which questions came from a real board paper

**The rule, unchanged:** a question is tagged with a year only if it was read
verbatim out of a full CBSE **Science (086)** board question paper for that year,
with its Q.P. code. Nothing is tagged from a compilation, a coaching sheet, or
memory. An untagged question is complete; it is the *claim* that has to be earned.

## The corpus

75 full Class X Science board papers — the papers the class actually sat — from
`https://www.cbse.gov.in/cbsenew/question-paper.html`, covering 2023 to 2026
(Q.P. codes 31/2/1, 31/2/2, 31/2/3 and others). 2022 has no main-sitting Science
paper because it was the term-based year; it appears under `2022-COMPTT`.

## What is tagged, chapter by chapter

| Chapter | Sourced | Of |
|---|---|---|
| Chemical Reactions and Equations | 1 | 15 |
| Acids, Bases and Salts | 1 | 15 |
| Metals and Non-metals | 1 | 15 |
| Carbon and its Compounds | 0 | 15 |
| Life Processes | 0 | 15 |
| Control and Coordination | 1 | 15 |
| How do Organisms Reproduce? | 1 | 15 |
| Heredity | 1 | 15 |
| Light - Reflection and Refraction | 1 | 15 |
| The Human Eye and the Colourful World | 2 | 15 |
| Electricity | 0 | 15 |
| Magnetic Effects of Electric Current | 1 | 15 |
| Our Environment | 1 | 15 |
| **Total** | **11** | **195** |

**Three chapters carry nothing yet** — Carbon and its Compounds, Life
Processes and Electricity. That is not a shortage of papers but of questions
that survive whole: the Electricity questions in this corpus are built around a
**circuit diagram**, and the Carbon and Life Processes ones around a stem that
text extraction truncated. A question whose figure is missing cannot be asked,
and a question whose stem is missing cannot be tagged.

## The tagged questions

| Chapter | Topic | Type | Marks | Tag |
|---|---|---|---|---|
| Chemical Reactions and Equations | Balancing equations | numeric | 2 | CBSE 2023 |
| Acids, Bases and Salts | Conductivity of solutions | mcq | 1 | CBSE 2023 |
| Metals and Non-metals | Extraction of metals | long | 3 | CBSE 2023 |
| Control and Coordination | Hormones | long | 3 | CBSE 2023 |
| How do Organisms Reproduce? | Unisexual flowers | mcq | 1 | CBSE 2023 |
| Heredity | Mendel's experiments | long | 3 | CBSE 2023 |
| Light - Reflection and Refraction | Concave mirror | numeric | 2 | CBSE 2023 |
| The Human Eye and the Colourful World | Defects of vision | mcq | 1 | CBSE 2023 |
| The Human Eye and the Colourful World | Scattering of light | long | 2 | CBSE 2023 |
| Magnetic Effects of Electric Current | Magnetic field lines | mcq | 1 | CBSE 2023 |
| Our Environment | Trophic levels and energy flow | long | 5 | CBSE 2023 |

## Answers were recomputed, never copied

- **Concave mirror, $f = 12$ cm, $u = 18$ cm.** Working in the New Cartesian
  convention, $\frac1v = \frac{1}{-12} - \frac{1}{-18} = -\frac{1}{36}$, so
  $v = -36$ cm — real, in front of the mirror. Then $m = -v/u = -2$ and the
  3 cm object gives a 6 cm inverted image. Cross-check: the object sits between
  $f$ and $2f$, which always gives a real, inverted, magnified image beyond
  $2f$. It does.
- **Balancing $x\,\text{Pb(NO}_3)_2 \to 2\,\text{PbO} + y\,\text{NO}_2 + \text{O}_2$.**
  Lead gives $x = 2$, nitrogen then gives $y = 4$, and oxygen checks out at 12
  on each side.

## Changes of form, stated plainly

- Some questions that are MCQs in the paper are asked here as **numeric entry**,
  because the app grades a typed number directly. Where the paper asked for two
  quantities, the question asks for one and the solution gives both.
- Assertion–Reason options are written out in full rather than abbreviated.
- Where a paper offered an "OR" pair, only the half used is asked.
- Questions asking a student to **draw** are kept as `long` questions: a long
  answer is photographed and marked by the teacher.
- Maths is re-typeset in KaTeX. No question's content was changed.

## If a tag looks wrong

Correct it in the chapter's JSON under `content/class10-science/` and re-run
`node scripts/seed-library.mjs content/class10-science` — that replaces the
library copy. Every question also has a **Source** field in the editor, so a
teacher can fix their own copy directly; clearing the field removes the chip.
