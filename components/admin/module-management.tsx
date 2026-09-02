'use client'

// Module activation.
//
// ⚠️ This tab exists because until it did, `app_modules` was read by four call sites and
// written by none. Migration 066 gave the table an "Admins manage modules" policy and a full
// DML grant, 080 seeded `appointments` disabled and 103 seeded `crm` disabled - and there was
// no screen anywhere that could turn either of them on. Both modules were reachable only by
// hand-written SQL, which is the same defect CLAUDE.md records against the guest/client work:
// a capability verified at the database that no human can actually reach.
//
// Deliberately a plain list of toggles with no grouping or search. There are eleven rows and
// there will not be many more; a filter over eleven items is furniture, not help.

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_MODULES, type ModuleKey } from '@/lib/modules'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { AgileInfoButton } from '@/components/agile/agile-info'
import { StrategyInfoButton } from '@/components/strategy/strategy-info'

interface ModuleRow {
  module_key: ModuleKey
  enabled: boolean
}

/**
 * What each key actually controls, in the terms a super admin would use to decide. Without
 * this a toggle labelled "project_ids" asks someone to guess what it switches off for ten
 * people. Anything not listed still renders, using its raw key.
 */
const MODULE_COPY: Record<string, { label: string; description: string }> = {
  boards: { label: 'Boards', description: 'Kanban and list views of every task board.' },
  personal_tasks: { label: 'Personal tasks', description: 'The private task list each person keeps for themselves.' },
  chat: { label: 'Chat', description: 'Direct messages and group conversations.' },
  calendar: { label: 'Calendar', description: 'The month and week view of tasks with due dates.' },
  bookmarks: { label: 'Bookmarks', description: 'Shared and personal links pinned to the dashboard.' },
  marketing_calendar: { label: 'Marketing calendar', description: 'Channel scheduling and the posted/missed check-off grid.' },
  reports: { label: 'Reports', description: 'Filtered reporting across boards and tasks.' },
  ai_assistant: { label: 'AI assistant', description: 'The chat widget with function-calling over live data.' },
  appointments: { label: 'Appointments', description: 'Public booking pages and the appointment schedule.' },
  project_ids: { label: 'Project IDs', description: 'The claim-a-number ledger for project references.' },
  agile: { label: 'Agile mode', description: 'Sprints/cycles, a backlog, WIP limits and sprint metrics - and only on the boards that opt in.' },
  strategy: { label: 'Strategy', description: 'Goals with outcome and execution kept separate, an idea pipeline, project purpose, SWOT, and retrospectives.' },
  crm: { label: 'CRM', description: 'Clients, contacts, orders, and the order status history the cycle-time reports are built on.' },
}

// `ai_assistant` and `bookmarks` render OUTSIDE the tab lists - the floating chat widget and the
// bookmarks rail - so they used to carry a badge here saying the toggle was not consumed yet.
// Both are gated at their render sites in user-dashboard.tsx and admin-dashboard.tsx now, so
// that badge was telling a super admin a working control did nothing. Removed rather than
// reworded: a switch labelled broken is a switch nobody touches, which is the same defect as a
// switch that really is broken, just harder to spot.

export default function ModuleManagement() {
  const supabase = useMemo(() => createClient(), [])
  const [modules, setModules] = useState<ModuleRow[] | null>(null)
  const [pending, setPending] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    supabase
      .from('app_modules')
      .select('module_key, enabled')
      // Typed explicitly: the thenable's callback parameter is untyped here, the same reason
      // lib/modules.ts annotates its own.
      .then(({ data, error }: { data: ModuleRow[] | null; error: { message: string } | null }) => {
        if (!active) return
        if (error) {
          toast.error(`Could not load the module list: ${error.message}`)
          setModules([])
          return
        }
        setModules(data ?? [])
      })
    return () => {
      active = false
    }
  }, [supabase])

  // Ordered by the registry rather than by whatever Postgres returned, so the list does not
  // reshuffle between visits.
  const ordered = useMemo(() => {
    if (!modules) return []
    const byKey = new Map(modules.map(m => [m.module_key, m]))
    const known = DEFAULT_MODULES.map(d => byKey.get(d.module_key) ?? { module_key: d.module_key, enabled: d.enabled })
    const extra = modules.filter(m => !DEFAULT_MODULES.some(d => d.module_key === m.module_key))
    return [...known, ...extra]
  }, [modules])

  async function toggle(row: ModuleRow) {
    if (pending) return
    setPending(row.module_key)
    const next = !row.enabled

    // Ask for the row back and count it. A refusal by RLS comes back as zero rows and no
    // error, so without this the UI would report success on a write that never happened -
    // the exact trap CLAUDE.md records against the board membership work.
    const { data, error } = await supabase
      .from('app_modules')
      .update({ enabled: next })
      .eq('module_key', row.module_key)
      .select('module_key, enabled')

    setPending(null)
    if (error) {
      toast.error(`Could not update ${MODULE_COPY[row.module_key]?.label ?? row.module_key}: ${error.message}`)
      return
    }
    if (!data?.length) {
      toast.error('That change was refused. Only a super admin can activate modules.')
      return
    }

    setModules(current =>
      (current ?? []).map(m => (m.module_key === row.module_key ? { ...m, enabled: next } : m)),
    )
    toast.success(
      `${MODULE_COPY[row.module_key]?.label ?? row.module_key} ${next ? 'switched on' : 'switched off'}.`,
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Modules</CardTitle>
        <CardDescription>
          Switch a whole area of the product on or off for everyone. A module that is off shows
          no navigation and refuses its own routes, so nobody lands on an empty page.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {modules === null ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))}
          </div>
        ) : (
          <ul className="divide-y rounded-lg border">
            {ordered.map(row => {
              const copy = MODULE_COPY[row.module_key]
              const busy = pending === row.module_key
              return (
                <li
                  key={row.module_key}
                  className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{copy?.label ?? row.module_key}</span>
                      {row.enabled ? (
                        <Badge variant="secondary">On</Badge>
                      ) : (
                        <Badge variant="outline" className="text-muted-foreground">Off</Badge>
                      )}
                      {/* ⚠️ Agile is the only module here whose switch does NOT activate the
                          thing it names: it makes /agile reachable and changes no board. Every
                          other switch on this screen turns its feature on outright, so that
                          exception is exactly the kind of surprise that becomes a support
                          question. It sits beside the name rather than trailing the description
                          so it is a real target, not a 20px afterthought inside a sentence. */}
                      {row.module_key === 'agile' && <AgileInfoButton />}
                      {row.module_key === 'strategy' && <StrategyInfoButton />}
                    </div>
                    {copy && (
                      <p className="text-muted-foreground mt-0.5 text-sm">{copy.description}</p>
                    )}
                  </div>
                  <Button
                    size="sm"
                    variant={row.enabled ? 'outline' : 'default'}
                    disabled={busy}
                    onClick={() => toggle(row)}
                    aria-label={`${row.enabled ? 'Switch off' : 'Switch on'} ${copy?.label ?? row.module_key}`}
                    className={cn('shrink-0', busy && 'opacity-70')}
                  >
                    {busy ? 'Saving…' : row.enabled ? 'Switch off' : 'Switch on'}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="text-muted-foreground mt-3 text-xs">
          Navigation is read once per page load, so anyone already signed in sees the change on
          their next refresh.
        </p>
      </CardContent>
    </Card>
  )
}
