# Class 12 Physics — which questions came from a real board paper

**The rule, unchanged:** a question is tagged with a year only if it was read
verbatim out of a full CBSE **Physics (042)** board question paper for that year,
with its Q.P. code. Nothing is tagged from a compilation, a coaching sheet, or
memory. A question without a tag is not a lesser question — `source` is optional
and an untagged question is complete. It is the *claim* that has to be earned.

## The corpus

83 full Class XII Physics board papers — the papers the class actually sat, not
sample papers — from `https://www.cbse.gov.in/cbsenew/question-paper.html`:

| Year | Papers |
|---|---|
| 2022 | 55/2/1-3, 55/4/1, 55/B/5 and others (16) |
| 2023 | 55/1/1-3, 55/3/1-3 and others (16) |
| 2024 | 55/1/1, 55/2/2, 55/3/1 and others (16) |
| 2025 | 55/5/1-3 and others (19) |
| 2026 | (16) |

Physics tags better than Maths does. Its questions are carried by **numbers and
words** — a work function in eV, a frequency, a refractive index — and those
survive text extraction intact, where a matrix or a surd does not. Every one of
the fourteen chapters therefore has at least one sourced question, which is not
true of the Maths shelf.

## What is tagged, chapter by chapter

| Chapter | Sourced | Of |
|---|---|---|
| Electric Charges and Fields | 1 | 15 |
| Electrostatic Potential and Capacitance | 1 | 15 |
| Current Electricity | 1 | 15 |
| Moving Charges and Magnetism | 1 | 15 |
| Magnetism and Matter | 1 | 15 |
| Electromagnetic Induction | 1 | 15 |
| Alternating Current | 2 | 15 |
| Electromagnetic Waves | 1 | 15 |
| Ray Optics and Optical Instruments | 1 | 15 |
| Wave Optics | 1 | 15 |
| Dual Nature of Radiation and Matter | 2 | 15 |
| Atoms | 1 | 15 |
| Nuclei | 1 | 15 |
| Semiconductor Electronics | 1 | 15 |
| **Total** | **16** | **210** |

## The tagged questions

| Chapter | Topic | Type | Marks | Tag |
|---|---|---|---|---|
| Electric Charges and Fields | Electric flux | long | 3 | CBSE 2023 |
| Electrostatic Potential and Capacitance | Dielectrics | mcq | 1 | CBSE 2024 |
| Current Electricity | Drift velocity and current density | long | 3 | CBSE 2023 |
| Moving Charges and Magnetism | Circular motion in a magnetic field | numeric | 2 | CBSE 2025 |
| Magnetism and Matter | Diamagnetism | mcq | 1 | CBSE 2023 |
| Electromagnetic Induction | Mutual inductance | long | 3 | CBSE 2023 |
| Alternating Current | Capacitive reactance | mcq | 1 | CBSE 2024 |
| Alternating Current | Purely capacitive circuit | numeric | 2 | CBSE 2023 |
| Electromagnetic Waves | Photon momentum | mcq | 1 | CBSE 2025 |
| Ray Optics and Optical Instruments | Prism | numeric | 2 | CBSE 2022 |
| Wave Optics | Young's double slit | mcq | 1 | CBSE 2022 |
| Dual Nature of Radiation and Matter | Photoelectric effect | mcq | 1 | CBSE 2023 |
| Dual Nature of Radiation and Matter | Photoelectric effect | numeric | 2 | CBSE 2023 |
| Atoms | Bohr model | numeric | 2 | CBSE 2023 |
| Nuclei | Binding energy curve | long | 5 | CBSE 2023 |
| Semiconductor Electronics | p-n junction | long | 3 | CBSE 2022 |

## Answers were recomputed, never copied

Every numeric answer was worked out independently and checked. Four worth naming:

- **Maximum kinetic energy, $f = 6 \cdot 4 \times 10^{14}$ Hz, $\phi_0 = 2 \cdot 14$ eV.**
  $hf = 2 \cdot 647$ eV, so $K_{\max} = 0 \cdot 507$ eV, which rounds to
  $0 \cdot 51$ eV.
- **Radius of the circular path.** The charge and mass are not given separately,
  so $q/m = v^2/2V = 5 \times 10^7$ C kg$^{-1}$ comes from the acceleration
  stage and then $r = v/\left[(q/m)B\right] = 0 \cdot 05$ m exactly.
- **Capacitive reactance at 50 Hz, 15 µF** is $212 \cdot 2\ \Omega$, giving a
  current amplitude of $1 \cdot 46$ A.
- **Prism of refractive index $\sqrt2$.** $\sin\left(\frac{60 + \delta_m}{2}\right)
  = \frac{1}{\sqrt2}$ gives $\delta_m = 30^\circ$ exactly, and the critical
  angle is $45^\circ$.

## Changes of form, stated plainly

- Some questions that are MCQs in the paper are asked here as **numeric entry**,
  because the app grades a typed number directly. Where a paper asked for two
  quantities, the question asks for one and the solution gives both.
- Where a paper offered an "OR" pair, only the half used is asked.
- Questions that ask a student to **draw** are kept as `long` questions: a long
  answer is photographed and marked by the teacher, so a diagram is answerable
  exactly as it is on paper.
- Maths is re-typeset in KaTeX. No question's content was changed.

## If a tag looks wrong

Correct it in the chapter's JSON under `content/class12-physics/` and re-run
`node scripts/seed-library.mjs content/class12-physics` — that replaces the
library copy. Every question also has a **Source** field in the editor, so a
teacher can fix their own copy directly; clearing the field removes the chip.
