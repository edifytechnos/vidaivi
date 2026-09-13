# Class 10 · Arithmetic Progressions — where each question came from

Evidence behind the `source` tags on **Class 10 · Arithmetic Progressions —
Chapter Test 5** (`lib-c10-arithmetic-progressions`,
`content/class10-maths/05-arithmetic-progressions.json`).

Same rule and same corpus as Real Numbers — see
`docs/class10-real-numbers-sources.md`.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | $a_{15}-a_{11}=48$, find $d$ | CBSE 2024 | 30/2/1, Q3 |
| 2 | Which term of $-29,-26,\ldots,61$ is 16 | CBSE 2024 | 30/2/1, Q16 |
| 3 | Three numbers in A.P. sum to 30 — middle term | CBSE 2024 | 30/4/1, Q12 |
| 4 | Next term of $\sqrt{18},\sqrt{50},\sqrt{98},\ldots$ | CBSE 2024 | 30/5/1, Q1 |
| 5 | Number of terms in $3,6,9,\ldots,111$ | CBSE 2024 | 30/5/1, Q11 |
| 6 | $S_n = 3n^{2}+4n$, $d=6$ — first term | CBSE 2024 | 30/3/2, Q17 |
| 7 | First three terms $3p-1$, $3p+5$, $5p+1$ | CBSE 2024 | 30/4/2, Q18 |
| 8 | $a_{20}-a_{15}=20$, find $d$ | CBSE 2024 | 30/2/3, Q9 |
| 10 | $S_m = S_n$ $(m \neq n)$ ⟹ $S_{m+n}=0$ | CBSE 2024 | 30/2/1, Q26(a) |
| 11 | Three terms summing 24, squares summing 194 | CBSE 2024 | 30/2/1, Q26(b) |
| 12 | $S_7=49$, $S_{17}=289$ — find $S_{20}$ | CBSE 2024 | 30/3/1, Q26(a) |
| 13 | $a_{10}:a_{30} = 1:3$, $S_6=42$ | CBSE 2024 | 30/3/1, Q26(b) |
| 14 | $S_{14}=1050$, $a=10$ — find $a_{20}$ and $a_n$ | CBSE 2024 | 30/5/1, Q27(a) |
| 15 | $a=5$, $l=45$, $S=400$ — find $n$ and $d$ | CBSE 2024 | 30/5/1, Q27(b) |

## Why every tag here says 2024

The 2024 papers extract to clean text with their options intact; the 2025 and
2026 papers in the corpus are bilingual layouts where surds and negative
fractions are frequently lost. The A.P. questions in those years happen to
depend on exactly the parts that vanish:

| Question found | Why it could not be used |
|---|---|
| Assertion–Reason on the common difference of $5, 1, -3, \ldots$ (2025, 30/2/1 Q19) | The value the assertion claims for $d$ is lost. The marking scheme gives the key — (D), so the assertion is false — but not the number it asserts, and reconstructing it would be inventing the question. |
| $n$th term of an A.P. is $\sqrt{2}\,n + 1$ (2026, 30/4/1 Q3) | The surd is lost in both the question and the option list, and this paper's marking scheme prints the key for this question as a blank. |
| $a_{16}-a_{12}$ for $-\frac{5}{4}, -\ldots$ (2026, 30/5/1 Q8) | The fractions in the sequence itself are lost. |

This is a limitation of the source PDFs, not of the chapter. It is recorded here
so the pattern is not mistaken for a claim that CBSE stopped asking A.P.
questions after 2024.

## Untagged question

Question **9** — the common difference when $a_n = 5n - 3$ — carries no year.
Ordinary NCERT Chapter 5 material, written to fill the one-mark slot the 2025
and 2026 papers could not supply.

## Changes of form, stated plainly

Maths is re-typeset in KaTeX. No question's content was changed; every question
keeps the paper's own mark weight (1 for Section A, 3 for Section C).

Every answer was recomputed independently in Python: $d=12$, the 16th term,
$\sqrt{162}$, 37 terms, $p=5$, the numbers $7, 8, 9$, $S_{20}=400$,
$a = d = 2$, $a_{20}=200$ with $a_n = 10n$, and $n=16$ with $d=\frac{8}{3}$.
