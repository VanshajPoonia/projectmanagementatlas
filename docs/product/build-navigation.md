# Build Navigation — reconciling the three plans

There are **three numbering schemes** in this project, and they were colliding. This doc makes them
one coherent map.

| Scheme | Lives in | What it is |
|---|---|---|
| **Master spine** PROMPT 1–10 | [`master-prompt.md`](./master-prompt.md) | The **canonical index** — the owner's source spec, capability by capability. Governing charter (sections A–F) at [`master-product-context.md`](./master-product-context.md) |
| Platform-build phases 0–4 | `CLAUDE.md` (repo root) | Execution detail for **PROMPT 3** (+ a safety-net prerequisite that serves everything) |
| Roadmap phases 1–8 | `FEATURES.md` (repo root) | Execution detail mostly for **PROMPT 4 and PROMPT 6** |

**Rule:** the Master spine is the index; the other two are *how*. When they disagree on *what*, the
Master spine wins.

## ⚠️ Standing ruling that overrides part of the master spine

**This product is built for exactly one organization, permanently — it is not a multi-tenant SaaS
product** (owner ruling, 2026-07-24). PROMPT 3's literal title ("Organizations, Workspaces, Teams,
Roles, and Feature Modules") and its "Organizations" (plural) / tenant-isolation content describe
multi-tenant scaffolding that does **not** apply here. What still applies, reinterpreted for one org:
Teams, Guests, Clients, workspace/project-level roles, custom roles, the permission matrix, and
module activation — all scoped **within** the single existing org. Full detail:
`master-product-context.md`'s banner and `CLAUDE.md`'s "What this branch is for."

## Status of each prompt

| Prompt | Status | Where the work is | Detailed plan / evidence |
|---|---|---|---|
| **1. Repo audit + ADR** | ✅ **DONE** | `main` | `docs/architecture/*` (6 docs). ADR-001 → **Option 4: build on existing app, no Plane** |
| **2. Design system + IA** | 🔄 **IN PROGRESS** | `main` | `docs/design/*`; AppShell slices 1 / 2a / 2b committed |
| **3. Teams / roles / access control / modules** (single-org reinterpretation — see ruling above) | ✅ **slice 1 done (`064`–`067`, schema + UI, browser-verified)** | `main` | `CLAUDE.md` Phase 1-A (teams + `board_members.role`, server-enforced via `pnpm check:board-roles` + wired into `board-view.tsx`/`task-card.tsx`/`task-detail-modal.tsx`'s existing `canEdit` checks) & 1-C (`app_modules` + `lib/modules.ts`, wired into both dashboards' nav) done. Not wired: `AiChatWidget`/`BookmarksSection` still render unconditionally. Next PROMPT 3 slices: custom roles, full permission matrix, invitations, audit events |
| **4. Canonical work-item domain** | ⏳ planned | tbd | `FEATURES.md` Phase 1 (custom fields) + Phase 3 (hierarchy) |
| **5. Quick entry / bulk / NL parsing** | ⏳ planned | tbd | new; some overlap with `FEATURES.md` cross-cutting |
| **6. View engine (list→gantt)** | ⏳ planned | tbd | `FEATURES.md` Phase 2 (multiple views over one dataset) |
| **7. My Work / Inbox / Notifications / Palette** | ⏳ planned | tbd | `CLAUDE.md` Phase 3 (inbox, work-next); work-next partially ✅ |
| **8. Agile (backlog / sprints / metrics)** | ⏳ planned | tbd | `CLAUDE.md` Phase 4 territory |
| **9. Timeline / Gantt / dependencies / critical path** | ⏳ planned | tbd | `CLAUDE.md` Phase 3 (deps) + new critical-path algo (must be newly tested) |
| **10. Project health / risks / changes / approvals** | ⏳ planned | tbd | `CLAUDE.md` Phase 3 (health, manual-first) + new governance |

## Canonical build order

1. **Finish PROMPT 2** (design system / IA) on `main`.
2. **PROMPT 3 — real access control first**, on `main` (`CLAUDE.md` Phase 1-A: Teams +
   `board_members.role` extension for Guests/Clients + a real permission matrix). No tenant
   boundary — there is one org. Everything after this is born with correct team/project-level scoping.
3. **PROMPT 4 — canonical work-item domain.** This underpins PROMPTS 5, 6, 7, 8, 9, 10 — **do not
   build any view / agile / gantt / governance surface before the model it renders exists.**
4. Then PROMPT 5 → 6 → 7 (capture, views, personal cockpit).
5. Then PROMPT 8 → 9 → 10 (agile, planning, governance) as activatable modules.

## Coordination flags (things that will bite if ignored)

1. **Single org, not multi-tenant SaaS.** See the standing ruling above. If any future prompt
   response reintroduces "organizations" (plural), tenant isolation, or workspace-switching-between-
   companies, that's drift — stop and re-read the ruling before implementing.
2. **One folder, one branch.** The former `platform` worktree (branch `platform`) was
   fast-forward-merged into `main` and removed 2026-07-24 — do not recreate it or reference it as a
   separate place work happens. All of PROMPT 2 and PROMPT 3 now live on `main`.
3. **Module activation appears in THREE places** — PROMPT 2 (nav-level "module activation system"),
   PROMPT 3 (tenancy-level "feature-module activation," reinterpreted per the ruling above), and
   `CLAUDE.md` Phase 1-C. **They are ONE system:** a server-authoritative `app_modules` table (a
   **singleton** config, not per-org — built in PROMPT 3) that the navigation (PROMPT 2) *reads*. Do
   not build two competing activation mechanisms.
4. **PROMPT 3 is a multi-slice epic, not one migration.** `CLAUDE.md` Phase 1-A is only *slice 1*:
   Teams + extending the existing `board_members` table with a `role` column (Guest/Client scoping).
   Custom roles, the 16-action permission matrix, invitations (resend/revoke/expire/bulk-import), and
   per-change audit events are **later slices of PROMPT 3** — still single-org throughout.
5. **PROMPT 1's Plane framing is already resolved.** ADR-001 chose Option 4 (no Plane). Ignore the
   fork / sidecar / upstream-boundary / licensing-exposure language whenever it recurs downstream.
6. **Governance/agile/timeline modules (8–10) are "design-for-later in the data model" now.** The
   ADR's obligation: don't repaint into a corner. Custom-fields engine (PROMPT 4) comes first so
   later modules attach to a configurable model rather than hardcoded columns.

## Working posture (per the owner's standing rule)

For each prompt: **analyze → scope-check against this map + `FEATURES.md` → clash-check → only then
implement.** Flag conflicts before writing code. PROMPTS 1–3's own "definition of done" also forbids
starting feature code before the audit/plan for that prompt is accepted.
