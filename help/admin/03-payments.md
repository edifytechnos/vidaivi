---
title: Payments
order: 3
summary: Somebody pays by UPI and says so; you check the bank and confirm.
---

## The queue

**Payments** lists orders where the buyer has pressed *I have paid* and nothing
has been confirmed. Each row carries who, what, how much, the discount code if
any, and the **reference** — which is what to look for in your UPI statement.

- **Confirm** grants it: a subject copies into their account, a credit pack is
  added to their balance.
- **Not received** refuses it and clears the row.

Either way the row leaves the queue, so this list stays the length of the queue
rather than the length of the sales history.

## Confirming twice is refused

An order can only be settled once, so a double tap cannot double-grant. If a
confirm seems not to have taken, press it again — that is safe — and then check
the buyer's account.

## Discount codes

Also on the Payments screen. **New code** comes with a code already made for
you — share it as it is, or type your own; it is not case-sensitive. A code
carries a percentage off (up to 100), a flat amount off, or both; the two
**add**, and the total is clamped at the price, so a code can make something
free and can never make money owed.

**A code for the whole price settles the purchase on the spot**: the buyer
types it, the order is paid with nothing to confirm, and the subject, credits
or plan are theirs at once. Nothing reaches your queue. That is how to give a
teacher the plan for free.

Set **Limit uses to** — that is the real bound. **1** is a code one person uses
once; **0** means no limit. A code works for a ready-made subject, a credit
pack and the teacher plan alike. A wrong code is answered exactly like no
code, with the list price and a sentence, so guessing learns nothing beyond
"not that one" and the worst case is a sale at a price you had already decided
to give somebody.

## What is recorded

Every purchase keeps what was actually paid, the list price, the code and the
reference. A discount nobody can explain six months later is a discount that was
not recorded.

## If Buy is missing everywhere

The platform's UPI details are not set. Until they are, the buy endpoint answers
"not available" and the app hides Buy rather than showing a button that cannot
work.

Note that these settings are **per environment** — setting them on QA does not
set them on the live site, and vice versa.

## What is not built yet

A card gateway, and the subscription side. Today every sale is a UPI transfer you
confirm by hand. That is a deliberate first step: it needs no registered business
behind it.
