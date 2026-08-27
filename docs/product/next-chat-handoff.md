# Next-chat handoff prompt

Paste the block below as the **first message** of a new Claude Code chat to continue this build.

**Important:** start that chat *inside* `/Users/vanshajpoonia/Code/Project manager` so the memory,
`.env.local`, the DB guard, and `CLAUDE.md` all line up automatically. Keep this file in sync whenever
project state changes materially (branch position, next migration number, which phase is next,
commit/test counts) - it is pasted verbatim, so a stale fact here actively misleads the next session.

---

```
Continue building my unified project-management product in this folder
(/Users/vanshajpoonia/Code/Project manager), branch `main`. Before doing
anything, read these files (they are the source of truth):

## Read first - the plan & where everything lives
- docs/product/master-product-context.md → the governing charter (sections
                                        A–F): foundation rules, product
                                        promise, canonical hierarchy, UX
                                        principles, engineering rules,
                                        response format. Stored verbatim, with
                                        a reconciliation banner at the top
                                        recording two overrides (below).
- docs/product/master-prompt.md      → the CANONICAL spec: my 10 prompts
                                        (PROMPT 1–10), verbatim. This is the
                                        index.
- docs/product/build-navigation.md   → status of each prompt + how the three
                                        numbering schemes reconcile. READ THIS
                                        to orient; follow its "working posture".
- CLAUDE.md (repo root)               → single-org access-control execution
                                        plan (Phase 0–4) + the DB guardrail
                                        rules. Phases here are execution
                                        detail for PROMPT 3.
- FEATURES.md (repo root)             → feature roadmap (its Phase 1–8 is a
                                        SEPARATE numbering - don't conflate).
- docs/architecture/*.md             → PROMPT 1 output (audit + ADR-001).
  ADR-001 already decided: build on the existing Next.js 16 + Supabase app,
  NOT Plane. Ignore any "fork/sidecar/upstream" framing in PROMPT 1.

## ⚠️ Standing ruling - read before touching PROMPT 3 or "organizations"
**This product is built for exactly one organization, permanently - Bobby's
company (business units SRG/AGC). It is NOT a multi-tenant SaaS product**
(owner ruling, 2026-07-24). PROMPT 3's literal "Organizations" (plural) /
tenant-isolation content is N/A. Teams, Guests, Clients, project-level roles,
custom roles, the permission matrix, and module activation still apply -
scoped within the one existing org, no org_id/tenant-RLS schema. If a fresh
chat ever proposes an `organizations`/`org_members` table or a tenant/
workspace-switcher UI, that's drift - stop and re-read this ruling first.

## The three numbering schemes (this was confusing before - don't re-confuse it)
master PROMPT 1–10 = the INDEX. CLAUDE.md Phase 0–4 and FEATURES.md
Phase 1–8 are execution detail UNDER specific prompts. When they disagree on
WHAT to build, the master prompt (as reinterpreted by the ruling above) wins.

## Current status (2026-07-24)
- PROMPT 1 ✅ done. PROMPT 2 🔄 in progress - the app-shell/chrome sub-slice (design system,
  AppShell, ⌘K command palette, deep-linkable tabs) is done (FEATURES.md log, 2026-07-23), but
  master-prompt.md's fuller PROMPT 2 scope (personal inbox, recently-viewed/favorite/pinned views,
  toasts-with-undo, unsaved-change warnings, accessibility automation on nav) isn't confirmed built -
  that's what "in progress" means per build-navigation.md's reconciliation.
- PROMPT 3 (single-org access control) - **slice 1 ✅ DONE, schema + UI,
  browser-verified**: teams/team_members (migration 064), board_members.role
  for guest/client scoping (065), singleton app_modules config table +
  lib/modules.ts registry (066), a fix for a pre-existing gap in the tasks
  INSERT policy (067). Verified via `pnpm check:board-roles` (9/9) AND a real
  Playwright browser session (guest role correctly disables edit controls,
  plain member unaffected, zero console errors). UI wired: board-view.tsx /
  task-card.tsx / task-detail-modal.tsx's existing canEdit/canDelete/
  canEditDueDate checks now take a boardRole prop; user-dashboard.tsx /
  admin-dashboard.tsx nav now reads useAppModules(). (The AiChatWidget /
  BookmarksSection gating that was outstanding here is now done - 2026-08-13.)
- **NEW 2026-08-13 - the owner supplied a research pack in `plan/`** and asked for it
  to be implemented. Three files: `ATLAS_01_…GUIDE.md` (competitor audit + design
  guide; §13 is the build priority, §10 the concrete requirements),
  `ATLAS_02_…PROMPTS_AUDITED.md` (Prompts A–M, one per session - its own header says
  do NOT implement them all at once), and `ATLAS_MASTER_…PACK.md` (01+02 concatenated).
  These do NOT replace master-prompt.md; they refine it. Mapping: Prompt A ≈ finishing
  PROMPT 2, Prompt B ≈ later PROMPT 3 slices, Prompt C ≈ PROMPT 4 / FEATURES Phase 1.
- **Foundation slice 1 of that pack ✅ DONE 2026-08-13, application-layer only, no
  migration.** Shipped: `lib/capabilities.ts` (the canonical capability vocabulary -
  board/task permission checks were copy-pasted inline across three files and now all
  resolve through `can()`; behaviour pinned unchanged by 24 tests), `ActionGuard`/
  `RestrictionNote` (unavailable actions explain themselves instead of vanishing), a
  rebuilt ⌘K palette (Recent / Go to / Search results / Create, every command carrying
  its `CapabilityDecision`, `runCommand` refusing denied ones), recently-viewed records
  (the sidebar's Recent block existed but nothing ever fed it), per-user density
  (Compact/Comfortable/Expanded on board cards), and **`/my-work`** - a real route,
  where the nav had advertised "soon" over a 404. 315 tests green, build clean,
  24/24 real-browser checks, `check:board-roles` still 9/9.
- **Teams shipped 2026-08-13 (migration `094`, dev only) + three audit fixes.** Owner
  asked for two teams (Atlas General, Shanks Realty), everyone in both, super admins
  able to add/remove/move members. Audit first found `teams`/`team_members` held **0
  rows on dev AND prod** with zero call sites, so this was a first population. `094`
  seeds both business units (names match the `companies` rows but are deliberately NOT
  FK'd - `companies` stays a marketing label), cross-joins every profile into both,
  narrows management from `is_admin_user()` to `is_super_admin_user()`, and closes the
  Supabase blanket-grant hole on those two tables. UI is a fourth tab on
  `/admin/super-admin`: a **people × teams grid** (a *move* is only legible with both
  teams on screen). `pnpm check:teams` 27/27 + 17/17 real-browser checks. Also fixed:
  `task_notifications` were being marked read on page load whether or not anyone looked
  (prod evidence: Bobby 0 unread of 6, Kayla 0 of 42, vs Tim 47/47 and Vanshaj 45/45);
  the toast's "Open" button always went to `/dashboard` instead of the task; and
  `ai_assistant`/`bookmarks` module toggles did nothing.
- ✅ **`094` and `095` are now on PROD** (applied by the owner, 2026-08-13). Prod is at `094`
  applied / 2 pending, both deliberate. **`096` and `097` are dev-only.** `096` is a no-op on
  prod (it already has the trigger), worth applying only so both databases are provably
  identical. **`097` (`user_favorites`) is purely additive and IS `--allow-prod` eligible** -
  apply it *before* merging Prompt A's code or every star click fails:
  `node --env-file=.env.production.local scripts/migrate.mjs --only=097 --allow-prod`
  Rollbacks: `scripts/rollback/09{4,5,6,7}_revert.sql`. Note `097`'s rollback destroys real
  user data (everyone's stars) - snapshot the table first if the intent is code-only.
- **✅ ATLAS_02 Prompt A is CLOSED (2026-08-13).** Favourites (migration `097` - sidebar block,
  ⌘K group, stars on board cards and the board header), undo-capable toasts on the two silent
  hard deletes, unsaved-change protection on the create-task dialog, axe automation, and the
  200%/320% zoom passes. That automation found four real defects, three of them pre-existing:
  collapsed sidebar links had **no accessible name at all**; **dialog focus restoration never
  worked anywhere** (focus fell to `body` after closing any dialog - fixed generally in the
  shared `Dialog` wrapper); the page **scrolled sideways at 320px**; and a board card
  overflowed its grid cell by 91px, stealing the star's click target. `pnpm check:teams` was
  also repaired - it had two checks in direct tension and was guaranteed to fail the first
  time a real account was created after `094`. **Deliberately deferred: pinned views**, which
  need saved views (Prompt E) to exist; `user_favorites.entity_type` already accepts `'view'`.
- **✅ Owner feedback batch shipped 2026-08-14 (five items, dev only, migration `102`).**
  (1) **Dark/light on every page.** The toggle lives in `AppTopbar`, but board pages render
  *outside* `AppShell` (kanban needs the full width) and `/admin/super-admin` builds its own
  header - so both were dark-mode dead ends. `ThemeToggle` added to each; three hand-rolled
  switch controls that hardcoded `bg-gray-300`/`bg-white` retokenized. (2) **Move a task to a
  different board** - see the `102` note in CLAUDE.md; the task keeps its comments,
  attachments, links, activity and subtasks, and the move is logged. (3) **The mic was dead
  everywhere**, and it was one line of `next.config.mjs`: `Permissions-Policy:
  microphone=()`. Chrome gates `SpeechRecognition.start()` on that feature, so every click of
  the dictation button failed. Now `microphone=(self)`. Measured both ways in a real browser:
  `document.featurePolicy.allowsFeature('microphone')` is `false` with `()` and `true` with
  `(self)`. (4) **Project IDs**: the number auto-copies on grab, stays on screen in a "Just
  grabbed" panel with its own copy button, every history row has a copy button, and the
  12-tile "Ready to use" preview panel that took the left half of the page is gone.
  (5) **A super admin can change their own password** in the Users tab - their own card used
  to hide every action. Role stays locked on a self-edit (server-side too: `update-user`
  refuses a self role change, since demoting yourself locks you out). ⚠️ Found in the browser:
  **Supabase revokes every session when a password changes, including the one making the
  change** - so the UI now signs you out and sends you to `/login` rather than claiming you
  stay signed in. Gates: `pnpm check:task-move` (19/19), 23/23 real-browser checks, 503 unit
  tests, and `board-roles`/`access-matrix`/`task-lifecycle`/`deactivation` all re-run green.
- **Prompt C is BUILT and its migrations are ON PROD (`112`-`115`, applied 2026-08-23).** The canonical
  work-item domain: normalized status **categories** (retiring the substring heuristic that
  read `wip`/`review`/`blocked` as To Do), **work item types** (`work_item_types` +
  `tasks.type_key`, eleven seeded, two active), the **custom field engine**
  (`field_definitions` + `field_values`, all 12 types, validated by a database trigger), and
  **relations** (`task_relations` - blocks/precedes/duplicates/relates to, with the inverses
  derived by a `security_invoker` view rather than stored twice). UI shipped with it: Super
  Admin gained **Types** and **Fields** tabs, the Statuses tab gained a **Means** picker, and
  the work-item modal gained a **Details** section and a **Relations** panel.
  Gates: `pnpm check:work-items` (94, real RLS), `pnpm check:work-items-ui` (31, real
  browser), 893 unit tests, and `task-lifecycle`/`board-roles`/`access-matrix`/`task-move`/
  `column-delete`/`grants`/`board-columns` all re-run green.
  **Dev and prod are both at `115`, 0 pending.** Applied one file at a time with
  `--only=NNN --allow-prod`, verified between each; every table's row count was identical
  before and after, and a `pg_restore --list`-verified backup was taken first
  (`~/Code/prod-backup-pre-112to115-20260823-205453.dump`). Prod is currently running the
  PREVIOUS code against the new schema, which is fine - the migrations are additive and the
  old query shapes were re-checked against prod directly.
  **Prod has a fifth status, "Pending Approval", that dev does not.** The migration gave it
  `planned` (behaviour-preserving); it was corrected to **`started`** on 2026-08-23 after the
  deploy, as a separate visible step. One live task was affected. ⚠️ **Dev still has only four
  statuses**, so anything that assumes dev and prod have the same status list is wrong.
  **The code is DEPLOYED**: `main` is at `b88ed49`, Vercel Production deployment succeeded,
  live bundle verified pointing at the prod project with zero console errors on first paint.
  All nine non-system work item types are still switched OFF and no custom fields are defined -
  deliberately, so the deploy changed nothing anyone sees. Turning one on is the first thing to
  do when someone actually wants Bugs or Risks as a separate kind of work.
- **Prompt D is SHIPPED to dev AND prod (`116`-`117`, 2026-08-24).** Quick
  capture (deterministic one-line parsing, no LLM, with every interpreted field shown as a
  removable chip carrying the absolute value), paste-a-list multi-create (previews first;
  indentation is reported, never acted on silently), bulk operations (plans before it runs, so
  the confirmation says "18 of 30 will change" rather than "30 selected"; a run with any
  refusal is never called a success), **real recurrence** (`recurrence_rules` +
  `recurrence_occurrences`, idempotent by a UNIQUE constraint) and **per-user private
  reminders** (`task_reminders`, no admin bypass on any policy).
  **Both migrations are purely additive and were applied to prod on 2026-08-24**, one file at a
  time with `--only=NNN --allow-prod`, verified between each, after a `pg_restore --list`-verified
  backup (`~/Code/prod-backup-pre-116to117-20260824-204753.dump`, 51 tables). **Prod ledger is at
  `117`.** Every row count was identical before and after: 171 tasks, 11 boards, 10 profiles.
  `116`'s own post-conditions reported **10 rules backfilled, 4 recurring tasks skipped as
  unschedulable, 0 occurrences generated** - so the deploy created no work on day one, because
  every backfilled rule is `on_completion`. The code is DEPLOYED: `main` is at `a72120e`, the
  Vercel Production deployment reported success, and the cron route was re-verified against the
  LIVE site (401 with no header, 401 with a wrong secret) which also proves the `lib/email.ts`
  import crash is not in production. Rollbacks exist; `116`'s destroys the occurrence ledger,
  which is the one thing that cannot be reconstructed.
  ⚠️ **Still an OWNER DECISION: the 4 recurring tasks on prod with no cadence** - "Before & After
  Pix Constantly", "Begin and continuisouly develope a Handyman Handbook", "Get with Beth Smith
  @ SGR to particpate more often", "Migrate AGC clients in HOUZZ to Brevo" (all on Marketing PM
  Sheet, created 2026-06-18, no due dates). They read as ongoing efforts rather than scheduled
  repeats, so the recommendation is to clear `is_recurring` rather than invent a cadence. They
  deliberately got no rule and the panel says so on screen.
  **`CRON_SECRET` is set** in `.env.local` and in Vercel (Production + Development; Preview
  skipped on purpose, cron only fires on Production). The route was verified by curl: 401 with
  no header, 401 with a wrong secret, 200 and an honest report with the right one.
  ⚠️ **The Vercel project is on the HOBBY plan** (verified via the API): cron runs once a day,
  max two jobs. That is why `117` also exposes `deliver_my_due_reminders()` and the app calls it
  every 5 minutes while open - in-app reminders are near-real-time, email is once a day.
  **What it replaced:** `025`/`086`'s five recurrence columns had a prominent toggle wired to
  nothing for months (14 such tasks on production, 4 with no pattern at all - those deliberately
  got NO rule rather than an invented cadence), and `lib/reminder-service.ts` was an unscheduled
  `'use server'` function with zero call sites, now **deleted**.
  Gates: `pnpm check:recurrence` (84, real RLS), `pnpm check:recurrence-ui` (75, real browser),
  1185 unit tests, and `work-items`/`task-lifecycle`/`access-matrix`/`board-roles`/`grants`/
  `task-move`/`board-nav`/`work-items-ui`/`shell-actions` all re-run green.
  **A completion pass on 2026-08-24 closed four gaps the first audit had called done:** editing a
  schedule now states what happened to the tasks it already created (it never could rewrite them,
  but the requirement is "not *silently*"); the bulk report offers **Retry N failed** with attempt
  counts, consuming a `retryableIds` field that had sat unused since the engine was written; `C`
  opens quick capture; and `HelpDialog` is now mounted on the board, which had never had it
  because a board renders outside AppShell - so the only place shortcuts are documented was
  unreachable from the screen the new one works on.
  ⚠️ **The UI harness was flaky and passing by luck** - three consecutive runs of identical code
  failed three different checks, and one pair made correct behaviour look broken by reading the
  database before the write landed (`Run now` reported `0 created`, then `0 -> 5`). Every database
  assertion polls now; stable at 75/75 across four consecutive runs.
  **Three things learned, all worth reading in CLAUDE.md:** (1) `REVOKE ALL ON FUNCTION ... FROM
  PUBLIC` does NOT make a function private here - `postgres` holds a default ACL granting EXECUTE
  to `authenticated` on every new function in `public`, and two SECURITY DEFINER functions
  shipped to dev callable by any signed-in user before that was measured. (2) A CHECK constraint
  PASSES when its expression is NULL, and `array_length('{}',1)` is NULL - so the weekday
  constraint accepted exactly the value it existed to reject. (3) `lib/email.ts` built its Resend
  client at MODULE scope, so an unset `RESEND_API_KEY` made every importer crash - including the
  cron route, which 500'd before its own auth check and took recurrence generation with it. It
  is lazy now, which also fixes the four components that import it.
- **Prompt E is SHIPPED to dev AND prod (`118`-`119`, 2026-08-25).** One configuration model that
  four layouts render from, at **`/views`** (a real route, in the nav for every role, next to
  My Work). `lib/view-config.ts` holds the whole vocabulary - layout, board scope, descendant
  behaviour, filters with the nine operators plus AND/OR, sort, grouping, an ordered visible-field
  list, density, hierarchy and completed-item handling - and one `runView` pipeline every layout
  calls, so the same question cannot give two answers on two screens. Layouts: **List**, **Table**
  (resize + reorder columns, sticky title, sort by header, inline rename, bulk select),
  **Kanban** grouped by ANY field rather than by the board's own columns, and **Calendar**
  (month/week/day, an unscheduled tray, drag to reschedule).
  **Both migrations were applied to PROD on 2026-08-25**, one file at a time with
  `--only=NNN --allow-prod`, after a `pg_restore --list`-verified backup
  (`~/Code/prod-backup-pre-118to119-20260825-225719.dump`, 54 tables). Prod went 117 -> 119,
  `pending: 0`. **Both seed nothing** - `118` leaves every board a root and `119` creates zero
  views - so the deploy changed nothing anyone could see; the first hierarchy appears when an
  admin picks a parent in Boards > New/Edit.
  ⚠️ **`118` is NOT `--allow-prod` eligible on this repo's own rule** (it puts a trigger on
  `boards`, the reasoning that held `098` back). It went to prod as a deliberate owner decision
  after the risk was stated, exactly as `113` did. **Do not treat it as precedent.**
  **The audit came first and found three implementations of one idea**: `reports-view.tsx` had
  nine `useState`s reduced in a `useEffect` into a second state, `board-view.tsx` had an inline
  `filterTasks()`, `calendar-view.tsx` had none. They disagreed - reports offered Unassigned and
  the board did not, the board offered overdue and reports did not. Both now route through the
  shared engine.
  ⚠️ **Collapsing them fixed a LIVE timezone bug in both.** The old code parsed a `YYYY-MM-DD`
  DATE column into an instant and compared it against a local midnight, so **a task due today
  read as overdue for a five-hour window every evening**, and Reports' From/To boundaries
  included or excluded a task depending on the reader's timezone. Same defect already recorded
  for the CRM.
  **`118` exists because `boards` had no parent column at all** - checked against dev and prod,
  not assumed - so Prompt E's loudest requirement had nothing to stand on. Descendant membership
  is COMPUTED by walking `parent_board_id` at read time, never stored, which is exactly the
  Vikunja failure ATLAS_01 4.6 describes. An admin sets it in **Boards → New/Edit → Parent
  board**, and the picker excludes the board and its subtree rather than offering something the
  cycle guard will refuse.
  Gates: `pnpm check:views` (65, real RLS) and `pnpm check:views-ui` (38, real browser, stable
  across four consecutive runs), plus 1420 unit tests, a clean `next build` with the dev ref
  confirmed baked, and `board-nav`/`work-items-ui`/`shell-actions`/`recurrence-ui`/`access-matrix`/
  `board-roles`/`task-lifecycle`/`grants`/`work-items`/`column-delete` all re-run green.
  ⚠️ **Four defects only the real browser found**, all fixed: a view saved while scoped to a
  board was unreachable next visit (the picker filtered by a scope you had not selected yet);
  the table's inline-rename control was permanently invisible to a mouse (`group-hover` with no
  `group` ancestor); a React key warning from `TableLayout`; and `enforce_task_lifecycle` quietly
  moving a seeded task out of its intended column, which had been testing the wrong fixture.
- ✅ **`118`/`119` are on prod** (2026-08-25) and **the pre-Prompt-F cleanup is done and
  DEPLOYED** (merged to `main` as `2142cc8`, live 2026-08-27, deployment status `success`).
  That cleanup was meant to be three small items and turned up **two live production bugs**
  instead - read the Prompt-F entry below before starting F. It carried no SQL, so there was
  no migration to sequence ahead of the merge; dev and prod both remain at `119`.
- ⚠️⚠️ **`tasks.due_date` is `TIMESTAMPTZ`, NOT a `DATE` column.** It stores MIDNIGHT on the
  chosen day, and there are two writers producing two shapes (`T00:00:00+00:00` from
  `create-task-dialog`'s `<input type="date">`, `T05:00:00+00:00` from `task-detail-modal`'s
  picker at Chicago midnight). **The intended day is the UTC date part**; resolving the instant
  through `businessDate()` lands on the day BEFORE. Use `dueCalendarDate` / `taskDueDate` from
  `lib/calendar-grid.ts`. `businessDate` stays correct for genuine instants like `created_at`.
  - This was wrong on production from the Prompt E deploy (2026-08-25) until the `2142cc8`
    deploy on 2026-08-27: **`/views`, the board and Reports returned a task due TODAY from the
    `overdue` filter.** `/my-work` had an older variant of the same shift. Both fixed and both
    live.
  - It survived ~1420 passing tests because **every fixture used a shape the column never
    sends** - My Work's were `toISOString()` timestamps, Prompt E's were bare `'2026-08-25'`
    strings, and each suite tested the one shape its own bug could not reach. When writing a
    fixture for a column, **query the column first and paste what it really returns.**
- NEXT actual work is NOT decided - ASK THE OWNER. The owner has said they intend **Prompt F**
  (My Work sections, WorkNext reasons, and the Inbox) next, but has not started it. Other open
  candidates: **Prompt B**'s one honest gap (membership **audit events**). Also open: the
  **Inbox** (Prompt F) - needs **no new table**, `task_notifications` (migration `035`) already
  exists with inbox-shaped RLS (84 rows on the dev clone, split `assignment` 58 / `update` 26 -
  which is already Prompt F's two-bucket shape; the prod count has not been re-read this session),
  and now that the toast no longer eats them
  unread state finally accumulates (open question: what to do with the ~121 already-unread
  rows, some from June) - and work-item **context actions in ⌘K** (blocked: `board-view.tsx`
  renders outside `AppShell`, so the shell has no selected-item context).
- **`095` closed the anon-grant gap (dev only).** `anon` now holds nothing on any table,
  sequence or function in `public`, and the *default privileges* are narrowed so new
  tables don't inherit it. `authenticated` keeps all its DML; only TRUNCATE/REFERENCES/
  TRIGGER were removed. Gate: `pnpm check:grants` (16/16). ⚠️ Three function grants are
  deliberately kept and asserted: `book_appointment`, `cancel_appointment`,
  `check_booking_rate_limit` - `082` granted them on purpose and
  `app/api/book/cancel/[token]/route.ts` calls one with an anon client. Two traps worth
  remembering: `has_sequence_privilege()` gets evaluated before a `relkind` filter unless
  you add an `OFFSET 0` fence, and `REVOKE ... FROM anon` is a **no-op** where the grant
  actually came from Postgres's implicit `EXECUTE TO PUBLIC` (three SECURITY DEFINER
  helpers were in that state; `is_board_member` was reachable over PostgREST).
- **`096` restored the `on_auth_user_created` trigger - the dev sandbox had lost it.**
  `handle_new_user` existed as an orphaned function attached to nothing. This is
  **sandbox drift, not a prod bug**: the trigger sits on `auth.users`, outside `public`,
  so a public-only clone drops it. Prod verified healthy (11 auth accounts, 10 profiles,
  five most recent all have their row). **If you ever re-clone prod into the sandbox,
  expect to lose it again and re-apply `096`.**
- **Fixed `app/api/admin/create-user/route.ts`.** It used a bare `.update().eq()` on
  profiles, silently depending on that trigger. A zero-row UPDATE is not an error in
  PostgREST, so on any database missing the trigger it returned `success: true` while
  creating an account with **no profile** - and `profiles.role` drives every permission
  check. Now upserts and verifies a row came back. Note `/signup` is deliberately
  disabled (redirects to `/login`), so this route is the *only* way accounts get made,
  which is exactly why its silent failure mode mattered.

## Commit history for the slice-1 work
The slice-1 work above was committed 2026-07-24 in 3 sliced commits (not pushed):
`d631083` (schema + check-board-roles.mjs + lib/modules.ts registry), `df5d3ad` (UI wiring:
boardRole threading + useAppModules() in both dashboards), `49eebb1` (docs reconciliation: the
single-org ruling stored across CLAUDE.md/FEATURES.md/build-navigation.md/master-prompt.md/
master-product-context.md/this file). If `git status` ever shows this work uncommitted again in a
future session, that's a regression - don't assume it's still pending.

## ⛔ DATABASE GUARDRAILS - do not violate
- TWO databases: dev sandbox (Supabase ref pxzpewaerhjwnwsbaklc) = a full
  clone of prod, used for local dev + all migrations. Production (ref
  icyfluwgyuimhwlddjyy) = the live app, Vercel-deployed.
- This folder's .env.local points at the DEV sandbox. Vercel uses its own
  env vars (prod) - unaffected by .env.local.
- scripts/guard-db.mjs enforces this. Run `pnpm guard` to see the active
  target. assertDevDatabase() = dev-only (app/dev path, no opt-in).
  assertMigrationTarget({allowProd}) = the migration runner: dev always
  allowed, prod ONLY via an explicit --allow-prod flag + loud banner. Only
  additive/non-destructive migrations may ever use --allow-prod.
- Migrations: numbered SQL in scripts/, next number is 104. Dev is at 103;
  production is at 095 with 096–103 NOT applied, and 087 has never been applied
  to prod either (nobody is affected by its absence - see CLAUDE.md). 088–093
  and 097 went to prod via `--only=… --allow-prod`, which is how you skip a
  held-back predecessor. ⚠️ **102 (cross-board task move) rewrites an RLS
  policy, so it is not `--allow-prod` eligible, AND the "Move" button on a task
  cannot ship without it** - apply it deliberately before merging that code.
  103 (CRM) IS purely additive and `--allow-prod` eligible, and it seeds the
  module `enabled = false`, so applying it changes nothing visible until a
  super admin turns CRM on. Always confirm with `pnpm migrate:status` rather
  than trusting these numbers.
  New tables need an explicit REVOKE ALL first - Supabase default-grants ALL on
  every new public table to anon and authenticated (see 090).
  Verify with `pnpm migrate:status`, never with a number written down anywhere.
  Apply via the runner only: `pnpm migrate` (status:
  `pnpm migrate:status`). Never hand-run SQL in the Supabase editor. Each
  file wraps itself in BEGIN;…COMMIT; and is idempotent (match 047/063/065
  style).
- Permanent, non-destructive verification harnesses exist and all follow the
  same throwaway-user pattern - re-run the relevant one after touching RLS:
  `pnpm check:board-roles` (board_members/tasks), `check:grants` (anon holds nothing
  in public; the booking RPCs still do), `check:favorites` (a favourites list is private
  to its owner with NO admin exemption, and starring a private board grants nothing),
  `check:teams` (super-admin-only
  team management, with an admin-tier control case), `check:marketing-calendars`
  (per-calendar access), `check:marketing-channels` (channel ordering + who may
  rename), `check:project-ids` (number uniqueness under concurrency + ledger
  permanence), `check:task-lifecycle`, `check:appointments`,
  `check:appointment-booking`, `check:marketing-attachments`,
  `check:marketing-recurrence`, `check:task-attachments` (admin-only large
  uploads), `check:chat-attachments` (DM attachments private + conversation-scoped),
  `check:task-move` (a task moves boards with its subtasks, and ONLY onto a board
  the mover may write to - migration 102).
- Before any destructive migration: take a fresh dev pg_dump snapshot
  (backups live in ~/Code/db-backups/; use
  /opt/homebrew/opt/libpq/bin/pg_dump if the Homebrew default errors on a
  server-version mismatch - and never let a pg_dump error reach a
  transcript/log as-is, it can embed the raw connection string with password).
- A dev DB password was transiently exposed in a tool-output error on
  2026-07-24 (the underlying bug is fixed so it can't recur). The owner
  explicitly said NOT to rotate it - "I will tell when I want to." Do not
  rotate it proactively.
- Do NOT edit scripts/guard-db.mjs to weaken it. If it blocks you, that's the
  signal to STOP, not to patch around it.
- There is a locked, immutable golden DB snapshot at
  ~/Code/GOLDEN-prod-original-DO-NOT-DELETE-20260723-152216.dump - never
  delete, move, or unlock it.

## Git / shipping
- ✅ **SHIPPED 2026-08-12 - private chat attachments (092) + max upload limits (093) + a CSP fix.**
  `chat-attachments` was created public with no size or MIME limit, so every DM attachment was
  readable off the CDN by anyone holding the URL, with no session - and the client stored exactly
  that public URL on `chat_messages.image_url`. 092 makes the bucket private (10 MB, MIME
  allowlist), adds `chat_messages.attachment_path`, and narrows the read policy from 002's "any
  authenticated user can read every chat file" to sender/recipient/admin. Safe to apply: **0 of 6
  prod messages (and 0 of 4 dev) reference an attachment**, so there is no live link to break and
  no backfill. One orphaned ~399 kB object per database is deliberately left in place.
  Verified by `pnpm check:chat-attachments` (16/16, including an unauthenticated fetch of the old
  public URL now returning 400). Rollback: `scripts/rollback/092_revert.sql`.
  **093** then raised every bucket to the plan maximum: `task-assets`, `chat-attachments` and
  `marketing-assets` are all now private / 50 MB / 23 MIME types. 50 MB is the Supabase **Free**
  hard per-file ceiling - not a setting, it needs a plan change to exceed. The inline base64 task
  path is deliberately still 10 MB (043); raising that puts 33%-inflated bytes into a 500 MB
  database budget, which is the exact failure the large-file toggle exists to avoid.
  Alongside it, `next.config.mjs`'s CSP `img-src` gained `blob:` and `https://*.supabase.co` -
  without them the marketing calendar's image preview was **already broken in production** and
  the new task thumbnails would have shipped broken. CSP is production-only, so `pnpm dev` can
  never catch this; verified against a real production build (thumbnail `naturalWidth=64`).
