# Class 10 · Triangles — where each question came from

Evidence behind the `source` tags on **Class 10 · Triangles — Chapter Test 6**
(`lib-c10-triangles`, `content/class10-maths/06-triangles.json`).

Same rule and same corpus as Real Numbers — see
`docs/class10-real-numbers-sources.md`.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | Perimeters 56 cm and 48 cm — find $PQ/AB$ | CBSE 2024 | 30/2/1, Q10 |
| 2 | Which statement about similarity is incorrect | CBSE 2025 | 30/2/1, Q9 |
| 9 | $DE \parallel BC$, $AD=4$, $AB=9$, $AC=13.5$ — find $EC$ | CBSE 2024 | 30/4/1, Q13 |
| 10 | $\triangle AHK \sim \triangle ABC$, find $AC$ | CBSE 2024 | 30/4/1, Q25 |
| 11 | $DE \parallel BC$, $AD=2.4$, $DB=4$, $AE=2$ — find $AC$ | CBSE 2024 | 30/5/1, Q17 |
| 12 | State and prove the Basic Proportionality Theorem | CBSE 2024 | 30/3/1, Q33 |
| 13 | Parallelogram: show $\triangle ABE \sim \triangle CFB$ | CBSE 2024 | 30/4/1, Q33(a) |
| 14 | Medians proportional ⟹ $\triangle ABC \sim \triangle PQR$ | CBSE 2024 | 30/4/1, Q33(b) |

## Why half this chapter is untagged

Triangles is the most **figure-dependent** chapter in the paper. A large share of
its board questions read "In the given figure…" and cannot be answered without
the printed diagram, which the app does not yet support in a question. Those
were left out rather than reworded into something the paper did not ask.

Examples found in the corpus and skipped for this reason: $\triangle ADP \sim
\triangle CBA$ from a figure (2024, 30/2/1 Q9 and its siblings), "prove
$\triangle EAB \sim \triangle ECD$" from a figure (2024, 30/3/1 Q24), and
"prove $\triangle ADE \sim \triangle ABC$" from a figure (2024, 30/5/1).

Questions **9**, **10** and **11** *do* refer to a figure in the paper, but their
data is complete in the text — the figure only shows where the points sit — so
they are restated in words with the same numbers and the same answer.

## Untagged questions

Questions **3**–**8** and **15** carry no year: the SAS similarity criterion,
the ratio of areas, the Basic Proportionality Theorem applied numerically,
similarity versus congruence, corresponding angles, altitudes scaling with
sides, and medians of triangles with given areas. All ordinary NCERT Chapter 6
material, written to fill the board pattern where the corpus offered only
figure-dependent questions.

## Changes of form, stated plainly

- Questions **9**, **10** and **11** are asked as numeric entry, and restate the
  figure in words. In the paper, 9 and 11 are MCQs and 10 is a 2-mark question.
- Question **11** asks for two decimal places because the answer is
  $\frac{16}{3}$; it is marked with a tolerance of $0.01$.
- Maths is re-typeset in KaTeX. No question's content was changed.

Every answer was recomputed independently in Python: $PQ/AB = \frac{6}{7}$,
$EC = 7.5$ cm, $AC = 4$ cm, $AC = \frac{16}{3}$ cm.
