'use client'

// One entry point for everything "how this app looks": light/dark and the accent colour.
//
// It replaces a pair of separate buttons (ThemeToggle + AccentThemePicker) that only ever
// appeared together on the user dashboard. Collapsing them into a single popover is what
// makes "customisable from any page" affordable — one 32px control fits in a board header,
// two plus a label did not.

import { useEffect, useState } from 'react'
import { useTheme } from 'next-themes'
import { Check, Monitor, Moon, Palette, Sun } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { autoTextColor } from '@/lib/color'
import { useAccent } from './accent-provider'

/**
 * Deliberately excludes near-black. The old picker offered #111111 as a swatch, which is the
 * light theme's own --primary — choosing it in dark mode produced a near-black button on a
 * near-black page. "Default" below is the correct way to ask for that, because it restores
 * whichever primary the active theme ships (#111111 light, #fafafa dark) instead of pinning
 * one of them. Every hue here clears 3:1 against both #ffffff and #0a0a0a.
 */
const PRESETS: { value: string; label: string }[] = [
  { value: '#2563eb', label: 'Blue' },
  { value: '#0891b2', label: 'Cyan' },
  { value: '#16a34a', label: 'Green' },
  { value: '#ca8a04', label: 'Amber' },
  { value: '#ea580c', label: 'Orange' },
  { value: '#db2777', label: 'Pink' },
  { value: '#7c3aed', label: 'Violet' },
]

const MODES = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'system', label: 'System', Icon: Monitor },
] as const

export function ThemeControls({ className }: { className?: string }) {
  const { theme, setTheme, resolvedTheme } = useTheme()
  const { color, isCustom, setColor, reset } = useAccent()
  const [mounted, setMounted] = useState(false)

  useEffect(() => setMounted(true), [])

  // Theme is only known after mount (next-themes reads localStorage on the client), so the
  // trigger renders a stable placeholder first rather than risking a hydration mismatch.
  if (!mounted) {
    return (
      <Button variant="outline" size="icon-sm" className={className} disabled aria-label="Appearance">
        <Palette className="h-4 w-4" />
      </Button>
    )
  }

  const isDark = resolvedTheme === 'dark'

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" className={className} aria-label="Appearance settings">
          <Palette className="h-4 w-4" style={isCustom ? { color } : undefined} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-4">
        <div className="space-y-4">
          <section className="space-y-2">
            <h3 className="text-sm font-semibold">Appearance</h3>
            {/* cal.com's signature nav-pill-group: a pill-radius track holding the segments. */}
            <div
              role="radiogroup"
              aria-label="Colour mode"
              className="bg-muted flex items-center gap-1 rounded-full p-1"
            >
              {MODES.map(({ value, label, Icon }) => {
                const active = theme === value
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setTheme(value)}
                    className={cn(
                      'focus-visible:ring-ring flex flex-1 items-center justify-center gap-1.5 rounded-full px-2 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2',
                      active
                        ? 'bg-background text-foreground shadow-xs'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </button>
                )
              })}
            </div>
          </section>

          <section className="space-y-2">
            <div className="flex items-baseline justify-between">
              <h3 className="text-sm font-semibold">Accent</h3>
              {isCustom && (
                <button
                  type="button"
                  onClick={reset}
                  className="text-muted-foreground hover:text-foreground text-xs font-medium underline-offset-2 hover:underline"
                >
                  Reset
                </button>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* "Default" is a distinct choice, not a swatch: it restores whichever primary
                  the active theme ships, so it stays legible in dark mode. */}
              <button
                type="button"
                onClick={reset}
                aria-label="Default accent"
                aria-pressed={!isCustom}
                title="Default"
                className={cn(
                  'focus-visible:ring-ring relative flex h-7 w-7 items-center justify-center rounded-full border transition-transform outline-none focus-visible:ring-2',
                  isCustom ? 'border-border hover:scale-105' : 'border-foreground scale-110',
                )}
                style={{ backgroundColor: isDark ? '#fafafa' : '#111111' }}
              >
                {!isCustom && (
                  <Check className="h-3.5 w-3.5" style={{ color: isDark ? '#111111' : '#ffffff' }} />
                )}
              </button>

              {PRESETS.map(({ value, label }) => {
                const active = isCustom && color.toLowerCase() === value
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setColor(value)}
                    aria-label={label}
                    aria-pressed={active}
                    title={label}
                    className={cn(
                      'focus-visible:ring-ring relative flex h-7 w-7 items-center justify-center rounded-full border transition-transform outline-none focus-visible:ring-2',
                      active ? 'border-foreground scale-110' : 'border-transparent hover:scale-105',
                    )}
                    style={{ backgroundColor: value }}
                  >
                    {/* Tick is inked from the swatch itself so it stays legible on amber. */}
                    {active && <Check className="h-3.5 w-3.5" style={{ color: autoTextColor(value) }} />}
                  </button>
                )
              })}

              <label
                className="border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground focus-within:ring-ring relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border border-dashed text-sm transition-colors focus-within:ring-2"
                title="Custom colour"
              >
                <span aria-hidden>+</span>
                <span className="sr-only">Custom accent colour</span>
                <input
                  type="color"
                  value={color}
                  onChange={e => setColor(e.target.value)}
                  className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
                />
              </label>
            </div>

            <p className="text-muted-foreground text-xs">
              Applies to buttons and focus rings across every board and page on this browser.
            </p>
          </section>
        </div>
      </PopoverContent>
    </Popover>
  )
}

export default ThemeControls
