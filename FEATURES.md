# FEATURES - Roadmap & Progress

> Living document. Tracks where the product is going, what's shipped, and what's next.
> Update the checkboxes and the **Changelog** as work lands. Detailed build prompts
> will be added by the owner over time.

## How we work (ground rules)
- **Everything ships to `main`** via small, properly-sliced PRs (one coherent change per PR).
- **No `Co-Authored-By: Claude`** lines in commits (repo convention).
- Migrations are hand-applied, numbered SQL in `scripts/` (currently through `107_`); run `pnpm migrate:status` rather than trusting this line.
- All data access goes through the Supabase **session client** so **RLS** applies. Never bypass with service-role unless deliberately gated.
- Prefer extending the existing Next.js + Supabase stack over adopting a new engine (see "Architecture stance").

---

## Architecture stance (decided)
- **Do NOT build on / fork Plane (or OpenProject/etc.) as an engine.** Reasons: throws away a working Next.js + Supabase + RLS + AI app; runs two backends; AGPL network-copyleft is a real risk for a proprietary hosted SaaS.
- **DO mine the open-source repos as reference designs** - copy their *data models and UX*, re-implemented cleanly in our stack. See "Reference repos to mine."

## Master product context - reconciliation (2026-07-23)
A "Master Product Context" framework was supplied assuming a **Plane CE** foundation. **Audit verdict: this repo is not Plane** - it's a greenfield **Next.js 16 + React 19 + Supabase (RLS)** app, 62 numbered migrations, Supabase Auth, no Plane/Django/webhooks, no test harness, no LICENSE file. The master doc's *intent* is adopted; its Plane-specific mechanics do not apply. Owner decisions:

1. **Foundation → build on the existing Next.js + Supabase app.** Do not fork/adopt Plane. (ADR: greenfield-we-already-have is the A.4-optimal choice - reuses auth, RLS, AI, marketing wedge; single stack.)
2. **Enterprise items (budget, cost, capacity/workload, critical-path, SAFe-style governance) → north-star, design-for-later.** Stay off near-term phases, but the data model/hierarchy must not preclude them. Progressive disclosure per UX principle 1.
3. **Deployment → cloud-hosted (Vercel + Supabase), for this one organization.** Self-hosting is a possible future, not a current architectural constraint.
4. **Process → calibrated/pragmatic.** Stand up a lightweight test harness incrementally; apply the master's 16-section response format *proportionally to each change's risk* (see below). No big-bang audit/e2e prerequisite.
5. **Single organization, permanently - NOT a multi-tenant SaaS product (owner ruling, 2026-07-24).** This is not being built for other companies to sign up to. PROMPT 3's "Organizations" (plural) / tenant-isolation content is N/A; Teams, Guests, Clients, project-level roles, the permission matrix, and module activation still apply, scoped within this one org. See `CLAUDE.md` and `docs/product/master-product-context.md`'s reconciliation banner.

**Canonical hierarchy (north-star IA)** - reach incrementally, do NOT big-bang. One **Work-Item domain with configurable types** (Task/Subtask/Story/Bug/Feature/Request/Deliverable/Risk/Decision/Approval/Change-Request), never duplicate task models per view. **"Organization" below is a singleton - ruling 5 above** - everything from Workspace down is what's actually being built:
> Organization *(one, fixed)* → Workspace → Team → Portfolio → Initiative → Project → Epic/Module → **Work Item** → Subtask
> Planning objects: Cycle/Sprint · Milestone · Release · Goal · Key Result · Risk · Decision · Approval · Meeting · Client · Request · Automation · Saved View

Today's model (`companies → boards → tasks → subtasks` + Goals in P3) is a subset of this; each phase moves us toward it. **One Work-Item domain = Phase 1's custom-fields engine** - reinforces the existing ordering.

**Per-feature response format (calibrated).** For real implementation prompts, follow the master's ordering proportionally: (1) existing-system audit → (2) assumptions → (3) user flow → (4) data-model → (5) API → (6) permissions/RLS → (7) frontend → (8) background jobs → (9) audit events → (10) test plan → (11) files → (12) implementation → (13) commands → (14) test results → (15) risks → (16) manual verification checklist. Skip sections that genuinely don't apply, and say so.

---

## The wedge (how we stand out)
> **"The PM tool built around marketing/content execution, with an AI that actually knows your work."**

Two assets almost none of the incumbents (Asana/Jira/Linear/ClickUp/Notion/monday/Smartsheet/MS Planner) have:
1. A **first-class marketing content calendar** (native content-scheduling object, not a generic board).
2. A **data-native AI assistant** - already reads the user's real tasks/boards/calendar + web + files.

Lean into: content calendar + campaign goals + client portal + AI-generated weekly updates ("what shipped / what slipped / what's next" from real data).

---

## Current state - already built ✅
- [x] Kanban boards: columns, task cards, subtasks, task detail modal, inline edits
- [x] Private boards + RLS lockdown (admins/super-admins can't see *others'* private boards) - `scripts/061`
- [x] Shared team calendar (task due dates)
- [x] Marketing content calendar: editable/draggable cards, quarterly repeat, **posted / missed / pending** states with reason notes - `scripts/062`
- [x] Personal private tasks
- [x] Teammate direct chat (with unread badges)
- [x] Bookmarks, Reports
- [x] Business-unit management (SRG/AGC as `companies` rows - a marketing-calendar dimension, NOT tenancy), Super-Admin page, role management
- [x] "What should I work on next?" starter - `components/dashboard/work-next.tsx`
- [x] **Data-aware AI assistant**: Workspace mode (reads tasks/boards/personal/marketing) + Ask-anything mode (Tavily web search + URL fetch) + file/image/PDF/audio/video + YouTube input

---

## Roadmap (sequenced)

Ordering rationale: **custom fields** is the highest-leverage technical enabler (it unlocks views, automations, and forms), so it goes first. The **wedge** items (marketing/AI/portal) are interleaved because they're the differentiation.

