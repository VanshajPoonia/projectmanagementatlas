# Known issues & deferred work

Running list of bugs found, trade-offs accepted, and things deliberately left
undone. Add to it rather than fixing silently - the point is that nothing gets
rediscovered from scratch six months later.

Last updated: 2026-08-28

---

## Open - infrastructure

### Production reports `1 pending` migration, permanently and on purpose

`scripts/125_wip_enforcement.sql` is applied to dev and **deliberately not** to
production, so `migrate:status` against prod will always show one pending file.
**That gap is a decision, not drift - do not "tidy" it by applying the file.**

It puts a trigger on `tasks`, which runs on every task move on every board, so it
is not `--allow-prod` eligible on this repo's own rule: the same class as `113`
and `118`, both of which reached prod only as explicit owner decisions after the
risk was written down. Until somebody decides, `public.wip_enforcement_installed()`
returns false on prod and every WIP badge there honestly says "warning only -
nothing is refused".

Note this is specifically about WIP. **Capacity enforcement IS real on prod**
(migration `127`), because its trigger sits on `sprint_items` - a table `123`
created - so no pre-existing write path changed behaviour.

### `pnpm lint` cannot run - there is no eslint config

`package.json` defines `lint` as `eslint .`, but the repo has no
`eslint.config.*` and no `.eslintrc*`, so the command exits with
"ESLint couldn't find an eslint.config.(js|mjs|cjs) file." It has been this way
long enough that `.github/workflows/ci.yml` documents it as the reason lint is
not in the pipeline.

**Consequence:** the only automated gates are `pnpm test` (in CI) and
`tsc --noEmit` (run by hand). Style and unused-code drift is uncaught.

**Fix:** add a flat config, then add the `lint` step to CI. Expect a backlog of
findings on first run; land the config with rules calibrated to what the repo
already does rather than to a default preset.

### ~~`pnpm check:recurrence-ui` cannot finish on this machine~~ FIXED 2026-08-28

Kept because the diagnosis generalises to any Node-side request in any harness.

It used to pass 74 checks and then abort with
`apiRequestContext.get: connect ECONNREFUSED ::1:3000`.

**Cause:** `page.request` runs in Node, and Node resolves `localhost` to `::1`
before `127.0.0.1` (`dns.lookup('localhost', {all:true})` returns the IPv6
address first). `next dev` binds IPv4 only. The browser's own `page.goto`
against the identical URL succeeded, because it does happy-eyeballs resolution
and falls back; Node does not. So the failure looked like a broken harness
rather than an unroutable address family, and every check before it passed.

**Fix:** the harness now has a separate `NODE_BASE` (`http://127.0.0.1:3000`)
used only by `page.request`; `BASE` is unchanged for the browser, and an
explicit `BASE_URL` still overrides both. Now 75/75.

⚠️ **Any future harness that calls an API route from Node rather than through
the page needs the same treatment.** Same family as the IPv6-only
`db.<ref>.supabase.co` note in CLAUDE.md: this Mac has no IPv6 route, so
anything that resolves to `::1` fails in a way that reads like the server
being down.

### `pnpm-workspace.yaml` placeholders keep coming back

pnpm regenerates the `allowBuilds` block with literal
`set this to true or false` values, which makes `pnpm install` exit 1 on
stricter pnpm versions. Fixed in `248b33c`, reintroduced by `6bd65d2`, fixed
again in `1c25410`. Vercel's pnpm is lenient, so **deploys never broke** - only
local and clean-checkout builds did, which is why it went unnoticed for weeks.

**Watch for:** any future `pnpm` command that rewrites this file. Check the diff
before committing.

---

## Open - correctness

