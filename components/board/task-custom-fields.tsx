'use client'

/**
 * Custom fields on a work item - the consumer side of migration 114.
 *
 * Saves per field on blur rather than through the modal's Save button. Two reasons: the modal's
 * save writes `tasks` and these values live in another table, so batching them there would mean
 * one button reporting on two independent writes that can succeed and fail separately; and a
 * field cleared here has to be a DELETE, not an UPDATE, which does not fit a single patch
 * object.
 *
 * Every write asks for its row back and counts it - an RLS refusal comes back as zero rows and
 * no error, so without that a guest would be told their edit saved (lib/rls-write.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Table2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { classifyWrite, writeFailureMessage } from '@/lib/rls-write'
import {
  fieldsForTask,
  validateFieldValue,
  coerceInputValue,
  isEmptyValue,
  type FieldDefinition,
  type FieldType,
} from '@/lib/custom-fields'

const SELECT_COLUMNS =
  'id, key, name, description, field_type, config, is_required, scope, board_id, '
  + 'applies_to_types, position, is_archived'

interface TaskCustomFieldsProps {
  taskId: string
  boardId?: string | null
  typeKey?: string | null
  canEdit: boolean
  currentUserId: string
  users?: Array<{ id: string; full_name?: string | null; email?: string | null }>
}

export default function TaskCustomFields({
  taskId, boardId, typeKey, canEdit, currentUserId, users = [],
}: TaskCustomFieldsProps) {
  const supabase = createClient()
  const [definitions, setDefinitions] = useState<FieldDefinition[]>([])
  const [values, setValues] = useState<Record<string, unknown>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [loaded, setLoaded] = useState(false)

  const load = useCallback(async () => {
    const [{ data: defs }, { data: rows }] = await Promise.all([
      supabase.from('field_definitions').select(SELECT_COLUMNS)
        .order('position', { ascending: true }),
      supabase.from('field_values').select('field_id, value').eq('task_id', taskId),
    ])
    setDefinitions((defs ?? []) as unknown as FieldDefinition[])
    setValues(Object.fromEntries(
      ((rows ?? []) as Array<{ field_id: string; value: unknown }>).map((r) => [r.field_id, r.value]),
    ))
    setLoaded(true)
  }, [supabase, taskId])

  useEffect(() => { void load() }, [load])

  // An archived field stays on screen while this task still holds a value for it - the same
  // rule statusesForPicker follows, so a control never renders blank next to a stored answer.
  const applicable = useMemo(
    () => fieldsForTask(definitions, {
      boardId, typeKey, valuedFieldIds: Object.keys(values).filter((id) => !isEmptyValue(values[id])),
    }),
    [definitions, boardId, typeKey, values],
  )

  async function persist(definition: FieldDefinition, next: unknown) {
    const verdict = validateFieldValue(definition, next)
    if (!verdict.ok) {
      setErrors((e) => ({ ...e, [definition.id]: verdict.error ?? 'That value cannot be saved.' }))
      return
    }
    setErrors((e) => {
      const { [definition.id]: _drop, ...rest } = e
      return rest
    })

    // Clearing is a DELETE. Storing an explicit null would leave a row that means the same
    // thing as no row, and then "which tasks have this filled in" needs two conditions.
    const outcome = isEmptyValue(next)
      ? await classifyWrite(
        await supabase.from('field_values').delete()
          .eq('task_id', taskId).eq('field_id', definition.id).select('id'),
        // Deleting a value that was never set is not a refusal - there was simply nothing to
        // remove. Only treat zero rows as refusal when we believed a value existed.
        { expected: isEmptyValue(values[definition.id]) ? 0 : 1 },
      )
      : await classifyWrite(
        await supabase.from('field_values').upsert(
          { task_id: taskId, field_id: definition.id, value: next, updated_by: currentUserId },
          { onConflict: 'task_id,field_id' },
        ).select('id'),
      )

    if (outcome.kind === 'error') {
      // The trigger's message names the field and says exactly what is wrong; it is better
      // copy than anything this component could invent, so show it.
      setErrors((e) => ({ ...e, [definition.id]: outcome.message }))
      return
    }
    const failure = writeFailureMessage(outcome, 'field')
    if (failure) {
      toast.error(failure.title, { description: failure.description })
      await load()
      return
    }

    setValues((v) => ({ ...v, [definition.id]: isEmptyValue(next) ? null : next }))
  }

  function control(definition: FieldDefinition) {
    const value = values[definition.id]
    const id = `field-${definition.id}`
    const type: FieldType = definition.field_type
    const commit = (raw: string | boolean | string[] | null) =>
      persist(definition, coerceInputValue(type, raw))

    if (type === 'checkbox') {
      return (
        <Button
          id={id}
          type="button"
          variant={value ? 'default' : 'outline'}
          size="sm"
          className="h-9 w-24"
          aria-pressed={Boolean(value)}
          disabled={!canEdit}
          onClick={() => persist(definition, !value)}
        >
          {value ? 'Yes' : 'No'}
        </Button>
      )
    }

    if (type === 'select' || type === 'person') {
      const items = type === 'person'
        ? users.map((u) => ({ id: u.id, label: u.full_name || u.email || 'Unknown' }))
        : (definition.config.options ?? []).map((o) => ({ id: o.id, label: o.label }))
      return (
        <Select
          value={typeof value === 'string' && value ? value : '__none__'}
          disabled={!canEdit}
          onValueChange={(v) => persist(definition, v === '__none__' ? null : v)}
        >
          <SelectTrigger id={id} className="h-9"><SelectValue placeholder="Not set" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Not set</SelectItem>
            {items.map((o) => (
              <SelectItem key={o.id} value={o.id}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )
    }

    if (type === 'multi_select') {
      const chosen = Array.isArray(value) ? (value as string[]) : []
      return (
        <div className="flex flex-wrap gap-1.5" id={id}>
          {(definition.config.options ?? []).map((option) => {
            const on = chosen.includes(option.id)
            return (
              <Button
                key={option.id}
                type="button"
                size="sm"
                variant={on ? 'default' : 'outline'}
                className="h-8"
                aria-pressed={on}
                disabled={!canEdit}
                onClick={() => persist(
                  definition,
                  on ? chosen.filter((c) => c !== option.id) : [...chosen, option.id],
                )}
              >
                {option.label}
              </Button>
            )
          })}
        </div>
      )
    }

    if (type === 'long_text') {
      return (
        <Textarea
          id={id}
          defaultValue={typeof value === 'string' ? value : ''}
          disabled={!canEdit}
          rows={3}
          onBlur={(e) => commit(e.target.value)}
        />
      )
    }

    const inputType = type === 'number' ? 'number'
      : type === 'date' ? 'date'
        : type === 'datetime' ? 'datetime-local'
          : type === 'email' ? 'email'
            : type === 'url' ? 'url'
              : 'text'

    return (
      <Input
        id={id}
        type={inputType}
        className="h-9"
        // `defaultValue`, not `value`: this is an uncontrolled input that commits on blur, so
        // React must not re-render it mid-typing from state that only updates after a save.
        defaultValue={value == null ? '' : String(value)}
        disabled={!canEdit}
        onBlur={(e) => commit(e.target.value)}
      />
    )
  }

  if (!loaded || applicable.length === 0) return null

  return (
    <div className="border-t pt-4">
      <div className="mb-3 flex items-center gap-2">
        <Table2 className="h-4 w-4" />
        <h3 className="text-sm font-semibold">Details</h3>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {applicable.map((definition) => (
          <div key={definition.id} className="space-y-1.5">
            <Label htmlFor={`field-${definition.id}`} className="flex items-center gap-1.5 text-xs">
              {definition.name}
              {definition.is_required && <span className="text-destructive" aria-hidden>*</span>}
              {definition.is_archived && (
                <Badge variant="outline" className="text-[10px] font-normal text-muted-foreground">
                  Archived
                </Badge>
              )}
            </Label>
            {control(definition)}
            {definition.description && !errors[definition.id] && (
              <p className="text-xs text-muted-foreground">{definition.description}</p>
            )}
            {errors[definition.id] && (
              <p className="text-xs text-destructive">{errors[definition.id]}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
