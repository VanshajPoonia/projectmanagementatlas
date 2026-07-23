# Domain Map — Current vs. North-Star

_Audit date: 2026-07-23. Current model derived from the 62 migrations in `scripts/`._

## 1. Current data model (as built)

```
auth.users (Supabase Auth)
   └── profiles (id, role: user|admin|super_admin, active, …)          -- 001, 022, 047, 048

companies (SRG / AGC / …)                                              -- 056
   └── (referenced by marketing_calendar_items)                        -- 058

boards (project boards; color; archived; privacy)                      -- 001, 026, 036, 049, 061
   └── columns (ordered lists / statuses-as-columns)                   -- 001
        └── tasks  ── the current "work item" ──                       -- 001
             ├── parent_task_id → tasks (subtasks, self-FK)            -- 060
             ├── task_assignees (many-to-many, visibility)             -- 024, 028, 035
             ├── task_statuses (label/color, decoupled from columns)   -- 039, 053
             ├── task_attachments (base64, size-capped)                -- 020, 043
             ├── task_comments                                         -- 020
             ├── task_links                                            -- 020
             ├── task_activity (actor/time/field/old/new)              -- 052
             └── task_tags → tags (board-scoped)                       -- 011

marketing_calendar_items (channel, company, recurring, missed status) -- 033, 050, 054–058, 062
personal_tasks (private per-user to-do)                               -- 030
chat_messages + chat_read_state (DM between any two users)            -- 001, 037
bookmarks (home-page links)                                           -- 032
notification_preferences                                              -- 045
ai_chat_messages (assistant history)                                  -- 059
```

### Current "work item" = `tasks`

| Field | Type | Notes |
|---|---|---|
| `id` | uuid | pk |
| `column_id` | uuid → columns | board column (status-as-column) |
| `parent_task_id` | uuid → tasks | subtask hierarchy (one level in practice) |
| `title` | text | required |
| `description` | text | plain text (no rich-text model yet) |
| `assigned_to` | uuid → auth.users | legacy single assignee; multi-assignee via `task_assignees` |
| `created_by` | uuid → auth.users | |
| `position` | int | manual ordering within column |
| `priority` | numeric 1–5 | started as low/med/high (`001`), migrated to numeric (`023`), scale flipped (`046`) |
| `due_date` | timestamptz | editable only by creator (`038`) |
| `created_at` / `updated_at` | timestamptz | |

**Gap vs. north-star:** there is no first-class type system, no custom fields, no relations beyond
parent/child, no cycles/milestones/releases, no estimates/progress model, no state machine
independent of columns, no tenancy above `boards`. These are exactly the roadmap phases.

## 2. North-star information architecture (design target, not built)

```
Organization
  └── Workspace
       └── Team
            └── Portfolio
                 └── Initiative
                      └── Project
                           └── Epic / Module
                                └── Work Item   ← ONE configurable domain
                                     └── Subtask
```

**Planning / governance objects** hang off this spine (design-for-later where enterprise-tier):
Cycle/Sprint, Milestone, Release, Goal, Key Result, Risk, Decision, Change Request, Approval,
Meeting, Client, Request/Intake, Automation rule, Saved View.

### One Work-Item domain, configurable by type

The single most important north-star decision: **do not create parallel task systems.** Every
methodology (Kanban, Scrum, Gantt, marketing calendar) renders the **same** Work-Item rows through
different **views**. Work-item *types* (Task, Bug, Story, Epic, Content, …) are **data, not tables**,
powered by:

- `work_item_types` (per-workspace configurable types) — _future_
- `field_definitions` + `field_values` (the custom-fields engine = **Phase 1**) — _future_
- `states` (per-type/per-project workflow, decoupling status from board columns) — _evolves from
  today's `task_statuses`_
- `relations` (blocks/blocked-by/precedes/follows/duplicate/related/implements…) — _future_

## 3. Mapping: today → north-star (migration direction, not a plan to execute now)

| North-star concept | Nearest thing today | Bridge later |
|---|---|---|
| Organization / Workspace / Team | _none_ (flat; `companies` is a marketing dimension, not tenancy) | New tenancy tables + RLS scoping (Prompt 3) |
| Project | `boards` | Rename/extend boards into projects with a project key + sequence |
| Work Item | `tasks` | Add `type`, custom fields, richer state, relations (Prompt 4) |
| Subtask | `tasks.parent_task_id` | Keep; generalise hierarchy |
| State/workflow | `columns` + `task_statuses` | Promote `task_statuses` to per-type state machine |
| Custom fields | _none_ | `field_definitions`/`field_values` (Phase 1) |
| Cycle/Sprint, Milestone, Release | _none_ | New planning tables (Prompts 8–9) |
| Views (List/Table/Kanban/Calendar/Timeline/Gantt) | Kanban board only | Shared view engine over one query (Prompt 6) |
| Marketing calendar | `marketing_calendar_items` | Becomes a **view/type** of the Work-Item domain (the wedge) |
| Governance (Risk/Change/Approval/Health) | _none_ | Design-for-later, module-gated (Prompt 10) |

## 4. Authorization surface (unchanged principle across the map)

All of the above is enforced by **Postgres RLS reached through the user's session client**, with
`private`-schema `SECURITY DEFINER` chokepoint functions where recursion or cross-row checks are
needed. Any new tenancy level (Workspace/Team/Project membership) must extend this same model —
**server-side checks are the source of truth; hiding UI is never sufficient.**
