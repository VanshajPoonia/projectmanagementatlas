'use client'

import * as React from 'react'
import { useState } from 'react'
import Link from 'next/link'

import { cn } from '@/lib/utils'
import { AppSidebar, type FavoriteItem, type SidebarNavGroup } from './app-sidebar'
import { AppTopbar } from './app-topbar'
import { CommandPalette } from './command-palette'
import { DensityToggle } from './density-toggle'
import { MobileMenu } from './mobile-menu'
import { navIcon } from './nav-icons'
import { useDensity } from './use-density'
import { useRecentRecords } from './use-recent-records'
import { useSidebarState } from './use-sidebar-state'
import type { Command } from './commands'
import type { Density } from './density'
import type { Role } from './nav-model'
import type { Crumb } from './breadcrumbs'

export interface AppShellUser {
  id: string
  role: Role
  full_name?: string | null
  email?: string | null
}

interface AppShellProps {
  user: AppShellUser
  /** Nav groups for the sidebar + palette, already filtered by the host. */
  groups: SidebarNavGroup[]
  activeId: string | null
  breadcrumbs?: Crumb[]
  /**
   * The viewer's starred boards, already resolved against what they can see. Owned by the
   * host rather than fetched here because the host is the one that already has the board
   * list to resolve against; see lib/favorites.ts::resolveFavorites.
   */
  favorites?: FavoriteItem[]
  /** Essential items for the mobile bottom bar; defaults to the first group (≤5). */
  mobileItems?: SidebarNavGroup['items']
  /** Right-side topbar controls (theme, accent, account, …). */
  topbarActions?: React.ReactNode
  /**
   * Host commands for the ⌘K palette - Create actions and context actions for whatever
   * is open. Each carries its own CapabilityDecision; see commands.ts.
   */
  commands?: Command[]
  title?: string
  /** Applied to the outer wrapper (e.g. accent CSS variables). */
  style?: React.CSSProperties
  /** Receives the viewer's density so hosts can size their own content to match. */
  children: React.ReactNode | ((density: Density) => React.ReactNode)
}

/**
 * Unified application shell: persistent sidebar (desktop), sticky topbar with
 * breadcrumbs + command entry, keyboard command palette (⌘K), and a routed bottom
 * nav on mobile. Host-driven - pages pass their own nav groups + content.
 * Accessibility: skip-to-content link, keyboard-operable nav, motion-safe.
 *
 * The shell owns three per-user preferences, all persisted per user and per browser and
 * never written to a shared record: sidebar collapse, view density, and recently viewed
 * records.
 */
export function AppShell({
  user,
  groups,
  activeId,
  breadcrumbs = [],
  favorites = [],
  mobileItems,
  topbarActions,
  commands = [],
  title,
  style,
  children,
}: AppShellProps) {
  const { collapsed, toggle } = useSidebarState(user.id)
  const { density, setDensity } = useDensity(user.id)
  const { records: recent } = useRecentRecords(user.id)
  const [commandOpen, setCommandOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)

  const mobile = (mobileItems ?? groups[0]?.items ?? []).slice(0, 5)

  return (
    <div className="bg-background flex min-h-dvh" style={style}>
      <a
        href="#app-main"
        className="bg-primary text-primary-foreground sr-only z-50 rounded-md px-3 py-2 focus:not-sr-only focus:absolute focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      <AppSidebar
        groups={groups}
        activeId={activeId}
        collapsed={collapsed}
        onToggle={toggle}
        favorites={favorites}
        recent={recent.map((r) => ({ label: r.label, href: r.href }))}
        title={title}
      />

      <div className="flex min-w-0 flex-1 flex-col">
        <AppTopbar
          user={user}
          breadcrumbs={breadcrumbs}
          onOpenCommand={() => setCommandOpen(true)}
          onOpenMenu={() => setMenuOpen(true)}
          actions={
            <>
              {/*
                Density is a comfort setting, and the first thing to give up when the topbar
                runs out of room: `contents` keeps the layout byte-identical at >=sm while
                removing it entirely below, where the row cannot fit without forcing the page
                to scroll sideways.
              */}
              <span className="hidden sm:contents">
                <DensityToggle density={density} onChange={setDensity} />
              </span>
              {topbarActions}
            </>
          }
        />
        <main id="app-main" className="flex-1 pb-[calc(5rem+env(safe-area-inset-bottom))] md:pb-0" tabIndex={-1}>
          {typeof children === 'function' ? children(density) : children}
        </main>
      </div>

      <nav
        aria-label="Primary"
        className="bg-background/95 fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t px-[env(safe-area-inset-left)] pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        {mobile.map((item) => {
          const Icon = navIcon(item.icon)
          const isActive = item.id === activeId
          return (
            <Link
              key={item.id}
              href={item.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                // 64px tall, 24px icons and 12px labels: the old bar was 20px/11px and too small to
                // hit. min-w-0 keeps five labels on a 320px screen by truncating, not scrolling.
                'active:bg-accent relative flex min-h-16 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 pt-2 pb-1.5 text-xs font-medium transition-colors',
                isActive ? 'text-primary font-semibold' : 'text-muted-foreground',
              )}
            >
              {/* A shape as well as a colour, so the active tab never rests on colour alone (WCAG 1.4.1). */}
              <span
                className={cn(
                  'relative flex h-8 w-14 items-center justify-center rounded-full transition-colors',
                  isActive && 'bg-primary/10',
                )}
              >
                <span className="relative">
                  <Icon className="size-6" aria-hidden="true" />
                  {item.badge}
                </span>
              </span>
              <span className="w-full truncate text-center leading-none">{item.label}</span>
            </Link>
          )
        })}
      </nav>

      <MobileMenu
        open={menuOpen}
        onOpenChange={setMenuOpen}
        groups={groups}
        activeId={activeId}
        name={user.full_name}
        email={user.email}
        footer={topbarActions}
      />

      <CommandPalette
        groups={groups}
        role={user.role}
        open={commandOpen}
        onOpenChange={setCommandOpen}
        favorites={favorites}
        recent={recent}
        commands={commands}
      />
    </div>
  )
}
