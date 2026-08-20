# ATLAS_02 Prompts A + B - implementation audit and fix ledger

Audited 2026-08-19 against `plan/ATLAS_02_CLAUDE_FINAL_BUILD_PROMPTS_AUDITED.md` lines 351-609
(Prompt A: design system + IA; Prompt B: single-org access control + modules).

**Method.** Read the prompts, then the implementation - not the changelog. Every claim below is
either quoted from a file at a named line or measured against the dev sandbox through real
anon-key sessions. Baseline at audit time: 589 unit tests green and `pnpm check:access-matrix`
green at **57** checks - not the 51 CLAUDE.md claimed, which had gone stale as checks were added.
Counted, because a number nobody re-counts is how that line got wrong in the first place.

**Headline.** Most defects below were above the database - the same shape this repo has already
recorded three times under "the database and the toggle were right, and no human could get
there". B3a was the one database exception: the owner chose the stricter product rule on
2026-08-20 and migration 109 now enforces it.

Status key: `[ ]` open · `[x]` fixed.

**All findings below are fixed.** Verification at the end of this document.

---

## A. Prompt B - the capability model

### [x] B1. `comment.create` contradicts RLS, on the one capability a client portal needs

`lib/capabilities.ts:156-164` groups `comment.create` into the same branch as `task.edit`, so a
board `guest` or `client` is denied. The database disagrees: the comments INSERT policy gates on
`private.can_view_task`, **not** `can_manage_task`
(`scripts/035_task_collaboration_visibility.sql:329-339`, re-stated unchanged by
`scripts/101_deactivation_is_real.sql:151-163`), and `private.task_restricted_by_board_role` -
the guest/client gate from `scripts/065_board_member_roles.sql:47-62` - is only ANDed into
`can_manage_task`.

Measured on the dev sandbox with a real guest session:

```
guest can edit the task?      no  (expected)
guest can post a comment?     YES      <- the model says no
guest can add an attachment?  no  (42501)
```

