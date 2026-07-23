'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from '@/components/ui/command'
import { visibleGroups, type Role } from './nav-model'
import { navIcon } from './nav-icons'

interface CommandPaletteProps {
  role: Role
  enabledModules: ReadonlySet<string>
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Keyboard-first command palette (Cmd/Ctrl+K). This first slice covers Navigate;
 * Create / Change-status / Assign / Run-automation actions land as those domains
 * are built (see docs/design/information-architecture.md).
 */
export function CommandPalette({ role, enabledModules, open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter()
  const groups = visibleGroups(role, enabledModules)

  // Global Cmd/Ctrl+K toggle.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  const go = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput placeholder="Search or jump to…" />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {groups.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {group.items.map((item) => {
              const Icon = navIcon(item.icon)
              return (
                <CommandItem
                  key={item.id}
                  value={`${group.label} ${item.label}`}
                  onSelect={() => go(item.href)}
                >
                  <Icon aria-hidden="true" />
                  <span>{item.label}</span>
                  {item.status === 'planned' && <CommandShortcut>soon</CommandShortcut>}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
