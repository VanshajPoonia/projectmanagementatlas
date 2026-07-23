# Design System

_Prompt 2 deliverable. The system **extends** the existing Cal.com-inspired foundation in
[`DESIGN.md`](../../DESIGN.md) and `app/globals.css` — it does not replace established components
(no measured reason to). New shell primitives were added alongside the existing shadcn set._

## 1. Design tokens (source: `app/globals.css`, Tailwind v4 CSS-first)

Tokens are CSS custom properties on `:root` / `.dark`, exposed to Tailwind via `@theme inline`. Both
themes are fully defined; the shell uses semantic tokens only (never hard-coded colours).

| Semantic | Light | Dark | Use |
|---|---|---|---|
| `--background` / `--foreground` | `#ffffff` / `#111111` | `#0a0a0a` / `#fafafa` | page canvas + ink |
| `--primary` / `--primary-foreground` | `#111111` / `#fff` | `#fafafa` / `#111` | CTAs, active states |
| `--muted` / `--muted-foreground` | `#f8f9fa` / `#6b7280` | `#1a1a1a` / `#a1a1aa` | secondary text/surfaces |
| `--accent` / `--accent-foreground` | `#f3f4f6` / `#111` | `#1f1f1f` / `#fafafa` | hover/selected |
| `--destructive` | `#ef4444` | `#ef4444` | errors/danger |
| `--border` / `--input` / `--ring` | `#e5e7eb` / … / `#111` | `#27272a` / … / `#fafafa` | hairlines, focus ring |
| `--sidebar*` | white family | `#141414` family | shell chrome (already present) |
| `--radius` | `0.625rem` | — | corner rounding base |

Richer brand values (status colours, badge palette, dark navy surfaces) are catalogued in
`DESIGN.md`; promote them into `globals.css` as semantic tokens when a feature needs them.

## 2. Typography scale

- **Sans**: `Inter` (`--font-sans`); **Mono**: `Geist Mono` (`--font-mono`). Display face `Cal Sans`
  is reserved for marketing/landing per `DESIGN.md`.
- Scale (from `DESIGN.md`): `display-xl 64 / lg 48 / md 36 / sm 28`, `title-lg …`, body `text-sm`
  (14px) as the app default, `text-xs` (12px) for meta. App chrome stays at `text-sm`/`text-xs` for
  density.

## 3. Spacing & layout

- Tailwind 4-based spacing scale (`gap-1…gap-6`, `px-2…px-6`). Shell rhythm: topbar/sidebar header
  `h-14`, sidebar width `w-60` expanded / `w-16` collapsed, nav item `py-2`, group gap `mb-4`.
- Cards/surfaces use `--radius` (~10px), matching the soft-rounded Cal.com look.

## 4. Status icon rules (status never by colour alone)

- Every status/among-state cue pairs an **icon or text label** with any colour: planned nav items
  show a "soon" label; active items set `aria-current` + background; empty/permission states are
  icon + heading + description.
- When status colour is introduced for work items (Phase 1+), each state must also carry a shape or
  glyph, and be announced to assistive tech — not conveyed by hue alone.

## 5. Accessibility rules (baseline for all shell work)

1. Keyboard operability for every interactive element; visible focus ring (`--ring`, `ring-2`).
2. `aria-current`, `aria-expanded`, `aria-label` on nav controls; a Skip-to-content link.
3. Respect `prefers-reduced-motion` — animations are `motion-safe:` only.
4. Never communicate meaning by colour alone (§4).
5. Layout must remain usable at 200%/320% zoom — use relative units, `truncate`, flex/grid; no fixed
   pixel widths on text containers.
6. Theme-aware: light + dark both styled; the viewer's theme wins.
7. Automated checks (RTL + axe over primary nav) — follow-up under R-01.

## 6. Component inventory

**Existing shadcn primitives** (`components/ui/`, unchanged): alert, avatar, badge, button, calendar,
card, dialog, drawer, dropdown-menu, input, label, popover, scroll-area, select, tabs, textarea.

**Added in this slice** (`components/ui/`):
- `tooltip` — Radix tooltip (used for collapsed-sidebar labels).
- `skeleton` — reduced-motion-aware loading placeholder.
- `breadcrumb` — location trail primitive.
- `command` — cmdk wrapper (`CommandDialog`, input/list/group/item…).

**Shell composition** (`components/shell/`):
- `nav-model.ts` — IA/route map + pure helpers (`visibleGroups`, `activeNavId`) · **unit-tested**.
- `sidebar-state.ts` + `use-sidebar-state.ts` — persisted collapse state · pure part **unit-tested**.
- `nav-icons.tsx` — icon-key → lucide map.
- `app-sidebar.tsx` · `app-topbar.tsx` · `breadcrumbs.tsx` · `command-palette.tsx` · `states.tsx`
  (`EmptyState`, `PermissionDenied`).
- `app-shell.tsx` — composes sidebar + topbar + palette + mobile bottom nav; skip link; a11y.

## 7. Adoption plan (incremental, per owner decision)

1. **This slice** — foundation only (primitives + shell components + tests + docs); nothing in the
   live dashboards changes. Zero regression risk.
2. **Next slice** — wrap `/dashboard` and `/admin` in `AppShell`, mapping today's tabs to the nav
   model (the shell reads `?tab=` for active state already).
3. **Following slices** — promote `My Work`, `Projects`, `Inbox` from tabs to real routes, one PR
   each, flipping their `nav-model` status from `planned` to `live`.
