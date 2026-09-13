# Class 10 · Some Applications of Trigonometry — where each question came from

Evidence behind the `source` tags on **Class 10 · Some Applications of
Trigonometry — Chapter Test 9** (`lib-c10-applications-of-trigonometry`,
`content/class10-maths/09-applications-of-trigonometry.json`).

Same rule and same corpus as Real Numbers — see
`docs/class10-real-numbers-sources.md`.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| Wire and pole | $AB = 5\sqrt{3}$ m, elevation $60°$ — length of wire | CBSE 2026 | 30/5/1, Q17 |
| Aircraft | $60° \to 30°$ in 30 s at height $3500\sqrt{3}$ m | CBSE 2024 | 30/2/2, Q32 |
| Boat from a cliff | depression $30° \to 60°$ in 6 minutes | CBSE 2024 | 30/3/3, Q32 |
| Girl and tower | 1.5 m tall, 30 m tower, $30° \to 60°$ | CBSE 2025 | 30/2/2, Q35(b) |
| Two pillars | 100 m road, elevations $60°$ and $30°$ | CBSE 2024 | 30/4/1, Q32 |
| Kite | height 60 m, $30°$ from a roof and $45°$ from the ground | CBSE 2026 | 30/4/1, Q34 |

The wire-and-pole question's key was read from the 2026 marking scheme:
**(B) $10\sqrt{3}$ m**, which matches the calculation $\frac{5\sqrt{3}}{\cos 60°}$.

## One question found and deliberately left out

The 2025 papers (30/2/2 Q35(a)) also carry a **helicopter** problem —
$45° \to 30°$ in 15 seconds at a constant height of 2000 m. It is a real board
question and it was written up, but it is the same problem as the 2024 aircraft
question with different numbers. Two near-identical five-mark word problems in a
fifteen-question test is poor practice, so the aircraft one was kept and the
helicopter dropped.

## Untagged questions

The remaining nine carry no year: elevation at $45°$, the Sun's angle from a
shadow $\sqrt{3}$ times the height, an angle of depression from a lighthouse, a
tower from 20 m away, a ladder against a wall, a point seen at $45°$ from a
15 m building, a tower from two positions 40 m apart, and a tree broken by a
storm. Ordinary NCERT Chapter 9 material, written to fill the one- and two-mark
slots, which the board papers give almost entirely to other chapters.

## A note on the mark weight

This test is 41 marks across 15 questions — heavier than the other chapters.
That is the chapter, not a choice: in the board papers Some Applications of
Trigonometry appears almost exclusively as **5-mark** questions, and those are
the ones with a year on them. Each keeps the paper's own weight rather than
being trimmed to make the total tidier.

## Changes of form, stated plainly

- Two questions are asked as numeric entry (the ladder and the 15 m building)
  so the app can grade a typed number; the ladder asks for two decimal places
  with a tolerance of $0.01$.
- Maths is re-typeset in KaTeX. No question's content was changed.

Every answer was recomputed independently in Python: the aircraft's 840 km/h,
the boat's remaining 3 minutes, the girl's $19\sqrt{3} \approx 32.9$ m, the
pillars' $25\sqrt{3} \approx 43.3$ m at 25 m and 75 m, and the kite's string of
$40\sqrt{3} \approx 69.2$ m above a roof $60 - 20\sqrt{3} \approx 25.4$ m high.
