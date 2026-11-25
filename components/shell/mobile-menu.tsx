'use client'

import * as React from 'react'
import Link from 'next/link'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { XIcon } from 'lucide-react'

import { cn } from '@/lib/utils'
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog'
import { navIcon } from './nav-icons'
import type { SidebarNavGroup } from './app-sidebar'

interface MobileMenuProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groups: SidebarNavGroup[]
  activeId: string | null
  /** Who is signed in, shown at the top. */
  name?: string | null
  email?: string | null
  /** The host's account controls (theme, account, sign out). They leave the top bar on a phone. */
  footer?: React.ReactNode
}

/** The phone version of the sidebar: every place in the app, one tap from the hamburger. */
export function MobileMenu({ open, onOpenChange, groups, activeId, name, email, footer }: MobileMenuProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className="bg-background data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left fixed inset-y-0 left-0 z-50 flex w-[min(20rem,85vw)] flex-col border-r shadow-lg duration-200 md:hidden"
        >
          <div className="flex items-center justify-between gap-3 border-b px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3">
            <div className="min-w-0">
              <DialogPrimitive.Title className="truncate text-base font-semibold">{name || 'Menu'}</DialogPrimitive.Title>
              {email && <p className="text-muted-foreground truncate text-xs">{email}</p>}
            </div>
            <DialogPrimitive.Close className="hover:bg-accent focus-visible:ring-ring -mr-2 rounded-md p-2 outline-none focus-visible:ring-2" aria-label="Close menu">
              <XIcon className="size-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          <nav aria-label="All pages" className="flex-1 space-y-4 overflow-y-auto px-2 py-3">
            {groups.map((group) => (
              <section key={group.id} aria-label={group.label}>
                <h2 className="text-muted-foreground mb-1 px-2 text-xs font-semibold uppercase">{group.label}</h2>
                <ul>
                  {group.items.map((item) => {
                    const Icon = navIcon(item.icon)
                    const isActive = item.id === activeId
                    return (
                      <li key={item.id}>
                        <Link
                          href={item.href}
                          onClick={() => onOpenChange(false)}
                          aria-current={isActive ? 'page' : undefined}
                          className={cn(
                            'flex min-h-12 items-center gap-3 rounded-md px-2 text-base font-medium transition-colors',
                            isActive ? 'bg-primary/10 text-primary font-semibold' : 'text-foreground hover:bg-accent',
                          )}
                        >
                          <span className="relative">
                            <Icon className="size-5" aria-hidden="true" />
                            {item.badge}
                          </span>
                          <span className="min-w-0 flex-1 truncate">{item.label}</span>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </nav>

          {footer && (
            <div className="flex flex-wrap items-center gap-2 border-t px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>
          )}
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  )
}
