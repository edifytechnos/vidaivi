---
title: Teachers and accounts
order: 1
summary: The allowlist, the accounts list, and the levers that make a real teacher work.
---

## Signing in

Two ways in, and they are not equivalent:

- **A Google account** named in the admin list. Everything works, and it carries
  Google's own second factor.
- **The admin username and password**, which is one shared string that opens
  every teacher, every student and every answer photograph. Put a
  [second factor](../admin/01-teachers-and-accounts.html#the-second-factor) on it.

Signing in is throttled. Five wrong passwords on one username locks it briefly,
stepping up to half an hour; a quiet quarter of an hour clears the slate. This
throttles attacks, it does not punish somebody who mistypes twice.

## The teacher allowlist

**Admin** → teachers. Adding a Gmail address here is what lets that teacher
**issue logins to real children**. Everything else — writing tests, taking
library subjects, previewing — already works without it.

So the sentence a new teacher sees is *waiting for approval*, and you are the
approval. It is deliberately a separate, deliberate act: anyone may declare
themselves a teacher, and a self-declaration must not open a roster of other
people's children.

A change reaches your own screen at once and every other server within a minute.

## Plans & pricing → the accounts list

Every teacher and parent, with three manual levers:

- **Free forever** — exempt from every limit. Everybody who already had an
  account when plans arrived is exempt, because the pilot class was promised
  free and a limit arriving by surprise would bill the one teacher the pilot
  depends on.
- **Paid seats** — how many students beyond the free ones they may issue.
- **Extend trial** — more days.

These are what make the payment flow honest: a real teacher can be run end to end
today, with money arriving afterwards.

## Sending an account back to its first screen

**Change** → reset. It clears the role they chose, their trial and their saved
phone number, so the whole sign-up is asked again.

It is a reset, **not a delete** — their tests, subjects, students and attempts
are untouched and still theirs.

Use it when somebody picked the wrong role, and to test the sign-up flow, which
is otherwise impossible to see twice.

## The second factor

**Admin** → security turns on a time-based code for the password login. Set-up is
manual key entry into any authenticator app.

- Turning it on ends every other admin session, including one somebody else may
  be holding.
- Turning it off needs a current code, not just a session.
- A used code is dead inside its own thirty seconds, so one read over your
  shoulder cannot be replayed.
- You get **eight single-use recovery codes**, shown once. Keep them somewhere
  that is not the phone with the authenticator on it.

Lost the phone? Sign in with an admin **Google** account and switch the factor
off from there.
