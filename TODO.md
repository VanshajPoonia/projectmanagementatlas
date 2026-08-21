# To Do - V's TaskApp MACD

Board `49157eb8-7c29-43e4-a042-faf55bb89938`, read read-only from **production** on 2026-08-21.
15 tasks sit in the To Do column. Status resolved through `columns.status_key` (the FK source of
truth since migration `063`), not the raw `tasks.status` string. The two agree exactly here
(42 done / 15 to_do / 0 in_progress / 1 cancelled), so there is no ambiguity about what is open.

> **The spreadsheet cannot answer this question.** `Marketing Project Management.xlsx`'s
> `Vs PM Portal` tab has `TESTED` and `Approved` columns and both are empty for all 28 rows, with
> no colour coding either. It is also a stale export (newest row 2026-06-25). The live board is
> the source of truth, exactly as `MACD-BACKLOG.md` says.

**In Progress is now empty.** The three items from `IN-PROGRESS.md` were moved to Completed since
that file was written, which closes out last session's work.

## The short version

Of the 15, **9 were already built and shipped**, 3 are built with a named gap, and **3 were
genuinely open. All three are now fixed** (see below). Every "built" verdict is traced to a
control a human can actually reach, not to a database object, because this repo has been burned
repeatedly by features that existed only in SQL.

| # | Task | P | Due | Verdict |
|---|------|---|-----|---------|
| 1 | How archived boards behave after archived | 1 | 08-07 | Built |
| 2 | Search doesn't take you to the task | 1 | - | Built |
| 3 | New "Cancel" status and how it will behave | 1 | 07-31 | Built |
| 4 | Project ID #'ers for HOUZZ & Quickbooks | 1 | 08-14 | Built |
| 5 | PHASE II: Begin Development of CRM | 1 | 08-21 | Built and live on prod |
| 6 | Who entered the task or board | 2 | - | Built |
| 7 | Activity Timeline | 2 | 07-31 | Built |
| 8 | Archived Board Behavior | 2 | 07-31 | **Fixed this session** |
| 9 | Super Admin Menu Items | 2 | 07-31 | **Partly** - metrics reports |
| 10 | Microphone isn't realtime dictation | 2 | 08-21 | **Fixed this session** |
| 11 | Column headers formatted differently | 2 | 08-31 | **Fixed this session** |
| 12 | Attach Files/Photos to Board/Tile/Task | 3 | 07-15 | Built at task level |
| 13 | Audio/Voice To Text Input | 3 | 07-31 | Built |
| 14 | Custom Date Range in marketing event | 3 | 07-31 | Built, one variant missing |
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
  restricts un-archiving to super admins; the UI honours it.
- **2. `1a06471a`** search deep-link: `components/search/global-search.tsx:97` pushes
  `?task=<id>` and `components/board/board-view.tsx:176` opens that task on arrival. The ⌘K
  palette does the same at `command-palette.tsx:158`.
- **3. `6e25320d`** cancel status: `scripts/069_task_cancel_archive_super_admin.sql`. Moving a task
  into a cancelled-linked column archives it in the same transaction, and only a super admin can
  move it back out. Nothing is ever deleted.
- **4. `955ff4f7`** Project IDs: migration `090` plus `components/project-ids/project-ids-view.tsx`.
  `YYMMNNNN` format computed in America/Chicago, claimant taken from the login rather than a
  dropdown, claimed numbers never reissued.
- **5. `fe66cd47`** CRM Phase II: `app/crm/` plus 8 components. **`app_modules.crm` is
  `enabled = true` on production and `crm_clients` holds real rows**, so it is live, not pending.
  CLAUDE.md still describes `103` as dev-only; that note is stale (prod's ledger is at 108).
- **6. `145ff6fd`** who entered it: "Created by X on DATE" at `task-detail-modal.tsx:935`, and on
  board cards at `board-management.tsx:689`.
- **7. `b0d18f64`** activity timeline: an Activity tab on the task modal reading `task_activity`,
  written by `lib/task-activity.ts` on rename, description, priority, visibility, due date and
  recurrence changes, each with actor and timestamp.
- **13. `7586789a`** voice to text: `VoiceInputButton` on both the task detail modal and the
  create-task dialog, desktop and mobile. See item 10 for the quality complaint against it.
- **15. `d536ccc1`** mobile list view: the list branch has a dedicated mobile layout at
  `board-view.tsx:1723` (`space-y-2 md:hidden`), separate from the desktop table.

## Gates

Everything below was run green after the three fixes, against the dev sandbox:

| Gate | Result |
|------|--------|
| `npx tsc --noEmit` | clean |
| `pnpm test` | 688 passed, 43 files (was 668/41) |
| `pnpm check:dictation` | 14/14 (new) |
| `pnpm check:board-archive` | 10/10 (new, negative-controlled) |
| `pnpm check:board-nav` | 17/17 |
| `pnpm check:column-delete` | all passed |
| `pnpm check:access-matrix` | all passed |
| `scripts/audit-mobile-deep.mjs` | board, task modal, dialogs and dark mode all 390px/390px |

No migration is involved in any of this, so there is no prod schema step to sequence before a
merge.

## For Bobby

1. **Nine of these are done** and only need moving out of To Do.
2. **Board-level attachments** (item 12) and the **ctrl+click day picker** (item 14): wanted, or
   is what shipped enough?
3. **Metrics reports** (item 9.4) is the one substantial piece of unbuilt product left in this
   list. "Many many more, talk later" needs that talk.

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
