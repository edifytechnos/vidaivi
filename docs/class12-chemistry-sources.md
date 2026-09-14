# Class 12 Chemistry — which questions came from a real board paper

**The rule, unchanged:** a question is tagged with a year only if it was read
verbatim out of a full CBSE **Chemistry (043)** board question paper for that
year, with its Q.P. code. Nothing is tagged from a compilation, a coaching sheet,
or memory. An untagged question is complete; it is the *claim* that has to be
earned.

## The corpus

87 full Class XII Chemistry board papers — the papers the class actually sat —
from `https://www.cbse.gov.in/cbsenew/question-paper.html`, covering 2022 to
2026 (Q.P. codes 56/1/*, 56/2/*, 56/4/* and the visually-impaired variants).

**Every one of the ten chapters carries at least one sourced question.** Like
Physics and unlike Maths, Chemistry survives text extraction well: its questions
are carried by names, formulae and plain numbers rather than by notation that
extraction drops.

## What is tagged, chapter by chapter

| Chapter | Sourced | Of |
|---|---|---|
| Solutions | 1 | 15 |
| Electrochemistry | 1 | 15 |
| Chemical Kinetics | 3 | 15 |
| The d- and f-Block Elements | 1 | 15 |
| Coordination Compounds | 2 | 15 |
| Haloalkanes and Haloarenes | 1 | 15 |
| Alcohols, Phenols and Ethers | 1 | 15 |
| Aldehydes, Ketones and Carboxylic Acids | 1 | 15 |
| Amines | 1 | 15 |
| Biomolecules | 1 | 15 |
| **Total** | **13** | **150** |

## The tagged questions

| Chapter | Topic | Type | Marks | Tag |
|---|---|---|---|---|
| Solutions | Colligative properties | mcq | 1 | CBSE 2023 |
| Electrochemistry | Molar conductivity | long | 3 | CBSE 2022 |
| Chemical Kinetics | Order of a reaction | numeric | 2 | CBSE 2022 |
| Chemical Kinetics | First order kinetics | numeric | 2 | CBSE 2022 |
| Chemical Kinetics | First order kinetics | numeric | 2 | CBSE 2022 |
| The d- and f-Block Elements | Colour of transition metal ions | mcq | 1 | CBSE 2022 |
| Coordination Compounds | Oxidation state | mcq | 1 | CBSE 2023 |
| Coordination Compounds | IUPAC nomenclature | long | 2 | CBSE 2022 |
| Haloalkanes and Haloarenes | Substitution versus elimination | long | 2 | CBSE 2023 |
| Alcohols, Phenols and Ethers | Acidity of phenols | long | 2 | CBSE 2023 |
| Aldehydes, Ketones and Carboxylic Acids | Aldol condensation | long | 2 | CBSE 2022 |
| Amines | Hinsberg test | long | 3 | CBSE 2022 |
| Biomolecules | Protein structure | mcq | 1 | CBSE 2023 |

## Answers were recomputed, never copied

The three kinetics questions were worked through with the logarithm values the
paper itself supplies, and checked numerically:

- **50% completion in $77 \cdot 78$ min, time for 30%.** $k = 0 \cdot 693/77 \cdot 78
  = 8 \cdot 91 \times 10^{-3}$ min$^{-1}$; $\log(100/70) = 2 - 1 \cdot 8450 =
  0 \cdot 1550$; $t = 258 \cdot 5 \times 0 \cdot 1550 = 40 \cdot 06$ min.
- **5 g to 3 g at $k = 10^{-3}$ s$^{-1}$.** $\log(5/3) = 0 \cdot 6990 -
  0 \cdot 4771 = 0 \cdot 2219$; $t = 2303 \times 0 \cdot 2219 = 511 \cdot 0$ s.
  Cross-check: the half-life is 693 s and this is less than a halving, so a
  time under 693 s is right.
- **Overall order of $k[A]^{1/2}[B]^{3/2}$** is $\tfrac12 + \tfrac32 = 2$.

The IUPAC name of $[\text{Co}(\text{NH}_3)_4(\text{H}_2\text{O})\text{Cl}]\text{Cl}_2$
was assembled from the rules rather than recalled: cobalt comes out at $+3$
because the chlorido ligand inside the sphere carries $-1$ against a $2+$
complex ion, and the ligands are alphabetised ammine, aqua, chlorido —
**tetraammineaquachloridocobalt(III) chloride**.

## Changes of form, stated plainly

- Some questions that are MCQs in the paper are asked here as **numeric entry**,
  because the app grades a typed number directly.
- Where a paper offered an "OR" pair, only the half used is asked.
- Questions asking for structures or mechanisms are kept as `long` questions: a
  long answer is photographed and marked by the teacher, so a structure is
  answerable exactly as it is on paper.
- **No markdown tables.** `formatText` renders only $…$ maths, `**bold**` and
  blank lines, so a table would reach the student as raw pipes. Comparisons are
  written one line per row instead. `scripts/check-content.cjs` now rejects
  both a table row and a literal backslash-n, because both shipped once.

## If a tag looks wrong

Correct it in the chapter's JSON under `content/class12-chemistry/` and re-run
`node scripts/seed-library.mjs content/class12-chemistry` — that replaces the
library copy. Every question also has a **Source** field in the editor, so a
teacher can fix their own copy directly; clearing the field removes the chip.
