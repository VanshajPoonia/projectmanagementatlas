'use client'

/**
 * Work item types - the super-admin screen for migration 113.
 *
 * This exists because of the lesson CLAUDE.md records three separate times: `app_modules` had
 * a policy, a grant and two seeded rows with no writer at all, and `board_members.role` had a
 * fully verified RLS harness while no UI could set the role. A vocabulary of eleven types that
 * only psql can switch on is the same defect a third time. So the screen ships with the
 * migration, not after it.
 *
 * Writes ask for their rows back and compare the count, because an RLS refusal comes back as
 * zero rows and no error (lib/rls-write.ts).
 */

import { useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Lock, Shapes } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { classifyWrite, writeFailureMessage } from '@/lib/rls-write'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import {
  deactivationBlockedReason,
  type WorkItemType,
} from '@/lib/work-item-type-registry'
import { useWorkItemTypeList } from '@/lib/work-item-types'

export default function WorkItemTypeManagement() {
  const supabase = createClient()
  // includeInactive: this is the one screen that must show the nine types nobody has switched
  // on yet - they are exactly what it exists to manage.
  const { types, refetch } = useWorkItemTypeList({ includeInactive: true })
  const statuses = useTaskStatuses()
  const [usage, setUsage] = useState<Record<string, number>>({})
  const [busyKey, setBusyKey] = useState<string | null>(null)

  // How much work already carries each type. Drives the "N work items still use this" warning.
  //
  // ⚠️ This count is RLS-FILTERED and can only UNDERSTATE. `private.task_hidden_by_board_privacy`
  // has no admin bypass, so a super admin who is not a member of a private board does not see
  // its tasks here. That is acceptable precisely because the number is advisory - nothing is
  // blocked on it, and deactivating a type never invalidates work that already holds it. It
  // must not become an input to a decision ("safe to delete, nothing uses it"): for that, the
  // honest answer needs a SECURITY DEFINER counter, the way public.board_column_task_count
  // had to be written for column deletion.
  useEffect(() => {
    let active = true
    const load = async () => {
      const counts: Record<string, number> = {}
      await Promise.all(
        (types ?? []).map(async (t) => {
          const { count } = await supabase
            .from('tasks')
            .select('id', { count: 'exact', head: true })
            .eq('type_key', t.key)
            .is('deleted_at', null)
          counts[t.key] = count ?? 0
        }),
      )
      if (active) setUsage(counts)
    }
    if (types?.length) void load()
    return () => { active = false }
  }, [types, supabase])

  const activeTypes = useMemo(() => (types ?? []).filter((t) => t.is_active), [types])
  const inactiveTypes = useMemo(() => (types ?? []).filter((t) => !t.is_active), [types])

  async function patch(type: WorkItemType, changes: Partial<WorkItemType>, what: string) {
    setBusyKey(type.key)
    const outcome = await classifyWrite(
      await supabase.from('work_item_types').update(changes).eq('key', type.key).select('key'),
    )
    setBusyKey(null)

    const failure = writeFailureMessage(outcome, what)
    if (failure) {
      toast.error(failure.title, { description: failure.description })
      return
    }
    toast.success(`${type.name} updated`)
    await refetch()
  }

  async function toggleActive(type: WorkItemType) {
    if (type.is_active) {
      // The database refuses this for a system type; say so before the round trip rather than
      // surfacing a raw Postgres exception.
      if (type.is_system) {
        toast.error(`${type.name} is built in`, {
          description: 'Every existing work item would point at a type no picker offers.',
        })
        return
      }
      const warning = deactivationBlockedReason(type, usage[type.key] ?? 0)
      if (warning) toast.info(`${type.name} switched off`, { description: warning })
    }
    await patch(type, { is_active: !type.is_active }, 'update')
  }

  const renderRow = (type: WorkItemType) => {
    const inUse = usage[type.key] ?? 0
    return (
      <div key={type.key} className="rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-4 w-4 shrink-0 rounded-full" style={{ backgroundColor: type.color }} />
            <span className="truncate font-medium">{type.name}</span>
            <code className="hidden text-xs text-muted-foreground sm:inline">{type.key}</code>
            {type.is_system && (
              <Badge variant="secondary" className="gap-1 text-[11px] font-normal">
                <Lock className="h-3 w-3" />
                Built in
              </Badge>
            )}
            {inUse > 0 && (
              <Badge variant="outline" className="text-[11px] font-normal text-muted-foreground">
                {inUse} in use
              </Badge>
            )}
          </div>

          <Button
            size="sm"
            variant={type.is_active ? 'outline' : 'default'}
            className="shrink-0"
            disabled={busyKey === type.key || type.is_system}
            onClick={() => toggleActive(type)}
            aria-label={`${type.is_active ? 'Switch off' : 'Switch on'} ${type.name}`}
          >
            {busyKey === type.key ? 'Saving…' : type.is_active ? 'Switch off' : 'Switch on'}
          </Button>
        </div>

        {type.description && (
          <p className="mt-1.5 text-sm text-muted-foreground">{type.description}</p>
        )}

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={`status-${type.key}`}>Starts as</Label>
            <Select
              value={type.default_status_key ?? '__none__'}
              onValueChange={(v) =>
                patch(type, { default_status_key: v === '__none__' ? null : v }, 'update')}
              disabled={busyKey === type.key}
            >
              <SelectTrigger id={`status-${type.key}`} className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Board default</SelectItem>
                {statuses.map((s) => (
                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Can have subtasks</Label>
            <Button
              type="button"
              size="sm"
              variant={type.can_have_children ? 'default' : 'outline'}
              className="h-9 w-full"
              disabled={busyKey === type.key}
              aria-pressed={type.can_have_children}
              onClick={() => patch(type, { can_have_children: !type.can_have_children }, 'update')}
            >
              {type.can_have_children ? 'Yes' : 'No'}
            </Button>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Can be a subtask</Label>
            <Button
              type="button"
              size="sm"
              variant={type.can_be_child ? 'default' : 'outline'}
              className="h-9 w-full"
              disabled={busyKey === type.key}
              aria-pressed={type.can_be_child}
              onClick={() => patch(type, { can_be_child: !type.can_be_child }, 'update')}
            >
              {type.can_be_child ? 'Yes' : 'No'}
            </Button>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={`name-${type.key}`}>Name</Label>
            <Input
              id={`name-${type.key}`}
              className="h-9"
              defaultValue={type.name}
              disabled={busyKey === type.key}
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next && next !== type.name) void patch(type, { name: next }, 'rename')
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs" htmlFor={`color-${type.key}`}>Colour</Label>
            <input
              id={`color-${type.key}`}
              type="color"
              className="h-9 w-14 cursor-pointer rounded border"
              defaultValue={type.color}
              disabled={busyKey === type.key}
              onBlur={(e) => {
                if (e.target.value !== type.color) void patch(type, { color: e.target.value }, 'update')
              }}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Shapes className="h-5 w-5" />
          Work Item Types
        </CardTitle>
        <CardDescription>
          Every task, bug, request and risk is the same record with a different type - one board,
          one list, one calendar, one set of reports. Switching a type on makes it choosable when
          creating work; switching it off hides it from the pickers without changing anything
          that already uses it.
          <br />
          <strong>Can have subtasks</strong> and <strong>can be a subtask</strong> are enforced in
          the database, not just here. Subtasks are still limited to one level deep whatever these
          say.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="space-y-2">
          <div className="text-xs font-medium text-muted-foreground">
            On ({activeTypes.length})
          </div>
          {activeTypes.map(renderRow)}
        </div>

        {inactiveTypes.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="text-xs font-medium text-muted-foreground">
              Off ({inactiveTypes.length}) - present and editable, offered nowhere
            </div>
            {inactiveTypes.map(renderRow)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
