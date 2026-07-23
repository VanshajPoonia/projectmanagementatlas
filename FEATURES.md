# FEATURES — Roadmap & Progress

> Living document. Tracks where the product is going, what's shipped, and what's next.
> Update the checkboxes and the **Changelog** as work lands. Detailed build prompts
> will be added by the owner over time.

## How we work (ground rules)
- **Everything ships to `main`** via small, properly-sliced PRs (one coherent change per PR).
- **No `Co-Authored-By: Claude`** lines in commits (repo convention).
- Migrations are hand-applied, numbered SQL in `scripts/` (currently through `062_`).
- All data access goes through the Supabase **session client** so **RLS** applies. Never bypass with service-role unless deliberately gated.
- Prefer extending the existing Next.js + Supabase stack over adopting a new engine (see "Architecture stance").

---

## Architecture stance (decided)
- **Do NOT build on / fork Plane (or OpenProject/etc.) as an engine.** Reasons: throws away a working Next.js + Supabase + RLS + AI app; runs two backends; AGPL network-copyleft is a real risk for a proprietary hosted SaaS.
- **DO mine the open-source repos as reference designs** — copy their *data models and UX*, re-implemented cleanly in our stack. See "Reference repos to mine."

## Master product context — reconciliation (2026-07-23)
A "Master Product Context" framework was supplied assuming a **Plane CE** foundation. **Audit verdict: this repo is not Plane** — it's a greenfield **Next.js 16 + React 19 + Supabase (RLS)** app, 62 numbered migrations, Supabase Auth, no Plane/Django/webhooks, no test harness, no LICENSE file. The master doc's *intent* is adopted; its Plane-specific mechanics do not apply. Owner decisions:

1. **Foundation → build on the existing Next.js + Supabase app.** Do not fork/adopt Plane. (ADR: greenfield-we-already-have is the A.4-optimal choice — reuses auth, RLS, AI, marketing wedge; single stack.)
2. **Enterprise items (budget, cost, capacity/workload, critical-path, SAFe-style governance) → north-star, design-for-later.** Stay off near-term phases, but the data model/hierarchy must not preclude them. Progressive disclosure per UX principle 1.
3. **Deployment → hosted SaaS (Vercel + Supabase) for now.** Self-hosting is a possible future, not a current architectural constraint.
4. **Process → calibrated/pragmatic.** Stand up a lightweight test harness incrementally; apply the master's 16-section response format *proportionally to each change's risk* (see below). No big-bang audit/e2e prerequisite.

**Canonical hierarchy (north-star IA)** — reach incrementally, do NOT big-bang. One **Work-Item domain with configurable types** (Task/Subtask/Story/Bug/Feature/Request/Deliverable/Risk/Decision/Approval/Change-Request), never duplicate task models per view:
> Organization → Workspace → Team → Portfolio → Initiative → Project → Epic/Module → **Work Item** → Subtask
> Planning objects: Cycle/Sprint · Milestone · Release · Goal · Key Result · Risk · Decision · Approval · Meeting · Client · Request · Automation · Saved View

Today's model (`companies → boards → tasks → subtasks` + Goals in P3) is a subset of this; each phase moves us toward it. **One Work-Item domain = Phase 1's custom-fields engine** — reinforces the existing ordering.

**Per-feature response format (calibrated).** For real implementation prompts, follow the master's ordering proportionally: (1) existing-system audit → (2) assumptions → (3) user flow → (4) data-model → (5) API → (6) permissions/RLS → (7) frontend → (8) background jobs → (9) audit events → (10) test plan → (11) files → (12) implementation → (13) commands → (14) test results → (15) risks → (16) manual verification checklist. Skip sections that genuinely don't apply, and say so.

---

## The wedge (how we stand out)
> **"The PM tool built around marketing/content execution, with an AI that actually knows your work."**

Two assets almost none of the incumbents (Asana/Jira/Linear/ClickUp/Notion/monday/Smartsheet/MS Planner) have:
1. A **first-class marketing content calendar** (native content-scheduling object, not a generic board).
2. A **data-native AI assistant** — already reads the user's real tasks/boards/calendar + web + files.

