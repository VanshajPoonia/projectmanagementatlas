# Master Prompt — the 10-prompt product build spine

This is the canonical source spec for building the unified product, supplied by the repository
owner on 2026-07-23. It is stored **verbatim**. It is the *index*; the governing charter above it
(the framework the owner calls the "Master Product Context" — sections A–F) is stored verbatim at
[`master-product-context.md`](./master-product-context.md), including two reconciliation rulings
that override parts of the text below (no Plane; single organization, not multi-tenant SaaS — see
that file's banner). When the tenancy plan in `CLAUDE.md` or the roadmap in `FEATURES.md` disagree
with this document on *what* to build, this document is the index and they are the *execution
detail*. See [`build-navigation.md`](./build-navigation.md) for the mapping between the three.

> **Note on PROMPT 1's framing:** the master prompt was written assuming a **Plane Community
> Edition** foundation. The repository audit (PROMPT 1) proved there is **no Plane here** — it is a
> greenfield Next.js 16 + React 19 + Supabase app. `docs/architecture/adr-001-extension-strategy.md`
> reinterpreted the four options for the actual repo and chose **Option 4: keep building on the
> existing app, no Plane**. Treat all "fork / sidecar / upstream / licensing-exposure" language
> below as *already resolved* — do not re-open it.
>
> **Note on PROMPT 3's framing (owner ruling, 2026-07-24):** PROMPT 3 below is titled "Organizations,
> Workspaces, Teams, Roles, and Feature Modules" and describes multi-tenant SaaS scaffolding
> (Organizations plural, workspace switching, bulk member import for onboarding new tenants). **This
> product is built for exactly one organization, permanently — it is not a multi-tenant SaaS
> product.** Read every "Organizations" (plural) / tenant-isolation item in PROMPT 3 as **N/A**.
> Teams, Members, Guests, Clients, workspace/project-level roles, custom roles, the permission
> matrix, and module activation still apply, scoped **within** the single existing organization. See
> `CLAUDE.md` for the concrete single-org plan this produces.

Global rule that governs every prompt: **Use the Master Product Context. Analyze and scope-check
before implementing. Do not begin feature implementation until the audit/plan for that prompt is
accepted. Do not break existing behavior.**

---

## PROMPT 1 — REPOSITORY AUDIT AND ARCHITECTURE DECISION

Use the Master Product Context. Do not implement product features yet. Perform a complete repository
and architecture audit.

**OBJECTIVE** — Determine the safest and most maintainable way to build the unified product using the
current repository.

**AUDIT** — Inspect: Repository structure; Git remotes and branches; Plane version or upstream
commit; Frontend applications; Backend applications; Database; Authentication; Authorization;
Work-item model; API routes; Webhooks; Background workers; Scheduled jobs; Cache; Search; File
storage; Email; Real-time collaboration; Feature flags; Existing tests; CI/CD; Docker and local
development; Existing custom code; Existing migrations; Licensing files.

**Create:** `docs/architecture/current-system.md`; `docs/architecture/adr-001-extension-strategy.md`;
`docs/architecture/upstream-boundary.md`; `docs/architecture/domain-map.md`;
`docs/architecture/risk-register.md`; `docs/development/local-setup.md`.

**The ADR must compare:** (1) API-only extension; (2) Shallow Plane fork; (3) Plane plus sidecar
service; (4) Greenfield replacement. **Score each on:** Delivery effort; Upgrade difficulty; UX
control; Authentication complexity; Permission complexity; Data consistency; API coverage;
Operational complexity; Testing complexity; Licensing review exposure. **Recommend one approach.**

Do not assume that a separately built frontend is automatically preferable. Verify the installed APIs
and feature availability directly in code. Document any mismatch between product documentation and
actual code.

Add a script or documented command that verifies: Database connection; Cache connection; Queue
connection; Object-storage connection; API health; Worker health; Search health when enabled.

**DEFINITION OF DONE** — The system can be launched locally from documented instructions. All
important services are identified. The upstream boundary is explicit. The recommended extension
strategy is justified. No feature implementation has begun. No existing behavior has been broken.

---

## PROMPT 2 — DESIGN SYSTEM AND INFORMATION ARCHITECTURE

Use the Master Product Context and approved architecture ADR.

**OBJECTIVE** — Create the navigational and visual foundation that can support both simple task
management and advanced project controls without overwhelming users.

**MACRO FEATURES** — Global application shell; Workspace navigation; Team navigation; Project
navigation; Global search entry; Command palette; Personal inbox; Personal work area; Responsive
navigation; Module activation system.

**MICRO FEATURES** — Collapsible sidebar; Icon-only sidebar state; Recently viewed records; Favorite
projects; Pinned views; Breadcrumbs; Back and forward navigation; Context-preserving tabs; Keyboard
shortcut hints; Focus restoration after modal closure; Skeleton loading; Empty states;
Permission-denied states; Unsaved-change warnings; Toasts with undo; Mobile bottom navigation for
essential areas.

**UX OUTCOME** — New users should see a calm product with Projects, My Work, Inbox, and Search.
Advanced users should be able to activate Strategy, Agile, Planning, Time, Cost, Clients, and
Automation modules. Do not expose every module by default.

**Create:** Information-architecture map; Route map; Navigation state model; Responsive behavior
specification; Component inventory; Design tokens; Typography scale; Spacing scale; Status icon
rules; Accessibility rules; Dark and light theme support.

Implement a reusable design system or extend the repository's existing one. Do not replace
established components without a measured reason.

**ACCEPTANCE CRITERIA** — Navigation works with keyboard only. Current location is always
understandable. The sidebar state persists per user. Users can reach any recently opened item
quickly. Mobile navigation exposes only essential actions. Status is never communicated by color
alone. Layout works at 320%, 200%, and normal zoom. Reduced-motion preference is respected.
Automated accessibility checks cover primary navigation.

---

## PROMPT 3 — ORGANIZATIONS, WORKSPACES, TEAMS, ROLES, AND FEATURE MODULES

Use the Master Product Context and existing identity model.

**OBJECTIVE** — Create a scalable tenancy and permission system without duplicating existing Plane
authentication.

**MACRO FEATURES** — Organizations; Workspaces; Teams; Members; Guests; Clients; Workspace roles;
Project roles; Custom roles; Feature-module activation.

**MICRO FEATURES** — Invite by email; Resend invitation; Revoke invitation; Invite expiration; Bulk
member import; Team membership; Default team; Workspace switching; Project membership; Guest project
restrictions; Client portal restrictions; Role preview; Permission explanation; Removal
confirmation; Ownership transfer; Suspended-user handling.

**Create a permission matrix for:** View; Create; Edit; Delete; Comment; Assign; Manage members;
Manage workflow; Manage budget; View costs; Approve; Export; Share publicly; Configure automation;
Use AI actions; View audit log.

**Module activation should support:** Agile; Timeline and Gantt; Goals and Strategy; Ideas and
Research; Meetings; Risks; Approvals; Time Tracking; Workload; Budgets; Clients; Automation; AI.

**UX OUTCOME** — A small team should not encounter enterprise configuration during onboarding. A
regulated team should be able to activate precise controls.

**ACCEPTANCE CRITERIA** — Workspace isolation is tested. Client users cannot access internal comments
or costs. Guest access is project-scoped. Permission checks occur server-side. The interface hides
unavailable actions but the server still rejects unauthorized calls. Ownership cannot be accidentally
orphaned. Every membership and role change creates an audit event.

---

## PROMPT 4 — CANONICAL WORK-ITEM DOMAIN

Use the Master Product Context.

**OBJECTIVE** — Create one dependable work-item model that powers every methodology and view.

**MACRO FEATURES** — Configurable work-item types; Parent-child hierarchy; Relations; Custom states;
Custom priorities; Custom fields; Assignment; Scheduling; Estimates; Progress; Comments; Attachments;
History.

**CORE FIELDS** — Stable identifier; Human-readable project key and sequence; Type; Title; Rich-text
description; State; Priority; Creator; Assignees; Collaborators; Start date; Due date; Completion
date; Estimate; Progress; Parent; Project; Team; Cycle; Module or epic; Milestone; Release; Labels;
Custom-field values; Created and updated timestamps; Archived state.

**RELATION TYPES** — Parent of; Child of; Blocks; Blocked by; Precedes; Follows; Related to;
Duplicate of; Duplicated by; Implements; Implemented by.

**MICRO UX** — Quick-create modal; Full-page detail; Side-panel detail; Draft preservation; Inline
field editing; Autosave; Field-level validation; Activity timeline; Copy direct link; Duplicate
item; Move to another project; Convert type; Add child; Add relation; Subscribe; Archive; Restore;
Delete with recoverable trash period.

**UX OUTCOME** — A user can create a basic task using only a title. Advanced fields appear only when
needed.

**ACCEPTANCE CRITERIA** — The same work item appears identically across every view. Circular parent
and dependency relationships are prevented. Moving an item preserves history. Type conversion
explains incompatible fields. Optimistic updates roll back on server failure. Drafts survive
accidental closure. Activity history identifies actor, time, field, previous value, and new value.
All mutations are permission checked and audited.

---

## PROMPT 5 — QUICK ENTRY, BULK OPERATIONS, AND NATURAL-LANGUAGE PARSING

Use the canonical Work Item domain.

**OBJECTIVE** — Make task capture and high-volume editing exceptionally fast.

**QUICK ENTRY** — Support input such as: "Prepare client proposal tomorrow 3pm high priority assign
Alex in Marketing every Monday". Parse: Title; Date; Time; Priority; Assignee; Project; Labels;
Recurrence. Do not require AI for deterministic parsing. Use transparent parsing rules and show a
preview before submission when ambiguity exists.

**MICRO FEATURES** — Global quick-add shortcut; Multi-line task entry; Indented subtasks; Paste
checklist; Duplicate detection warning; Recently used assignees; Recently used projects; Create and
continue; Create and open; Mobile quick capture; Voice-input compatibility.

**BULK OPERATIONS** — Assign; Change status; Change priority; Add or remove labels; Move project; Add
to cycle; Add to milestone; Set date; Shift dates; Archive; Delete; Export.

**UX OUTCOME** — Common capture should take seconds, while ambiguous fields remain visible and
correctable.

**ACCEPTANCE CRITERIA** — Parsing never silently removes user text. Ambiguous dates show the
interpreted absolute date. Bulk changes show affected-item count. Destructive bulk actions require
confirmation. Bulk jobs are resumable and idempotent. Partial failures produce a downloadable error
report. Bulk edits create auditable per-item history.

---

## PROMPT 6 — VIEW ENGINE, FILTERS, GROUPING, AND SAVED VIEWS

Use the canonical Work Item domain.

**OBJECTIVE** — Create multiple representations of one query rather than separate data systems.

**LAYOUTS** — List; Table; Kanban; Calendar; Timeline; Gantt.

**COMMON VIEW CONFIGURATION** — Filter; Sort; Group; Subgroup; Visible fields; Field order; Row
density; Show or hide subtasks; Show completed; Date range; Color method; View permissions; Default
view; Share state.

**FILTER ENGINE** — Support: AND; OR; Nested groups; Equals; Does not equal; Contains; Does not
contain; Before; After; Between; Is empty; Is not empty; Current user; Relative dates; Parent and
descendant relationships.

**MICRO FEATURES** — Human-readable builder; Optional advanced query syntax; Filter chips; Clear
individual filter; Clear all; Save as view; Duplicate view; Personal view; Team view; Public
read-only view; URL-preserved configuration; View templates; Recent views; Favorite views.

**KANBAN** — Configurable columns; WIP limits; Swimlanes; Collapsible columns; Card density; Visible
card fields; Card aging; Blocked indicator; Drag with optimistic rollback; Filter-driven boards;
Manual-order boards.

**CALENDAR** — Month; Week; Day; Unscheduled sidebar; Drag to reschedule; Multi-day work; Milestones;
Personal and project layers.

**ACCEPTANCE CRITERIA** — Updating a record in one view updates all others. Saved views preserve
every configuration. Personal views cannot overwrite shared views. Public views expose only approved
fields. Large boards use virtualization. Dragging respects permissions and workflow rules. Filter
results are identical between server and client.

---

## PROMPT 7 — MY WORK, INBOX, NOTIFICATIONS, AND COMMAND PALETTE

Use the Master Product Context.

**OBJECTIVE** — Give every user one dependable place to understand what requires attention.

**MY WORK SECTIONS** — Today; Overdue; Upcoming; Assigned to me; Created by me; Subscribed; Waiting
for my approval; Blocked by others; Blocking others; Unscheduled; Personal tasks; Recently viewed.
Allow a user to customize which sections appear.

**INBOX CATEGORIES** — Action required; Important updates; General activity.

**NOTIFICATION EVENTS** — Assignment; Mention; Reply; Approval request; Approval result; Due-date
reminder; Overdue work; Dependency unblocked; Workflow rejection; Project-health change; Automation
failure; Client request; Shared-item access.

**DELIVERY** — In-app; Email; Push; Daily digest; Weekly digest.

**MICRO FEATURES** — Mark read; Mark unread; Snooze; Mute item; Mute project; Follow item; Unfollow
item; Batch clear; Jump to exact changed field or comment; Notification preference matrix.

**COMMAND PALETTE** — Support: Search; Navigate; Create; Change status; Assign; Add label; Open
recent item; Open view; Run permitted automation.

**ACCEPTANCE CRITERIA** — Notification delivery is deduplicated. Unread counts remain consistent
across devices. Muted items do not produce forbidden channels. Digests group related changes. The
command palette is keyboard accessible. Search results respect permissions. Personal dashboard
queries remain performant at scale.

---

## PROMPT 8 — AGILE DELIVERY: BACKLOG, CYCLES, SPRINTS, KANBAN, AND METRICS

Use one Cycle entity that may be labelled "Sprint" in Scrum-enabled projects.

**OBJECTIVE** — Support disciplined agile delivery without creating a separate task system.

**FEATURES** — Product backlog; Backlog buckets; Prioritized ordering; Cycles or sprints; Sprint
goal; Start and end dates; Capacity; Committed work; Carryover; Sprint board; Kanban board; WIP
limits; Swimlanes; Story points; T-shirt sizes; Hour estimates; Custom estimate scales; Velocity;
Burndown; Burn-up; Scope-change reporting; Sprint review; Retrospective link.

**MICRO FEATURES** — Drag backlog item into sprint; Multi-select sprint assignment; Start sprint;
Complete sprint; Move incomplete work; Warn about capacity; Warn about overlapping cycles; Lock
historical sprint metrics; Explain metric calculation; Toggle story-level or task-level progress;
Display added and removed scope; Personal card-density preference.

**UX OUTCOME** — Teams should understand why a metric changed rather than simply seeing a graph.

**ACCEPTANCE CRITERIA** — Historical sprint data cannot be silently rewritten. Scope added after
sprint start is visible. A chart explains its calculation and included work. Teams can choose
story-point or task-completion progress. WIP-limit behavior is configurable as warning or
enforcement. Carryover preserves history. Sprint completion cannot lose unresolved work. Scrum and
Kanban use the canonical Work Item model.

---

## PROMPT 9 — TIMELINE, GANTT, DEPENDENCIES, MILESTONES, AND BASELINES

**OBJECTIVE** — Connect executive-level planning with team-level work.

**MACRO FEATURES** — Portfolio timeline; Project timeline; Multi-project Gantt; Milestones; Phases;
Releases; Cross-project dependencies; Baselines; Schedule variance.

**MICRO FEATURES** — Drag task; Resize duration; Expand hierarchy; Collapse hierarchy; Zoom; Today
line; Weekend and holiday display; Working calendars; Manual scheduling; Automatic scheduling;
Dependency lag; Dependency warnings; Unscheduled-work tray; Filter to macro items only; Filter to
detailed items; Save timeline view.

**DEPENDENCY RULES** — Support: Finish to start; Start to start; Finish to finish; Start to finish;
Configurable lag; Cross-project permission checks; Circular-dependency prevention.

**BASELINES** — Allow an authorized user to save named snapshots of: Dates; Duration; Progress;
Scope; Estimate; Budget. Compare the active plan against a selected snapshot.

**CRITICAL PATH** — Treat critical-path computation as a **new feature requiring a tested scheduling
algorithm**. Do not assume it is inherited from another product. Display: Critical items; Total
float; Near-critical items; Calculation explanation; Effect of manually scheduled work.

**ACCEPTANCE CRITERIA** — Macro phases roll up child schedules. A PM can hide detailed tasks without
deleting them. A developer can open the same underlying work from the sprint. Schedule
recalculation is deterministic. Baseline changes are explainable. Cross-project dependency
visibility respects permissions. Critical-path calculations have fixture-based tests.

---

## PROMPT 10 — PROJECT HEALTH, RISKS, ISSUES, CHANGES, AND APPROVALS

**OBJECTIVE** — Create understandable governance without forcing it on every project.

**PROJECT HEALTH** — Statuses: On track; At risk; Off track; On hold; Completed; Cancelled.
Suggested health may use: Overdue milestones; Critical blocked work; Schedule variance; Budget
variance; Capacity; Unresolved high risks; Scope growth. The system must show *why* it suggested a
status. Allow manual override with explanation and expiration.

**RISK REGISTER** — Fields: Title; Category; Probability; Impact; Score; Owner; Trigger; Mitigation;
Contingency; Review date; State; Related work.

**CHANGE REQUEST** — Fields: Requested change; Reason; Scope effect; Schedule effect; Cost effect;
Risk effect; Requester; Approvers; Decision; Decision date; Related work.

**APPROVALS** — Sequential; Parallel; Any-one approver; All approvers; Deadline; Reminder;
Delegation; Approve; Reject; Request changes; Comment.

**ACCEPTANCE CRITERIA** — Health suggestions are explainable. Manual overrides are audited. Risk
scoring can be configured. Approval actions are immutable audit events. A client approver sees only
permitted context. Approved changes can update scope, budget, or dates only through an explicit
action. Governance modules can be disabled per project.
