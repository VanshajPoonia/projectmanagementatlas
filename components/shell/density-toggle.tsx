'use client'

import { Rows2, Rows3, Rows4 } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { DENSITIES, DENSITY_HINTS, DENSITY_LABELS, type Density } from './density'

const ICONS: Record<Density, typeof Rows2> = {
  compact: Rows4,
  comfortable: Rows3,
  expanded: Rows2,
}

/**
 * Per-user view density. Sits in the topbar next to the theme controls because it is
 * the same kind of setting: presentation, chosen by the viewer, affecting nobody else.
 *
 * The active option is marked with a checkmark glyph as well as accent styling - a
 * colour alone is not an accessible state cue.
 */
export function DensityToggle({
  density,
  onChange,
}: {
  density: Density
  onChange: (next: Density) => void
}) {
  const Icon = ICONS[density]

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`View density: ${DENSITY_LABELS[density]}`}>
          <Icon className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>View density</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {DENSITIES.map((option) => {
          const OptionIcon = ICONS[option]
          const active = option === density
          return (
            <DropdownMenuItem
              key={option}
              onClick={() => onChange(option)}
              aria-current={active ? 'true' : undefined}
              className="gap-2"
            >
              <OptionIcon className="size-4 shrink-0" aria-hidden="true" />
              <span className="flex-1">
                <span className={active ? 'font-medium' : undefined}>{DENSITY_LABELS[option]}</span>
                <span className="text-muted-foreground block text-xs">{DENSITY_HINTS[option]}</span>
              </span>
              <span aria-hidden="true" className="text-primary w-3 text-center">
                {active ? '✓' : ''}
              </span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