Lean into: content calendar + campaign goals + client portal + AI-generated weekly updates ("what shipped / what slipped / what's next" from real data).

---

## Current state — already built ✅
- [x] Kanban boards: columns, task cards, subtasks, task detail modal, inline edits
- [x] Private boards + RLS lockdown (admins/super-admins can't see *others'* private boards) — `scripts/061`
- [x] Shared team calendar (task due dates)
- [x] Marketing content calendar: editable/draggable cards, quarterly repeat, **posted / missed / pending** states with reason notes — `scripts/062`
- [x] Personal private tasks
- [x] Teammate direct chat (with unread badges)
- [x] Bookmarks, Reports
- [x] Multi-company tenancy (SRG/AGC as `companies` rows), Super-Admin page, role management
- [x] "What should I work on next?" starter — `components/dashboard/work-next.tsx`
- [x] **Data-aware AI assistant**: Workspace mode (reads tasks/boards/personal/marketing) + Ask-anything mode (Tavily web search + URL fetch) + file/image/PDF/audio/video + YouTube input

---

## Roadmap (sequenced)

Ordering rationale: **custom fields** is the highest-leverage technical enabler (it unlocks views, automations, and forms), so it goes first. The **wedge** items (marketing/AI/portal) are interleaved because they're the differentiation.

### Phase 1 — Custom fields engine  ⏳ NOT STARTED
The single highest-leverage change. Turn hardcoded board columns into configurable field primitives.
- [ ] Schema: `field_definitions` (per board/workspace) + `field_values` (per task); types: text, number, select, multi-select, person, date, status, checkbox, relation
- [ ] RLS on new tables (inherit board visibility via existing chokepoint functions)
- [ ] Task detail modal: render + edit custom fields
- [ ] Board view: show selected fields on cards / as columns
- [ ] Migration + backfill existing status/priority into the new model (or bridge)

### Phase 2 — Multiple views over one dataset  ⏳ NOT STARTED
Same tasks, more lenses. Mostly frontend once Phase 1 lands.
- [ ] Table/spreadsheet view (sort, filter, inline edit, grouped rows)
- [ ] Timeline / Gantt-lite view (start/due, dependencies optional)
- [ ] Saved views (per user: filters + sort + visible fields)
- [ ] View switcher UI on boards

### Phase 3 — Goals → Projects → Tasks hierarchy  ⏳ NOT STARTED
Gives execs a reason to log in; ties work to outcomes.
- [ ] `goals` (per company) + link boards/tasks to a goal
- [ ] Portfolio/roll-up view: progress across boards toward a goal
- [ ] Goal progress indicators (auto from linked task completion)

### Phase 4 — Marketing wedge deepening  ⏳ NOT STARTED
Where we out-differentiate everyone.
- [ ] Campaigns as first-class object (group content items under a campaign + goal)
- [ ] Content approval workflow (draft → review → approved → scheduled → posted/missed)
- [ ] Channel/company breakdown analytics on the marketing calendar
- [ ] Recurring content templates

