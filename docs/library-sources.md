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

### CBSE — board papers are not published for the core subjects

`https://www.cbse.gov.in/cbsenew/question-paper.html` lists 178 papers, but only
for **2025**, and only for **minor subjects** — Applied Mathematics (465), Data
Science, Home Science and so on. Mathematics (041), Physics (042), Chemistry
(043) and Science (086) are **absent**, and the 2022, 2023, 2024 and 2026 paths
return 503.

The Class 10 Maths tags therefore came from papers obtained elsewhere, read in
full and recorded chapter by chapter. That corpus is 45 papers: 2024 (30/2/1–3,
30/3/1–3, 30/4/1–3, 30/5/1–3), 2025 (30/1/1–3 … 30/6/1–3) and 2026 (30/1/1–3 …
30/5/1–3), most of them with their official marking schemes.

### CBSE — sample question papers and marking schemes are published

`https://cbseacademic.nic.in/SQP_CLASSXII_<year>.html` and the Class X
equivalent carry, for each of 2021-22 through 2025-26:

- Class XII **Maths**, **Physics** and **Chemistry** — question paper and
  marking scheme
- Class X **Science** — question paper and marking scheme

These are CBSE's own documents, they state the pattern the board will follow,
and their marking schemes give the intended answers. They are a legitimate
source for a tagged question, provided the tag says `SQP` and names the session.

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
