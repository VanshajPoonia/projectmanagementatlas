'use client'

/**
 * Custom fields - the admin screen for migration 114.
 *
 * Ships with the migration for the reason recorded in CLAUDE.md three times over: a table with
 * policies, grants and no writer is a feature only psql can reach. A field engine nobody can
 * define a field in is that defect again.
 *
 * There is deliberately no DELETE. Removing a definition cascades into every value stored
 * against it, and unlike a status or a type those values are data a person typed that nothing
 * else records. Archiving stops the field being offered and keeps what was already answered -
 * the same choice `status-management.tsx` makes, for the same reason.
 *
 * Writes ask for their rows back and compare the count: an RLS refusal returns zero rows and
 * no error (lib/rls-write.ts).
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Archive, ArchiveRestore, Plus, X, ListPlus, Table2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import { classifyWrite, writeFailureMessage } from '@/lib/rls-write'
import { useWorkItemTypes } from '@/lib/work-item-types'
import {
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  CHOICE_TYPES,
  defaultConfigFor,
  fieldKeyFromName,
  validateFieldDefinition,
  type FieldDefinition,
  type FieldOption,
  type FieldType,
} from '@/lib/custom-fields'

const SELECT_COLUMNS =
  'id, key, name, description, field_type, config, is_required, scope, board_id, '
  + 'applies_to_types, position, is_archived'

const ANY_TYPE = '__any__'
const ALL_BOARDS = '__all__'

export default function FieldManagement() {
  const supabase = createClient()
  const workItemTypes = useWorkItemTypes({ includeInactive: true })

  const [fields, setFields] = useState<FieldDefinition[]>([])
  const [boards, setBoards] = useState<Array<{ id: string; title: string }>>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  // The draft field. Kept flat rather than in one object so each control reads plainly.
  const [name, setName] = useState('')
  const [fieldType, setFieldType] = useState<FieldType>('text')
  const [required, setRequired] = useState(false)
  const [boardId, setBoardId] = useState<string>(ALL_BOARDS)
  const [appliesTo, setAppliesTo] = useState<string>(ANY_TYPE)
  const [options, setOptions] = useState<FieldOption[]>([])
  const [minValue, setMinValue] = useState('')
  const [maxValue, setMaxValue] = useState('')
  const [usage, setUsage] = useState<Record<string, number>>({})

  const load = useCallback(async () => {
    const [{ data: defs }, { data: boardRows }] = await Promise.all([
      supabase.from('field_definitions').select(SELECT_COLUMNS)
        .order('position', { ascending: true }).order('name', { ascending: true }),
      supabase.from('boards').select('id, title').order('title', { ascending: true }),
    ])
    setFields((defs ?? []) as unknown as FieldDefinition[])
    setBoards(boardRows ?? [])
    setLoading(false)
  }, [supabase])

  useEffect(() => { void load() }, [load])

  // How many values each field already holds. This is what makes "archive, don't delete"
  // legible: the number is the thing that would be destroyed.
  //
  // ⚠️ RLS-filtered, so it can only UNDERSTATE - a value on a task inside a private board this
  // admin is not a member of is not counted. Safe here because the screen offers no delete:
  // the number only strengthens the case for archiving, and being told "3 filled in" when the
  // truth is 5 leads to the same decision. If a delete is ever added, this count must be
  // replaced by a SECURITY DEFINER one first.
  useEffect(() => {
    let active = true
    const run = async () => {
      const counts: Record<string, number> = {}
      await Promise.all(fields.map(async (f) => {
        const { count } = await supabase
          .from('field_values').select('id', { count: 'exact', head: true }).eq('field_id', f.id)
        counts[f.id] = count ?? 0
      }))
      if (active) setUsage(counts)
    }
    if (fields.length) void run()
    return () => { active = false }
  }, [fields, supabase])

  // Switching type must not carry the previous type's config across - a `number` holding a
  // leftover options array would be refused by the definition trigger with a confusing message.
  function changeType(next: FieldType) {
    setFieldType(next)
    setOptions(CHOICE_TYPES.includes(next) ? (defaultConfigFor(next).options ?? []) : [])
    setMinValue('')
    setMaxValue('')
  }

  const draftConfig = useMemo(() => {
    if (CHOICE_TYPES.includes(fieldType)) return { options }
    if (fieldType === 'number') {
      return {
        ...(minValue.trim() === '' ? {} : { min: Number(minValue) }),
        ...(maxValue.trim() === '' ? {} : { max: Number(maxValue) }),
      }
    }
    return {}
  }, [fieldType, options, minValue, maxValue])

  const draftKey = fieldKeyFromName(name)
  const draftProblem = name.trim()
    ? validateFieldDefinition({ name, field_type: fieldType, config: draftConfig, key: draftKey }).error
    : null

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault()
    if (!draftKey) {
      toast.error('Please use letters or numbers in the field name')
      return
    }
    const verdict = validateFieldDefinition({ name, field_type: fieldType, config: draftConfig, key: draftKey })
    if (!verdict.ok) {
      toast.error(verdict.error ?? 'That field cannot be saved')
      return
    }

    setSaving(true)
    const nextPosition = fields.length ? Math.max(...fields.map((f) => f.position)) + 1 : 0
    const outcome = await classifyWrite(
      await supabase.from('field_definitions').insert({
        key: draftKey,
        name: name.trim(),
        field_type: fieldType,
        config: draftConfig,
        is_required: required,
        scope: boardId === ALL_BOARDS ? 'global' : 'board',
        board_id: boardId === ALL_BOARDS ? null : boardId,
        applies_to_types: appliesTo === ANY_TYPE ? null : [appliesTo],
        position: nextPosition,
      }).select('id'),
    )
    setSaving(false)

    if (outcome.kind === 'error') {
      toast.error(
        outcome.message.includes('duplicate key')
          ? 'A field with that name already exists here'
          : 'Could not add field',
        { description: outcome.message },
      )
      return
    }
    const failure = writeFailureMessage(outcome, 'field')
    if (failure) {
      toast.error(failure.title, { description: failure.description })
      return
    }

    setName('')
    setRequired(false)
    changeType('text')
    setAppliesTo(ANY_TYPE)
    setBoardId(ALL_BOARDS)
    toast.success('Field added')
    await load()
  }

  async function toggleArchive(field: FieldDefinition) {
    const outcome = await classifyWrite(
      await supabase.from('field_definitions')
        .update({ is_archived: !field.is_archived }).eq('id', field.id).select('id'),
    )
    const failure = writeFailureMessage(outcome, 'change')
    if (failure) {
      toast.error(failure.title, { description: failure.description })
      return
    }
    toast.success(field.is_archived ? 'Field restored' : 'Field archived', {
      description: field.is_archived
        ? 'It can be filled in again.'
        : `${usage[field.id] ?? 0} existing value(s) kept; it just stops being offered on new work.`,
    })
    await load()
  }

  const activeFields = fields.filter((f) => !f.is_archived)
  const archivedFields = fields.filter((f) => f.is_archived)
  const boardName = (id?: string | null) => boards.find((b) => b.id === id)?.title ?? 'a board'

  const renderRow = (field: FieldDefinition) => (
    <div key={field.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
      <div className="flex min-w-0 flex-wrap items-center gap-2">
        <span className="truncate font-medium">{field.name}</span>
        <Badge variant="secondary" className="text-[11px] font-normal">
          {FIELD_TYPE_LABELS[field.field_type].split(' - ')[0]}
        </Badge>
        {field.is_required && (
          <Badge variant="outline" className="text-[11px] font-normal">Required</Badge>
        )}
        {field.board_id && (
          <Badge variant="outline" className="text-[11px] font-normal">{boardName(field.board_id)} only</Badge>
        )}
        {field.applies_to_types?.length && (
          <Badge variant="outline" className="text-[11px] font-normal">
            {field.applies_to_types.join(', ')} only
          </Badge>
        )}
        <code className="hidden text-xs text-muted-foreground sm:inline">{field.key}</code>
        {(usage[field.id] ?? 0) > 0 && (
          <span className="text-xs text-muted-foreground">{usage[field.id]} filled in</span>
        )}
      </div>
      <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => toggleArchive(field)}>
        {field.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
        {field.is_archived ? 'Restore' : 'Archive'}
      </Button>
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Table2 className="h-5 w-5" />
          Custom Fields
        </CardTitle>
        <CardDescription>
          Properties this company tracks that a task does not have a column for - a PO number, an
          estimate, a client contact, a go-live date. They appear on every work item they apply
          to, and are validated in the database, so a Number field can never end up holding text
          however the value was written.
          <br />
          Fields are <strong>archived, never deleted</strong>: archiving stops a field being
          offered on new work and keeps every answer already given.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <form onSubmit={handleAdd} className="space-y-3 rounded-lg border bg-muted/30 p-3">
          <div className="flex flex-wrap items-end gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="new-field-name" className="text-xs">New field</Label>
              <Input
                id="new-field-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Estimated hours"
                className="w-56"
                disabled={saving}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-field-type" className="text-xs">Type</Label>
              <Select value={fieldType} onValueChange={(v) => changeType(v as FieldType)} disabled={saving}>
                <SelectTrigger id="new-field-type" className="h-10 w-64"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {FIELD_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{FIELD_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-field-board" className="text-xs">Where</Label>
              <Select value={boardId} onValueChange={setBoardId} disabled={saving}>
                <SelectTrigger id="new-field-board" className="h-10 w-52"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_BOARDS}>Every board</SelectItem>
                  {boards.map((b) => (
                    <SelectItem key={b.id} value={b.id}>{b.title} only</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="new-field-applies" className="text-xs">Applies to</Label>
              <Select value={appliesTo} onValueChange={setAppliesTo} disabled={saving}>
                <SelectTrigger id="new-field-applies" className="h-10 w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={ANY_TYPE}>Every work item type</SelectItem>
                  {workItemTypes.map((t) => (
                    <SelectItem key={t.key} value={t.key}>{t.plural_name ?? t.name} only</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">Required</Label>
              <Button
                type="button"
                variant={required ? 'default' : 'outline'}
                className="h-10 w-24"
                aria-pressed={required}
                disabled={saving}
                onClick={() => setRequired((r) => !r)}
              >
                {required ? 'Yes' : 'No'}
              </Button>
            </div>
          </div>

          {CHOICE_TYPES.includes(fieldType) && (
            <div className="space-y-2">
              <Label className="text-xs">Options</Label>
              {options.map((option, index) => (
                <div key={index} className="flex items-center gap-2">
                  <Input
                    value={option.label}
                    placeholder="Label"
                    className="h-9 w-56"
                    onChange={(e) => setOptions((prev) => prev.map((o, i) => (
                      // The id is derived from the label while it is still being typed, so an
                      // admin never has to think about ids - but only until the field is saved.
                      // After that the id is what stored values point at and must not move.
                      i === index ? { ...o, label: e.target.value, id: fieldKeyFromName(e.target.value) || `option_${i + 1}` } : o
                    )))}
                  />
                  <code className="hidden text-xs text-muted-foreground sm:inline">{option.id}</code>
                  <Button
                    type="button" size="icon-sm" variant="ghost"
                    aria-label={`Remove option ${option.label || index + 1}`}
                    onClick={() => setOptions((prev) => prev.filter((_, i) => i !== index))}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button
                type="button" size="sm" variant="outline" className="gap-1.5"
                onClick={() => setOptions((prev) => [
                  ...prev,
                  { id: `option_${prev.length + 1}`, label: `Option ${prev.length + 1}` },
                ])}
              >
                <ListPlus className="h-4 w-4" />
                Add option
              </Button>
            </div>
          )}

          {fieldType === 'number' && (
            <div className="flex flex-wrap items-end gap-2">
              <div className="space-y-1.5">
                <Label htmlFor="new-field-min" className="text-xs">Minimum (optional)</Label>
                <Input id="new-field-min" value={minValue} onChange={(e) => setMinValue(e.target.value)}
                  inputMode="decimal" className="h-9 w-32" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="new-field-max" className="text-xs">Maximum (optional)</Label>
                <Input id="new-field-max" value={maxValue} onChange={(e) => setMaxValue(e.target.value)}
                  inputMode="decimal" className="h-9 w-32" />
              </div>
            </div>
          )}

          {draftProblem && (
            <p className="text-sm text-destructive">{draftProblem}</p>
          )}

          <div className="flex items-center gap-3">
            <Button type="submit" className="gap-2" disabled={saving || !name.trim() || Boolean(draftProblem)}>
              <Plus className="h-4 w-4" />
              Add Field
            </Button>
            {draftKey && (
              <span className="text-xs text-muted-foreground">
                Saved as <code>{draftKey}</code>
              </span>
            )}
          </div>
        </form>

        {loading ? (
          <p className="text-sm text-muted-foreground">Loading fields…</p>
        ) : activeFields.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No custom fields yet. Everything above is optional - a name and a type is enough.
          </p>
        ) : (
          <div className="space-y-2">{activeFields.map(renderRow)}</div>
        )}

        {archivedFields.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Archive className="h-3.5 w-3.5" />
              Archived ({archivedFields.length})
            </div>
            {archivedFields.map(renderRow)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
