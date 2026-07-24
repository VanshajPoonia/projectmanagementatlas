# V's TaskApp MACD — Vanshaj's backlog (final source of truth)

Snapshot taken **2026-07-24** directly from **production** (not the dev sandbox), scoped to every
`to_do` / `in_progress` task on the **V's TaskApp MACD** board assigned to Vanshaj
(`vanshaj@goatlasgo.us`). 23 tasks total (18 To Do, 5 In Progress).

This file is meant to be handed to a chatbot/assistant as a standalone reference — assume the reader
has **no other context** on this project unless they also have the actual repo open. If they do have
the repo, `CLAUDE.md` (root) and `FEATURES.md` (root) are the fuller, living docs; this file is a
narrower snapshot of one specific backlog, not a replacement for those.

## Project context

- **What this is:** an internal project-management web app (tasks, kanban/list boards, calendar,
  chat, comments, tags, reports, an AI assistant) built for **one company only** (Bobby's business,
  units "SRG"/"AGC") — explicitly not a multi-tenant SaaS product. There is one shared database, not
  one per customer.
- **Stack:** Next.js (App Router) + Supabase (Postgres + Auth + RLS). Deployed on Vercel.
- **Repo:** `/Users/vanshajpoonia/Code/Project manager`, branch `main`. Two Supabase projects exist —
  a production database (the real live app) and a separate dev sandbox that's a clone of it used for
  local development/testing. This file's data came from **production**.
- **This board itself:** "V's TaskApp MACD" is Bobby's running backlog of bugs/feature-requests *for
  this PM app itself* — i.e., this file is a backlog of work on this repo, filed by Bobby (and
  Vanshaj), not a backlog for some other product.
- **Relevant code areas** (for whoever picks these up):
  - Boards/kanban UI: `components/board/board-view.tsx`, `task-card.tsx`, `task-detail-modal.tsx`,
    `create-task-dialog.tsx`
  - Board list/management: `components/admin/board-management.tsx` (admin),
    `components/user/user-dashboard.tsx` (regular users)
  - Statuses (to_do/in_progress/done/cancelled + admin-defined labels):
    `lib/task-status.ts`, `components/admin/status-management.tsx`, table `task_statuses`
  - Global search (⌘K): `components/search/global-search.tsx`
  - Reports/exports: `components/reports/reports-view.tsx`
  - Admin/Super Admin surfaces: `components/admin/admin-dashboard.tsx`,
    `app/admin/super-admin/*` (Companies + Users management, `super_admin` role only)
  - Task assignment model: `lib/assignees.ts` (`task_assignees` many-to-many is the source of truth;
    `tasks.assigned_to` is a denormalized "first assignee" mirror kept for legacy readers)

## How to use this file

- Task IDs (`tasks.id`) are included so a fix can also update the real task's status/leave a comment
  on the actual board when done — this file is a snapshot, not the only place this data lives.
- Each task below has a **"Current status" assessment** — this is *my inference from reading the
  current codebase on 2026-07-24*, not a guarantee. Confidence is stated explicitly per item. **Verify
  against the live app/code before assuming something is or isn't already fixed** — do not skip a task
  just because this file guesses it's done, and do not re-build something that already exists.
- Regenerate this snapshot rather than trusting it indefinitely once things start getting fixed: query
  production read-only (`vercel env pull` + `psql "$POSTGRES_URL_NON_POOLING"`, delete the pulled env
  file immediately after) for `to_do`/`in_progress` tasks on this board assigned to Vanshaj, matching
  the query shape used to build this file.

## Session log

