# Past papers go here

`dge.tn.gov.in` and `dhsekerala.gov.in` are not reachable from the Claude Code
cloud container, and **this is not an environment setting** — network access is
already Full, and other `.gov.in` hosts (`scert.kerala.gov.in`,
`tnschools.gov.in`) answer fine from the same container.

The two that matter fail for their own reasons:

| Host | What happens | Diagnosis |
|---|---|---|
| `dhsekerala.gov.in` | DNS returns no address at all | no A record resolvable from outside India |
| `dge.tn.gov.in` | resolves to 218.248.29.76, TCP never completes | geo-restricted to Indian traffic |

So the papers have to be fetched from a machine in India and committed here.

## What to drop in

One PDF per paper, named so the year and subject are unambiguous:

```
papers/tn12/physics-2024.pdf
papers/tn12/physics-2023.pdf
papers/tn12/chemistry-2024.pdf
papers/kerala12/physics-2024.pdf
```

Anything readable is fine — the naming is what matters, because the **year in
the filename is what becomes the `source` tag**, and CLAUDE.md is explicit that
a year is a claim that has to be earned.

## What happens then

Questions written from a paper actually read get `"source": "TN 2024"` or
`"source": "Kerala 2024"`. Until the PDFs are here, every question on the Tamil
Nadu and Kerala shelves is written to the verified **syllabus** and carries **no
source tag at all** — which is the honest state, not an oversight.

Note that extraction quality decides what can be tagged: a question carried by
words and whole numbers survives being read out of a PDF, and one carried by
surds, matrices or superscripts does not. See the notes in CLAUDE.md under
*Extraction loses notation*.
