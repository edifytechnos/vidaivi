# Class 10 · Introduction to Trigonometry — where each question came from

Evidence behind the `source` tags on **Class 10 · Introduction to Trigonometry —
Chapter Test 8** (`lib-c10-trigonometry`,
`content/class10-maths/08-introduction-to-trigonometry.json`).

Same rule and same corpus as Real Numbers — see
`docs/class10-real-numbers-sources.md`.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | $\sin\theta=\cos\theta$ — value of $\sec\theta\sin\theta$ | CBSE 2024 | 30/2/1, Q7 |
| 2 | $4\sec\theta-5=0$ — find $\cot\theta$ | CBSE 2024 | 30/5/2, Q9 |
| 3 | $x=a\cos\theta$, $y=b\sin\theta$ — find $b^{2}x^{2}+a^{2}y^{2}$ | CBSE 2024 | 30/5/2, Q5 |
| 4 | $\theta$ acute, $7+4\sin\theta=9$ | CBSE 2025 | 30/1/1, Q4 |
| 10 | Prove $\sin^{6}\theta+\cos^{6}\theta = 1-3\sin^{2}\theta\cos^{2}\theta$ | CBSE 2024 | 30/2/2, Q31 |
| 11 | Prove $\sqrt{\sec^{2}\theta+\operatorname{cosec}^{2}\theta}=\tan\theta+\cot\theta$ | CBSE 2024 | 30/4/3, Q31 |
| 12 | $\sin\theta+\cos\theta=p$, $\sec\theta+\operatorname{cosec}\theta=q$ ⟹ $q(p^{2}-1)=2p$ | CBSE 2024 | 30/4/2, Q29 |

## Why over half this chapter is untagged

Trigonometry is the chapter that suffers most from text extraction. The question
text is full of Greek letters, surds and stacked fractions, and these are
exactly what `pdftotext` drops. A typical casualty from the corpus reads:

> `8.   If cos q =         and sin f = , then tan (q + f) is :`

— the two values the question turns on are simply gone, and the option list with
them. Several more are the same shape: `If sin a = ___, cos b = ___, then
tan a × tan b is`, and `If sin 30 tan 45 = ___, then the value of k is`.

Those were left out rather than guessed at. What survives intact is the set of
tagged questions above — mostly the *prove that* questions, whose statements are
written in words rather than fractions.

## Untagged questions

Questions **5**–**9** and **13**–**15** carry no year: complementary angles,
values at special angles, $9\sec^{2}A - 9\tan^{2}A$, building ratios from a
5-12-13 triangle, $\frac{\tan 60°}{\sin 60°}$, and three standard identities.
Ordinary NCERT Chapter 8 material, written to fill the board pattern.

## Changes of form, stated plainly

- Questions **8** and **9** are asked as numeric entry to two decimal places,
  with a tolerance of $0.01$ ($\frac{17}{13} \to 1.31$).
- Maths is re-typeset in KaTeX. No question's content was changed.

Every identity in this chapter was **verified numerically at several angles** in
Python, not just derived on paper — $\sin^{6}+\cos^{6}$, $\sec^{2}+\csc^{2}$,
$q(p^{2}-1)=2p$, and both of the $1 \pm \cos\theta$ identities all check out to
nine decimal places at every angle tested.
