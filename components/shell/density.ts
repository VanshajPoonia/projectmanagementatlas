// Per-user view density.
//
// "Never make one person's dense board change everyone else's board" - density is a
// presentation preference, so it is stored per user and per browser and is never written
// to a shared record. Two people looking at the same board can legitimately disagree
// about how much they want to see at once, and both are right.
//
// Three levels, matching the plan's design guide:
//   compact     - scanning a lot of work; one-line titles, minimal metadata
//   comfortable - the default; title plus the essential metadata
//   expanded    - fewer cards, more context; description preview and parent/child info
//
// Pure logic here; use-density.ts adds localStorage + SSR guards (same split as
// sidebar-state.ts).

export type Density = 'compact' | 'comfortable' | 'expanded'

export const DENSITIES: readonly Density[] = ['compact', 'comfortable', 'expanded'] as const

export const DEFAULT_DENSITY: Density = 'comfortable'

export const DENSITY_LABELS: Record<Density, string> = {
  compact: 'Compact',
  comfortable: 'Comfortable',
  expanded: 'Expanded',
}

export const DENSITY_HINTS: Record<Density, string> = {
  compact: 'Fit the most work on screen',
  comfortable: 'Balanced - the default',
  expanded: 'More context per item',
}

/** Per-user key so two accounts on one browser keep their own preference. */
export function densityStorageKey(userId: string): string {
  return `app_density:${userId}`
}

export function parseDensity(raw: string | null): Density {
  return DENSITIES.includes(raw as Density) ? (raw as Density) : DEFAULT_DENSITY
}

/**
 * Card padding + gap for a density. Returned as class strings rather than inline styles
 * so Tailwind's own responsive/variant machinery still applies on top.
 */
export function densityCardClass(density: Density): string {
  switch (density) {
    case 'compact':
      return 'p-2 gap-1'
    case 'expanded':
      return 'p-4 gap-3'
    default:
      return 'p-3 gap-2'
  }
}

/** Vertical rhythm between items in a list/column at this density. */
export function densityListClass(density: Density): string {
  switch (density) {
    case 'compact':
      return 'space-y-1'
    case 'expanded':
      return 'space-y-4'
    default:
      return 'space-y-2'
  }
}

/**
 * Whether secondary detail should render at all at this density. Compact hides
 * description previews and non-essential chips; expanded shows everything.
 */
export function showsSecondaryDetail(density: Density): boolean {
  return density !== 'compact'
}

export function showsDescriptionPreview(density: Density): boolean {
  return density === 'expanded'
}
