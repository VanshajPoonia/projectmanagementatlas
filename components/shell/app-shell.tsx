'use client'

import { useState } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { AppSidebar, type RecentItem } from './app-sidebar'
import { AppTopbar } from './app-topbar'
import { CommandPalette } from './command-palette'
import { navIcon } from './nav-icons'
import { useSidebarState } from './use-sidebar-state'
import { visibleGroups, type Role } from './nav-model'
import type { Crumb } from './breadcrumbs'

export interface AppShellUser {
  id: string
  role: Role
  full_name?: string | null
  email?: string | null
}

interface AppShellProps {
  user: AppShellUser
  /** Feature modules turned on for this workspace. Until tenancy (Prompt 3) this is
   *  passed by the host; the calm defaults are always on. */
  enabledModules?: string[]
  activeId: string | null
  breadcrumbs?: Crumb[]
  recent?: RecentItem[]
  children: React.ReactNode
}

/**
 * The unified application shell: persistent sidebar (desktop), sticky topbar with
 * breadcrumbs + command entry, a keyboard-driven command palette, and a routed
 * bottom nav on mobile. Adopted incrementally (owner decision) — host pages pass
 * their content as children. Accessibility: skip-to-content link, keyboard-operable
 * nav, motion-safe transitions.
 */
export function AppShell({
  user,
  enabledModules = [],
  activeId,
  breadcrumbs = [],
  recent = [],
  children,
}: AppShellProps) {
  const modules = new Set(enabledModules)
  const { collapsed, toggle } = useSidebarState(user.id)
  const [commandOpen, setCommandOpen] = useState(false)

  // The essential mobile actions = the core group's items.
  const mobileItems = visibleGroups(user.role, modules)
    .filter((g) => g.id === 'core')
    .flatMap((g) => g.items)

  return (
    <div className="bg-background flex min-h-dvh">
      <a
        href="#app-main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <AppSidebar
        role={user.role}
        enabledModules={modules}
        activeId={activeId}
        collapsed={collapsed}
        onToggle={toggle}
        recent={recent}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar user={user} breadcrumbs={breadcrumbs} onOpenCommand={() => setCommandOpen(true)} />
        <main id="app-main" className="flex-1 pb-20 md:pb-0" tabIndex={-1}>
          {children}
        </main>
      </div>

      {/* Mobile bottom nav — essential areas only. */}
      <nav
        aria-label="Primary"
        className="bg-background/95 fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {mobileItems.map((item) => {
          const Icon = navIcon(item.icon)
          const isActive = item.id === activeId
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium',
                isActive ? 'text-primary' : 'text-muted-foreground',
              )}
            >
              <Icon className="size-5" aria-hidden="true" />
              <span className="leading-none">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <CommandPalette
        role={user.role}
        enabledModules={modules}
        open={commandOpen}
        onOpenChange={setCommandOpen}
      />
    </div>
  )
}