- ✅ **SHIPPED 2026-08-12 - large task attachments (migration 091).**
  An admin-only, per-upload opt-in that routes a task attachment to the new private
  `task-assets` Storage bucket (50 MB - the Supabase **Free** plan's hard per-file ceiling)
  instead of base64-ing it into `task_attachments.file_data`. The inline path is untouched at
  10 MB for everyone. `storage_path` and `file_data` are mutually exclusive (CHECK), the INSERT
  policy rejects a `storage_path` from anyone `private.is_admin_user()` is false for, and
  *reading* is deliberately not admin-gated. Verified: `pnpm check:task-attachments` (15/15
  against real RLS) + 14/14 real-browser Playwright + 218 unit tests + `pnpm build`.
  Applied to prod 2026-08-12 (post-conditions confirmed 12 existing attachments intact).
  Rollback: `scripts/rollback/091_revert.sql`. Note the Free-plan storage budget is 1 GB in
  total, ~20 files at full size; that is why this is opt-in, not default.
- Local `main` == origin/main (pushed + deployed as of 2026-08-12). Most recently shipped:
  the **Project ID Manager** (migration 090) - a new "Project IDs" module where anyone signed
  in grabs the next YYMM+4-digit number (e.g. 26081111, sequence restarts at 1111 each Central
  month) against a client name. The claimer is taken from the session, never picked from a
  dropdown. `public.claim_project_id()` allocates under an advisory lock so simultaneous
  clicks can't collide; `project_ids` has no INSERT/DELETE grant at all (the RPC is the only
  way in, and nothing can un-claim a number) and only `client_name`/`company_id` are
  column-grant-updatable. Before that: rearrangeable marketing calendar columns (088) and a
  "Personal" business unit (089).
