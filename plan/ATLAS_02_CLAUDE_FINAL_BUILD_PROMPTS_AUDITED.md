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
