# Open owner decisions

Things waiting on Bobby, not on code. Every fact below was **re-queried against production on
2026-08-30** rather than copied from a note; CLAUDE.md's own equivalents have gone stale three
times, so re-run the query before acting.

## Status at a glance

| # | Decision | Status | Cost of leaving it |
|---|---|---|---|
| 1 | Migration `125`, should WIP limits refuse? | ✅ **Decided: no** | None. The runner now refuses to apply it by accident. |
| 2 | The "TEST" marketing calendar and Vanshaj's access | ⏳ **Needs you** | A tidy-up nobody is blocked on. |
| 3 | Four recurring tasks with no schedule | ⏳ **Needs you** | None. The app already explains them honestly on screen. |
| 4 | Which boards should use agile mode | ⏳ **Needs you** | Agile is reachable but no board uses it. One click each. |
| 5 | The notification backlog | ℹ️ Context only | Nothing. |

**Nothing here is broken, and nothing is blocking anyone.** Item 1 is closed. Items 2 and 3 are
tidy-ups whose right answer depends on facts only you have. Item 4 is the one with actual upside:
it is the difference between the agile feature existing and being used.

Why an agent did not simply decide 2 and 3: item 2 grants or removes a named person's access to
1355 live events, and item 3 asks whether four pieces of your marketing team's work are meant to
repeat. Both are business facts, not engineering ones.

---

## 1. Migration `125` - should WIP limits actually refuse?

**Status:** deliberately held back. Prod reports `pending: 0   held: 1`.

A board column can carry a work-in-progress limit. Today, on production, hitting that limit
shows a warning and lets the move through. `scripts/125_wip_enforcement.sql` is the trigger
that would make it a real refusal. It is applied to the dev sandbox and not to production.

**Why it is not applied.** It puts a trigger on `tasks`, so it runs on every task move on
every board in the product, forever. If it were wrong, the failure would not be "the agile
module misbehaves", it would be "nobody can drag a card". This repo's rule is that only
purely additive migrations reach production on an agent's judgement.

Two migrations have been overridden before (`113` and `118`), and both were forced by shipped
code that could not run without them. Nothing depends on `125`: migration `126` exists
precisely so the badge can ask the database whether enforcement is installed and honestly say
"warning only, nothing is refused" where it is not.

**What it would buy today: nothing.** Verified 2026-08-30 on prod: 0 columns carry a WIP
limit, 0 boards have agile settings, 0 sprints exist. The trigger would be a no-op on 100% of
writes until someone enables agile on a board, sets a limit, and switches that board to
enforcement mode.

**Recommendation: leave it.** Revisit the day a team is actually using WIP limits and finds
the warning is being ignored. The runner now refuses to apply it by accident, so there is no
cost to waiting.

**If you decide yes:** it needs a written risk statement, a verified backup, and
`node --env-file=.env.production.local scripts/migrate.mjs --only=125 --allow-prod --release-hold=125`.
Its own post-conditions abort if any column already carries a limit, so it cannot silently
change live behaviour.

---

## 2. The "TEST" marketing calendar, and Vanshaj's access

**Status:** open. This is the one on the list that removes somebody's access either way.

Production has three marketing calendars, verified 2026-08-30:

| calendar | archived | members | events |
|---|---|---|---|
| Marketing Calendar | no | 2 (Bobby, Kayla) | 1355 |
| TEST | no | 3 (Bobby, Kayla, Vanshaj) | 0 |
| Kayla's Personal | yes | 0 | 0 |

"TEST" is empty and clutters the calendar switcher. The catch: **Vanshaj is a member of no
other calendar**, and the Marketing tab is shown to anyone who is an admin *or* a member of at
least one calendar. So archiving TEST removes Vanshaj's Marketing nav item entirely.

**The two real options:**

- **Archive TEST and add Vanshaj to Marketing Calendar.** They keep Marketing, and gain access
  to 1355 real events they cannot currently see. This is granting access to live work.
- **Archive TEST and leave it there.** The switcher is tidy and Vanshaj loses the Marketing
  tab. Reversible at any time.

**No recommendation.** Both are access decisions about a real person, which is yours.

---

## 3. Four recurring tasks that have no schedule

**Status:** open since the recurrence engine shipped (migrations `116`/`117`, 2026-08-24).
Still exactly 4 as of 2026-08-30.

All four are on **Marketing PM Sheet**, all created 2026-06-18, none has a due date:

- Before & After Pix Constantly
- Begin and continuisouly develope a Handyman Handbook
- Get with Beth Smith @ SGR to particpate more often
- Migrate AGC clients in HOUZZ to Brevo

They carry `is_recurring = true` but no cadence, so the backfill deliberately skipped them
rather than guessing whether "repeats" meant daily or monthly.

**Nothing is broken, and the app is already honest about it.** Open any of the four and the
recurrence panel says, in plain words: "This task is marked as repeating, but it has no schedule,
so nothing has ever been created from it", with a **Set up a real schedule** button beside it.
So the only cost of leaving these alone is four tasks carrying a prompt nobody has answered.

Read as written, they are ongoing efforts rather than scheduled repeats. "Constantly" and
"continuously" are not cadences.

**Recommendation: clear the recurring flag on all four.** They stay as ordinary tasks and stop
being reported as half-configured. The alternative is giving each one a real cadence, which
means deciding what "constantly" means in days. Say the word and it is one update.

---

## 4. Which boards should use agile mode

**Status:** new decision, created 2026-08-30 when the module was switched on.

The **agile module is now on** in production, so `/agile` is in the nav for everyone. **No
board has agile enabled**, which is the intended state: switching the module on makes the page
reachable and changes nothing about how any board works.

Agile is opt-in per board on purpose. Prompt G's first requirement is that marketing,
contracting, real estate, finance and operations boards never have Scrum vocabulary put in
front of them, so enabling it everywhere would defeat the feature.

**Recommendation: pick one board to try it on.** Open **Agile** in the sidebar, choose the board,
and press **Turn on agile for this board**. That is the whole setup; **More options** is there if
you want to pick the noun (sprint, cycle or iteration) and the unit (points, hours or days) at the
same time, and both are changeable later with no migration and no data loss.

Backing out is the same switch, and turning agile off leaves the board exactly as it was with
every task intact. **How it works** on that same screen, and the ⓘ beside the Agile heading,
open the complete guide: what it adds, how a window runs, what every number means, and the
questions people actually ask.

---

## 5. Context, not a decision: the notification backlog

Production has **134 unread notifications** as of 2026-08-30, mostly historical - they predate
the inbox shipping and were never marked read because until then there was nowhere to read
them. Expect the bell to show a large number on first visit to `/inbox`. Mark-all-read is one
click and is not destructive; the rows stay, they are just no longer unread.
