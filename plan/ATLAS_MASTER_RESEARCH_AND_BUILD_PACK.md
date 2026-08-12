# ATLAS PROJECT MANAGEMENT — MASTER RESEARCH + AUDITED BUILD PACK

> Combined file. Part 1 is the research/audit/design guide. Part 2 is the Claude Code build prompt pack.

---

# Atlas Project Management
# Competitor Research Audit, Product Strategy, and Design Reference Guide

**Research date:** 2026-08-13  
**Atlas repository:** `VanshajPoonia/projectmanagementatlas`  
**Reference projects studied:** Plane, OpenProject, Vikunja, Leantime, Taiga  
**Community sources studied:** Reddit, official community forums, GitHub issues/discussions, official documentation, and current repositories

---

# 1. Purpose

This document audits the earlier Atlas build prompt pack and separates four things that must not be confused:

1. **What Atlas already has**
2. **What each reference application actually does well**
3. **What users in forums say is still missing or frustrating**
4. **What Atlas should independently implement**

The five open-source products are references, not foundations for Atlas.

Atlas already has its own production architecture:

- Next.js 16
- React 19
- TypeScript
- Supabase/Postgres
- Supabase Auth
- Postgres Row Level Security
- Tailwind 4
- Radix/shadcn-style UI primitives
- Vercel deployment
- Vitest-based tests
- custom database migration/verification tooling

The correct strategy remains:

> Study product concepts, interaction models, and domain models. Re-implement selected ideas cleanly in Atlas. Do not merge or vendor the five codebases into Atlas.

---

# 2. Research methodology and evidence hierarchy

When deciding whether a feature exists or whether a product is "best" at something, use this evidence order:

## Tier 1 — Current official documentation and source repository

Use these to determine what the product currently supports.

Examples:

- Plane documentation
- OpenProject documentation
- Vikunja help
- Leantime repository README/docs
- Taiga official community tutorials maintained by the project

## Tier 2 — Current GitHub issues and official community forums

Use these to discover:

- missing capabilities
- recurring usability complaints
- bugs
- workflow friction
- requests from actual users

A feature request is evidence that users want something. It is **not** evidence that the feature currently exists.

## Tier 3 — Reddit, Hacker News, and external communities

Use these for qualitative signals:

- why people choose a product
- what they find confusing
- deployment perceptions
- whether the product feels lightweight or heavy
- migration reasons

Do not use one Reddit comment as proof that an entire community agrees.

## Tier 4 — Product marketing pages

Useful for positioning, but never use marketing copy alone to decide whether a feature exists in the open-source/community edition.

This matters especially for Plane and OpenProject, where product documentation can span multiple editions.

---

# 3. Executive conclusion — which project is best at what?

| Area | Best reference | Why Atlas should study it |
|---|---|---|
| Modern PM interaction design | **Plane** | Fast work-item interactions, contextual command palette, multiple views, personal work hub, modern information density |
| Command palette / keyboard speed | **Plane** | Power-K combines navigation, search, creation, and contextual work-item actions |
| Personal work cockpit | **Plane + Atlas** | Plane has a centralized Your Work page; Atlas already has an explainable WorkNext concept that should go further |
| Intake / triage | **Plane** | Requests can stay in triage rather than polluting active project work immediately |
| Traditional project planning | **OpenProject** | Strong work-package model, hierarchy, scheduling, Gantt, dependencies, time/cost concepts |
| Gantt / scheduling reference | **OpenProject** | Manual and automatic scheduling, dependency relationships, lag, milestones, hierarchy |
| Time and cost management | **OpenProject** | Mature time/cost/budget model compared with the other references |
| Lightweight task productivity | **Vikunja** | Simple task UX, Quick Add, saved filters, configurable project views |
| Quick capture | **Vikunja** | Low-friction task entry and "Quick Add Magic" are worth studying |
| Filter/query simplicity | **Vikunja + Plane** | Vikunja is lightweight; Plane adds richer views and query concepts |
| Strategy → execution | **Leantime** | Goals, metrics, canvases, ideas, risk analysis, milestones, retrospectives |
| Non-PM accessibility | **Leantime** | Explicit product focus on people who are not trained project managers and on cognitive accessibility |
| Scrum | **Taiga** | Backlog → sprint → taskboard is a coherent and highly visual Scrum workflow |
| Agile visual management | **Taiga** | Swimlanes, WIP limits, filtering, search, and personal zoom/density levels |
| Scrum/Kanban coexistence | **Taiga** | The same underlying user story can appear in Scrum and Kanban instead of duplicating records |
| Specialized marketing workflow | **Atlas** | Atlas already has a first-class marketing content calendar rather than treating marketing as generic tasks |
| Data-aware AI | **Atlas** | Atlas already has an AI assistant that reads real workspace/task/marketing data; this should remain a differentiator |
| Explainable next-work recommendation | **Atlas** | Existing `WorkNext` exposes why a task deserves attention rather than showing an unexplained AI score |

---

# 4. Audit of the previous prompt pack

The previous prompt pack is directionally strong. It should **not** be discarded. It needs several corrections and clarifications.

## 4.1 Correct and keep

These parts are supported by the Atlas repository and current research:

- Continue the existing Atlas application rather than starting over.
- Do not fork Plane/OpenProject/Vikunja/Leantime/Taiga into Atlas.
- Preserve Atlas's Next.js + Supabase + RLS architecture.
- Treat Atlas as one organization, not a general multi-tenant SaaS.
- Preserve existing database guards and migration discipline.
- Audit before implementation.
- Wait for owner approval before implementing a major slice.
- Keep one canonical work-item model across views and methodologies.
- Preserve Atlas's marketing-calendar differentiation.
- Extend `WorkNext` instead of replacing it.
- Keep Gantt/timeline and generic automation behind an explicit scope decision because older Atlas docs conflict with the later master roadmap.
- Preserve the existing Cal.com-inspired Atlas visual identity rather than cloning Plane.
- Use progressive disclosure.
- Keep advanced modules optional.
- Use deterministic ranking/rules before opaque AI scoring.
- Treat critical-path computation as a new Atlas capability rather than an inherited OpenProject feature.

## 4.2 Correction — Plane documentation does not equal Plane Community Edition feature availability

The earlier research sometimes spoke about Plane documentation as if every documented feature were necessarily available in the open-source Community Edition.

That is too broad.

Plane's current documentation includes a very large product surface:

- work items and types
- states
- recurring work
- cycles
- modules
- epics
- dependencies
- initiatives
- teamspaces
- milestones
- releases
- views
- PQL
- Your Work
- pages/wiki
- estimates
- bulk operations
- time tracking
- workflows/approvals
- automations
- inbox
- intake
- analytics
- integrations
- AI

However, edition boundaries have been confusing enough that a 2026 Plane GitHub issue documents contradictory public statements about Community Edition limits.

A Reddit `r/selfhosted` thread also shows users trying to understand self-hosted versus cloud feature parity.

### Atlas rule

When studying Plane:

> Use Plane's product documentation for UX and domain ideas, but never tell Claude that a capability can be copied from Plane Community Edition without checking the actual repository/version and license boundary.

Atlas is not using Plane as an engine anyway, so the important thing is the product concept.

## 4.3 Correction — OpenProject does not currently provide critical path

The earlier prompt pack correctly warned that Atlas must not assume OpenProject provides critical path.

Keep that warning.

OpenProject's current Gantt FAQ states that critical-path display is not available yet.

OpenProject is still the best reference of these five for:

- Gantt planning
- work-package hierarchy
- manual/automatic scheduling
- predecessor/successor relationships
- lag
- milestones
- time tracking
- cost/budget concepts

But Atlas critical path must be treated as a separately designed and tested scheduling algorithm.

## 4.4 Correction — OpenProject Community versus Enterprise must stay separate

OpenProject documentation covers Community and Enterprise capabilities.

Do not infer that every item in the documentation is free Community functionality.

When Atlas studies:

