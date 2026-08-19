'use client'

import { Star } from 'lucide-react'
import { cn } from '@/lib/utils'

interface FavoriteStarProps {
  /** Starred right now. Drives both the fill and `aria-pressed`. */
  active: boolean
  /** What is being starred, for the accessible name - e.g. a board title. */
  label: string
  onToggle: (next: boolean) => void
  /** A write is in flight; the control stays interactive but stops double-firing. */
  pending?: boolean
  className?: string
}

/**
 * The star. Rendered on top of board cards, which are themselves links.
 *
 * Two things it has to get right:
 *
 * 1. **It must not navigate.** Every board card is wrapped in a `<Link>`, so a bare click
 *    would follow the link and the star would appear to do nothing. `preventDefault` +
 *    `stopPropagation` keep the click here. The same applies to the keyboard: Enter on a
 *    button inside a link bubbles to the link.
 *
 * 2. **It must say what it does.** A lone star icon reads to a screen reader as nothing at
 *    all, so it carries an explicit name naming the board, and `aria-pressed` for the state -
 *    which is also the non-colour cue the accessibility pass asks for, since "gold vs grey"
 *    is the only visual difference.
 */
export function FavoriteStar({ active, label, onToggle, pending, className }: FavoriteStarProps) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={active ? `Remove ${label} from favourites` : `Add ${label} to favourites`}
      title={active ? 'Remove from favourites' : 'Add to favourites'}
      disabled={pending}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onToggle(!active)
      }}
      // A card wrapped in a Link also fires on keydown; stop it here as well or Enter both
      // stars the board and opens it.
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') e.stopPropagation()
      }}
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-md outline-none',
        'focus-visible:ring-ring focus-visible:ring-2',
        'motion-safe:transition-colors disabled:opacity-60',
        active
          ? 'text-amber-500 hover:text-amber-600'
          : 'text-muted-foreground/50 hover:text-muted-foreground hover:bg-accent',
        className,
      )}
    >
      <Star className={cn('size-4', active && 'fill-current')} aria-hidden="true" />
    </button>
  )
}
