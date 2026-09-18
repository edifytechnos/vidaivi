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

Also on the Payments screen. A code carries a percentage off, a flat amount off,
or both; the two **add**, and the total is clamped at the price, so a code can
make something free and can never make money owed.

Give each code a **maximum redemptions** — that is the real bound. A wrong code
is answered exactly like no code, with the list price and a sentence, so guessing
learns nothing beyond "not that one" and the worst case is a sale at a price you
had already decided to give somebody.

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
