# Information Architecture & Route Map

_Prompt 2 deliverable. Reflects the owner decision: **shared shell in place, tabs → routes
incrementally.** The nav source of truth is [`components/shell/nav-model.ts`](../../components/shell/nav-model.ts)._

## 1. Principle — calm by default, power on demand

A brand-new user should land on a calm product: **Projects, My Work, Inbox, Search**. Advanced
capability (Strategy, Agile, Planning, Time, Cost, Clients, Automation) is **module-activated**, not
shown by default. Module gating is already modelled (`isNavItemVisible` / `visibleGroups` +
`enabledModules`), but the advanced modules themselves arrive with tenancy in Prompt 3 — until then
only the calm defaults + today's existing surfaces are wired.

## 2. Navigation groups (current slice)

| Group | Item | Route | Status | Visibility |
|---|---|---|---|---|
| Work | My Work | `/my-work` | planned | all |
| Work | Projects | `/projects` | planned | all |
| Work | Inbox | `/inbox` | planned | all |
| Workspace | Calendar | `/dashboard?tab=calendar` | live | all |
| Workspace | Marketing | `/dashboard?tab=marketing` | live | module `marketing` |
| Workspace | Personal | `/dashboard?tab=personal` | live | all |
| Workspace | Chat | `/dashboard?tab=chat` | live | all |
| Admin | Admin | `/admin` | live | admin, super_admin |
| Admin | Super Admin | `/admin/super-admin` | live | super_admin |

`status: planned` items render with a non-colour "soon" cue and will become real routes in later
slices as their content lands (My Work = Prompt 7; Projects = the board/view work; Inbox = Prompt 7).

## 3. Route map (target, incremental)

```
/                         landing
/login, /signup          auth
/dashboard               ← today's user surface (tabs); shell wraps it next slice
  ?tab=calendar|marketing|personal|chat|account   (query-tab sections, live)
/admin                   ← today's admin surface
/admin/super-admin       companies + users (super_admin)
/{dashboard,admin}/board/[id]   board detail

# planned routes (promoted from tabs, one PR at a time)
/my-work                 Today / Overdue / Assigned / … (Prompt 7)
/projects                project list  →  /projects/[id]  (view engine, Prompt 6)
/inbox                   notifications & action-required (Prompt 7)
```

**Migration rule:** a section is promoted from a `?tab=` query surface to a first-class route only
when it gets its own PR; `nav-model.ts` flips that item from `?tab=…`/`planned` to a real `href`, and
`activeNavId()` keeps highlighting correct throughout.

## 4. Navigation state model

- **Active item** is derived, never stored: `activeNavId(pathname, tab)` picks the longest matching
  href (so `/admin/super-admin` beats `/admin`) and matches query-tab items by their `tab` param.
- **Sidebar collapse** is per-user and persisted: `app_sidebar_state:<userId>` in localStorage,
  parsed defensively (`parseSidebarState`), SSR-safe via `useSidebarState` (default on first paint,
  hydrate after mount). Modes: `expanded` (labels) / `collapsed` (icon-only rail with tooltips).
- **Command palette** open state is ephemeral (component state), toggled by `Cmd/Ctrl+K`.
- **Recently viewed** is passed into the shell as data (`recent`) so any host can supply it; the
  store for it is a later slice.

## 5. Responsive behaviour

| Breakpoint | Sidebar | Topbar | Bottom nav |
|---|---|---|---|
| `< md` (mobile) | hidden | breadcrumbs + search + account | **shown** — essential (core) items only, as routed links |
| `≥ md` (desktop) | shown (expanded/collapsed) | breadcrumbs + search + theme + account | hidden |

Essential mobile actions = the **core** group (My Work / Projects / Inbox), matching "mobile
navigation exposes only essential actions."

## 6. Accessibility (navigation)

- **Keyboard-only**: every nav item is a real `<Link>`; the sidebar toggle is a button with
  `aria-expanded`; the palette is fully keyboard-driven; a **Skip to content** link targets
  `#app-main`.
- **Current location**: `aria-current="page"` on the active item + breadcrumbs.
- **Status never by colour alone**: planned items carry a textual "soon" label, not just a tint;
  active state pairs background + `aria-current`.
- **Reduced motion**: sidebar width transition and skeleton pulse are `motion-safe:` only.
- Automated a11y checks over primary navigation are a follow-up once a jsdom/RTL + axe layer is added
  to the test harness (tracked with R-01).

## 7. What this slice deliberately does NOT do

- No workspace/team switcher (needs tenancy — Prompt 3).
- No real module-activation UI (the mechanism exists; the toggles + advanced modules are Prompt 3+).
- Does not yet replace the two dashboard components — the shell is additive here and is **adopted**
  in the next slice, per the incremental decision.
