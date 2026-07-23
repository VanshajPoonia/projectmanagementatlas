'use client'

import * as React from 'react'
import Link from 'next/link'
import { PanelLeftClose, PanelLeftOpen, Clock } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip'
import { navIcon } from './nav-icons'
import type { NavItem } from './nav-model'

export interface RecentItem {
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
  recent?: RecentItem[]
  title?: string
}

export function AppSidebar({
  groups,
  activeId,
  collapsed,
  onToggle,
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
                      {!collapsed && <span className="truncate">{item.label}</span>}
                      {!collapsed && item.status === 'planned' && (
                        <span className="text-muted-foreground ml-auto text-[10px] font-normal">soon</span>
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

          {recent.length > 0 && !collapsed && (
            <div className="mb-4">
              <p className="text-muted-foreground px-2 pb-1 text-xs font-medium tracking-wide uppercase">
                Recent
              </p>
              <ul className="space-y-0.5">
                {recent.slice(0, 5).map((r) => (
                  <li key={r.href}>
                    <Link
                      href={r.href}
                      className="text-sidebar-foreground/80 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground flex items-center gap-3 rounded-md px-2 py-1.5 text-sm outline-none focus-visible:ring-ring focus-visible:ring-2"
                    >
                      <Clock className="size-4 shrink-0" aria-hidden="true" />
                      <span className="truncate">{r.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </nav>
    </TooltipProvider>
  )
}
