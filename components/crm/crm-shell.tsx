'use client'

// The chrome every CRM screen sits in.
//
// It reuses AppShell rather than reproducing the mockup's own sidebar: the mockup was drawn
// as a standalone prototype, but shipping a second, differently-shaped sidebar inside one
// product would mean two navigation models and two mental maps. The mockup's OPERATIONS /
// ADMINISTRATION split survives as a sub-nav across the top of the module, which is where it
// belongs — it groups pages *within* CRM, not within the app.

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { AppShell } from '@/components/shell/app-shell'
import { buildWorkspaceNav } from '@/components/shell/workspace-nav'
import { ThemeControls } from '@/components/theme/theme-controls'
import { useAppModules } from '@/lib/modules'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useFavorites } from '@/lib/use-favorites'
import { cn } from '@/lib/utils'
import type { Crumb } from '@/components/shell/breadcrumbs'

export interface CrmUser {
  id: string
  role: 'user' | 'admin' | 'super_admin'
  full_name?: string | null
  email?: string | null
}

interface CrmNavEntry {
  href: string
  label: string
  /** Admin-only pages are hidden rather than disabled — a link you cannot use is noise. */
  adminOnly?: boolean
}

const OPERATIONS: CrmNavEntry[] = [
  { href: '/crm', label: 'Dashboard' },
  { href: '/crm/clients', label: 'Clients' },
  { href: '/crm/clients/new', label: 'New Client' },
  { href: '/crm/orders', label: 'Orders' },
]

const ADMINISTRATION: CrmNavEntry[] = [
  { href: '/crm/reports', label: 'Cycle Time', adminOnly: true },
]

export function CrmShell({
  user,
  breadcrumbs,
  children,
}: {
  user: CrmUser
  breadcrumbs: Crumb[]
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  const basePath = isAdmin ? '/admin' : '/dashboard'

  const modules = useAppModules()
  const { calendars } = useMarketingCalendars()
  const favoriteBoardHref = useCallback((id: string) => `${basePath}/board/${id}`, [basePath])
  const { resolved: favoriteItems } = useFavorites(user.id, { boardHref: favoriteBoardHref })

  const groups = useMemo(
    () =>
      buildWorkspaceNav({
        role: user.role,
        modules,
        canUseMarketingCalendar: isAdmin || calendars.length > 0,
      }),
    [user.role, modules, isAdmin, calendars.length],
  )

  const sections: { label: string; entries: CrmNavEntry[] }[] = [
    { label: 'Operations', entries: OPERATIONS },
    { label: 'Administration', entries: ADMINISTRATION.filter(e => !e.adminOnly || isAdmin) },
  ]

  return (
    <AppShell
      user={user}
      groups={groups}
      activeId="crm"
      breadcrumbs={breadcrumbs}
      favorites={favoriteItems}
      topbarActions={<ThemeControls />}
    >
      {/* AppShell's <main> is deliberately unpadded; every host supplies its own.
          Without this the CRM content sat flush against the sidebar and clipped. */}
      <div className="w-full space-y-6 p-4 md:p-6">
        <nav aria-label="CRM sections" className="flex flex-wrap items-center gap-x-6 gap-y-2">
          {sections.map(section =>
            section.entries.length ? (
              <div key={section.label} className="flex items-center gap-2">
                <span className="text-muted-foreground text-[11px] font-semibold tracking-wide uppercase">
                  {section.label}
                </span>
                <div className="bg-muted flex items-center gap-1 rounded-full p-1">
                  {section.entries.map(entry => {
                    // /crm must not light up on /crm/clients, but /crm/clients should stay lit
                    // on /crm/clients/<id>.
                    const active =
                      entry.href === '/crm'
                        ? pathname === '/crm'
                        : pathname === entry.href ||
                          (pathname.startsWith(`${entry.href}/`) && entry.href !== '/crm/clients/new')
                    return (
                      <Link
                        key={entry.href}
                        href={entry.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'focus-visible:ring-ring rounded-full px-3 py-1.5 text-xs font-medium transition-colors outline-none focus-visible:ring-2',
                          active
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground',
                        )}
                      >
                        {entry.label}
                      </Link>
                    )
                  })}
                </div>
              </div>
            ) : null,
          )}
        </nav>

        {children}
      </div>
    </AppShell>
  )
}
