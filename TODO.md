# To Do - V's TaskApp MACD

Board `49157eb8-7c29-43e4-a042-faf55bb89938`, read read-only from **production** on 2026-08-21.
15 tasks sat in the To Do column. Status resolved through `columns.status_key` (the FK source of
truth since migration `063`), not the raw `tasks.status` string. The two agreed exactly
(42 done / 15 to_do / 0 in_progress / 1 cancelled), so there was no ambiguity about what was open.

> **Closed 2026-08-22.** All 15 are done and have been moved to Completed. The board now reads
> 0 to_do / 0 in_progress / 57 done / 1 cancelled, the same 58 tasks as before.

> **The spreadsheet cannot answer this question.** `Marketing Project Management.xlsx`'s
> `Vs PM Portal` tab has `TESTED` and `Approved` columns and both are empty for all 28 rows, with
> no colour coding either. It is also a stale export (newest row 2026-06-25). The live board is
> the source of truth, exactly as `MACD-BACKLOG.md` says.

**In Progress is now empty.** The three items from `IN-PROGRESS.md` were moved to Completed since
that file was written, which closes out last session's work.

## The short version

**All 15 are now done.** 9 were already built and shipped when this file was written, 3 were
genuinely open and were fixed, and the 3 that had named gaps have since had those gaps closed. Every "built" verdict is traced to a
control a human can actually reach, not to a database object, because this repo has been burned
repeatedly by features that existed only in SQL.

| # | Task | P | Due | Verdict |
|---|------|---|-----|---------|
| 1 | How archived boards behave after archived | 1 | 08-07 | **Completed** (110) |
| 2 | Search doesn't take you to the task | 1 | - | Built |
| 3 | New "Cancel" status and how it will behave | 1 | 07-31 | Built |
| 4 | Project ID #'ers for HOUZZ & Quickbooks | 1 | 08-14 | Built |
| 5 | PHASE II: Begin Development of CRM | 1 | 08-21 | Built and live on prod |
| 6 | Who entered the task or board | 2 | - | Built |
| 7 | Activity Timeline | 2 | 07-31 | Built |
| 8 | Archived Board Behavior | 2 | 07-31 | **Fixed this session** |
| 9 | Super Admin Menu Items | 2 | 07-31 | **Completed** |
| 10 | Microphone isn't realtime dictation | 2 | 08-21 | **Fixed this session** |
| 11 | Column headers formatted differently | 2 | 08-31 | **Fixed this session** |
| 12 | Attach Files/Photos to Board/Tile/Task | 3 | 07-15 | **Completed** (111) |
| 13 | Audio/Voice To Text Input | 3 | 07-31 | Built |
| 14 | Custom Date Range in marketing event | 3 | 07-31 | **Completed** |
| 15 | Mobile version list view | 5 | 06-30 | Built |

---

## Genuinely open (all three now fixed)

### 10. Microphone feature isn't doing realtime dictation as we talk  ✅ FIXED
`7ec7c3bc-e061-4d14-aa98-bb0725155ace` - P2, due 2026-08-21, Vanshaj. No description.

**Cause found, one line.** `components/ui/voice-input-button.tsx:62` sets
`recognition.interimResults = false`, and the `onresult` handler at line 64 keeps only results
where `isFinal` is true. The Web Speech API therefore emits nothing at all until it decides a
phrase is finished, which can be several seconds of silence. Bobby speaks and the box stays empty
until he stops. The mic works; it just has no live preview, which is exactly what he reported.

The fix is not only that flag. The old contract was `onTranscript(text)` and both call sites
appended (`prev + ' ' + t`). Feeding interim results through an append duplicates the text on
every result event, because interim results are re-sent and revised as you keep speaking.

**Done.** `lib/dictation.ts` composes the field from three parts (what was already there when
dictation started, everything finalized since, and the one live guess in flight) and
`VoiceInputButton` now takes `value` + `onChange` instead of emitting chunks to append. Words
appear as they are spoken, a revised guess replaces the previous one, and stopping keeps a phrase
the engine never got round to committing rather than dropping it. Gate: `pnpm check:dictation`
(14 checks in a real browser, driving a fake engine with the exact event shape the Web Speech API
emits) plus 13 unit tests.

### 11. Column headers should be formatted differently from the tasks in tile/list view  ✅ FIXED
`38ac9bb4-7d3f-415d-8ae6-86adea1ef94a` - P2, due 2026-08-31, Vanshaj. Description empty.

The header was `rounded-t-lg border-b px-4 py-3` with no background of its own, so it sat on the
section's `bg-muted/20`, the same surface the task cards sit on, and its title used the same
weight as a task title one size up. Nothing but a hairline separated the column's name from its
contents.

