# Platform rebuild — plan & guardrails

**Consolidated 2026-07-24:** all work now happens in this one folder
(`/Users/vanshajpoonia/Code/Project manager`) on `main`. The former separate `pm-platform`
worktree (branch `platform`) was fast-forward-merged into `main` and is deprecated — do not use it.
`main` is both the live app AND where the rebuild continues.

**Single organization, not multi-tenant SaaS (owner ruling, 2026-07-24):** this product is being
built for **exactly one organization, permanently** — Bobby's company (business units SRG/AGC). It
is **not** being built as a product other companies sign up to use, and nothing below should be read
as heading toward that. Full context: `docs/product/master-product-context.md`'s reconciliation
banner and `docs/product/master-prompt.md`'s note on PROMPT 3. This file used to describe a
multi-tenant rebuild (organizations + org_members + tenant-scoped RLS); that plan is **superseded** —
see "What this branch is for" below for the corrected shape.

## ⛔ Before running ANY SQL

This folder's `.env.local` points at the **separate dev Supabase project** (ref `pxzpewaerhjwnwsbaklc`),
a full clone of production, so local dev and migrations run against the sandbox by default. Production
(ref `icyfluwgyuimhwlddjyy`) is the live database — reachable **only** through a deliberate opt-in
(`--allow-prod`, see below), never by accident.

Any migration that rewrites RLS policies or changes constraints on existing tables is destructive
until proven otherwise. Default to the **dev sandbox only** — never prod — for anything beyond a
purely additive `ADD COLUMN IF NOT EXISTS` / new table.

**Every write-path script must import and call the guard from `scripts/guard-db.mjs` before opening
any connection:** `assertDevDatabase()` (dev-only, no opt-in — for the app/dev path and the isolation
harness) or `assertMigrationTarget({ allowProd })` (the migration runner; prod requires an explicit
`--allow-prod` flag and prints a loud banner). Only additive, non-destructive migrations may ever use
`--allow-prod`; destructive migrations must not. Run
`pnpm guard` any time to see which project the current environment resolves to. This applies to
`psql`, the Supabase SQL editor, and any migration runner — if a task seems to need a migration
applied and the script doesn't yet call the guard, add the guard call first, don't skip it.

## What this branch is for

