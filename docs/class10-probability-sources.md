# Class 10 · Probability — where each question came from

Evidence behind the `source` tags on **Class 10 · Probability — Chapter Test 14**
(`lib-c10-probability`, `content/class10-maths/14-probability.json`).

Same rule and same corpus as Real Numbers — see
`docs/class10-real-numbers-sources.md`.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | Two dice, sum more than 10 | CBSE 2024 | 30/2/1, Q8 |
| 2 | Two dice show different numbers | CBSE 2024 | 30/3/1, Q3 |
| 3 | Bag of 3 red, 5 white, 7 black — neither red nor black | CBSE 2024 | 30/3/3, Q1 |
| 4 | 400 eggs, $P(\text{bad}) = 0.045$ — how many good | CBSE 2024 | 30/3/3, Q2 |
| 5 | A number greater than 2 on a fair die | CBSE 2024 | 30/4/3, Q16 |
| 6 | A multiple of 4 from $1 \ldots 15$ | CBSE 2024 | 30/5/3, Q11 |
| 7 | Two coins, at most one tail | CBSE 2024 | 30/3/2, Q10 |
| 8 | Two dice, difference of the numbers is 2 | CBSE 2025 | 30/1/1, Q31 |
| 9 | Two dice, odd number on both | CBSE 2024 | 30/4/1, Q8 |

Nine of the fifteen carry a year — the best ratio of any chapter after Real
Numbers and Arithmetic Progressions. Probability questions are written in plain
sentences with whole numbers, so almost nothing is lost in text extraction.

## Untagged questions

Questions **10**–**15** carry no year: drawing a king from a pack, the
complement rule on $P(E) = 0.37$, two dice summing to 9 or to a prime, a bag of
20 balls in three colours, cards numbered 1 to 30, and 90 discs. All ordinary
NCERT Chapter 15 material, written to fill the 2- and 3-mark slots.

## Changes of form, stated plainly

- Questions **8**, **9** and **10** are asked as numeric entry by fixing part of
  the fraction ("the probability is $\frac{a}{9}$; give $a$"), because the app
  grades a typed number and a probability is usually a fraction. The working and
  the answer are unchanged.
- Maths is re-typeset in KaTeX. No question's content was changed.

## The trap this chapter is really about

Almost every wrong answer in probability comes from the wording, not the
arithmetic, so the solutions name the trap each time:

- **greater than 2** excludes 2; **at least 2** includes it
- **at most one tail** includes zero tails
- $(5,6)$ and $(6,5)$ are **two** outcomes, not one — which is why "difference
  is 2" has 8 favourable outcomes and not 4
- **1 is a perfect square but is not prime**
- an **ace is not a face card**

Every answer was recomputed independently in Python by enumerating the full
sample space — all 36 dice outcomes, all 52 cards, all 30 numbered cards — rather
than by reasoning about counts.
