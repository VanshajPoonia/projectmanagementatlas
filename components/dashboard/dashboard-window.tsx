'use client'

import { useState, useEffect, type ReactNode } from 'react'
import { ChevronDown, Maximize2, Minimize2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface DashboardWindowProps {
  /** Stable id used to remember the collapsed state per user. */
  id: string
  title: string
  description?: string
  icon?: ReactNode
  /** Optional content rendered on the right of the header, before the window controls. */
  actions?: ReactNode
  defaultCollapsed?: boolean
  children: ReactNode
  className?: string
}

export default function DashboardWindow({
  id,
  title,
  description,
  icon,
  actions,
  defaultCollapsed = false,
  children,
  className,
}: DashboardWindowProps) {
  const storageKey = `dashwin:${id}:collapsed`
  const [collapsed, setCollapsed] = useState(defaultCollapsed)
  const [maximized, setMaximized] = useState(false)
  const [hydrated, setHydrated] = useState(false)

  // Read the remembered collapsed state after mount (avoids SSR hydration mismatch).
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey)
      if (stored !== null) setCollapsed(stored === '1')
    } catch {}
    setHydrated(true)
  }, [storageKey])

  const toggleCollapsed = () => {
    setCollapsed((prev) => {
      const next = !prev
      try {
        window.localStorage.setItem(storageKey, next ? '1' : '0')
      } catch {}
      return next
    })
  }

  // Esc restores from maximized; lock body scroll while maximized.
  useEffect(() => {
    if (!maximized) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaximized(false)
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
    }
  }, [maximized])

  // When maximized the body is always shown, regardless of collapsed state.
  const showBody = maximized || !collapsed

  const windowControls = (
    <div className="flex items-center gap-0.5">
      {!maximized && (
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={toggleCollapsed}
          aria-label={collapsed ? `Expand ${title}` : `Minimize ${title}`}
          title={collapsed ? 'Expand' : 'Minimize'}
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform duration-200', collapsed && '-rotate-90')} />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon-sm"
        onClick={() => setMaximized((m) => !m)}
        aria-label={maximized ? `Restore ${title}` : `Maximize ${title}`}
        title={maximized ? 'Restore' : 'Maximize'}
      >
        {maximized ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
      </Button>
      {maximized && (
        <Button variant="ghost" size="icon-sm" onClick={() => setMaximized(false)} aria-label="Close" title="Close">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  )

  const panel = (
    <section
      className={cn(
        'rounded-lg border bg-card text-card-foreground shadow-sm transition-shadow',
        maximized ? 'flex h-full w-full max-w-5xl flex-col overflow-hidden shadow-xl' : 'hover:shadow-md',
        className
      )}
    >
      <header
        className={cn(
          'flex items-center justify-between gap-3 px-4 py-3',
          showBody && 'border-b'
        )}
      >
        <button
          type="button"
          onClick={maximized ? undefined : toggleCollapsed}
          className={cn('flex min-w-0 flex-1 items-center gap-2.5 text-left', !maximized && 'cursor-pointer')}
        >
          {icon && (
            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-secondary text-foreground">
              {icon}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold leading-tight">{title}</span>
            {description && <span className="block truncate text-xs text-muted-foreground">{description}</span>}
          </span>
        </button>
        <div className="flex flex-shrink-0 items-center gap-2">
          {actions}
          {windowControls}
        </div>
      </header>

      {maximized ? (
        <div className="flex-1 overflow-y-auto p-4">{children}</div>
      ) : (
        <div
          className={cn(
            'grid transition-[grid-template-rows] duration-200 ease-out',
            showBody ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
          )}
          // Avoid an opening animation flash before the stored state is read.
          style={hydrated ? undefined : { transitionDuration: '0ms' }}
        >
          <div className="overflow-hidden">
            <div className="p-4">{children}</div>
          </div>
        </div>
      )}
    </section>
  )

  if (maximized) {
    return (
      <div className="fixed inset-0 z-50 flex bg-background/80 p-4 backdrop-blur-sm sm:p-8" onClick={() => setMaximized(false)}>
        <div className="m-auto flex h-full w-full max-w-5xl" onClick={(e) => e.stopPropagation()}>
          {panel}
        </div>
      </div>
    )
  }

  return panel
}
