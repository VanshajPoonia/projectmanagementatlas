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
  admin-dashboard.tsx nav now reads useAppModules(). NOT wired: AiChatWidget /
  BookmarksSection still render unconditionally (ai_assistant/bookmarks exist
  as app_modules rows but aren't consumed at those render sites — pick up
  only if actually needed).
- NEXT actual work is NOT decided yet — options on the table: later PROMPT 3
  slices (custom roles, full permission matrix, invitations, audit events),
  finishing PROMPT 2, or moving to PROMPT 4 (canonical work-item domain).
  ASK THE OWNER which — don't assume.

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
- Migrations: numbered SQL in scripts/, next number is 072. Dev AND production
  are BOTH fully synced at 071 (001–071 all applied to prod on 2026-07-24 —
  owner-approved batch, applied migrations-FIRST then deployed the UI).
  Apply via the runner only: `pnpm migrate` (status:
  `pnpm migrate:status`). Never hand-run SQL in the Supabase editor. Each
  file wraps itself in BEGIN;…COMMIT; and is idempotent (match 047/063/065
  style).
- A permanent, non-destructive verification harness also exists:
  `pnpm check:board-roles` (mirrors check-isolation.mjs's throwaway-user
  pattern) — re-run it after touching board_members/tasks RLS.
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
- Local `main` == origin/main (pushed + deployed as of 2026-07-24 EOD).
- A push to `main` AUTO-DEPLOYS to prod within seconds. So: apply any schema
  migration to prod (`--allow-prod`) BEFORE merging code that depends on it —
  a missing 068 once shipped ahead of its migration and broke the live boards
  list for ~6h. Migrations first, then deploy. Prefer small sliced commits.
- Do NOT add "Co-Authored-By: Claude" trailers to commits (repo rule).
- Tests: `pnpm test` (currently 59 passing — keep them green).

## Working posture (my standing rule)
For every prompt/feature: analyze → scope-check against build-navigation.md +
FEATURES.md → clash-check → propose a plan → get my OK → THEN implement in
small slices. Do not start feature code before I accept the plan. Flag any
conflict with existing work before touching code.

Start by reading the files above, confirm the current state matches this
(git status, pnpm test, pnpm migrate:status), then ask me what to work on
next — don't assume it's the next numbered prompt.
```
