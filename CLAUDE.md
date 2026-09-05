# vidaivi — CBSE Practice Test Demo

Single-page practice test built with Vite + TypeScript, no framework. Maths is
rendered client-side with KaTeX loaded from a CDN (see `index.html`).

## Commands

- `npm run dev` — local dev server
- `npm run build` — typecheck + production build to `dist/` (ready for Netlify drop)
- `npm run preview` — serve the built `dist/`

## Question JSON schema (`src/questions.json`) — keep stable

The file is an array of question objects. `src/main.ts` types this as
`Question`; do not rename or repurpose fields.

| Field | Type | Required | Meaning |
|---|---|---|---|
| `id` | string | yes | Unique stable ID, e.g. `"mat-003"`. Never reuse. |
| `chapter` | string | yes | CBSE chapter name, e.g. `"Matrices"`. |
| `topic` | string | yes | Sub-topic shown as a chip on the question card. |
| `type` | `"mcq"` \| `"numeric"` \| `"long"` | yes | Controls the UI and grading (see below). |
| `q` | string | yes | Question text. Inline maths in `$...$`, display maths in `$$...$$` (KaTeX). JSON-escape backslashes: `\\times`, `\\begin{pmatrix}`. |
| `options` | string[] | mcq only | Answer choices, rendered A/B/C/D in order. |
| `answer` | number | mcq + numeric | For `mcq`: 0-based index into `options`. For `numeric`: the expected numeric value. |
| `tolerance` | number | numeric only | Accept answers within ±tolerance of `answer`. Use `0` for exact. |
| `solution` | string | yes | Worked solution shown after submission. Supports `$...$` maths, `**bold**`, and blank lines (`\n\n`) as paragraph breaks — nothing else (no full markdown, no HTML). |
| `marks` | number | yes | Marks awarded when correct. Score screen totals these. |

Grading by type:
- **mcq** — student picks an option; correct iff selected index equals `answer`.
- **numeric** — student types a number; correct iff `|value − answer| ≤ tolerance` (defaults to 0 if omitted).
- **long** — no auto-grading: student reveals the solution and self-assesses ("I got it right/wrong"), earning full `marks` or 0. Do not add `options`/`answer`/`tolerance` to long questions.

Notes:
- Total marks = sum of `marks` across the file; no separate config.
- Content is plain-text escaped before rendering, so raw HTML in strings will display literally, not render.
