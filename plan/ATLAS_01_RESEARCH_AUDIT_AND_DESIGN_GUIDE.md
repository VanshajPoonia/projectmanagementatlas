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
