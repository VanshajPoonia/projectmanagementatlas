# Known issues & deferred work

Running list of bugs found, trade-offs accepted, and things deliberately left
undone. Add to it rather than fixing silently — the point is that nothing gets
rediscovered from scratch six months later.

Last updated: 2026-07-23

---

## Open — infrastructure

### No test runner, no CI

There is no test framework, no `test` script, and no GitHub Actions workflow.
Logic added so far was verified with throwaway `tsx` scripts and a scratch
Postgres instance, both discarded after use. Nothing re-runs on push.

**Why it matters:** the multi-tenant work planned in `../pm-platform` is exactly
where a silent mistake leaks one company's data to another, and it would surface
via a customer rather than a failing build.

**Fix:** add Vitest + a `pnpm test` script, port the throwaway checks
(work-next ranking, `isTaskOwnedBy`, subtask DB behaviour), and run them in CI.

### Migrations are hand-applied with no record of what has run

`scripts/` holds 60 numbered `.sql` files applied manually via
`vercel env pull` + `psql $POSTGRES_URL_NON_POOLING`. Nothing records which have
been applied to which database. Correct ordering depends entirely on memory.

**Fix:** a migration runner backed by an `applied_migrations` table.

### `pnpm-workspace.yaml` placeholders keep coming back

pnpm regenerates the `allowBuilds` block with literal
`set this to true or false` values, which makes `pnpm install` exit 1 on
stricter pnpm versions. Fixed in `248b33c`, reintroduced by `6bd65d2`, fixed
again in `1c25410`. Vercel's pnpm is lenient, so **deploys never broke** — only
local and clean-checkout builds did, which is why it went unnoticed for weeks.

**Watch for:** any future `pnpm` command that rewrites this file. Check the diff
before committing.

---

## Open — correctness

### Statuses have two competing sources of truth

`task_statuses` (a real admin-managed table) and board `columns`, reconciled by
fuzzy string matching in `lib/task-status.ts`:

```ts
if (status.includes('progress') || columnTitle.includes('going')) return 'in_progress'
```

This works only because this team happens to name columns "In Progress" and
"Ongoing". Admins **can** create columns, so a board with a "WIP" column has
every task in it silently classified `to_do` — no error, just wrong numbers in
My Tasks, the overdue maths, reports, and the AI assistant's answers.

**Severity:** latent today, guaranteed breakage the moment a second company
names its columns differently.

**Fix:** `columns.status_key` foreign key to `task_statuses(key)`, backfilled by
running the existing normalizer once over column titles. The normalizer then
reads the FK first and keeps string matching only as a legacy fallback.

### Feature access is hardcoded to one person's email address

- `components/user/user-dashboard.tsx` — `isKaylaMarketingUser` gates the whole
  marketing module and also sets the accent colour
- `components/marketing/marketing-calendar.tsx` — `KAYLA_EMAIL`, hard-fails with
  "Kayla profile is not ready yet."
- `lib/display-text.ts` — strips strings specific to
  `Marketing Project Management.xlsx`

**Fix:** the `org_modules` registry described in `../pm-platform/CLAUDE.md`.

### Unique constraints assume a single tenant

`task_statuses.key` is globally `UNIQUE` and `companies.code` has a global
`unique(lower(code))`. Two organisations cannot both have a status keyed
`review`. Must become composite with an org id before a second tenant exists.

---

## Open — subtasks (shipped 2026-07-23, PR #5)

### Subtasks don't follow their parent between columns

A subtask copies `column_id` from its parent at creation. Dragging the parent to
another column leaves the subtasks pointing at the old one.

**Impact:** cosmetic and currently invisible — subtasks are never rendered by
column, and parent and child are always on the same board either way. Left
unfixed because syncing it means cascade logic in two separate drag paths for no
user-visible benefit.

**Revisit if:** subtasks ever get rendered on the board itself, or reporting
starts grouping by column.

### Dashboard counts include assigned subtasks

The To Do / In Progress / Completed tiles count everything assigned to you,
subtasks included. If both a parent and its subtasks are assigned to the same
person, all of them count. This is deliberate — it is "my workload" counted
honestly — but the numbers read higher than they did before PR #5.

Aggregate views (task overview, reports, calendars) deliberately stay on
top-level tasks so historical report numbers don't move when a task gets broken
down.

### Subtasks have no due date of their own

The subtask UI sets title, done state, and assignees only. They inherit nothing
date-wise and never appear on calendars. Fine for checklist-style use; revisit
if the team starts scheduling at subtask level.

---

## Resolved — kept for the reasoning

### PostgREST self-referencing embeds are ambiguous *(avoided, never shipped)*

The first implementation resolved parent titles with
`parent:tasks!tasks_parent_task_id_fkey(id, title)`. `parent_task_id` is a
**self-referencing** foreign key, where PostgREST's `!hint` is ambiguous between
the parent direction (to-one, returns an object) and the children direction
(to-many, returns an array). The wrong resolution makes `task.parent?.title`
silently `undefined` and every breadcrumb vanish — and it could not be verified
until the migration was live.

Parent titles are now resolved from a local `Map` in `app/dashboard/page.tsx`
and `app/admin/page.tsx` (every task is already in hand), and via a separate
`.in()` query in `lib/ai-chat-tools.ts`.

**Rule going forward:** don't embed across a self-referencing FK. Resolve locally
or with a second query.

### Deleting a parent containing someone else's subtask *(fixed in 060)*

The `035` permission trigger only asks whether the current user can delete that
row's own creator's task. A cascade over a colleague's subtask raised and aborted
the parent's delete entirely. `060` replaces the function so authority over the
parent carries down.

Found by running the migration against a real Postgres instance — code review
would not have caught it.

### Undo resurrected the wrong subtasks *(fixed in 060)*

The first cascade restored *every* child of a restored parent, including subtasks
that had been deleted individually beforehand. The cascade now stamps children
with the parent's exact timestamp and the restore matches on it, so only what
that delete took down comes back.

### AI assistant's `count` was computed from the wrong array *(fixed pre-merge)*

After restructuring `getTasks` to fetch parent titles separately, the returned
`count` still referenced the pre-mapping array.

### The ownership rule existed in three copies *(fixed pre-merge)*

User dashboard, admin dashboard, and the AI tool each had their own copy of "is
this task mine". Extracted to `isTaskOwnedBy` in `lib/assignees.ts`.

---

## Deliberately not building

Documented so they don't get re-proposed. Each is a product rather than a
feature, and none serves the goal of reducing time spent *managing* work.

- Docs / wiki / collaborative editing — Notion exists
- Gantt / timeline — large UI cost, low usage outside construction and agencies
- Offline support — needs a different sync architecture entirely
- A generic automation rules engine — start with three hardcoded rules on Vercel
  Cron instead (overdue → notify owner; all subtasks done → complete parent;
  recurring task spawn, since the `is_recurring` columns from `025` are unused)
- More than two integrations — Google Calendar (one-way export) and Slack
