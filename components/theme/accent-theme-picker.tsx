'use client'

import { useEffect, useState, type CSSProperties } from 'react'
import { Palette } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { autoTextColor } from '@/lib/color'

const PRESETS = ['#111111', '#e91e8c', '#db2777', '#7c3aed', '#2563eb', '#0891b2', '#16a34a']

function storageKey(userId: string) {
  return `dashboard_accent_${userId}`
}

export function useAccentTheme(userId: string, defaultColor: string) {
  const [color, setColorState] = useState(defaultColor)

  useEffect(() => {
    try {
      const saved = localStorage.getItem(storageKey(userId))
      setColorState(saved || defaultColor)
    } catch {
      setColorState(defaultColor)
    }
    // Only re-read from storage when the signed-in user changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const setColor = (next: string) => {
    setColorState(next)
    try { localStorage.setItem(storageKey(userId), next) } catch { /* ignore */ }
  }

  const reset = () => {
    setColorState(defaultColor)
    try { localStorage.removeItem(storageKey(userId)) } catch { /* ignore */ }
  }

  const style: CSSProperties = {
    '--primary': color,
    '--primary-foreground': autoTextColor(color),
    '--ring': color,
    '--sidebar-primary': color,
    '--sidebar-primary-foreground': autoTextColor(color),
    '--sidebar-ring': color,
  } as CSSProperties

  return { color, setColor, reset, style }
}

interface AccentThemePickerProps {
  color: string
  onChange: (color: string) => void
  onReset: () => void
}

export default function AccentThemePicker({ color, onChange, onReset }: AccentThemePickerProps) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon-sm" aria-label="Customize dashboard color">
          <Palette className="h-4 w-4" style={{ color }} />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 space-y-3 p-4">
        <p className="text-sm font-semibold">Dashboard color</p>
        <div className="flex flex-wrap items-center gap-2">
          {PRESETS.map(p => (
            <button
              key={p}
              type="button"
              onClick={() => onChange(p)}
              aria-label={`Use ${p}`}
              className={cn('h-7 w-7 rounded-full border-2 transition-transform',
                color.toLowerCase() === p ? 'scale-110 border-foreground' : 'border-transparent hover:scale-105')}
              style={{ backgroundColor: p }}
            />
          ))}
          <label className="relative flex h-7 w-7 cursor-pointer items-center justify-center rounded-full border text-xs text-muted-foreground hover:border-foreground/40">
            +
            <input
              type="color"
              value={color}
              onChange={e => onChange(e.target.value)}
              className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            />
          </label>
        </div>
        <Button size="sm" variant="outline" className="w-full" onClick={onReset}>
          Reset to default
        </Button>
      </PopoverContent>
    </Popover>
  )
}