- portfolios
- resource planning
- enterprise governance
- advanced baseline controls

treat them as design references.

Atlas will independently implement only what the product actually needs.

## 4.5 Correction — Vikunja does not currently list a native project Calendar view

Vikunja's current project-view documentation lists:

- List
- Table
- Gantt
- Kanban

The earlier Atlas pack includes Calendar as an Atlas target.

That is fine.

But Calendar must be described as an **Atlas capability**, not as something borrowed from Vikunja.

Atlas already has calendar functionality of its own.

## 4.6 Correction — Vikunja has a hierarchy/roll-up gap worth explicitly solving

This is stronger than the previous pack made it sound.

A long-running Vikunja community request asks for a parent project to automatically display work from child projects.

Users describe current workarounds involving manually maintained saved filters.

The thread was still active in 2026, including multiple community pull requests attempting to solve it.

### Atlas design requirement

Do not repeat this hierarchy problem.

Saved views and project scopes should support:

- `include_direct_children`
- `include_all_descendants`

without requiring users to manually update the view when a new child project is created.

## 4.7 Correction — Leantime's current OSS feature set is broader than an earlier answer implied

An earlier explanation suggested that several important Leantime capabilities were plugin-only.

The current Leantime repository README explicitly says its listed feature set is included in the OSS version, including:

- Kanban
- Gantt
- table/list/calendar
- unlimited subtasks
- dependencies
- milestones
- sprint management
- time tracking
- timesheets
- dashboards/reports
- goals and metrics
- Lean / Business Model Canvas
- SWOT
- risk analysis
- wiki/docs
- idea boards
- retrospectives
- project permissions
- API/plugin extensibility

Plugins still exist and may add capabilities, but the core OSS surface is stronger than previously characterized.

### Atlas lesson

Leantime is a more important reference for strategy and non-PM usability than the earlier ranking suggested.

## 4.8 Community finding — Leantime users want self-hostable automation

A Leantime GitHub feature request asked for a self-hosted automation integration path such as n8n instead of depending on hosted Zapier.

A maintainer responded positively to the n8n idea but indicated limited development resources.

### Atlas lesson

If Atlas eventually adds automation:

- build reliable webhooks/API primitives first
- make n8n/Make/Zapier possible through general interfaces
- do not create a closed integration that only works with one hosted provider

## 4.9 Correction — Taiga is genuinely strong at Scrum visualization

This conclusion is supported by both Taiga's official tutorials and its community.

Taiga's Scrum taskboard supports personal zoom levels:

- compact
- default
- detailed
- expanded

The denser levels act more like a high-level heat map; expanded levels expose more information.

Taiga also allows the same internal user story/work item to be represented in Scrum and Kanban when both modules are enabled.

A Taiga community user specifically praised Taiga's Scrum visualization, story swimlanes, epics, and high-level reporting while noting gaps around custom-field filtering.

### Atlas lesson

Keep the previous recommendation:

- one canonical work item
- optional Agile module
- Scrum/Kanban are views/methodologies over the same data
- user-specific board density
- story swimlanes
- WIP limits

## 4.10 Correction — Taiga still lacks native time tracking

Taiga's official FAQ explains that native time tracking was deliberately not implemented.

A 2025–2026 feature-request thread shows organizations still asking for native time tracking and using external solutions.

### Atlas lesson

Do **not** copy Taiga's absence of time tracking if Atlas later serves teams that need billing/accountability.

But time tracking should remain an optional Atlas module rather than cluttering every task.

## 4.11 Correction — `docs/architecture/current-system.md` is a historical snapshot, not current truth

Atlas's `current-system.md` was created during the July 23 audit.

At that time it recorded:

- 62 migrations
- no tests
- no CI
- no migration runner

Those facts are now stale.

The August handoff records substantially more migration/test infrastructure and newer production work.

### Claude rule

Treat `current-system.md` as:

> "What existed on the audit date."

For current truth use:

1. current code
2. `git status` / current commit
3. `package.json`
4. current migration status
5. current tests
6. `next-chat-handoff.md`
7. then historical architecture docs for rationale

Never copy stale numeric counts into a new plan.

## 4.12 Minor Markdown problems in the pasted pack

The pasted Markdown has several formatting artifacts where bullets are missing around items such as:

- Bug
- URL
- status key
- "When"
- some sprint fields
- some date/dependency bullets

The revised prompt pack fixes these formatting defects.

---

# 5. Plane — what it is best at

## 5.1 Strongest areas

### A. Modern work-item UX

Plane has a modern object model around work items, types, states, labels, recurrence, cycles, modules, epics, milestones, releases, and relations.

### B. Power-K command palette

This is one of the most useful micro-interactions to study.

Plane's Power-K supports:

- global/workspace-aware search
- navigation
- creation
- workspace settings access
- keyboard shortcut discovery
- contextual task commands

From a work-item context it can change fields such as:

- state
- priority
- assignment

and copy a work-item link.

### UX benefit

Users do not repeatedly travel through menus to make small changes.

### Atlas adaptation

Atlas `⌘K` should be context-aware:

Global:
- search
- navigate
- create

Project:
- create work
- open views
- filter

Work-item:
- state
- priority
- assignee
- labels
- copy link

All commands must use Atlas permissions.

### C. Your Work

Plane's Your Work centralizes:

- assigned work
- created work
- subscribed work
- workload summary
- priority/state breakdown
- recent activity

### Atlas adaptation

Do not copy it literally.

Combine:

**Plane's centralized personal hub**
+
**Atlas's existing explainable `WorkNext` ranking**

Atlas should answer:

- What is mine?
- What is overdue?
- What is blocked?
- What should I do next?
- Why is that the recommended next item?

### D. Intake

Plane's intake pattern intentionally separates incoming requests from committed project work.

This is excellent product thinking.

### Atlas adaptation

External/internal requests should land in a triage queue before becoming canonical work.

Possible outcomes:

- accept
- decline
- request clarification
- merge duplicate
- route
- convert to work item

## 5.2 Community/forum lessons

### Reddit — edition clarity problem

A `r/selfhosted` thread asked what features differ between Plane self-hosted and cloud and users struggled to find a clear answer.

The lesson is not "Plane is bad."

The lesson is:

> Atlas should make module availability, permissions, and disabled functionality explicit. Never make a user guess whether a feature is unavailable, disabled, or broken.

### Current GitHub issues

Plane's current issue tracker also demonstrates that mature PM tools still struggle with:

- API parity
- hierarchy expand/collapse ergonomics
- date/filter edge cases
- asset/upload errors
- self-hosted edition edge cases

### Atlas opportunity

Make failures visible.

If an action fails:

- say what failed
- say whether the previous value is still safe
- offer retry
- rollback optimistic UI

---

# 6. OpenProject — what it is best at

## 6.1 Strongest areas

### A. Work packages as a generalized work object

OpenProject's work-package concept can represent multiple planning types while sharing a common planning model.

Atlas's canonical work-item strategy should follow the same principle:

> One domain, multiple types.

Not one database table per methodology.

### B. Gantt and scheduling

OpenProject is the best planning reference of the five.

Study:

- hierarchy on a timeline
- milestone representation
- drag scheduling
- duration resizing
- dependency visualization
- predecessor/successor
- lag
- project/subproject context
- manual scheduling
- automatic scheduling

### C. Time and costs

OpenProject has much more mature operational management than Plane/Vikunja/Taiga:

- time tracking
- planned versus actual concepts
- labor/cost reporting
- budgets
- cost tracking

Atlas should only add these when there is a real use case.

### D. Explicit project status

OpenProject lets users manually set project status and add context.

This supports an important Atlas principle:

> Manual project health first. Automated health should assist, not silently overwrite a manager's judgment.

## 6.2 Important limitation

OpenProject currently does **not** provide critical-path computation.

If Atlas eventually implements it, it must have:

- scheduling graph tests
- cycle detection
- float/slack calculation tests
- deterministic fixtures
- an explanation of why each item is critical

