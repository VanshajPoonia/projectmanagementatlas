'use client'

import * as React from 'react'
import Link from 'next/link'
import { PanelLeftClose, PanelLeftOpen, Clock, Star } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { navIcon } from './nav-icons'
import type { NavItem } from './nav-model'

export interface RecentItem {
  label: string
  href: string
}

export interface FavoriteItem {
  key: string
  label: string
  href: string
}

// Host-provided nav item, optionally carrying a badge (e.g. chat unread count).
export interface SidebarNavItem extends NavItem {
  badge?: React.ReactNode
}
export interface SidebarNavGroup {
  id: string
  label: string
  items: SidebarNavItem[]
}

interface AppSidebarProps {
  /** Already role/module-filtered by the host. */
  groups: SidebarNavGroup[]
  activeId: string | null
  collapsed: boolean
  onToggle: () => void
  /** Already resolved against what this viewer can actually see; see lib/favorites.ts. */
  favorites?: FavoriteItem[]
  recent?: RecentItem[]
  title?: string
}

export function AppSidebar({
  groups,
  activeId,
  collapsed,
  onToggle,
  favorites = [],
  recent = [],
  title = 'Project Manager',
}: AppSidebarProps) {
  return (
    <TooltipProvider delayDuration={0}>
      <nav
        aria-label="Primary"
        data-collapsed={collapsed}
        className={cn(
          'bg-sidebar text-sidebar-foreground border-sidebar-border sticky top-0 hidden h-dvh shrink-0 flex-col border-r md:flex',
          'motion-safe:transition-[width] motion-safe:duration-200',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <div className="flex h-14 items-center gap-2 px-3">
          <div className="bg-primary text-primary-foreground flex size-8 shrink-0 items-center justify-center rounded-lg font-semibold">
            {title.charAt(0)}
          </div>
          {!collapsed && <span className="truncate font-semibold">{title}</span>}
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={onToggle}
            className="ml-auto"
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-expanded={!collapsed}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </Button>
        </div>

        <div className="flex-1 overflow-y-auto px-2 py-2">
          {groups.map((group) => (
            <div key={group.id} className="mb-4">
              {!collapsed && (
                <p className="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
                  {group.label}
                </p>
              )}
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const Icon = navIcon(item.icon)
                  const isActive = item.id === activeId
                  const link = (
                    <Link
                      href={item.href}
                      aria-current={isActive ? 'page' : undefined}
                      className={cn(
                        'group relative flex items-center gap-3 rounded-md px-2 py-2 text-sm font-medium outline-none',
                        'focus-visible:ring-ring focus-visible:ring-2',
                        isActive
                          ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                          : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
                        collapsed && 'justify-center',
                      )}
                    >
                      <span className="relative shrink-0">
                        <Icon className="size-4" aria-hidden="true" />
                        {item.badge}
                      </span>
                      {/*
                        The label is always in the DOM, only visually hidden when the rail is
                        collapsed. Rendering it conditionally left every collapsed nav link
                        with no accessible name — the icon is aria-hidden and the tooltip is
                        not mounted until hover, so a screen reader announced eight
                        indistinguishable "link"s. Caught by a11y.test.tsx.
                      */}
                      <span className={cn('truncate', collapsed && 'sr-only')}>{item.label}</span>
                      {item.status === 'planned' && (
                        <span
                          className={cn(
                            'text-muted-foreground ml-auto text-[10px] font-normal',
                            collapsed && 'sr-only',
                          )}
                        >
                          soon
                        </span>
                      )}
                    </Link>
                  )
                  return (
                    <li key={item.id}>
                      {collapsed ? (
                        <Tooltip>
                          <TooltipTrigger asChild>{link}</TooltipTrigger>
                          <TooltipContent side="right">{item.label}</TooltipContent>
                        </Tooltip>
                      ) : (
                        link
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          ))}

          {/*
            Favourites sit above Recent deliberately. Recent is what the app noticed you
            doing; Favourites is what you told it to keep. The curated list should not be
            pushed down the page by an automatic one.
          */}
          {favorites.length > 0 && !collapsed && (
            <SidebarLinkList
              heading="Favourites"
              icon={Star}
              items={favorites.map((f) => ({ key: f.key, label: f.label, href: f.href }))}
              iconClassName="text-amber-500 fill-current"
            />
          )}

          {recent.length > 0 && !collapsed && (
            <SidebarLinkList
              heading="Recent"
              icon={Clock}
              items={recent.slice(0, 5).map((r) => ({ key: r.href, label: r.label, href: r.href }))}
            />
          )}
        </div>
      </nav>
    </TooltipProvider>
  )
}

/**
 * The secondary sidebar lists (Favourites, Recent). Same markup, same focus treatment — one
 * component so the two cannot drift into looking like different kinds of thing.
 */
function SidebarLinkList({
  heading,
  icon: Icon,
  items,
  iconClassName,
}: {
  heading: string
  icon: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }>
  items: Array<{ key: string; label: string; href: string }>
  iconClassName?: string
}) {
  return (
    <div className="mb-4">
      <p className="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
        {heading}
      </p>
      <ul className="space-y-0.5">
        {items.map((item) => (
          <li key={item.key}>
            <Link
              href={item.href}
              className="text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground focus-visible:ring-ring flex items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-2"
            >
              <Icon className={cn('size-4 shrink-0', iconClassName)} aria-hidden={true} />
              <span className="truncate">{item.label}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}
