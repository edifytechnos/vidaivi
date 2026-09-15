# The Cambridge shelves — which questions came from a real past paper

**The rule, unchanged:** a question is tagged with a year only if it was read
verbatim out of a full past paper for that series. Nothing is tagged from a
compilation or from memory. An untagged question is complete; it is the *claim*
that has to be earned.

## What Cambridge publishes, and the distinction that matters

Cambridge publishes past papers openly at
`https://www.cambridgeinternational.org/programmes-and-qualifications/<syllabus>/past-papers/`,
as direct PDF links. 115 documents were downloaded across the five syllabuses.

**But most of them are specimen papers**, not past papers — 2020, 2022 and 2025
specimen materials. Those are Cambridge's own sample papers, the exact
counterpart of a CBSE Sample Question Paper, and the same rule applies: a tag
must say **which kind of paper** it came from. A specimen paper is what the board
*intended* to ask.

The real past papers in this corpus are the **June 2024** series — 26 question
papers across the five syllabuses. **Every tag on these shelves names that
series**, in the form `Cambridge 0580 Jun 2024`, and nothing is tagged from a
specimen paper.

Downloading needs `curl --http1.1`: the server closes HTTP/2 streams uncleanly
and the transfer fails otherwise. The 0653 slug is
`cambridge-igcse-science-combined-0653`, not the `-combined-science-` form the
other subjects use.

## What is tagged

| Shelf | Sourced | Of |
|---|---|---|
| Cambridge IGCSE Maths (0580) | 5 | 135 |
| Cambridge IGCSE Combined Science (0653) | 3 | 180 |
| Cambridge A Level Maths (9709) | 4 | 150 |
| Cambridge A Level Physics (9702) | 3 | 180 |
| Cambridge A Level Chemistry (9701) | 4 | 180 |
| **Total** | **19** | **825** |

**A Level Mathematics (9709) was the shelf text extraction could not reach at
all.** Its questions are carried by notation, and the first three terms of a
progression came through as `25 4 , p 10 1- and 13 -` — not enough to
reconstruct the question, let alone answer it.

**Reading the pages as images fixed it.** The same question renders clearly as
`25`, `4p - 1` and `13 - p`, and four questions were recovered that way. A
Cambridge page is mostly ruled answer space, so it yields about one question per
page against six to eight for a CBSE paper; `scratchpad/pagemap.py` lists which
pages carry a question stem at all, so the blank ones are never rendered. The sciences, whose
questions are carried by words and plain numbers, came through intact — which is
why every other Cambridge shelf has something.

The sciences needed none of this — their questions came through intact, because
they are carried by words and plain numbers.

## The tagged questions

| Shelf | Chapter | Topic | Type | Marks | Tag |
|---|---|---|---|---|---|
| Cambridge IGCSE Mathematics (0580) | Number | Factors | numeric | 2 | Cambridge 0580 Jun 2024 |
| Cambridge IGCSE Mathematics (0580) | Number | Recurring decimals | long | 3 | Cambridge 0580 Jun 2024 |
| Cambridge IGCSE Mathematics (0580) | Mensuration | Sectors of a circle | numeric | 2 | Cambridge 0580 Jun 2024 |
| Cambridge IGCSE Mathematics (0580) | Trigonometry | Area of a triangle | numeric | 2 | Cambridge 0580 Jun 2024 |
| Cambridge IGCSE Mathematics (0580) | Probability | Complementary events | numeric | 1 | Cambridge 0580 Jun 2024 |
| Cambridge IGCSE Combined Science (0653) | Human Nutrition, Transport and Respiration | Blood vessels | mcq | 1 | Cambridge 0653 Jun 2024 |
| Cambridge IGCSE Combined Science (0653) | Coordination, Reproduction and Inheritance | Hormones | mcq | 1 | Cambridge 0653 Jun 2024 |
| Cambridge IGCSE Combined Science (0653) | Coordination, Reproduction and Inheritance | Sexual reproduction | mcq | 1 | Cambridge 0653 Jun 2024 |
| Cambridge A Level Physics (9702) | Physical Quantities and Measurement | Units | mcq | 1 | Cambridge 9702 Jun 2024 |
| Cambridge A Level Physics (9702) | Physical Quantities and Measurement | Uncertainty | numeric | 2 | Cambridge 9702 Jun 2024 |
| Cambridge A Level Physics (9702) | Kinematics | Projectile motion | mcq | 1 | Cambridge 9702 Jun 2024 |
| Cambridge A Level Chemistry (9701) | Atomic Structure and the Periodic Table | Subatomic particles | mcq | 1 | Cambridge 9701 Jun 2024 |
| Cambridge A Level Chemistry (9701) | Chemical Bonding and Structure | Shapes of molecules | mcq | 1 | Cambridge 9701 Jun 2024 |
| Cambridge A Level Chemistry (9701) | Chemical Bonding and Structure | Hydrogen bonding | mcq | 1 | Cambridge 9701 Jun 2024 |
| Cambridge A Level Chemistry (9701) | States of Matter and the Mole | Ideal gases | numeric | 2 | Cambridge 9701 Jun 2024 |

## Answers were recomputed, never copied

- **Greatest odd factor of 140 and 210.** $\text{HCF} = 70 = 2 \times 35$, so the
  odd part is 35; checked that $140/35 = 4$ and $210/35 = 6$.
- **Major sector, $r = 9$ cm, minor angle $48^\circ$.** $\frac{312}{360}\pi(81)
  = 220 \cdot 5$ cm². The check that matters is that the answer is just under the
  whole circle's $254 \cdot 5$ cm² — taking the minor sector instead would give
  about 34 cm².
- **$0 \cdot 1\dot4\dot6$ as a fraction.** $990x = 145$, so $x = 145/990 = 29/198$,
  verified by dividing it back out.
- **Density of $\text{F}_2$ at $32\ ^\circ$C.** $\rho = pM/RT = 3800/2536 =
  1 \cdot 498$, so $1 \cdot 5$ g dm⁻³.
- **Percentage uncertainty in a temperature rise.** Both readings contribute, so
  the absolute uncertainty is $\pm 1 \cdot 0\ ^\circ$C over a rise of 60, giving
  $1 \cdot 7\%$ — not the $0 \cdot 8\%$ that using one reading would give.

## Changes of form, stated plainly

- Some questions that are MCQs in the paper are asked here as **numeric entry**,
  because the app grades a typed number directly.
- Where an option list lost its operators to extraction (Cambridge writes
  "energy / distance" as a stacked fraction), the options are re-typeset
  explicitly in KaTeX. The physics of the question is unchanged, and in each case
  only one option is dimensionally correct either way.
- Questions that depend on a **diagram the extraction could not carry** were not
  taken at all, rather than guessed at.
- Maths is re-typeset in KaTeX. No question's content was changed.

## If a tag looks wrong

Correct it in the chapter's JSON under `content/` and re-run
`node scripts/seed-library.mjs content/<shelf>` — that replaces the library copy.
Every question also has a **Source** field in the editor, so a teacher can fix
their own copy directly; clearing the field removes the chip.
