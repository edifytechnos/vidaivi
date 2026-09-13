# Class 10 · Areas Related to Circles — where each question came from

Evidence behind the `source` tags on **Class 10 · Areas Related to Circles —
Chapter Test 11** (`lib-c10-areas-related-to-circles`,
`content/class10-maths/11-areas-related-to-circles.json`).

Same rule and same corpus as Real Numbers — see
`docs/class10-real-numbers-sources.md`.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | Sector area $60\pi$ cm², radius 12 cm — central angle | CBSE 2024 | 30/4/1, Q6 |
| 2 | Arc length $10\pi$ cm, radius 12 cm — central angle | CBSE 2024 | 30/5/2, Q8 |
| 3 | Sector area $54\pi$ cm², radius 36 cm — arc length | CBSE 2025 | 30/3/1, Q13 |
| 7 | Circle divided into 16 identical sectors, radius 7 cm | CBSE 2026 | 30/4/1, Q9 |

Question 3's own text loses the $\pi$ — it reads "area … is 54 cm²" — but the
marking scheme gives the key as **(D) $3\pi$ cm**, which is only consistent with
an area of $54\pi$. The $\pi$ is restored on that evidence, and the working in
the solution shows it both ways.

## Why most of this chapter is untagged

Only four questions on this chapter survive the corpus intact. The others fail
for the two reasons that recur across the syllabus:

- **Lost fractions.** 2024's 30/3/2 Q6 reads "If the area of a sector of a
  circle is ⟨missing⟩$/20$ of the area of the circle, then the angle at the
  centre is" — the numerator, which is the whole question, is gone. The options
  imply it is $7$ (giving $126°$), but implying is not reading, so it was left
  out.
- **Figures.** Several area questions are built on a shaded diagram, which the
  app cannot show in a question yet.

## Untagged questions

Questions **4**–**6** and **8**–**15** carry no year: area of a circle, radius
from circumference, area of a quadrant, perimeter of a quadrant, area of a
$60°$ sector, area of a ring, the minor segment of a right-angled chord, a horse
grazing at the corner of a field, the area swept by a minute hand, a semicircular
protractor, and the ratio of areas from a ratio of circumferences. All ordinary
NCERT Chapter 11 material.

Three of them are written around the mistakes this chapter is famous for: the
**perimeter of a quadrant** is the arc *plus two radii*, the **perimeter of a
semicircle** is the arc *plus the diameter*, and the **area of a circle** is not
its circumference. Each solution says so plainly.

## Changes of form, stated plainly

- Question **7** is an MCQ in the paper and is asked here as numeric entry to two
  decimal places ($\frac{77}{8} \to 9.63$), because the printed option list is
  cut off in extraction and that paper's marking scheme prints the key as a
  blank. The arithmetic is unambiguous, so the question is kept and the option
  list dropped.
- Four other questions are asked as numeric entry so the app can grade a typed
  number, each with a tolerance of $0.01$.
- Maths is re-typeset in KaTeX. No question's content was changed.

Every answer was recomputed independently in Python: $150°$ twice, $3\pi$ cm,
$9.625$ cm², $25$ cm, $\frac{132}{7}$ cm², $115.5$ cm², $28.5$ cm², $19.625$ m²,
$\frac{154}{3}$ cm² and a $36$ cm perimeter.
