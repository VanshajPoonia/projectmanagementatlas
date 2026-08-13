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
- **A. Teams, roles & real access control. Migrations `064`–`067`, plus `094` for teams.**
  - `teams(id, name, color, position)` + `team_members(team_id, user_id)` — no `team_role` column;
    kept simpler than first sketched (plain membership only). Add a role column later if a real
    need shows up — don't build it speculatively.
  - **✅ DONE (schema + UI) — migration `094`, 2026-08-13.** `064` created these tables and
    nothing ever wrote to them: verified against **both** dev and prod, 0 rows in each, zero call
    sites repo-wide. `094` seeds the two business units the company actually runs on —
    **Atlas General Contracting** and **Shanks Realty Group** — and puts every existing profile in
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
    UI — update both.
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

⚠️ **But only policies that call `is_admin_user()`.** Several older policies inline
`profiles.role = 'admin'` instead, and read literally that **excludes super_admin — i.e. Bobby and
Kayla**. `marketing_channels`' UPDATE/DELETE (`054`, narrowed by `055`) is the known case; it made
column reordering silently fail for exactly the two people who use the marketing calendar until
`088` routed that write through an RPC. When gating a feature on "admins can do this", grep the
policy itself — `role = 'admin'` and `is_admin_user()` are different sets of people.

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

## The research pack in `plan/` (added by the owner, 2026-08-13)

`plan/ATLAS_01_RESEARCH_AUDIT_AND_DESIGN_GUIDE.md` (competitor audit + design guide; **§13 is the
build priority, §10 the concrete requirements**), `plan/ATLAS_02_CLAUDE_FINAL_BUILD_PROMPTS_AUDITED.md`
(Prompts A–M), and `plan/ATLAS_MASTER_RESEARCH_AND_BUILD_PACK.md` (the two concatenated). These
**refine** `docs/product/master-prompt.md`, they do not replace it: Prompt A ≈ finishing PROMPT 2,
Prompt B ≈ later PROMPT 3 slices, Prompt C ≈ PROMPT 4 / FEATURES Phase 1.

ATLAS_02's own header says to run **one prompt per session** and to audit before implementing — don't
try to execute the whole pack at once. Plane/OpenProject/Vikunja/Leantime/Taiga are **design
references only**; no code is copied from them, and ATLAS_01 §4 lists the specific claims about them
that turned out to be wrong (OpenProject has no critical path; Taiga has no time tracking; Vikunja
lists no native Calendar view). Foundation slice 1 (capability model, ⌘K rebuild, recents, density,
`/my-work`) shipped 2026-08-13 — see FEATURES.md's changelog for exactly what and what was
deliberately left out.

## Conventions

- Migrations: numbered SQL in `scripts/`, continuing from `098`. Wrap in `BEGIN; … COMMIT;`,
  use `IF NOT EXISTS`, and write the intent as a comment header — match the style of
  `047`, `049`, `056`. **Migration state drifts between dev and prod — always run
  `pnpm migrate:status` rather than trusting a number written down anywhere, including here.**
  As of 2026-08-13: **dev is at `097`, prod is at `094`** (`094` and `095` were applied to prod
  by the owner). Prod has still never had `087` (deliberate, see below) — `088`–`093` were
  applied with `--only=… --allow-prod`, which is what the runner's `--only` flag exists for.
- ⚠️ **`096` and `097` are applied to dev only.**
  - `096` (signup trigger) is a **no-op on prod**, which already has the trigger — verified.
    Worth applying only so both databases are provably identical.
  - `097` (`user_favorites`) is **purely additive** — one new table, no existing policy or row
    touched — so unlike `094`/`095` it is straightforwardly `--allow-prod` eligible:
    `node --env-file=.env.production.local scripts/migrate.mjs --only=097 --allow-prod`
    Without it the star renders and every click fails, so apply it **before** merging the code.
    Rollback `scripts/rollback/097_revert.sql` **destroys real user data** (everyone's stars);
    snapshot the table first if the intent is "roll back the code, keep the favourites".
- **Dev-sandbox drift to know about: the `on_auth_user_created` trigger.** The sandbox was
  missing it entirely (the function `handle_new_user` existed, attached to nothing) because the
  trigger lives on `auth.users`, **outside the `public` schema**, so a public-only clone drops
  it. Production is fine — 11 auth accounts, 10 profiles, and the five most recent accounts all
  have their row. Restored by `096`. If you ever re-clone prod into the sandbox, expect to lose
  it again and re-apply `096`. Anything else living outside `public` has the same exposure.
- **Every Storage bucket is private, 50 MB, 23 MIME types** (`task-assets`, `chat-attachments`,
  `marketing-assets`) as of `093`. 50 MB is the **Supabase Free plan's hard per-file ceiling** —
  a bucket's `file_size_limit` cannot exceed the project-wide upload limit, and on Free that
  limit cannot be raised at all, so this is the maximum without changing plan. Total storage on
  Free is 1 GB across every bucket, roughly 20 files at full size. The one limit deliberately
  NOT raised is the **inline base64 path** for task attachments (043's 14 MB `octet_length`
  CHECK ≈ 10 MB raw): those bytes land in the Postgres row inflated 33%, against a 500 MB
  database budget. The admin-only "Large file" toggle exists so that path never has to grow.
- **⚠️ `pnpm build` / `pnpm start` locally talk to PRODUCTION.** Next loads
  `.env.$(NODE_ENV).local` ahead of `.env.local`, and this repo has a committed-in-workspace
  `.env.production.local` holding prod credentials — so any production build bakes prod's
  Supabase URL and anon key into the client bundle, and a local `pnpm start` session is a live
  prod client. `pnpm dev` is unaffected (it uses `.env.local`, the dev sandbox). Before running
  any browser test against `pnpm start`, move `.env.production.local` aside and rebuild, then
  restore it — and confirm which project you got with:
  `grep -rhoE '(icyfluwgyuimhwlddjyy|pxzpewaerhjwnwsbaklc)' .next/static/chunks/*.js | sort -u`
- **CSP is production-only, so dev cannot catch an `img-src` bug.** `next.config.mjs` only sets
  Content-Security-Policy when `NODE_ENV === 'production'`. `img-src` must list `blob:` and
  `https://*.supabase.co` — verified in a real browser that without them the marketing
  calendar's `URL.createObjectURL` preview and task attachments' signed-URL thumbnails are both
  refused, while `data:` (the inline base64 path) still loads, which is exactly why the
  marketing preview was silently broken in production for so long. Any new Storage-backed image
  must be checked against a real production build, not `pnpm dev`.
- **New tables need an explicit `REVOKE ALL`.** Supabase's default privileges grant every new
  table in `public` a blanket ALL to `anon` and `authenticated`, so granting narrowly is not
  enough — the wide grant is already there. `090` is the worked example (and its post-conditions
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