- A push to `main` AUTO-DEPLOYS to prod within seconds. So: apply any schema
  migration to prod (`--allow-prod`) BEFORE merging code that depends on it -
  a missing 068 once shipped ahead of its migration and broke the live boards
  list for ~6h. Migrations first, then deploy. Prefer small sliced commits.
- Do NOT add "Co-Authored-By: Claude" trailers to commits (repo rule).
- Tests: `pnpm test` (currently 429 passing across 33 files - keep them green).
  `pnpm lint` is broken repo-wide (ESLint 10 with no eslint.config.js); use
  `npx tsc --noEmit` for a real check until someone adds a flat config.
- `pnpm build` / `pnpm start` locally read `.env.production.local` and therefore talk
  to PROD. To build safely: move that file aside, build, restore it, and confirm which
  ref got baked with
  `grep -rhoE '(icyfluwgyuimhwlddjyy|pxzpewaerhjwnwsbaklc)' .next/static/chunks/*.js | sort -u`.

## Working posture (my standing rule)
For every prompt/feature: analyze → scope-check against build-navigation.md +
FEATURES.md → clash-check → propose a plan → get my OK → THEN implement in
small slices. Do not start feature code before I accept the plan. Flag any
conflict with existing work before touching code.

Start by reading the files above, confirm the current state matches this
(git status, pnpm test, pnpm migrate:status), then ask me what to work on
next - don't assume it's the next numbered prompt.
```
