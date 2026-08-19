'use client'

// The chrome every CRM screen sits in.
//
// It reuses AppShell rather than reproducing the mockup's own sidebar: the mockup was drawn
// as a standalone prototype, but shipping a second, differently-shaped sidebar inside one
// product would mean two navigation models and two mental maps. The mockup's OPERATIONS /
// ADMINISTRATION split survives as a sub-nav across the top of the module, which is where it
// belongs - it groups pages *within* CRM, not within the app.

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

import { AppShell } from '@/components/shell/app-shell'
import { buildWorkspaceNav } from '@/components/shell/workspace-nav'
import { buildCreateCommands, type Command } from '@/components/shell/commands'
import { allows } from '@/lib/capabilities'
import { ThemeControls } from '@/components/theme/theme-controls'
import { useAppModules } from '@/lib/modules'
import type { ShellData } from '@/lib/shell-data'
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
  /** Admin-only pages are hidden rather than disabled - a link you cannot use is noise. */
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
  shell,
  children,
}: {
  user: CrmUser
  breadcrumbs: Crumb[]
  /**
   * Modules + marketing calendars from requireCrmAccess, which already had to read
   * app_modules to decide whether to let you in at all. Without it this shell painted the
   * fallback nav - CRM itself missing from its own sidebar - until the browser re-fetched
   * the same table. See lib/shell-data.ts.
   */
  shell?: ShellData
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const isAdmin = user.role === 'admin' || user.role === 'super_admin'
  const basePath = isAdmin ? '/admin' : '/dashboard'

  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)
  const favoriteBoardHref = useCallback((id: string) => `${basePath}/board/${id}`, [basePath])
  const { resolved: favoriteItems } = useFavorites(user.id, { boardHref: favoriteBoardHref })

  const groups = useMemo(
    () =>
      buildWorkspaceNav({
        role: user.role,
        modules,
        canUseMarketingCalendar: isAdmin || calendars.length > 0,
        // Same capability the admin dashboard resolves. Omitting it here gave the same
        // admin a different sidebar depending on which screen they happened to be on.
        canViewAudit: allows({ userId: user.id, platformRole: user.role }, 'audit.view'),
      }),
    [user.role, user.id, modules, isAdmin, calendars.length],
  )

  // ⌘K's Create section - absent from this shell entirely until now.
  const paletteCommands: Command[] = useMemo(
    () => buildCreateCommands({ role: user.role, modules }),
    [user.role, modules],
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
      commands={paletteCommands}
      topbarActions={<ThemeControls />}
    >
      {/* AppShell's <main> is deliberately unpadded; every host supplies its own.
          Without this the CRM content sat flush against the sidebar and clipped. */}
      <div className="w-full space-y-5 p-4 md:space-y-6 md:p-6">
        {/*
          One scrolling row on a phone, the two labelled groups on a desktop.

          Wrapping was costing a third of a 390px viewport: the OPERATIONS and ADMINISTRATION
          labels forced each pill group onto its own line, so a phone showed 300px of
          navigation before the first word of the page. The labels are what has to go - they
          group five links, and on a screen this narrow the grouping is not worth the height.
          Their information survives as `aria-label`ed groups for a screen reader, which never
          had to see the layout in the first place.
        */}
        <nav
          aria-label="CRM sections"
          className="-mx-4 flex snap-x items-center gap-1 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:gap-x-6 md:gap-y-2 md:overflow-visible md:px-0 md:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sections.map(section =>
            section.entries.length ? (
              <div
                key={section.label}
                role="group"
                aria-label={section.label}
                className="flex shrink-0 items-center gap-2"
              >
                <span className="text-muted-foreground hidden text-[11px] font-semibold tracking-wide uppercase md:inline">
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
                          'focus-visible:ring-ring flex snap-start items-center rounded-full px-3.5 py-2 text-xs font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 md:py-1.5',
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