Latent today only because the comment box (`components/board/task-detail-modal.tsx:1355-1368`)
consults no capability at all, so the UI matches RLS by accident. Wiring the capability - the
obvious next step - would break the exact thing `client` exists as a separate role for
(`065`'s header: the client portal will "hide internal comments" later, not forbid commenting).

**Fix.** `comment.create` resolves to ALLOW: RLS gates it on *view* access, and anyone rendering
the task detail already has that. The capability layer must not invent a restriction the
database does not have.

### [x] B2. Eight of fifteen capabilities have no call site, and one answers wrong

Measured call sites outside `lib/capabilities*`:

| capability | call sites |
|---|---|
| `task.view` | 0 |
| `task.create` | 1 |
| `task.edit` | 3 |
| `task.delete` | 0 |
| `task.assign` | 0 |
| `task.schedule` | 2 |
| `task.attach` | 0 |
| `task.attach.large` | 1 |
| `task.attachment.delete` | 1 |
| `comment.create` | 0 |
| `project.manage` | 0 |
| `members.manage` | 0 |
| `share.external` | 0 |
| `audit.view` | 2 |
| `ai.execute` | 0 |

A vocabulary nobody consults is not a source of truth, and one entry is actively wrong:
`members.manage` returns ALLOW for any admin, while the real rule is **board creator only, with
no admin bypass** (`scripts/061_private_board_access.sql`, encoded in
`lib/board-membership.ts:98-103`'s `canManageMembership`). An admin who trusted it would be told
they may edit a membership list the database will refuse.

**Fix.** Give `members.manage` and `project.manage` the board they are being asked about, so
`members.manage` can answer creator-only. Wire `task.delete`, `task.assign`, `task.attach`,
`comment.create`, `share.external` and `ai.execute` at their real call sites. Delete `task.view`:
it was an unconditional ALLOW, i.e. a question only RLS can answer.

### [x] B3. `share.external` is defined, then checked inline anyway

`components/board/task-detail-modal.tsx:892` gates `ShareLinkDialog` on
`(isAdmin || task?.created_by === currentUserId)` - the guest/client term the capability defines
is missing. That is precisely the three-copies drift `lib/capabilities.ts` was written to remove,
reappearing in the file that adopted it.

**Fix.** Route the gate through `can(actor, 'share.external', subject)`.

### [x] B3a. The database did not enforce the board role on share links

Found while fixing B3. `share_links`' INSERT policy
(`scripts/074_harden_task_lifecycle_activity_and_sharing.sql:537-587`, untouched since) checks
the *link's* creator, the *task's* creator or admin, and board privacy - but **never
`board_members.role`**. So a member who is later demoted to `guest` can still mint a public
share URL for a task they created while they were a member.

**Owner decision, 2026-08-20:** fix it. A view-only board role cannot expand the audience to
the unauthenticated public web, even when that person created the task or holds a platform-admin
role. Migration `109_restrict_share_links_by_board_role.sql` replaces the INSERT policy and adds
the guest/client exclusion to both the board and task resource branches. Absence of a membership
row and `role='member'` keep their previous behavior; existing links are deliberately untouched.
The remaining board-level inline Share check now also routes through `share.external`, so neither
resource has a frontend rule that can drift from the database again.

### [x] B4. `task.attachment.delete` is stricter than RLS and carries the wrong sentence

The DELETE policy is `uploaded_by = auth.uid() OR can_delete_task(t.created_by)`
(`scripts/091_large_task_attachments.sql:186-198`). `lib/capabilities.ts:166-171` allowed only
admin-or-task-creator, so **an assignee could not delete a file they uploaded themselves**.

It also shared a branch with `task.schedule`, so a denial carried `NOT_SCHEDULER` - "Only the
task's creator or an admin can change the **due date**" - about an attachment. Never rendered
(only `.allowed` is read, at `task-detail-modal.tsx:1471`), so the copy defect was latent.

**Fix.** Own branch; `uploaded_by` added to the subject; its own sentence.

### [x] B5. `ai_assistant` is a UI-deep module toggle

`app/api/ai-chat/route.ts:58` checks auth and never reads `app_modules`. CRM is the only module
with server-side enforcement (`app/crm/access.ts`). Switching AI off in Super Admin > Modules
hides the widget while the endpoint keeps answering - the same shape as `104`'s
"`requires_reason` was UI-deep".

**Fix.** The route reads `app_modules` and returns 403 when `ai_assistant` is off.

### [x] B6. Task writes report success when RLS refuses them

`components/board/task-card.tsx:81,97,108,135,146` and
`components/board/board-view.tsx:274,554` all issue `.update(...).eq('id', ...)` with no
`.select()`. PostgREST does not treat a zero-row UPDATE as an error - the exact lesson
`lib/board-membership.ts` was written around - so the card logs activity, calls `onUpdate()` and
shows no error while nothing changed.

Reachable through the matrix row Prompt B names explicitly, **role change during an active
session**: `boardRole` is a server-rendered prop, so a user demoted in another tab keeps an
enabled input until reload. `check:access-matrix` already proves the database refuses that write
on the very next request; the client is what claims otherwise. Board drag-and-drop is the worst
of them - it applies an optimistic move and only reverts on `error`, so a refused drag stays on
screen until refresh.

**Fix.** A shared `lib/rls-write.ts` classifier, and every task write asks for its rows back.

⚠️ **Two of these writes must NOT be row-counted**, and this is the trap to remember:
`RETURNING` is filtered by the SELECT policy applied to the **new** row. `task-card.tsx`'s
`assigned_to` mirror sync and the detail modal's save can both make the task invisible to the
person saving (set `visibility='assigned'`, remove yourself from the assignees, and you are no
longer a viewer). A bare row count there would report a successful write as a refusal. The
classifier therefore takes a `stillReadable` probe and distinguishes *refused* from
*written but no longer yours to see*.

### [x] B7. A hardcoded `platformRole: 'user'` in two Actors

`components/board/board-view.tsx:164,169` and `components/board/task-card.tsx:65` build the
Actor with `platformRole: 'user'` and a comment arguing it is unread on that surface. True at the
time. It is a loaded gun for the next capability added there - and B2's fixes add several.

**Fix.** Both board routes pass the viewer's real `platformRole` alongside the deliberate
`isAdmin={false}` board-surface override, exactly as `task-detail-modal.tsx:151` already does.

---

## B. Prompt A - shell, palette and IA

### [x] A1. The command palette's Create actions are broken for admins

`components/my-work/my-work-view.tsx:88-110` hardcodes `/dashboard?tab=boards` and
`/dashboard?tab=personal`. `app/dashboard/page.tsx:21-23` redirects an admin to `/admin` **and
drops the query string**, so both commands land them on whatever tab they had open last.

This is the exact bug class `buildWorkspaceNav` exists to prevent - it picks its host from the
role, and `components/shell/workspace-nav.test.ts` pins "never leaves a /dashboard link in an
admin's nav". The palette simply bypasses the builder. The same file already computes `basePath`
at line 55 for favourites.

The commands are also not module-gated, unlike the identical pair in `user-dashboard.tsx:197-220`,
so "New personal task" is offered when `personal_tasks` is switched off.

**Fix.** One shared `buildCreateCommands(...)` in `components/shell/commands.ts`, host-aware and
module-gated, used by every shell.

### [x] A2. No Create group at all on `/admin` or `/crm`

`components/admin/admin-dashboard.tsx:195` and `components/crm/crm-shell.tsx:92` pass no
`commands` prop. Per `CLAUDE.md`'s People section all five real users hold `admin` or
`super_admin`, so the palette's Create section is dead for everyone who actually uses this app.

**Fix.** Same shared builder as A1.

### [x] A3. Context Actions were never built

`components/shell/commands.ts:22-40` declares a `'context'` group labelled "This board". Nothing
builds one and no host supplies one. Boards render outside `AppShell`
(`board-view.tsx:106`, `781`, `896` all say so deliberately - kanban needs full width), so ⌘K
does not exist on a board page at all.

Both of Prompt A's context lists are therefore unimplemented:

- **Project-context**: open saved view · create work · filter · open members/settings if permitted
- **Work-item-context**: change state · change priority · assign · add/remove label · copy link ·
  open parent · open project

**Fix.** Mount the palette on the board page with both groups. Everything except "open saved
view" is reachable today; saved views are Prompt E, and the gap is named on screen rather than
faked. Dialog stacking is already an established pattern in this file's subtree
(`ShareLinkDialog` and the move dialog both open from inside the task modal), so a palette over
an open task detail is not new ground.

### [x] A4. "Loading, empty, error, permission denied" is met on one destination

`ErrorState` and `PermissionDenied` are imported only by `components/admin/access-log.tsx`.
`LoadingRows` is imported only by tests. Every other destination has `EmptyState` and nothing
else.

Worse, three server routes **discard the query error entirely**, so a failure renders as
emptiness - this repo's own "hidden from you and does not exist arrive looking identical", in the
screens built to be trusted:

- `app/my-work/page.tsx:27-31` - a failed task query renders "You're all caught up"
- `app/crm/orders/page.tsx:17` - five queries destructured as `{ data }`, errors dropped
- `app/crm/clients/page.tsx` - same shape

**Fix.** Surface the errors, and give the affected destinations a real error state.

### [x] A5. The access log filters a page, not the log

`components/admin/access-log.tsx:56-60` fetches the newest 50 rows; `filterByCategory` (line 101)
then narrows that page in the browser. So "Nothing in this category yet" is false whenever the 50
newest events happen to contain none of that category, and `hasMore` is computed against the
unfiltered set. Same "empty is not absent" rule, in the screen whose entire value is being
believable.

**Fix.** Push the category into the query, so `LIMIT` applies after the filter.

### [x] A6. `AuditAction` is stale by three actions

`lib/audit-events.ts:10-19` lists nine actions. The database emits twelve: `profile.deleted`
(`scripts/100_deprovision_keeps_work.sql:110`) and
`profile.deactivated` / `profile.reactivated` (`scripts/101_deactivation_is_real.sql:209`) are
missing. `toneOf` (line 68) keys off `.added` / `.removed`, so an account deletion and a
deactivation both render as a neutral "change" - the same weight as a rename, for the two
largest access revocations the system can record.

**Fix.** Complete the union; classify deletion and deactivation as revocations.

### [x] A7. `canViewAudit` is passed by exactly one host

`components/admin/admin-dashboard.tsx:115,130` computes and passes it. `my-work-view.tsx:78` and
`crm-shell.tsx:78` do not, so the same admin sees an "Access log" item on `/admin` and not on
`/my-work` or `/crm`. A nav that changes shape as you walk around the app is the IA problem
Prompt A opens with.

**Fix.** Resolve it from the same capability in every shell.

### [x] A8. Active nav state is carried by colour alone

`components/shell/app-shell.tsx:141` marks the active mobile tab with `text-primary` and nothing
else; the sidebar uses a background fill (`app-sidebar.tsx:100`). `aria-current="page"` is
present in both, so assistive tech is fine - but Prompt A's ACCESSIBILITY list asks for
"non-color active-state cues" and the visual half is unmet.

**Fix.** A shape cue in both bars, alongside the colour.

---

## C. Out of scope, recorded deliberately

- **Saved views / pinned views** (Prompt A "Pinned views", palette "Open saved view") need Prompt
  E. `user_favorites.entity_type` already accepts `'view'`, so it lands as a client change.
- **Inbox navigation** (Prompt A) is Prompt F. `task_notifications` already exists with RLS that
  fits; the remaining work is a screen plus a decision about the existing unread backlog.

---

## D. What the fixes changed

New modules, all of them replacing something that had been copied or left implicit:

| file | why it exists |
|---|---|
| `lib/rls-write.ts` | one tested place that knows a zero-row write is a refusal, and knows the one case where it is not |
| `lib/task-mutations.ts` | the card and the palette write a task field through the same function |
| `components/shell/commands.ts` (`buildCreateCommands`, `buildBoardContextCommands`, `buildWorkItemContextCommands`) | the palette's sections, built once and unit-tested |
| `components/shell/workspace-nav.ts` (`dashboardHost`) | the `/admin` vs `/dashboard` rule the sidebar and the palette now share |
| `lib/module-registry.ts` (`isModuleEnabledOnServer`) | a module switch that a server route can enforce |
| `scripts/check-shell-actions.mjs` | `pnpm check:shell-actions` - the browser gate for the palette and the guest comment |

Two structural changes worth knowing about:

- **The board owns the task detail modal now.** `task-card.tsx` used to render its own
  `TaskDetailModal`, a second copy of the one `board-view.tsx` already rendered for the list
  and mobile views - and because that state lived inside the card, the board had no idea
  which task was open, so the palette had nothing to offer work-item actions for. `TaskCard`
  takes `onOpenDetail` and the board keeps one `selectedTaskId`. One opener, one modal.
- **`canManageMembership` delegates to `members.manage`** rather than restating the rule, and
  `MEMBERSHIP_LOCKED_REASON` is re-exported from the capability layer, so the picker and the
  palette cannot word the same restriction two ways.

Worth recording because it bit the browser gate: **clicking a task card's title starts an
inline rename and stops propagation**, so it does not open the detail. That is pre-existing
and deliberate; anything driving the card from a test has to click elsewhere.

## E. Verification

Verification is cumulative: the full Prompt A/B pass ran on 2026-08-19; after migration 109,
the full unit suite, TypeScript, production build, access matrix and lifecycle harness were rerun.

- `pnpm test` - **657 passing**, 40 files (was 589/39). New: `lib/rls-write.test.ts` (17),
  plus additions to `capabilities` (24 -> 43), `commands` (24 -> 42), `audit-events` (+9),
  `modules` (+3), `a11y` (+2), and the five task/board sharing decisions for migration 109.
- `npx tsc --noEmit` - clean.
- `npx next build` - clean, with `.env.production.local` moved aside and the **dev** ref
  (`pxzpewaerhjwnwsbaklc`) confirmed baked into the client bundle, per CLAUDE.md's rule that
  a local production build otherwise targets prod. Restored afterwards.
- **RLS gates, all green:** `check:access-matrix` (**70**, of which 13 are the new direct
  PostgREST sharing checks across member, guest, client and restricted-admin cases; counted from
  the run, not derived from the older 51 figure), `check:board-roles`,
  `check:task-lifecycle`, `check:favorites`, `check:teams`, `check:grants`,
  `check:column-delete`, `check:task-move`, `check:deactivation`, `check:deprovision`.
- Dev migration ledger: **109 applied, 0 pending**. Migration 109's in-transaction post-check
  found exactly one INSERT policy and confirmed that all existing share-link rows were untouched.
  Supabase security/performance advisors reported no new `share_links` warning; the only two
  table notices are pre-existing INFO-level unused-index notices in the empty sandbox table.
- **`pnpm check:shell-actions` - 18/18 in a real browser**, including: ⌘K opens on a board
  and stacks correctly over an open task modal; every project-context and work-item-context
  command from the plan's lists is present; no saved-view stub; the column the task is
  already in is not offered; **a palette "Move to" command really moved the task in the
  database**; zero console errors; and a **real guest session posted a real comment that
  reached `task_comments`** - the B1 fix, end to end.

`pnpm lint` fails with "ESLint couldn't find an eslint.config.js" - pre-existing, unrelated
to any of this, and untouched.

## F. Still open

- **`109` is applied to DEV only, and it cannot ride `--allow-prod`.** Confirmed 2026-08-20 by
  reading both ledgers: **dev is at `109`, prod is at `108`.** It rewrites an RLS
  policy, which this repo classifies as destructive, so the runner's prod opt-in is off the
  table by the project's own rule - it needs a deliberate application. Nothing breaks
  meanwhile: `share.external` already refuses guest/client in the client, so the only
  consequence of the delay is that **production still has the hole B3a describes**, exactly
  as it did before any of this work. The application code is already on `main` and therefore
  already live. Rollback if needed: `scripts/rollback/109_revert.sql` (added 2026-08-20,
  destroys no data).
- **`109`'s guest/client predicate is a third copy.** `private.task_restricted_by_board_role`
  (065) and `private.column_restricted_by_board_role` (067) already express the same rule;
  `109` inlines it into both resource branches instead. Correct today and verified, but a
  fourth `board_members` role would need updating in three places. Folding all three onto one
  helper is a tidy-up, not a fix, and was not done here.
- **Saved views / pinned views** (Prompt A, and the palette's "open saved view") - Prompt E.
- **Inbox navigation** (Prompt A) - Prompt F. `task_notifications` already fits.
- **Route-level permission-denied states.** Prompt A asks every destination for one; this app
  answers denial with `redirect()` at the route instead, which is a deliberate and defensible
  choice. `PermissionDenied` covers the in-page case (the access log). Not changed, because
  turning redirects into rendered 403s is a product decision, not a defect.
