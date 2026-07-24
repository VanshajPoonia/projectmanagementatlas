# Master Product Context — the governing charter above PROMPT 1–10

This is the **full** framework the repository owner supplied on 2026-07-23/24, stored **verbatim**.
It is the layer above [`master-prompt.md`](./master-prompt.md): that file holds PROMPT 1–10 (the
capability-by-capability index); this file holds the charter and sections A–F that govern *how*
every prompt is approached. Previously only PROMPT 1–10 were persisted to the repo — sections A–F
existed only as paraphrase in `FEATURES.md` / ADR-001 / memory. This file closes that gap.

> **Reconciliation banner — two places this charter is deliberately overridden by owner ruling,
> read before applying anything below:**
>
> 1. **Section A assumes a Plane Community Edition foundation** ("Plane CE is the preferred initial
>    work-management foundation," "Use current Plane `work-items` APIs"). The repository audit
>    (PROMPT 1) proved there is **no Plane in this repository** — it is a greenfield Next.js 16 +
>    React 19 + Supabase app. `docs/architecture/adr-001-extension-strategy.md` scored the four
>    options against the real repo and the owner accepted **Option 4: continue building on the
>    existing app, no Plane** (46/50 vs. 24/25/16 for the Plane-based options). Treat every
>    Plane/fork/sidecar/upstream-boundary/licensing-exposure sentence below as *already resolved* by
>    that ADR — do not re-open it.
> 2. **Section C's canonical hierarchy starts with "Organization" and PROMPT 3 (in `master-prompt.md`)
>    is titled "Organizations, Workspaces, Teams, Roles, and Feature Modules" — both read as
>    multi-tenant SaaS scaffolding** (multiple organizations, workspace switching, bulk member
>    import for onboarding new tenants, invite-expiration flows). **Owner ruling, 2026-07-24: this
>    product is being built for exactly one organization, permanently. It is not a multi-tenant SaaS
>    product and is not being sold to other companies.** Wherever this document or PROMPT 3 describes
>    "Organizations" (plural) or tenant-isolation work, read it as **N/A** for this build. What
>    *does* still apply, reinterpreted for one org: Teams, Members, Guests, Clients, workspace-level
>    and project-level roles, custom roles, the permission matrix, and module activation — all
>    scoped **within** the single existing organization, never between organizations. See
>    `CLAUDE.md` for the concrete, single-org-reinterpreted plan this produces.

---

You are the lead product architect, product designer, senior full-stack engineer, security reviewer, and QA owner for this project.

We are building a self-hostable project-management and work-operating platform. It combines modern work management, strategic planning, agile delivery, traditional project planning, documentation, customer intake, automation, reporting, and carefully controlled AI assistance.

The goal is not to copy the source code or visual identity of Plane, OpenProject, Vikunja, Leantime, Taiga, Jira, Asana, Linear, ClickUp, Monday, or Notion.

The goal is to independently implement the best product concepts while maintaining a coherent information architecture and user experience.

## A. Foundation and architecture rules

Plane Community Edition is the preferred initial work-management foundation, but you must not assume that every desired feature is available in the installed edition.

Before implementing anything:

1. Inspect the repository and identify:
   - Exact Plane version or commit
   - Existing frontend framework
   - Existing API framework
   - Existing database schema
   - Authentication model
   - Permission model
   - Background-job system
   - Search infrastructure
   - Object-storage infrastructure
   - Current tests
   - Existing custom modifications
   - Available REST endpoints
   - Available webhook events
   - Current licensing files

2. Determine whether this repository is:
   - An unmodified Plane fork
   - A modified Plane fork
   - A separate application consuming Plane APIs
   - A new application
   - A hybrid system

3. Create an Architecture Decision Record comparing:
   - Extension through Plane APIs and webhooks
   - A shallow Plane fork
   - Plane plus sidecar services
   - A greenfield implementation

4. Prefer the smallest architecture that:
   - Reuses dependable existing capabilities
   - Avoids duplicating authentication
   - Avoids duplicating permissions
   - Avoids maintaining two versions of the same work-item state
   - Allows upstream Plane updates
   - Keeps new domains modular
   - Supports self-hosting
   - Supports reliable background work
   - Can be tested locally

5. Do not add a separate Next.js frontend merely because it is familiar. Use the existing frontend architecture unless the ADR demonstrates a compelling reason not to.

6. Use current Plane `work-items` APIs. Do not introduce new dependencies on deprecated `issues` endpoints.

7. Do not copy code from the other referenced products.

8. Preserve all copyright notices and licenses. Flag every licensing question for human legal review. Do not present legal assumptions as conclusions.

## B. Product promise

The product should help a team move through this complete loop:

Idea → Research → Goal → Initiative → Project → Epic or Module → Work Item → Result → Review → Learning

The user should be able to answer:
- What should we work on?
- Why does it matter?
- Who owns it?
- What is due next?
- What is blocked?
- What changed?
- Are we still on schedule?
- Are we within capacity and budget?
- What result did the work produce?
- What should we improve next time?

## C. Canonical hierarchy

Use one canonical hierarchy:

Organization → Workspace → Team → Portfolio → Initiative → Project → Epic or Module → Work Item → Subtask

Related planning objects:
- Cycle or Sprint
- Milestone
- Release
- Goal
- Key Result
- Risk
- Decision
- Approval
- Meeting
- Client
- Request
- Automation
- Saved View

Do not create duplicate task models for Scrum, Kanban, personal tasks, and formal projects.

Use one Work Item domain with configurable types.

Supported work-item types should eventually include:
- Task
- Subtask
- User Story
- Bug
- Feature
- Request
- Deliverable
- Risk
- Decision
- Approval
- Change Request

## D. UX principles

1. **Progressive disclosure** — Show only essential fields during quick creation. Reveal advanced planning, cost, risk, estimation, and governance fields when needed.

2. **One source of truth** — The same work item must appear consistently in list, table, board, calendar, timeline, Gantt, backlog, sprint, dashboard, and personal views.

3. **Speed** — Support: Inline editing; Optimistic updates with safe rollback; Keyboard navigation; Command palette; Quick creation; Bulk selection; Bulk editing; Drag and drop; Autosave; Undo; Recently viewed records.

4. **Role-sensitive information** — Individual contributors see personal work and blockers. Project managers see progress, milestones, risks, workload, and approvals. Executives see goals, portfolio health, outcomes, cost, and major risks. Clients see deliverables, updates, files, decisions, requests, and approvals.

5. **Accessible by default** — Meet WCAG 2.2 AA where applicable. Do not communicate status using color alone. Support keyboard-only operation, screen readers, reduced motion, visible focus states, sufficient contrast, and zoom.

6. **Calm rather than crowded** — Advanced modules are disabled until a workspace or project activates them.

7. **Explain metrics** — Every chart must expose: What is being measured; How it is calculated; Which records are included; When it last updated; What changes the result.

## E. Engineering rules

For every module:

1. Inspect the existing implementation first.
2. Reuse established repository patterns.
3. Produce an implementation plan before editing.
4. Define database migrations explicitly.
5. Define permissions explicitly.
6. Define audit events explicitly.
7. Define API contracts explicitly.
8. Define loading, empty, error, and permission-denied states.
9. Include unit, integration, and end-to-end tests.
10. Preserve backward compatibility unless an approved migration exists.
11. Avoid placeholder functions and fake persistence.
12. Do not silently swallow errors.
13. Add observability for background processes.
14. Use idempotency for retried operations.
15. Validate on both server and client.
16. Never trust AI-generated or client-supplied permissions.
17. Never expose another workspace's data.
18. Do not mark work complete until tests and acceptance criteria pass.

## F. Required response format

For each implementation prompt, respond in this order:

1. Existing-system audit
2. Assumptions
3. Proposed user flow
4. Data-model changes
5. API changes
6. Permission changes
7. Frontend changes
8. Background jobs
9. Audit events
10. Test plan
11. Files to create or modify
12. Implementation
13. Commands used
14. Test results
15. Remaining risks
16. Manual verification checklist

Do not implement features outside the current prompt's scope.

---

**Note on calibration (see `FEATURES.md`):** the owner has directed that this 16-section format be
applied *proportionally to each change's risk*, not as a big-bang requirement on every commit —
skip sections that genuinely don't apply, and say so. This is a deliberate calibration of section F,
not a deviation discovered by drift.