*(The two entries that used to sit here - the competing status sources and the
hardcoded email gate - are under "Resolved" below with their reasoning intact.
The third, single-tenant unique constraints, moved to "Deliberately not
building": it is moot, not fixed.)*

### The task detail modal's dialog has no accessible description

Opening a work item logs `Missing 'Description' or 'aria-describedby={undefined}'
for {DialogContent}` from Radix. `components/board/task-detail-modal.tsx` has no
`DialogDescription` at all. The dialog still has an accessible *name* (its title),
so this is not an axe violation and screen readers are not left without a label -
it is the weaker "no description" warning.

**Pre-existing**, found while running the Prompt G browser harness in 2026-08.
Deliberately not fixed there: the safe version is an `sr-only` description, that
modal is one of the most-used shared components in the app, and attaching an
unrelated a11y change to a feature branch is how a regression arrives with nothing
to attribute it to. `sr-only` is `position: absolute` and has escaped an overflow
container in this repo before, so it wants its own verification pass.

### A backlog reorder is several UPDATEs, not one transaction

`reorderBacklog` in `lib/agile-data.ts` renumbers a column one row at a time,
because PostgREST has no multi-row UPDATE with per-row values. A tab closed
mid-sequence leaves some rows renumbered and some not, which means duplicate
`position` values until the next reorder.

**Impact is display order only** - ties break by title - and the board's own
drag-and-drop already writes multiple rows the same way, so this is consistent
with existing behaviour rather than new. The fix, if it ever matters, is a
`SECURITY INVOKER` RPC taking the whole ordering as one argument. It is written
down rather than fixed because the cost is a migration and the symptom is
cosmetic and self-healing.

---

## Open - subtasks (shipped 2026-07-23, PR #5)

### Subtasks don't follow their parent between columns

A subtask copies `column_id` from its parent at creation. Dragging the parent to
another column leaves the subtasks pointing at the old one.

**Impact:** cosmetic and currently invisible - subtasks are never rendered by
column, and parent and child are always on the same board either way. Left
unfixed because syncing it means cascade logic in two separate drag paths for no
user-visible benefit.

**Revisit if:** subtasks ever get rendered on the board itself, or reporting
starts grouping by column.

### Dashboard counts include assigned subtasks

The To Do / In Progress / Completed tiles count everything assigned to you,
subtasks included. If both a parent and its subtasks are assigned to the same
person, all of them count. This is deliberate - it is "my workload" counted
honestly - but the numbers read higher than they did before PR #5.

Aggregate views (task overview, reports, calendars) deliberately stay on
top-level tasks so historical report numbers don't move when a task gets broken
down.

### Subtasks have no due date of their own

The subtask UI sets title, done state, and assignees only. They inherit nothing
date-wise and never appear on calendars. Fine for checklist-style use; revisit
if the team starts scheduling at subtask level.

---

## Open - private boards (admin lockdown, shipped 2026-07-23)

Migration `061` removes admin/super_admin blanket access to private boards. A
private board and everything in it is now visible/manageable only to its creator
and to explicit `board_members`. Notes and deliberate trade-offs:

### No break-glass on private boards

There is intentionally no admin override. If the creator of a private board is
deprovisioned, the board is reachable only by its remaining members or via direct
DB access. This is the literal ask ("remove super admin and admin access"). If an
org later needs oversight, add a scoped, audited override rather than restoring the
blanket `is_admin_user()` bypass.

### Membership management is creator-only

`board_members` INSERT/DELETE is restricted to the board's creator (the admin
bypass is gone - otherwise "remove admin access" was bypassable by self-adding).
Still true, and deliberate.

*Updated 2026-08-21:* this entry used to describe the edit dialog's
delete-all-then-reinsert member sync. That sync is gone. It was actively harmful -
the re-insert dropped `board_members.role`, so renaming a board silently promoted
its guests to full members, and a non-creator's edits reported success while
changing nothing (PostgREST does not treat a zero-row DELETE as an error).
`lib/board-membership.ts` now computes a diff, asks for its rows back and compares
the count, and `canManageMembership` swaps the picker for `MEMBERSHIP_LOCKED_REASON`
rather than showing a non-creator an empty list. Pinned by `pnpm check:access-matrix`.

## Open - marketing "missed" items (shipped 2026-07-23)

Migration `062` adds `status` ('posted'|'missed') + `note` to
`marketing_calendar_checks`. Any past item with no row shows as "Missed"
automatically; a stored 'missed' row only exists once a reason is attached.

### Auto-missed spans all history, not just recent