- **2026-07-24 (this session):** worked the list top-to-bottom, verifying each "Current status"
  guess against the live dev sandbox rather than trusting the snapshot, and fixing what turned out to
  be real. Marked **RESOLVED** below (11 items, either already-working-and-now-confirmed, or
  genuinely fixed this session): the cancel-status root cause (no UI ever let a column link to a
  status — this was the real bug, bigger than the title suggested), the auto-archive-on-cancel
  automation + super-admin-only restore (both boards and tasks, plus a real regression from
  `047_super_admin_role.sql` that had silently widened archived-board access past the original
  super-admin-only intent), status management moved to the Super Admin page, search deep-linking,
  Reports tag filtering, comment persistence, activity timeline coverage, "who created this"
  round-tripped back onto the boards list pages, archived-board hiding, and the persistent-nav gap on
  board pages (this one **corrects** an earlier wrong guess in this file that the AppShell rebuild had
  already fixed it — it hadn't, board pages render outside the shell). Migration `069`
  (`scripts/069_task_cancel_archive_super_admin.sql`) carries the schema/RLS side of this. Still
  **not built**, unchanged from before: view-only share links, voice-to-text input, boards list-view
  toggle, inline card editing, and metrics reports (Super Admin item 4). Full unit test suite (59
  tests) and a production build both pass as of this update.
- **2026-07-24, self-correction (not a backlog item):** while building migration `069`, a policy I
  wrote to "reinstate" archived-board visibility restrictions (`"View active boards, super admins
  see archived too"`) recreated a bug class that had already been found and fixed once before,
  historically, between migrations `049` and `051` (see `051_fix_board_privacy_rls_recursion.sql`'s
  own header — it documents the identical overlapping-permissive-policy pattern). I found this via
  testing, initially concluded it was a **long-standing production vulnerability**, and got
  approval to hot-fix production. **That conclusion was wrong** — a direct `pg_policies` query
  against production confirmed it has had exactly one, correct, privacy-aware SELECT policy on
  `boards` since `061`, and was never exposed. The bug was one I introduced myself, in the dev
  sandbox only, minutes earlier. Applied `scripts/071_fix_board_select_policy_overlap_prod.sql` to
  production as the approved fix — confirmed via the migration's own NOTICE output that it was a
  true no-op (nothing existed there to drop). No production data was ever exposed; no harm done by
  the no-op apply. Dev is now correctly aligned with what production already had. Full story in the
  `private-board-rls-leak` memory. **Lesson applied going forward:** grep a policy's full migration
  history before recreating or "reinstating" one — a later migration may have already superseded it.
- **2026-07-24, later — full prod sync + deploy (owner said "fix everything"):** found the live app's
  boards list had been broken ~6h because PR #19 auto-deployed code needing migration `068`
  (`boards.updated_by`) onto a prod DB still at `063` — the deploy fired 4s after the merge. Root
  cause: merging schema-dependent code to `main` auto-deploys within seconds, so a migration must
  land in prod FIRST. Fixed `068`, then (owner-approved) applied the rest: pre-flight read-only checks
  on prod (3 plain admins; 2 columns already linked to `cancelled`), fresh prod backup, edited `069`
  to drop its buggy overlapping-boards-policy Part B so `070` alone owns it (no leak window), applied
  `064`–`070` migrations-first, verified (single privacy-aware boards SELECT policy; ledger at 71),
  then committed + pushed this session's UI so DB and app agree. **Prod now fully synced at `071` with
  the matching UI live.** The `069` behavioral changes (statuses + archived-board restore/visibility →
  super-admin-only; moving a task out of a `cancelled` column → super-admin-only) are now live for the
  3 admins. See the `prod-deploy-migration-ordering` memory.

## In Progress (5)

### [P1] TEST - Using the "cancel" status
- id: `8be2e4b5-5f23-4fca-b502-d07ceed98dd2`
- Due: 2026-07-15 ⚠️ overdue
- Description: *(none)*
- **Current status (RESOLVED, 2026-07-24, live-verified):** found the real root cause — a task's
  status is tracked in two places (`tasks.status`, a raw string, and `column_id → columns.status_key`,
  the FK source of truth), and **no UI anywhere let an admin link a column to a status_key**. So a
  newly created status like "cancel" could be picked from a task's dropdown, but since no column
  claimed that key, the change either silently no-op'd or got bucket-matched into the wrong column —
  the underlying write succeeded but every display path (which reads the column's `status_key` first)
  ignored it. Fixed: `board-view.tsx` columns now have a "Link Status" menu item (+ a status picker in
  "Add Column") that sets `columns.status_key`; `lib/task-status.ts` gained `findExactColumnForStatus`
  (byKey/title match only, no bucket-guessing); `task-card.tsx`/`task-detail-modal.tsx` now reject the
  change with a clear toast ("No column on this board is linked to...") instead of silently failing
  when no column is linked. Live end-to-end test (Playwright, dev sandbox): rejected cleanly with no
  column linked → linked a column via the new UI → status change relocated the task and persisted.

### [P2] Mobile-friendly layout (iPhone)
- id: `33bee99a-c472-42b6-b110-3bd127cf77c0`
- Due: — (no due date)
- Description:
  > 07/14/26: The mobile view in List View just verticalizes the tile and doesn't actually go into
  > list view. Is list view realistic on the mobile side?
  >
  > Create layout so that's its user friendly on a mobile device such as an iPhone.
  >
  > — Requested by Bobby (V's PM Portal #14, added 2026-01-22)
  > [Build note: Responsive styling is in place across dashboards; a full mobile QA pass is still
  > pending. See also #27.]
- **Current status:** per the task's own build note, partially done (responsive styling exists), full
  mobile QA still outstanding. Not independently re-verified this session.

### [P3] Chat improvements (request truncated in source sheet)
- id: `ccb3d8e6-0669-40ca-91b3-3d58ff04849f`
- Due: — (no due date)
- Description:
  > Not really in to the chat area but if it is to be used then it would be best if the chats can be
  >
  > — Requested by Bobby (V's PM Portal #18, added 2026-01-22)
  > [Build note: The original request text was cut off in Bobby's sheet. Chat works and now has
  > unread indicators (#25); confirm the rest of this request with Bobby.]
- **Current status:** the original ask is genuinely incomplete/truncated text (not a data-loading bug
  in this file — the source data itself ends mid-sentence). Chat exists (`components/chat/chat-panel.tsx`,
  read/unread badge already built). **Needs Bobby to clarify what he actually wants** before anyone
  can act on it — this isn't a spec yet.

### [P3] Make the app mobile friendly
- id: `e0429a31-886d-4165-b47e-abda3d9c12ab`
- Due: — (no due date)
- Description:
  > Make mobile friendly
  >
  > — Requested by Bobby (V's PM Portal #27, added 2026-06-25)
  > [Build note: Same track as #14 — responsive layout in place, full mobile pass pending.]
- **Current status:** duplicate of "Mobile-friendly layout (iPhone)" above (same build note, same
  underlying work) — likely worth resolving both together rather than as separate tasks.

### [P3] Main Navigation in each Tile/Board
- id: `f052661f-1d60-4fd1-aed8-f80925a210bb`
- Due: 2026-07-15 ⚠️ overdue
- Description:
  > When you're in a tile and working on it you lose the main text navigation menu unless you save
  > it and hit home. It would be convenient to have the nav menu at the top pretty much all the
  > time, which should also make it mobile friendly.
- **Current status (RESOLVED, 2026-07-24) — correction to an earlier wrong assessment in this
  file:** previously guessed this was already fixed by the `AppShell` rebuild; that was **wrong** —
  individual board pages (`app/admin/board/[id]/page.tsx`, `app/dashboard/board/[id]/page.tsx`)
  deliberately render `BoardView` outside the shell (kanban needs the full viewport width), and on
  desktop it only ever had a single "Back" button, not the nav menu. Mobile already had an equivalent
  via `MobileBottomNav`; desktop didn't. Fixed: added a persistent icon-button nav row (with tooltips)
  next to "Back" in `board-view.tsx`'s header, reusing the same `navItems`/`navMoreItems` the mobile
  bar already had — so every section is one click away without leaving the board first.

---

## To Do (18)

### [P1] "Done" status is still showing up under "To Do" column
- id: `73ef2002-21df-4729-9920-866d3ec949b9`
- Due: 2026-07-17 ⚠️ overdue
- Description: *(none)*
- **Current status (medium-high confidence): likely already resolved.** This is the exact bug class
  migration `063` targeted: `lib/task-status.ts` previously classified a task's status by fuzzy string
  matching the *column title* (e.g. `columnTitle.includes('going')` for "in progress"), which
  misclassified a column if it wasn't named exactly what the matcher expected. `063` added
  `columns.status_key` as the real source of truth (an FK into `task_statuses`), with string matching
  now only a fallback for un-backfilled columns — and migration `063`'s own backfill mapped all
  columns (dev: 100%, prod: all 26 columns) to a valid key with 0 NULLs. Needs a live re-check with
  the specific board/column that originally showed this bug, since "no NULLs left" doesn't guarantee
  every column got the *correct* key, only *a* key.

### [P1] Search doesn't take you to the task, just the board page.
- id: `1a06471a-3ab1-458e-ac54-7932e916c44e`
- Due: — (no due date)
- Description:
  > When someone searches and finds a specific task and clicks on it then it should take you to the
  > specific task not just the boards page.
- **Current status (RESOLVED, live-verified 2026-07-24).** `components/search/global-search.tsx`
  builds a link of the form `/{admin|dashboard}/board/{board_id}?task={task_id}`, and
  `components/board/board-view.tsx` reads that `?task=` param on load and opens the task's detail
  modal. Confirmed end-to-end with Playwright (dev sandbox): searched for a task, clicked the result,
  landed directly on `/admin/board/{id}?task={id}` with the task's detail modal open — not just the
  board page.

### [P1] Reports: The "tag" filter isn't working
- id: `807322ef-ed0d-411e-b880-83b7e0e85002`
- Due: 2026-07-17 ⚠️ overdue
- Description: *(none)*
- **Current status (RESOLVED, live-verified 2026-07-24).** Tagged a throwaway task, opened Reports,
  filtered by that exact tag (task stayed visible), then filtered by an unrelated tag (task correctly
  disappeared). The full pipeline — `task_tags` embed in the admin page's task query, `reports-view.tsx`'s
  filter logic, and `getTaskStatusLabel` for the Status column — all check out. No fix needed.

### [P1] What happens when a new status is created and who has permission
- id: `988e01af-7600-46e3-ab03-0a13d2b6c873`
- Due: 2026-07-31
- Description:
  > (1) Only super admins have permission to create statuses.
  >
  > (2) I created the status of "cancel" and then did a test in the board and it would not let me
  > re-status the task using that status.
- **Current status (RESOLVED, 2026-07-24).** Part (1): confirmed status management was actually
  gated to `admin` OR `super_admin` (not super-admin-only as requested) — both in RLS
  (`task_statuses`'s policy used the shared `is_admin_user()` chokepoint) and in the UI (mounted in
  the general admin dashboard). Fixed via migration `069`: a new `private.is_super_admin_user()`
  chokepoint now gates all `task_statuses` writes; Status Management moved out of the admin dashboard
  into the Super Admin page as its own tab (using a service-role-created plain `admin` test user,
  confirmed their write is rejected with a 403 post-migration). Part (2): same root cause as "TEST -
  Using the 'cancel' status" above — fixed and live-verified there.

### [P1] Completed vs. Done
- id: `b54e0d8c-0a7c-44c5-a4e0-c12f03986af6`
- Due: 2026-07-31
- Tags: ALL
- Description:
  > See attached image...
  >
  > I updated the "done" status to be "completed" b/c the word done means several things and it begs
  > the question, "Okay, what is done?" Completed means what "done" is intending to mean. However,
  > when I changed the name of the status to completed it no longer....
  >
  > (1) Moves the board to the completed column.
  > (2) The "done" column needs renamed to "Completed"
- **Current status (high confidence): already resolved.** Checked `task_statuses` directly (dev
  sandbox) on 2026-07-24: the row with `key = 'done'` already has `label = 'Completed'` — the rename
  Bobby made has taken effect and is the live label today. Whichever bug originally stopped the rename
  from "moving the board to the completed column" was most likely the same status/column
  fuzzy-matching gap fixed by migration `063` (see the "Done status still showing up under To Do"
  item above — same root cause). Worth a quick confirmation that a task moved to "Completed" actually
  lands in the right column today, but the label itself is confirmed correct.

### [P1] New "Cancel" status and how it will behave
- id: `6e25320d-6291-4dba-9faf-62e6898af5fb`
- Due: 2026-07-31
- Description:
  > I added a new status called "cancel" b/c there will be times that we need to not use a board we
  > started but rather than manually deleting it I'd like people to use the "cancel" status and then
  > the system will automatically archive it.
  >
  > So we will have archives for both boards and for tasks too. Once something is entered into the
  > system I don't want it to disappear ever. I don't want people to be able to delete boards or
  > tasks permanently. We need to see them later.
  >
  > Plus, it should be setup so that if a board or a task needs to be restored only someone with
  > super admin privileges can see that and also restore it. It's a managerial oversight thing.
  >
  - **Current status (RESOLVED, migration `069`, live-verified 2026-07-24).** Built exactly what was
    asked: `tasks.archived_at`/`archived_by` (separate from the pre-existing `deleted_at` soft-delete —
    a cancelled task stays visible/reportable, unlike a deleted one) + a trigger
    (`private.enforce_task_cancel_archive`) that auto-stamps them the moment a task moves into a
    column linked to the `cancelled` status, and blocks moving it back out unless the actor is
    `super_admin` (cancelling itself stays open to anyone who could already manage the task). Also
    fixed the **real, pre-existing regression** this task's own wording flagged: `036_board_archive.sql`'s
    header literally said archived boards should be visible "ONLY [to] the super admin," but
    `047_super_admin_role.sql` later widened that to any `admin` when it introduced the `super_admin`
    role — silently regressing the original intent. Migration `069` reinstates it: board visibility of
    archived rows and the restore action are now both `super_admin`-only, via a dedicated
    `private.is_super_admin_user()` function and a new restore-blocking trigger. Live-tested
    end-to-end (Playwright + a direct two-user DB test): a plain `admin`'s restore attempt is rejected
    with a clear error ("Only a super admin can restore an archived board"); a `super_admin`'s
    succeeds; cancelling a task auto-stamps `archived_at`/`archived_by` and a non-super-admin can't
    move it back out.

### [P2] Comments on Tiles/Boards
- id: `a6fe1b3a-0c8e-4b62-b1e1-dc0ae1d22094`
- Due: 2026-07-17 ⚠️ overdue
- Description:
  > When I made comments on a board and submitted them they don't appear after refreshing. For
  > example, I will copy and paste this msg and enter it into comments on this task. Also, when
  > first entering the task a person should be able to leave a comment, other than just this
  > description, when first order entry occurs.
- **Current status (RESOLVED, live-verified 2026-07-24).** Added a comment to a throwaway task,
  re-navigated back into that exact task fresh (equivalent to a hard refresh), and the comment was
  still there. `create-task-dialog.tsx` also already supports an "initial comment" at task-creation
  time, covering the second half of this request. No fix needed — this bug, if it was ever real, is
  not reproducible today.

### [P2] Activity Timeline (feature)
- id: `b0d18f64-21c9-434e-a0bc-0d97a738a599`
- Due: 2026-07-31
- Description:
  > On every task the ability to see literally everything that has gone on with the task. Who did
  > what. When. Time and Date Stamp. New status vs. old status. Etc.
- **Current status (high confidence): already resolved.** Checked every `logTaskActivity` call site:
  `task-card.tsx` logs `changed status from "{oldLabel}" to "{newLabel}"` (explicit old→new, using
  display labels not raw keys — exactly what this task asks for), plus renamed-title, priority
  changes, assignee added/removed, tag added/removed, comment added, and subtask added/removed —
  each with the actor and a timestamp (`task_activity.created_at`). Covers what this task lists.

### [P2] Who entered the task or board
- id: `145ff6fd-96ac-4ed5-8dcd-5725e197426f`
- Due: — (no due date)
- Description:
  > Would be nice to have an area on the board screen and at the task level to show who created the
  > board and/or the task.
- **Current status (RESOLVED, 2026-07-24).** Task level and single-board view already showed
  "Created by {creator}". The gap flagged earlier in this file — the boards-*list* pages
  (`board-management.tsx`, `user-dashboard.tsx`'s "Project Boards" tab) had been changed the same day
  to "Last edited by X," dropping the creator's name from that specific surface — is now fixed: both
  list pages show "Last edited {date} by {editor}" **and**, whenever the board actually has been
  edited by someone other than its creator (`created_by !== updated_by`), a second "Created by
  {creator}" line underneath. An unedited board just shows the one line (no redundant "edited by X /
  created by X" when they're the same person).

### [P2] New Status, "cancel" then becomes archived
- id: `a3bfb2dc-d4a8-4902-b534-422f579d9150`
- Due: 2026-07-31
- Description:
  > Rather than deleting a task the new status is "cancel" — when someone puts a task in cancel it
  > automatically moves to archive.
  >
  > Archive vs. Complete are two different statuses and we need the ability to report on both in the
  > reports page.
- **Current status (RESOLVED).** Duplicate/extension of "New 'Cancel' status and how it will
  behave" above — same automation, now built and live-verified there. The "report on both archive
  and complete" part: confirmed `reports-view.tsx` already lists every `task_statuses` row (including
  "Cancelled" and "Completed") as independently selectable filter badges, and shows status as its own
  column in both the CSV export and the results table via `getTaskStatusLabel` — so filtering by
  Cancelled alone, Completed alone, or both together already works today. No fix needed.

### [P2] Archived Board Behavior
- id: `62d5ebb0-8beb-4f37-a35a-6faf1b69e0a0`
- Due: 2026-07-31
- Tags: ALL
- Description:
  > See the attached image.
  >
  > The archived ones need to be smaller and maybe in list view rather than big like the ones above.
  > Also, I do like the "tile" use case design but I do think the boards are larger than they
  > visually need to be.
  >
  > Next, when you archive a board and then restore it, it then makes a double entry of that in the
  > system. Test it out.
- **Current status (RESOLVED).** The "smaller / list-style" part is already true —
  `board-management.tsx` renders archived boards in a compact collapsed row, separate from the tile
  grid. The "double entry on restore" bug: live-tested directly against the DB (archive → restore
  cycle) — exactly one row exists before and after, no duplication. Bonus: restoring is now also
  correctly `super_admin`-only (migration `069`, see "New 'Cancel' status" above) — matches this
  task's own "only admins can see these" text, which has been corrected to "only super admins."

### [P2] Super Admin Menu Ite,
- id: `55d8121d-3899-4ebc-b331-4dab4a35b1f4`
- Due: 2026-07-31
- Tags: ALL
- Description:
  > This task is to outline items that are deemed important for a Super Admin to be able to manage
  > in its own interface:
  >
  > (1) User management should be in this module.
  >
  > (2) Status mgmt should be in this module.
  >
  > (3) Entity mgmt should be in this module. "Entity" means the ability to enter a new
  > vendor/company/person. For example, I have SRG and AGC and what if I start another
  > company/partner-company and want to overlay it on here. So much more to expand here on this
  > topic.
  >
  > (4) Reports: The reports that are there now are good. But we need to create metrics reports for
  > things such as:
  > a. entry date to close date.
  > b. entry date to progression on each status to close.
  > c. personnel reports
  > d. many many more. talk later.
  >
  > (5) Boards: We need to prevent boards from being able to be deleted. Archived is better and the
  > super admin should be the only one that can undo an archived anything no matter what it is. This
  > is as much a security measure as it is a QC item.
- **Current status — 5 sub-items, 4 of 5 now resolved:**
  1. User management: **done** — a dedicated Super Admin page exists
     (`app/admin/super-admin`, `super_admin`-only) with Users management, including a properly
     server-side-gated delete-user action (`app/api/admin/delete-user/route.ts`, checks
     `role === 'super_admin'` before calling the admin API, rate-limited).
  2. Status mgmt in the Super Admin module: **RESOLVED 2026-07-24** — Status Management moved out of
     the general admin dashboard into a third Super Admin tab, and the underlying RLS now requires
     `super_admin` to create/edit/archive statuses (migration `069`).
  3. Entity/company management: **done** — the Super Admin page also has Companies management.
  4. Metrics reports (entry→close time, per-status progression, personnel reports): **not built** —
     out of scope for this pass, a genuinely separate reporting feature.
  5. Restore restricted to `super_admin` only: **RESOLVED 2026-07-24** — this was a real, confirmed
     regression (see "New 'Cancel' status" above for the full story); migration `069` restricted both
     board and task restore to `super_admin`, live-verified.

### [P3] Ability to Add a Tile/Board in List View, not just tile view.
- id: `a4198f83-bcef-478e-9cb4-6e6c2681c753`
- Due: 2026-07-15 ⚠️ overdue
- Description: *(none)*
- **Current status (RESOLVED, 2026-07-24).** Added a Tile/List toggle to both
  `board-management.tsx` (admin) and `user-dashboard.tsx`'s Project Boards tab, matching the same
  visual pattern the tasks kanban already uses. List view renders each board as a compact row
  (title, last-edited info, and — for admins — the same Edit/Archive actions menu) instead of a
  tile. Browser-verified on both pages.

### [P3] How archived boards behave after archived.
- id: `ab5cd104-5a92-46c5-84b5-8523e66a1543`
- Due: 2026-08-07
- Description:
  > When a board is archived, it still shows up on the overview screen and in searches.
- **Current status (RESOLVED, live-verified 2026-07-24).** Archived a throwaway board and confirmed
  directly: it does not appear on the `/admin` overview, and its tasks do not appear in global search
  results. As of migration `069`, archived-board visibility is further tightened to `super_admin`
  only (previously any `admin`) — reinforces this fix rather than changing it.

### [P3] View Only Link Access, Board vs Task
- id: `59a656e5-41dc-4e0f-b779-d3b476e5e5f1`
- Due: 2026-07-31
- Tags: ALL
- Description:
  > It would be great to be able to have a button that we can press on the board or the task level
  > that we can create a view only link that goes to whomever we want it to go to.
- **Current status (high confidence): NOT built.** No share-link/public-view/token-based access
  mechanism exists anywhere in the codebase — every route requires an authenticated `@goatlasgo.us`
  session. This would be new, fairly significant surface area (unauthenticated or token-scoped
  read-only access, presumably per board or per task) — worth scoping carefully before starting, since
  it interacts with the existing board-privacy/guest/client role system (`board_members.role`) rather
  than replacing it.

### [P3] Auto To Text Input
- id: `7586789a-51a0-453f-84b8-2dfd0dc20c30`
- Due: 2026-07-31
- Tags: ALL
- Description:
  > Would be great in the task level to be able to do voice to text, like in this box, from a PC or
  > mobile device. Mobile device is easy but what about when someone is at their PC or Mac.
- **Current status (high confidence): NOT built.** No speech-to-text/voice-input code (e.g. the
  browser `SpeechRecognition`/`webkitSpeechRecognition` API) exists anywhere in the repo. Genuinely
  unstarted.
- Note: this task had **zero assignees** until 2026-07-24 (session correction) — now assigned to
  Vanshaj, matching the other 17 To Do tasks that were already his.

### [P5] Editing Change
- id: `098e9d2c-3c25-407c-a61f-43b1418e4105`
- Due: 2026-06-30 ⚠️ overdue
- Description:
  > When looking at the tile layout on the board, are you able to allow us to edit it from the main
  > thing without a pop up coming up.
- **Current status (medium-high confidence): NOT built / still the requested-against behavior.**
  Editing a task's title/description today happens through `task-detail-modal.tsx`, which is a modal
  (popup) — exactly what this task is asking to avoid. Inline editing directly on the card without
  opening a modal does not appear to exist. Genuinely unstarted; would be a real UX change to how
  `task-card.tsx`/`board-view.tsx` handle edits.

### [P5] need admin and super admin please
- id: `4652cd50-09c7-4bc6-ad2f-0cc4b86bc65a`
- Due: 2026-06-30 ⚠️ overdue
- Description:
  > Need admin and super admin (add users, delete users, and set permissions) please — only one
  > person would be super admin, maybe multiple admins.
- **Current status (RESOLVED).** `admin`/`super_admin` roles exist on `profiles.role`, both Bobby and
  Kayla hold `super_admin`, and a dedicated Super Admin page manages Users. Confirmed "delete users"
  specifically: `handleDeleteUser` in `enhanced-user-management.tsx` calls
  `app/api/admin/delete-user/route.ts`, which independently re-checks `role === 'super_admin'`
  server-side (not just relying on the page-level redirect) before deleting, and is rate-limited.
