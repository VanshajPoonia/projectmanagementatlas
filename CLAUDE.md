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

- Migrations: numbered SQL in `scripts/`, continuing from `120`. **Dev and prod were both
  verified fully applied at `119` on 2026-08-25**, 0 pending on each. Wrap in `BEGIN; … COMMIT;`,
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
  - ⚠️ **Still data, not code: prod has two empty calendars.** "Kayla's Personal" (0 events, 0
    members) and "TEST" (0 events, 3 members, created by Bobby). Kayla is the only member of the
    real **Marketing Calendar** (1358 events), so Bobby and Vanshaj resolve to "TEST". Archiving
    the two empties in Manage Calendars is the other half; that is an owner decision, not a fix.
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
categories that fits. One live task sits in that column, so the blast radius was one card
moving from the "to do" bucket to "in progress" on dashboards and reports. It was done as a
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

⚠️ **Collapsing them FIXED A LIVE TIMEZONE BUG in both screens.** The old code compared
`new Date(task.due_date)` - a `YYYY-MM-DD` DATE column parsed as UTC MIDNIGHT - against a local
midnight. West of Greenwich those are different days, so **a task due today counted as overdue
for a five-hour window every evening**, and Reports' From/To boundaries included or excluded a
task depending on the reader's timezone. Same defect already recorded for the CRM. Everything
now compares calendar dates in `BUSINESS_TIME_ZONE`. Pinned by `lib/board-filters.test.ts`'s
"the timezone bug this replaced" block, which asserts both instants agree.

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
  - ⚠️ Deleting a person CASCADEs their views. That is right for personal ones and wrong for
    shared ones; `100`'s reasoning about reassigning boards applies, and the delete-user route
    has NOT been updated for this yet.

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
