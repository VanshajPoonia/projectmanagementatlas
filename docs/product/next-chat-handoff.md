# Next-chat handoff prompt

Paste the block below as the **first message** of a new Claude Code chat to continue this build.

**Important:** start that chat *inside* `/Users/vanshajpoonia/Code/Project manager` so the memory,
`.env.local`, the DB guard, and `CLAUDE.md` all line up automatically. Keep this file in sync whenever
project state changes materially (branch position, next migration number, which phase is next,
commit/test counts) — it is pasted verbatim, so a stale fact here actively misleads the next session.

---

```
Continue building my unified project-management product in this folder
(/Users/vanshajpoonia/Code/Project manager), branch `main`. Before doing
anything, read these files (they are the source of truth):

## Read first — the plan & where everything lives
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
                                        SEPARATE numbering — don't conflate).
- docs/architecture/*.md             → PROMPT 1 output (audit + ADR-001).
  ADR-001 already decided: build on the existing Next.js 16 + Supabase app,
  NOT Plane. Ignore any "fork/sidecar/upstream" framing in PROMPT 1.

## ⚠️ Standing ruling — read before touching PROMPT 3 or "organizations"
**This product is built for exactly one organization, permanently — Bobby's
company (business units SRG/AGC). It is NOT a multi-tenant SaaS product**
(owner ruling, 2026-07-24). PROMPT 3's literal "Organizations" (plural) /
tenant-isolation content is N/A. Teams, Guests, Clients, project-level roles,
custom roles, the permission matrix, and module activation still apply —
scoped within the one existing org, no org_id/tenant-RLS schema. If a fresh
chat ever proposes an `organizations`/`org_members` table or a tenant/
workspace-switcher UI, that's drift — stop and re-read this ruling first.

## The three numbering schemes (this was confusing before — don't re-confuse it)
master PROMPT 1–10 = the INDEX. CLAUDE.md Phase 0–4 and FEATURES.md
Phase 1–8 are execution detail UNDER specific prompts. When they disagree on
WHAT to build, the master prompt (as reinterpreted by the ruling above) wins.

## Current status (2026-07-24)
- PROMPT 1 ✅ done. PROMPT 2 🔄 in progress — the app-shell/chrome sub-slice (design system,
  AppShell, ⌘K command palette, deep-linkable tabs) is done (FEATURES.md log, 2026-07-23), but
  master-prompt.md's fuller PROMPT 2 scope (personal inbox, recently-viewed/favorite/pinned views,
  toasts-with-undo, unsaved-change warnings, accessibility automation on nav) isn't confirmed built —
  that's what "in progress" means per build-navigation.md's reconciliation.
- PROMPT 3 (single-org access control) — **slice 1 ✅ DONE, schema + UI,
  browser-verified**: teams/team_members (migration 064), board_members.role
  for guest/client scoping (065), singleton app_modules config table +
  lib/modules.ts registry (066), a fix for a pre-existing gap in the tasks
  INSERT policy (067). Verified via `pnpm check:board-roles` (9/9) AND a real
  Playwright browser session (guest role correctly disables edit controls,
  plain member unaffected, zero console errors). UI wired: board-view.tsx /
  task-card.tsx / task-detail-modal.tsx's existing canEdit/canDelete/
  canEditDueDate checks now take a boardRole prop; user-dashboard.tsx /
  admin-dashboard.tsx nav now reads useAppModules(). (The AiChatWidget /
  BookmarksSection gating that was outstanding here is now done — 2026-08-13.)
- **NEW 2026-08-13 — the owner supplied a research pack in `plan/`** and asked for it
  to be implemented. Three files: `ATLAS_01_…GUIDE.md` (competitor audit + design
  guide; §13 is the build priority, §10 the concrete requirements),
  `ATLAS_02_…PROMPTS_AUDITED.md` (Prompts A–M, one per session — its own header says
  do NOT implement them all at once), and `ATLAS_MASTER_…PACK.md` (01+02 concatenated).
  These do NOT replace master-prompt.md; they refine it. Mapping: Prompt A ≈ finishing
  PROMPT 2, Prompt B ≈ later PROMPT 3 slices, Prompt C ≈ PROMPT 4 / FEATURES Phase 1.
- **Foundation slice 1 of that pack ✅ DONE 2026-08-13, application-layer only, no
  migration.** Shipped: `lib/capabilities.ts` (the canonical capability vocabulary —
  board/task permission checks were copy-pasted inline across three files and now all
  resolve through `can()`; behaviour pinned unchanged by 24 tests), `ActionGuard`/
  `RestrictionNote` (unavailable actions explain themselves instead of vanishing), a
  rebuilt ⌘K palette (Recent / Go to / Search results / Create, every command carrying
  its `CapabilityDecision`, `runCommand` refusing denied ones), recently-viewed records
  (the sidebar's Recent block existed but nothing ever fed it), per-user density
  (Compact/Comfortable/Expanded on board cards), and **`/my-work`** — a real route,
  where the nav had advertised "soon" over a 404. 315 tests green, build clean,
  24/24 real-browser checks, `check:board-roles` still 9/9.
- **Teams shipped 2026-08-13 (migration `094`, dev only) + three audit fixes.** Owner
  asked for two teams (Atlas General, Shanks Realty), everyone in both, super admins
  able to add/remove/move members. Audit first found `teams`/`team_members` held **0
  rows on dev AND prod** with zero call sites, so this was a first population. `094`
  seeds both business units (names match the `companies` rows but are deliberately NOT
  FK'd — `companies` stays a marketing label), cross-joins every profile into both,
  narrows management from `is_admin_user()` to `is_super_admin_user()`, and closes the
  Supabase blanket-grant hole on those two tables. UI is a fourth tab on
  `/admin/super-admin`: a **people × teams grid** (a *move* is only legible with both
  teams on screen). `pnpm check:teams` 27/27 + 17/17 real-browser checks. Also fixed:
  `task_notifications` were being marked read on page load whether or not anyone looked
  (prod evidence: Bobby 0 unread of 6, Kayla 0 of 42, vs Tim 47/47 and Vanshaj 45/45);
  the toast's "Open" button always went to `/dashboard` instead of the task; and
  `ai_assistant`/`bookmarks` module toggles did nothing.
- ⚠️ **`094` is applied to DEV ONLY and is not cleared for prod.** It rewrites RLS
  policies and revokes grants = destructive by this repo's rule, so it needs the owner's
  explicit go-ahead, not a drive-by `--allow-prod`. The UI degrades safely without it:
  the Teams tab renders, the list is empty, and 064's admin-tier policy still applies.
  Paired rollback exists at `scripts/rollback/094_revert.sql`.
- NEXT actual work is NOT decided — ASK THE OWNER. The pack's own order says
  Prompt C (canonical work-item + custom fields) is next. The honest open gaps from
  Prompts A/B are smaller: the **Inbox** — which turns out to need **no new table**,
  `task_notifications` (migration `035`) already exists with 169 prod rows and inbox-shaped
  RLS, and now that the toast no longer eats them, unread state finally accumulates
  (open question: what to do with the ~121 already-unread rows, some from June) —
  work-item **context actions in ⌘K** (blocked: `board-view.tsx` renders outside
  `AppShell`, so the shell has no selected-item context), favourites/pinned views,
  undo-capable toasts, and the automated a11y / 200%-320% zoom passes Prompt A asks for.
- **Audit finding, reported not fixed:** `anon` holds `TRUNCATE`/`DELETE` on **28 of 30**
  public tables (all except `teams`/`team_members`, fixed by `094`, and `project_ids`,
  which `090` got right). **Not a live leak** — all 12 `{public}`-role policies are gated
  on `auth.uid()` and PostgREST doesn't expose `TRUNCATE` — but latent: one `USING (true)`
  policy written without `TO authenticated` and `anon` is in. It's one mechanical migration
  that rewrites grants on every live table, so give it its own session and owner sign-off.

## Commit history for the slice-1 work
The slice-1 work above was committed 2026-07-24 in 3 sliced commits (not pushed):
`d631083` (schema + check-board-roles.mjs + lib/modules.ts registry), `df5d3ad` (UI wiring:
boardRole threading + useAppModules() in both dashboards), `49eebb1` (docs reconciliation: the
single-org ruling stored across CLAUDE.md/FEATURES.md/build-navigation.md/master-prompt.md/
master-product-context.md/this file). If `git status` ever shows this work uncommitted again in a
future session, that's a regression — don't assume it's still pending.

## ⛔ DATABASE GUARDRAILS — do not violate
- TWO databases: dev sandbox (Supabase ref pxzpewaerhjwnwsbaklc) = a full
  clone of prod, used for local dev + all migrations. Production (ref
  icyfluwgyuimhwlddjyy) = the live app, Vercel-deployed.
- This folder's .env.local points at the DEV sandbox. Vercel uses its own
  env vars (prod) — unaffected by .env.local.
- scripts/guard-db.mjs enforces this. Run `pnpm guard` to see the active
  target. assertDevDatabase() = dev-only (app/dev path, no opt-in).
  assertMigrationTarget({allowProd}) = the migration runner: dev always
  allowed, prod ONLY via an explicit --allow-prod flag + loud banner. Only
  additive/non-destructive migrations may ever use --allow-prod.
- Migrations: numbered SQL in scripts/, next number is 094. Dev and production
  are both at 093, with ONE deliberate gap: 087 has never been applied to prod
  (nobody is affected by its absence — see CLAUDE.md). 088–093 went to prod
  via `--only=… --allow-prod`, which is how you skip a held-back predecessor.
  New tables need an explicit REVOKE ALL first — Supabase default-grants ALL on
  every new public table to anon and authenticated (see 090).
  Verify with `pnpm migrate:status`, never with a number written down anywhere.
  Apply via the runner only: `pnpm migrate` (status:
  `pnpm migrate:status`). Never hand-run SQL in the Supabase editor. Each
  file wraps itself in BEGIN;…COMMIT; and is idempotent (match 047/063/065
  style).
- Permanent, non-destructive verification harnesses exist and all follow the
  same throwaway-user pattern — re-run the relevant one after touching RLS:
  `pnpm check:board-roles` (board_members/tasks), `check:teams` (super-admin-only
  team management, with an admin-tier control case), `check:marketing-calendars`
  (per-calendar access), `check:marketing-channels` (channel ordering + who may
  rename), `check:project-ids` (number uniqueness under concurrency + ledger
  permanence), `check:task-lifecycle`, `check:appointments`,
  `check:appointment-booking`, `check:marketing-attachments`,
  `check:marketing-recurrence`, `check:task-attachments` (admin-only large
  uploads), `check:chat-attachments` (DM attachments private + conversation-scoped).
- Before any destructive migration: take a fresh dev pg_dump snapshot
  (backups live in ~/Code/db-backups/; use
  /opt/homebrew/opt/libpq/bin/pg_dump if the Homebrew default errors on a
  server-version mismatch — and never let a pg_dump error reach a
  transcript/log as-is, it can embed the raw connection string with password).
- A dev DB password was transiently exposed in a tool-output error on
  2026-07-24 (the underlying bug is fixed so it can't recur). The owner
  explicitly said NOT to rotate it — "I will tell when I want to." Do not
  rotate it proactively.
- Do NOT edit scripts/guard-db.mjs to weaken it. If it blocks you, that's the
  signal to STOP, not to patch around it.
- There is a locked, immutable golden DB snapshot at
  ~/Code/GOLDEN-prod-original-DO-NOT-DELETE-20260723-152216.dump — never
  delete, move, or unlock it.

## Git / shipping
- ✅ **SHIPPED 2026-08-12 — private chat attachments (092) + max upload limits (093) + a CSP fix.**
  `chat-attachments` was created public with no size or MIME limit, so every DM attachment was
  readable off the CDN by anyone holding the URL, with no session — and the client stored exactly
  that public URL on `chat_messages.image_url`. 092 makes the bucket private (10 MB, MIME
  allowlist), adds `chat_messages.attachment_path`, and narrows the read policy from 002's "any
  authenticated user can read every chat file" to sender/recipient/admin. Safe to apply: **0 of 6
  prod messages (and 0 of 4 dev) reference an attachment**, so there is no live link to break and
  no backfill. One orphaned ~399 kB object per database is deliberately left in place.
  Verified by `pnpm check:chat-attachments` (16/16, including an unauthenticated fetch of the old
  public URL now returning 400). Rollback: `scripts/rollback/092_revert.sql`.
  **093** then raised every bucket to the plan maximum: `task-assets`, `chat-attachments` and
  `marketing-assets` are all now private / 50 MB / 23 MIME types. 50 MB is the Supabase **Free**
  hard per-file ceiling — not a setting, it needs a plan change to exceed. The inline base64 task
  path is deliberately still 10 MB (043); raising that puts 33%-inflated bytes into a 500 MB
  database budget, which is the exact failure the large-file toggle exists to avoid.
  Alongside it, `next.config.mjs`'s CSP `img-src` gained `blob:` and `https://*.supabase.co` —
  without them the marketing calendar's image preview was **already broken in production** and
  the new task thumbnails would have shipped broken. CSP is production-only, so `pnpm dev` can
  never catch this; verified against a real production build (thumbnail `naturalWidth=64`).