### Phase 1 - Custom fields engine  ✅ SHIPPED to dev (migrations 112-115, 2026-08-22)
The single highest-leverage change. Turn hardcoded board columns into configurable field primitives.
Delivered as Prompt C of the ATLAS pack - see CLAUDE.md's "Prompt C" section for the full design
notes and the prod-ordering hazard.
- [x] Schema: `field_definitions` (global or per board) + `field_values` (per task); all 12 types - text, long text, number, date, datetime, checkbox, select, multi-select, person, url, email, relation
- [x] RLS on new tables (values mirror `task_links`' `can_view_task`/`can_manage_task` shape, so guests are read-only for free)
- [x] Task detail modal: render + edit custom fields (`components/board/task-custom-fields.tsx`)
- [x] Admin UI to define fields (`components/admin/field-management.tsx`, Super Admin → Fields)
- [x] Value validation **in the database**, mirrored client-side and gated by a shared parity case list
- [x] **Work item types** (`work_item_types` + `tasks.type_key`): one domain, eleven kinds, two active
- [x] **Normalized status categories** (`task_statuses.category`), retiring the substring heuristic
- [x] **Relations** (`task_relations`): blocks/blocked by, precedes/follows, duplicates/duplicated by, relates to - kept separate from parent/child
- [x] Board view: show selected fields on cards / as columns *(Prompt E - the Fields control in
      `/views` orders and toggles them, and every layout reads the same list)*
- [x] Filter/sort a view by a custom field *(Prompt E - custom fields appear in the filter
      builder as `custom:<key>`, typed from their `field_type`)*
- ~~Migration + backfill existing status/priority into the new model~~ *(deliberately NOT done: status and priority stay first-class columns. Re-homing them into the field engine would rewrite every query in the app to buy nothing - the plan's "do not rewrite a working feature to make it resemble a competitor".)*

### Phase 2 - Multiple views over one dataset  ✅ SHIPPED (Prompt E, 2026-08-25)
Same tasks, more lenses. One config model (`lib/view-config.ts`) that four layouts render
from, at `/views`. Migrations `118` (board hierarchy) and `119` (saved views).
- [x] Table/spreadsheet view (sort, filter, inline edit, grouped rows, resize + reorder
      columns, sticky title, bulk select)
- [x] Saved views (personal or shared: layout + scope + descendant behaviour + filters + sort
      + grouping + visible fields)
- [x] View switcher UI - `components/views/saved-view-bar.tsx`, with an unsaved-changes dot
      and a Discard that returns to what is stored
- [x] List, Kanban (grouped by any field, not just board columns) and Calendar
      (month/week/day + an unscheduled tray + drag to reschedule) over the same config
- [x] **Dynamic descendant scope** - `boards.parent_board_id` plus none/direct/all, so a new
      child board is in its ancestors' roll-ups with no view to update (ATLAS_01 4.6)
- [ ] Timeline / Gantt-lite view (start/due, dependencies optional) - deliberately not built;
      "Explicitly not building" lists Gantt, and `task_relations` (115) has no UI yet

### Phase 3 - Goals → Projects → Tasks hierarchy  ⏳ NOT STARTED
Gives execs a reason to log in; ties work to outcomes.
- [ ] `goals` (per company) + link boards/tasks to a goal
- [ ] Portfolio/roll-up view: progress across boards toward a goal
- [ ] Goal progress indicators (auto from linked task completion)

### Phase 4 - Marketing wedge deepening  ⏳ NOT STARTED
Where we out-differentiate everyone.
- [ ] Campaigns as first-class object (group content items under a campaign + goal)
- [ ] Content approval workflow (draft → review → approved → scheduled → posted/missed)
- [ ] Channel/company breakdown analytics on the marketing calendar
- [ ] Recurring content templates

### Phase 5 - Forms & intake  ⏳ NOT STARTED
Structured work-request capture.
- [ ] Form builder (fields map to a board's custom fields)
- [ ] Public/shareable form link → creates a task (or marketing item) with RLS-safe write
- [ ] Intake triage view

### Phase 6 - Automation rules  ⏳ NOT STARTED
Small rules engine on top of existing notifications.
- [ ] Trigger → condition → action model (e.g. "status→Done ⇒ notify assignee's manager")
- [ ] UI to build rules per board
- [ ] Execution + audit log

### Phase 7 - Client / stakeholder portal  ⏳ NOT STARTED
Scoped read-only external view (our RLS + private-board work makes this achievable).
- [ ] Share a board/goal read-only to an external email (tokened, RLS-enforced)
- [ ] Client-facing status page (health, recent updates, upcoming)

### Phase 8 - AI deepening (the standout)  ⏳ NOT STARTED
- [ ] **AI weekly update generator**: auto-draft "what shipped / what slipped / what's next" from real task+calendar data
- [ ] Project health & risk scoring (surfaced on dashboard)
- [ ] Natural-language project search / commands ("show overdue SRG marketing posts")
- [ ] Meeting-notes / message → task extraction

### Cross-cutting (ongoing) - Linear-grade speed & polish
- [x] Command palette (`⌘K`): Recent / Go to / Search results / Create - permission-registered
      (`components/shell/commands.ts`), plus a **Favourites** group ahead of Recent.
      **Not yet:** work-item context actions (change state, priority, assign, labels, copy
      link) - those need a selected-item context the board doesn't yet publish to the shell,
      and `board-view.tsx` renders outside `AppShell`.
- [x] Undo-capable toasts on the two silent hard deletes (personal tasks, bookmarks) -
      `components/shell/undo-toast.ts`, act-then-reverse, restoring the original row id
- [x] Unsaved-change protection on the create-task dialog (`beforeunload` + a guarded close)
- [~] Keyboard shortcuts for common actions - `⌘K`, `?`, `Esc`, `⌘Enter` and `C` (quick add on a
      board). Every one is listed in the help panel's Shortcuts tab; an undocumented shortcut is
      one nobody finds, so the panel and the handlers are added together or not at all.
- [x] Fast task create (minimal friction) - Quick Add / parsed capture (Prompt D) - one-line
      deterministic capture, chips showing every interpreted field with its ABSOLUTE value, and
      paste-a-list multi-create. Reachable from the board toolbar, `⌘K`, and `C`.
- [x] Information-density pass on board/table views - per-user Compact/Comfortable/Expanded
      (`components/shell/density.ts`), applied to board task cards. **Not yet:** list/table
      views and the dashboard task lists.

### Atlas research pack (`plan/ATLAS_01…`) - Foundation status
Build priority from ATLAS_01 §13. Numbering is the doc's, not FEATURES' Phase numbering.
- [x] **1. Design system / IA gaps** (Prompt A) - **CLOSED 2026-08-13, re-audited and
      genuinely closed 2026-08-19.** The 2026-08-13 pass left four of Prompt A's own
      requirements unmet and marked them done: the palette's Create commands were hardcoded
      to `/dashboard` (which redirects every admin to `/admin` and drops the tab), `/admin`
      and `/crm` passed no palette commands at all, the `context` group was declared and
      never built, and three of the four required UX states existed only as unused
      primitives. All fixed - see `docs/reviews/atlas-prompts-a-b-audit.md`. Palette, recents,
      density, UX states and My Work landed earlier; this slice added **favourites**
      (migration `097`, sidebar block + ⌘K group + star on board cards and the board header),
      **undo-capable toasts**, **unsaved-change protection**, **automated a11y (axe)**, and the
      **200%/320% zoom passes**. Four real defects were found by that automation and fixed -
      see the changelog entry. **Deliberately deferred: pinned views**, which needs saved
      views (Prompt E) to exist first; `user_favorites.entity_type` already accepts `'view'`
      so that lands as a client change, not a migration.
- [x] **2. Single-org access control** (Prompt B) - `lib/capabilities.ts` is the canonical
      vocabulary; board/task checks all route through it; unavailable actions now explain
      themselves. **Teams UI shipped** (migration `094`, Super Admin > Teams - two seeded
      business units, people × teams grid, super-admin-only management, `pnpm check:teams`
      27/27). **Module gating completed** - `ai_assistant`/`bookmarks` are consumed at their
      render sites, and since 2026-08-19 `ai_assistant` is enforced on the server too.
      **Audit events shipped** (`098`/`100`/`101` + the Access log screen).
      **Re-audited 2026-08-19:** the vocabulary was two-thirds unconsumed and disagreed with
      RLS in one measured place (`comment.create` denied a guest the database allows) - all
      corrected. **B3a closed** by migration `109` (dev **and** prod): the `share_links`
      INSERT policy now refuses a guest/client on the board, so the boundary is the database
      rather than a hidden Share button. Forward-only by design - a link minted before someone
      is demoted keeps working. See `docs/reviews/atlas-prompts-a-b-audit.md`.
- [x] **3. Canonical work-item + custom-field engine** (Prompt C) - = FEATURES Phase 1.
      **SHIPPED to dev AND prod** (migrations `112`-`115`; prod 2026-08-23, one file at a time).
      Gates: `pnpm check:work-items` (94), `pnpm check:work-items-ui` (31). The two unchecked
      Phase 1 boxes above (fields on cards, filter/sort by a field) are Prompt E view work, not
      gaps in this one.
- [x] **4. Shared filter/query/view model** (Prompt E) - = FEATURES Phase 2. **SHIPPED to dev**
      (migrations `118`/`119`, 2026-08-25). `lib/view-config.ts` is the single answer: one
      normalized config (layout, board scope, descendant behaviour, filters, join, sort, group,
      ordered visible fields, density, hierarchy, completed-item handling) and one evaluation
      pipeline that every layout renders from. **The audit came first and found three
      implementations of the same idea** - `reports-view.tsx` had nine `useState`s filtered in a
      `useEffect` into a second state, `board-view.tsx` had an inline `filterTasks()`, and
      `calendar-view.tsx` had no filters at all. They disagreed: reports offered Unassigned and
      the board did not, the board offered overdue and reports did not. Both now route through
      the shared engine, which also **fixed a real timezone bug in each** - the old code parsed a
      `YYYY-MM-DD` DATE column into an instant, so a task due today read as overdue for a
      five-hour window every evening. **Descendant scope needed schema**: `boards` had no parent
      column at all, so `118` adds `parent_board_id` (cycle-guarded, `ON DELETE SET NULL`) plus
      `board_descendants()`, and membership of "everything beneath this" is computed at read
      time - never a stored list, which is precisely the Vikunja failure ATLAS_01 4.6 describes.
      Gates: `pnpm check:views` (65, real RLS) and `pnpm check:views-ui` (38, real browser).
- [x] **5. Quick capture, bulk editing, recurrence, reminders** (Prompt D) - **SHIPPED to dev
      AND prod 2026-08-24** (migrations `116`/`117`, both purely additive and `--allow-prod`
      eligible; applied one at a time with verification between). Quick capture parses one line deterministically (no LLM) and shows
      every field it interpreted as a removable chip carrying the ABSOLUTE value, so a wrong
      guess is visible before saving; paste-a-list previews before it writes and reports
      indentation rather than acting on it. Bulk operations plan before they run - the
      confirmation says "18 of 30 will change", not "30 selected" - and a run with any refusal
      is never reported as a success. **Recurrence became real**: `025`/`086`'s five columns had
      a prominent toggle wired to nothing for months (14 such tasks on production, 4 of them
      with no pattern at all), and are replaced by a rule + an occurrence ledger whose
      `UNIQUE (rule_id, occurrence_date)` makes generation idempotent by construction.
      Reminders are per-user and private, with no admin bypass. `lib/reminder-service.ts` -
      unscheduled with zero call sites since it was written - is deleted in favour of a real
      daily Vercel cron plus in-app delivery. **Completion pass 2026-08-24** closed the four
      remaining gaps: editing a schedule now states what happened to the tasks it already
      created (the requirement is "not silently", and "cannot" was only half of it); the bulk
      report offers **Retry N failed** and shows attempt counts, consuming a `retryableIds`
      field that had existed unused since the engine was written; `C` opens quick capture; and
      `HelpDialog` is mounted on the board, which had never had it because a board renders
      outside AppShell - so the only place shortcuts are documented was unreachable from the
      screen the new one works on. Gates: `pnpm check:recurrence` (84),
      `pnpm check:recurrence-ui` (75, stable across four consecutive runs after every
      `waitForTimeout`-then-read assertion was replaced with polling - three different checks
      had been failing on three consecutive runs of identical code). `CRON_SECRET` is set in Vercel (Production +
      Development) and the sweep is verified end to end.
- [~] **6. My Work + Inbox** (Prompt F) - `/my-work` shipped. Inbox not started, but **it needs
      no new table**: `task_notifications` already exists (migration `035`) with 169 rows on
      production, four writers, and RLS (`recipient_id = auth.uid()` on SELECT *and* UPDATE)
      that already fits an inbox. The blocker was that the toast consumed every row on page
      load; that is now fixed, so unread state finally accumulates. Remaining work is a screen,
      plus a decision on the ~121 rows already unread (show the backlog, or backfill as read).
- [ ] **7. Saved views** · **8. Hierarchy/subtask context**

**Blocked on schema, deliberately not faked:** "what am I blocking?" needs task dependencies;
"what needs my approval?" needs an approvals module. `/my-work` names both gaps on screen
rather than approximating them (`UNANSWERED_QUESTIONS` in `lib/my-work.ts`).

### Explicitly deferred (not now)
Time tracking, budgets/cost reporting, critical-path/baselines, SAFe, DocuSign/contract workflows - enterprise territory (OpenProject-shaped), pulls away from our wedge.

---

## Market scan - competitor notes (reference)
Captured from the owner's competitor scan. Use as a feature-pattern library; we cherry-pick, we don't chase parity.

### Per-product - the one idea worth copying
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
- Don't chase parity - **pick 1–2 areas incumbents still feel cumbersome** and win there (our wedge: marketing execution + data-native AI).
- **AGPL/GPL caution**: Plane/Vikunja/Leantime are AGPL, OpenProject GPL-3.0 - reference only, re-implement cleanly; never vendor their code into a proprietary hosted product. (Reinforces the "don't fork" stance above.)
- The scan's "fork Plane + Next.js shell" recommendation was **considered and rejected** - two backends + AGPL exposure + discarding a working app. We mine, we don't fork.

---

## Reference repos to mine (study, don't fork)
Detailed investigation prompts will be added by the owner. When investigating, extract **data model + UX patterns**, not code (license: most are AGPL/GPL - reference only, re-implement cleanly).

| Repo | Best studied for |
|---|---|
| [AppFlowy](https://github.com/AppFlowy-IO/appflowy) | Notion-style flexible databases, field/property system, block/page model |
| [Plane](https://github.com/makeplane/plane) | Cycles, modules, custom views, issue schema, analytics, roadmaps (modern SaaS UX) |
| [OpenProject](https://github.com/opf/openproject) | Portfolio/Gantt/work-package schema, scheduling, permissions model |
| [Vikunja](https://github.com/go-vikunja/vikunja) | Lightweight task model, filters, saved views, CalDAV |
| [Leantime](https://github.com/Leantime/leantime) | Goals-focused planning, accessibility patterns for non-PMs |
| [Taiga](https://github.com/kaleidos-ventures/taiga) · [deploy](https://github.com/taigaio/taiga-docker) | Agile: epics/user-stories/statuses, project templates, custom workflow states |

### Investigation notes (fill in as we study each)
- AppFlowy - _pending detailed prompt_
- Plane - _pending detailed prompt_
- OpenProject - _pending detailed prompt_
- Vikunja - _pending detailed prompt_
- Leantime - _pending detailed prompt_
- Taiga - _pending detailed prompt_

---

## Changelog
- **2026-08-19 (b)** - **A status you can pick is a status the board can take.** Reported from the field: choosing a status, filling in the whole create-task form, and only then being told *"No column on this board is linked to 'To Do'. Ask an admin to link one"* - shown to whoever hit it, which was usually the admin reading it. The pickers listed every status the org had defined regardless of the board in front of you, and the check that refuses an impossible one ran on **submit**. Now `statusesAvailableOnBoard` / `statusesForPicker` (`lib/task-status.ts`, 13 tests) scope all three pickers - create-task, the card's inline dropdown, and the detail modal - to statuses that actually resolve to a column, so a dead option is never offered. Two deliberate asymmetries: the picker helper **fails open** when columns aren't loaded (an empty dropdown reads as a broken control, and the submit guard is still there), while the missing-status helper **fails closed** (don't prompt someone to fix a board you haven't finished reading); and a record always keeps its own status listed even when no column represents it any more, or a task whose column was deleted would render a blank select. The other half is admin-side: a board missing a column for an active status now says so in a banner with a one-click **Add {status}** that creates the column named after the status - the gap is shown to the person who can close it instead of surfacing as a refusal to whoever trips over it. Guarded the one new dead end this created: a board whose only column is Cancelled has nothing a new task can start in, and now explains itself rather than showing an empty dropdown. Browser-verified end to end on a board shaped like production's EmpowerMe - Cancelled absent from the picker, banner shown, one click, column created, status then set successfully - 12/12, zero console errors.
- **2026-08-19** - **Marketing channels are editable; board columns rearrange and are named by their status.** Three asks, three findings.
  **(1) Marketing channel rename + on/off (migration `105`).** `marketing_channels.label` and `is_archived` had existed since `054` and **no screen could write either** - a channel typed wrong was permanent and a dead channel kept its column forever. `055` had narrowed those writes to `profiles.role = 'admin'` **literally**, which excludes `super_admin`, i.e. Bobby and Kayla, the only two people who run this calendar; the "admin-only" path it preserved had never been reachable by either of them (the `088` trap, again). Two RPCs fix it. Renaming is one transaction because `marketing_calendar_items.channel` is TEXT with no FK - renaming the channel alone orphans every event pointing at the old string, silently - so the RPC re-points them and reports how many moved. Off/on is `is_archived`, never `DELETE`, for the same reason; switching a channel off reports the posts it *kept*. Reachable from a new **Edit channels** dialog on the marketing board (rename, reorder, off/on, add) - not admin-gated, because `private.can_manage_marketing_channels()` is deliberately the same set as `canUseMarketingCalendar`: whoever can see the tab can maintain its columns.
  **(2) Column names match their status (migrations `106`, `107`) - Bobby, urgent.** Renaming a status swept board columns with `update({title}).eq('title', oldLabel)`. That was wrong twice. It matched on the column's *current title*, so a board whose "To Do" column had been renamed "Tasks" silently stopped tracking the status and every board then disagreed about the name of the same thing. And - the part nobody could have noticed - **it skipped every private board**: RLS applies SELECT policies to an `UPDATE` that has to read rows to find them, and `099` had just hidden private boards' columns from non-members, so an admin's sweep matched zero rows there and returned no error. That directly contradicts `099`'s own stated rationale for keeping the write policy wide. Measured with a throwaway admin against two boards differing only in `is_private`. Now a `SECURITY DEFINER` RPC keyed on `columns.status_key` (`063`'s FK) renames every linked column everywhere, private boards included, and returns a count so the UI cannot claim a success that did not happen. Linking a column to a status renames it to match; "Add column" names it from the status; new boards seed **one column per active status** in status order instead of asking for four keys by name (a status the company added appeared in every dropdown and on no new board). Columns with no `status_key` are custom and never touched.
  **(3) Board columns rearrange (migration `106`).** `columns.position` decided every board's left-to-right order and nothing ever wrote it after the initial seed, so a column added later was pinned to the far right forever - the ability the marketing calendar got in `088` and the product's main screen never did. Drag a column header, or use Move Left / Move Right in its menu (drag-and-drop is neither keyboard- nor touch-reachable). `reorder_board_columns` is `SECURITY INVOKER` like `102`'s RPC - the admin-only `columns` policy stays the authority - and renumbers in one statement, so a non-admin gets a refusal rather than the silent zero-row no-op RLS would otherwise give. Applies to every board, existing and future, because it lives in `board-view.tsx`. `moveListItem` moved to `lib/reorder.ts` and is now shared with the marketing calendar rather than duplicated.
  Gates: `pnpm check:board-columns` (30, new - including a control case that still runs the *old* direct sweep to prove the private-board miss was real), `pnpm check:marketing-channels` (39, was 16), 576 unit tests, and a real-browser pass covering column drag, the column menu, the status rename cascade landing on a board header, and the channel dialog's rename/off/on with the grid column disappearing and coming back.
- **2026-08-14** - **Theme correctness + the CRM module (schema + operational screens).** Two pieces.
  **(1) Theming.** Deleted `.force-light-theme`, which had pinned eight marketing-calendar surfaces to the light palette *and* redeclared `--primary`/`--ring` - that redeclaration is why the accent colour picker appeared to do nothing on Kayla's sheet, and why dark mode never applied there. Replaced with `--brand-band`/`--brand-accent`/`--surface-note` tokens that flip per theme. Moved the accent from a `style` object spread onto one dashboard `<div>` to `AccentProvider`/`AccentBoot` writing `document.documentElement`, so it now reaches board routes and every portaled dialog (it previously reached neither). New `ThemeControls` (light/dark/**system** - `enableSystem` was off, so "follow my OS" was unreachable) replaces the toggle in all six shells, boards included. Codemod added **126 `dark:` variants** across 16 files - purely additive to class strings, so light mode is bit-identical. New `lib/color.ts` helpers (`contrastRatio`, `compositeOver`, `readableInk`) fix a real AA failure: a company's brand hex rendered as a 10px label on its own 8% tint measured 4.19:1. Browser-verified in both themes with a contrast checker that resolves colours through a canvas (`getComputedStyle` returns `oklab()` for opacity-modified colours, which naïve parsing reads as near-black).
  **(2) CRM.** Migration `103` (**dev only, purely additive, seeds `enabled = false`**): `crm_statuses`/`crm_clients`/`crm_contacts`/`crm_orders`/`crm_order_status_history`/`crm_notes`/`crm_documents`, two advisory-locked reference generators, and a three-trigger status machine. Modelled as its own domain rather than boards/tasks because every report the module exists for needs entered/exited timestamps per status, which `columns` cannot express. **The history is written only by the trigger** - `authenticated` holds `SELECT` and nothing else, and the harness proves a member *and* an admin are both refused when forging, backdating or deleting a row. Dispositions ride in the same UPDATE as the status via write-only carrier columns the trigger blanks. Shipped screens: Dashboard (KPIs, pipeline, aging), Clients + Client Workspace (inline status, notes), New Client Intake (multi-contact for trusts/families), Orders, Status Control (history + time-in-status, mandatory reason on Cancel). `lib/crm.ts` holds all reporting maths, pure and tested. **Gates: `pnpm check:crm` (26), 551 unit tests, plus a 15-check Playwright pass** driving intake → client → order → transition. Three bugs the browser pass caught that typechecks could not: hydration mismatches from `useSurface` reading the theme, from `new Date()` during render (fixed by `lib/use-now.ts`), and from `crypto.randomUUID()` becoming a DOM `id`. **Not built yet:** Lead Insights, Cycle-Time Reporting and the Admin Team Dashboard (the maths is in `lib/crm.ts`; they need real history to report on), and document upload. **`103` is not on prod**, and neither is `102` - see CLAUDE.md.
- **2026-07-23** - Roadmap created. Confirmed all prior work is on `main` (AI harness PRs #10–#13, migrations 061/062 live). Reference repos captured for later investigation.
- **2026-07-23** - Added market-scan competitor notes (per-product ideas + 15 recurring patterns) mapped to roadmap phases. Committed tracker to `main`.
- **2026-07-23** - Reconciled the supplied "Master Product Context" against a real repo audit (not a Plane fork). Owner decisions recorded: build on existing Next.js+Supabase; enterprise items = north-star design-for-later; hosted-SaaS for now; calibrated process. Adopted canonical hierarchy as north-star IA + one Work-Item domain (= Phase 1).
- **2026-07-23** - Prompt 1 (audit-only) delivered: `docs/architecture/{current-system,adr-001-extension-strategy,upstream-boundary,domain-map,risk-register}.md` + `docs/development/local-setup.md`. ADR-001 scored 4 extension options (continue-on-current-app wins 46/50). Added `scripts/healthcheck.mjs` + `/api/health` (verifies DB/storage/API; reports cache/queue/search as N/A, reminder worker dormant). No product features implemented.
- **2026-07-23** - Calibrated test/CI gate before feature work (R-01/R-02): Vitest harness (`vitest.config.ts`, `pnpm test`) with first suites (`lib/rate-limit.test.ts`, `lib/color.test.ts`, 8 tests green) + `.github/workflows/ci.yml` running tests on every PR/push. Branch `chore/test-ci-gate`. Next: Prompt 2 (app shell / design system).
- **2026-07-23** - Prompt 2 slice 1 (app-shell foundation, additive - no live routes touched). Owner decision: shared shell in place, tabs→routes incrementally. Added `components/shell/*` (nav-model + route map, sidebar-state, AppShell/Sidebar/Topbar, command palette ⌘K, breadcrumbs, empty/permission states) + primitives (`ui/{tooltip,skeleton,breadcrumb,command}`) + docs (`docs/design/{information-architecture,design-system}.md`). 21 new unit tests (nav-model 14, sidebar-state 7); 29 total green. Merged to `main` via #14 (gate) + #16 (shell).
- **2026-07-23** - Prompt 2 slice 2a (first live adoption): deep-linkable tabs. User + admin dashboards now sync `activeTab` with `?tab=` so sections are shareable URLs and browser Back/Forward moves between them; sessionStorage fallback preserved (no behaviour lost). Added tested pure helper `components/shell/tab-url.ts` (`resolveActiveTab`, 7 tests; 36 total green). Build verified (`/dashboard` + `/admin` stay dynamic). Next: slice 2b - swap dashboard chrome for AppShell sidebar/topbar + mount ⌘K palette with surface-aware routing.
- **2026-07-23** - Prompt 2 slice 2b (full chrome adoption): both dashboards now render inside `AppShell`. Replaced each bespoke header + horizontal tab-strip + mobile bottom-nav with the shell's left sidebar (sections as nav, per-user collapse), sticky topbar (breadcrumbs + ⌘K palette + host actions), and routed mobile bar. Surface-aware nav (`/dashboard?tab=…` vs `/admin?tab=…`); super-admin appears as a sidebar item. Preserved: accent picker, account settings, sign-out, global search, bookmarks rail, chat unread badge, notifications, AI widget, all tab bodies. Shell components generalized to host-driven (`groups`/`topbarActions`). Typecheck + build clean (routes stay dynamic); 36 tests green.
- **2026-07-23** - Prompt 2 CLOSED OUT (#18 merged to `main`). Dead-code cleanup after the chrome swap (removed orphaned `MobileBottomNav` imports, `navItems`/`primaryNavItems`/`moreNavItems`, `handleMobileNavChange`, unused `headerRef`+GSAP block, dead lucide icons). Added jsdom + React Testing Library + `components/shell/shell-render.test.tsx` (AppSidebar/Breadcrumbs/states) - **first rendering tests** (R-01). Full verification on `main`: **45 tests green, `pnpm build` succeeds, CI green, no open PRs, tree clean.** App shell (Prompt 2) is complete. Next: Prompt 3 (single-org Teams/roles/access-control/module activation - see 2026-07-24 entry below), which lights up real module toggles.
- **2026-07-24** - Course correction before Prompt 3 implementation: (1) persisted the full Master Product Context (charter + sections A–F, not just PROMPT 1–10) verbatim to `docs/product/master-product-context.md`. (2) **Owner ruling: single organization, permanently - not a multi-tenant SaaS product.** PROMPT 3's "Organizations" (plural) / tenant-isolation framing is N/A; replaced the planned `organizations`/`org_members`/`org_id`-on-six-tables/tenant-RLS-rewrite with a lighter, additive plan: `teams` + extending the existing `board_members` table with a `role` column (member/guest/client - the mechanism Phase 7's client portal already anticipated) + a real permission matrix + a singleton `app_modules` config table. No destructive migration, no cross-tenant isolation gate. (3) Confirmed `bobby@goatlasgo.us` and `kayla@goatlasgo.us` both intentionally hold platform role `super_admin` - not consolidating to one. Updated `CLAUDE.md`, `build-navigation.md`, and this file accordingly; corrected the "Multi-company tenancy" and "hosted SaaS" mislabels above (SRG/AGC were always a business-unit dimension, never tenancy).
- **2026-07-24** - Implemented the re-scoped Prompt 3 slice 1 (schema layer): migrations `064` (`teams`+`team_members`), `065` (`board_members.role` - member/guest/client, enforced via `private.can_manage_task` + tasks UPDATE/DELETE policies), `066` (`app_modules` singleton + `lib/modules.ts` registry), `067` (closed an INSERT-policy gap found while verifying 065 - guest/client could still create tasks, and separately a **pre-existing** gap from `061` meant board-privacy was never checked on task INSERT at all). Added `scripts/check-board-roles.mjs` (mirrors `check-isolation.mjs`'s pattern) - 9/9 checks pass on the dev sandbox, including a `member`-role control case. 59 tests green (56 + 3 new for `lib/modules.ts`), build clean. Deliberately did **not** build a standalone `lib/permissions.ts` matrix - the codebase already has inline `canEdit`/`canDelete` checks in `board-view.tsx`/`task-card.tsx`/`task-detail-modal.tsx`.
- **2026-07-24** - Finished the slice: threaded the new `board_members.role` into those existing inline checks (fetched server-side per-board in both board page routes, passed down through `board-view.tsx` → `task-card.tsx`/`task-detail-modal.tsx`) and wired both dashboards' nav (`user-dashboard.tsx`, `admin-dashboard.tsx`) to `useAppModules()`. Browser-verified end-to-end with a real Playwright session against the dev server (not just unit tests): created a throwaway `@goatlasgo.us` test user + board + task via the service role, confirmed the golden path (plain member, no `board_members` row - Add-task button visible, title/description/due-date editable, zero console errors), then set the user's role to `guest` and reconfirmed in the same session (via saved auth state) that the Add-task button disappears and the title/description/due-date inputs become `disabled` - matching the codebase's existing disabled-input convention rather than introducing a new one - while the task stays visible. All test fixtures (user, board, column, task) deleted afterward; dev server stopped. Not wired: `AiChatWidget`/`BookmarksSection` still render unconditionally in all three dashboard shells - `ai_assistant`/`bookmarks` exist as `app_modules` rows but aren't consumed at those sites yet.
- **2026-08-05** - De-hardcoded the marketing calendar's single-owner (`kayla@goatlasgo.us`) access gate (CLAUDE.md §3), and generalized it into an admin-manageable, multi-instance feature per an owner request mid-review. Migration `085`: new `marketing_calendars` + `marketing_calendar_members` tables (mirroring `boards`/`board_members`, not `teams` - `teams` was unconsumed and had the wrong RLS shape) + a `private.is_calendar_member()` helper + a real `calendar_id` FK on `marketing_calendar_items` replacing the old `assigned_to`-overloaded-as-calendar-identity hack (the same "two competing sources of truth" shape migration `063` already fixed once). Every existing row backfilled onto one calendar named "Marketing Calendar", owned by and membered by Kayla - zero behavior/data change for anyone on deploy. New: `lib/use-marketing-calendars.ts` (shared hook, avoids double-fetching between dashboard gating and the component's own switcher) and `components/admin/marketing-calendar-management.tsx` (admin-only create/rename/archive + per-calendar member picker, reusing `board-management.tsx`'s embedded all-profiles-checkbox pattern - no new "invite" flow needed). No role tiers on membership (every member gets full CRUD, matching Kayla's prior access) - deliberately mirrors `teams`' "don't build it speculatively" lesson. Verified: 162 unit/component tests green (4 new), `pnpm check:marketing-calendars` (new dedicated cross-calendar isolation harness, 14/14 against real RLS - including that removing a membership row revokes access on the very next query) plus the two existing marketing harnesses extended for the new `calendar_id` column, and a 9/9 real-browser Playwright pass proving the end-to-end loop: a zero-access member has no Marketing nav item at all, an admin creates a calendar and grants that specific user access via the picker, and the user then sees exactly that calendar and nothing else. Migration applied to dev first, then prod (backed up first), then code pushed - same ordering as the documented `068` incident.
- **2026-08-13** - First slice against the research pack in `plan/` (ATLAS_01 §13 Foundation 1–2 = ATLAS_02 Prompts A + B core). **No migration - this slice is entirely application-layer.** (1) **`lib/capabilities.ts`**: the canonical capability vocabulary the pack asks for. The same permission expression had been copy-pasted inline in three files (`board-view.tsx`'s `canManageTask`, `task-card.tsx`'s `canEdit`/`canEditDueDate`, `task-detail-modal.tsx`'s `canEdit`/`canEditDueDate`/`canDeleteAttachments`/`canUploadLargeFiles`), each with a comment saying it mirrored the others - three copies is three chances for one to drift. All now resolve through `can()`. Behaviour is provably unchanged: `lib/capabilities.test.ts` (24 tests) re-states each original expression, including the two subtleties worth keeping - the `/dashboard` board route's deliberate `isAdmin={false}`, and `task.attach.large` reading `platformRole` *past* that override because the RLS policy behind it calls `private.is_admin_user()` (writing `role === 'admin'` there would exclude both super_admins). `pnpm check:board-roles` still 9/9 against real RLS. Frontend only - **RLS remains authoritative**, stated in the module header. (2) **Unavailable actions now explain themselves** (§10.2): `ActionGuard`/`RestrictionNote`/`guardAction`; a guest/client sees the Add-task button disabled with a reason instead of silently absent, and the task modal states once, at the top, why every field is read-only. (3) **⌘K rebuilt** (Prompt A): was navigation-only; now Recent / Go to / Search results / Create, with live task search through the session client (so RLS decides what is findable) and every command carrying its `CapabilityDecision` - `runCommand` refuses a denied one at the point of execution, since a palette is a second route to every action and that is where a check gets forgotten. (4) **Recently-viewed records**: the sidebar's Recent block existed but nothing ever fed it - every host passed the default empty array. Now populated from board visits. (5) **Per-user density** (§10.3/§11.5): Compact/Comfortable/Expanded, per user per browser, applied to board task cards. (6) **`/my-work`** (§10.8, §13 #6): the nav had advertised My Work as "soon" while the route 404'd. Now real - ranked shortlist with its reasons on top (existing `work-next.ts`, unchanged), then Overdue / Due today / In progress / Due this week / Waiting on someone else, each section explaining its own rule. Deliberately **does not** fake "blocked" or "needs approval": both need schema that doesn't exist, and the page names them as gaps instead (`UNANSWERED_QUESTIONS`). (7) **`buildWorkspaceNav`**: the dashboard used to build its nav inline, so `/my-work` would have drifted from it immediately; both now share one builder. (8) `ErrorState` + `LoadingRows` added to `states.tsx`, and the empty state's three-part contract documented. **Verified:** 315 unit tests green (70 new), `tsc --noEmit` clean, `next build` clean with `.env.production.local` moved aside and the dev ref (`pxzpewaerhjwnwsbaklc`) confirmed baked into the bundle, 24/24 real-browser Playwright checks against the dev server (My Work renders real fixture data with reasons; sidebar Recent populates after a board visit; ⌘K opens with all groups and finds a live task; density persists), plus `check:board-roles` 9/9, `check:task-lifecycle` and `check:isolation` unchanged. **Deliberately not built:** work-item context actions in the palette (needs a selected-item context the board doesn't publish - `board-view.tsx` renders outside `AppShell`), Teams UI, Inbox, and anything requiring a migration.
- **2026-08-13** - **Teams go live (migration `094`, dev only), plus three fixes found while auditing.** Owner instruction: two teams, Atlas General and Shanks Realty, everyone in both, super admins able to add/remove/move members. **Audit first:** `teams`/`team_members` (migration `064`, 2026-07-24) held **0 rows on dev *and* on production** and had zero call sites repo-wide - so this was a first population, not a reconciliation. The 8 real people were grouped only by `profiles.role` (2 super_admin, 3 admin, 3 user) and by 8 `board_members` rows; the sole thing in the UI labelled "Team" was the **"Team chat"** dialog, which is a chat panel, not a grouping. (1) **Migration `094`** seeds `Atlas General Contracting` + `Shanks Realty Group` (names/colors matching the `companies` rows from `056`, but deliberately **not** FK'd to them - `companies` stays a marketing business-unit label per the standing ruling, and the two are free to diverge), cross-joins every existing profile into both, adds a unique index on `lower(name)`, **narrows management from `is_admin_user()` to `is_super_admin_user()`**, and closes the Supabase blanket-grant hole on both tables. Self-verifying post-conditions inside the transaction + paired `scripts/rollback/094_revert.sql`. (2) **`pnpm check:teams`** (new harness, 27/27): proves plain users *and admins* can read but not change, super admins can create/rename/add/**move**/remove, signed-out sees nothing, and every pre-existing profile is in both teams. Its `admin`-tier case is the control proving the narrowing is real. It also pins that **a new account joins no team automatically** - intentional, and surfaced in the UI as a "not in any team" prompt. (3) **UI**: `components/admin/team-management.tsx`, a fourth tab on the super-admin-only `/admin/super-admin` page. Membership is a **people × teams grid** rather than a per-team member picker, because a *move* is only legible with both teams on screen; per-team pickers make one move look like two unrelated edits in two dialogs. Pure logic in `lib/teams.ts` (24 tests). Optimistic writes use the functional form of `setMembers` throughout - a move is two ticks in flight at once, and snapshot-and-restore would silently drop one. (4) **Fixed: `task_notifications` were being consumed on page load.** `task-notification-toasts.tsx` loaded 5 unread rows, toasted them, then bulk-marked them read whether or not anyone looked. Production evidence: Bobby 0 unread of 6 and Kayla 0 of 42 (they use the app, so their notifications were auto-consumed), against Tim 47/47, Vanshaj 45/45, Mendy 19/19 unread. Marking read is now per-notification and tied to the toast actually finishing, so a visit too short to read one leaves it unread. (5) **Fixed: the toast's "Open" button never opened anything** - it captured `task_id` and then navigated to `/dashboard` regardless. Now deep-links to `/{admin|dashboard}/board/{board_id}?task={id}`, matching `global-search.tsx`'s existing convention, and offers no action at all when there is nowhere specific to go. (6) **Fixed: `ai_assistant` and `bookmarks` were toggleable in `app_modules` but nothing consumed them** - switching either off in Super Admin changed nothing. Both render sites in `user-dashboard.tsx` / `admin-dashboard.tsx` are now gated; the bookmarks *rail* is gated rather than just its contents, so turning it off doesn't leave an empty collapsible strip. **Verified:** 339 unit tests green (24 new), `tsc --noEmit` clean, `next build` clean with `.env.production.local` moved aside and the dev ref confirmed baked, **17/17 real-browser checks** on the Teams UI (a plain admin is redirected off the page; unticking a box really deletes the row in Postgres and re-ticking restores it; create + delete work; zero console errors) and **13/13** on the notification and module fixes (still unread while the toast is on screen; Open lands on the right board *and* task; a 0.7 s visit leaves the row unread; both module toggles actually hide their widgets). `check:board-roles` 9/9, `check:teams` 27/27, `check:task-lifecycle`, `check:marketing-calendars`, `check:project-ids`, `check:isolation` all unchanged. **⚠️ `094` is dev-only and NOT cleared for prod** - it rewrites RLS policies and revokes grants, which the repo classifies as destructive, so it needs the owner's explicit go-ahead. The UI degrades safely without it (tab renders, list empty, `064`'s admin-tier policy still applies). **Audit finding not fixed:** `anon` holds `TRUNCATE`/`DELETE` on **28 of 30** public tables (all but `teams`/`team_members`, fixed here, and `project_ids`, which `090` got right). Not a live leak - all 12 `{public}`-role policies are gated on `auth.uid()`, and PostgREST doesn't expose `TRUNCATE` - but a latent one. It is a single mechanical migration that rewrites grants on every live table, so it wants its own session and the owner's sign-off rather than being bundled into unrelated work.
- **2026-08-13** - **Closed the Supabase default-grant gap (`095`), and found two real bugs doing it (`096` + an API fix).** (1) **`095`** revokes everything `anon` held in `public` - all 37 tables, every sequence, and every function except the three public-booking RPCs - and narrows the *default privileges* so a new table no longer inherits the grant. `authenticated` keeps every DML privilege it had (RLS is what constrains a signed-in user); only `TRUNCATE`/`REFERENCES`/`TRIGGER` were removed, `TRUNCATE` being the one privilege RLS never covers. Safe because every public, unauthenticated surface in the app (`/share/[token]`, `/book/[token]`, `/book/cancel/[token]`, `/api/book/*`) talks to Postgres through the **service role** on the server, and the public booking *form* posts to an API route rather than querying Supabase at all - plus the tables behind those flows already had anon revoked and their harness already passed. Gate: new `pnpm check:grants` (16/16 behavioural checks through real clients; the migration asserts catalog state itself). Two things the post-conditions caught mid-write, both worth remembering: a `has_sequence_privilege()` call was evaluated by the planner *before* the `relkind` filter and errored on an index in another schema (fixed with an `OFFSET 0` fence), and `REVOKE ... FROM anon` was a **no-op** on three SECURITY DEFINER helpers because Postgres grants `EXECUTE` to `PUBLIC` implicitly - only `REVOKE ... FROM PUBLIC` removes it. `is_board_member` was the one genuinely reachable over PostgREST. Deliberately preserved and asserted: `book_appointment`/`cancel_appointment`/`check_booking_rate_limit` keep anon EXECUTE, since `082` granted them on purpose and `app/api/book/cancel/[token]/route.ts` really does call one with an anon client. Still open: `postgres` may not alter `supabase_admin`'s default privileges, so a table created through the Supabase **dashboard** still needs a manual REVOKE. (2) **`096` restores the `on_auth_user_created` trigger**, which the dev sandbox had lost entirely - `handle_new_user` existed as an orphaned function attached to nothing. Found because `check:grants` asserted signup still creates a profiles row rather than assuming it. This is **sandbox drift, not a prod regression**: the trigger lives on `auth.users`, outside the `public` schema, so a public-only clone silently drops it; production checks out (the five most recent accounts all have their row). On prod `096` is a no-op worth applying anyway so both databases are provably identical. (3) **Fixed `app/api/admin/create-user/route.ts`**, which used a bare `.update().eq()` on `profiles` and so silently depended on that trigger. A zero-row UPDATE is not an error in PostgREST, so on any database missing the trigger the route reported `success: true` while creating an account with **no profile at all** - and since `profiles.role` drives every permission check, that user would be broken on arrival with nothing to show why. It now upserts and verifies a row came back. **Verified:** 339 tests green, `tsc` clean, `next build` clean with `.env.production.local` moved aside and the dev ref confirmed baked, **all 14 RLS harnesses pass** (grants, teams, board-roles, task-lifecycle, appointment-booking, appointments, project-ids, marketing ×4, task/chat attachments, isolation), plus real-browser runs: 17/17 on Teams, 13/13 on notifications+modules, **17/17 on every anonymous surface** (landing, login, signup, public booking, booking cancel, share, and the three signed-out redirects - zero permission errors anywhere), and **9/9 on the create-user route** end to end (profile exists, role and name applied, the new account signs in and reads its own profile). Also corrected in passing: `/signup` is **deliberately disabled** (the page redirects to `/login` and the form is commented out), so accounts are only ever created through the admin route - which is precisely why its silent failure mode mattered.
- **2026-08-13** - **Removed the orphaned `cami@goatlasgo.us` production auth account** (owner instruction). It was an auth account with no `profiles` row, created 2026-01-21 and **never signed in**. Root cause found in the process: `scripts/019_delete_cami_reassign_to_kayla.sql` had deleted that person's `profiles` row and reassigned their tasks/messages to Kayla, but never removed the matching `auth.users` row - so the account had been sitting as a half-finished deletion for months. Removing it completed an action the repo had already decided on, rather than making a new one. Verified before deleting, not after: every uuid column in `public` that can hold a user reference was enumerated from `information_schema` (37 of them across 30 tables) and scanned for the account's id - **zero rows anywhere** - plus zero objects under its id in all three storage buckets, and the full auth record was snapshotted to disk first so it could be recreated. The delete script re-resolved the account **by email** at run time and refused to proceed on an id mismatch, a second account sharing the email, any recorded sign-in, or any row appearing between the pre-flight and the delete. Production is now **10 auth accounts / 10 profiles / 0 orphans**. Generalisable lesson worth keeping: deleting a `profiles` row does **not** delete the account - the FK runs `profiles.id -> auth.users.id ON DELETE CASCADE`, so removing a person means deleting the auth account and letting the cascade take the profile, never the reverse. Migration `019` got this backwards and nothing noticed for seven months.
- **2026-08-20** - **Closed ATLAS_02 B3a: public sharing now respects view-only board roles
  (migration `109`, dev sandbox only).** The owner chose the stricter rule: an explicit
  `board_members.role IN ('guest','client')` cannot mint an unauthenticated board or task URL,
  even when that person created the resource or is a platform admin. `074` checked ownership,
  admin status and privacy but omitted the board role, so hiding Share in the frontend was only a
  UX preference and a direct PostgREST INSERT still worked. `109` replaces that one INSERT policy,
  applies the same indexed membership check to both resource branches, and self-verifies that it is
  the only INSERT policy and changed no existing link rows. Existing links remain active by design.
  The board Share button's remaining inline admin/creator check now uses the same `share.external`
  capability as task detail. **Verified:** 657 unit tests, `tsc --noEmit`, production build against
  the dev ref (prod ref absent), `check:access-matrix` **70/70** including 13 new direct sharing
  cases and same-session demotion, and `check:task-lifecycle`; migration ledger 109 applied / 0
  pending. Supabase advisors found no new `share_links` warning (only the empty sandbox's two
  pre-existing INFO-level unused-index notices). **Not applied to production:** this rewrites an
  RLS policy and is therefore destructive under the repository rule; production needs its own
  reviewed rollout before the application change ships.
- **2026-08-19** - **ATLAS_02 Prompts A + B re-audited against the prompts themselves, and every
  finding fixed.** Full ledger with file/line evidence and measurements:
  `docs/reviews/atlas-prompts-a-b-audit.md`. **No migration in that audit pass** - every finding
  fixed that day was above the database; B3a was recorded separately as the one owner decision
  that would require an RLS rewrite. The ones worth knowing: **(1) `comment.create` contradicted RLS.** The
  capability grouped it with `task.edit` and denied guests, while the `task_comments` INSERT
  policy gates on `can_view_task` - measured on the sandbox, a guest who cannot edit or attach
  *can* comment, which is the one thing the `client` role exists for. **(2) Task writes announced
  refusals as saves.** Seven `.update().eq()` calls checked `error` only, and PostgREST reports an
  RLS refusal as zero rows with no error - the lesson `lib/board-membership.ts` was written around,
  never applied to tasks. Now `lib/rls-write.ts`, which also handles the trap that makes a naive
  row count wrong: `RETURNING` is filtered by the SELECT policy on the **new** row, so a save that
  sets `visibility='assigned'` and drops you from the assignees succeeds *and* returns nothing.
  **(3) The ⌘K Create commands were broken for every admin** - hardcoded `/dashboard?tab=…`, which
  `app/dashboard/page.tsx` redirects to `/admin` while dropping the query; `/admin` and `/crm`
  offered no Create group at all. One `dashboardHost(role)` now serves the sidebar and the palette.
  **(4) Context Actions never existed.** A board renders outside `AppShell`, so ⌘K did not exist
  there; the palette is now mounted on the board with both of the plan's lists - and because the
  work-item actions need to know what is open, `TaskCard` no longer renders its own duplicate
  `TaskDetailModal`, the board owns one. **(5) The `ai_assistant` toggle was UI-deep** - the widget
  hid, `POST /api/ai-chat` kept answering. **(6) Three server routes discarded their query errors**
  (`/my-work`, `/crm/orders`, `/crm/clients` + `/crm`), so a failed read rendered as "You're all
  caught up" and an empty CRM. **(7) The access log filtered a 50-row page in the browser**, so
  "Nothing in this category yet" could be false. Also: `task.attachment.delete` was stricter than
  its own policy (an assignee could not delete a file they uploaded) and denied with a sentence
  about due dates; `AuditAction` was missing the three actions `100`/`101` emit, so an account
  deletion rendered with the same weight as a rename; `canViewAudit` reached only one shell;
  `task.view` was deleted as an unconditional ALLOW. **Verified:** 652 unit tests (was 589),
  `tsc --noEmit` clean, `next build` clean with `.env.production.local` moved aside and the dev ref
  confirmed baked, **ten RLS harnesses green** including `check:access-matrix` (57 at that
  point, counted), and a new
  **`pnpm check:shell-actions` - 18/18 in a real browser**: ⌘K stacks over an open task modal, every
  context command from the plan is present, a palette "Move to" really moved the task in Postgres,
  and a real guest session posted a comment that reached `task_comments`. **Deferred at audit time: B3a** -
  `share_links` ignores `board_members.role`, so a member demoted to guest can still mint a public
  link to a task they created; the frontend now refuses it, the database does not, and closing that
  is an RLS rewrite plus an owner call. The owner chose to close it on 2026-08-20; see the entry above.
- **2026-08-13** - **ATLAS_02 Prompt A closed out** (`plan/ATLAS_02_…`, first prompt in the pack's own order). Migration `097` is the only schema change. **Audit first:** of Prompt A's explicit verification list, the shell already had the palette, recents, density, UX-state primitives, mobile nav, module-aware nav, skip link and reduced-motion handling; genuinely missing were favourites, undo, unsaved-change protection, a11y automation and the zoom passes. (1) **Favourites - migration `097`, `user_favorites`.** Deliberately a table rather than localStorage: sidebar collapse/density/recents are per browser because they cost nothing to lose, but a curated star list is not that, and someone who stars six boards on a laptop expects them on their phone. The shape is `(user_id, entity_type, entity_id)` rather than a `board_id` column, because Prompt A lists "pinned views" alongside "favorite projects" and Prompt E introduces saved views - a `favorite_boards` table would need an incompatible `favorite_views` sibling three prompts from now. `'view'` is already accepted by the CHECK, so pinned views need no migration. **A favourite is a pointer, not a grant:** the policies scope a row to its owner and stop, with no admin exemption (a favourites list is closer to `personal_tasks` than to `boards`), and `resolveFavorites` drops any star whose target did not come back from the query - which covers deleted, archived and access-revoked with one rule. Surfaces: a sidebar Favourites block above Recent, a ⌘K Favourites group ahead of Recent (curated beats guessed), a star on board cards, a star by the board title, and favourites-first ordering in the grid. Gate: **`pnpm check:favorites` (16/16)**, including that starring a private board does *not* make it readable. (2) **Undo-capable toasts** (`components/shell/undo-toast.ts`). Personal tasks and bookmarks were both **silent hard deletes** - one unconfirmed click, no toast, no way back. The model is act-then-offer-to-reverse rather than defer-then-commit, because deferring leaves the action half-done if the tab closes while telling the user it happened; undo re-inserts **the original row with its original id**, so it is the same row returning rather than a lookalike. (3) **Unsaved-change protection** (`components/shell/unsaved-changes.ts`) on the create-task dialog, which was discarding a title, description, assignees, links, tags and a first comment on a stray Escape. `beforeunload` covers leaving the page; a guarded `onOpenChange` covers Escape/overlay/X. `window.confirm` is used deliberately - `@radix-ui/react-alert-dialog` is installed but has no wrapper here, and nesting one inside an open Dialog puts two focus traps in competition. (4) **Accessibility automation** (`components/shell/a11y.test.tsx`, axe-core) plus a real-browser axe run. **Four real defects the automation found, all pre-existing except the last:** *(a)* every nav link in the **collapsed sidebar had no accessible name at all* - the label only rendered when expanded and the tooltip is not mounted until hover, so a screen reader announced eight indistinguishable "link"s; labels are now always present and only visually hidden. *(b)* **Dialog focus restoration never worked** anywhere in the app: closing any dialog left focus on `document.body`, so a keyboard user who opened a task mid-board was returned to the top of the document. Radix re-focuses the exact node that was active at open time, which fails here because dialogs are driven by host `open` state, so the host re-renders and the trigger becomes a new node. Fixed generally in the shared `Dialog` wrapper (`components/shell/use-focus-restore.ts`) so every dialog gets it, including future ones. The timing is the whole problem and a double rAF is not enough - measured `INPUT#title` at 100ms and `BODY` from 300ms, so it polls until the close settles. *(c)* **The page scrolled sideways at 320px** (WCAG 1.4.10 reflow, = 320% zoom): the topbar action cluster ran 76px past the viewport. Gaps tighten below `sm` and the two personalization controls (density, accent) drop out there. *(d)* The **tile-view board card overflowed its own grid cell by 91px**, putting each star on top of the next card and stealing its click target - `CardHeader` is a CSS grid and a grid item defaults to `min-width: auto`, so adding the star pushed the row past min-content instead of shrinking it. (5) **Fixed `pnpm check:teams`, which had started failing** for a reason worth recording: it asserted "every pre-existing profile is in both teams" while also asserting "a new account joins no team automatically" - two checks in direct tension, guaranteed to break the first time a real account was created after `094`. It now reads `094`'s `applied_at` from the migration ledger and only asserts the backfill over profiles that predate it. (6) Filled the boards list's missing empty state. **Verified:** 429 unit tests green (63 new), `tsc --noEmit` clean, `next build` clean with `.env.production.local` moved aside and the dev ref (`pxzpewaerhjwnwsbaklc`) confirmed baked, **all 15 RLS harnesses passing** (favorites, grants, teams, board-roles, task-lifecycle, project-ids, isolation, appointments ×2, marketing ×4, task/chat attachments), and **37/37 real-browser Playwright checks** - star round-trips through Postgres and survives a reload, ⌘K shows Favourites before Recent, unsaved changes prompt on Escape and the typed text survives backing out, focus returns to the exact trigger node, undo restores the deleted row in the database, no sideways scroll at either 200% or 320%, collapsed nav links keep their names, axe clean of critical/serious violations on the live signed-in dashboard, and zero console errors throughout. **⚠️ `097` is applied to the dev sandbox only; prod is at `094`.** It is purely additive (one new table, no existing policy touched), so it is `--allow-prod` eligible unlike `094`/`095` were. Rollback: `scripts/rollback/097_revert.sql` - note it destroys real user data, so snapshot the table first if the intent is "roll back the code, keep the stars".
