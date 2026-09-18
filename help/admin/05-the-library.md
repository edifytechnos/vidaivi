---
title: The library
order: 5
summary: The ready-made subjects, who may change them, and how a question is corrected.
---

## What it is

{{library.shelves}} subjects, {{library.tests}} chapter tests and
{{library.questions}} questions that every teacher and parent can see and copy.

{{library.table}}

## Nobody owns it and no student sees it

A library test reaches a student **only** as their own teacher's copy of it. The
originals are invisible on the student side entirely — which is why unpublishing
one to correct it is safe: it interrupts nobody mid-paper.

The subjects are not on Your subjects either. That grid means *subjects you own*,
for every role, and the library is nobody's own work. It lives on **Browse
tests**.

## Only an admin may change one

A teacher opening a library test gets it read-only, with Preview and nothing
else. You get the ordinary editor: **Edit** on a Browse row, then unpublish →
edit → publish.

Teachers' existing copies are **not** updated. A copy is theirs; the link back to
the original exists only so a future version can say *"the original has changed"*.

## How a question is actually corrected

Not in the editor, for anything that should last. The chapters live as files in
the repository, and re-running the seeding script replaces each one by id.

That means: edit the file, run the seeder, and the correction is in the library
and in the repository at once. A fix made only in the editor is a fix that the
next seed run overwrites.

Before seeding, the content checker runs the server's own validation over every
file plus the things a library cares about and the validator does not — unique
ids across subjects, an order per chapter, a title and a subtitle, and two ways
content has shipped broken before (a markdown table, and a literal `\n` in the
text). A question that would fail to publish fails while it is being written.

## Adding a whole new subject

A new directory of chapter files plus an entry in the seeder's subject map. It
appears as a tile in New subject's step 1, badged with its test count, the moment
it is seeded.

## Year tags

A question may carry a source — *CBSE 2024*. **A year is a claim and has to be
earned**: write one only when the question was read out of that paper, with the
paper's own code, and say what kind of paper it was. A sample paper is not a
board paper.

There is an evidence file per subject in the repository recording which papers
were obtained and which chapters carry tags.
