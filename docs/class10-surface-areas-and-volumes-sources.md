# Class 10 · Surface Areas and Volumes — where each question came from

Evidence behind the `source` tags on **Class 10 · Surface Areas and Volumes —
Chapter Test 12** (`lib-c10-surface-areas-and-volumes`,
`content/class10-maths/12-surface-areas-and-volumes.json`).

Same rule and same corpus as Real Numbers — see
`docs/class10-real-numbers-sources.md`.

## Tagged questions

| # | Question (short) | Tag | Paper, question |
|---|---|---|---|
| 1 | TSA of a solid hemisphere to the square of its radius | CBSE 2024 | 30/4/1, Q9 |
| 6 | Cylinder and cone, radii $3:4$ and heights $2:3$ — ratio of volumes | CBSE 2025 | 30/1/2, Q26 |
| 9 | Solid toy: hemisphere surmounted by a cone | CBSE 2025 | 30/3/3, Q32 |
| 10 | Tent: cylinder with a conical top, canvas and cost | CBSE 2024 | 30/5/2, Q34 |
| 11 | Inverted cone, lead shots, one-fourth of the water out | CBSE 2025 | 30/3/1, Q35 |
| 12 | Iron pole of two cylinders — find its mass | CBSE 2024 | 30/3/3, Q33(a) |

## One question found and left out

2025's 30/1/1 Q30 — a room shaped as a cylinder with a hemispherical dome,
"if the room contains ⟨missing⟩ m³ of air, find the height of the cylindrical
part" — loses the volume figure to text extraction. Without it there is no
question, and the marking scheme for that set does not print the number either.

## Untagged questions

Questions **2**–**5**, **7**, **8** and **13**–**15** carry no year: volume of a
sphere, curved surface of a cylinder, slant height of a cone, volume of a
hemisphere, melting a sphere into a cone, total surface of a cylinder, joining
two cubes, recasting a sphere into 126 cones, and a well with an embankment
around it. All ordinary NCERT Chapter 12 material.

They are chosen around the two ideas the chapter really tests:

- **Volumes add; surface areas do not.** When two solids are joined, the faces
  where they meet disappear from the outside. The toy, the tent and the two
  cubes each say this in their solution.
- **Melting conserves volume.** Every recasting, displacement and embankment
  question is the one sentence *total volume before = total volume after*.

## Changes of form, stated plainly

- Question **6** is a written question in the paper; here it is asked as numeric
  entry by fixing the second half of the ratio ("the ratio is $a : 8$; give
  $a$"), so the app can grade a typed number. The working is unchanged.
- Two other questions are numeric entry for the same reason.
- Maths is re-typeset in KaTeX. No question's content was changed.

Every answer was recomputed independently in Python: the tent's 105.6 m² and
₹52,800, the ratio $9:8$, the toy's 25.12 cm³ and 42.88 cm², **100** lead shots,
the pole's 1047.2 kg, **126** cones, and the embankment's 1.125 m.
