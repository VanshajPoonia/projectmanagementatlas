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
  **Not wired:** the floating `AiChatWidget` and the embedded `BookmarksSection` rail render
  unconditionally in all three dashboard shells (user/admin/super-admin) - `ai_assistant` and
  `bookmarks` exist as toggleable rows in `app_modules` but aren't consumed at those render sites
  yet. Scoped out because it touches three more large files; pick up if a super_admin actually needs
  to turn either off.

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
`pnpm check:access-matrix` (51 checks), which covers the plan's full matrix and pins all three
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
- `tasks.estimate_hours` - ship the column early so data accumulates before workload is built.
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

- Migrations: numbered SQL in `scripts/`, continuing from `108`. Wrap in `BEGIN; … COMMIT;`,
  use `IF NOT EXISTS`, and write the intent as a comment header - match the style of
  `047`, `049`, `056`. **Migration state drifts between dev and prod - always run
  `pnpm migrate:status` rather than trusting a number written down anywhere, including here.**
  As of 2026-08-19, verified by running the runner against both: **dev and prod are BOTH fully
  applied at `107` - all 107 files, zero pending on either.** `105`–`107` went to prod with
  `--only=105,106,107 --allow-prod`, which is what the runner's `--only` flag exists for.
  ⚠️ **The per-migration notes below saying a given number is "dev-only" are HISTORICAL** -
  each was true the day it was written and most have since been applied. `087`, `096`–`102`
  and `104` are all on prod now. The ledger is the only truth; those notes are kept for the
  *reasoning* they record about what each migration does, not as a statement of where it
  lives. This block has been wrong twice before (it said prod was at `095` when it was at
  `101`, then at `101` when it was at `104`), which is why the rule above is to run
  `pnpm migrate:status` rather than read this sentence.
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
  zero rows and no error. `ai_assistant` and `bookmarks` are labelled in that UI as not yet
  consumed at their render sites, which is still true.
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
  - **Boards are the one thing reassigned rather than nulled**, and that happens in
    `app/api/admin/delete-user/route.ts`, not in SQL. `boards.created_by` is not a byline:
    `061` makes it the sole authority over a private board's membership list, with no admin
    bypass, so a NULL creator would freeze that list permanently. The route transfers boards
    to the super admin doing the deletion first, then deletes the account. Tasks and
    comments are deliberately **not** reassigned - that would make them claim to have been
    written by whoever ran the deletion. Gate: `pnpm check:deprovision` (20 checks).
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
