# Class 10 · Quadratic Equations — where each question came from

Evidence behind the `source` tags on **Class 10 · Quadratic Equations — Chapter
Test 4** (`lib-c10-quadratic-equations`,
`content/class10-maths/04-quadratic-equations.json`).

Same rule and same corpus as Real Numbers — see
`docs/class10-real-numbers-sources.md`: 45 full CBSE Mathematics (Standard)
papers (2024, 2025, 2026). A question is tagged only if it was read verbatim out
of one of them.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | $x^{2}+x+1=0$ has ___ roots | CBSE 2024 | 30/2/1, Q4 |
| 2 | Discriminant of $3x^{2}-2x+c$ is 16, find $c$ | CBSE 2024 | 30/4/1, Q4 |
| 3 | Ratio of sum to product for $5x^{2}-6x+21$ | CBSE 2024 | 30/5/1, Q5 |
| 4 | Roots of $4x^{2}-5x+4=0$ | CBSE 2024 | 30/2/3, Q8 |
| 5 | $y=1$ solves $py^{2}+py+3=0$ | CBSE 2024 | 30/4/3, Q17 |
| 8 | $9x^{2}+8kx+16=0$ has equal roots | CBSE 2026 | 30/4/1, Q1 |
| 9 | $4x^{2}+kx+1=0$ has equal roots | CBSE 2025 | 30/3/1, Q24(a) |
| 11 | Train, 90 km, 15 km/h faster saves 30 minutes | CBSE 2024 | 30/4/1, Q34(a) |
| 12 | $(k+1)x^{2}-6(k+1)x+3(k+9)=0$ has equal roots | CBSE 2024 | 30/5/1, Q32(a) |
| 13 | Lawn 12 m × 10 m with a uniform walkway, total 360 m² | CBSE 2025 | 30/3/1, Q38 |

## Untagged questions

Questions **6**, **7**, **10**, **14** and **15** carry no year: reading the
discriminant when the letters are swapped, the nature of the roots of
$2x^{2}-4x+3$, factorising $x^{2}-5x+6$, the quadratic formula on $2x^{2}+x-6$,
and consecutive integers whose squares sum to 365. Ordinary NCERT Chapter 4
material, written to fill out the board pattern.

Question 6 deserves a note: the same idea (the discriminant of $bx^{2}+ax+c=0$)
**is** a real 2025 question — 30/3/2 Q14 — but two of its four options are lost
to text extraction and that paper's marking scheme does not print them. The
question here is written fresh with its own options, so it carries no year.

## A question the board itself marked two ways

Question 8 is 2026's 30/4/1 Q1, where $D=0$ gives $k = \pm 3$ and the official
marking scheme reads **"(A) 3 OR (B) −3"** — both accepted. An MCQ here can only
have one right answer, so it is asked as numeric entry for the **positive**
value. The solution says so, and gives the factorisation for both signs.

## Changes of form, stated plainly

- Questions **8** and **9** are asked as numeric entry, and both ask for the
  positive value, since $D=0$ gives $\pm k$ in each case.
- Question **13** is part of a longer case study in the paper; the two parts
  used here (form the equation, solve it) are the paper's, worth 1 and 2 marks,
  combined into one 3-mark question.
- Maths is re-typeset in KaTeX. No question's content was changed.

Every answer was recomputed independently in Python: the train's 45 km/h, the
walkway's 4 m, $k=3$, and the roots of each equation.
