---
title: AI usage and credits
order: 4
summary: Who is spending what, who is running low, and how to top them up.
---

## The screen

**AI usage** lists every account that has assessed anything, with credits
granted, credits used, and what it cost in rupees. The header line counts how
many are running low, and those rows sort to the top and are flagged **Low** —
because the question this screen answers is *who needs topping up*.

## Two kinds of wallet

| Account | Reads as | Behaviour |
|---|---|---|
| Teacher, admin | *this month* | An allowance that refills each month |
| Parent | *balance* | One trial grant, then packs. Does not reset. |

A parent's credits cannot reset on the 1st, or *"once it is used up you buy
more"* would be untrue by the end of the month.

## Topping up

**Grant** on a row adds credits. A top-up **raises what was granted and leaves
what was used alone** — it never forgives past spending, and it never cancels a
trial grant a wallet has not touched yet.

Pick the right kind: a parent's grant has to go to their balance, not to this
month.

Do this rather than waiting on a deploy. Somebody who runs dry mid-term is
somebody whose children's papers stop being marked.

## Cost

Priced from the tokens each call actually used, at rates that are settings rather
than constants — so a model change or an exchange-rate move is a setting, not a
release.

A call that came back without usage figures shows **—**, not zero. Showing an
unknown cost as free is the one wrong answer this report could give.

## Two gates, and they do different jobs

- **A daily cap** per account — a runaway brake, against a loop or a stolen
  session.
- **Credits** — the entitlement somebody is accountable for.

Both refuse only the AI draft. **Marking by hand always works**, and the refusal
says so, because a teacher who cannot mark at all in front of a class is a far
worse failure than one who has to type the numbers.

## If the feature is off entirely

AI marking needs a model endpoint and key configured. Without them the button is
hidden everywhere rather than shown and failing. These settings are per
environment — production's do not reach QA.
