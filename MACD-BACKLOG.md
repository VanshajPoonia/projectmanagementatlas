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

---

## In Progress (5)

### [P1] TEST - Using the "cancel" status
- id: `8be2e4b5-5f23-4fca-b502-d07ceed98dd2`
- Due: 2026-07-15 ⚠️ overdue
- Description: *(none)*
- **Current status (medium confidence):** `task_statuses` today only has 4 rows —
  `to_do`, `in_progress`, `done` (label "Completed"), `cancelled` (label "Cancelled"). There is no
  status literally keyed `cancel` right now. This task's title likely refers to the *"New 'Cancel'
  status" bug* below (re-statusing a task to a newly created status didn't work) — that root cause
  (columns not reliably resolving to a real `task_statuses` row) was addressed by migration `063`
  (`columns.status_key` FK, applied to both dev and prod), so this may already be resolved. Needs a
  live re-test of "create a custom status, apply it to a task" to confirm.

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
- **Current status (medium-high confidence): likely already resolved.** The app was rebuilt on an
  `AppShell` component (`components/shell/app-shell.tsx`) with a persistent sidebar + top bar wrapping
  every admin/dashboard view, including individual board pages — this is exactly the "lose the nav
  menu inside a tile" problem this task describes. Needs a quick visual re-check inside an open board,
  but the architecture that caused the original complaint (board view without the shell) no longer
  appears to be how board pages render.

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
- **Current status (high confidence): already resolved.** `components/search/global-search.tsx`
  builds a link of the form `/{admin|dashboard}/board/{board_id}?task={task_id}`, and
  `components/board/board-view.tsx` (line ~82-85) explicitly reads that `?task=` param on load and
  opens the task's detail modal — this is deep-link support built specifically for this. Worth a quick
  click-through to confirm, but the code path clearly does what this task is asking for.

### [P1] Reports: The "tag" filter isn't working
- id: `807322ef-ed0d-411e-b880-83b7e0e85002`
- Due: 2026-07-17 ⚠️ overdue
- Description: *(none)*
- **Current status (low confidence — unverified):** `components/reports/reports-view.tsx` has tag
  filter logic (`task.task_tags?.some(tt => filterTags.includes(tt.tag.id))`) that looks structurally
  correct on inspection. Whether the originally reported bug is actually fixed, or whether this logic
  has a subtler issue (e.g. the report's own task query not embedding `task_tags` for every row, a
  stale `filterTags` state, tags not syncing after being added), is **not verified** — needs a live
  test: tag a task, open Reports, filter by that tag, confirm it appears/disappears correctly.

### [P1] What happens when a new status is created and who has permission
- id: `988e01af-7600-46e3-ab03-0a13d2b6c873`
- Due: 2026-07-31
- Description:
  > (1) Only super admins have permission to create statuses.
  >
  > (2) I created the status of "cancel" and then did a test in the board and it would not let me
  > re-status the task using that status.
- **Current status:** Part (1) — per `CLAUDE.md`, status management is already admin-managed
  (`components/admin/status-management.tsx`), though whether it's restricted to `super_admin`
  specifically vs. any `admin` is not confirmed here — worth checking against what Bobby actually
  wants (the task says "only super admins", current gating may be broader, at plain `admin` level).
  Part (2) is likely the same root cause as "TEST - Using the 'cancel' status" above (medium
  confidence, likely resolved by migration `063`) — needs the same live re-test.

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
  - **Current status (high confidence): NOT built.** A `cancelled` status key does exist
    (`task_statuses`, label "Cancelled"), and boards already support archive/restore
    (`boards.archived_at`/`archived_by`, admin-only). But **the automatic "cancel a task → auto-archive
    it" behavior described here does not exist** — `CLAUDE.md`'s own roadmap (Phase 4) lists
    "overdue → notify owner; all subtasks done → complete parent; recurring task spawn" as the only
    three planned automations, on Vercel Cron, and explicitly says none are built yet. This task is
    asking for a fourth automation that isn't on that list at all. Also note: today, restoring an
    archived board is available to any `admin` who can see the archived-boards section, not
    restricted to `super_admin` only as this task requests — that's a real gap from what's asked here.

### [P2] Comments on Tiles/Boards
- id: `a6fe1b3a-0c8e-4b62-b1e1-dc0ae1d22094`
- Due: 2026-07-17 ⚠️ overdue
- Description:
  > When I made comments on a board and submitted them they don't appear after refreshing. For
  > example, I will copy and paste this msg and enter it into comments on this task. Also, when
  > first entering the task a person should be able to leave a comment, other than just this
  > description, when first order entry occurs.
- **Current status (low confidence — unverified):** comments exist and are wired into
  `task-detail-modal.tsx` and `create-task-dialog.tsx` (a `task_comments` table, and
  `create-task-dialog.tsx` already supports an "initial comment" at task-creation time, which covers
  the second half of this request). The **specific bug** — comments not appearing after a refresh —
  is not verified either way; needs a live test (add a comment, hard-refresh the page, confirm it's
  still there).

### [P2] Activity Timeline (feature)
- id: `b0d18f64-21c9-434e-a0bc-0d97a738a599`
- Due: 2026-07-31
- Description:
  > On every task the ability to see literally everything that has gone on with the task. Who did
  > what. When. Time and Date Stamp. New status vs. old status. Etc.
- **Current status (medium-high confidence): likely already resolved.** An activity log already
  exists (`task_activity` table, `lib/task-activity.ts`, used across the board/task components to log
  actions like assignment changes). Whether it captures *every* kind of change this task wants
  (explicit old-status → new-status transitions, not just "status changed") isn't confirmed — worth a
  quick check of what `logTaskActivity` calls currently exist versus what this task lists.