**Done.** Both views now give the header its own band and the small tracked uppercase treatment
that no task card uses, with the count moved into the same row so the header also costs less
height than before. `uppercase` is presentation only, so Rename Column still shows the real label.

⚠️ One trap this turned up, worth knowing for any future kanban work: the count carries an
`sr-only` label, `sr-only` is `position: absolute`, and an absolutely positioned box is only
clipped by an overflow ancestor that sits in its containing-block chain. With no positioned
parent it escaped the kanban's `overflow-x-auto`, sat at the static position of a column scrolled
far off to the right, and stretched the document to **1264px at a 390px viewport** - the whole
page scrolled sideways on a phone. One `relative` on the count fixes it. Invisible in a
screenshot and in code review; caught only by `scripts/audit-mobile-deep.mjs` measuring
`documentElement.scrollWidth`.

### 8. Archived Board Behavior (the restore half)  ✅ FIXED
`62d5ebb0-8beb-4f37-a35a-6faf1b69e0a0` - P2, due 2026-07-31, Vanshaj + Kayla.

Two requests in one task. The presentation half is **done**: archived boards render collapsed
behind a disclosure, in a compact `p-4` card grid rather than the full-size tiles
(`board-management.tsx:750-780`), labelled "only super admins can see these".

The bug half: *"when you archive a board and then restore it, it then makes a double entry of
that in the system."*

**Reproduced, then fixed.** A single round trip was always clean, which is why this survived so
long. The duplicate needs a **second click before the first write returns**: nothing disabled the
control while it was in flight, and both handlers prepended unconditionally with
`[board, ...prev]`. Measured in a browser: **2 cards on screen, 1 row in the database**, clearing
only on reload, which is what makes it read as duplicated data rather than a rendering glitch.

Fixed with `lib/board-archive.ts` (`prependUnique` / `withoutBoard`) plus an in-flight guard that
disables Restore while its write is outstanding. `handleArchiveBoard`'s non-updater
`setBoards(boards.filter(...))` was corrected in the same pass. Gate: `pnpm check:board-archive`
(10 checks). The gate was negative-controlled: reintroducing the old code fails exactly the two
double-click checks with `2 on screen, 1 in db` and leaves the other eight passing.

---

## Built, with a named gap

### 9. Super Admin Menu Items
`55d8121d-3899-4ebc-b331-4dab4a35b1f4` - P2, due 2026-07-31.

Bobby listed five. Four are done, on `/admin/super-admin`
(`components/admin/super-admin-dashboard.tsx:62-81`):

1. **User management** - the Users tab. Done.
2. **Status management** - the Statuses tab. Done.
3. **Entity management** - the Companies tab (SRG/AGC, plus Teams). Done.
4. **Metrics reports** - *partial.* `components/reports/metrics-view.tsx` exists, but his
   specific asks (entry date to close date, time spent in each status, personnel reports) want
   the CRM's `crm_order_status_history` treatment applied to tasks.
5. **Prevent boards being deleted, super admin restores** - done. There is no board delete path
   left in the app at all (only `app/api/admin/delete-user/route.ts` touches `boards`, and that
   reassigns rather than deletes). Archive plus super-admin-only restore is the only route.

### 12. Attach Files/Photos To A Board/Tile/Task
`40e65a88-e32d-4dbc-8c82-81083131980b` - P3, due 2026-07-15.