## 6.3 Atlas adaptation

Use OpenProject for:

- planning mechanics
- schedule logic
- formal project controls

Do **not** make Atlas look like OpenProject by default.

Those controls should be progressive/activatable.

---

# 7. Vikunja — what it is best at

## 7.1 Strongest areas

### A. Lightweight task management

Vikunja is a useful counterweight to enterprise PM complexity.

Its current documented project views are:

- List
- Table
- Gantt
- Kanban

### B. Quick Add

Quick Add Magic is worth studying because task capture should feel close to writing a sentence.

Atlas should support deterministic parsing for:

- due date
- time
- priority
- assignee
- label/project context

AI is unnecessary for syntax that a parser can reliably understand.

### C. Filters and saved filters

Vikunja's filter system supports cross-project saved filters and expressive conditions.

Atlas should combine:

- Vikunja simplicity
- Plane's richer saved-view concept

## 7.2 Community/forum lessons

### A. Parent/child project roll-up

This is one of the clearest user-feedback signals found in the research.

Users repeatedly ask for parent projects to automatically show descendant work.

Do not require a user to manually add every subproject to a filter.

### B. My Tasks / assigned-to-me

Community requests also highlight the value of a true cross-project personal task surface.

Atlas already has a better starting point because `WorkNext` exists.

### C. Kanban hierarchy clarity

Community feedback notes that parent/subtask relationships can become visually confusing in Kanban.

### Atlas adaptation

Cards representing children should be able to show:

- parent title
- hierarchy glyph
- optionally progress of siblings/parent

Do not show a child title in isolation when it loses meaning.

---

# 8. Leantime — what it is best at

## 8.1 Strongest areas

Leantime is the strongest reference for connecting:

**strategy → planning → execution**

Its current OSS README lists:

- Kanban
- Gantt
- Table
- List
- Calendar
- unlimited subtasks
- dependencies
- milestones
- sprint management
- time tracking
- timesheets
- dashboards/reports
- goals/metrics
- Lean Canvas
- Business Model Canvas
- SWOT
- risk analysis
- wiki/docs
- idea boards
- retrospectives
- file storage
- project permissions
- API/plugin extensibility

## 8.2 Cognitive accessibility / non-PM design

Leantime explicitly positions itself for non-project managers and says it is built with ADHD, dyslexia, and autism in mind.

Whether Atlas adopts specific accessibility patterns must be evaluated individually, but the product philosophy is useful:

- less jargon
- visible purpose
- small next steps
- progressive disclosure
- multiple planning styles
- avoid forcing formal PM concepts on every user

## 8.3 Community/forum lesson — self-host automation

A GitHub request asks for self-hosted automation integration such as n8n.

### Atlas adaptation

When automation is approved:

1. define robust outbound webhooks
2. define idempotency/retry behavior
3. expose documented API primitives
4. allow n8n/Make/Zapier-style tools to consume those primitives

Avoid provider lock-in.

---

# 9. Taiga — what it is best at

## 9.1 Strongest areas

### A. Scrum

Taiga is the strongest Scrum reference of these five.

Study:

- backlog
- priority ordering
- sprint pane
- move stories into sprint
- sprint taskboard
- story → tasks hierarchy
- burndown
- filters/search

### B. User-story swimlanes

A sprint taskboard can visually group tasks under a user story.

This gives teams both:

- story-level outcome
- task-level execution

### C. Personal density/zoom

Taiga supports multiple taskboard zoom levels.

This is a strong UX idea because density is subjective.

Atlas should support a per-user density preference:

- Compact
- Comfortable
- Expanded

### D. Scrum/Kanban same record

Taiga's model allows the same internal item to appear in Scrum and Kanban.

This directly supports Atlas's one-source-of-truth principle.

## 9.2 Community/forum validation

One community user said Taiga's Scrum visualization was a major strength, particularly:

- story swimlanes
- epics for high-level requirements
- developers breaking stories into tasks

The same user noted gaps around some custom-field filtering and epic overview details.

### Atlas adaptation

Atlas should allow configurable visible properties and filterable custom fields from day one of the custom-field/view engine.

## 9.3 Time-tracking limitation

Taiga still does not provide native time tracking.

A current community request says this is preventing at least one organization from moving entirely to Taiga.

### Atlas adaptation

Keep time tracking optional, but design the work-item model so it can be added without schema surgery.

---

# 10. Community-driven product requirements Atlas should add to its spec

These requirements came directly from gaps/friction found in the researched communities.

## 10.1 Dynamic descendant scopes

Any project view should be able to use:

```text
Current project only
Current project + direct children
Current project + all descendants
```

No manually maintained filter lists.

## 10.2 Explain disabled/unavailable functionality

Never leave users wondering:

- Is this feature broken?
- Is it disabled?
- Do I lack permission?
- Is it not included?

For unavailable functions, provide a concise reason.

## 10.3 Personal density

Views should allow a per-user density choice.

Never make one person's dense board change everyone else's board.

## 10.4 Macro/micro view without duplicated records

Leadership can view:

- project
- phase
- milestone
- epic

while execution users expand into:

- story
- task
- subtask

The underlying records stay connected.

## 10.5 Explain analytics

Every chart needs:

- definition
- formula
- included records
- excluded records
- unit
- update time

## 10.6 Do not equate execution with outcome

Show separately:

- work completion
- business/goal result

A project can complete all tasks and still fail its outcome.

## 10.7 Reliable integrations before giant automation builder

Build:

- API
- webhook events
- signing
- retries
- delivery history
- replay

before building a visually impressive but unreliable no-code automation editor.

## 10.8 True My Work

My Work is not only "assigned to me."

It should answer:

- What is mine?
- What is urgent?
- What blocks others?
- What is waiting on someone else?
- What requires approval?
- What should I do next?

---

# 11. Atlas visual design guide

## 11.1 Do not mash five visual languages together

Keep Atlas's existing Cal.com-inspired foundation.

Use competitors for interactions, not visual cloning.

## 11.2 Visual source allocation

| Atlas surface | Primary interaction reference | Secondary reference | Atlas-specific element |
|---|---|---|---|
| Global shell | Plane | Taiga | Existing Atlas shell |
| Command palette | Plane | Linear-like speed principles already in roadmap | Atlas permissions/actions |
| My Work | Plane | Vikunja community gaps | Atlas WorkNext reasons |
| Kanban | Taiga | Plane | Atlas card/status system |
| List/Table | Plane | Vikunja/OpenProject | Atlas custom fields |
| Calendar | Atlas | Leantime general calendar patterns | Existing task + marketing calendars |
| Timeline/Gantt | OpenProject | Vikunja | Atlas simplified visual language |
| Sprint planning | Taiga | Plane cycles | Atlas optional Agile module |
| Strategy/Goals | Leantime | OpenProject status | Atlas outcome/execution split |
| Intake | Plane | — | Atlas client/marketing workflows |
| Client portal | Atlas | OpenProject governance concepts | RLS-backed external access |
| Marketing | Atlas | — | Keep first-class specialized model |
| AI | Atlas | Plane as secondary | Explainable/action-safe AI |

## 11.3 App shell

Desktop:

- left sidebar
- compact topbar
- content fills available width
- context navigation within project
- collapsible sidebar
- keyboard-accessible

Mobile:

- bottom navigation for high-frequency destinations
- top bar for current context
- bottom sheets/drawers for secondary controls
- task detail can use full screen

## 11.4 Work-item cards

Default fields:

- type glyph
- title
- parent context if needed
- state
- priority
- assignee
- due date
- blocked indicator
- a small number of relevant labels

Custom fields are opt-in to the card.

## 11.5 Density

### Compact

For scanning lots of work:

- one-line title where possible
- minimal metadata
- smaller vertical padding

### Comfortable

Default Atlas view:

- title
- essential metadata
- moderate whitespace

### Expanded

For fewer cards with richer context:

- description preview
- more properties
- parent/child context

## 11.6 Task detail