- ✅ **SHIPPED 2026-08-12 — large task attachments (migration 091).**
  An admin-only, per-upload opt-in that routes a task attachment to the new private
  `task-assets` Storage bucket (50 MB — the Supabase **Free** plan's hard per-file ceiling)
  instead of base64-ing it into `task_attachments.file_data`. The inline path is untouched at
  10 MB for everyone. `storage_path` and `file_data` are mutually exclusive (CHECK), the INSERT
  policy rejects a `storage_path` from anyone `private.is_admin_user()` is false for, and
  *reading* is deliberately not admin-gated. Verified: `pnpm check:task-attachments` (15/15
  against real RLS) + 14/14 real-browser Playwright + 218 unit tests + `pnpm build`.
  Applied to prod 2026-08-12 (post-conditions confirmed 12 existing attachments intact).
  Rollback: `scripts/rollback/091_revert.sql`. Note the Free-plan storage budget is 1 GB in
  total, ~20 files at full size; that is why this is opt-in, not default.
- Local `main` == origin/main (pushed + deployed as of 2026-08-12). Most recently shipped:
  the **Project ID Manager** (migration 090) — a new "Project IDs" module where anyone signed
  in grabs the next YYMM+4-digit number (e.g. 26081111, sequence restarts at 1111 each Central
  month) against a client name. The claimer is taken from the session, never picked from a
  dropdown. `public.claim_project_id()` allocates under an advisory lock so simultaneous
  clicks can't collide; `project_ids` has no INSERT/DELETE grant at all (the RPC is the only
  way in, and nothing can un-claim a number) and only `client_name`/`company_id` are
  column-grant-updatable. Before that: rearrangeable marketing calendar columns (088) and a
  "Personal" business unit (089).
- A push to `main` AUTO-DEPLOYS to prod within seconds. So: apply any schema
  migration to prod (`--allow-prod`) BEFORE merging code that depends on it —
  a missing 068 once shipped ahead of its migration and broke the live boards
  list for ~6h. Migrations first, then deploy. Prefer small sliced commits.
- Do NOT add "Co-Authored-By: Claude" trailers to commits (repo rule).
- Tests: `pnpm test` (currently 339 passing across 27 files — keep them green).
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
next — don't assume it's the next numbered prompt.
```