### [P2] Who entered the task or board
- id: `145ff6fd-96ac-4ed5-8dcd-5725e197426f`
- Due: — (no due date)
- Description:
  > Would be nice to have an area on the board screen and at the task level to show who created the
  > board and/or the task.
- **Current status: partially resolved, and worth a flag.** Task level: `task-detail-modal.tsx`
  already shows "Created by {creator}". Board level: `components/board/board-view.tsx` (the page for
  a single open board) also still shows "Created by {creator}". **However**, the *list-of-boards*
  pages (`board-management.tsx` for admins, the "Project Boards" tab in `user-dashboard.tsx`) were
  changed on 2026-07-24 (same day as this snapshot, a separate request from Vanshaj) from "Created
  {date} by {user}" to "Last edited {date} by {user}" — so on those two specific list pages, the
  *creator* is no longer shown by label (an unedited board still shows its creator's name today,
  since "last edited" defaults to the creator until someone else edits it, but the *label* now says
  "last edited," not "created"). If Bobby's ask here is specifically about the boards *list* pages
  showing who created it, that information technically regressed on 2026-07-24 in favor of a
  different, explicitly requested feature — worth clarifying with him whether both matter enough to
  show side-by-side.

### [P2] New Status, "cancel" then becomes archived
- id: `a3bfb2dc-d4a8-4902-b534-422f579d9150`
- Due: 2026-07-31
- Description:
  > Rather than deleting a task the new status is "cancel" — when someone puts a task in cancel it
  > automatically moves to archive.
  >
  > Archive vs. Complete are two different statuses and we need the ability to report on both in the
  > reports page.
- **Current status:** duplicate/extension of "New 'Cancel' status and how it will behave" above —
  same **not built** automation. The "report on both archive and complete" part is a separate,
  smaller ask: Reports (`reports-view.tsx`) would need to be checked for whether it currently
  distinguishes `cancelled` from `done` at all in its filters/exports (not checked this session).

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
- **Current status:** the "archived boards should be visually smaller / list-style, not big tiles"
  part is **already true today** — `board-management.tsx` renders archived boards in a compact
  collapsed row (title + restore button), separately from the large tile grid used for active boards.
  The **"double entry on restore" bug is not verified** — reading `handleArchiveBoard`/
  `handleRestoreBoard` in `board-management.tsx`, the local state updates look idempotent (filter-then-prepend
  on both sides), so if a duplication bug exists it's more likely server-side or a race condition, not
  an obvious client-state bug — needs a live repro (archive a board, restore it, check for a second row
  anywhere, including `task_activity`/any board-level activity log).

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
- **Current status — this is really 5 sub-items, mixed:**
  1. User management: **done** — a dedicated Super Admin page exists
     (`app/admin/super-admin`, `super_admin`-only) with Users management.
  2. Status mgmt in the Super Admin module specifically: status management exists
     (`components/admin/status-management.tsx`) but is not confirmed to live under the Super Admin
     surface specifically vs. the regular admin dashboard — worth checking placement.
  3. Entity/company management: **done** — the Super Admin page also has Companies management
     (SRG/AGC are rows in a `companies` table, not a hardcoded enum), matching this request almost
     exactly.
  4. Metrics reports (entry→close time, per-status progression, personnel reports): **not built** —
     `reports-view.tsx` has filters/exports but no time-in-status or cycle-time metrics were found.
  5. Prevent board deletion entirely, restore restricted to `super_admin` only: boards already can't
     be hard-deleted from the admin UI (archive is the only destructive-looking action exposed) —
     but restoring an archived board today does **not** appear to be `super_admin`-gated (any `admin`
     with the archived-boards section visible can restore), which doesn't match "only super admin can
     undo an archive." Real gap.

### [P3] Ability to Add a Tile/Board in List View, not just tile view.
- id: `a4198f83-bcef-478e-9cb4-6e6c2681c753`
- Due: 2026-07-15 ⚠️ overdue
- Description: *(none)*
- **Current status (medium-high confidence): NOT built.** Tasks already support both kanban and list
  view, but no toggle or list-view rendering was found for the *boards* grid itself
  (`board-management.tsx`/`user-dashboard.tsx` both only render boards as a tile grid). This looks
  like a genuinely unstarted, separate piece of work from the tasks list view.

### [P3] How archived boards behave after archived.
- id: `ab5cd104-5a92-46c5-84b5-8523e66a1543`
- Due: 2026-08-07
- Description:
  > When a board is archived, it still shows up on the overview screen and in searches.
- **Current status (medium-high confidence): likely already resolved.** Both the boards-list queries
  (`app/admin/page.tsx`, `app/dashboard/page.tsx`) filter `archived_at IS NULL` for the main grid, and
  global search's task query filters out tasks whose board is archived
  (`!task.column.board.archived_at`). The specific complaint ("still shows up on overview and in
  search") matches exactly what these filters are meant to prevent — this was likely fixed at some
  point after the complaint was filed. Worth a quick re-check with an actually-archived board to
  confirm, since "the filter exists in the code" isn't the same as "it was already there when this was
  reported."

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
- **Current status (high confidence): already resolved.** `admin`/`super_admin` roles exist on
  `profiles.role`, both Bobby and Kayla currently hold `super_admin` (intentionally, more than one
  person can), and a dedicated Super Admin page manages Users (`app/admin/super-admin`). "Delete
  users" specifically wasn't independently confirmed to exist as a button/action (vs. just role
  management) — worth a quick check, but the core of this request (an admin/super-admin tier that
  manages users and permissions) is built.