Desktop:

- contextual side panel for quick inspection/edit
- canonical full-page route for deep links

Mobile:

- full-screen detail

Avoid nested modal stacks.

## 11.7 Status design

Every status must include:

- text
- icon/shape
- optional color

Never color alone.

## 11.8 Analytics

Prefer:

- a small number of meaningful widgets
- drill-down to source records
- visible filters

Avoid dashboard walls full of decorative charts.

---

# 12. Visual reference collection instructions

For future design work, provide screenshots or short recordings.

For each reference, use this template:

```md
## Visual Reference

**Product:** Plane  
**Screen:** Project work-item board  
**Viewport:** Desktop, approximately 1440px  
**Keep:** Card density, top view controls, compact metadata  
**Adapt:** Side panel interaction  
**Reject:** Plane colors and branding  
**Reason:** I want to see many tasks without the board feeling cramped
```

Best screenshots:

- 1440px+ desktop
- approximately 390px mobile
- real data rather than empty marketing mockups
- include open menus/dialogs if that interaction matters

Best recordings:

- 20–90 seconds
- task creation
- filter creation
- task detail opening/editing
- sprint planning
- Gantt scheduling
- mobile navigation

For each recording, specify:

```md
**Start state:** project board  
**Action:** create task, assign, set date  
**What I like:** no full-page navigation  
**What I dislike:** too many dropdowns
```

---

# 13. Recommended Atlas build priority after research

The priority remains mostly unchanged, but is now more explicit.

## Foundation

1. Finish design system / information architecture gaps
2. Finish single-org access-control gaps
3. Canonical work-item + custom-field engine
4. Shared filter/query/view model

## Daily usability

5. Quick capture
6. My Work + Inbox
7. Saved views
8. Better hierarchy/subtask context

## Specialized work modes

9. Agile module
10. Goals/strategy
11. Forms/intake
12. Client portal

## Advanced planning

13. Milestones/dependencies
14. Timeline/Gantt only after scope approval
15. Baselines only if required
16. Critical path only if required and independently tested

## Operational/AI

17. API/webhooks
18. Automation only after scope approval
19. Analytics/project health
20. AI weekly updates / task extraction / natural-language commands

---

# 14. What Atlas should NOT build merely for parity

Do not add a feature because one competitor has it.

Require a user/job reason.

Examples that may remain deferred:

- enterprise cost accounting
- complex resource planning
- SAFe-specific governance
- full document collaboration/CRDT
- offline-first whole application
- dozens of integrations
- full critical-path engine
- multi-tenant SaaS infrastructure

Build these only when Atlas users actually need them.

---

# 15. Source notes and links

## Atlas repository sources

- https://github.com/VanshajPoonia/projectmanagementatlas
- `CLAUDE.md`
- `FEATURES.md`
- `docs/product/build-navigation.md`
- `docs/product/next-chat-handoff.md`
- `docs/design/design-system.md`
- `DESIGN.md`
- `docs/architecture/current-system.md`

## Plane

Official:
- https://docs.plane.so/
- https://docs.plane.so/core-concepts/power-k
- https://docs.plane.so/your-work
- https://docs.plane.so/intake/overview
- https://github.com/makeplane/plane

Community / issue research:
- https://github.com/makeplane/plane/issues
- https://github.com/makeplane/plane/issues/9086
- https://github.com/makeplane/plane/issues/8980
- https://github.com/makeplane/plane/issues/8794

Reddit:
- https://www.reddit.com/r/selfhosted/comments/1fewz6v/feature_list_of_plane_selfhosted_vs_cloud/

## OpenProject

Official:
- https://www.openproject.org/docs/user-guide/work-packages/
- https://www.openproject.org/docs/user-guide/gantt-chart/
- https://www.openproject.org/docs/user-guide/gantt-chart/scheduling/
- https://www.openproject.org/docs/user-guide/gantt-chart/gantt-chart-faq/
- https://www.openproject.org/docs/installation-and-operations/

Community:
- https://community.openproject.org/

## Vikunja

Official:
- https://vikunja.io/help/views/
- https://vikunja.io/help/
- https://github.com/go-vikunja/vikunja

Community:
- https://community.vikunja.io/t/viewing-all-tasks-for-parent-project-and-sub-projects/2376
- https://community.vikunja.io/t/general-feedback-after-trying-out-vikunja/1943
- https://community.vikunja.io/t/improvement-suggestions/3732

## Leantime

Official:
- https://github.com/Leantime/leantime
- https://docs.leantime.io/

Community:
- https://github.com/Leantime/leantime/issues/2748
- Leantime Discord/community links are listed in the official repository.

## Taiga

Official/community-maintained:
- https://community.taiga.io/t/quick-intro-to-scrum-module/124
- https://community.taiga.io/t/the-5-min-kanban-module-overview/122/1
- https://community.taiga.io/t/why-is-there-no-time-tracking/152/1
- https://community.taiga.io/t/time-tracking-for-tasks-user-stories-and-epics/8592
- https://github.com/kaleidos-ventures/taiga

---

# 16. Final product thesis

Atlas should not attempt to win because it has the longest feature list.

Its strongest product thesis is:

> **A calm work-management system that connects day-to-day execution, specialized marketing operations, and explainable AI—while allowing deeper agile, strategy, planning, and client-management tools to appear only when needed.**

The product should be able to move through:

```text
Idea
→ Research
→ Goal
→ Project
→ Epic / Module
→ Work Item
→ Result
→ Review
→ Learning
```

while still allowing a normal user to create:

```text
Call client tomorrow
```

in seconds.

That tension—simple entry, deep optional capability—is the core design requirement.


---

# PART 2 — AUDITED CLAUDE CODE BUILD PROMPTS

# Atlas Project Management
# Audited Claude Code Final Build Prompt Pack

**Version:** 2026-08-13 research-audited  
**Repository:** `VanshajPoonia/projectmanagementatlas`

This pack supersedes the earlier prompt pack where the two conflict.

It is based on:

- current Atlas repository state and internal build docs
- Plane documentation and community feedback
- OpenProject documentation and community feedback
- Vikunja documentation and community feedback
- Leantime repository/docs/community feedback
- Taiga official community tutorials and feedback
- Reddit and other forum research where relevant

It does not authorize copying source code from any reference product.

---

# HOW TO USE THIS FILE

Use the **Global Session Prompt** at the start of every fresh Claude Code session.

Then use **one Build Prompt at a time**.

Do not paste all build prompts and ask Claude to implement everything at once.

Order:

1. Global Session Prompt
2. Prompt A
3. Prompt B
4. Prompt C
5. Prompt D
6. Prompt E
7. Prompt F
8. Prompt G
9. Prompt H
10. Prompt I — only after explicit scope approval
11. Prompt J
12. Prompt K — only after explicit scope approval
13. Prompt L
14. Prompt M

---

# GLOBAL SESSION PROMPT

You are continuing an existing production project-management application.

Repository:

`VanshajPoonia/projectmanagementatlas`

Do not create a new application.

Do not fork Plane, OpenProject, Vikunja, Leantime, or Taiga.

Those applications are product-design and domain-model references only.

Atlas is an existing:

- Next.js 16 App Router application
- React 19 application
- TypeScript application
- Supabase/Postgres backend
- Supabase Auth application
- Supabase Row Level Security-authorized application
- Tailwind 4 frontend
- Radix/shadcn-style component system
- Vercel deployment
- Vitest-tested codebase

The product is for one organization permanently.

Do not introduce:

- `organizations`
- tenant switching
- multi-tenant SaaS architecture
- a second authentication system
- a second permissions system
- a duplicate work-item/task engine

Business units such as SRG and AGC are business-unit dimensions, not tenants.

## SOURCE-OF-TRUTH ORDER

Repository documentation includes historical snapshots.

Use this priority when facts disagree:

1. Current code
2. Current database/migration status
3. Current tests and verification scripts
4. Current `package.json`
5. Current Git status/commit
6. `docs/product/next-chat-handoff.md`
7. `docs/product/build-navigation.md`
8. `CLAUDE.md`
9. `FEATURES.md`
10. Historical architecture docs for rationale

`docs/architecture/current-system.md` is a dated architecture audit and may contain stale counts.

Never repeat migration numbers, test counts, or infrastructure state from a document without verifying them.

## READ FIRST

Read:

- `CLAUDE.md`
- `FEATURES.md`
- `KNOWN-ISSUES.md`
- `docs/product/master-product-context.md`
- `docs/product/master-prompt.md`
- `docs/product/build-navigation.md`
- `docs/product/next-chat-handoff.md`
- `docs/design/design-system.md`
- `docs/design/information-architecture.md`
- `DESIGN.md`
- `docs/architecture/domain-map.md`
- `docs/architecture/risk-register.md`
- `package.json`

Read `docs/architecture/current-system.md` for historical architecture rationale, not for unverified current numeric facts.

Then inspect the current source files relevant to the requested feature.

## BEFORE DATABASE WORK

Run and respect the repository database guard.

Confirm the target.

Default to the development sandbox.

Never weaken:

`scripts/guard-db.mjs`

Never bypass the migration runner to save time.

Treat changes to:

- existing RLS policies
- existing constraints
- destructive schema
- production data

as high-risk until proven otherwise.

Do not automatically apply destructive changes to production.

Preserve current migration style and verification conventions.

## BEFORE IMPLEMENTATION

Run or inspect:

- current branch
- `git status`
- current tests
- TypeScript check
- migration status
- relevant RLS verification scripts
- current feature implementation

Do not implement yet.

First return:

1. Existing-system audit
2. What is already implemented
3. What is partially implemented
4. What is missing
5. What code can be reused
6. Data-model impact
7. RLS/permission impact
8. Frontend impact
9. Background/scheduled-work impact
10. Migration impact
11. Test plan
12. Proposed implementation slices
13. Risks
14. Repository-documentation conflicts
15. Exact files likely to change

Wait for my explicit approval.

After approval:

- implement in small coherent slices
- keep existing behavior working
- add tests proportionate to risk
- run relevant RLS verification harnesses
- update docs/handoff when product state changes materially

Never add a `Co-Authored-By: Claude` trailer.

Do not rewrite a working Atlas feature merely to make it resemble a competitor.

---

# GLOBAL PRODUCT PRINCIPLES

## ONE SOURCE OF TRUTH

The same underlying work item must power:

- Kanban
- List
- Table
- Calendar
- My Work
- saved views
- future Sprint
- future Timeline/Gantt
- future reporting

Do not create methodology-specific task copies.

## PROGRESSIVE DISCLOSURE

A basic user should be able to create a work item with only a title.

Advanced properties appear only when needed.

## EXPLAINABILITY

Whenever Atlas recommends, scores, blocks, or calculates something, explain why.

Examples:

- Why this is the recommended next task
- Why a date cannot move
- Why project health is At Risk
- How a burndown is calculated
- Why an action is unavailable

## USER-SPECIFIC PRESENTATION

Presentation preferences should generally be per user:

- view density
- saved personal views
- collapsed sections
- dashboard sections

Do not make one person's display preference change everyone else's workspace.

## RLS IS AUTHORITATIVE

Frontend permissions improve UX.

They are not the security boundary.

All protected data/mutations remain enforceable at the server/database layer.

## SPECIALIZED DOMAINS STAY SPECIALIZED

The marketing content calendar is a first-class Atlas domain.

Do not flatten it into generic tasks merely for architectural purity.

Connect domains through explicit relations where useful.

---

# DESIGN REFERENCE ALLOCATION

Use these references for interaction ideas:

## Plane

Study:

- Power-K
- work-item interaction density
- Your Work
- views
- intake/triage
- modern navigation

Do not assume every Plane-documented feature is part of Community Edition.

## OpenProject

Study:

- generalized work packages
- Gantt
- scheduling
- hierarchy
- milestones
- dependencies
- time/cost concepts
- project status

Do not assume critical path exists. It currently does not.

## Vikunja

Study:

- quick capture
- filters
- saved filters
- lightweight task interaction
- List/Table/Gantt/Kanban simplicity

Do not describe Calendar as a current Vikunja project view.

Do not copy its parent-project roll-up limitation; Atlas should solve it.

## Leantime

Study:

- goals
- metrics
- strategy-to-execution
- canvases
- ideas
- risks
- retrospectives
- non-project-manager UX
- cognitive-accessibility philosophy

Its current OSS README lists a broad set of these capabilities as open-source functionality.

## Taiga

Study:

- Scrum backlog
- sprint planning
- story/task swimlanes
- WIP
- Kanban
- personal board density
- Scrum/Kanban sharing the same underlying item

Do not assume native time tracking; Taiga does not currently provide it.

---

# PROMPT A — FINISH DESIGN SYSTEM AND INFORMATION ARCHITECTURE

Continue the existing Master Prompt 2.

Do not recreate the application shell.

## AUDIT FIRST

Inspect at minimum:

- `components/shell/**`
- shell route/nav model
- sidebar state
- topbar
- breadcrumbs
- command palette
- mobile bottom navigation
- design-system docs
- `app/globals.css`
- existing user/admin dashboard navigation
- module gating

Identify which original Prompt 2 requirements are:

- complete
- partial
- missing
- no longer applicable

Explicitly verify:

- Recently viewed records
- Favorite projects
- Pinned views
- My Work navigation
- Inbox navigation
- Undo-capable toasts
- Unsaved-change protection
- Dialog focus restoration
- Keyboard-only shell operation
- Accessibility automation
- 200% zoom
- 320% zoom
- Reduced motion
- Mobile navigation
- Module-aware navigation

## VISUAL DIRECTION

Keep Atlas's existing Cal.com-inspired visual system.

Do not reskin Atlas as Plane.

### Desktop

- Collapsible sidebar
- Compact topbar
- Flexible content width
- Context-specific project controls
- Strong information hierarchy
- Minimal decorative chrome

### Mobile

- Bottom nav for highest-frequency destinations
- Context controls at top
- Drawers/bottom sheets for secondary controls
- Full-screen task detail when appropriate

## COMMAND PALETTE

Take the interaction principle from Plane Power-K.

The Atlas command palette should have:

- Recent
- Navigation
- Search
- Create
- Context Actions

### Global actions

- Open project
- Open My Work
- Open Calendar
- Open Marketing
- Search work
- Create work item
- Create personal task

### Project-context actions

- Open saved view
- Create work
- Filter
- Open members/settings if permitted

### Work-item-context actions

- Change state
- Change priority
- Assign
- Add/remove label
- Copy link
- Open parent
- Open project

Register commands through the Atlas permission system.

Unavailable commands must not execute.

## UX STATES

Every major shell destination needs:

- loading
- empty
- error
- permission denied

Empty states explain:

1. what this screen is
2. why it matters
3. first useful action

## ACCESSIBILITY

Verify:

- skip link
- focus ring
- keyboard navigation
- semantic landmarks
- `aria-current`
- reduced motion
- screen-reader naming
- focus restoration
- non-color active-state cues

## DELIVERABLE

Before implementation return a gap matrix.

After approval implement missing pieces in small slices.

Do not begin Prompt B automatically.

---

# PROMPT B — FINISH SINGLE-ORG ACCESS CONTROL AND MODULE SYSTEM

Continue existing Master Prompt 3 under the permanent single-organization ruling.

Do not create multi-tenant infrastructure.

## REUSE

Audit and reuse:

- Supabase Auth
- `profiles`
- `teams`
- `team_members`
- `board_members`
- existing member/guest/client role work
- existing RLS helper functions
- `app_modules`
- user/admin dashboard module consumption
- board/task permission checks
- current RLS harnesses

## AUDIT FOR GAPS

Investigate:

