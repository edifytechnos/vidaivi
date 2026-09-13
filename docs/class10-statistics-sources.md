# Class 10 · Statistics — where each question came from

Evidence behind the `source` tags on **Class 10 · Statistics — Chapter Test 13**
(`lib-c10-statistics`, `content/class10-maths/13-statistics.json`).

Same rule and same corpus as Real Numbers — see
`docs/class10-real-numbers-sources.md`.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | Every observation increased by 2 — what happens to the median | CBSE 2024 | 30/2/1, Q12 |
| 2 | Mode − median = 24; find median − mean | CBSE 2024 | 30/4/1, Q7 |
| 3 | Mean 24 and mode 12 — find the median | CBSE 2024 | 30/5/2, Q18 |
| 4 | Median 9.6 and mean 10.5 — find the mode | CBSE 2025 | 30/1/3, Q1 |
| 5 | Seven observations, first four and last four | CBSE 2025 | 30/3/3, Q2 |
| 11 | Mean and mode of a seven-class distribution | CBSE 2025 | 30/2/1, Q35 |

Question 11's frequency table survives extraction in full, which is unusual —
most tabulated questions in the corpus lose their columns. Its mean works out to
$\frac{2850}{80} = 35.625$ and its mode to $30 + \frac{5}{13}(10) \approx 33.85$.

## One question found and left out

2024's 30/5/3 Q2 — "If the mean of the first $n$ natural numbers is ⟨missing⟩$/9$,
then the value of $n$ is" — loses its numerator. The options ($5$, $4$, $9$, $10$)
would let you work backwards to a plausible reading, but working backwards from
options is guessing, not reading.

## Untagged questions

Questions **6**–**10** and **12**–**15** carry no year: mean from $\sum f_ix_i$
and $\sum f_i$, class mark versus class size, identifying the modal class, the
direct method, the median formula, a missing frequency, a median from cumulative
frequencies, the assumed-mean method, and a salary example contrasting mean with
median. All ordinary NCERT Chapter 14 material.

The last one is deliberate. A single ₹200,000 salary among seven ordinary ones
pushes the mean above **every employee's actual pay**, while the median does not
move — which is the one statistical idea from this chapter a student will still
use in ten years.

## Changes of form, stated plainly

- Questions **9** and **10** are asked as numeric entry so the app can grade a
  typed number; the median one asks for two decimal places with a tolerance of
  $0.01$.
- Question **11** keeps the paper's 5 marks; the other written questions are 2
  or 3 marks as their type warrants.
- Tables are written in Markdown, which the app renders. No question's content
  was changed.

Every answer was recomputed independently in Python: the mean $35.625$ and mode
$33.85$, the fourth observation $13$, the missing frequency $f = 8$, the medians
$25.83$ and $27.25$, the assumed-mean result $27.2$ (cross-checked against the
direct method), and the salary example's ₹37,500 mean against its ₹14,500 median.
