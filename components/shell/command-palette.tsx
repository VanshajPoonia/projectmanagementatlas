'use client'

import { useEffect, useMemo, useState } from 'react'
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
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { navIcon } from './nav-icons'
import {
  buildFavoriteCommands,
  buildNavigationCommands,
  buildRecentCommands,
  groupCommands,
  runCommand,
  type Command,
} from './commands'
import type { FavoriteItem } from './app-sidebar'
import type { NavGroup } from './nav-model'
import type { RecentRecord } from './recent-records'

interface CommandPaletteProps {
  /** Already role/module-filtered by the host (same groups as the sidebar). */
  groups: NavGroup[]
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Starred boards, already resolved against what this viewer can open. */
  favorites?: FavoriteItem[]
  /** Recently viewed records, newest first. */
  recent?: RecentRecord[]
  /**
   * Host-supplied commands: Create actions the host can actually perform, plus any
   * context actions for what is currently open. Each carries its own CapabilityDecision,
   * which is what stops the palette becoming an unguarded second route to an action.
   */
  commands?: Command[]
}

interface SearchHit {
  id: string
  title: string
  boardId: string | null
  boardTitle: string | null
}

/** Below this the result set is everything and typing hasn't narrowed anything yet. */
const MIN_QUERY = 2
const SEARCH_LIMIT = 6

/**
 * Keyboard-first command palette (⌘K / Ctrl+K).
 *
 * Sections follow the plan's Power-K-inspired model: Recent, Go to, Search results,
 * Create, and context actions for whatever is currently open. Search queries live work
 * through the session client, so RLS decides what a given person can find - the palette
 * cannot surface a task its user could not already open.
 */
export function CommandPalette({
  groups,
  open,
  onOpenChange,
  favorites = [],
  recent = [],
  commands = [],
}: CommandPaletteProps) {
  const router = useRouter()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)

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

  // Reset between openings so the palette never opens showing the previous search.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setHits([])
    }
  }, [open])

  // Debounced live search. Runs through the session client on purpose: RLS is what
  // decides which tasks come back, so a private board stays invisible here too.
  useEffect(() => {
    const term = query.trim()
    if (!open || term.length < MIN_QUERY) {
      setHits([])
      setSearching(false)
      return
    }

    let active = true
    setSearching(true)
    const timer = setTimeout(async () => {
      const { data } = await createClient()
        .from('tasks')
        .select('id, title, column:columns(board_id, board:boards(id, title, archived_at))')
        .ilike('title', `%${term}%`)
        .is('deleted_at', null)
        .limit(20)

      if (!active) return
      const rows = (data ?? [])
        .filter((task: any) => task.column?.board && !task.column.board.archived_at)
        .slice(0, SEARCH_LIMIT)
        .map((task: any) => ({
          id: task.id,
          title: task.title,
          boardId: task.column?.board_id ?? null,
          boardTitle: task.column?.board?.title ?? null,
        }))
      setHits(rows)
      setSearching(false)
    }, 180)

    return () => {
      active = false
      clearTimeout(timer)
    }
  }, [query, open])

  const searchCommands: Command[] = useMemo(
    () =>
      hits.map((hit) => ({
        id: `search:${hit.id}`,
        group: 'search' as const,
        label: hit.title,
        hint: hit.boardTitle ?? undefined,
        icon: 'search',
        href: hit.boardId ? `/dashboard/board/${hit.boardId}` : undefined,
      })),
    [hits],
  )

  const rendered = useMemo(
    () =>
      groupCommands([
        ...buildFavoriteCommands(favorites),
        ...buildRecentCommands(recent),
        ...buildNavigationCommands(groups),
        ...searchCommands,
        ...commands,
      ]),
    [favorites, recent, groups, searchCommands, commands],
  )

  const navigate = (href: string) => {
    onOpenChange(false)
    router.push(href)
  }

  return (
    <CommandDialog open={open} onOpenChange={onOpenChange}>
      <CommandInput
        placeholder="Search work, jump to a section, or create something…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        <CommandEmpty>
          {searching
            ? 'Searching…'
            : query.trim().length >= MIN_QUERY
              ? 'Nothing matched. Try a different word, or check you have access to that board.'
              : 'Type to search your work.'}
        </CommandEmpty>

        {rendered.map((group) => (
          <CommandGroup key={group.id} heading={group.label}>
            {group.commands.map((command) => {
              const Icon = navIcon(command.icon)
              return (
                <CommandItem
                  key={command.id}
                  // cmdk matches on `value`; folding in the hint and keywords is what
                  // makes "launch board" find a task by its board name.
                  value={[command.label, command.hint, ...(command.keywords ?? [])]
                    .filter(Boolean)
                    .join(' ')}
                  disabled={command.disabled}
                  onSelect={() => {
                    // Belt and braces: `disabled` already blocks selection, and
                    // runCommand refuses a denied command regardless of how it was
                    // reached. RLS is still what refuses the write itself.
                    if (runCommand(command, navigate)) onOpenChange(false)
                  }}
                  className={cn(command.disabled && 'opacity-60')}
                >
                  <Icon aria-hidden="true" />
                  <span className="truncate">{command.label}</span>
                  {(command.unavailableReason || command.hint) && (
                    <CommandShortcut className="max-w-56 truncate normal-case">
                      {command.unavailableReason ?? command.hint}
                    </CommandShortcut>
                  )}
                </CommandItem>
              )
            })}
          </CommandGroup>
        ))}
      </CommandList>
    </CommandDialog>
  )
}