- Teams UI
- Team membership UI
- Project membership UX
- Guest restrictions
- Client restrictions
- Custom role need
- Permission matrix
- Invitations only if actually needed
- Audit events
- Feature modules that exist but are not consumed at render sites
- Direct URL authorization
- Admin/super-admin edge cases

Do not build custom roles speculatively.

## CANONICAL CAPABILITY MODEL

Design a central capability vocabulary such as:

- `task.view`
- `task.create`
- `task.edit`
- `task.delete`
- `task.assign`
- `comment.create`
- `project.manage`
- `members.manage`
- `approval.respond`
- `share.external`
- `automation.manage`
- `ai.execute`
- `audit.view`

Add budget/cost capabilities only when those modules exist.

## IMPORTANT

The frontend capability layer is for consistency and UX.

Postgres RLS remains authoritative.

## UNAVAILABLE ACTION UX

Choose intentionally:

### Hide

For actions that are irrelevant to the user's role.

### Disable + explain

For actions where understanding the restriction helps.

Example:

`You can view this project, but Client access cannot edit internal tasks.`

Never allow a button to appear functional and then fail silently.

## TEST MATRIX

Test at minimum:

- regular member
- guest
- client
- admin
- super-admin
- removed member
- private board
- direct URL access
- mutation without UI
- cross-board access
- role change during an active session

## AUDIT

Every membership/role/configuration change should eventually create an audit event.

Do not expose security-sensitive internals in user-facing audit descriptions.

---

# PROMPT C — CANONICAL WORK-ITEM DOMAIN + CUSTOM FIELD ENGINE

This is the structural hinge for almost everything after it.

Do not create a parallel work-item system blindly.

## AUDIT EXISTING MODEL

Inspect:

- `tasks`
- parent/subtask implementation
- columns
- `task_statuses`
- status FK/current status logic
- assignees
- tags
- comments
- attachments
- task links/relations
- task activity
- recurrence
- priority
- dates
- board membership/RLS
- all current task creation/update code

Map every existing feature to the proposed canonical model.

Preserve existing IDs and behavior where possible.

## CANONICAL CONCEPT

One work-item domain should eventually represent types such as:

- Task
- Subtask
- Feature
- User Story
- Bug
- Request
- Deliverable
- Risk
- Decision
- Approval
- Change Request

Do not activate all types immediately.

Build the extensibility first.

## WORK-ITEM TYPE

A type definition should be able to control:

- name
- icon
- description
- allowed hierarchy
- default state
- applicable custom fields
- whether it can appear in backlog/sprint later

Do not hardcode each type into a new table.

## CUSTOM FIELD DEFINITIONS

Support an extensible field-definition model.

Initial types:

- text
- long text
- number
- date
- datetime
- checkbox
- single select
- multi-select
- person
- URL
- email
- relation

Later:

- currency
- formula

A field definition should include:

- stable ID
- name
- description
- type
- options/config
- required flag
- scope
- work-item-type applicability
- position
- archived state

## FIELD VALUES

Values must be:

- type validated
- permission checked
- queryable
- filterable
- indexable where needed

Do not make the whole field engine one uncontrolled JSON blob without a documented reason.

## STATE MODEL

There must be one authoritative state relationship.

Do not regress to state-name string heuristics.

A state should support:

- stable key
- display label
- normalized category
- position
- icon
- semantic color
- closed/open meaning

Normalized categories can be:

- backlog
- planned
- started
- completed
- cancelled

## HIERARCHY

Support parent/child without duplicate records.

Prevent:

- self parent
- cycles
- impossible ancestry changes

## RELATIONS

Separate hierarchy from relations.

Design for:

- blocks
- blocked by
- related to
- duplicate of
- duplicated by
- precedes
- follows

Do not use parent/child to represent blocking.

## ACTIVITY

Activity must be structured enough to answer:

- who
- what property
- previous value
- new value
- when

Do not rely only on rendered text.

## CREATION UX

Default:

`Title`

Optional details appear progressively.

## DETAIL UX

Desktop:

- side panel for contextual editing
- canonical full-page URL for deep linking

Mobile:

- full-screen detail

Support:

- inline edit
- autosave where safe
- optimistic UI with rollback
- copy link
- duplicate
- move
- archive
- restore

## MIGRATION STRATEGY

Favor additive bridge migrations.

Do not big-bang rewrite every existing task surface.

Provide:

- compatibility phase
- backfill strategy
- rollback plan
- verification queries
- RLS tests

---

# PROMPT D — QUICK CAPTURE, BULK CREATION, RECURRENCE, AND RELATIONS

Build only after Prompt C's relevant foundation is stable.

Atlas already has recurrence-related implementation.

Audit and preserve it.

## QUICK CAPTURE

Inspired primarily by Vikunja's low-friction capture.

Example:

`Prepare bid package tomorrow 3pm high priority @Bobby #Atlas`

Parse deterministically when possible:

- title
- date
- time
- priority
- assignee
- label/project context

Do not invoke an LLM for deterministic syntax.

When ambiguous:

- show interpreted fields
- show absolute date
- allow correction before save

Never silently discard user text.

## MULTI-CREATE

Allow paste:

```text
Prepare proposal
Call client
Send estimate
```

Preview before creation.

Optionally support indentation:

```text
Launch campaign
  Draft Facebook post
  Draft Instagram post
```

as parent/child creation.

Do not infer hierarchy silently when indentation is ambiguous.

## RECURRENCE

Unify existing Atlas recurrence behavior.

Support/plan for:

- daily
- weekly
- selected weekdays
- monthly
- yearly
- every N units
- end date
- occurrence count
- after completion

Clearly distinguish:

- recurrence rule/template
- generated occurrence

Generated work must be idempotent.

Retrying a scheduled job must not duplicate an occurrence.

Editing a recurrence must not rewrite completed history silently.

## REMINDERS

Design for multiple per-user reminders.

A reminder is not necessarily a global task property.

## BULK OPERATIONS

Support a safe batch architecture for:

- assign
- state
- priority
- label
- date
- move
- archive

Show:

- number affected
- preview for destructive changes
- partial failures
- retry behavior

---

# PROMPT E — SHARED QUERY ENGINE, FILTERS, SAVED VIEWS, LIST/TABLE/KANBAN/CALENDAR

This is not "build four separate views."

Build one query/configuration model that renders multiple layouts.

## RULE

The view is not the data.

## FIRST AUDIT

Inspect existing:

- board queries
- calendar queries
- reports filters
- local filter state
- server/client filtering
- search
- task subscriptions
- pagination/loading behavior

Find duplicated filter logic.

## COMMON VIEW CONFIG

Create one normalized configuration:

- context/project scope
- include descendant level
- filters
- sort
- group
- subgroup
- visible fields
- field order
- density
- hierarchy behavior
- completed-item behavior

## DESCENDANT SCOPE

Explicitly solve the recurring Vikunja community problem.

Support:

```text
Current project only
Current + direct children
Current + all descendants
```

New child projects must automatically become part of an all-descendants view.

Do not store a static list of every descendant ID as the user-facing concept.

## FILTER MODEL

Visual operators:

- is
- is not
- contains
- does not contain
- before
- after
- between
- empty
- not empty
- current user

Support AND/OR.

Only add arbitrary nested boolean groups if the UI can explain them.

## SAVED VIEWS

A saved view stores:

- layout
- scope
- descendant behavior
- filters
- sort
- grouping
- visible fields
- density

Scopes:

- personal
- shared

Public/external sharing waits for client-sharing permissions.

## LIST

Optimize for scanability.

Support:

- hierarchy
- inline editing
- selected visible fields
- bulk select

## TABLE

Support:

- resize columns
- reorder columns
- sort
- inline edit
- sticky identifier/title
- bulk selection
- virtualization

## KANBAN

Combine Atlas's existing board with the best Taiga/Plane patterns:

- configurable grouping
- WIP warning/enforcement later
- collapse columns
- quick add
- blocked indicator
- parent context
- visible field settings
- density
- keyboard-accessible move alternative
- optimistic drag with rollback