### Phase 5 — Forms & intake  ⏳ NOT STARTED
Structured work-request capture.
- [ ] Form builder (fields map to a board's custom fields)
- [ ] Public/shareable form link → creates a task (or marketing item) with RLS-safe write
- [ ] Intake triage view

### Phase 6 — Automation rules  ⏳ NOT STARTED
Small rules engine on top of existing notifications.
- [ ] Trigger → condition → action model (e.g. "status→Done ⇒ notify assignee's manager")
- [ ] UI to build rules per board
- [ ] Execution + audit log

### Phase 7 — Client / stakeholder portal  ⏳ NOT STARTED
Scoped read-only external view (our RLS + private-board work makes this achievable).
- [ ] Share a board/goal read-only to an external email (tokened, RLS-enforced)
- [ ] Client-facing status page (health, recent updates, upcoming)

### Phase 8 — AI deepening (the standout)  ⏳ NOT STARTED
- [ ] **AI weekly update generator**: auto-draft "what shipped / what slipped / what's next" from real task+calendar data
- [ ] Project health & risk scoring (surfaced on dashboard)
- [ ] Natural-language project search / commands ("show overdue SRG marketing posts")
- [ ] Meeting-notes / message → task extraction

### Cross-cutting (ongoing) — Linear-grade speed & polish
- [ ] Command palette (`⌘K`): jump, create, assign, change status
- [ ] Keyboard shortcuts for common actions
- [ ] Fast task create (minimal friction)
- [ ] Information-density pass on board/table views

### Explicitly deferred (not now)
Time tracking, budgets/cost reporting, critical-path/baselines, SAFe, DocuSign/contract workflows — enterprise territory (OpenProject-shaped), pulls away from our wedge.

---

## Market scan — competitor notes (reference)
Captured from the owner's competitor scan. Use as a feature-pattern library; we cherry-pick, we don't chase parity.

### Per-product — the one idea worth copying
| Product | Strategy | Signature idea to borrow | Maps to |
|---|---|---|---|
| **Asana** | Connect tasks → goals | Task→Project→Portfolio→Goal chain, one dataset / many audiences | Phase 3 |
| **monday.com** | Configurable building blocks | Reusable field primitives (text/person/date/status/formula/relation) instead of hardcoded workflows | Phase 1 |
| **Jira** | Deep configurable work mgmt | Configurable workflows: per-project statuses, transitions, permissions, approvals | Phase 1 + 6 |
| **ClickUp** | One app replaces many | Convert messages/docs/meetings → tasks; link conversations to work | Phase 8 |
| **Notion** | Docs + DB + projects | Everything is a flexible page with structured props + unstructured content | Phase 1 (fields) / later docs |
| **Linear** | Fast, opinionated, low-friction | Optimize for speed: few clicks to create/assign/move; keyboard-first, high density | Cross-cutting |
| **Smartsheet** | Spreadsheet + PPM | Let users model work in tables/formulas without DB concepts | Phase 2 (table view) |
| **MS Planner/Project** | Deep MS 365 integration | Put work where users already live (calendar/chat/email) | Phase 5 (intake) / later |

### The 15 recurring patterns (whole-market signal)
Multiple views · custom fields/configurable workflows · personal "My Tasks" · portfolio view · goals↔projects↔tasks · forms that create work · docs linked to tasks · workload/capacity · automation rules · client portals · AI summaries/task-gen · strong search & NL commands · integrations/open API · fast keyboard interactions · health/risk indicators.

> Coverage vs. our roadmap: views→P2, custom fields→P1, My Tasks→✅(work-next), portfolio+goals→P3, forms→P5, automation→P6, client portal→P7, AI summaries/NL search/health→P8, keyboard/speed→cross-cutting. **Deliberately skipped for now:** workload/capacity planning, docs-linked-to-tasks, broad integrations/open API (revisit post-wedge).

### Standing guidance from the scan
- Don't chase parity — **pick 1–2 areas incumbents still feel cumbersome** and win there (our wedge: marketing execution + data-native AI).
- **AGPL/GPL caution**: Plane/Vikunja/Leantime are AGPL, OpenProject GPL-3.0 — reference only, re-implement cleanly; never vendor their code into a proprietary hosted product. (Reinforces the "don't fork" stance above.)
- The scan's "fork Plane + Next.js shell" recommendation was **considered and rejected** — two backends + AGPL exposure + discarding a working app. We mine, we don't fork.

---

## Reference repos to mine (study, don't fork)
Detailed investigation prompts will be added by the owner. When investigating, extract **data model + UX patterns**, not code (license: most are AGPL/GPL — reference only, re-implement cleanly).

| Repo | Best studied for |
|---|---|
| [AppFlowy](https://github.com/AppFlowy-IO/appflowy) | Notion-style flexible databases, field/property system, block/page model |
| [Plane](https://github.com/makeplane/plane) | Cycles, modules, custom views, issue schema, analytics, roadmaps (modern SaaS UX) |
| [OpenProject](https://github.com/opf/openproject) | Portfolio/Gantt/work-package schema, scheduling, permissions model |
| [Vikunja](https://github.com/go-vikunja/vikunja) | Lightweight task model, filters, saved views, CalDAV |
| [Leantime](https://github.com/Leantime/leantime) | Goals-focused planning, accessibility patterns for non-PMs |
| [Taiga](https://github.com/kaleidos-ventures/taiga) · [deploy](https://github.com/taigaio/taiga-docker) | Agile: epics/user-stories/statuses, project templates, custom workflow states |

### Investigation notes (fill in as we study each)
- AppFlowy — _pending detailed prompt_
- Plane — _pending detailed prompt_
- OpenProject — _pending detailed prompt_
- Vikunja — _pending detailed prompt_
- Leantime — _pending detailed prompt_
- Taiga — _pending detailed prompt_

---

## Changelog
- **2026-07-23** — Roadmap created. Confirmed all prior work is on `main` (AI harness PRs #10–#13, migrations 061/062 live). Reference repos captured for later investigation.
- **2026-07-23** — Added market-scan competitor notes (per-product ideas + 15 recurring patterns) mapped to roadmap phases. Committed tracker to `main`.
- **2026-07-23** — Reconciled the supplied "Master Product Context" against a real repo audit (not a Plane fork). Owner decisions recorded: build on existing Next.js+Supabase; enterprise items = north-star design-for-later; hosted-SaaS for now; calibrated process. Adopted canonical hierarchy as north-star IA + one Work-Item domain (= Phase 1).
- **2026-07-23** — Prompt 1 (audit-only) delivered: `docs/architecture/{current-system,adr-001-extension-strategy,upstream-boundary,domain-map,risk-register}.md` + `docs/development/local-setup.md`. ADR-001 scored 4 extension options (continue-on-current-app wins 46/50). Added `scripts/healthcheck.mjs` + `/api/health` (verifies DB/storage/API; reports cache/queue/search as N/A, reminder worker dormant). No product features implemented.
- **2026-07-23** — Calibrated test/CI gate before feature work (R-01/R-02): Vitest harness (`vitest.config.ts`, `pnpm test`) with first suites (`lib/rate-limit.test.ts`, `lib/color.test.ts`, 8 tests green) + `.github/workflows/ci.yml` running tests on every PR/push. Branch `chore/test-ci-gate`. Next: Prompt 2 (app shell / design system).
- **2026-07-23** — Prompt 2 slice 1 (app-shell foundation, additive — no live routes touched). Owner decision: shared shell in place, tabs→routes incrementally. Added `components/shell/*` (nav-model + route map, sidebar-state, AppShell/Sidebar/Topbar, command palette ⌘K, breadcrumbs, empty/permission states) + primitives (`ui/{tooltip,skeleton,breadcrumb,command}`) + docs (`docs/design/{information-architecture,design-system}.md`). 21 new unit tests (nav-model 14, sidebar-state 7); 29 total green. Merged to `main` via #14 (gate) + #16 (shell).
- **2026-07-23** — Prompt 2 slice 2a (first live adoption): deep-linkable tabs. User + admin dashboards now sync `activeTab` with `?tab=` so sections are shareable URLs and browser Back/Forward moves between them; sessionStorage fallback preserved (no behaviour lost). Added tested pure helper `components/shell/tab-url.ts` (`resolveActiveTab`, 7 tests; 36 total green). Build verified (`/dashboard` + `/admin` stay dynamic). Next: slice 2b — swap dashboard chrome for AppShell sidebar/topbar + mount ⌘K palette with surface-aware routing.
- **2026-07-23** — Prompt 2 slice 2b (full chrome adoption): both dashboards now render inside `AppShell`. Replaced each bespoke header + horizontal tab-strip + mobile bottom-nav with the shell's left sidebar (sections as nav, per-user collapse), sticky topbar (breadcrumbs + ⌘K palette + host actions), and routed mobile bar. Surface-aware nav (`/dashboard?tab=…` vs `/admin?tab=…`); super-admin appears as a sidebar item. Preserved: accent picker, account settings, sign-out, global search, bookmarks rail, chat unread badge, notifications, AI widget, all tab bodies. Shell components generalized to host-driven (`groups`/`topbarActions`). Typecheck + build clean (routes stay dynamic); 36 tests green. **Needs visual QA on the Vercel preview before merge** (three-column density, mobile topbar).
