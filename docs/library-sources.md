# The library's shelves — what is in them, and what a `source` tag may claim

Vidai's built-in library is eleven shelves in `content/`. This file records what
each shelf holds, what evidence exists behind any `source` tag on its questions,
and which papers have and have not been obtained.

## The rule, restated

A question carries a year tag **only** if it was read verbatim out of a full
question paper for that year, with the paper's own identifying code. Nothing is
tagged from a compilation, a coaching sheet, a question bank, or memory. A wrong
year in front of a class is worse than no year at all.

A tag must also say **what kind of paper** it came from. `CBSE 2024` means a
board question paper. A question taken from CBSE's own sample paper is tagged
`CBSE SQP 2024-25` and never `CBSE 2024` — they are different documents, and a
teacher checking the claim has to be able to find the source.

## The shelves

| Directory | Shelf | Chapters | Year tags |
|---|---|---|---|
| `class10-maths` | CBSE Class 10 Maths | 14 | yes — 124 questions, evidenced per chapter |
| `class10-science` | CBSE Class 10 Science | 13 | none yet |
| `class12-maths` | CBSE Class 12 Maths | 13 | none yet |
| `class12-physics` | CBSE Class 12 Physics | 14 | none yet |
| `class12-chemistry` | CBSE Class 12 Chemistry | 10 | none yet |
| `igcse-maths` | Cambridge IGCSE Maths (0580) | 9 | none yet |
| `igcse-science` | Cambridge IGCSE Combined Science (0653) | 12 | none yet |
| `alevel-maths` | Cambridge A Level Maths (9709) | 10 | none yet |
| `alevel-physics` | Cambridge A Level Physics (9702) | 12 | none yet |
| `alevel-chemistry` | Cambridge A Level Chemistry (9701) | 12 | none yet |
| `neet` | NEET (Physics, Chemistry, Biology) | 6 | none yet |

Every chapter is 15 questions. The NEET tests are 15 MCQs of 4 marks each,
matching the examination's own marking; every other shelf uses the CBSE-style
mix of 1-mark recall, 2- and 3-mark working and a 5-mark long answer.

Only Class 10 Maths carries year tags today. Its evidence is in the fourteen
`docs/class10-*-sources.md` files, one per chapter, naming the paper and question
number behind every tag.

## What papers exist, and where

### CBSE — the real board papers are published, 2022 to 2026

`https://www.cbse.gov.in/cbsenew/question-paper.html` carries the **actual
question papers sat by the class**, for every year from 2022 to 2026, in both
the main and the compartment (`-COMPTT`) sitting. Each subject is a zip of every
set of that paper, named by its Q.P. code:

| Class | Subject | Years with a main-sitting paper |
|---|---|---|
| XII | Mathematics | 2023, 2024, 2025, 2026 |
| XII | Physics | 2022, 2023, 2024, 2025, 2026 |
| XII | Chemistry | 2022, 2023, 2024, 2025, 2026 |
| X | Science | 2023, 2024, 2025, 2026 |
| X | Mathematics (Standard) | 2023, 2024, 2025, 2026 |

The URL of one archive is
`https://www.cbse.gov.in/cbsenew/question-paper/2025/XII/MATHEMATICS.zip`, and
that one holds 19 papers — 65-1-1 through 65-7-3, plus the visually-impaired
variant. 2022 is the term-based year, which is why Class XII Mathematics and
Class X Science have no main-sitting paper for it; both appear under
`2022-COMPTT`.

**An earlier version of this file said these papers did not exist.** That was
read off the same page and was simply wrong — the index is long, and a search
that stops at the first year's block sees only minor subjects. It is recorded
here rather than quietly deleted, because the next person to look will be
tempted to conclude the same thing.

### CBSE — sample question papers and marking schemes are published

`https://cbseacademic.nic.in/SQP_CLASSXII_<year>.html` and the Class X
equivalent carry, for each of 2021-22 through 2025-26:

- Class XII **Maths**, **Physics** and **Chemistry** — question paper and
  marking scheme
- Class X **Science** — question paper and marking scheme

These are CBSE's own documents, they state the pattern the board will follow,
and their marking schemes give the intended answers. They are a legitimate
source for a tagged question, provided the tag says `SQP` and names the session
— but now that the real papers are available they are the second choice, not the
first. A sample paper is what the board *intended* to ask; the board paper is
what it asked.

### Cambridge — past papers and mark schemes are published

Cambridge publishes real past papers openly, e.g.
`https://www.cambridgeinternational.org/Images/569924-june-2024-question-paper-21.pdf`
for 0580/21 June 2024. A tag such as `0580/21 J24 Q7` is checkable by anyone.

Downloading needs `curl --http1.1` — the server closes HTTP/2 streams
uncleanly and the transfer fails otherwise.

### NEET — no public archive found

`neet.nta.nic.in` is reachable but publishes no archive of past question papers.
Until a source exists whose provenance can be stated, **no NEET question will
carry a year tag.**

## The next pass

Deepening a shelf means, per chapter: read the papers, tag the questions that
genuinely came from one, and write the `docs/<shelf>-<chapter>-sources.md` file
that lets a teacher check every tag. Class 10 Maths shows the shape.

Questions without a tag are not second-class — `source` is optional and a
question without one is complete. It is the *claim* that has to be earned.
