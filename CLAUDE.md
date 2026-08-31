# Platform rebuild - plan & guardrails

**Consolidated 2026-07-24:** all work now happens in this one folder
(`/Users/vanshajpoonia/Code/Project manager`) on `main`. The former separate `pm-platform`
worktree (branch `platform`) was fast-forward-merged into `main` and is deprecated - do not use it.
`main` is both the live app AND where the rebuild continues.

**Single organization, not multi-tenant SaaS (owner ruling, 2026-07-24):** this product is being
built for **exactly one organization, permanently** - Bobby's company (business units SRG/AGC). It
is **not** being built as a product other companies sign up to use, and nothing below should be read
as heading toward that. Full context: `docs/product/master-product-context.md`'s reconciliation
banner and `docs/product/master-prompt.md`'s note on PROMPT 3. This file used to describe a
multi-tenant rebuild (organizations + org_members + tenant-scoped RLS); that plan is **superseded** -
see "What this branch is for" below for the corrected shape.

## ⛔ Before running ANY SQL

This folder's `.env.local` points at the **separate dev Supabase project** (ref `pxzpewaerhjwnwsbaklc`),
a full clone of production, so local dev and migrations run against the sandbox by default. Production
(ref `icyfluwgyuimhwlddjyy`) is the live database - reachable **only** through a deliberate opt-in
(`--allow-prod`, see below), never by accident.

Any migration that rewrites RLS policies or changes constraints on existing tables is destructive
until proven otherwise. Default to the **dev sandbox only** - never prod - for anything beyond a
purely additive `ADD COLUMN IF NOT EXISTS` / new table.

**Every write-path script must import and call the guard from `scripts/guard-db.mjs` before opening
any connection:** `assertDevDatabase()` (dev-only, no opt-in - for the app/dev path and the isolation
harness) or `assertMigrationTarget({ allowProd })` (the migration runner; prod requires an explicit
`--allow-prod` flag and prints a loud banner). Only additive, non-destructive migrations may ever use
`--allow-prod`; destructive migrations must not. Run
`pnpm guard` any time to see which project the current environment resolves to. This applies to
`psql`, the Supabase SQL editor, and any migration runner - if a task seems to need a migration
applied and the script doesn't yet call the guard, add the guard call first, don't skip it.

### ⚠️ The owner-override path, because the rule above has been overridden twice

Read this before writing "NOT `--allow-prod` eligible, so it stays on dev" and moving on. As of
2026-08-27 **two migrations that were not eligible are on production anyway** - `113` (trigger on
`tasks`) and `118` (trigger on `boards`) - each after the risk was stated and the owner said go.
Two exceptions in five days is not a rule being broken, it is a rule with a missing clause, and
leaving it unwritten meant the docs claimed one thing while the ledger showed another.

So, stated properly:

- **The eligibility rule is unchanged and is still the default.** Nothing destructive reaches prod
  on an agent's own judgement. `--allow-prod` on an ineligible migration is never a call to make
  without asking.
- **The owner may override it, per migration, in writing.** What that costs is a written statement
  of the specific risk *first* (what the trigger changes about writes that already happen, what
  breaks if it is wrong), a verified backup, and one file at a time with `--only=NNN`, verified
  between each. That is exactly how `113` and `118` were done.
- **An override is recorded where the migration is described**, naming it as an owner decision and
  saying it is not precedent. Both existing ones do.
- **What is still absolute:** no override for anything that drops or rewrites data, and the dev
  sandbox stays the default target for everything. `assertMigrationTarget` is not weakened - the
  flag, the banner and the one-file-at-a-time discipline are the whole mechanism.

The honest summary is that "purely additive" was too narrow a test. A trigger on an existing table
is riskier than a new column and safer than an RLS rewrite, and the rule had no middle. This is the
middle: it is allowed, it costs a stated risk and a backup, and it is never the agent's call.

## What this branch is for

