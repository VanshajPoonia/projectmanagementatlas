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
import { navIcon } from './nav-icons'
import type { NavGroup } from './nav-model'

interface CommandPaletteProps {
  /** Already role/module-filtered by the host (same groups as the sidebar). */
  groups: NavGroup[]
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Keyboard-first command palette (Cmd/Ctrl+K). This slice covers Navigate; Create /
 * Change-status / Assign / Run-automation land as those domains are built.
 */
export function CommandPalette({ groups, open, onOpenChange }: CommandPaletteProps) {
  const router = useRouter()

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
