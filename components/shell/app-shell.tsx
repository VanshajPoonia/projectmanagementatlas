'use client'

import * as React from 'react'
import { useState } from 'react'
import Link from 'next/link'
import { MoreHorizontal } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer'
import { AppSidebar, type FavoriteItem, type SidebarNavGroup } from './app-sidebar'
import { AppTopbar } from './app-topbar'
import { CommandPalette } from './command-palette'
import { DensityToggle } from './density-toggle'
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
  const [moreOpen, setMoreOpen] = useState(false)

  const essentials = (mobileItems ?? groups[0]?.items ?? []).slice(0, 5)
  const everyItem = groups.flatMap((g) => g.items)
  // Five fixed tabs hid everything else on a phone, since the sidebar is desktop-only. When the
  // workspace has more than five places to go, the fifth tab becomes a More drawer holding all of them.
  const needsMore = everyItem.length > 5
  const mobile = needsMore ? essentials.slice(0, 4) : essentials
  const moreActive = needsMore && !mobile.some((i) => i.id === activeId) && everyItem.some((i) => i.id === activeId)

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
        <main id="app-main" className="flex-1 pb-20 md:pb-0" tabIndex={-1}>
          {typeof children === 'function' ? children(density) : children}
        </main>
      </div>

      <nav
        aria-label="Primary"
        className="bg-background/95 fixed inset-x-0 bottom-0 z-40 flex items-stretch border-t pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
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
                // min-w-0 so five labels share a 320px screen by truncating rather than
                // forcing the whole page to scroll sideways - measured at the WCAG 1.4.10
                // reflow width, where "Marketing" alone pushed the bar 29px past the viewport.
                'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium sm:text-xs',
                isActive ? 'text-primary font-semibold' : 'text-muted-foreground',
              )}
            >
              {/*
                A shape, not just a colour. The active tab used to be marked by `text-primary`
                alone, which is the one cue WCAG 1.4.1 says may not stand on its own - and it
                disappears entirely for anyone whose accent happens to sit near the muted
                foreground. aria-current already carried this for assistive tech; this is the
                visual half of the same statement.
              */}
              {isActive && (
                <span
                  className="bg-primary absolute inset-x-3 top-0 h-0.5 rounded-full"
                  aria-hidden="true"
                />
              )}
              <span className="relative">
                <Icon className="size-5" aria-hidden="true" />
                {item.badge}
              </span>
              <span className="w-full truncate text-center leading-none">{item.label}</span>
            </Link>
          )
        })}
        {needsMore && (
          <button
            type="button"
            onClick={() => setMoreOpen(true)}
            aria-haspopup="dialog"
            aria-current={moreActive ? 'page' : undefined}
            className={cn(
              'relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-[11px] font-medium sm:text-xs',
              moreActive ? 'text-primary font-semibold' : 'text-muted-foreground',
            )}
          >
            {moreActive && <span className="bg-primary absolute inset-x-3 top-0 h-0.5 rounded-full" aria-hidden="true" />}
            <MoreHorizontal className="size-5" aria-hidden="true" />
            <span className="w-full truncate text-center leading-none">More</span>
          </button>
        )}
      </nav>

      {needsMore && (
        <Drawer open={moreOpen} onOpenChange={setMoreOpen}>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Everything</DrawerTitle>
            </DrawerHeader>
            <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
              {groups.map((group) => (
                <section key={group.id} aria-label={group.label}>
                  <h3 className="text-muted-foreground mb-2 text-xs font-semibold uppercase">{group.label}</h3>
                  <div className="grid grid-cols-3 gap-2">
                    {group.items.map((item) => {
                      const Icon = navIcon(item.icon)
                      const isActive = item.id === activeId
                      return (
                        <Link
                          key={item.id}
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'flex min-w-0 flex-col items-center justify-center gap-2 rounded-lg border p-3 text-center text-xs font-medium transition-colors',
                            isActive ? 'border-primary text-primary bg-primary/5' : 'border-border text-foreground hover:bg-accent',
                          )}
                        >
                          <span className="relative">
                            <Icon className="size-5" aria-hidden="true" />
                            {item.badge}
                          </span>
                          <span className="w-full truncate">{item.label}</span>
                        </Link>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>
          </DrawerContent>
        </Drawer>
      )}

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