`main` is a working PM tool for **one company** (Bobby's - business units SRG/AGC). This branch
matures it: real team/project-level access control, a canonical work-item domain, more views, and
the marketing/AI differentiation - **for this one org, not as a multi-tenant product.** The gap is
not features - `main` already has tasks, multi-assignee, kanban + list, calendar, comments,
attachments, tags, activity log, admin-managed statuses, reports, search, chat, bookmarks, and an AI
assistant with function-calling over live data.

The gap is three structural things.

### 1. No team- or project-level access control

`boards`, `tasks`, `tags`, `task_statuses` are one flat pool inside the org - every authenticated
user can read all of them (`USING (auth.uid() IS NOT NULL)`, or `is_board_member()` for the private-board
exception only). That's fine for full members today, but it blocks two things the roadmap already
wants: **Guests** (limited external collaborators) and a **Client portal** (FEATURES.md Phase 7) -
both need a user scoped to *specific* boards/teams, not full-company read access, without inventing
a second, parallel membership system.

Note: the `companies` table (SRG/AGC, `scripts/056_companies.sql`) is **not** a tenant and never was
- it is a business-unit label used by the marketing calendar. Do not overload it into anything more.

### 2. Statuses have two competing sources of truth

`task_statuses` (a real table) and board `columns`, reconciled by fuzzy string matching in
`lib/task-status.ts`:

```ts
if (status.includes('progress') || columnTitle.includes('going')) return 'in_progress'
```

This worked by accident because this team names columns "In Progress" / "Ongoing" - a differently
named column (e.g. "WIP") would have silently misclassified every task on it. **Fixed** (migration
`063`): `columns.status_key → task_statuses(key)` is now the source of truth; the normalizer reads
the FK first and keeps string matching only as a legacy fallback for un-backfilled columns.

### 3. Feature access is hardcoded to one person's email

**✅ DONE (schema + UI) for the marketing calendar - migration `085`, 2026-08-05.** The
`isKaylaMarketingUser`/`KAYLA_EMAIL` access-control hardcoding is gone:

- `components/user/user-dashboard.tsx` - `canUseMarketingCalendar` is now `isAdmin || <member of at
  least one calendar>` (from `lib/use-marketing-calendars.ts`), not an email compare. The
  accent-colour personalization (renamed `isKaylaAccentUser`) was deliberately left as its own
  narrow, literal-email check - cosmetic, not access control, out of scope for this fix.
- `components/marketing/marketing-calendar.tsx` - `KAYLA_EMAIL` and the owner-lookup/impersonation
  state (`kaylaId`, `checkUserId`, `checkUserName`) are gone. Marketing calendars are now
  admin-creatable, named, **multiple** instances, each with its own explicit member list
  (`marketing_calendars` + `marketing_calendar_members`, mirroring `boards`/`board_members` - not
  `teams`, which was 100% unconsumed anywhere in the repo and had the wrong RLS shape for
  per-entity access). The component takes `calendars`/`refetchCalendars` as props (fetched once by
  the parent dashboard, shared with the tab-gating check, not double-fetched) and renders a
  calendar switcher plus an admin-only "Manage Calendars" entry point
  (`components/admin/marketing-calendar-management.tsx`) for create/rename/archive and per-calendar
  member management - a checkbox list of every profile, mirroring `board-management.tsx`'s embedded
  picker (this app has no "invite a stranger" concept; every possible member already has a
  `profiles` row). Every existing row was backfilled onto one calendar named "Marketing Calendar",
  owned by and membered by Kayla - no behavior or data change for anyone on deploy. No role tiers
  on membership (every member gets full CRUD, matching what Kayla alone had before) - mirrors
  `teams`' own "don't build it speculatively" lesson. Verified: `pnpm check:marketing-calendars`
  (new dedicated cross-calendar isolation harness, 14/14 against real RLS - including that removing
  a membership row revokes access on the very next query) plus a 9/9 real-browser Playwright pass
  (a zero-access member has no Marketing nav item at all; an admin can create a calendar and grant a
  specific user access via the picker; that user then sees exactly that calendar and nothing else).
- `lib/display-text.ts` - **✅ DONE 2026-08-09.** It matched the literal filename
  `Marketing Project Management.xlsx`, so a second import under any other name would have shown its
  provenance header to every user with no way to hide it. Now matches the *shape* the importer
  writes (a leading `Source:` / `Imported from` line naming a spreadsheet), anchored to the first
  line so a description that merely mentions a file in its body is untouched. Strictly wider than
  the old constants, so no existing description can render differently. Covered by
  `lib/display-text.test.ts`, including regression guards quoting both original literals. Worth
  knowing: a scan of the dev sandbox found **zero** rows carrying either prefix across 71 task and 6
  board descriptions - this is dead code in practice, generalized rather than deleted only because
  prod data may have drifted from the clone.

**§3 is now fully closed** - the only remaining literal-email check is the cosmetic
`isKaylaAccentUser` accent colour, which is not access control.

## Plan

**Phase 0 - safety net (do first). ✅ DONE.** No tests, no CI, and 59 hand-applied SQL files with no
record of what had been applied. Built: `scripts/migrate.mjs` (+ `public.applied_migrations`, all 63
files baselined/applied) and `scripts/guard-db.mjs` (shared allowlist guard, dev-sandbox-by-default).
`scripts/check-isolation.mjs` was originally built as a **cross-tenant** isolation gate (two users in
different orgs, assert zero shared rows) - that framing is now moot under the single-org ruling
above. It is kept as-is (harmless, still passes) but is not gating anything meaningful anymore;
`scripts/check-board-roles.mjs` (below) is the harness that actually matters now.

**Phase 1 - plumbing.** In this order:
- **B. Status FK. ✅ DONE (migration `063`).** See "Statuses" above.
- **A. Teams, roles & real access control. Migrations `064`–`067`, plus `094` for teams.**
  - `teams(id, name, color, position)` + `team_members(team_id, user_id)` - no `team_role` column;
    kept simpler than first sketched (plain membership only). Add a role column later if a real
    need shows up - don't build it speculatively.
  - **✅ DONE (schema + UI) - migration `094`, 2026-08-13.** `064` created these tables and
    nothing ever wrote to them: verified against **both** dev and prod, 0 rows in each, zero call
    sites repo-wide. `094` seeds the two business units the company actually runs on -
    **Atlas General Contracting** and **Shanks Realty Group** - and puts every existing profile in
    both (owner's instruction). Deliberately **not** FK'd to `companies`: that table stays a
    marketing business-unit label per the ruling above, and the names are free to diverge.
  - Management **narrowed** from `private.is_admin_user()` (admin + super_admin) to
    `private.is_super_admin_user()`. Plain admins (Tim/Kogan/Mendy) lose a capability they held on
    paper but never had a UI for. Verified by `pnpm check:teams` (27/27), which includes an
    `admin`-tier control case proving the narrowing is real and not a blanket break.
  - UI is `components/admin/team-management.tsx`, a fourth tab on the super-admin-only
    `/admin/super-admin` page (alongside Companies/Users/Statuses). Membership is a **people ×
    teams grid**, not a per-team member picker, because a *move* is only legible when both teams
    are on screen at once. Pure logic lives in `lib/teams.ts` (+ 24 tests).
  - ⚠️ **Nothing auto-joins a new account to a team.** `094` backfilled the profiles that existed
    when it ran; a signup after that lands in no team. That is intentional (joining is a
    super-admin decision), it is pinned by a check in `pnpm check:teams`, and the UI surfaces it
    as a "not in any team" prompt. If you ever add an auto-join trigger, that prompt becomes dead
    UI - update both.
  - `board_members.role` (`member` | `guest` | `client`, default `'member'`, migration `065`) on the
    **existing** table from `049_board_privacy.sql` - no parallel membership system. Enforced
    server-side: `guest`/`client` can view a board's tasks but not create/edit/delete them
    (`private.can_manage_task` + the tasks INSERT/UPDATE/DELETE policies, `065` + `067`). Verified
    by `pnpm check:board-roles` (mirrors `check-isolation.mjs`'s throwaway-user pattern) - 9/9 checks
    pass, including a `member`-role control case proving the restriction is role-specific.
  - `067` also closed a **pre-existing** gap found while verifying `065`: the tasks INSERT policy
    never checked board privacy at all (`061` added that check to SELECT/UPDATE/DELETE only, INSERT
    was missed) - fixed in the same migration since it's the same policy.
  - **UI wired (no `lib/permissions.ts` added)** - `board-view.tsx`/`task-card.tsx`/`task-detail-modal.tsx`
    already had inline `canEdit`/`canDelete`/`canEditDueDate` checks (explicitly commented as
    mirroring each other); threaded a new `boardRole` prop (fetched server-side in
    `app/dashboard/board/[id]/page.tsx` + `app/admin/board/[id]/page.tsx` from the caller's own
    `board_members` row) into all three instead of adding a competing abstraction. Guest/client now
    also can't see the "Add task" button. Browser-verified with Playwright against the dev server: a
    real guest-role user sees the task but its title/description/due-date inputs are `disabled`
    (same existing UI convention as the priority/status/visibility selects), the Add-task button is
    gone, zero console errors; a plain member (no `board_members` row) is fully unaffected. Test
    fixtures created and torn down via the service role, dev sandbox only.
- **C. Modules. ✅ DONE (schema + UI) - migration `066`.** `app_modules(module_key, enabled, config
  jsonb)`, a singleton (no `org_id`), seeded with every current module `enabled=true` - nothing
  changes for anyone by default. `lib/modules.ts` has the registry (`useAppModules` hook +
  `isModuleEnabled`, mirrors `lib/use-task-statuses.ts`). Wired into both `user-dashboard.tsx` and
  `admin-dashboard.tsx` - their tab lists and sidebar sections now gate on `isModuleEnabled(...)`
  (marketing stays additionally gated by the existing Kayla/admin check - untouched, that's §3/Phase
  2 territory). Browser-verified: nav renders identically to before (all seeded enabled=true).
  ⚠️ **This block used to end "Not wired: the floating `AiChatWidget` and the embedded
  `BookmarksSection` rail render unconditionally in all three dashboard shells". That is FALSE
  and has been since `368453f`** - both are gated by `isModuleEnabled(modules, …)` in
  `user-dashboard.tsx` and `admin-dashboard.tsx`, and `super-admin-dashboard.tsx` renders
  neither, so there is no third site to gate. The stale sentence outlived the fix by weeks and
  was mirrored by a `NOT_YET_WIRED` badge in `module-management.tsx` reading "toggle not
  consumed yet", which told a super admin that a working switch did nothing. Badge deleted
  2026-08-27. **A control labelled broken is a control nobody touches** - the same defect as one
  that really is broken, only harder to find, because nothing fails.

**Phase 2 - de-hardcode.** Remove the three items in §3 above. Members/guests/clients are added to
the one existing org directly (no "create org" step - there's nothing to create).

### ⚠️ A passing RLS harness does not mean the feature works (learned 2026-08-13, Prompt B)

`pnpm check:board-roles` was 9/9 green on migrations `065`/`067` for weeks. The guest/client
feature was nonetheless **unusable and actively self-destroying**, because everything broken was
above the database:

1. **No UI could grant the role.** `board-management.tsx` inserted `{board_id, user_id}` with no
   `role`, so every membership landed on the `'member'` DEFAULT. Guest and client were reachable
   only by hand-written SQL.
2. **Editing a board silently escalated privileges.** The member sync was a
   `delete().eq('board_id', …)` followed by a re-insert that dropped `role`. Renaming a board
   promoted its guests to full members, and `private.can_manage_task` keys off exactly that
   column - so they could immediately write. Verified by replaying the UI's own calls before
   any fix was designed.
3. **Membership edits by a non-creator reported success while changing nothing.** `061` made the
   board's creator the sole owner of the list, and PostgREST does not treat a zero-row
   DELETE/UPDATE as an error, so the DELETE no-op'd, the INSERT was refused with `42501`, and
   the code checked neither.

Fixed in `lib/board-membership.ts` (diff, never rewrite - `plan(x, x)` writes nothing) plus
`components/admin/board-member-picker.tsx`. Every membership write now asks for its rows back and
compares the count, because that is the only way to tell a refusal from a no-op. The gate is
`pnpm check:access-matrix` (70 checks as of 2026-08-20; it said 51 for a long time after the
number stopped being true - re-count rather than copy it), which covers the plan's full matrix and pins all three
regressions. **When a permission feature is verified only at the database, check that a human can
actually reach it and that unrelated writes cannot undo it.**

Two more defects fell out of building that harness:

- **Private boards leaked their column structure** (fixed by `099`). `061` applied board privacy
  to tasks/comments/attachments/links/tags but never to `columns`, which still carried `001`'s
  `USING (auth.uid() IS NOT NULL)`. Any signed-in user could read the column titles and order of
  any private board by id. Contents stayed hidden, so this leaked the *shape* of private work.
  Write policies on `columns` are deliberately unchanged - `status-management.tsx` renames
  columns across every board at once and must still reach private ones.
- **The board actions menu never closed** (fixed in `board-management.tsx`). `handleEditBoard`
  called `e.preventDefault()`, which Radix reads as "keep the menu open", so after saving, the
  modal menu was still mounted and `body { pointer-events: none }` was left in place - the whole
  page was unclickable until the user dismissed it by hand. The preventDefault looked necessary
  because the cards wrap their content in a `<Link>`, but `DropdownMenuContent` is portaled out
  of that subtree, so a menu-item click never reaches the link. No other component in the repo
  has this pattern; it was checked.

**Phase 3 - the risk story.** Where it stops being a task tracker and starts answering
*"what is at risk?"*:
- Subtasks - `tasks.parent_task_id` (nullable, self-referencing). Board queries need
  `WHERE parent_task_id IS NULL` or subtasks render as loose cards.
- Dependencies + blockers - `task_dependencies(blocker_id, blocked_id)`, `tasks.blocked_reason`,
  `blocked_since`. Log transitions to the existing `task_activity`.
- In-app notification inbox - `notifications(user_id, type, entity, read_at)`. Split
  *action required* / *FYI* from day one. Email prefs already exist; a durable inbox does not.
- "What should I work on next" - **zero schema**, all inputs are already in `myTasks`.
- Milestones - `milestones(board_id, title, due_date, status)`.
- ~~`tasks.estimate_hours`~~ - **shipped as `tasks.estimate_value` (migration `123`, dev only)**,
  deliberately renamed: the unit lives on `board_agile_settings.estimate_unit`, so a board
  counting story points is not held in a column whose name says hours. See the Prompt G section.
- Project health - `boards.health` + `health_note`, **manual first**. An auto-status that is wrong
  destroys trust in every other number shown.

**Phase 4 - earn it.** Workload, saved views (`reports-view.tsx` already holds ~10 filter states in
`useState`), custom fields, the **client portal UX** built on top of Phase 1-A's `board_members.role`
(schema already lands in Phase 1-A; this phase is the client-facing screens/flows), and three
hardcoded automations on Vercel Cron - overdue → notify owner; all subtasks done → complete parent;
recurring task spawn (the `is_recurring` columns from `scripts/025_*.sql` are currently unused).

## Explicitly not building

Multi-tenant/organization-switching machinery (see the single-org ruling above), docs/wiki +
collaborative editing, Gantt/timeline, offline support, a generic automation rules engine, and more
than two integrations (Google Calendar one-way export, Slack notifications). Each is a product
rather than a feature, and none serves the goal of reducing time spent *managing* work.

## People (verified against **production** 2026-08-09 - re-query `profiles` for current truth)

`bobby@goatlasgo.us` (Bobby Shanks) and `kayla@goatlasgo.us` (Kayla Viehland) both hold platform role
`super_admin`, deliberately - this is not "one vendor account," don't consolidate to one. Kayla's
separate hardcoded marketing-module gating (§3 above) is unrelated to her platform role and unaffected
by any role work in Phase 1.

Three more hold `admin`: `kogan@goatlasgo.us`, `mendy.atlasgc@gmail.com`, `timkennon2@gmail.com`.
**`private.is_admin_user()` is true for `admin` AND `super_admin`** (migration `047`), so all five
satisfy every `is_admin_user()` clause in every policy.

⚠️ **But only policies that call `is_admin_user()`.** Several older policies inline
`profiles.role = 'admin'` instead, and read literally that **excludes super_admin - i.e. Bobby and
Kayla**. `marketing_channels`' UPDATE/DELETE (`054`, narrowed by `055`) is the known case; it made
column reordering silently fail for exactly the two people who use the marketing calendar until
`088` routed that write through an RPC. When gating a feature on "admins can do this", grep the
policy itself - `role = 'admin'` and `is_admin_user()` are different sets of people.

### ⚠️ Check roles against the existing policy before gating work on a migration

Learned the expensive way, 2026-08-09. A bug was reported as "Kayla marks work done, it stays red on
Bobby's dashboard." It was diagnosed as an RLS problem and sequenced behind a policy migration
(`087`) that then got blocked - costing days of the owner waiting.

The migration was never needed for that bug. `marketing_calendar_checks`' SELECT policy already read
`user_id = auth.uid() OR private.is_admin_user()`, and Bobby is `super_admin` - **the database had
been returning Kayla's rows the whole time.** The deployed *client* was discarding them with an
explicit `.eq('user_id', userId)` on its own query. A one-line client fix resolved it.

The general trap: an RLS policy is only the ceiling. When a user "can't see" something, check what
the client actually asks for before concluding the policy is wrong - and check whether the reporting
user's role already satisfies the policy as written. A migration blocked behind a safety gate is a
very expensive place to discover the migration was unnecessary.

Corollary, specific to this repo: because all five people above are admins, *any* fix that only needs
`is_admin_user()` to be true ships as a code change alone. Policy widening is only required the day a
**non-admin** is given access to something - which for the marketing calendar has not happened yet
(as of 2026-08-09 the sole calendar has exactly one member, Kayla).

## The research pack in `plan/` (added by the owner, 2026-08-13)

`plan/ATLAS_01_RESEARCH_AUDIT_AND_DESIGN_GUIDE.md` (competitor audit + design guide; **§13 is the
build priority, §10 the concrete requirements**), `plan/ATLAS_02_CLAUDE_FINAL_BUILD_PROMPTS_AUDITED.md`
(Prompts A–M), and `plan/ATLAS_MASTER_RESEARCH_AND_BUILD_PACK.md` (the two concatenated). These
**refine** `docs/product/master-prompt.md`, they do not replace it: Prompt A ≈ finishing PROMPT 2,
Prompt B ≈ later PROMPT 3 slices, Prompt C ≈ PROMPT 4 / FEATURES Phase 1.

ATLAS_02's own header says to run **one prompt per session** and to audit before implementing - don't
try to execute the whole pack at once. Plane/OpenProject/Vikunja/Leantime/Taiga are **design
references only**; no code is copied from them, and ATLAS_01 §4 lists the specific claims about them
that turned out to be wrong (OpenProject has no critical path; Taiga has no time tracking; Vikunja
lists no native Calendar view). Foundation slice 1 (capability model, ⌘K rebuild, recents, density,
`/my-work`) shipped 2026-08-13 - see FEATURES.md's changelog for exactly what and what was
deliberately left out.

## Conventions

- Migrations: numbered SQL in `scripts/`, continuing from `129`. **Dev is at `128`; prod has 1-124 and 126-128,
  with `125` deliberately never applied, as of 2026-08-30.** Prod reports
  `pending: 0   held: 1` - see "Holding a migration back" below, and the Prompt G section for
  why this particular one. As always, run
  `pnpm migrate:status` rather than trusting this sentence - it has gone stale three times. Wrap in `BEGIN; … COMMIT;`,
  use `IF NOT EXISTS`, and write the intent as a comment header - match the style of
  `047`, `049`, `056`. **Migration state drifts between dev and prod - always run
  `pnpm migrate:status` rather than trusting a number written down anywhere, including here.**
  As of 2026-08-19, verified by running the runner against both: **dev and prod were BOTH fully
  applied at `107` - all 107 files, zero pending on either.** `105`–`107` went to prod with
  `--only=105,106,107 --allow-prod`, which is what the runner's `--only` flag exists for.
  **Verified again 2026-08-23 with the runner against BOTH: dev and prod are both at `115`,
  0 pending on each.** `112`-`115` (Prompt C) were applied to prod on 2026-08-23 - see that
  section below.
  ⚠️ The line above this one used to say prod stopped at `108` and that `109` was a
  deliberate gap. **Both halves are now false** - `109`, `110` and `111` are all on prod. It
  is the third time this block has gone stale, which is exactly why the rule is to run
  `pnpm migrate:status` rather than read any sentence here.
  ⚠️ **The per-migration notes below saying a given number is "dev-only" are HISTORICAL** -
  each was true the day it was written and most have since been applied. `087`, `096`–`102`
  and `104` are all on prod now. The ledger is the only truth; those notes are kept for the
  *reasoning* they record about what each migration does, not as a statement of where it
  lives. This block has been wrong twice before (it said prod was at `095` when it was at
  `101`, then at `101` when it was at `104`), which is why the rule above is to run
  `pnpm migrate:status` rather than read this sentence.
- ⚠️ **An aborted request is not a failure, and logging it as one is not merely untidy**
  (`lib/request-aborted.ts`, 2026-08-30). supabase-js aborts its in-flight fetches when a
  component unmounts or the page navigates, and PostgREST surfaces that as an ordinary error
  object, so `task-detail-modal.tsx` and `subtask-list.tsx` printed
  `[v0] Failed to load comments: AbortError` every time somebody closed a work item. Nothing had
  failed. The cost is that a genuine load failure and a normal unmount are then indistinguishable
  in the console, so every appearance has to be triaged as a real defect - and it made
  `pnpm check:agile-ui`'s zero-console-errors assertion fail for a non-reason. The helper is
  deliberately narrow and its tests pin the important half: it does NOT swallow an RLS refusal
  (`42501`), a constraint violation (`23505`), a `Failed to fetch`, a **`TimeoutError`** (that
  request really did not complete, and the viewer is looking at stale data), or a message that
  merely mentions aborting. **Any new load path that logs its own errors owes the same check.**
- ⚠️ **`next dev` compiles a route on first request, and that will fake a product regression in
  a browser harness.** Editing `help-dialog.tsx` (which the board imports) made the first task
  modal open blow `check-agile-ui`'s 8s field budget, and it reported "agile is on but there is
  no estimate field" - a regression that had not happened. The fix is a **warm-up navigation
  that asserts nothing**, before any check with a timeout on it, so the compiler is out of the
  measurement; the sign-in loop in the same file already existed for the same reason one route
  earlier. Re-running until green would have hidden both this and the abort bug above.
- **Holding a migration back is a first-class state, not an empty slot in the queue**
  (`scripts/held-migrations.mjs`, 2026-08-30). Before it, a file that was deliberately not
  applied looked exactly like one nobody had got round to, and two things followed. The
  status command reported `pending: 1` on prod forever, so the day a *genuine* second file
  went unapplied it would read `pending: 2` and be dismissed as "yeah, that's the known one" -
  the same "a control labelled broken is a control nobody touches" defect, aimed at the safety
  mechanism itself. And worse: **a bare `pnpm migrate --allow-prod` run to ship a LATER
  migration applied the held one as a side effect.** The only thing between production and a
  held-back trigger was somebody remembering to type `--only=NNN`, which is a rule enforced by
  memory, which is not a rule.
  - A held file is excluded from `pending`, reported separately with its recorded reason and
    release path in **every** mode, and refused by `--apply`, `--only` and `--baseline` alike
    unless its number is named with **`--release-hold=NNN`**. Baseline refuses it too, because
    recording a file as applied without running it is strictly worse than applying it - the
    ledger would then claim prod has a trigger it does not have.
  - Releasing a hold is still the owner decision described above; the flag does not replace
    that, it just means the decision cannot happen by accident. Deleting an entry from the
    manifest **is** the same decision as applying the file - it is not tidying.
  - Gate: `tests/held-migrations.test.ts` (9), confirmed to drop 3 checks when the exclusion
    rule is removed rather than trusted to be meaningful. It also asserts each held file's own
    SQL header still says it is not `--allow-prod` eligible, so the manifest and the migration
    cannot quietly disagree.
- ⚠️ **Both `db.<ref>.supabase.co` hosts are IPv6-ONLY, and this Mac has no IPv6 route** - only
  link-local addresses on its VPN `utun` interfaces. macOS `getaddrinfo` drops an AAAA it cannot
  route, so libpq reports **`could not translate host name ... nodename nor servname provided`**,
  which reads like a DNS failure and is not one: `dig` returns the AAAA fine. On 2026-08-20 that
  was misdiagnosed as "the pooler is disabled on the dev project, so no `psql` path exists" and
  the ledger was read over REST instead. **That was wrong** - the pooler was never disabled, the
  wrong region had been tried. Supavisor answers per region and returns
  `(ENOTFOUND) tenant/user postgres.<ref> not found` for a project hosted elsewhere, which is
  indistinguishable from "off" unless you try the right one.
  - **Dev lives in `ap-southeast-2`, prod in `us-east-1`** (guess the region from the AAAA
    prefix: dev `2406:da1c` = ap-southeast-2, prod `2600:1f18` = us-east-1). `.env.local`'s
    `POSTGRES_URL_NON_POOLING` now points at
    `postgres.pxzpewaerhjwnwsbaklc@aws-0-ap-southeast-2.pooler.supabase.com:5432`, which is
    IPv4-reachable, and `pnpm migrate:status` / `pnpm migrate` work again.
    `.env.production.local` already used `aws-1-us-east-1.pooler.supabase.com:5432`, so prod
    migrations were never actually blocked from here.
  - **Port 5432 is session mode and is the one to use.** Port 6543 is transaction mode and will
    break a migration: these files own their own `BEGIN; ... COMMIT;`, which transaction pooling
    does not hold across statements.
  - **The guard already understands the pooler shape** - `extractRefs` matches `postgres.<ref>`
    in the username as well as `db.<ref>.supabase.co` in the host, so switching to a pooler URL
    keeps the dev/prod allowlist fully intact. Verified: `pnpm guard` still resolves the dev
    sandbox. **If you ever add a third connection shape, extend `extractRefs` first** - a ref it
    cannot see is a ref the allowlist cannot police, and `refs.length === 0` aborts but a
    *partial* match would not.
- **`103` (CRM) is dev-only and purely additive** - seven new tables, one `app_modules` row,
  no existing table, policy, grant or row touched. That makes it `--allow-prod` eligible on
  this repo's own rule, unlike `098`–`102`. The module seeds **`enabled = false`**, so
  applying it to prod changes nothing anyone can see until a super admin switches CRM on.
  Gate: `pnpm check:crm` (26 checks). Rollback `scripts/rollback/103_revert.sql` **destroys
  every CRM record including the status history**, which is the one thing that cannot be
  reconstructed - dump it first if the intent is "roll back the code, keep the data".
  - The design point worth keeping: **`crm_order_status_history` is written only by a trigger**
    and `authenticated` holds `SELECT` on it and nothing else. An order's status cannot change
    without closing the open interval and opening the next one in the same transaction, so the
    table and `crm_orders.status` cannot disagree however the row was moved. Every cycle-time
    and bottleneck number is built on that guarantee, and the harness asserts a member *and*
    an admin are both refused when they try to forge, backdate or delete a row.
  - **The disposition rides in the same UPDATE as the status**, via two write-only carrier
    columns (`status_change_reason` / `status_change_note`) that the trigger copies onto the
    new interval and then blanks. They are always NULL at rest **only since `104`** - see
    below. The alternative - a second write afterwards - needs the history table to be
    application-writable, which is exactly what the module refuses.
  - ⚠️ **Three triggers, not one, because the timings differ.** `BEFORE INSERT` may still edit
    `NEW` but the row does not exist yet, so writing history there fails the `order_id`
    foreign key; `AFTER INSERT` can write it; `BEFORE UPDATE` does both in one pass. The
    migration's own post-conditions caught this on the first run.
- ⚠️ **`104` fixes three defects in `103` and is the one to apply to prod next.** It replaces
  only objects `103` itself created and touches no other table, policy or grant, so it is
  `--allow-prod` eligible. Gate: `pnpm check:crm`, now 33 checks. Reproduce the worst of the
  three with `node --env-file=.env.local scripts/probe-carriers.mjs`.
  - ⚠️ **The audit trail could assert a disposition nobody supplied - the one thing the whole
    module is built to prevent.** `103` registered the transition trigger as
    `BEFORE UPDATE **OF status**`, so an UPDATE that set only the `status_change_*` carriers
    never fired it and the values were simply stored; and when `status` *was* named but
    unchanged, the function took an early `RETURN NEW` that skipped blanking them. Either way
    "always NULL at rest" was false, and the **next** real transition read the stale pair and
    stamped it onto the interval it opened. Observed on dev: an order moved to Won came back
    carrying reason "Waiting on documentation" and note "no-op note", neither supplied by the
    caller. The lesson generalises past this module: **a trigger with an `OF column` clause
    cannot police the columns it does not fire on**, and any early return from a trigger that
    consumes write-only carrier columns must still clear them.
  - **`requires_reason` was UI-deep.** `crm_statuses.requires_reason` was honoured by the
    Status Control screen and by nothing underneath it, so a cancel written by an import or
    psql recorded no reason. `104` enforces it in the trigger. Note the INSERT path is
    deliberately *not* gated, so historical closed/cancelled work can still be imported.
  - **The reference minters raced, and `090`'s pattern is why.** `claim_crm_client_ref` /
    `claim_crm_order_no` took `pg_advisory_xact_lock`, read `MAX(...)` and returned a string.
    **The lock dies with the RPC's transaction, and the caller's INSERT lands in a separate
    request after it** - so two intakes submitted together read the same MAX, were handed the
    same reference, and the second died on the UNIQUE constraint with a raw 23505.
    `claim_project_id` (090) is safe only because it does the INSERT *inside* the locked
    function. When that shape does not fit, use a real `SEQUENCE`, which is race-free without
    a lock; gaps from a rolled-back intake are fine, because a reference is an identifier and
    not a count.
- ⚠️ **RLS applies SELECT policies to an UPDATE, so a write policy alone does not mean the
  write lands.** Found 2026-08-19 while building `107`, and it silently invalidated a stated
  design decision. `099` recorded, deliberately, that the `columns` write policies stay
  `private.is_admin_user()` "so an admin can still write columns on a private board they
  cannot read... that sweep must still reach private boards." Postgres does not work that
  way: any `UPDATE ... WHERE` has to read the row to find it, so the SELECT policy applies
  too. `099` had just narrowed the `columns` SELECT policy with
  `column_hidden_by_board_privacy`, so from that migration on an admin who is not a member of
  a private board matched **zero rows** there and the UPDATE quietly did nothing. Measured,
  not reasoned: same admin, two boards differing only in `is_private`, the identical
  `UPDATE columns SET title=… WHERE status_key='done'` renamed one and left the other. The
  generalisation is the useful part - **when a table's SELECT policy is narrower than its
  UPDATE policy, the SELECT policy is the one that decides what an UPDATE can touch.** A
  `SECURITY DEFINER` function that writes one named column is the way around it; RLS-refused
  writes stay silent, so anything crossing that gap needs a row count.
- ⚠️ **`109` (2026-08-20) rewrites an RLS policy, so it is destructive by this repo's own
  definition and must NOT use `--allow-prod`.** Applied to **dev only** - prod's ledger was
  read on 2026-08-20 and stops at `108`, so **production still has the hole described below**,
  exactly as it did before the fix was written. Nothing in the app depends on it - `lib/capabilities.ts` already refuses `share.external` for a
  guest/client - so leaving it unapplied breaks no screen; it just leaves the boundary at the
  UI, which is exactly the state it was written to end. Gate: `pnpm check:access-matrix`
  (70 checks, 13 of them the new share-link section; counted, not estimated).
  Rollback: `scripts/rollback/109_revert.sql`, which destroys no data - both `109` and
  its revert govern INSERT only and never touch a row.
  - **What it closes:** `074`'s `share_links` INSERT policy checks the link's creator, the
    resource's creator-or-admin, and board privacy - but never `board_members.role`. `065`
    had made guest/client read-only *after* `074` was written, so a member demoted to guest
    could still POST a `share_links` row through PostgREST and expose work they had created
    to the unauthenticated public web. The Share button was already hidden from them; the
    button was never the boundary. Measured before and after, not reasoned.
  - **The predicate is `NOT EXISTS (... board_members ... role IN ('guest','client'))`,
    inlined into both resource branches.** That is a third copy of a rule
    `private.task_restricted_by_board_role` (065) and `private.column_restricted_by_board_role`
    (067) already express. It is correct today, and it is only safe because
    `board_members`' SELECT policy (`061`) always exposes the caller's **own** row and the
    subquery reads nothing else - had it needed to see someone else's row, RLS would have
    hidden it and the `NOT EXISTS` would have silently passed. **If a fourth role is ever
    added to `board_members_role_check`, three places need updating.**
  - ⚠️ **Forward-only.** A link minted *before* someone is demoted keeps working; `109`
    governs new inserts and deliberately leaves existing rows alone. Revoking on demotion
    would need a trigger, and that is a separate decision.
- **`105`, `106`, `107` (2026-08-19) - marketing channel editing and board column ordering.**
  Gates: `pnpm check:marketing-channels` (39, was 16) and `pnpm check:board-columns` (30, new),
  plus a real-browser pass covering drag, the menu, the rename cascade and the channel dialog.
  - **`105` is purely additive** - two new `public` functions plus one `private` helper, no
    existing table, row, policy or grant touched - so it is `--allow-prod` eligible on this
    repo's own rule. It exists because `marketing_channels.label` and `is_archived` were
    columns **no screen could write**: `055` narrowed UPDATE/DELETE to `profiles.role =
    'admin'` LITERALLY and left a comment saying to keep it that way "since there's no UI for
    that yet". That literal excludes `super_admin`, i.e. **Bobby and Kayla, the only two
    people who run this calendar** - so the admin-only path it preserved had never been
    reachable by either of them. Same trap as `088`, third recorded instance of the
    guest/client lesson.
    - **Renaming a channel is two writes that must not be separable.**
      `marketing_calendar_items.channel` is TEXT with no FK, so renaming the channel alone
      orphans every event pointing at the old string - they vanish from the grid with no
      error. `rename_marketing_channel` does both in one transaction and returns how many
      events moved. `set_marketing_channel_archived` is the off switch; archiving, never
      DELETE, for exactly the same reason.
    - Who may: `private.can_manage_marketing_channels()` = admin/super_admin **or an active
      member of any marketing calendar** - deliberately the same set as
      `canUseMarketingCalendar` in `user-dashboard.tsx`. The table's own policies are
      untouched, so the direct-write path is still literal-admin-only.
  - ⚠️ **`106` creates a function but also backfills rows on an existing table**, so it is not
    "purely additive" in the sense the `--allow-prod` rule means - decide it deliberately. The
    backfill sets `columns.status_key` where it is NULL and the title already matches an
    ACTIVE status label exactly, and only when that board has no other column claiming that
    status (`idx_columns_board_status_key_unique` is one column per status per board). Every
    row it touches would have been renamed by the old title sweep anyway, so nothing changes
    what it is called. `reorder_board_columns` is `SECURITY INVOKER` for the same reason
    `102`'s RPC is: the `columns` UPDATE policy stays the authority, and plpgsql is there only
    so `GET DIAGNOSTICS` turns a refusal into a raised exception. Its staleness guard is
    `088`'s - every column on the board, exactly once.
  - **`107` is purely additive** (one function) and `--allow-prod` eligible, but read the
    bullet above first: it is `SECURITY DEFINER` precisely so a status rename can reach a
    private board's column. It writes `columns.title` and nothing else, only for rows already
    linked by `063`'s FK, gated on `private.is_admin_user()`, and **reads nothing back** - its
    return value is a count. `status-management.tsx` calls it instead of the old
    `update({title}).eq('title', oldLabel)`, which was wrong twice: it matched on the column's
    current TITLE (so a board whose "To Do" column had been renamed "Tasks" silently stopped
    tracking the status) and it skipped every private board.
- ⚠️ **A zero-row write is a refusal, and `RETURNING` is filtered by the SELECT policy on
  the NEW row.** The first half is already recorded above for `board_members`; the second
  half is what makes the obvious fix wrong in two places. `lib/rls-write.ts` (2026-08-19)
  is the one tested answer: ask for the rows back, count them, and when zero come back
  *and the write could have changed the row's own visibility*, probe whether the row is
  still readable before calling it a refusal. Setting `visibility='assigned'` while
  removing yourself from the assignees is a write that succeeds and returns nothing -
  reporting that as "not saved" sends the user to redo a change already in the database.
  Columns that are not inputs to `can_view_task` (title, priority, due date, column,
  position) need no probe.
- ⚠️ **A capability that is stricter than its policy is not "safe by default".** Found
  auditing Prompt B (2026-08-19). `lib/capabilities.ts` denied `comment.create` to
  guest/client while the `task_comments` INSERT policy gates on `can_view_task` - measured,
  not reasoned: a real guest session posts a comment fine. Being wrong in the restrictive
  direction still takes an ability away from someone the database was built to serve, and
  they cannot tell that refusal from a bug. Same defect in `task.attachment.delete`, which
  ignored 091's `uploaded_by = auth.uid()` clause. Every capability now names the policy it
  mirrors, and the ones that deliberately differ say why.
- ⚠️ **`/dashboard?tab=…` is wrong for an admin, everywhere, not just in the nav.**
  `app/dashboard/page.tsx` redirects an admin to `/admin` **and drops the query string**.
  `buildWorkspaceNav` has known this since it was written; the ⌘K palette did not, and
  hardcoded `/dashboard` in both its Create commands and its search results - so for all
  five real users of this app (every one of them an admin) those commands landed on
  whatever tab they last had open. There is now one `dashboardHost(role)` in
  `components/shell/workspace-nav.ts` and every `?tab=` link is built from it. **Any new
  surface that builds a tab link must call it rather than writing the path.**
  - ⚠️ **`boardHref(role, id)` is the same rule for board links, and the board page was the
    last place still getting it wrong** (2026-08-21). The two board routes are not
    interchangeable: `app/dashboard/board/[id]/page.tsx` passes `isAdmin={false}` on purpose,
    so an admin sent to `/dashboard/board/<id>` loses Add Column, the column menu and the
    board rename with nothing on screen saying why. `board-view.tsx` built **five** hrefs
    from that surface flag rather than from the viewer's role - the ⌘K "copy link" action,
    the deep-link `router.replace`, the Recents entry and the favourite. The last two are
    the durable ones: both store the href they were created from, so one visit through
    `/dashboard` pinned that admin into the stripped surface for as long as the star existed.
    Now `boardHref(platformRole, id)` from `workspace-nav.ts`, next to `dashboardHost`.
  - ⚠️ **A board renders outside AppShell, so its header nav is a second copy of the nav and
    it had drifted exactly as `/admin`'s did.** Two hardcoded arrays keyed off `isAdmin`,
    written before `appointments`/`crm` existed: no My Work at all, Marketing offered to
    every admin whether or not the module was on, and `handleNavChange` pushing a bare
    `/admin` | `/dashboard` picked from the surface flag - so an admin clicking "Boards" from
    a board wrote the wrong `sessionStorage` key, landed on `/dashboard`, was redirected to
    `/admin` with the query dropped, and arrived on whatever tab they last had open. It calls
    `buildWorkspaceNav` now and navigates by each item's own `href`; the `sessionStorage` tab
    hack is gone, because `?tab=` already does that job correctly.
  - ⚠️ **And that fix broke the header until the strip became a menu.** The nav was rendered
    as a row of unlabelled icon buttons, which was fine at four entries and destroyed the
    header at twelve: measured on dev, the board title was squeezed out of its own page and
    the description reflowed to one word per line. One `DropdownMenu` costs one button's
    width whatever the workspace has switched on, and it can carry the labels the strip never
    could. **A nav sourced from a module registry has no fixed length - do not render it as a
    fixed-width strip.** Pinned by `pnpm check:board-nav`, which asserts the page does not
    scroll sideways and the title still measures over 100px.
- ⚠️ **Renaming a board column renames the STATUS, and that is not a shortcut - it is the
  only correct scope** (2026-08-21). A column linked to a status is *named by* that status:
  `107`'s cascade renames every linked column on every board whenever the status is renamed,
  deliberately, so two boards can never disagree about what the same thing is called. So
  writing `columns.title` on one board produces a name that looks saved and is silently
  reverted by the next status rename. The column menu's **Rename Column** therefore updates
  `task_statuses.label` and then calls `rename_columns_for_status` - the same two calls
  `status-management.tsx` makes, in the same order, surfaced where you actually notice the
  wrong name. A column with **no** `status_key` is custom and renames on its own board only.
  - `task_statuses` is **super-admin-only** (`069`) while `columns` is admin-writable, so a
    plain admin can rename a custom column and not a linked one. The dialog says so and
    disables the button rather than letting the write be refused, and rather than writing
    `columns.title` anyway. Gate: `pnpm check:board-nav` (16 checks), whose plain-admin case
    is the control proving the gate is role-specific and not a blanket break.
  - **Every column on dev is linked (30/30, 0 custom)**, so the linked path is the only one
    anyone will hit in practice. Per-board custom names would need a `columns.title_custom`
    flag and a rewrite of `107`'s function; that was scoped out, not overlooked.
- **The marketing grid's channel headers rename in place** (2026-08-21). `105` gave the
  calendar a rename path and the grid header never offered it - the only route was a dialog
  behind "Edit channels" that nothing on the grid pointed at, so the names read as fixed.
  The header's own label is now the button. Same `rename_marketing_channel` RPC as the
  dialog, deliberately: `marketing_calendar_items.channel` is TEXT with no FK, so a rename
  that does not re-point its events orphans every post filed under the old name, and there
  must not be a second thinner path to that. Gate: `pnpm check:marketing-channel-ui` (8).
  - Two things a rename inside a draggable `<th>` needs, both found in a real browser and
    neither visible in code review: the header must stop being `draggable` while editing
    (selecting text with the mouse otherwise picks the whole column up), and the input needs
    `size={1}` - an `<input>`'s intrinsic ~20-character width beats the `th`'s `w-[150px]`
    under `border-collapse`, so the column visibly widened as you typed and snapped back on
    save.
- ⚠️ **Which calendar the Marketing tab opens on was decided by the alphabet** (2026-08-22).
  The switcher defaulted to `activeCalendars[0]` and `useMarketingCalendars` orders by name, so
  on production every visit landed on **"Kayla's Personal"** - 0 events, **0 members**, present in
  the switcher only because `marketing_calendars`' SELECT policy lets an admin read every
  calendar. Nothing was broken at the database; the screen simply opened on the wrong one, and
  forgot the correction on the next visit.
  - Selection now resolves in `resolveSelectedCalendarId` (pure, in
    `marketing-calendar-state.ts`): live selection, then what this user last chose
    (`localStorage`, keyed per user, per `097`'s rule that a view preference does not earn a
    table), then a calendar they hold an actual `marketing_calendar_members` row on, then
    first-by-name. **Only an explicit switch is stored** - persisting the resolver's own fallback
    would pin the branch least likely to be right.
  - Membership rides on the query the hook and `loadShellData` already run, embedded as
    `marketing_calendar_members(user_id)`. Safe against the "hidden vs does not exist" trap for
    the one question asked of it, because `085`'s SELECT policy **always** shows a member their
    own row. The shared select + mapper are in `lib/marketing-calendar-summary.ts`, framework-free
    for the same reason `lib/module-registry.ts` is: `shell-data.ts` runs in a Server Component.
  - Gate: `pnpm check:marketing-calendar-default` (7, real browser). It was confirmed to drop to
    4/7 with the old rule restored, rather than trusted to be meaningful.
  - ⚠️ **Re-measured on prod 2026-08-28, and most of this paragraph had gone stale.**
    "Kayla's Personal" is **already archived**. **Marketing Calendar now has 2 members**
    (Bobby AND Kayla, 1355 events), not one, so **Bobby no longer resolves to "TEST"** - both
    hold a membership row on the real calendar and first-by-name puts M before T. The original
    complaint is fixed.
    What is left is narrower and is **not safe to tidy unilaterally**: "TEST" is still active
    with 0 events and 3 members (Bobby, Kayla, **and Vanshaj**), and **Vanshaj is a member of
    NOTHING ELSE**. `canUseMarketingCalendar` is `isAdmin || member of >= 1 calendar`, so
    archiving "TEST" would remove a plain user's Marketing nav item altogether. The fix is
    either "archive TEST and add Vanshaj to Marketing Calendar" or "archive TEST and accept
    they lose it", and choosing between those is granting or removing access to 1355 real
    events. **Owner decision, and it stays one.** Re-query membership before acting; this note
    has now been wrong once.
- ⚠️ **There is no working `localStorage` under vitest, and the bare global is the trap.**
  Node 22 defines its own `localStorage` that is `undefined` without `--localstorage-file`, and
  vitest's jsdom environment points `window` at `globalThis` - so `window.localStorage` resolves
  to that same stub. Any `try { localStorage... } catch {}` therefore does nothing in tests and
  says nothing about it: `marketing-calendar.test.tsx`'s `afterEach` had been calling
  `localStorage.clear()` into its own catch since it was written, under a comment claiming jsdom
  kept the value between tests. App code should use `window.localStorage` (already the convention
  in `components/shell/use-density.ts`), and a test that needs real persistence must install an
  in-memory Storage with `Object.defineProperty(globalThis, 'localStorage', ...)` - the worked
  example is at the top of `marketing-calendar.test.tsx`. `loadViewMode` still reads the bare
  global and is still untested.
- ⚠️ **"Hidden from you" and "does not exist" arrive looking identical.** This is the shape
  behind several bugs in this repo, so it is worth naming. A client reads a table through RLS
  and gets a filtered list; nothing in the response says anything was withheld. Any UI logic
  that then treats emptiness or absence as a *fact about the world* is wrong for exactly the
  users the policy was written for. Audited every table 2026-08-19: **9 tables can never hide
  a row** from a signed-in user (`app_modules`, `companies`, `marketing_channels`, `profiles`,
  `project_ids`, `tags`, `task_statuses`, `team_members`, `teams`) and are safe to reason about
  as complete; **35 can return a partial list** and must not be. The safe move when a decision
  depends on completeness is a `SECURITY DEFINER` function that counts or checks past RLS and
  returns the narrowest possible answer.
  - **`columns` → column deletion (fixed by `108`).** `board-view.tsx` asked
    `column.tasks.length > 0`, but `can_view_task` hides ARCHIVED tasks from everyone except a
    super_admin while deleting a column only needs `is_admin_user()`. A plain admin saw an
    empty column, confirmed "Remove this empty column?", and got `074`'s refusal quoting tasks
    that were not on screen. **No data was ever at risk** - `074`'s
    `prevent_nonempty_column_delete` trigger runs as the table owner and sees everything, which
    is the only reason this was a clarity bug and not a cascade. Verified by attempting it.
    `public.board_column_task_count` now answers the question honestly, and
    `pnpm check:column-delete` (13) pins all three halves: the filtered view really is short,
    the honest count really is complete, and the trigger really does refuse.
  - **Already defended, checked and left alone:** the archived-tasks panel is gated on
    `isSuperAdmin`, so it never claims "0 archived" to someone who simply cannot see them; the
    `board_members` roster has no admin bypass, and `canManageMembership` swaps the picker for
    `MEMBERSHIP_LOCKED_REASON` rather than showing a non-creator an empty list; membership
    writes count their returned rows; `crm` lookups fetch every status and filter only in
    pickers.
- ⚠️ **The "this board is missing a status column" banner is safe only because the board page
  redirects first.** `statusesMissingFromBoard` receives `columns` already filtered by RLS, and
  an empty array from a filter is indistinguishable from a board that genuinely has no columns.
  So for an admin who is NOT a member of a private board - whose columns `099` hides - the
  banner would claim every status was missing and offer to "fix" a board that is already
  complete, and the `columns` INSERT policy is bare `private.is_admin_user()` with no privacy
  term, so those clicks would really have created duplicates. It cannot happen because
  `app/admin/board/[id]/page.tsx` and its `/dashboard` twin do `if (!board) redirect(...)`, and
  the `boards` SELECT policy hides a private board from a non-member, so they never reach the
  screen. Measured on dev with a private board and a super_admin outsider: redirected to
  `/admin`, board untouched. **If that redirect is ever loosened - an admin bypass on the
  boards SELECT policy would do it - this banner has to start telling an unreadable board
  apart from an empty one before it renders.**
- **Board columns are named by their status now, not near it.** Renaming a status renames every
  column linked to it on every board; linking a column to a status in the board's own menu
  renames that column to match; picking a status in "Add column" names it. A column with
  **no** `status_key` is a custom column and is never touched - that is the escape hatch.
  New boards seed **one column per active status** in status order, rather than asking for the
  four built-in keys by name: a status the company added appeared in every dropdown and on no
  new board, and an archived one was seeded onto new boards forever.
- ⚠️ **`app_modules` had no writer at all until 2026-08-15.** `066` gave the table an
  "Admins manage modules" policy (`private.is_admin_user()`, so admin *and* super_admin) and a
  full DML grant; `080` seeded `appointments` disabled and `103` seeded `crm` disabled; and no
  screen anywhere could switch either on. Both modules were reachable only by hand-written SQL
  - the guest/client lesson repeating exactly. Fixed by
  `components/admin/module-management.tsx`, a fifth **Modules** tab on `/admin/super-admin`.
  Its writes ask for their rows back and compare the count, because an RLS refusal returns
  zero rows and no error. ⚠️ That UI used to badge `ai_assistant` and `bookmarks` as "not yet
  consumed at their render sites"; **that was already false when it was written** and the badge
  is gone (2026-08-27). Both toggles work - see the corrected note under Phase 1-C above.
- ⚠️ **`102` is dev-only and rewrites an RLS policy, so it is destructive by this repo's own
  definition and must NOT use `--allow-prod`.** It is also a hard dependency of the
  "Move to another board" button on a task - without it `move_task_to_board` does not exist
  and every move fails - so it has to be applied to prod *before* that code merges.
  It closes a real hole, verified by running the raw UPDATE before writing the fix: the tasks
  UPDATE policy was `can_manage_task(id, …)` in both USING **and** WITH CHECK, and every gate
  inside that function resolves the board by looking the task up **by id**, which in a WITH
  CHECK still reads the pre-UPDATE row. So the policy only ever judged the board a task was
  *leaving*. A user with a column id could move a task onto a private board they cannot even
  SELECT - observed, not theorised. Fixed by ANDing 067's two column-keyed helpers
  (`column_hidden_by_board_privacy` / `column_restricted_by_board_role`) into the WITH CHECK,
  where `column_id` is the NEW value. Gate: `pnpm check:task-move` (19 checks); `board-roles`,
  `access-matrix`, `task-lifecycle` and `deactivation` were all re-run green after it.
  - Two things worth keeping. **`authenticated` has no USAGE on schema `private`** - RLS can
    call `private.*` because policy expressions are evaluated as the *table owner*, but an
    ordinary function body invoked by a signed-in user cannot. A first draft put the helper in
    `private` and every call died with "permission denied for schema private"; it lives in
    `public` now and gates itself on `can_manage_task`. **And the RPC is SECURITY INVOKER on
    purpose** - RLS stays the authority; plpgsql is there only so `GET DIAGNOSTICS` can turn a
    refusal into a raised exception instead of PostgREST's silent zero-row report, and so a
    parent and its subtasks move in one transaction.
- ⚠️ **`101` makes deactivation real, and it is the most important of the batch.**
  `profiles.is_active` had a prominent Activate/Deactivate toggle in Super Admin and was read
  by **nothing** - 0 policies, 0 helpers, 0 lines of app code. A "deactivated" person kept
  full access and could sign in, while the admin saw a red Inactive badge. Present and
  believed is worse than missing. It also meant the *reversible* way to remove someone did
  not work, leaving permanent deletion as the only functioning path. Now enforced in three
  layers: a GoTrue ban (the real boundary), `is_active` folded into
  `is_admin_user`/`is_super_admin_user`/`can_manage_task` plus the tasks/comments/chat INSERT
  policies (so elevated access dies on the next query, not when the token expires), and
  `proxy.ts` signing them out on the next page load. Gate: `pnpm check:deactivation` (17).
  - Two traps worth remembering. **Patching `can_manage_task` was not enough**: task creation
    never calls it, because `067` had to key the INSERT check off a *column* id. Comments and
    chat have their own checks too. **A column-level `REVOKE` cannot shrink a table-wide
    grant** - `REVOKE UPDATE (is_active) … FROM authenticated` silently did nothing while
    `authenticated` held table-wide UPDATE; the fix is to drop the table grant and re-grant
    the exact self-service columns. Both were caught by the migration's own post-conditions
    and harness, not by reading.
- ⚠️ **`100` (deprovisioning) is dev-only too, and is the one to apply first.** It fixes a
  live bug: `boards.created_by` and `tasks.created_by` were `NOT NULL` with an
  `ON DELETE SET NULL` foreign key - a straight contradiction, so Postgres aborted the
  delete of anyone who had ever created a board with an opaque "Database error deleting
  user". Every board here is created by an admin, so in practice **no admin account could
  ever be deprovisioned.** The same migration stops three things being silently destroyed
  when a delete did succeed: `task_comments.user_id`/`author_id` and `bookmarks.created_by`
  were `CASCADE`, so a departing person took their comments and every **company-scope**
  bookmark they had created with them. All are `SET NULL` now, so the content survives and
  only the attribution goes. Personal bookmarks still cascade through `user_id`, which is
  correct. `share_links.created_by` is deliberately left `CASCADE` - a public share URL
  minted by someone who has been removed should stop working.
  - **Boards are reassigned rather than nulled**, and that happens in
    `app/api/admin/delete-user/route.ts`, not in SQL. `boards.created_by` is not a byline:
    `061` makes it the sole authority over a private board's membership list, with no admin
    bypass, so a NULL creator would freeze that list permanently. The route transfers boards
    to the super admin doing the deletion first, then deletes the account. Tasks and
    comments are deliberately **not** reassigned - that would make them claim to have been
    written by whoever ran the deletion.
  - ⚠️ **`119` added a second thing that must change hands, and the route did not learn about
    it for two days** (fixed 2026-08-27). `saved_views.owner_id` is `ON DELETE CASCADE`, which
    is right for a PERSONAL view - private to its owner, including from admins, so nothing
    anyone else could see is lost - and destroys other people's work for a SHARED one, which
    sits on every picker. Deprovisioning someone silently deleted every shared view they had
    made. The route now transfers `scope = 'shared'` only, before the delete, exactly as it
    does boards; personal views still cascade, because moving them would hand the deleting
    admin a view built to be unreadable by admins. `describeDeletion` counts them separately
    from boards so the confirmation says what is about to change hands.
    - **The generalisable bit: a new table with an owner FK is a deprovisioning decision, not
      just a schema one.** CASCADE, SET NULL and reassign are three different answers and the
      right one depends on who else can see the row. Ask it when the table is created - this
      one was missed because `119`'s own header flagged it ("the delete-user route has NOT
      been updated for this yet") and nothing carried that forward.
  - Gate: `pnpm check:deprovision` (25 checks as of 2026-08-27, was 20). The four new
    shared-view checks were confirmed to FAIL when the transfer was removed, rather than
    trusted to be meaningful.
- ⚠️ **`098` and `099` are applied to dev only, and both need a decision before prod.**
  Neither is `--allow-prod` eligible on the "purely additive" rule.
  - `098` (audit events) adds a table, which is additive, but it also puts **triggers on five
    existing tables** (`board_members`, `team_members`, `marketing_calendar_members`,
    `profiles`, `app_modules`). A trigger changes the behaviour of writes that already
    happen, so it is not additive in the sense that rule means. It is self-verifying
    (post-conditions inside the transaction) and reverts with
    `scripts/rollback/098_revert.sql`, which **destroys the recorded history** - dump the
    table first if the intent is "roll back the code, keep the log".
  - `099` **rewrites an RLS policy** on `columns`, so it is destructive by this repo's own
    definition and must not use `--allow-prod`. It closes a real disclosure (see below), so
    it wants applying deliberately rather than being left indefinitely.
- ⚠️ **`096` and `097` are applied to dev only.**
  - `096` (signup trigger) is a **no-op on prod**, which already has the trigger - verified.
    Worth applying only so both databases are provably identical.
  - `097` (`user_favorites`) is **purely additive** - one new table, no existing policy or row
    touched - so unlike `094`/`095` it is straightforwardly `--allow-prod` eligible:
    `node --env-file=.env.production.local scripts/migrate.mjs --only=097 --allow-prod`
    Without it the star renders and every click fails, so apply it **before** merging the code.
    Rollback `scripts/rollback/097_revert.sql` **destroys real user data** (everyone's stars);
    snapshot the table first if the intent is "roll back the code, keep the favourites".
- **Dev-sandbox drift to know about: the `on_auth_user_created` trigger.** The sandbox was
  missing it entirely (the function `handle_new_user` existed, attached to nothing) because the
  trigger lives on `auth.users`, **outside the `public` schema**, so a public-only clone drops
  it. Production is fine - 11 auth accounts, 10 profiles, and the five most recent accounts all
  have their row. Restored by `096`. If you ever re-clone prod into the sandbox, expect to lose
  it again and re-apply `096`. Anything else living outside `public` has the same exposure.
- **Every Storage bucket is private, 50 MB, 23 MIME types** (`task-assets`, `chat-attachments`,
  `marketing-assets`) as of `093`. 50 MB is the **Supabase Free plan's hard per-file ceiling** -
  a bucket's `file_size_limit` cannot exceed the project-wide upload limit, and on Free that
  limit cannot be raised at all, so this is the maximum without changing plan. Total storage on
  Free is 1 GB across every bucket, roughly 20 files at full size. The one limit deliberately
  NOT raised is the **inline base64 path** for task attachments (043's 14 MB `octet_length`
  CHECK ≈ 10 MB raw): those bytes land in the Postgres row inflated 33%, against a 500 MB
  database budget. The admin-only "Large file" toggle exists so that path never has to grow.
- **⚠️ `pnpm build` / `pnpm start` locally talk to PRODUCTION.** Next loads
  `.env.$(NODE_ENV).local` ahead of `.env.local`, and this repo has a committed-in-workspace
  `.env.production.local` holding prod credentials - so any production build bakes prod's
  Supabase URL and anon key into the client bundle, and a local `pnpm start` session is a live
  prod client. `pnpm dev` is unaffected (it uses `.env.local`, the dev sandbox). Before running
  any browser test against `pnpm start`, move `.env.production.local` aside and rebuild, then
  restore it - and confirm which project you got with:
  `grep -rhoE '(icyfluwgyuimhwlddjyy|pxzpewaerhjwnwsbaklc)' .next/static/chunks/*.js | sort -u`
- **Theming: the accent lives at the document root, and `.force-light-theme` is gone.**
  The accent picker used to return a `style` object that `user-dashboard.tsx` spread onto one
  wrapper `<div>`. Custom properties inherit down the DOM, so the colour reached that subtree
  and nothing else: a board renders from its own route and every Radix dialog/popover/toast is
  portaled to `document.body`, which is a *sibling* of that wrapper. `AccentProvider`
  (mounted app-wide by `AccentBoot` in `app/layout.tsx`) now writes the properties to
  `document.documentElement`, which is an ancestor of both.
  - ⚠️ **`.force-light-theme` was the reason the picker "did nothing" on the marketing
    calendar.** That class pinned the whole subtree to the light palette *including*
    `--primary` and `--ring`, so it silently overrode whatever the picker had set. It is
    deleted; the calendar's chrome is now `--brand-band` / `--brand-accent` / `--surface-note`
    tokens that flip per theme, and the band is deliberately *lighter* in dark mode (`#171717`)
    because the light-mode value sat darker than its own page and read as a recess.
  - **Never redeclare `--primary` in a scoped class.** Any rule that does will break the accent
    picker for everything inside it, and the failure is invisible in code review.
  - Theme + accent are per-browser `localStorage`, per `097`'s stated rule that presentational
    preferences do not earn a table. `ThemeControls` (light/dark/system + accent) is in every
    shell, boards included.
  - ⚠️ **Two hydration traps this uncovered, both of which React 19 reports as errors.**
    `useSurface()` reads `resolvedTheme`, which is unknown during SSR - it is mount-gated, so
    theme-derived colour must never be assumed correct on the first frame. And anything
    rendering *elapsed time* must take the server's instant as a prop (`lib/use-now.ts`);
    calling `new Date()` during render makes the server and client disagree on every row.
    `crypto.randomUUID()` in a `useState` initializer has the same problem when the value
    becomes a DOM `id`.
  - ⚠️ **A third one, found in the CRM review (2026-08-15) and not specific to theming:
    `Date.parse('2026-08-14T23:59:59')` has no zone designator, so it resolves against
    whatever timezone the *runtime* is in** - UTC on the server, `America/Chicago` in the
    browser. Those are five hours apart, so `isPastTargetClose` rendered a row as late on the
    server and fine on the client for a five-hour window every day. Measured, not assumed: the
    old expression returns `true` under UTC and `false` under Chicago for the same instant.
    Anything comparing a **date-only** column (`DATE` in Postgres, `YYYY-MM-DD` over
    PostgREST) must compare calendar dates in an explicit zone - `lib/crm.ts` exports
    `BUSINESS_TIME_ZONE` and `businessDate()` for this - never parse it into an instant. A due
    date is not due at an instant.
  - **The related non-hydration trap in the same review: filtering a lookup table in the
    query.** Every CRM page fetched statuses with `.eq('is_archived', false)`, so an order in
    an archived status had no entry in the lookup map, and every consumer reads a missing
    status as "not terminal" - archiving Won would have counted every won order as live
    pipeline. The rule, now uniform: **queries fetch every row, lookups resolve against every
    row, and only pickers filter** (`activeStatuses()` in `lib/crm.ts`, which also keeps a
    record's own archived status in its picker so the control never renders blank).
  - ⚠️⚠️ **`tasks.due_date` IS NOT A `DATE` COLUMN. It is `TIMESTAMPTZ`** (`001_initial_schema.sql`)
    - and believing otherwise put the same one-day bug into three screens twice. Read this before
    touching any due-date logic. Measured against the sandbox, not assumed: **49 of 53 rows are
    `T00:00:00+00:00` and 4 are `T05:00:00+00:00`**, because there are two writers and they
    disagree:
    - `create-task-dialog.tsx` writes the raw string of an `<input type="date">`, so Postgres
      casts `'2026-08-27'` to **UTC midnight**.
    - `task-detail-modal.tsx` writes `Date.toISOString()` from a picker set to **local midnight**,
      so a Chicago user produces `T05:00:00+00:00` on the same day.
    Both encode *midnight on the day the person meant*, so **the intended day is the UTC date
    part** - and resolving the instant through `America/Chicago` yields the day BEFORE for the
    common shape. `dueCalendarDate()` / `taskDueDate()` in `lib/calendar-grid.ts` are the only
    correct readers; `businessDate()` is still right for `created_at`, because which day an event
    happened on genuinely does depend on where you stand, and which day something is due does not.
  - ⚠️ **This shipped to production inside Prompt E, and the "timezone fix" recorded below made
    it.** `lib/view-config.ts` resolved `due_date` through `businessDate()`, so on `/views`, the
    board and Reports **a task due today was returned by the `overdue` filter** and grouped under
    Overdue. Measured on 2026-08-27 by running the shipped engine against a real row shape:
    `taskDueDate('2026-08-27T00:00:00+00:00')` returned `2026-08-26`. Fixed the same day by
    splitting `dueCalendarDate` (stored day) from `calendarDateOf` (true instant), and **live on
    production as `2142cc8`** from 2026-08-27. The fix was code-only, no migration, so it was
    safe to merge straight to `main`; prod stays at `119`.
  - ⚠️ **`/my-work` had its own older version of it**, via `new Date()` + LOCAL
    `setHours(0,0,0,0)` in `lib/my-work.ts` and `lib/work-next.ts`. Same one-day shift, every
    hour of every day rather than an evening window: the Overdue stat counted today's work as
    late, "Due today" showed tomorrow's, WorkNext labelled today's tasks "1 day overdue" and
    scored them above genuinely late work, and `dueLabel` printed `2026-08-30` (a Sunday) as
    "Due Sat 29 Aug". All fixed 2026-08-27.
    - ⚠️ **Why ~1420 passing tests said nothing, in BOTH rounds: the fixtures were a shape the
      column never sends.** My Work's were `toISOString()` timestamps (which survive the old
      local-midnight maths unharmed); Prompt E's were bare `'2026-08-25'` strings (which survive
      `businessDate` unharmed). Each suite tested the one shape its own bug could not touch.
      **A fixture shape production never produces is not coverage - it is a second bug hiding
      the first.** Both suites now use the real `T00:00:00+00:00` / `T05:00:00+00:00` forms, and
      are run under `America/Chicago`, `UTC` and `Pacific/Auckland`.
    - The shared primitives are `dueCalendarDate` / `taskDueDate` / `daysBetween(from, to)` /
      `shortDayLabel`, all in `lib/calendar-grid.ts`. Every one builds its ends with `Date.UTC`,
      so no DST transition can land between them. **Reach for these rather than writing date
      maths again** - this is the fourth and fifth recorded instance of the same defect.
    - ⚠️ **It was in SEVEN more places than the two screens above**, found by sweeping for
      `new Date(*.due_date)` rather than by reasoning about it, and all fixed the same day:
      `task-card.tsx` painted **every card due today red** (`new Date(due) < new Date()` is true
      from one minute past the stored midnight) and printed the wrong day; `board-view.tsx`,
      `user-dashboard.tsx`, `work-next.tsx`, `reports-view.tsx`, `personal-tasks.tsx` and the
      public `share/[token]` page all displayed the day before; `personal_tasks` has the same
      TIMESTAMPTZ column and the same bug; `ai-chat-tools.ts` told people work due today was
      overdue; and **both date PICKERS highlighted the previous day**
      (`new Date('2026-08-27T00:00:00Z')` is the 26th in Chicago), so opening a task showed a
      date the task did not have - `dueDateAsPickerDate` exists for exactly that.
    - ⚠️ **And the fix itself broke every date on screen, which is the defect to learn from.**
      All thirteen of those display sites had rendered `toLocaleDateString('en-US')` for months
      (`8/27/2026`); the sweep swapped them to `shortDayLabel`, which is the compact `/my-work`
      chip and **carries no year**. So from the `2142cc8` deploy until 2026-08-28, a board card,
      dashboard, Reports row, the public share page and BOTH Reports exports read `Thu 27 Aug`,
      and a task due 5 Jan 2027 displayed identically to one due 5 Jan 2026. The CSV was the
      worst of it: its **Due Date** column lost the year while the **Created Date** column
      beside it kept it, so one downloaded file carried two date formats and the sortable one
      was the wrong column. `calendarDateLabel` restores the original format, computed from the
      stored calendar day so the DAY fix survives. **Fixing what a value MEANS is not licence to
      change how it LOOKS** - the day was wrong, the format never was, and a reformat that rides
      along inside a correctness fix reaches production with nobody having agreed to it.
      `shortDayLabel` is now used in exactly one place, `my-work-view.tsx`'s "Due Sat 29 Aug"
      chip, where near-term context makes the missing year fine. Pinned by three cases in
      `lib/calendar-grid.test.ts` including a year-boundary pair, and verified in a real browser
      against a task due in 2027.
    - ⚠️ **The WRITE half was wrong for every positive UTC offset, and UTC cannot see it.**
      `task-card` and `task-detail-modal` both wrote `pickerDate.toISOString()`, and a picker
      hands back LOCAL midnight - so a user picking 27 August stored
      `2026-08-26T18:30:00.000Z` in `Asia/Calcutta` and `2026-08-26T12:00:00.000Z` in
      `Pacific/Auckland`. Every reader takes the UTC date part, so the app stored, displayed and
      reported **the day before the one that was clicked**, silently, since nothing about the
      value looks wrong on its own. Measured across four zones before the fix and again after.
      All five writers now go through **`dueDateForStorage`**, which always yields
      `YYYY-MM-DDT00:00:00.000Z`, so this column holds ONE shape instead of the two it used to.
      No backfill was needed: the existing `T05:00:00+00:00` rows were written by Chicago users
      and their UTC date part is already the right day.
    - ⚠️ **`pnpm test:timezones` exists because the whole suite passes in UTC against the broken
      code.** Proved, not assumed: restoring the old `.toISOString()` write and re-running gave
      **UTC 52/52 green**, Chicago 1 failure, Calcutta and Auckland 3 each. A CI box on UTC would
      have certified this bug indefinitely. The script runs the full 1486 tests under UTC,
      `America/Chicago`, `Pacific/Auckland` and `Asia/Calcutta`; all four pass. **Any date work
      in this repo should be run through it, not through `pnpm test` alone.**
    - **Two sites were already correct and are now commented as such**, because both looked
      like the bug and a later "fix" would have broken them: `bulk-action-bar`'s date shift uses
      `setUTCDate`/`getUTCDate` deliberately, and `calendar-view` read the UTC date part.
      ⚠️ That same function built its grid key as `new Date(y, m, d).toISOString().slice(0,10)`,
      which is a LOCAL midnight converted to UTC - right in Chicago, **off by one everywhere east
      of Greenwich**. It uses `iso(y, m, d)` now.
    - ⚠️ **`scripts/audit-mobile.mjs` REPORTS, it does not gate** - it exits 0 and prints
    "N of 48 routes flagged", so "it passed" says nothing. On 2026-08-27 both `main` and this
    branch flagged **32 of 48**, every flag a touch-target size on pre-existing shell chrome
    (Skip to content, command palette, Appearance, Account, Sign Out), and **zero horizontal
    overflow anywhere**. The only way to read it is to diff its FLAG lines against the same run
    on `main`; 31 of 32 were identical. ⚠️ It is also flaky per-route: `admin-marketing`
    measured **256** small targets at 390px and **6** at 320px in the SAME run, so a single
    route's count moving is not evidence of anything.
    - ⚠️ **And it dies with `ERR_CONNECTION_REFUSED` if the dev server stops mid-run**, exiting
      non-zero with a stack rather than a summary. Reading its log before it finishes shows a
      clean prefix - which is exactly how it was briefly misreported as green here. Wait for the
      final "N of 48" line.
  - Gate: `pnpm check:my-work` (20, real browser). ⚠️ Its context is pinned to
      `timezoneId: 'America/Chicago'` deliberately - **the bug is invisible in UTC and in any
      positive offset**, so a harness running in the machine's own zone (this Mac is
      `Asia/Calcutta`) passes against broken code. It is also what found the column's real type,
      by asserting the stored value and failing.
  - ⚠️ **A displayed reason must be computed from the same value as the score it explains**
    (same pass, `lib/work-next.ts`). The urgency/priority scorer normalised priority to the
    middle of the 1..5 scale, but the *reason* line tested the raw `Number(task.priority)` -
    and `Number(null)` is `0`, which is `<= 2`. So **every task with no priority set** (a
    nullable column, so most of them) scored as medium and was simultaneously labelled
    "High priority". Measured: `priority: null` → score 91, reasons `["Due in 3 days",
    "High priority"]`; a real priority-2 task scores 103. One `normalizePriority()` feeds both
    now, so they cannot disagree. Prompt F's requirement that ranking stays explainable is
    broken just as badly by a reason the score does not support as by showing no reason at all.
    `lib/work-next.ts` previously had **no test file**; it has 18.
- ⚠️ **The nav is `components/shell/workspace-nav.ts` and nothing else. `/admin` used to keep
  a hand-written copy** (2026-08-15). It was written before `appointments` (080) and `crm`
  (103) existed and was never updated, so switching either on in Super Admin → Modules
  changed `/dashboard`, `/my-work` and `/crm` but left `/admin` - the screen an admin
  actually lands on, since `app/dashboard/page.tsx` redirects them there - with no way to
  reach the module at all. `/admin` also had no Appointments tab to link to. This is the
  guest/client lesson a third time: **the database and the toggle were right, and no human
  could get there.** All four surfaces now call `buildWorkspaceNav`, and both dashboards
  derive `allowedTabs` from `addressableTabs(sidebarGroups)` rather than restating the list,
  so a reachable tab and a visible nav item cannot disagree.
  - **The nav builder picks its host from the role**, because `/dashboard?tab=boards`
    redirects an admin to `/admin` **and drops the query string**, landing them on whatever
    tab they had open last. Every `?tab=` link is `/admin?tab=…` for an admin and
    `/dashboard?tab=…` for everyone else; `/my-work` and `/crm` are real routes and are left
    alone. Pinned by `components/shell/workspace-nav.test.ts` ("never leaves a /dashboard
    link in an admin's nav").
  - `reports` and `access-log` are admin-hosted only - the user dashboard has no such tab, so
    offering either to a member is a dead link, not a permission error. The old `admin-home`
    item is gone: for an admin, Home *is* `/admin`, and the two entries pointed at one screen.
  - **The nav is server-rendered. `lib/shell-data.ts`'s `loadShellData(supabase)` reads
    `app_modules` + `marketing_calendars` on the server**, and every shell takes them as a
    `shell` prop and passes them to `useAppModules(shell?.modules)` /
    `useMarketingCalendars(shell?.calendars)`. Both hooks skip their own fetch when seeded and
    fall back to fetching on mount when not, so the prop is optional everywhere. For CRM the
    seed rides on `requireCrmAccess`, which already had to read `app_modules` to decide
    whether to let you in. Before this, every screen painted `DEFAULT_MODULES` - where
    `appointments` and `crm` are off - and corrected itself a beat later, so a module a super
    admin had just switched on visibly appeared after the page did.
    - ⚠️ **`useAppModules` reads the seed on every render rather than copying it into
      `useState`.** An initializer runs once, so a soft navigation carrying a newly-toggled
      list would be ignored for the component's lifetime; syncing it back with an effect
      instead risks a render loop whenever the host passes a fresh array identity.
    - ⚠️ **`lib/module-registry.ts` exists because a Server Component may not import a module
      that reaches `useEffect`.** `lib/modules.ts` imports `useState` and the browser Supabase
      client, so `loadShellData` wanting `DEFAULT_MODULES` broke the build the moment it was
      written. The registry holds the pure data and `lib/modules.ts` re-exports all of it, so
      no existing import changed. Turbopack caught this, `tsc` did not.
    - Gate: `scripts/audit-mobile.mjs` loads `/admin`, `/my-work` and `/crm` in a context with
      **JavaScript disabled** and asserts CRM and My Work are in the HTML. That is the only
      check that can tell a server-rendered sidebar from one the browser corrected; reading
      the DOM after the page settles cannot.
- ⚠️ **`app/globals.css` used to shrink the whole interface on a phone.** Its "Mobile
  optimizations" block opened with `html { font-size: 14px }` below 768px (and 15px for
  tablets). Every size in this app is rem-based through Tailwind, so that scaled the entire
  UI **down** 12.5% on exactly the devices that need it larger: `text-sm` landed at 12.25px
  and an `h-10` control measured 35. Removed 2026-08-15 - mobile is not a small desktop.
  - The same block set `min-height: 44px; min-width: 44px` on `button, a, [role="button"]`,
    which was wrong in both directions: it stretched inline links inside sentences into 44px
    blocks and forced width onto icon buttons that then pushed out of their own cards, while
    never matching `input`, `select` or `textarea` - the controls a finger most needs. It is
    now `@media (pointer: coarse)`, height only, on real controls, with checkbox and radio
    explicitly exempt. **Key on the pointer, not the viewport**: a touchscreen laptop needs
    the bigger target and a 500px-wide desktop window does not.
  - And it clamped `[role="dialog"]` to `max-height: 90vh !important` while saying nothing
    about overflow, so a dialog taller than the screen was cut off with its submit button
    unreachable and no way to opt out. That now lives on `components/ui/dialog.tsx` as
    `max-h-[calc(100dvh-2rem)] overflow-y-auto` - `dvh`, because on iOS Safari `vh` is the
    height with the URL bar hidden.
  - Gates: `node --env-file=.env.local scripts/audit-mobile.mjs` sweeps every main route at
    320/390/1440 and reports horizontal overflow **naming the offending elements**, plus
    touch targets and console errors; `scripts/audit-mobile-deep.mjs` covers the board, a
    real dialog and dark mode. Both create and tear down their own super-admin fixture.
- **CSP is production-only, so dev cannot catch an `img-src` bug.** `next.config.mjs` only sets
  Content-Security-Policy when `NODE_ENV === 'production'`. `img-src` must list `blob:` and
  `https://*.supabase.co` - verified in a real browser that without them the marketing
  calendar's `URL.createObjectURL` preview and task attachments' signed-URL thumbnails are both
  refused, while `data:` (the inline base64 path) still loads, which is exactly why the
  marketing preview was silently broken in production for so long. Any new Storage-backed image
  must be checked against a real production build, not `pnpm dev`.
- **New tables need an explicit `REVOKE ALL`.** Supabase's default privileges grant every new
  table in `public` a blanket ALL to `anon` and `authenticated`, so granting narrowly is not
  enough - the wide grant is already there. `090` is the worked example (and its post-conditions
  are what caught it); the same trap bit the appointments migrations twice.
  - **✅ CLOSED by `095` (2026-08-13).** `anon` now holds **nothing** on any table, sequence or
    function in `public`, and the *default privileges* were narrowed too, so a new table no
    longer inherits the grant. `authenticated` keeps every DML privilege it had (RLS is what
    constrains a signed-in user); only `TRUNCATE`/`REFERENCES`/`TRIGGER` were taken away, and
    `TRUNCATE` is the one privilege RLS never covers. Gate: `pnpm check:grants` (16/16).
  - ⚠️ **Three function grants are deliberately preserved and must stay:** `book_appointment`,
    `cancel_appointment`, `check_booking_rate_limit` keep `EXECUTE` for `anon`, because `082`
    granted them on purpose and `app/api/book/cancel/[token]/route.ts` genuinely calls one with
    an anon client. `095` asserts all three survive, so it fails loudly rather than silently
    breaking public booking.
  - Worth knowing for next time: `REVOKE ... FROM anon` was **not enough** for three SECURITY
    DEFINER helpers. Postgres grants `EXECUTE` to `PUBLIC` implicitly on every new function, so
    their ACLs carried a leading `=X/postgres` that only `REVOKE ... FROM PUBLIC` removes.
    `is_board_member` was the one actually reachable over PostgREST.
  - Still open: `postgres` could not alter `supabase_admin`'s default privileges (not a member),
    so a table created through the **Supabase dashboard** still inherits the wide grant and needs
    a manual `REVOKE`. Tables created by migrations (which run as `postgres`) are covered.
- A migration that rewrites RLS policies should carry its own post-conditions inside the
  transaction - assert the expected policy set, that RLS is still enabled, and that row counts
  did not move, so it rolls back instead of half-applying. `087` is the worked example, and
  `scripts/rollback/087_revert.sql` shows the paired one-command rollback every such migration
  should ship with.
- Do not add `Co-Authored-By: Claude` to commits in this repo.
- **`main` auto-deploys to production** (Vercel project `v0-project-management-dashboard`, live at
  `project.goatlasgo.us`). Pushing to `main` ships to the live app within about a minute. Apply any
  schema change prod depends on *before* merging. To confirm what is actually live, read the commit
  sha from `gh api repos/VanshajPoonia/projectmanagementatlas/deployments` - `vercel inspect` does
  not print it, and matching timestamps by eye is a guess.

### Prompt C - the canonical work-item domain (`112`-`115`, dev AND prod, 2026-08-23)

Four migrations that together answer the plan's "one work item, configurable" requirement.
**All four are applied to dev AND prod** (prod on 2026-08-23, on the owner's explicit
instruction, one file at a time via `--only=NNN --allow-prod`, verified between each). ⚠️ Note
`113` was applied to prod **despite not being `--allow-prod` eligible on this repo's own rule**
- it adds a trigger to `tasks`. That was a deliberate owner decision after the risk was stated,
not an oversight; do not read it as precedent that the rule has changed.

⚠️ **The app code hard-depends on all four**: `useTaskStatuses` selects
`category, is_closed, icon`, `subtask-list.tsx` writes `tasks.type_key`, and two new panels
query `field_definitions` / `task_relations_expanded`. That dependency is satisfied on prod
now. `114` validates `applies_to_types` against `work_item_types`, so `113` is a hard
prerequisite of it - keep that order for any future rebuild.

**What the prod run found that dev could not.** Prod carries a **fifth status,
`pending_approval` ("Pending Approval")**, active and linked to a real column; dev has four.
`112`'s catch-all backfill gave it `planned`, which is byte-for-byte the bucket the old
substring heuristic already resolved it to (`to_do`), so nothing changed at migration time.
**It was then corrected to `started` on 2026-08-23, after the deploy, on the owner's
instruction** - work awaiting sign-off has begun, and `started` is the only one of the five
categories that fits. One live task sat in that column at the time, so the blast radius was one
card moving from the "to do" bucket to "in progress" on dashboards and reports. ⚠️ **It is 3
tasks as of 2026-08-28** - re-count before reasoning about that column again. It was done as a
separate, visible step rather than folded into the migration, precisely so the migration
itself changed no classification anywhere.
Prod also had **one** pre-existing subtask, correctly re-typed to `subtask` by `113`'s
backfill (171 tasks before and after; every table's row count identical before and after all
four migrations). Pre-migration backup:
`~/Code/prod-backup-pre-112to115-20260823-205453.dump` (custom format, `public` schema,
`pg_restore --list`-verified, chmod 444).

Gates: `pnpm check:work-items` (94, real RLS) and `pnpm check:work-items-ui` (31, real
browser, needs `pnpm dev` up). Both counts were read off a run, not estimated.

- **`112` - `task_statuses.category`.** Additive (three columns, no policy/row/grant touched),
  so `--allow-prod` eligible. Five normalized categories - `backlog|planned|started|
  completed|cancelled` - plus `is_closed` as a **GENERATED** column, because open-vs-closed is
  a function of the category and a writable copy of a derived fact is a copy that can be set
  to disagree with it.
  - **What it closes:** `063` made `columns.status_key` decide *which* status a task holds, and
    `lib/task-status.ts` then decided what that status *means* with
    `bucketFromText(status_key)` - a substring match for "progress"/"done"/"cancel". It was
    right only by coincidence: the four seeded keys each happen to contain a word it looks
    for. A status named `review`, `blocked`, `wip`, `qa` or `waiting` fell through every
    branch and counted as To Do, so blocked work reported as not started. The status screen's
    own placeholder - "e.g. Escalate to Mgmt." - is one of the names it gets wrong.
  - The heuristic is **kept as a last resort**, not deleted: callers holding a bare status
    string with no catalog still need an answer. `getNormalizedTaskStatus(task, statuses?)`
    takes an optional catalog and consults the category first; without one it behaves exactly
    as before. Both behaviours are pinned, including the wrong answers.
  - ⚠️ **`subtask-list.tsx` had a live bug this fixes.** Its "done" key was the first status
    whose *bucket* was `done`, and `cancelled` shares that bucket with `completed` by design -
    so on a workspace that ordered Cancelled above Completed, ticking a subtask's checkbox
    would have **cancelled** it. It asks for the `completed` category now.
  - The category is reachable: `status-management.tsx` has a **Means** picker on both create
    and edit, and shows it on every row. Without that, every status added from now on would
    silently take the default - the same "no human can get there" defect as `app_modules`.

- **`113` - `work_item_types` + `tasks.type_key`.** ⚠️ **NOT `--allow-prod` eligible**: it puts
  a trigger on `tasks`, which changes the behaviour of writes that already happen (the same
  reasoning that held `098` back). Eleven types seeded, **only `task` and `subtask` active** -
  the other nine exist, are editable, and appear in no picker, per the plan's "build the
  extensibility first, do not activate all types immediately".
  - Hierarchy is enforced in **two** triggers on purpose. `060` owns hierarchy by SHAPE (no
    self-parent, no cycle, one level deep) and is untouched; `113` adds hierarchy by KIND
    (`can_have_children` / `can_be_child` / `allowed_parent_type_keys`). Keeping them apart
    means `060`'s guarantees stay independently verifiable.
  - ⚠️ The trigger is `BEFORE INSERT OR UPDATE **OF type_key, parent_task_id**`. Both columns
    are named because of `104`'s lesson that an `OF` clause cannot police what it does not
    fire on: re-typing a PARENT to a type that cannot have children is an UPDATE of `type_key`
    on the parent row, which a `parent_task_id`-only trigger would never see.
  - `is_system` protects `task`/`subtask` from being deactivated, deleted or re-keyed -
    otherwise switching off `task` leaves every row pointing at a type no picker offers.
  - Backfill moves existing subtasks to type `subtask`; `subtask-list.tsx` now writes
    `type_key: 'subtask'` so new ones do not diverge from the backfilled ones.

- **`114` - custom fields.** Purely additive (two new tables), `--allow-prod` eligible, and
  seeds **zero** fields, so applying it changes nothing anyone can see. FEATURES.md Phase 1.
  - One row per `(task, field)`, value in `jsonb`. Not one JSON document per task, because
    that makes a value unaddressable and turns every edit into a read-modify-write that loses
    concurrent changes; not twelve typed columns, because a CHECK cannot see which type
    applies (the type lives on the other table).
  - **Validation is a trigger**, so a `number` cannot hold text whatever wrote it - UI,
    import, psql or a future automation. `is_required` is enforced at the VALUE, never at the
    task: blocking task creation would mean ticking "required" on a new field retroactively
    invalidates every task that already exists.
  - ⚠️ **Write policy is `is_super_admin_user()`, narrowed from `is_admin_user()` before it
    ever left dev**, because the only screen that manages fields is on `/admin/super-admin`.
    Shipping a policy that grants an ability no screen exposes is the guest/client defect
    again, just pointing the other way. Widen it the day a plain admin needs it.
  - Values mirror `task_links`' policy shape exactly, so guests and clients get read-only
    custom fields for free through `can_manage_task` - nothing new had to learn about board
    roles.
  - **The mirror between `lib/custom-fields.ts` and the trigger is a gate, not a claim.**
    `lib/custom-fields.cases.mjs` holds ~59 cases; `custom-fields.parity.test.ts` asserts the
    TypeScript validator agrees, and `check-work-items.mjs` writes every case to the real
    database and asserts the trigger agrees. Confirmed to fail on both sides when one case was
    deliberately flipped, rather than trusted to be meaningful.

- **`115` - `task_relations`.** Purely additive, `--allow-prod` eligible, seeds nothing.
  Seven relations, four stored rows: `blocks`/`precedes`/`duplicates` each derive their
  inverse, `relates_to` is symmetric and normalised to `source < target` by a trigger. Storing
  both directions is the obvious alternative and it rots - two rows that must agree forever.
  - ⚠️ **`task_links` is NOT this.** Despite the name it holds external URL bookmarks. Anyone
    reaching for "the links table" to answer "what blocks this" finds the wrong one.
  - ⚠️ **`task_relations_expanded` is `WITH (security_invoker = true)` and that is load-bearing.**
    A Postgres view runs as its OWNER by default, which would hand every signed-in user every
    relation between every task including private boards. The migration's post-conditions
    assert the option is set, because it is invisible in the view definition itself.
  - SELECT needs `can_view_task` on **both** ends, or the id of a task you cannot see leaks
    through the join. INSERT needs manage on the source and view on the target. DELETE needs
    manage on **either** end, deliberately wider: being wrongly marked as blocking someone
    else's work is a claim about your item too. There is no UPDATE policy or grant - changing
    an end or the type makes it a different relation.
  - Cycles are refused by a recursive walk in a `SECURITY DEFINER` trigger, so a loop passing
    through a task the caller cannot see is still caught.

⚠️ **Two harness traps this work turned up, both worth knowing before writing the next one.**
  - **A CONTROL case that passes for the wrong reason is worse than no case.** Two checks here
    were asserted against a `?task=` deep link after `page.reload()` - but `board-view.tsx`
    opens the modal and then `router.replace`s the param away, so the reload landed on a board
    with no modal at all. One check failed and the one after it *passed*, because the banner it
    was asserting absent was absent for the wrong reason. Re-navigate rather than reload, and
    assert the panel is on screen before asserting anything about its contents.
  - **A filter written against `source_task_id` is direction-dependent** once `relates_to`
    normalises the pair by uuid order, so the check passes or fails by how two random uuids
    happen to sort. Query either end, or use a directional relation type in the fixture.


### Migration `128` - owner decisions live in the product (dev AND prod, 2026-08-30)

`public.owner_decisions` plus a **Decisions** tab on `/admin/super-admin`. Purely additive: one
new table, one new function, one trigger **on that new table**, so no write path that existed
before passes through it. `--allow-prod` eligible, applied to prod the same day via
`--only=128 --allow-prod` after a `pg_restore --list`-verified backup
(`~/Code/prod-backup-pre-128-20260831-215237.dump`, 7.4 MB, 62 tables, chmod 444). Every row count
identical before and after: 173 tasks, 11 boards, 46 columns, 8 triggers on `tasks`, 1355
marketing items. It seeded **2 open and 2 resolved** decisions.

**It replaced `docs/product/open-owner-decisions.md`, which lasted one day.** A hand-maintained
file is a copy of a state nobody is obliged to update: the moment somebody resolves a decision the
file still says "waiting on you", and nothing distinguishes a live decision from a stale sentence.
That is this repo's most-repeated defect, and it is why `app_modules` is a table rather than a
constant. The file is now a pointer to the screen and nothing else.

- ⚠️ **Super-admin-only, and `private.is_admin_user()` would have been WRONG while looking
  right.** That helper is true for `admin` AND `super_admin` here, so the plausible mistake
  exposes governance records to three more people with nothing on screen saying so. Every policy
  is `private.is_super_admin_user()`. `pnpm check:decisions` has a plain-admin control case, and
  it was **confirmed to drop from 21/21 to 20/21** when the policy was widened to
  `is_admin_user()`, rather than trusted to be meaningful.
- **Closing a decision needs a note, enforced by a trigger rather than by the dialog** - six
  months on, the note is the only record of why. Reopening clears the note, resolver and
  timestamp together, so a reopened decision never carries an outcome that is no longer true
  (`103`'s carrier-column lesson).
- ⚠️ **`resolved_by` / `resolved_at` are stamped on UPDATE and cannot be supplied**, so the log
  cannot be made to say somebody else made a call they did not. They ARE honoured on INSERT, so
  a decision genuinely made last week can be entered with its real date; the asymmetry is the
  point, and only super admins can write at all.
- **Deprovisioning decided at creation** (119's lesson): `created_by`/`resolved_by` are
  `ON DELETE SET NULL`, never cascade and never reassigned. A decision is org furniture, so
  deleting its author must not destroy it, and reassigning would make the row claim somebody
  else made the call. The delete-user route needs no change.
- Gates: `pnpm check:decisions` (21, real RLS) and `lib/owner-decisions.test.ts` (13), plus a
  real-browser pass over the tab.

### Prompt G - optional Agile mode (`123`-`127`, 2026-08-29)

Five migrations. **`123`, `124`, `126` and `127` are on dev AND prod. `125` is on DEV ONLY and is
the one file that is not eligible** - read the per-file notes below before applying it. It is
registered in `scripts/held-migrations.mjs`, so prod reports `pending: 0   held: 1` and no bare
`pnpm migrate --allow-prod` can sweep it up on the way to a later file.

Prod went `122` -> `126` on 2026-08-29, one file at a time via `--only=NNN --allow-prod`,
verified between each, after a `pg_restore --list`-verified backup
(`~/prod-backup-pre-123to126-20260829-021936.dump`, 7.3 MB, 57 tables, chmod 444). **Every row count was
identical before and after**: 173 tasks, 11 boards, 46 columns, 5 statuses, 11 work item types,
10 profiles, 8 board_members. The only row that moved anywhere was the single `app_modules`
seed (11 -> 12), and it seeds **disabled**. `enforce_wip_limit` is absent from prod's `tasks`,
which still carries exactly the 8 triggers it had before; `public.wip_enforcement_installed()`
therefore returns **false** there, and every WIP badge on production says "warning only".
⚠️ `pnpm migrate:status` against prod reports **`held: 1`**, not `pending: 1`, and prints the
recorded reason. Applying it needs `--only=125 --allow-prod --release-hold=125` plus the owner
decision and backup that any override needs. **Re-examined 2026-08-30 and the answer was still
no**, for a reason worth keeping: `113` and `118` were both overridden because shipped code hard
-depended on them, and nothing depends on `125`. The badge and the settings dialog already ask
`wip_enforcement_installed()` (126) and say "warning only" where it is absent, so the product is
honest without it, and applying it would be the first override justified by nothing more than a
tidy ledger.

| file | what | prod eligible? |
|---|---|---|
| `123_agile_core.sql` | `board_agile_settings`, `sprints`, `sprint_items`, `tasks.estimate_value`, `columns.wip_limit`, the `agile` module row | ✅ purely additive |
| `124_sprint_metrics.sql` | `sprint_metrics` (frozen), `sprint_burndown_samples`, the two sampling functions | ✅ purely additive |
| `125_wip_enforcement.sql` | the trigger that actually refuses a move into a full column | ⛔ **trigger on `tasks`** |
| `126_wip_enforcement_probe.sql` | `wip_enforcement_installed()`, so the UI can tell which of the two worlds it is in | ✅ purely additive |
| `127_capacity_enforcement.sql` | the trigger that makes `capacity_mode = 'enforcement'` actually refuse | ✅ trigger on a `123` table |

⚠️ **`127` is the one to compare against `125`, because the pair is the clearest illustration of
what the `--allow-prod` rule is actually asking.** Both make an "enforcement" mode real. `125`'s
trigger sits on `tasks`, so it runs on every task move on every board in the product and is not
eligible. `127`'s sits on `sprint_items`, a table `123` created three files earlier, so **no write
path that existed before Prompt G passes through it** and nothing that already happens can start
behaving differently. Same feature, two very different risks, two files - and only one of them
needs an owner.

⚠️ **`125` is not eligible and must not get `--allow-prod` on an agent's judgement. It was
deliberately held back when the other three went to prod on 2026-08-29.** It is the
same class of change as `113` and `118`, both of which reached prod only as an explicit owner
decision after the risk was written down. The risk here, stated so it can be decided rather than
assumed: every task move on every board goes through the `tasks` UPDATE path and this trigger
runs on all of them. Three things bound it - it returns immediately unless the destination column
has a `wip_limit` (every column is NULL there), unless that column's board has
`wip_mode = 'enforcement'` (there are no settings rows at all until somebody opts in, and the
default is `warning`), and it never blocks a task already IN the column. So on the day it is
applied it is a no-op on 100% of writes, and reaching the `RAISE` needs three deliberate acts by
an admin on one board. `125`'s own post-conditions **abort** if any column already carries a
limit, so it cannot silently change live behaviour.

**Everything ships OFF, at three levels, and that is the feature.** Prompt G's first line is
"this module must be optional" and its second is "do not force Scrum language on marketing,
contracting, real estate, finance, operations":
1. `app_modules.agile` seeds **disabled**, like `appointments` (080) and `crm` (103). No nav
   item, and `/agile` itself redirects - the module is checked on the server, not only in the
   nav, because a toggle that hides a link is not a toggle (the `ai_assistant` lesson).
   ⚠️ **The module was switched ON for this org on 2026-08-30, on the owner's instruction**
   (a one-row `app_modules` update, the same write the Modules tab makes - not a migration).
   The SEED is unchanged and levels 2 and 3 are untouched: **no board has agile enabled**, so
   `/agile` is merely reachable and no board's vocabulary changed. Which boards opt in is
   tracked in `docs/product/open-owner-decisions.md`.
2. `board_agile_settings.is_enabled`, per board, and **`123` seeds zero rows**. A board with no
   settings row is a board with agile off, so nothing changed for any existing board.
3. `terminology` picks the noun - **sprint | cycle | iteration** - so one underlying model can be
   called whatever the board calls it. Every string on the screen comes from that setting.

Gates: `pnpm check:agile` (75, real RLS) and `pnpm check:agile-ui` (56, real browser, needs
`pnpm dev` on :3000 - confirmed stable across three consecutive runs). Counts were read off a
run. ⚠️ Both harnesses were **confirmed to fail** rather than trusted: 8 checks drop out when
`123`'s triggers are removed, and 3 more when `127`'s is disabled.

⚠️ **`check-agile-ui`'s sign-in presses the button until it takes, and that is not paranoia.**
`waitUntil: 'domcontentloaded'` returns on server-rendered HTML, and the form's submit handler
does not exist until React has hydrated - so on a dev server busy recompiling, the first click
lands on inert markup and does nothing. It surfaced as a bare 40-second `waitForURL` timeout that
reads exactly like broken auth, while `signInWithPassword` against the same project answered in
632ms. Same lesson as the `C` shortcut in `check-recurrence-ui`, one layer earlier in the page's
life. Two more traps from the same pass: **poll on the FINAL condition, not a weaker one** (a
reorder renumbers a column one row at a time, so "the moved item reached 0" is true after the
first write, and reading then reports duplicate positions that are simply not finished yet); and
**never pin a count assertion to a literal** - `=== 3` quietly became a false "the module forked
the work item" the moment the fixture grew.

**The one architectural rule everything else follows.** Taiga's, and Prompt G quotes it: *the
same underlying item is represented in Scrum and Kanban; never copy the task to make it appear in
a second methodology.* So there is no story table, no sprint-task copy and no second work-item
engine. `sprint_items` is a pointer. The backlog, planning pane, taskboard and metrics all render
`tasks` rows, and opening one deep-links into the board's own modal rather than a second editor
that could drift from it. **Epic/feature grouping is `parent_task_id` (113), not an `epic_id`**,
and **backlog order is `tasks.position`, not a second rank column** - two orders that must agree
forever is exactly what `115` refused for relations.

- **`is_agile_eligible` finally has a consumer.** `113` seeded it and nothing had ever read it -
  this repo's most-repeated defect in miniature. `123`'s membership trigger is the first reader:
  a `subtask` cannot be planned into a sprint on its own, because its parent already carries it
  and counting both double-counts every estimate in the burndown.

- **`tasks.estimate_value` is deliberately unit-free.** The unit is
  `board_agile_settings.estimate_unit` (`points|hours|days`), so a board can change vocabulary
  with no data migration and no column name can contradict the configuration. CLAUDE.md's Phase 3
  sketch called this `estimate_hours`; that name would have lied on any board counting points.
  **NULL means unestimated, and that is reported everywhere as its own number** - never folded in
  as zero. A plan that reads "12 of 20 points" while carrying six unsized items is the most
  common way a burndown flatters.

- ⚠️ **`sprints.start_date` / `end_date` are `DATE`, and nothing parses them into an instant.**
  `lib/agile.ts` compares them as `YYYY-MM-DD` strings through `lib/calendar-grid.ts`, and the
  server resolves "today" once with `businessDate()` and passes it down. This is the fifth-plus
  recorded instance of the family; see the `tasks.due_date` section above for what the opposite
  choice cost.

**The metrics half is where the design argument is.** Prompt G attaches a condition to all seven
numbers - *"Historical sprint data must not silently change when current project structure
changes"* - and every input keeps moving after a window ends. A task is re-estimated. A status is
re-categorised (`112` did exactly that to production's `pending_approval`). A board is
reorganised. Recomputing "what did we deliver in June" from today's rows therefore returns a
different answer every month with nothing on screen admitting it, and a velocity built on that is
worse than no velocity, because people plan against it.

- **While a window runs its numbers are computed live and labelled live. The moment it closes,
  `124`'s trigger writes a snapshot and every consumer reads that.** `sprintMetrics()` picks, so
  no screen has to remember. Proved by the harness: change every estimate to 999 and re-open the
  work, and the closed window's numbers do not move.
- ⚠️ **A closed window with no snapshot returns `null`, never a live recomputation.** "We have no
  record of this window" is the honest answer and the screen says it. Falling back would produce
  precisely the drifting number the ledger exists to prevent.
- **`authenticated` holds SELECT and nothing else** on both `sprint_metrics` and
  `sprint_burndown_samples` - the `crm_order_status_history` (103) / `recurrence_occurrences`
  (116) pattern. A ledger the application can write is one that can be made to disagree with what
  happened.
- **`included_task_ids` and `unestimated_count` are STORED**, because Prompt G requires every
  chart to expose included and excluded records and a footnote written beside a number drifts
  from it. `lib/sprint-metrics.ts` renders the whole panel - definition, formula, unit, included,
  excluded, last updated, live-or-frozen - **from the value object**, never from adjacent copy.
  `lib/work-next.ts` already shipped a reason line computed from a different expression than its
  score; once is enough.
- **A day with no burndown sample is a GAP, not a zero.** One cron job a day (Hobby plan) plus
  sampling on page open means gaps are expected, and a gap drawn as zero is a cliff that says the
  team finished everything overnight. The series reports `missingDays` and the caption says so.
  `UNIQUE (sprint_id, on_date)` makes both writers idempotent; **today's point refreshes and a
  past day never does**, which is the whole rule expressed at row level.
- **Velocity excludes rather than converts.** A window counted in hours is never averaged into a
  points velocity, and each exclusion is listed with its reason on screen.

⚠️ **A post-ship audit found the library had been re-implemented inside the components, and that
is worth reading before the next feature.** Seven exports had NO product call site: `agileActive`,
`loadAgileBoardData`, `setColumnWipLimit`, `wipBlockReason`, `explainMetric`, `moveInBacklog` and
`moveBetweenSprints`. Not one of them was unnecessary - each had a *second, inline copy* of itself
in a component, or a feature built around it that was never wired to a button. That is this
repo's most-expensive recurring shape (Prompt E's audit found three implementations of one filter,
disagreeing with each other), and it was reintroduced by the same person writing both halves in
one sitting. **A useful check before calling a feature done: list every export in its libraries
and grep for a call site outside its own tests.** What it turned up here:
  - **Backlog reordering did not exist.** Prompt G asks for "prioritized ordering ... drag and
    explicit menu actions" and there was neither; `moveInBacklog` sat unused. Now Move to
    top/up/down/bottom, offered **only when the list is unfiltered and ungrouped** - index 3 of a
    filtered list is not index 3 of the real order - with the reason on screen when it is not.
  - ⚠️ **`orderBacklog` sorted on `tasks.position` alone, which is not an order.** That column is
    an index WITHIN a column, so two tasks in different columns routinely both hold 0 and the
    comparator fell through to an alphabetical tie-break. It is `(column position, task position,
    title)` now, and reordering renumbers against the column's COMPLETE contents - backlog and
    sprint work together - because renumbering only the visible rows writes positions that
    collide with the ones it did not show.
  - **"Move to another sprint" was implemented and unreachable**, so carryover took two actions
    with a window in between where the item belonged to nothing.
  - **`canManage` conflated two capabilities**, so a board that had just switched agile on had a
    completely inert backlog: nothing could be created, sized or ordered until somebody made a
    sprint they had nothing to put in. Split into `canPlan` (needs an open window) and
    `canManage` (ordinary backlog work).
  - **`wipStatus`'s `enforcementAvailable` defaulted to `true`** - so a caller that forgot it
    claimed the database would refuse a move it will happily accept. It is a REQUIRED parameter
    now; the compiler found every omission, which is the point.

⚠️ **Four defects the harnesses found that review did not, all fixed:**
  - **`committed` was stamped at INSERT for a planned sprint, and that was wrong.** Work added to
    a planned window and then removed again *before it started* kept the flag, and would have
    been counted forever as part of a commitment it was never in. `committed` is now written in
    exactly one place: the activation branch of `enforce_sprint_state`.
  - **And that fix collided with the ledger's own immutability rule**, which refuses *any* change
    to `committed` - a trigger cannot tell one UPDATE from another. The permit is a
    transaction-local GUC (`set_config('agile.commitment_stamp', <sprint id>, true)`) that names
    the sprint being activated and is cleared immediately. Nothing may ride along with the flag
    in the same statement. **PostgREST executes no arbitrary SQL, so a client cannot set it - if
    an RPC is ever added that could, this is the thing it must not touch.**
  - **The estimate field rendered before its own value had loaded, and a fast edit was silently
    reverted.** The board's agile settings resolve from a single-row lookup; the work item needs
    four joins. So the settings won the race, the field appeared EMPTY with a real estimate still
    in flight, and the task load landing a moment later overwrote whatever had been typed -
    measured in a real browser as "typed 13, stored 3, no error". Gated on the task being loaded.
    ⚠️ **The rest of that modal has the same pre-existing race** (title, description and priority
    all render before their values arrive), and it is deliberately NOT changed here: it is older
    than this feature and worth fixing on its own terms rather than as a silent rider on an
    unrelated one.
  - **The WIP control was not gated on agile mode**, so shipping it would have put "Set WIP
    limit" into every admin's column menu on every board - including the marketing, contracting
    and finance boards the module exists to leave alone. It is the one piece of this feature that
    lives on an EXISTING screen, which is exactly why it was the piece that escaped the gate.
    Both the menu item and the header badge now read the board's own `is_enabled`, and both
    lookups resolve a missing table to `false` so the screen never has to be sequenced behind
    migration 123. Pinned by a control pair: offered with agile on, absent with it off, and the
    rest of the column menu untouched in both.

⚠️ **The tab strip pushed the whole page sideways at 320px**, and only `scripts/audit-mobile.mjs`
saw it. Radix's `TabsList` is `w-fit` and does not wrap, so four tabs measured 343px against a
320px viewport. It scrolls inside its own container now. **A horizontal strip whose length is a
function of how many things exist is the same shape as the board header nav that blew up twice in
2026-08.** After the fix: `/agile` flags 6 small touch targets, identical to `super-admin`'s
pre-existing shell chrome, and **zero** sideways scroll anywhere across 54 routes.

**Where things are:** `/agile` is a real route (not a `?tab=`), in the nav for every role when
the module is on. `lib/agile.ts` (vocabulary, window, capacity, WIP, backlog, swimlanes - 54
tests), `lib/sprint-metrics.ts` (the seven metrics and their explanations - 30 tests),
`lib/agile-data.ts` (every write classified through `lib/rls-write.ts`),
`components/agile/*`. The WIP limit is set from the **board's own column menu**, next to Link
Status, and the column header carries a `WIP n/limit` badge.

⚠️ **The WIP badge and the settings dialog never promise a refusal the database will not make.**
Both ask `wip_enforcement_installed()` and, where `125` is absent, say "warning only - nothing is
refused". A warning that turns out to be untrue is how people learn to ignore the next one, and
the alternative - offering an enforcement mode enforced only by a dialog - is the
`crm_statuses.requires_reason` defect (104) all over again.

**Not built, deliberately:** time tracking. Prompt G says Atlas time tracking, "if later needed,
is an independent optional module", and notes that Taiga does not provide it natively either.
There is no `time_entries` table and nothing pretends there is.

### Prompt F - My Work, WorkNext, Inbox and notification control (`120`-`122`, dev AND prod, 2026-08-28)

Three migrations, all **purely additive and `--allow-prod` eligible on this repo's own rule** -
new columns, new tables and one new function; no existing table, row, policy, grant or trigger is
touched by any of them. **All three are applied to dev AND prod** (prod on 2026-08-28, one file
at a time via `--only=NNN --allow-prod`, verified between each). Unlike `113` and `118`, none of
these needed an owner override: each is eligible on the standing rule.

**What the prod run found and produced.** Prod was at `119` with exactly these three pending, and
reported `applied: 122   pending: 0` after. **Every row count was identical before and after**:
173 tasks, 11 boards, 46 columns, 10 profiles, 5 statuses, and 193 notifications of which 133
were unread (the handoff had said ~121 unread - re-read it rather than trusting the number).
`120` and `122` seeded nothing. `121` seeded exactly **1** status.
Pre-migration backup: `~/Code/prod-backup-pre-120to122-20260828-140156.dump` (custom format,
`public` schema, `pg_restore --list`-verified at 55 tables, chmod 444).

⚠️ **`121`'s live blast radius on prod is THREE tasks, not one.** They are all on **Marketing PM
Sheet**, in the `pending_approval` column. CLAUDE.md's `112` note recorded "one live task sits in
that column" and that was true in August; it is 3 now. They keep category `started`, so nothing
about open-vs-closed, any dashboard count or any report changed - the only difference is that
their assignees now see them grouped under "Waiting on approval" in My Work, and WorkNext stops
recommending them as the next thing to do. Reversible with one UPDATE (see the migration header).

⚠️ **The app code hard-depends on all three and `/inbox` is in the nav for every role.** That
dependency is satisfied on prod now. Keep the order for any future rebuild: `122` needs
`task_follows` from `120`.

Gates: `pnpm check:inbox` (49, real RLS) and `pnpm check:inbox-ui` (32, real browser, needs
`pnpm dev` on :3000 - confirmed stable across four consecutive runs), plus `pnpm check:my-work`
(33, was 20). Counts were read off a run, not estimated.

- **`120` - the inbox.** `snoozed_until`, `entity_type` and `entity_id` on `task_notifications`,
  plus `task_follows` (state `following` | `muted`) and `board_mutes`.
  - **There is no new notifications table, deliberately.** `task_notifications` (035) already had
    inbox-shaped RLS (`recipient_id = auth.uid()` on SELECT *and* UPDATE), four writers and 84
    rows on dev. A second inbox next to it would give every user two places to look and two
    unread counts that disagree - the reasoning 117 already applied to reminders.
  - ⚠️ **NO STORED LINK PATH.** A board lives at BOTH `/admin/board/<id>` and
    `/dashboard/board/<id>`, and which one a person may open is a function of THEIR role, not of
    the notification. A path baked in at write time pins every later reader into whichever
    surface the writer happened to be on - the exact bug five call sites had in 2026-08-21. The
    row carries `entity_type`/`entity_id`; `notificationHref` composes the URL from
    `boardHref(role, id)` at read time.
  - ⚠️ **MUTE IS ENFORCED AT READ, FOLLOW AT WRITE**, and the asymmetry is deliberate. Follow can
    only work at write time (there is no row to reveal later if it was never created). Mute must
    work at read time, because the writers are ordinary client components and a mute depending on
    every writer remembering to check would leak the first time somebody added a fifth one -
    and because unmuting then brings the history BACK rather than having destroyed it.
  - **No `board_follows`.** Following a whole board would mean generating notifications nothing
    currently generates. Muting is enforceable today; following a board is not, so it is not
    offered - the `app_modules` / `profiles.is_active` / `board_members.role` lesson, applied
    before shipping rather than after.
  - **No admin bypass on any policy, asserted by a post-condition.** What a person has muted is a
    statement about their own attention. Same rule as `117`'s reminders and `119`'s personal
    views. ⚠️ This is also what forces `122` to exist - see below.
  - **Deprovisioning was decided at creation** (the question `119` had to learn the hard way):
    both tables CASCADE on `user_id`, which is right because a follow or a mute is private to one
    person and destroying it destroys nothing anyone else can see. **Neither needs a line in
    `app/api/admin/delete-user/route.ts`**, and `pnpm check:inbox` pins that deleting a person
    takes their preferences and no work item.
  - ⚠️ **`board_mutes` has no UPDATE grant, and supabase-js's default upsert therefore fails.**
    PostgREST's default upsert is `ON CONFLICT DO UPDATE`, and Postgres requires the UPDATE
    privilege for that *whether or not a conflict occurs* - so `.upsert({...})` was refused for
    every user, including on a board they had just created. `setBoardMuted` sends
    `{ ignoreDuplicates: true }` (`ON CONFLICT DO NOTHING`) and then probes, because DO NOTHING
    and an RLS refusal both return zero rows. Found by the harness, not by reading.
    **If you add a table whose rows are only ever created or deleted, expect this.**

- **`121` - `task_statuses.is_approval`.** One boolean, plus one seed: `key = 'pending_approval'`
  by EXACT key match, never a label heuristic (112's whole point). Dev has no such status so it
  seeded 0 rows; **prod has one**, so applying `121` there will flag it, and the visible effect is
  that its assignee sees that work grouped under "Waiting on approval" and WorkNext stops
  recommending it. To undo just that without reverting:
  `UPDATE public.task_statuses SET is_approval = false WHERE key = 'pending_approval';`
  - **Not a sixth category, and not an approvals module.** The five categories answer "how far
    along is this"; work awaiting sign-off has genuinely started, which is why prod's
    `pending_approval` was corrected to `started` by hand in August. Whether something is parked
    on a person is an ORTHOGONAL fact, so it gets its own flag. There is no approver, no request
    and no decision record, and nothing claims otherwise.
  - Reachable: **Super Admin → Statuses** has a "Waiting on approval" checkbox on both create and
    edit, and a badge on every row. Without it the column would be hand-written-SQL-only.

- **`122` - `notify_task_watchers(task, type, message, entity_type, entity_id)`.**
  SECURITY DEFINER, `authenticated`-only, asserted with `has_function_privilege()`.
  - ⚠️ **It exists because `120` made follows private, and that has a consequence people will
    hit again: the person writing a comment cannot see who follows the task.** A client asking
    gets back its own row and concludes nobody follows it - "hidden from you" and "does not
    exist" arriving identical, through a policy this time rather than a filter. The documented
    answer is a definer function that resolves past RLS and returns the narrowest possible
    result; this one returns a count and the follower list never leaves the database.
  - Audience: assignees (both `task_assignees` and the legacy `tasks.assigned_to`) + explicit
    followers, minus the caller, minus anyone deactivated (`101`). Muted people are deliberately
    still included - mute is applied when the inbox is read.
  - Callable by anyone who can VIEW the task, which is wider than the table's own INSERT policy
    (`can_manage_task`) and deliberate: a guest or client may comment on a board they can read,
    and a comment nobody is told about is not a conversation. The caller cannot choose the
    recipients, forge the actor, or reach a task they cannot see.

**What was actually broken, and is now fixed:**
  - **Commenting sent EMAIL and no in-app notification at all.** Four writers existed
    (`assignment` ×3, `update` ×1) and none of them fired for a comment, so the one channel
    people watch never heard about a conversation. Comments now write `comment` notifications
    through the RPC, and `@name` mentions write a targeted `mention` notification that lands in
    Action Required.
  - **Mentions reuse quick capture's resolver** (`findMentions` in `lib/quick-capture.ts`, sharing
    `matchPerson`), because a workspace where `@bobby` assigns work to one person and mentions
    another would be worse than having no mentions. An AMBIGUOUS token is flagged and skipped
    rather than resolved to whoever sorts first: telling the wrong person they were addressed is
    a harm they cannot detect.
  - **The update path notified assignees only**, so following a work item you were not assigned
    to could never have worked. It goes through the RPC now and runs even when a task has no
    assignees at all.
  - **`UNANSWERED_QUESTIONS` in `lib/my-work.ts` claimed "what am I blocking" needed task
    dependencies and "what needs approval" needed an approvals module.** `115` shipped the first
    two migrations ago and `121` ships the second here. **A documented limitation needs an owner
    or it becomes a claim the code no longer supports** - the note outlived the schema that
    closed it by two migrations. It now names two genuinely open gaps (milestones, the client
    portal), and `lib/my-work.test.ts` asserts the two closed ones never come back.

**My Work now has ten sections and they are a personal preference.** Overdue, Due today, Blocked
by others, Waiting on approval, Blocking others, In progress, Upcoming, Waiting on someone else,
Personal tasks, Recently viewed, Assigned to me - order and visibility per user, per browser, in
`localStorage` (`lib/my-work-preferences.ts`), per `097`'s standing rule that a presentational
preference does not earn a table. `parseMyWorkPreferences` REPAIRS what it reads: an id that no
longer exists is dropped and a NEW section is inserted at its default position, so shipping a
section is not the same as shipping it invisible to everyone who ever opened the panel.
  - ⚠️ **"Blocking others" means somebody ELSE is stuck**, and `isTaskOwnedBy` counts a task as
    yours when you are assigned to it **or created it**. The first version of the browser harness
    seeded "somebody else's work" as unassigned tasks created by the probe user, which are the
    probe user's own work - so the section correctly reported nothing while the harness insisted
    it should. A second account is required to test this at all.
  - ⚠️ **Only relations whose other end this page can RESOLVE are counted.** A relation row is
    readable only when both tasks are (115's policy), so an unresolvable end means the page
    filtered it - an archived board. Counting it would put a number on screen with nothing behind
    it. Stated in the code rather than left silent.

**WorkNext was EXTENDED, not replaced.** `scoreTask(task, now, signals?)` takes an optional
`WorkSignals`, so every existing caller keeps its exact old ranking (pinned by a test).
Blocked = -60 with the reason "Blocked by N items", awaiting approval = -40, blocking others =
+20. The penalties deliberately do NOT hide a blocked task: badly-late blocked work still ranks,
because the right next action there is to go and unblock it. Every signal is read ONCE into a
local and used for both the score and the reason - the module has already shipped a reason line
computed from a different expression than its score, and once is enough.

**Two defects only the real browser found**, both fixed and both pinned:
  - **The unread badge did not follow the page it mirrors.** Marking everything read emptied the
    inbox and left the bell saying 3 until its next two-minute poll. `lib/notification-events.ts`
    is a one-line DOM-event channel; a badge that disagrees with the page in front of you is
    worse than no badge.
  - **A slow `loadFollowState` overwrote a fast click.** Press Follow before the modal's initial
    read returns and its stale answer lands afterwards, putting the button back to "Follow" while
    the database says following. Fixed with a generation ref. It failed one run in three, which
    is the shape of bug that never shows up in review.

**Where the Inbox is:** `/inbox`, a real route (not a `?tab=`) in the nav for every role, plus a
bell in `AppTopbar` - rendered OUTSIDE the `actions` fallback on purpose, because every host
replaces `actions` with its own cluster and a bell inside it would exist on no screen at all.
Two buckets and no more: the plan says "avoid overclassification", and the only split that
changes behaviour is "does this need me, or is it telling me something". **Snoozed and Muted are
their own scopes rather than simply hidden** - a control that makes something vanish with no way
back is one people stop using - and the Muted view lists the mute rows THEMSELVES, so muting a
project that has produced nothing yet is still undoable.

⚠️ **An unknown notification `type` classifies as Action Required, not Updates.** Getting it wrong
towards Updates buries something that needed a person; getting it wrong towards Action Required is
noise the reader dismisses in one click. Noise is recoverable and a missed hand-off is not.

⚠️ **`scripts/check-recurrence-ui.mjs` cannot finish on this Mac, and it is not Prompt F.** It
passes 74 checks and then aborts in `page.request.get(...)` with `ECONNREFUSED ::1:3000`. Node
resolves `localhost` to `::1` first (verified with `dns.lookup`) and `next dev` binds IPv4 only,
so the Node-side request context fails where the browser's own `page.goto` succeeds. Same family
as the `db.<ref>.supabase.co` IPv6 note above. Nothing in Prompt F touches the cron route.

### Prompt E - the shared query/view engine (`118`-`119`, dev AND prod, 2026-08-25)

One configuration model that four layouts render from, at `/views`. **Both are applied to dev
AND prod** (prod on 2026-08-25, on the owner's explicit instruction, one file at a time via
`--only=NNN --allow-prod`, verified between each). `119` is purely additive and `--allow-prod`
eligible.

⚠️ Note **`118` was applied to prod despite NOT being `--allow-prod` eligible on this repo's own
rule** - it puts a trigger on `boards`, which changes the behaviour of writes that already
happen, the same reasoning that held `098` back. That was a deliberate owner decision after the
risk was stated, exactly as `113` was; **do not read it as precedent that the rule has changed.**

⚠️ **The app code hard-depends on both**: `app/views/page.tsx` selects `boards.parent_board_id`,
and the workspace reads and writes `saved_views`. `/views` is in the nav for every role, so the
code could not ship before the migrations - that dependency is satisfied on prod now. Keep the
`118` → `119` order for any future rebuild.

Pre-migration backup: `~/Code/prod-backup-pre-118to119-20260825-225719.dump` (custom format,
`public` schema, `pg_restore --list`-verified at 54 tables, chmod 444). Prod was at `117` with
exactly these two pending before the run, and reported `applied: 119   pending: 0` after. Both
migrations self-verify inside their own transaction, so a failure rolls back whole rather than
half-applying; neither raised.

⚠️ **Both seed nothing.** `118` leaves every board a root (its post-conditions assert it) and
`119` creates zero views, so the deploy changed nothing anyone could see. The first hierarchy
appears when an admin picks a parent in Boards → New/Edit.

Gates: `pnpm check:views` (65, real RLS) and `pnpm check:views-ui` (38, real browser, needs
`pnpm dev` on :3000 - confirmed stable across four consecutive runs). Both counts were read off
a run, not estimated.

**The audit found three implementations of one idea, and they disagreed.** Prompt E opens with
"FIRST AUDIT ... find duplicated filter logic", and it was there: `reports-view.tsx` held NINE
`useState`s reduced by a hand-written `applyFilters()` inside a `useEffect` that wrote into a
SECOND state; `board-view.tsx` had an inline `filterTasks()` over four controls; and
`calendar-view.tsx` had no filters at all. Reports offered Unassigned and the board did not; the
board offered "overdue" and reports did not; reports could filter by tag and status and the
board could not. All three now route through `lib/view-config.ts`.

⚠️ **Collapsing them fixed a live timezone bug in both screens, AND SHIPPED A NEW ONE. Read the
correction before trusting this paragraph.** The old code compared `new Date(task.due_date)`
against a local midnight, so a task due today counted as overdue for a five-hour window every
evening and Reports' From/To boundaries moved with the reader's timezone. That much was real and
is fixed.

⚠️ **But the replacement was also wrong, for a worse reason: this paragraph used to call
`due_date` "a `YYYY-MM-DD` DATE column", and it is `TIMESTAMPTZ`.** Every real row is an instant
at midnight, overwhelmingly `T00:00:00+00:00` - and the fix resolved that through
`BUSINESS_TIME_ZONE`, which lands on the day BEFORE. So from the Prompt E deploy until
2026-08-27, **`/views`, the board and Reports returned a task due TODAY from the `overdue`
filter**, all day rather than for five hours. Measured against the shipped code with a real row
shape, then fixed by splitting `dueCalendarDate` (a stored day) from `calendarDateOf` (a true
instant). Full detail in the Conventions section above.

The reason it got through: `lib/board-filters.test.ts`'s "the timezone bug this replaced" block
used bare `'2026-08-25'` fixtures, which is the one shape that survives the new bug untouched.
There is now a "the SHAPE the due_date column really has" block alongside it using the two forms
the app actually writes.

- **`118` - `boards.parent_board_id`.** `boards` had NO parent column at all - verified against
  dev and prod, not assumed - so Prompt E's loudest requirement had nothing to stand on.
  ATLAS_01 4.6 is specific about why the wording matters: Vikunja users maintain the descendant
  list BY HAND in a saved filter, so a project created this morning is invisible to the roll-up
  until somebody edits it. Here membership is **computed at read time** by walking the column,
  so there is no list to update. `ON DELETE SET NULL`, never CASCADE: deleting a parent must not
  destroy the work under it, and its children become roots.
  - The cycle guard is `SECURITY DEFINER` for the same reason `115`'s is: a loop routed through
    a board the caller cannot SELECT must still be caught, because `board_descendants` recurses
    and a cycle in the data is an infinite loop in every view built on it.
  - ⚠️ The trigger is `BEFORE INSERT OR UPDATE OF parent_board_id, **id**`. `id` is named for
    `104`'s reason: an `OF column` clause cannot police the columns it does not fire on.
  - **Privacy needed no new rule, deliberately.** `public.board_descendants` is SECURITY
    INVOKER, so it returns exactly the boards the caller may SELECT - an unreadable child is
    simply absent. This is the ONE place in this repo where "hidden looks identical to does not
    exist" is the behaviour we want, because the alternative is announcing that the board
    exists. Do not add an admin bypass to make the counts tidier.
  - Reachable: `board-management.tsx` has a **Parent board** picker on both create and edit,
    and it excludes the board itself and its whole subtree rather than offering a choice the
    database will refuse (ATLAS_01 10.2). Without that control the column would have been
    hand-written-SQL-only, which is this repo's most-repeated defect.

- **`119` - `saved_views`.** The config is ONE jsonb document, **against this repo's own habit**,
  and the trade is deliberate: `114` argued the opposite for custom field VALUES because a value
  must be independently addressable by concurrent writers, and a view config is the opposite
  kind of thing - read and written whole, by one owner. The cost is that Postgres cannot
  type-check inside it, so a trigger validates the shape the renderer cannot survive without
  (an object, a known layout, arrays where arrays are indexed) and deliberately **nothing more**,
  so adding a field stays a code change rather than a migration.
  - **A personal view is private, including from admins.** No admin term on any policy, and a
    post-condition asserts the SELECT policy never grows one - the same guard as `117`'s
    `task_reminders`. Admins can manage SHARED views only, because those are org furniture and
    somebody has to tidy up after a departure.
  - A board-scoped shared view is bounded by the board: the SELECT policy reads `boards` through
    the CALLER's own policy, so a shared view on a private board is invisible to a non-member
    without this policy knowing anything about board privacy. ⚠️ Residual, stated in the header
    rather than hidden: a GLOBAL shared view is visible to every signed-in user and its config
    may name private board uuids. That leaks ids, never content.
  - ✅ **Deleting a person CASCADEs their views - right for personal ones, wrong for shared
    ones. CLOSED 2026-08-27**, before Prompt F. `app/api/admin/delete-user/route.ts` now
    transfers `scope = 'shared'` to the deleting super admin before the delete, exactly as it
    does boards, and leaves personal views to cascade. See the `100` section above for the
    reasoning and the four new harness checks. ⚠️ Note `119`'s own file header claimed the
    route already did this on the day it was written; it did not, and nothing caught the gap
    for two days. **A header that describes intended behaviour elsewhere in the codebase is a
    TODO, not a fact** - it needs a check that fails until it is true.

**`lib/view-config.ts` is the single answer, and four decisions in it are worth arguing with:**
  1. **"current user" is a VALUE (`@me`), not an operator**, though Prompt E lists it beside
     `is` and `before`. As an operator it can only say "assignee is me"; as a value it composes -
     `is not @me`, `@me or Bob`, `created_by is @me` - and the operator list stays orthogonal to
     the field list. Resolved at evaluation time, never baked in, so a SHARED view does not
     silently mean "assigned to whoever saved it". The harness pins that it is stored verbatim.
  2. **One ordered `fields` array**, not `visibleFields` + `fieldOrder`. Two arrays that must
     agree forever is what `115` refused for relations: they rot, silently.
  3. **No nested boolean groups.** Prompt E says to add them "only if the UI can explain them",
     and that is a constraint, not a suggestion - one join applies to the whole bar so it reads
     as one sentence. Several values on ONE condition cover "Ann or Bob" without loosening
     every other row.
  4. **`search` is deliberately NOT saved** with a view. A free-text box is what you are doing
     this minute, not how you like to look at work.

⚠️ **Virtualization is deliberately absent from the table, and the reason is a row count.** Prod
holds 171 tasks. A windowed table at that size breaks the browser's own Cmd-F, Cmd-A, printing
and the screen-reader row count, in exchange for a scroll that is already smooth. The honest
trigger is thousands of rows in one view, plus a "showing N of M" line so the loss is visible.

⚠️ **`enforce_task_lifecycle` rewrites `column_id` on INSERT, and it will silently break a test
fixture.** `tasks.status` defaults to `'to_do'`; when it disagrees with the target column's
`status_key`, the trigger MOVES the row to whichever column on that board carries the requested
status. So seeding a "finished" task by `column_id` alone lands it in To Do, and every status
assertion downstream then tests the wrong fixture - observed while building `check-views-ui`,
which now asserts the row stayed where it was put. Set `status` to match the column.

⚠️ **Four defects the real-browser pass found that review did not**, all now fixed and pinned:
  - **A view saved while scoped to a board was unreachable on the next visit.** The picker was
    filtered by the current scope (`viewsForBoard`), and `/views` opens with no board selected -
    so it hid exactly the views that would SET that scope. Chicken-and-egg, invisible in code.
  - **The table's inline-rename control was permanently invisible to a mouse.** It is
    `opacity-0 group-hover:opacity-100`, and no ancestor carried `group`, so it was reachable
    only by tabbing to it.
  - **A React key warning from `TableLayout`** - the group map returned a bare `<>`.
  - **`page.locator('table input').first()` matched the header's select-all checkbox**, not the
    rename field. Same shape as the `button[role="combobox"]` trap already recorded.

⚠️ **And one harness trap worth naming: a Radix dropdown will not reopen mid-close.** The first
Options interaction passed and the very next one timed out on identical code, because Radix
returns focus to the trigger as the menu unmounts and swallows a second open issued during it.
`menuPick()` reopens until the item is really visible. Same family as the polling lesson - never
`click(trigger); click(item)`.

### Migration `087` - was held back from prod on purpose; it is now applied (2026-08-19)

`scripts/087_marketing_checks_shared.sql` widens SELECT/DELETE on `marketing_calendar_checks` from
per-viewer to calendar-membership, so members see one shared posted/missed state. It is
self-verifying per the convention above and covered by `pnpm check:marketing-calendars`.

**It is on prod now** - confirmed in `applied_migrations`, alongside `096`–`102` and `104`. This
section previously said "deliberately NOT applied to prod, apply it the day a non-admin is given
calendar access", and that instruction is spent: someone applied it. Kept here because the
*reasoning* is still the useful part - the gap was harmless for as long as it lasted, because every
marketing calendar member is an admin and admins already read every check row (see the People
section). Nothing about the feature changed when it landed.

### Prompt D - capture, bulk editing, recurrence and reminders (`116`-`117`, dev AND prod, 2026-08-24)

Two migrations plus four pure libraries. **Both are applied to dev AND prod** (prod on
2026-08-24, one file at a time via `--only=NNN --allow-prod`, verified between each). Both are
purely additive - new tables and functions, no existing table, row, policy, grant or trigger
touched - so both were `--allow-prod` eligible on this repo's own rule, unlike `113`.

**What the prod run produced.** `116`'s own post-conditions reported **10 rules backfilled, 4
recurring tasks skipped as unschedulable, 0 occurrences generated**, and `117` reported
**0 seeded, 0 delivered**. Every row count was identical before and after: 171 tasks, 11 boards,
10 profiles, `is_recurring` still 14. Because every backfilled rule is `on_completion`, the
deploy created no work on day one - the first new instance appears when someone completes one of
those ten tasks. Pre-migration backup:
`~/Code/prod-backup-pre-116to117-20260824-204753.dump` (custom format, `public` schema,
`pg_restore --list`-verified at 51 tables, chmod 444). Deployed as `a72120e`; the cron route was
re-verified against the LIVE site (401 with no header, 401 with a wrong secret), which is also
the proof that the `lib/email.ts` import crash is not in production.

⚠️ **The 4 recurring tasks with no cadence are still an owner decision, not a bug.** They are
all on Marketing PM Sheet, created 2026-06-18, with no due dates, and they read as ongoing
efforts rather than scheduled repeats. They deliberately got no rule, no row was modified, and
the panel reports them as incomplete on screen. Clearing `is_recurring` is the recommendation;
inventing a cadence for them is not.

⚠️ **The app code hard-depends on both**, and on `112`: the board's recurrence and reminders
panels query `recurrence_rules` / `task_reminders`, the generator resolves open-vs-closed through
`task_statuses.is_closed`, and `use-reminder-delivery.ts` calls `deliver_my_due_reminders()` on
every page. That dependency is satisfied on prod now. Keep the `116` → `117` order for any
future rebuild.

Gates: `pnpm check:recurrence` (84, real RLS) and `pnpm check:recurrence-ui` (75, real browser,
needs `pnpm dev` on :3000). Both counts were read off a run, not estimated.

**What was actually broken.** `025` and `086` put five recurrence columns on `tasks`, a toggle on
two dialogs and a badge on the card - and `086`'s own comment states the position plainly:
"nothing currently spawns task instances from it." Measured on production: **14 tasks carry
`is_recurring = TRUE`, and 4 of them have a NULL pattern.** None has an end date. Separately,
`lib/reminder-service.ts` was a `'use server'` function whose comment said it "should be called
via a cron job" with **zero call sites**, no `vercel.json` and no cron. Third instance of the
same defect after `profiles.is_active` (`101`) and `app_modules` (2026-08-15): a control that is
present, prominent, believed, and wired to nothing.

- **`116` - `recurrence_rules` + `recurrence_occurrences`.** The rule and the ledger are separate
  tables because they are separate things. `UNIQUE (rule_id, occurrence_date)` is the entire
  idempotency story and it is enforced by Postgres, not by the generator remembering to check -
  so "a retried job must not duplicate an occurrence" is a property of the schema.
  - `recurrence_occurrences.task_id` is **`ON DELETE SET NULL`, never CASCADE.** Deleting a
    generated task must not erase the record that it was generated, or the next sweep produces
    it again. "I deleted this week's instance" is not "make it again every run."
  - `authenticated` holds **SELECT and nothing else** on the ledger, mirroring
    `crm_order_status_history`. A ledger the application can write is one that can be made to
    disagree with what happened, and every guarantee here rests on it being accurate.
  - **No trigger on `tasks`**, deliberately. After-completion generation is handled inside
    `run_recurrence_generation()` by asking whether the newest occurrence is closed, which is
    what keeps this migration additive. The board calls the same function on completion so the
    next instance appears immediately; the nightly sweep is the safety net; both are idempotent
    so they cannot disagree.
  - **The backfill made 6 rules on dev / expects 10 on prod, and deliberately skipped the 4 NULL
    patterns.** `frequency` is NOT NULL and there is no defensible way to guess whether "repeats"
    meant daily or monthly. Those tasks keep `is_recurring = TRUE`, no row was modified, and the
    panel reports them as incomplete. Every backfilled rule is `on_completion`, so **day one
    generates nothing** - horizon mode on the same rules would have created roughly 80 tasks
    against a 171-task database.
  - `112` is a hard prerequisite: the destination column for a new occurrence is resolved through
    `task_statuses.category`, never a column title, and "closed" is `is_closed`. That is why
    cancelling a task advances an `on_completion` rule exactly as completing it does.

- **`117` - `task_reminders`.** Per-user, private, with **no admin bypass on any policy** - the
  only table in this schema an admin deliberately cannot read, asserted by a post-condition so it
  cannot be softened by accident. Prompt D's "a reminder is not necessarily a global task
  property" is the whole design. `delivered_at` is stamped inside the same statement that selects
  the row, so two overlapping runs cannot both deliver.

⚠️ **`REVOKE ALL ON FUNCTION ... FROM PUBLIC` DOES NOT MAKE A FUNCTION PRIVATE IN THIS DATABASE.**
The single most important thing learned here. `postgres` carries a **default ACL granting EXECUTE
on every new function in `public` to `authenticated`** (`pg_default_acl`), which is a real grant
that `REVOKE ... FROM PUBLIC` leaves untouched. `095` closed this for `anon` on TABLES; the
function default was still wide open. Both new migrations shipped to dev with it before
`has_function_privilege()` was actually queried rather than reasoned about:
  - `create_recurrence_occurrence` is `SECURITY DEFINER` and was callable by any signed-in user,
    which would have let anyone create an occurrence on any rule for any date, bypassing paused,
    `ends_on`, `max_occurrences` **and RLS**.
  - `deliver_due_reminders` is `SECURITY DEFINER`, sweeps every user's reminders and RETURNS
    their ids, task titles and email status - a disclosure on the one table built to be private.
  Both are now `REVOKE ... FROM PUBLIC, anon, authenticated`, and both migrations assert it with
  `has_function_privilege()`. **Any new function in `public` must state its grants explicitly and
  assert them; the default is not "nobody".**

⚠️ **A CHECK constraint PASSES when its expression is NULL, and `array_length('{}', 1)` is NULL.**
`recurrence_rules_weekdays_check` read `array_length(weekdays,1) BETWEEN 1 AND 7` and therefore
accepted the empty array - precisely the value it was written to reject, a weekly rule that can
never fire. It is `COALESCE(array_length(weekdays,1), 0)` now. Caught by `check-recurrence.mjs`,
not by reading, which is why that migration's post-conditions now **try to insert the bad value**
rather than assert the constraint exists. "The constraint exists" and "the constraint refuses
this" are different claims.

⚠️ **The Vercel project is on the HOBBY plan: cron jobs run once a day, maximum two.** Verified
via `vercel api /v2/teams/... -> billing.plan`. That is a hosting fact that shapes the design:
  - `vercel.json` (new) declares one daily job at `/api/cron/scheduled-work`, guarded by
    `CRON_SECRET`. It drives recurrence generation and reminder delivery, and is the **only**
    sender of reminder email.
  - A daily sweep cannot honour "30 minutes before", so `117` also exposes
    `deliver_my_due_reminders()` - the same delivery scoped to `auth.uid()`, with no parameter
    that could widen it - and `components/notifications/use-reminder-delivery.ts` calls it on
    mount, every 5 minutes, and on tab focus. In-app reminders are therefore near-real-time for
    anyone using the app; email is a once-a-day guarantee and the reminder UI says so.
  - **`CRON_SECRET` is set** (2026-08-24) in `.env.local` and in Vercel for Production and
    Development. Preview was skipped deliberately: `vercel env add` wants a branch for it, and
    Vercel Cron only fires on Production deployments. Without the secret the route returns 401
    and the sweep silently never runs, which looks identical to a healthy schedule from outside,
    so `pnpm healthcheck` asserts all three of route/vercel.json/secret (replacing the old
    `Worker (reminders)` warning for risk R-07). `lib/reminder-service.ts` is **deleted**, not
    repaired - a second, unfired path next to a working one is the confusion this work removes.
    Verified by curl: no header -> 401, wrong secret -> 401, right secret -> 200 with a body
    naming rules considered and reminders delivered.
  - Upgrading the plan and tightening `vercel.json` is the entire upgrade path. Nothing in the
    database or the app changes.

**The four libraries are pure and heavily tested, deliberately** (`lib/recurrence.ts`,
`lib/quick-capture.ts`, `lib/multi-create.ts`, `lib/bulk-operations.ts` - 1164 unit tests total
across the repo now):
  - `lib/recurrence.cases.mjs` is a **parity gate** in the same shape as
    `lib/custom-fields.cases.mjs`: 43 date-math cases run against the TypeScript mirror by
    `recurrence.parity.test.ts` AND against the real `public.next_occurrence_date()` by
    `check-recurrence.mjs`. Neither side is the reference - one draws the editor's preview, the
    other creates the work, and a preview that disagrees with the generator is worse than none.
    Confirmed to fail on both sides when one case was deliberately flipped.
  - **Quick capture never silently discards user text**, which is Prompt D's stated requirement
    and is enforced as a property test, not by example: every character of the input ends up
    either in the title or inside a returned match with verbatim start/end offsets. An `@name`
    that matches nobody stays in the title and warns; an ambiguous one warns rather than
    resolving to whoever sorts first. **No LLM** - the syntax is deterministic and a model that
    gets "next Friday" right 97% of the time is unusable for scheduling.
  - **Multi-create reports indentation, never acts on it.** Nesting is off by default even when
    it looks unambiguous, and mixed tabs/spaces or many indent widths are reported as ambiguous.
    `060` allows one level only, so deeper pastes are flattened **with a count**, not discovered
    as a database error mid-batch.
  - **`lib/bulk-operations.ts` plans before it runs.** An already-matching task is counted as
    unchanged, not changed, so "18 of 30 will change" is the number the confirmation shows and
    the number that then happens. A run with any refusal or error is **never** reported as a
    success - the failure mode being guarded against is a green toast over a batch that
    half-worked, which is easy here because an RLS refusal returns zero rows and no error. The
    execution loop takes its per-item write as a parameter so the retry and partial-failure
    behaviour is unit-testable with a fake.

⚠️ **The board header ran out of room again, and the failure is silent.** Adding Quick add and
Select to the actions strip pushed the board title to **0px wide** and the header to three rows -
the same lesson as the header nav in 2026-08-21, one layer out. The title block is `flex-1` next
to a strip that sizes to its content, and `truncate` means it collapses to nothing rather than
overflowing visibly. Fixed with a floor (`lg:min-w-[13rem]` on the title block) and a cap
(`lg:max-w-[62%]` on the strip) so the NEXT button added cannot do it again. Pinned by
`pnpm check:board-nav`, which measures the title's real width.

**Ceilings are deliberately generous, and the harness asserts they ACCEPT.** `interval_count`
1..1000, `horizon_days` 1..1095, `max_occurrences` 1..10000, reminder `offset_minutes` 0..525600
(a full year - the first version capped it at 60 days, which would have refused the "three
months before" that renewal and compliance work actually wants), reminder `note` 2000 chars.
Sweep ceilings are per-CALL and not per-feature: `deliver_due_reminders` takes 5000 and
`deliver_my_due_reminders` 1000, and because delivery is idempotent the only cost of hitting one
is latency, never a lost reminder. A bounds check that only proves refusals cannot tell a
generous ceiling from a broken table, so `check-recurrence.mjs` pins a schedule at the very top
of every bound being accepted.

⚠️ **A loop guard that truncates silently is a bug generator, not a safety net.** The catch-up
walk in `run_recurrence_generation` stopped after 500 steps and then carried on with whatever
date it had reached - so a daily rule older than 500 days would quietly create an occurrence
dated in the **past**. And the schedule-mode fill guard was 400, fewer than a daily rule needs at
even the old 365-day horizon, so it would have stopped filling part-way with no indication. Both
are 20000 now (~54 years of daily, an order of magnitude above the 1095-day horizon ceiling that
bounds the legitimate maximum), and exhausting the catch-up guard **reports a skip reason and
continues** rather than fabricating a date. Pinned by a five-year-old rule in the harness.

⚠️ **`lib/email.ts` crashed on IMPORT when `RESEND_API_KEY` was unset, and that took down
recurrence.** `new Resend(undefined)` throws, and the client was constructed at module scope -
so the `if (!process.env.RESEND_API_KEY) return` guard inside `sendEmail()` could never run. Any
file importing it died, including `/api/cron/scheduled-work`, which returned **500 to every
request including unauthenticated ones**: it could not reach its own auth check. Two unrelated
features taken out by one missing variable, since that route also drives task generation. The
client is lazy now (`getResend()`), which fixes the four components that import it too. Found by
curling the route, not by reading it.

⚠️ **`unassign`, `unlabel` and `move` were implemented in `lib/bulk-operations.ts` and had no
button.** Working code behind no route a human could take - the same defect as
`board_members.role` and `app_modules`, and a union type cannot catch it because an incomplete
array of a union is still a valid array. The bar's list is now **derived** from the engine's
exported `ALL_OPERATIONS` rather than restated, so a new kind can at worst appear in the wrong
position, never vanish. Also fixed the mirror of it: `117` granted UPDATE on a reminder's own
columns and no screen used it, so reminders are now editable in place (a *delivered* one stays
read-only - it records a notification that was really sent).

⚠️ **Two browser-harness traps, both already recorded in other words and both bit again.**
  - **`page.locator('button[role="combobox"]').first()` finds a control on the page BEHIND the
    dialog.** It is visible, enabled and permanently un-clickable under the overlay, so the
    failure reads as a 30s timeout rather than "wrong element". Every control in
    `bulk-action-bar.tsx` now has an explicit id and the harness locates by id.
  - **A fixed `waitForTimeout` after a React state update is a flaky assertion**, and a flaky
    assertion is worse than none because it teaches you to re-run until green. The chip-dismiss
    check passed, then failed, then passed on identical code. It uses `waitForFunction` on the
    actual value now.

**Prompt D completion pass (2026-08-24) - four gaps closed after the first audit called it done.**
The migrations and libraries were finished; what was missing was reachability and disclosure,
which is the half this repo keeps getting wrong.
  - **Editing a schedule never said what happened to the work it had already produced.** The
    behaviour was always right - `authenticated` holds SELECT and nothing else on
    `recurrence_occurrences`, so an edit *cannot* rewrite history - but Prompt D's requirement is
    that it must not do so **silently**, and "cannot" is only half of that. `handleDelete` had
    always said "Tasks it already created were kept"; `handleSave` now says the same for an edit.
  - ⚠️ **`retryPlanFrom` / `mergeRunReports` did not exist, and `BulkRunReport.retryableIds` had
    been sitting there since the file was written with a comment calling it "the input to
    'retry the rest'".** A field built for a purpose, believed, and consumed by nothing - the
    same defect as `board_members.role` and `app_modules`, in miniature. The report dialog now
    offers **Retry N failed** and shows an attempt count on any row that took more than one try.
    Refusals are deliberately excluded from that set and the dialog says why, because retrying a
    policy refusal just asks the same question again.
  - **`C` opens quick capture**, matching `?`'s guard shape in `help-dialog.tsx` rather than
    inventing a second convention. Guarded three ways: a modifier means the user wants the
    browser, a text field means they are typing the letter, and an open `[role="dialog"]` means
    something already has their attention. Gated on `task.create` so it cannot open a dialog
    whose Save would be refused.
  - ⚠️ **And that immediately exposed a real gap: `HelpDialog` lives in `AppTopbar` → `AppShell`,
    and a board renders OUTSIDE AppShell.** So `?` did nothing on a board, and the only place any
    shortcut is written down was unreachable from the screen where the new one works. Third
    instance of the board-is-not-in-the-shell problem after `ThemeControls` and the header nav.
    `HelpDialog` is mounted next to `ThemeControls` now. `pnpm check:board-nav` still passes
    (title 165px, header 113px), but that header has now blown up twice - **check it after
    adding anything to it.**

⚠️ **The UI harness was flaky and had been passing by luck.** Three consecutive runs of
IDENTICAL code failed three DIFFERENT checks (`quick capture really creates a task`, `the
indented lines became real subtasks`, `the bulk change really lands in the database`), and one
pair failed in a way that made the behaviour look broken when it was not: `Run now` reported
`0 created` and then `0 -> 5`, because the first read happened before generation finished and
the second after. Every database assertion in `check-recurrence-ui.mjs` was
`click(); waitForTimeout(2500); read()`. They all use a polling `until(read, accept)` helper
now, and the idempotency check additionally waits to SEE the "Nothing to create" message -
otherwise "nothing changed" passes for the trivial reason that nothing has happened yet. Also
worth keeping: **a document-level `keydown` listener does not exist until React has hydrated,
and `waitForSelector` returns on server-rendered HTML**, so the first `C` press landed on a page
with no handler; the check presses until it opens or the budget is spent. Confirmed stable
across four consecutive full runs at 75/75.
