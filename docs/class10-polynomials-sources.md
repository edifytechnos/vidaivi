# Class 10 · Polynomials — where each question came from

Evidence behind the `source` tags on **Class 10 · Polynomials — Chapter Test 2**
(`lib-c10-polynomials`, `content/class10-maths/02-polynomials.json`).

The rule and the corpus are the same as for Real Numbers — see
`docs/class10-real-numbers-sources.md`: 45 full CBSE Mathematics (Standard)
papers (2024, 2025, 2026), read as text, most of the 2025 and 2026 ones with
their official marking schemes. A question is tagged only if it was read
verbatim out of one of them.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | Zeroes are $-3$ and $8$; which polynomial? | CBSE 2026 | 30/5/1, Q3 |
| 2 | One zero $2+\sqrt{5}$, sum of zeroes 4 | CBSE 2024 | 30/4/2, Q17 |
| 3 | $(\alpha-\beta)$ for $-x^{2}+8x+9$ | CBSE 2024 | 30/2/3, Q12 |
| 7 | $\frac{\alpha}{\beta}+\frac{\beta}{\alpha}$ for $5x^{2}-16x-10$ | CBSE 2026 | 30/4/1, Q25 |
| 8 | $\alpha^{2}+\beta^{2}$ for $2x^{2}-9x+5$ | CBSE 2024 | 30/2/2, Q6 |
| 9 | $(1-p)(1-q)$ for $21y^{2}-y-2$ | CBSE 2025 | 30/2/1, Q21 |
| 10 | Sum of zeroes of $5x-7x^{2}+3$ | CBSE 2025 | 30/1/3, Q11 |
| 11 | Zeroes of $x^{2}-15$, verify the relationship | CBSE 2024 | 30/3/1, Q27 |
| 12 | Zeroes of $4x^{2}+4x-3$, verify the relationship | CBSE 2024 | 30/4/1, Q29(a) |
| 13 | Zeroes of $x^{2}+ax+b$ in ratio $3:4$; prove $12a^{2}=49b$ | CBSE 2025 | 30/1/2, Q21 |
| 14 | Polynomial with zeroes $2$ and $-\frac{7}{5}$ | CBSE 2025 | 30/2/2, Q21 |
| 15 | Polynomial with zeroes $5 \pm 2\sqrt{3}$ | CBSE 2026 | 30/1/3, Q24 |

Questions 9, 14 and 15 had their surds and fractions recovered from the official
marking scheme, which prints them in full where the question text's symbols were
lost to text extraction. In question 9 the marking scheme is also what settled
the sign: the paper asks for $(1-p)(1-q)$, not $(1+p)(1+q)$.

## Untagged questions

Questions **4**, **5** and **6** carry no year. They are ordinary NCERT
Chapter 2 material — find $k$ given a zero, how many polynomials share a pair of
zeroes, and building a polynomial from its sum and product — written to fill the
one-mark slots that the papers in the corpus did not supply with legible options.

## Questions found but not used

| Question | Why |
|---|---|
| Zeroes of $2x^{2}-3x-9$ (2024, 30/3/1 Q6) | The four options are cut off in every copy of the paper in the corpus, and the 2024 papers carry no marking scheme, so the intended key could not be confirmed. |
| $p(x)=kx^{2}-30x+45k$ with $\alpha+\beta=\alpha\beta$ (2024, 30/5/1 Q15) | Computing it gives $k=\frac{2}{3}$, but the visible options are negative. Without a marking scheme the discrepancy could not be resolved. |
| $3x^{2}+6x+k$ with a condition on $\alpha+\beta+\alpha\beta$ (2025, 30/1/1 Q1) | The condition itself is lost in extraction. The marking scheme gives the answer ($k=4$) but not the question, and reconstructing the missing line would be inventing it. |
| Number of zeroes from a graph (2026, 30/4/1 Q5) | Needs the printed graph; the app has no image support in questions yet. |

## Changes of form, stated plainly

- Questions **8**, **9** and **10** are MCQs in the paper and are asked here as
  numeric entry, because the app grades a typed number directly. Where the
  paper's answer is a fraction, the question asks for two decimal places and is
  marked with a tolerance of $0.01$: $\frac{6}{7} \to 0.86$, $\frac{5}{7} \to
  0.71$. The wording is otherwise the paper's.
- Maths is re-typeset in KaTeX. No question's content was changed.

Every numeric answer was recomputed independently in Python; the paper's own key
was never taken on trust.