## DENSITY

Per user:

- Compact
- Comfortable
- Expanded

Do not make this shared workspace state.

## CALENDAR

Calendar is an Atlas capability; do not attribute it to Vikunja.

Preserve existing task calendar behavior.

Plan for:

- Month
- Week
- Day
- unscheduled work tray
- drag reschedule

Do not merge the specialized marketing calendar into generic task calendar storage.

---

# PROMPT F — MY WORK, WORKNEXT, INBOX, AND NOTIFICATION CONTROL

Atlas already has `WorkNext`.

Do not replace it with a generic dashboard.

Use Plane's centralized Your Work pattern as a secondary reference.

## MY WORK GOAL

Answer:

- What belongs to me?
- What needs attention?
- What should I do next?
- What am I waiting on?
- What am I blocking?

## SECTIONS

Candidate sections:

- Recommended next
- Today
- Overdue
- Upcoming
- Assigned to me
- Blocking others
- Blocked by others
- Waiting on approval
- Personal tasks
- Recently viewed

Allow section order/visibility to become a personal preference.

## WORKNEXT

Keep the score/recommendation deterministic first.

Possible reasons:

- overdue
- due today
- due soon
- high priority
- blocks other work
- milestone pressure
- client waiting
- approval waiting

Display reasons.

Do not show an unexplained score like:

`AI priority 93`

If AI later summarizes, the underlying deterministic signals remain visible.

## INBOX

Start with two clear buckets:

- Action Required
- Updates

Avoid overclassification.

### Action Required

Examples:

- assignment requiring attention
- mention
- approval request
- client request
- blocker requiring user action
- automation failure requiring action

### Update

Examples:

- followed work changed
- project status updated
- relevant work completed

## CONTROLS

Support:

- mark read
- mark unread
- follow
- unfollow
- mute item
- mute project
- snooze
- digest preferences later

Deduplicate bursts of related events.

## DEEP LINKS

A notification should open the exact context when possible:

- comment
- field
- task
- approval
- request

---

# PROMPT G — OPTIONAL AGILE MODE

This module must be optional.

Do not force Scrum language on:

- marketing
- contracting
- real estate
- finance
- operations

Use the same canonical work items.

## PRIMARY REFERENCE

Taiga.

Secondary reference:

Plane cycles.

## BACKLOG

Support:

- prioritized ordering
- quick create
- search
- filters
- bulk selection
- assign to sprint/cycle
- epic/feature grouping

## CYCLE / SPRINT

Use one underlying model.

UI terminology is project-configurable:

- Cycle
- Sprint

Fields:

- title
- goal
- start date
- end date
- owner
- state

## SPRINT PLANNING

Display:

- backlog
- active/upcoming sprint
- current commitment
- estimate/capacity signal

Allow drag and explicit menu actions.

Warn when over capacity.

Do not block by default unless configured.

## SPRINT TASKBOARD

Study Taiga's story swimlane model.

A user story can form a horizontal/grouped context containing its tasks.

Tasks remain canonical work items.

## DENSITY

Use the Taiga insight:

personal view density.

Atlas options:

- Compact
- Comfortable
- Expanded

## WIP

Support a WIP limit per appropriate state/column.

Mode:

- warning
- enforcement

## METRICS

Start with:

- committed
- completed
- carryover
- scope added/removed
- burndown
- burn-up
- velocity

Every chart must expose:

- definition
- formula
- unit
- included records
- excluded records
- last updated

Historical sprint data must not silently change when current project structure changes.

## SCRUM + KANBAN

Follow Taiga's strongest architectural idea:

The same underlying item can be represented in Scrum and Kanban.

Never copy the task to make it appear in a second methodology.

## TIME TRACKING

Do not assume Taiga provides native time tracking.

Atlas time tracking, if later needed, is an independent optional module.

---

# PROMPT H — GOALS, PURPOSE, IDEAS, STRATEGY, AND RETROSPECTIVES

Primary reference:

Leantime.

Keep it optional and non-jargony.

## PROJECT PURPOSE

Allow a project to optionally define:

- problem statement
- purpose
- intended outcome
- stakeholders
- target user/customer
- success criteria
- constraints
- non-goals

Do not require these fields to create a board.

## GOALS

Goal fields:

- title
- owner
- timeframe
- metric
- starting value
- current value
- target value
- unit
- confidence
- health

Links:

```text
Goal
→ Project
→ Milestone
→ Work
```

## CRITICAL DISTINCTION

Display separately:

### Execution progress

How much planned work is complete?

### Outcome progress

Did the target business/user metric improve?

Never imply they are the same.

## IDEA PIPELINE

Optional states:

- Captured
- Reviewing
- Researching
- Validated
- Planned
- Rejected
- Archived

Idea fields:

- problem
- target user/customer
- evidence
- expected value
- impact
- effort
- confidence

Validated ideas may convert to:

- project
- feature
- work item

Preserve research/history.

## STRATEGY TOOLS

Only add canvases that users will actually use.

Potential tools:

- SWOT
- Lean Canvas
- stakeholder map
- impact/effort

Do not build a whiteboard engine merely to claim parity.

## RETROSPECTIVES

Optional.

Support:

- simple templates
- voting
- grouping
- follow-up actions
- conversion of actions to canonical work items

If anonymous mode is added, enforce anonymity server-side.

---

# PROMPT I — MILESTONES, DEPENDENCIES, TIMELINE, GANTT, BASELINES

STOP BEFORE IMPLEMENTATION.

The repository contains older documentation that explicitly deferred Gantt/timeline while later master planning includes it.

Before code:

1. Find the exact current conflicting statements.
2. Show them to me.
3. Explain architectural/product cost.
4. Ask for explicit scope approval.
5. Only then update the roadmap/spec.

Do not interpret this prompt as automatic approval.

## PRIMARY REFERENCE

OpenProject.

## MILESTONES FIRST

Implement before advanced Gantt.

Fields:

- title
- owner
- due date
- state
- progress
- related project
- related goal
- related work

## DEPENDENCIES

Initial semantic relations:

- blocks
- blocked by
- precedes
- follows

Advanced scheduler later may support:

- Finish-to-Start
- Start-to-Start
- Finish-to-Finish
- Start-to-Finish
- lag

Prevent invalid cycles where scheduling requires a DAG.

## TIMELINE

First useful version:

- horizontal dates
- hierarchy
- work bars
- milestones
- today marker
- zoom
- collapse hierarchy
- drag reschedule
- resize duration

## MACRO/MICRO MODE

A manager should be able to display:

- phase
- epic/module
- milestone
- major deliverable

without rendering every subtask.

Expansion reveals detail.

Do not duplicate records to create the high-level plan.

## MANUAL / AUTOMATIC SCHEDULING

Study OpenProject's distinction.

### Manual

User owns dates.

### Automatic

Dates may be constrained by relationships.

If Atlas moves or refuses to move a date, explain why.

## BASELINE

If approved later:

Save named snapshots of selected planning properties.

Possible comparison:

- start
- due
- duration
- progress
- estimate
- scope

## CRITICAL PATH

OpenProject currently does not provide this.

Critical path would be a new Atlas feature.

Do not implement until explicitly required.

If required:

- formalize graph assumptions
- calculate earliest/latest times
- calculate float/slack
- test cycles/errors
- add deterministic fixtures
- explain criticality in UI

---

# PROMPT J — FORMS, INTAKE, TRIAGE, AND CLIENT PORTAL

Primary intake reference:

Plane.

## INTAKE PRINCIPLE

Incoming requests are not automatically committed work.

They enter triage.

## CHANNELS

Potential channels:

- internal form
- public form
- client portal
- email
- AI/message extraction
- API later

Implement only approved channels.

## TRIAGE ACTIONS

- accept
- decline
- request information
- merge duplicate
- route to project
- assign owner
- set priority
- convert to work item

Preserve original request context after conversion.

## FORM BUILDER

Reuse the custom-field engine where practical.