Every past unposted item counts as missed, so a calendar with months of
never-checked imported rows will show a large "N missed" count and a lot of red
under "Show past". This is truthful (they genuinely weren't marked posted) and the
default agenda hides past items, but the number can look alarming. If it becomes
noise, scope the auto-missed window (e.g. last 30 days) or exclude pre-adoption
dates.

### Auto-missed uses the viewer's local clock

The past/future cutoff is the browser's local date (`toDateKey(new Date())`),
consistent with how the rest of the calendar computes "today". An item is missed
the moment the viewer's local day rolls past its date - there is no server-side
grace period or timezone normalization.

---

## Resolved - kept for the reasoning

### No test runner, no CI *(fixed 2026-07-23)*

There was no test framework, no `test` script and no GitHub Actions workflow;
logic was verified with throwaway `tsx` scripts that were discarded after use, so
nothing re-ran on push. There is now a Vitest suite behind `pnpm test`, and
`.github/workflows/ci.yml` runs it on every PR and on pushes to `main`.

**Deliberately still not in CI:** `pnpm lint` (no eslint config - see above),
`pnpm build` (needs Supabase env wired as Actions secrets) and `tsc --noEmit`
(type-error backlog, `ignoreBuildErrors` still on). The `check:*` harnesses are
also excluded on purpose: they write to the dev sandbox and create real auth
users, which is not something to hand a CI runner a service-role key for.

### Migrations were hand-applied with no record of what had run *(fixed by `scripts/migrate.mjs`)*

60-odd numbered `.sql` files were applied by hand and nothing recorded which had
been applied to which database, so correct ordering depended entirely on memory.
`scripts/migrate.mjs` now applies them in numeric order and records each in
`public.applied_migrations`; `scripts/guard-db.mjs` resolves the target first and
refuses anything it does not recognise, with production behind an explicit
`--allow-prod` flag.

**The lesson that outlived the fix:** the ledger is the only truth. The migration
notes in `CLAUDE.md` have been wrong about which database is at which number
three separate times, which is why the standing rule is to run
`pnpm migrate:status` rather than read any number written down anywhere.

### Statuses had two competing sources of truth *(fixed in 063)*

`task_statuses` and board `columns` were reconciled by fuzzy string matching in
`lib/task-status.ts` - `status.includes('progress') || columnTitle.includes('going')`.
It worked only by accident, because this team names its columns "In Progress" and
"Ongoing"; a column named "WIP" would have silently classified every task on it as
`to_do`, with no error and wrong numbers in My Tasks, the overdue maths, reports
and the AI assistant's answers.

`063` added `columns.status_key` as a foreign key to `task_statuses(key)` and the
normalizer reads the FK first, keeping string matching only as a legacy fallback
for un-backfilled columns. As of 2026-08-21 every column on the dev sandbox is
linked (30/30, zero custom), so the fallback is effectively dead code.

### Feature access was hardcoded to one person's email address *(fixed in 085)*

`isKaylaMarketingUser` gated the whole marketing module, `marketing-calendar.tsx`
hard-failed with "Kayla profile is not ready yet.", and `lib/display-text.ts`
stripped strings specific to one literal spreadsheet filename. Marketing calendars
are now admin-creatable, named, multiple instances with explicit member lists
(`marketing_calendars` + `marketing_calendar_members`, mirroring
`boards`/`board_members`), and `display-text.ts` matches the *shape* the importer
writes rather than one filename.

One literal-email check deliberately survives: the accent colour in
`components/theme/accent-provider.tsx`. It is cosmetic personalization, not access
control, and was left narrow on purpose.

### Column names of a private board were not hidden *(fixed in 099)*

`061` applied board privacy to tasks, comments, attachments, links and tags, but
never to `public.columns`, which still carried `001`'s bare
`USING (auth.uid() IS NOT NULL)`. Any signed-in user who knew a private board's id
could read its column titles and order. No task content leaked, so this disclosed
the *shape* of private work rather than its contents - which is why it sat
unnoticed, originally written up here as an accepted trade-off ("columns carry no
sensitive data").

Write policies on `columns` were deliberately left alone at the time so the
status-rename sweep could still reach private boards. **That reasoning was wrong**,
and `107` had to fix it: Postgres applies the SELECT policy to an `UPDATE ... WHERE`
too, because the row has to be read to be found, so narrowing SELECT here silently
stopped that sweep from touching private boards at all.


### PostgREST self-referencing embeds are ambiguous *(avoided, never shipped)*

The first implementation resolved parent titles with
`parent:tasks!tasks_parent_task_id_fkey(id, title)`. `parent_task_id` is a
**self-referencing** foreign key, where PostgREST's `!hint` is ambiguous between
the parent direction (to-one, returns an object) and the children direction
(to-many, returns an array). The wrong resolution makes `task.parent?.title`
silently `undefined` and every breadcrumb vanish - and it could not be verified
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

Found by running the migration against a real Postgres instance - code review
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

- Docs / wiki / collaborative editing - Notion exists
- Gantt / timeline - large UI cost, low usage outside construction and agencies
- Offline support - needs a different sync architecture entirely
- A generic automation rules engine - start with three hardcoded rules on Vercel
  Cron instead (overdue → notify owner; all subtasks done → complete parent;
  recurring task spawn, since the `is_recurring` columns from `025` are unused)
- More than two integrations - Google Calendar (one-way export) and Slack
- Multi-tenant / organization-switching machinery. Per the owner's 2026-07-24
  ruling this product serves **exactly one organisation, permanently**, so the
  old note here that "`task_statuses.key` is globally UNIQUE and `companies.code`
  has a global `unique(lower(code))`, which must become composite with an org id
  before a second tenant exists" is moot rather than outstanding. `companies`
  (SRG/AGC) is a business-unit label used by the marketing calendar, **not** a
  tenant - do not overload it into one.
