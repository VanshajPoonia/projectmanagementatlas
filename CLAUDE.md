# pm-platform — multi-tenant rebuild

Git worktree of `projectmanagementatlas`, branch `platform`. The live single-tenant app
lives at `../Project manager` on `main`. Same git repo, so fixes can be cherry-picked
in either direction.

## ⛔ Before running ANY SQL

`.env.local` now points at a **separate dev Supabase project** (ref `pxzpewaerhjwnwsbaklc`), seeded
as a full clone of production. Production (ref `icyfluwgyuimhwlddjyy`) is the live Supabase project
the real Atlas/Shanks team uses every day — it must **never** be a migration target from this branch.

The Phase 1 migrations below are destructive (adding `NOT NULL` columns, rewriting ~20 RLS
policies, changing unique constraints). Running them against production would break the live app.

**Every write-path script must import and call `assertDevDatabase()` from `scripts/guard-db.mjs`
before opening any connection.** It aborts immediately unless the target is exactly the dev
sandbox — see `scripts/migrate.mjs` and `scripts/check-isolation.mjs` for the pattern. Run
`pnpm guard` any time to see which project the current environment resolves to. This applies to
`psql`, the Supabase SQL editor, and any migration runner — if a task seems to need a migration
applied and the script doesn't yet call the guard, add the guard call first, don't skip it.

## What this branch is for

`main` is a working single-tenant PM tool for one company. This branch turns it into a product
multiple companies can use. The gap is not features — `main` already has tasks, multi-assignee,
kanban + list, calendar, comments, attachments, tags, activity log, admin-managed statuses,
reports, search, chat, bookmarks, and an AI assistant with function-calling over live data.

The gap is three structural things.

### 1. No tenant boundary

`boards`, `tasks`, `profiles`, `tags`, `task_statuses` are one global pool. Read policies are
literally `USING (auth.uid() IS NOT NULL)`. A second company would see everything.

Note: the `companies` table (SRG/AGC, `scripts/056_companies.sql`) is **not** a tenant — it is a
business-unit label used by the marketing calendar. Do not overload it into a tenant.

### 2. Statuses have two competing sources of truth

`task_statuses` (a real table) and board `columns`, reconciled by fuzzy string matching in
`lib/task-status.ts`:

```ts
if (status.includes('progress') || columnTitle.includes('going')) return 'in_progress'
```

This works only because this team names columns "In Progress" / "Ongoing". A company using "WIP"
gets every task silently classified `to_do` — no error, just wrong counts in My Tasks, overdue
math, reports, and the AI assistant's answers. Highest-risk existing code for multi-tenancy.

Related: `task_statuses.key` is globally `UNIQUE` and `companies.code` has a global
`unique(lower(code))`. Two orgs cannot both have a status keyed `review`.

### 3. Feature access is hardcoded to one person's email

- `components/user/user-dashboard.tsx` — `isKaylaMarketingUser`, gates a whole module, also sets the accent colour
- `components/marketing/marketing-calendar.tsx` — `KAYLA_EMAIL`, hard-fails with "Kayla profile is not ready yet."
- `lib/display-text.ts` — strips strings specific to `Marketing Project Management.xlsx`

## Plan

Phases 1–2 are invisible to users: everything backfills to one org, one module set, statuses
backfill from the normalizer already in use. That is what makes them safe to land.

**Phase 0 — safety net (do first). ✅ DONE.** No tests, no CI, and 59 hand-applied SQL files with no
record of what has been applied. The tenancy migration is exactly where a mistake leaks Company A's
data to Company B, and it would surface via a customer. Minimum: a migration runner with an
`applied_migrations` table, and one script that signs in as two users in different orgs and asserts
each sees zero of the other's rows.
Built: `scripts/migrate.mjs` (+ `public.applied_migrations`, all 63 files baselined/applied) and
`scripts/check-isolation.mjs` (two-user cross-tenant harness; current baseline is single-tenant —
both users see the same rows, which is *expected* pre-Phase-1A and becomes the pass/fail gate once
org isolation lands). Also added `scripts/guard-db.mjs`, a shared allowlist guard both scripts call
before connecting — see the `⛔ Before running ANY SQL` section above.

**Phase 1 — plumbing.** In this order:
- **B. Status FK. ✅ DONE (migration `063`).** `columns.status_key` → `task_statuses(key)`,
  backfilled by running the existing normalizer once over column titles (22/22 columns backfilled
  correctly). Normalizer (`lib/task-status.ts`) reads the FK first, string matching stays as legacy
  fallback. 56 tests green.
- **A. Organizations. ⬅ NEXT — not started.** `organizations` + `org_members(org_id, user_id, org_role)`. Add `org_id`
  nullable to `boards`/`tags`/`task_statuses`/`companies`/`personal_tasks`/`bookmarks` → backfill
  to one seeded org → `NOT NULL`. Tasks and columns inherit through `boards`; do not denormalize
  `org_id` onto `tasks` without a query that proves it is needed.
  Split the role: `profiles.role` becomes the *platform* role (`super_admin` = vendor),
  `org_members.org_role` becomes the *tenant* role. Otherwise "admin" means admin of every company.
  Follow the pattern in `scripts/047_super_admin_role.sql` — it established `private.is_admin_user()`
  as a single chokepoint and re-pointed ~20 policies with `ALTER POLICY`. Add
  `private.current_org_id()` / `private.is_org_admin(org_id)` the same way.
- **C. Modules.** `org_modules(org_id, module_key, enabled, config jsonb)` + a registry in
  `lib/modules.ts`: `boards`, `personal_tasks`, `chat`, `calendar`, `bookmarks`,
  `marketing_calendar`, `reports`, `ai_assistant`. Nav and route guards read from it.
  `user-dashboard.tsx` already builds `navItems` as an array with a conditional spread.

**Phase 2 — de-hardcode.** Remove the three items in §3 above. Add org onboarding: create org →
invite members → pick modules → seed a template board.

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
`useState`), custom fields, client portal via a `viewer` role on `board_members`, and three
hardcoded automations on Vercel Cron — overdue → notify owner; all subtasks done → complete parent;
recurring task spawn (the `is_recurring` columns from `scripts/025_*.sql` are currently unused).

## Explicitly not building

Docs/wiki + collaborative editing, Gantt/timeline, offline support, a generic automation rules
engine, and more than two integrations (Google Calendar one-way export, Slack notifications).
Each is a product rather than a feature, and none serves the goal of reducing time spent
*managing* work.

## Conventions

- Migrations: numbered SQL in `scripts/`, continuing from `064` (`063` is the last applied file).
  Wrap in `BEGIN; … COMMIT;`,
  use `IF NOT EXISTS`, and write the intent as a comment header — match the style of
  `047`, `049`, `056`.
- Do not add `Co-Authored-By: Claude` to commits in this repo.
- `.vercel/` was deliberately not copied from `main` — this branch must not deploy over the
  live Vercel project. It needs its own.