Do not create a second incompatible field-definition model.

Initial form fields:

- text
- textarea
- number
- date
- select
- checkbox
- file

Later:

- conditional fields

## PUBLIC FORM SECURITY

Add:

- validation
- rate limiting
- abuse controls
- attachment restrictions
- server-side routing
- RLS-safe insertion

Do not allow an unauthenticated form to write arbitrary task properties.

## CLIENT PORTAL

Use existing Atlas client/board access concepts.

Clients may see only explicitly permitted information such as:

- project summary
- approved status
- milestones
- deliverables
- client requests
- shared files
- approvals

Clients must not see:

- internal comments
- internal costs
- private risks
- other clients
- internal drafts
- restricted attachments

Test at RLS level.

UI hiding is not security.

---

# PROMPT K — API, WEBHOOKS, AUTOMATION, AND SELECTED INTEGRATIONS

STOP BEFORE IMPLEMENTATION.

The repository contains older decisions deferring a generic automation engine.

Surface the conflict and ask for explicit scope approval.

## BUILD IN THIS ORDER

1. Event model
2. API boundaries
3. Outbound webhooks
4. Reliability
5. Selected integrations
6. Generic automation UI only if still justified

Do not start with a giant drag-and-drop automation builder.

## WEBHOOK EVENT

Include:

- unique event ID
- event type
- timestamp
- workspace/project/entity identifiers
- actor where appropriate
- versioned payload schema

## DELIVERY

Support:

- signing secret
- attempt number
- response status
- duration
- retries
- exponential backoff
- dead/failed state
- replay
- secret rotation

## IDEMPOTENCY

Mutating integrations/automations must support idempotency.

Retry must not duplicate:

- tasks
- comments
- approvals
- notifications

## AUTOMATION MODEL

If approved:

```text
Trigger
→ Conditions
→ Actions
```

Potential triggers:

- work created
- state changed
- due date reached
- overdue
- approval completed
- form submitted
- sprint completed
- scheduled time

Potential conditions:

- project
- type
- state
- priority
- assignee
- label
- custom field

Potential actions:

- assign
- update field
- move state
- create child
- create work
- notify
- request approval
- call webhook

Detect loops.

## SELF-HOST / OPEN INTEGRATION PRINCIPLE

Leantime community feedback shows demand for self-hostable automation such as n8n.

Design Atlas interfaces so:

- n8n
- Make
- Zapier

can use the same API/webhook layer.

Do not hardwire Atlas to one provider.

## INTEGRATIONS

Prioritize real Atlas users.

Potential early integrations:

- Google Calendar
- Slack
- email intake

Do not build a large marketplace before core product workflows are complete.

---

# PROMPT L — ANALYTICS, PROJECT HEALTH, AND DATA-AWARE AI

Atlas already has a data-aware AI assistant.

Extend it rather than replacing it.

## PROJECT HEALTH

Start explainable and manual-first.

Possible statuses:

- On Track
- At Risk
- Off Track
- On Hold
- Completed

Possible signals:

- overdue milestone
- blocked critical work
- blocked duration
- scope growth
- repeated missed commitments
- unresolved high risk
- capacity problem later

Always expose the contributing signals.

Allow manual override with a note.

Do not let an LLM silently determine official project health.

## ANALYTICS CONTRACT

Every metric needs:

- name
- business meaning
- formula
- unit
- source records
- included records
- excluded records
- time zone
- update time
- drill-down behavior

## DASHBOARD RULE

Do not create chart wallpaper.

Each widget should help answer a question.

Examples:

- What is late?
- What is blocked?
- What changed?
- Is the sprint scope growing?
- Are milestones slipping?
- Is marketing content being completed?
- Are goals improving?

## AI WEEKLY UPDATE

This should become a signature Atlas feature.

Generate a **draft**, grounded in current Atlas records:

- What shipped
- What slipped
- What's next
- What's blocked
- What needs a decision

Provide links/evidence.

Never auto-publish or auto-email without an explicit user action.

## MEETING / MESSAGE → WORK

AI may propose tasks from:

- meeting notes
- chat
- uploaded documents

Show a structured preview:

- title
- description
- project
- assignee
- date
- type

The user approves before creation.

## NATURAL-LANGUAGE SEARCH / COMMANDS

Examples:

- `Show overdue Atlas tasks assigned to Bobby`
- `What is blocking the marketing campaign?`
- `What changed this week?`

Use the LLM to interpret intent.

Use Atlas's permission-scoped tools/database queries as the source of truth.

## AI ACTION SAFETY

Every AI mutation:

- uses normal permissions
- validates structured output
- shows proposed changes
- allows edit
- requires confirmation for material changes
- logs activity/audit
- never bypasses RLS

Do not expose records to the model that the current user cannot access.

---

# PROMPT M — FINAL UX, ACCESSIBILITY, PERFORMANCE, SECURITY, AND RELEASE AUDIT

This is not a cosmetic pass.

Test the product as a complete system.

## USER TYPES

Verify journeys for:

- member
- admin
- super-admin
- guest
- client

## CORE JOURNEYS

Test:

- create work
- edit work
- assign
- complete
- child work
- comment
- attachment
- recurrence
- filter
- saved view
- My Work
- Inbox
- command palette
- quick capture
- notification deep link
- mobile
- permission loss
- permission gain

Include new modules only if built.

## EMPTY STATES

Every major screen should explain:

- what it is
- why it matters
- first action

## ERROR STATES

Every mutation error should tell the user:

- what failed
- whether current data is safe
- whether it can be retried
- how to retry

Do not silently swallow attachment, permission, network, or background-job errors.

## UNDO

Use undo where safe:

- archive
- simple state change
- drag/move
- simple bulk edits

Use confirmation for truly destructive actions.

## ACCESSIBILITY

Verify:

- keyboard-only
- focus visibility
- screen-reader names
- error associations
- non-color meaning
- reduced motion
- 200% zoom
- 320% zoom
- accessible alternative to drag/drop
- dialog focus restoration

## MOBILE

Prioritize:

- My Work
- Inbox
- Search
- Work detail
- Create
- Comment
- Approvals when built
- Marketing essentials

Do not shrink a complex desktop Gantt until it becomes unusable.

A companion mobile UX can intentionally expose fewer planning controls.

## PERFORMANCE

Use realistic fixtures.

Test:

- 1,000+ work items
- large board
- large table
- many comments
- custom fields
- hierarchy
- cross-project saved view

Use when appropriate:

- pagination
- cursor loading
- virtualization
- indexes
- selective Supabase subscriptions
- server-side filtering

Do not fetch the whole organization to the browser and filter everything locally.

## SECURITY

Re-run relevant RLS harnesses.

Check:

- direct URL access
- stale sessions
- removed membership
- guest/client leakage
- signed/private attachments
- public sharing
- form intake
- AI tool permissions
- webhook secrets if built

## RELEASE GATE

Before marking a phase complete:

- tests pass
- TypeScript passes
- relevant RLS harnesses pass
- production build passes
- migration status is understood
- mobile verified
- light/dark verified
- accessibility checked
- limitations documented
- roadmap updated
- handoff updated

No placeholder, disabled button, or TODO counts as a complete feature.

---

# FINAL PRODUCT EXPERIENCE

Atlas should not look or behave like five applications glued together.

Default everyday experience should remain small:

- My Work
- Projects
- Calendar
- Marketing
- Inbox
- AI

Advanced modules appear only when needed:

- Agile
- Strategy
- Goals
- Timeline
- Intake
- Clients
- Automation
- Governance

The product should support both:

```text
Call client tomorrow
```

and, when activated:

```text
Goal
→ Initiative
→ Project
→ Epic
→ Story
→ Task
→ Milestone
→ Outcome
```

without forcing the second model onto a user who only needs the first.

Atlas's differentiation should remain:

1. specialized marketing/content execution
2. data-aware AI grounded in actual work
3. explainable "what should I do next?"
4. optional depth rather than mandatory complexity
