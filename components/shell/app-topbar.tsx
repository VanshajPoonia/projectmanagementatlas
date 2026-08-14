'use client'

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { Search, LogOut } from 'lucide-react'

import { createClient } from '@/lib/supabase/client'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ThemeControls } from '@/components/theme/theme-controls'
import { Breadcrumbs, type Crumb } from './breadcrumbs'
import { HelpDialog } from './help-dialog'

interface AppTopbarProps {
  user: { full_name?: string | null; email?: string | null }
  breadcrumbs: Crumb[]
  onOpenCommand: () => void
  /** Host-supplied right-side controls (e.g. accent picker, account settings). When
   *  provided they replace the default theme+account cluster; the ⌘K entry stays. */
  actions?: React.ReactNode
}

function initials(name?: string | null, email?: string | null): string {
  const src = (name || email || '?').trim()
  const parts = src.split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return src.slice(0, 2).toUpperCase()
}

export function AppTopbar({ user, breadcrumbs, onOpenCommand, actions }: AppTopbarProps) {
  const router = useRouter()

  const signOut = async () => {
    await createClient().auth.signOut()
    router.push('/login')
  }

  return (
    // Tighter gaps and padding below `sm`. At a 320px viewport — the WCAG 1.4.10 reflow
    // target, equivalent to 320% zoom on a 1024px screen — the full-size spacing pushed the
    // action cluster 76px past the viewport and made the whole page scroll sideways.
    <header className="bg-background/80 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 flex h-14 items-center gap-1.5 border-b px-2 backdrop-blur sm:gap-3 sm:px-4">
      <div className="min-w-0 flex-1">
        <Breadcrumbs items={breadcrumbs} />
      </div>

      <Button
        variant="outline"
        size="sm"
        onClick={onOpenCommand}
        className="text-muted-foreground gap-2"
        aria-label="Open command palette"
      >
        <Search className="size-4" />
        <span className="hidden sm:inline">Search</span>
        <kbd className="bg-muted text-muted-foreground pointer-events-none hidden rounded border px-1.5 font-mono text-[10px] sm:inline">
          ⌘K
        </kbd>
      </Button>

      <HelpDialog />

      {actions ?? (
        <>
          <ThemeControls />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2" aria-label="Account menu">
                <Avatar className="size-8">
                  <AvatarFallback>{initials(user.full_name, user.email)}</AvatarFallback>
                </Avatar>
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuLabel className="truncate font-normal">
                <span className="block font-medium">{user.full_name || 'Account'}</span>
                {user.email && <span className="text-muted-foreground block truncate text-xs">{user.email}</span>}
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="size-4" />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}
    </header>
  )
}