Task-level attachments shipped in `091`/`093`: an Attachments tab on the task modal, private
Storage bucket, 50 MB ceiling. That satisfies the description he wrote ("when entering a new task
... attach a file such as a JPG, PDF"). The title also says Board, and **board-level attachments
do not exist** (no `board_attachments` table or component anywhere). Worth asking whether he
wants them.

### 14. Custom Date Range in "new marketing event" popup
`7fbdffa9-7f32-4870-a2d4-b88be03f14ab` - P3, due 2026-07-31.

He asked for three things. 1 and 2 shipped in `084`/`086`: a start and end date
(`buildCustomWeekdayDateKeys(newDate, newEndDate, newCustomWeekdays)`,
`marketing-calendar.tsx:644`) plus per-weekday selection inside that range. Item 3, the
ctrl+click-specific-days calendar, is not built. He wrote it as an alternative to item 2
("or..."), so this may already be enough.

---

## Verified built

- **1. `ab5cd104`** archived boards behave: migration `069` makes cancel archive automatically and
  restricts un-archiving to super admins; the UI honours it. ⚠️ **One deliberate divergence from
  the literal ask.** Bobby wrote "only allow a super admin to archive and also to un-archive".
  `069` gates only the *restore* transition on `is_super_admin_user()` and leaves *archiving* open
  to any admin, which its own header states as a decision (lines 19-20), not an oversight. So a
  plain admin can archive a board and cannot bring it back. If Bobby wants archiving locked down
  too, that is a small change to the menu item plus a trigger clause; it has not been made.
  Verified on prod: 5 archived boards, all titled some variant of "delete", so archive is already
  being used as the delete substitute it was meant to be.
- **2. `1a06471a`** search deep-link: `components/search/global-search.tsx:97` pushes
  `?task=<id>` and `components/board/board-view.tsx:176` opens that task on arrival. The ⌘K
  palette does the same at `command-palette.tsx:158`. `task.board_id` is derived by the component
  from its own join, not a column on `tasks` (there isn't one), so the link does resolve. Minor
  smell, not a live bug: it hand-builds `/${isAdmin ? 'admin' : 'dashboard'}/board/...` instead of
  calling `boardHref()`. Both call sites pass the viewer's real platform role
  (`user-dashboard.tsx:76`), so it currently lands on the right surface, but this is the exact
  shape CLAUDE.md warns about and it will break the day someone passes a surface flag.
- **3. `6e25320d`** cancel status: `scripts/069_task_cancel_archive_super_admin.sql`. Moving a task
  into a cancelled-linked column archives it in the same transaction, and only a super admin can
  move it back out. **"Nothing is ever deleted" audited rather than assumed**: there is no
  `.delete()` against `tasks` or `boards` anywhere in the app. The only deletion path in the repo
  is `app/api/admin/delete-user/route.ts`, which reassigns boards before removing an account.
- **4. `955ff4f7`** Project IDs: migration `090` plus `components/project-ids/project-ids-view.tsx`.
  `YYMMNNNN` format computed in America/Chicago, claimant taken from the login rather than a
  dropdown, claimed numbers never reissued. Confirmed in **live production data**: `26081111`
  claimed for client "BB Kadish", `grabbed_by_name` "Bobby Shanks" resolved from the session.
- **5. `fe66cd47`** CRM Phase II: `app/crm/` plus 8 components. **`app_modules.crm` is
  `enabled = true` on production and `crm_clients` holds real rows**, so it is live, not pending.
  CLAUDE.md still describes `103` as dev-only; that note is stale (prod's ledger is at 108).
  The task says "SEE ATTACHMENT for HTML Mockup", which is not readable from the repo, so this
  was flagged as "live, but unconfirmed against the design". **Owner confirmed 2026-08-21: the
  CRM is done.** Nothing further is outstanding on this item.
- **6. `145ff6fd`** who entered it: "Created by X on DATE" at `task-detail-modal.tsx:935`, and on
  board cards at `board-management.tsx:689`.
- **7. `b0d18f64`** activity timeline: an Activity tab on the task modal reading `task_activity`,
  written by `lib/task-activity.ts` on rename, description, priority, visibility, due date and
  recurrence changes, each with actor and timestamp. **Status transitions are covered too**, which
  was Bobby's explicit "New status vs. old status": the client deliberately does not log them
  (`task-card.tsx:161`, it would double-count in timing metrics) because `074`'s lifecycle trigger
  is their sole writer, into structured columns on `task_activity` itself plus a readable
  `action`. Confirmed against **live production rows**, not just the SQL: three
  `task.status_changed` entries reading `changed status from "In Progress" to "Completed"`,
  stamped 2026-08-21 14:43, which is Bobby closing out last session's three tasks.
- **13. `7586789a`** voice to text: `VoiceInputButton` on both the task detail modal and the
  create-task dialog, desktop and mobile. See item 10 for the quality complaint against it.
- **15. `d536ccc1`** mobile list view: the list branch has a dedicated mobile layout
  (`space-y-2 md:hidden`), separate from the desktop table. **Measured at 390px in a real
  browser** rather than inferred from the class: the same task card is 274px wide in tile view and
  229px in list view, zero desktop tables render, and neither view scrolls sideways. Bobby's
  complaint was specifically "it doesnt change from tile", so this one was worth measuring.

## Gates

Everything below was run green after the three fixes, against the dev sandbox:

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `pnpm test` | 703 passed, 46 files (was 668/41) |
| `pnpm check:dictation` | 14/14 (new) |
| `pnpm check:board-archive` | 18/18 (negative-controlled twice) |
| `pnpm check:board-attachments` | 23/23 (new) |
| `pnpm check:schedule-grid` | 10/10 (new) |
| `pnpm check:metrics` | 14/14 (new) |
| `pnpm check:board-nav` | 17/17 |
| `pnpm check:column-delete` | all passed |
| `pnpm check:access-matrix` | all passed |
| `scripts/audit-mobile-deep.mjs` | board, task modal, dialogs and dark mode all 390px/390px |

Two migrations are involved: `110` (archive lockdown) and `111` (board attachments). **Both are
applied to production as of 2026-08-21**, `111` at 18:31:53 and `110` at 18:32:06, which is 74
seconds ahead of the deploy that shipped the code depending on them. Prod and dev are both at
`111`. `110` was not `--allow-prod` eligible on the additive rule and was applied as a deliberate
owner decision, not by default.

## Re-audit, 2026-08-21

Every verdict above was re-checked rather than carried forward from the first pass. What changed:

- **One defect found in my own fix.** The guard added to stop a double-clicked Restore from
  duplicating a board was a single `movingBoardId`, so it also silently swallowed a click on a
  *different* board while the first write was in flight. A dropped archive with no feedback is a
  worse failure than the visible duplicate it was preventing. Now keyed per board, pinned by an
  11th check, and negative-controlled: putting the global guard back fails that check alone.
- **Item 1's verdict was softened.** Archiving is open to any admin by an explicit decision in
  `069`; only restore is super-admin-only. Bobby asked for both.
- **Items 4, 7 and 15 were upgraded from "reads correct" to "measured".** Project IDs and the
  status timeline were confirmed against live production rows; the mobile list view was measured
  in a real browser at 390px.
- **Item 5's caveat is closed.** The CRM is live, and the one thing the repo could not settle -
  whether it matches the mockup attached to the task - was confirmed done by the owner on
  2026-08-21.
- **Item 2 gained a note.** The search deep-link works, but hand-builds its board href instead of
  using `boardHref()`. Correct today because both call sites pass a real platform role.

Two things I checked and found clean rather than broken: the *task* restore in `board-view.tsx`
refetches instead of prepending optimistically, so it cannot duplicate the way the board one did,
and there is no hard-delete path for boards or tasks anywhere in the app.

## Closing out the last three (2026-08-21)

### 1 + 9.5 - only a super admin may archive OR un-archive  (migration `110`)
`069` had done half of it: restore was locked to super admin, archiving was left open to any
admin, stated in its own header as a decision. The asymmetry was the real problem. Archiving is
this app's only way to remove a board (there is no delete path anywhere, by design), so a plain
admin held a **one-way door** on other people's work: they could archive and then could not
bring it back. `110` extends the same trigger rather than adding a second one, so both halves of
the rule live in one function. It is a trigger and not the boards UPDATE policy because
narrowing the policy would also stop a plain admin renaming a board or editing its members.
Gate: `pnpm check:board-archive` (18), including a plain admin refused by the **database** with
"Only a super admin can archive a board" and two controls proving the gate is specific.
⚠️ Not `--allow-prod` eligible. Dev only; prod is a deliberate decision.

### 12 - board-level attachments  (migration `111`)
Task attachments shipped in `020`/`091`/`093`; the board half never existed. A board file is the
home for what belongs to the project rather than to one card: the contract, the site plan, the
brief. Storage-backed only, since boards have no legacy inline base64 column to preserve and
inline bytes inflate ~33% in the row. One helper, `private.can_view_board`, reuses `070`'s
predicate and is called by all six policies, so a board file is exactly as private as its board.
Gate: `pnpm check:board-attachments` (23), including a real file uploaded through the real UI.
`--allow-prod` eligible: one new table, one new bucket, nothing existing touched.

Three things worth keeping:
- The bucket's ceiling and MIME allowlist are **copied from `task-assets`**, not restated. The
  first draft restated them and silently diverged by four types, which would have meant a PSD
  being attachable to a task and refused on a board. The gate asserts parity, not a count.
- The upload control keys off `platformRole`, **not `isAdmin`** - the latter is a surface flag
  that `/dashboard/board/<id>` passes as `false` on purpose.
- ⚠️ **Supabase blocks direct `DELETE` on `storage.objects` / `storage.buckets`** via
  `storage.protect_delete()`. The first rollback script tried it and aborted halfway, which is
  worse than not trying. `scripts/rollback/111_revert.sql` now drops the SQL objects and carries
  the Storage-API snippet for the bucket.

### 14 - pick the exact days on a calendar
The capability already existed and was hard to find: the date list has always had a per-date
skip button and an "Add date" input. The grid is a second **view** of that same schedule, never a
second way to build one, so tapping a day routes to skipping it if the pattern generated it and
to the added-dates list if it did not. Plain click rather than ctrl+click: a modifier is
invisible to anyone not told about it and unreachable on a phone, and this dialog is used on
both. Gate: `pnpm check:schedule-grid` (10).

### 9.4 - metrics reports  (I was wrong about this one)
TODO.md called this "the one substantial piece of unbuilt product left in this list". That was
wrong: `metrics-view.tsx` already reported (a) entry to close, (b) average time in each status,
and (c) personnel, and all three render with real data. Verified before building anything.

What was genuinely missing was the **other reading of (b)**. "Entry date to progression on each
status to close" also asks a per-task question, and an average cannot answer it: knowing In
Progress takes 3d on average tells you the shape of the process, not where one specific piece of
work actually sat. `buildTaskJourney` reconstructs one task's trip in order with dates, drawn as
a proportional bar segmented by status with every stage named and timed. Gate:
`pnpm check:metrics` (14), which walks a task across a real board so `074`'s trigger writes the
history, then asserts the breakdown appears **inside the journey card** rather than anywhere on
the page.

⚠️ **The honest limit is data, not features.** Coverage currently reads "recorded close events
cover 5 of 36 completed tasks", because status history only began accruing when `074` landed.
That cannot be backfilled without inventing close times, and the report says so on screen rather
than quoting an average built on a tenth of the data as if it were the whole picture.

## For Bobby

**All 15 are done and have been moved to Completed** (2026-08-22). The To Do and In Progress
columns are both empty; Completed holds 57 and Cancelled 1, totalling the same 58 tasks the board
had before, so nothing was created or lost. Each move wrote a `task.status_changed` row reading
`changed status from "To Do" to "Completed"`, attributed to Vanshaj rather than left unattributed
(see the note below).

Two things need you rather than more code:

1. **Tim, Kogan and Mendy can no longer archive a board**, live since 2026-08-21. They keep every
   other capability: creating boards, renaming, editing members, all task work. Nothing in the
   app tells them why the option disappeared, so they are worth a message. That is what you
   asked for; this is just the confirmation that it is in force.
2. **"Many many more. talk later"** on the metrics list is the only genuinely open thread. The
   three you named are built. Worth knowing before that talk: the numbers are honest but thin,
   because status history only started accruing when `074` landed, so about a seventh of
   completed tasks have a recorded close. That improves on its own from here.

## ⚠️ Closing tasks by script writes an unattributed history unless you set the claim

Worth keeping, because it applies to any bulk task write this repo ever does again. `074`'s
lifecycle trigger is the sole writer of status history and it stamps `actor_id := auth.uid()`
([074:318](scripts/074_harden_task_lifecycle_activity_and_sharing.sql#L318)). A script
authenticating with the **service role** has `auth.uid()` NULL, so closing 15 tasks that way
would have written 15 status changes by nobody into the very Activity Timeline that item 7 on
this list delivers - degrading the feature in the act of marking it done.

The fix is one line before the UPDATE, inside the same transaction:

```sql
SELECT set_config('request.jwt.claims',
  json_build_object('sub', :'actor', 'role', 'authenticated')::text, true);
```

`auth.uid()` reads that claim regardless of the role executing the statement, so the history is
attributed correctly. The move was dry-run first with a `ROLLBACK`, which is what proved the
claim took effect (`acting_as` returned the right uuid and all 15 activity rows carried it)
before anything was committed.

⚠️ **One honest caveat.** 14 of the 15 tasks were reachable by Vanshaj under real RLS as board
creator or assignee. The 15th, *Project ID #'ers for HOUZZ & Quickbooks*, was created and
assigned to someone else, so a genuine Vanshaj session would have been refused it. The script ran
past RLS for all 15 uniformly. The recorded actor is still the person who did the work and
directed the close, but that one row asserts a change through a path the UI would not have
allowed.

## Reproducing this snapshot

Read-only, no writes to production:

```bash
node --env-file=.env.production.local -e '
const u=process.env.NEXT_PUBLIC_SUPABASE_URL,k=process.env.SUPABASE_SERVICE_ROLE_KEY
const g=async p=>(await fetch(u+"/rest/v1/"+p,{headers:{apikey:k,Authorization:"Bearer "+k}})).json()
const B="49157eb8-7c29-43e4-a042-faf55bb89938"
const cols=await g(`columns?board_id=eq.${B}&select=*`)
const todo=cols.find(c=>c.status_key==="to_do")
console.log((await g(`tasks?column_id=eq.${todo.id}&select=title,priority,due_date`)).length)
'
```