`main` is a working PM tool for **one company** (Bobby's — business units SRG/AGC). This branch
matures it: real team/project-level access control, a canonical work-item domain, more views, and
the marketing/AI differentiation — **for this one org, not as a multi-tenant product.** The gap is
not features — `main` already has tasks, multi-assignee, kanban + list, calendar, comments,
attachments, tags, activity log, admin-managed statuses, reports, search, chat, bookmarks, and an AI
assistant with function-calling over live data.

The gap is three structural things.

### 1. No team- or project-level access control

`boards`, `tasks`, `tags`, `task_statuses` are one flat pool inside the org — every authenticated
user can read all of them (`USING (auth.uid() IS NOT NULL)`, or `is_board_member()` for the private-board
exception only). That's fine for full members today, but it blocks two things the roadmap already
wants: **Guests** (limited external collaborators) and a **Client portal** (FEATURES.md Phase 7) —
both need a user scoped to *specific* boards/teams, not full-company read access, without inventing
a second, parallel membership system.

Note: the `companies` table (SRG/AGC, `scripts/056_companies.sql`) is **not** a tenant and never was
— it is a business-unit label used by the marketing calendar. Do not overload it into anything more.

### 2. Statuses have two competing sources of truth

`task_statuses` (a real table) and board `columns`, reconciled by fuzzy string matching in
`lib/task-status.ts`:

```ts
if (status.includes('progress') || columnTitle.includes('going')) return 'in_progress'
```

This worked by accident because this team names columns "In Progress" / "Ongoing" — a differently
named column (e.g. "WIP") would have silently misclassified every task on it. **Fixed** (migration
`063`): `columns.status_key → task_statuses(key)` is now the source of truth; the normalizer reads
the FK first and keeps string matching only as a legacy fallback for un-backfilled columns.

### 3. Feature access is hardcoded to one person's email

**✅ DONE (schema + UI) for the marketing calendar — migration `085`, 2026-08-05.** The
`isKaylaMarketingUser`/`KAYLA_EMAIL` access-control hardcoding is gone:

- `components/user/user-dashboard.tsx` — `canUseMarketingCalendar` is now `isAdmin || <member of at
  least one calendar>` (from `lib/use-marketing-calendars.ts`), not an email compare. The
  accent-colour personalization (renamed `isKaylaAccentUser`) was deliberately left as its own
  narrow, literal-email check — cosmetic, not access control, out of scope for this fix.
- `components/marketing/marketing-calendar.tsx` — `KAYLA_EMAIL` and the owner-lookup/impersonation
  state (`kaylaId`, `checkUserId`, `checkUserName`) are gone. Marketing calendars are now
  admin-creatable, named, **multiple** instances, each with its own explicit member list
  (`marketing_calendars` + `marketing_calendar_members`, mirroring `boards`/`board_members` — not
  `teams`, which was 100% unconsumed anywhere in the repo and had the wrong RLS shape for
  per-entity access). The component takes `calendars`/`refetchCalendars` as props (fetched once by
  the parent dashboard, shared with the tab-gating check, not double-fetched) and renders a
  calendar switcher plus an admin-only "Manage Calendars" entry point
  (`components/admin/marketing-calendar-management.tsx`) for create/rename/archive and per-calendar
  member management — a checkbox list of every profile, mirroring `board-management.tsx`'s embedded
  picker (this app has no "invite a stranger" concept; every possible member already has a
  `profiles` row). Every existing row was backfilled onto one calendar named "Marketing Calendar",
  owned by and membered by Kayla — no behavior or data change for anyone on deploy. No role tiers
  on membership (every member gets full CRUD, matching what Kayla alone had before) — mirrors
  `teams`' own "don't build it speculatively" lesson. Verified: `pnpm check:marketing-calendars`
  (new dedicated cross-calendar isolation harness, 14/14 against real RLS — including that removing
  a membership row revokes access on the very next query) plus a 9/9 real-browser Playwright pass
  (a zero-access member has no Marketing nav item at all; an admin can create a calendar and grant a
  specific user access via the picker; that user then sees exactly that calendar and nothing else).
- `lib/display-text.ts` — **✅ DONE 2026-08-09.** It matched the literal filename
  `Marketing Project Management.xlsx`, so a second import under any other name would have shown its
  provenance header to every user with no way to hide it. Now matches the *shape* the importer
  writes (a leading `Source:` / `Imported from` line naming a spreadsheet), anchored to the first
  line so a description that merely mentions a file in its body is untouched. Strictly wider than
  the old constants, so no existing description can render differently. Covered by
  `lib/display-text.test.ts`, including regression guards quoting both original literals. Worth
  knowing: a scan of the dev sandbox found **zero** rows carrying either prefix across 71 task and 6
  board descriptions — this is dead code in practice, generalized rather than deleted only because
  prod data may have drifted from the clone.

**§3 is now fully closed** — the only remaining literal-email check is the cosmetic
`isKaylaAccentUser` accent colour, which is not access control.

## Plan

**Phase 0 — safety net (do first). ✅ DONE.** No tests, no CI, and 59 hand-applied SQL files with no
record of what had been applied. Built: `scripts/migrate.mjs` (+ `public.applied_migrations`, all 63
files baselined/applied) and `scripts/guard-db.mjs` (shared allowlist guard, dev-sandbox-by-default).
`scripts/check-isolation.mjs` was originally built as a **cross-tenant** isolation gate (two users in
different orgs, assert zero shared rows) — that framing is now moot under the single-org ruling
above. It is kept as-is (harmless, still passes) but is not gating anything meaningful anymore;
`scripts/check-board-roles.mjs` (below) is the harness that actually matters now.

**Phase 1 — plumbing.** In this order:
- **B. Status FK. ✅ DONE (migration `063`).** See "Statuses" above.
- **A. Teams, roles & real access control. Migrations `064`–`067`.** ⚠️ **"schema + UI" below is
  accurate only for `board_members.role` — `teams` itself is schema-only, zero UI** (no creation
  page, no membership management, no nav/sidebar presence; confirmed by repo-wide grep, no
  `.from('teams')`/`team_members` call site outside the migration file). Corrected 2026-07-24 after
  this heading previously overclaimed teams as done; don't read "DONE (schema + UI)" as covering
  teams UI in any future session.
  - `teams(id, name, color, position)` + `team_members(team_id, user_id)` — no `team_role` column;
    kept simpler than first sketched (plain membership only). Add a role column later if a real
    need shows up — don't build it speculatively. **No UI consumes this table yet.**
  - `board_members.role` (`member` | `guest` | `client`, default `'member'`, migration `065`) on the
    **existing** table from `049_board_privacy.sql` — no parallel membership system. Enforced
    server-side: `guest`/`client` can view a board's tasks but not create/edit/delete them
    (`private.can_manage_task` + the tasks INSERT/UPDATE/DELETE policies, `065` + `067`). Verified
    by `pnpm check:board-roles` (mirrors `check-isolation.mjs`'s throwaway-user pattern) — 9/9 checks
    pass, including a `member`-role control case proving the restriction is role-specific.
  - `067` also closed a **pre-existing** gap found while verifying `065`: the tasks INSERT policy
    never checked board privacy at all (`061` added that check to SELECT/UPDATE/DELETE only, INSERT
    was missed) — fixed in the same migration since it's the same policy.
  - **UI wired (no `lib/permissions.ts` added)** — `board-view.tsx`/`task-card.tsx`/`task-detail-modal.tsx`
    already had inline `canEdit`/`canDelete`/`canEditDueDate` checks (explicitly commented as
    mirroring each other); threaded a new `boardRole` prop (fetched server-side in
    `app/dashboard/board/[id]/page.tsx` + `app/admin/board/[id]/page.tsx` from the caller's own
    `board_members` row) into all three instead of adding a competing abstraction. Guest/client now
    also can't see the "Add task" button. Browser-verified with Playwright against the dev server: a
    real guest-role user sees the task but its title/description/due-date inputs are `disabled`
    (same existing UI convention as the priority/status/visibility selects), the Add-task button is
    gone, zero console errors; a plain member (no `board_members` row) is fully unaffected. Test
    fixtures created and torn down via the service role, dev sandbox only.
- **C. Modules. ✅ DONE (schema + UI) — migration `066`.** `app_modules(module_key, enabled, config
  jsonb)`, a singleton (no `org_id`), seeded with every current module `enabled=true` — nothing
  changes for anyone by default. `lib/modules.ts` has the registry (`useAppModules` hook +
  `isModuleEnabled`, mirrors `lib/use-task-statuses.ts`). Wired into both `user-dashboard.tsx` and
  `admin-dashboard.tsx` — their tab lists and sidebar sections now gate on `isModuleEnabled(...)`
  (marketing stays additionally gated by the existing Kayla/admin check — untouched, that's §3/Phase
  2 territory). Browser-verified: nav renders identically to before (all seeded enabled=true).
  **Not wired:** the floating `AiChatWidget` and the embedded `BookmarksSection` rail render
  unconditionally in all three dashboard shells (user/admin/super-admin) — `ai_assistant` and
  `bookmarks` exist as toggleable rows in `app_modules` but aren't consumed at those render sites
  yet. Scoped out because it touches three more large files; pick up if a super_admin actually needs
  to turn either off.

**Phase 2 — de-hardcode.** Remove the three items in §3 above. Members/guests/clients are added to
the one existing org directly (no "create org" step — there's nothing to create).

**Phase 3 — the risk story.** Where it stops being a task tracker and starts answering
*"what is at risk?"*:
- Subtasks — `tasks.parent_task_id` (nullable, self-referencing). Board queries need
  `WHERE parent_task_id IS NULL` or subtasks render as loose cards.
- Dependencies + blockers — `task_dependencies(blocker_id, blocked_id)`, `tasks.blocked_reason`,
  `blocked_since`. Log transitions to the existing `task_activity`.
- In-app notification inbox — `notifications(user_id, type, entity, read_at)`. Split
  *action required* / *FYI* from day one. Email prefs already exist; a durable inbox does not.
- "What should I work on next" — **zero schema**, all inputs are already in `myTasks`.
- Milestones — `milestones(board_id, title, due_date, status)`.
- `tasks.estimate_hours` — ship the column early so data accumulates before workload is built.
- Project health — `boards.health` + `health_note`, **manual first**. An auto-status that is wrong
  destroys trust in every other number shown.

**Phase 4 — earn it.** Workload, saved views (`reports-view.tsx` already holds ~10 filter states in
`useState`), custom fields, the **client portal UX** built on top of Phase 1-A's `board_members.role`
(schema already lands in Phase 1-A; this phase is the client-facing screens/flows), and three
hardcoded automations on Vercel Cron — overdue → notify owner; all subtasks done → complete parent;
recurring task spawn (the `is_recurring` columns from `scripts/025_*.sql` are currently unused).

## Explicitly not building

Multi-tenant/organization-switching machinery (see the single-org ruling above), docs/wiki +
collaborative editing, Gantt/timeline, offline support, a generic automation rules engine, and more
than two integrations (Google Calendar one-way export, Slack notifications). Each is a product
rather than a feature, and none serves the goal of reducing time spent *managing* work.

## People (verified against **production** 2026-08-09 — re-query `profiles` for current truth)

`bobby@goatlasgo.us` (Bobby Shanks) and `kayla@goatlasgo.us` (Kayla Viehland) both hold platform role
`super_admin`, deliberately — this is not "one vendor account," don't consolidate to one. Kayla's
separate hardcoded marketing-module gating (§3 above) is unrelated to her platform role and unaffected
by any role work in Phase 1.

Three more hold `admin`: `kogan@goatlasgo.us`, `mendy.atlasgc@gmail.com`, `timkennon2@gmail.com`.
**`private.is_admin_user()` is true for `admin` AND `super_admin`** (migration `047`), so all five
satisfy every `is_admin_user()` clause in every policy.

### ⚠️ Check roles against the existing policy before gating work on a migration

Learned the expensive way, 2026-08-09. A bug was reported as "Kayla marks work done, it stays red on
Bobby's dashboard." It was diagnosed as an RLS problem and sequenced behind a policy migration
(`087`) that then got blocked — costing days of the owner waiting.

The migration was never needed for that bug. `marketing_calendar_checks`' SELECT policy already read
`user_id = auth.uid() OR private.is_admin_user()`, and Bobby is `super_admin` — **the database had
been returning Kayla's rows the whole time.** The deployed *client* was discarding them with an
explicit `.eq('user_id', userId)` on its own query. A one-line client fix resolved it.

The general trap: an RLS policy is only the ceiling. When a user "can't see" something, check what
the client actually asks for before concluding the policy is wrong — and check whether the reporting
user's role already satisfies the policy as written. A migration blocked behind a safety gate is a
very expensive place to discover the migration was unnecessary.

Corollary, specific to this repo: because all five people above are admins, *any* fix that only needs
`is_admin_user()` to be true ships as a code change alone. Policy widening is only required the day a
**non-admin** is given access to something — which for the marketing calendar has not happened yet
(as of 2026-08-09 the sole calendar has exactly one member, Kayla).

## Conventions

- Migrations: numbered SQL in `scripts/`, continuing from `088`. Wrap in `BEGIN; … COMMIT;`,
  use `IF NOT EXISTS`, and write the intent as a comment header — match the style of
  `047`, `049`, `056`. **Migration state drifts between dev and prod — always run
  `pnpm migrate:status` rather than trusting a number written down anywhere, including here.**
  As of 2026-08-09: dev is at `087`, **prod is at `086`**, and that gap is deliberate (see below).
- A migration that rewrites RLS policies should carry its own post-conditions inside the
  transaction — assert the expected policy set, that RLS is still enabled, and that row counts
  did not move, so it rolls back instead of half-applying. `087` is the worked example, and
  `scripts/rollback/087_revert.sql` shows the paired one-command rollback every such migration
  should ship with.
- Do not add `Co-Authored-By: Claude` to commits in this repo.
- **`main` auto-deploys to production** (Vercel project `v0-project-management-dashboard`, live at
  `project.goatlasgo.us`). Pushing to `main` ships to the live app within about a minute. Apply any
  schema change prod depends on *before* merging. To confirm what is actually live, read the commit
  sha from `gh api repos/VanshajPoonia/projectmanagementatlas/deployments` — `vercel inspect` does
  not print it, and matching timestamps by eye is a guess.

### Migration `087` is written but deliberately NOT applied to prod

`scripts/087_marketing_checks_shared.sql` widens SELECT/DELETE on `marketing_calendar_checks` from
per-viewer to calendar-membership, so members see one shared posted/missed state. It is applied to
the dev sandbox, verified by `pnpm check:marketing-calendars` (19/19), and self-verifying per the
convention above.

It is not on prod because **nobody is currently affected by its absence** — every marketing calendar
member is an admin, and admins already read every check row (see the People section). Apply it the
day a non-admin is given calendar access. Until then the gap is intentional, not an oversight; do not
"fix" it in passing.
