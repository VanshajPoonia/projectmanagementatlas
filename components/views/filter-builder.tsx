'use client'

// The visual filter builder.
//
// Prompt E: "Visual operators: is / is not / contains / does not contain / before / after /
// between / empty / not empty. Support AND/OR. Only add arbitrary nested boolean groups if the
// UI can explain them."
//
// ⚠️ That last sentence is a constraint, not a suggestion, and this builder takes it literally:
// there are NO nested groups. One join applies to the whole list, so the bar reads as one
// sentence - "priority is 1 AND assignee is me AND due date before Friday" - and there is
// never a question about how it binds. Nesting is easy to store and very hard to draw; a
// builder that renders `(A OR B) AND (C OR D)` as an indented tree is a builder most people
// will misread. When there is a real need, the honest version is a query language with a
// preview, not deeper indentation.
//
// Every row is legible even while it is being built: an unfinished row constrains nothing (see
// isFilterComplete) and says so on screen rather than silently narrowing nothing, because
// ATLAS_01 10.2 is that a user must never wonder whether something is broken or just empty.

import { useId } from 'react'
import { Plus, Trash2, TriangleAlert } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  CURRENT_USER,
  FIELD_DESCRIPTORS,
  OPERATOR_LABELS,
  UNASSIGNED,
  describeField,
  isFilterComplete,
  operatorTakesValues,
  operatorsFor,
  type FieldKind,
  type FilterCondition,
  type FilterJoin,
  type FilterOperator,
  type ViewConfig,
} from '@/lib/view-config'

/** A value a select-kind field can take, supplied by the host that already has the lists. */
export interface FilterOption {
  value: string
  label: string
}

export interface FilterOptionSource {
  /** Options for a select field, or undefined when the host has none to offer. */
  optionsFor: (field: string) => FilterOption[] | undefined
  /** Kind for a custom field, so the operator list is right. */
  kindFor?: (field: string) => FieldKind | undefined
  /** Extra fields beyond the built-ins - custom fields (114) arrive this way. */
  extraFields?: Array<{ field: string; label: string; kind: FieldKind }>
}

interface FilterBuilderProps {
  config: ViewConfig
  onChange: (next: Partial<ViewConfig>) => void
  source: FilterOptionSource
}

function newConditionId(): string {
  // Not crypto.randomUUID: this becomes a React key and a DOM id, and calling it during a
  // render pass makes the server and client disagree. Created only in an event handler.
  return `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`
}

export function FilterBuilder({ config, onChange, source }: FilterBuilderProps) {
  const groupId = useId()

  const fields = [
    ...FIELD_DESCRIPTORS.map((d) => ({ field: d.field, label: d.label, kind: d.kind })),
    ...(source.extraFields ?? []),
  ]

  const update = (id: string, patch: Partial<FilterCondition>) => {
    onChange({
      filters: config.filters.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    })
  }

  const addCondition = () => {
    onChange({
      filters: [
        ...config.filters,
        { id: newConditionId(), field: 'assignee', operator: 'is' as FilterOperator, values: [] },
      ],
    })
  }

  const removeCondition = (id: string) => {
    onChange({ filters: config.filters.filter((c) => c.id !== id) })
  }

  // Changing the field can strand the operator on one that field does not support, and the
  // old values almost never mean anything on the new field. Both are reset together, because
  // resetting one and keeping the other produces a row that looks finished and filters wrongly.
  const changeField = (id: string, field: string) => {
    const allowed = operatorsFor(field, source.kindFor?.(field))
    const current = config.filters.find((c) => c.id === id)
    const operator = current && allowed.includes(current.operator) ? current.operator : allowed[0]
    update(id, { field, operator, values: [] })
  }

  const changeOperator = (id: string, operator: FilterOperator) => {
    const current = config.filters.find((c) => c.id === id)
    if (!current) return
    // Going to or from `between` changes how many values the row holds; going to empty /
    // not empty means it holds none. Keeping stale values would leave them invisible and
    // still saved.
    const keepValues =
      operatorTakesValues(operator) &&
      operatorTakesValues(current.operator) &&
      (operator === 'between') === (current.operator === 'between')
    update(id, { operator, values: keepValues ? current.values : [] })
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium">Match</span>
        <Select
          value={config.filterJoin}
          onValueChange={(v) => onChange({ filterJoin: v as FilterJoin })}
        >
          <SelectTrigger id={`${groupId}-join`} className="h-8 w-[150px]" aria-label="How conditions combine">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="and">all conditions</SelectItem>
            <SelectItem value="or">any condition</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-muted-foreground text-sm">
          {config.filterJoin === 'and'
            ? 'a task must satisfy every row below'
            : 'a task needs only one row below'}
        </span>
      </div>

      {config.filters.length === 0 ? (
        <p className="text-muted-foreground rounded-md border border-dashed px-3 py-4 text-sm">
          No conditions yet. Everything you can see is showing.
        </p>
      ) : (
        <ul className="space-y-2">
          {config.filters.map((condition, index) => {
            const kind = source.kindFor?.(condition.field) ?? describeField(condition.field)?.kind
            const allowed = operatorsFor(condition.field, kind)
            const complete = isFilterComplete(condition)

            return (
              <li
                key={condition.id}
                className="bg-muted/30 flex flex-wrap items-center gap-2 rounded-md border p-2"
              >
                <span className="text-muted-foreground w-10 shrink-0 text-xs uppercase">
                  {index === 0 ? 'Where' : config.filterJoin}
                </span>

                <Select value={condition.field} onValueChange={(v) => changeField(condition.id, v)}>
                  <SelectTrigger
                    id={`filter-field-${condition.id}`}
                    className="h-8 w-[160px]"
                    aria-label="Field"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {fields.map((f) => (
                      <SelectItem key={f.field} value={f.field}>{f.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <Select
                  value={condition.operator}
                  onValueChange={(v) => changeOperator(condition.id, v as FilterOperator)}
                >
                  <SelectTrigger
                    id={`filter-operator-${condition.id}`}
                    className="h-8 w-[160px]"
                    aria-label="Operator"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {allowed.map((op) => (
                      <SelectItem key={op} value={op}>{OPERATOR_LABELS[op]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>

                <ConditionValue
                  condition={condition}
                  kind={kind}
                  options={source.optionsFor(condition.field)}
                  onChange={(values) => update(condition.id, { values })}
                />

                {!complete && (
                  <span className="text-muted-foreground inline-flex items-center gap-1 text-xs">
                    <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                    Not filtering yet
                  </span>
                )}

                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="ml-auto h-8 px-2"
                  onClick={() => removeCondition(condition.id)}
                  aria-label={`Remove condition ${index + 1}`}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" id="filter-add" onClick={addCondition}>
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        Add condition
      </Button>
    </div>
  )
}

/* ── The value control, which is a different control per operator ──────────────────── */

function ConditionValue({
  condition,
  kind,
  options,
  onChange,
}: {
  condition: FilterCondition
  kind: FieldKind | undefined
  options: FilterOption[] | undefined
  onChange: (values: string[]) => void
}) {
  if (!operatorTakesValues(condition.operator)) {
    return <span className="text-muted-foreground px-1 text-sm">(no value needed)</span>
  }

  if (condition.operator === 'between') {
    return (
      <div className="flex items-center gap-1">
        <Input
          id={`filter-from-${condition.id}`}
          type={kind === 'date' ? 'date' : 'text'}
          className="h-8 w-[150px]"
          aria-label="From"
          value={condition.values[0] ?? ''}
          onChange={(e) => onChange([e.target.value, condition.values[1] ?? ''])}
        />
        <span className="text-muted-foreground text-xs">and</span>
        <Input
          id={`filter-to-${condition.id}`}
          type={kind === 'date' ? 'date' : 'text'}
          className="h-8 w-[150px]"
          aria-label="To"
          value={condition.values[1] ?? ''}
          onChange={(e) => onChange([condition.values[0] ?? '', e.target.value])}
        />
      </div>
    )
  }

  if (kind === 'date' || condition.operator === 'before' || condition.operator === 'after') {
    return (
      <Input
        id={`filter-value-${condition.id}`}
        type="date"
        className="h-8 w-[170px]"
        aria-label="Value"
        value={condition.values[0] ?? ''}
        onChange={(e) => onChange([e.target.value])}
      />
    )
  }

  // A text operator on a select field is still a text search - "assignee contains ann" is a
  // legitimate thing to type, and forcing a dropdown there would remove it.
  const isTextOperator = condition.operator === 'contains' || condition.operator === 'does_not_contain'

  if (options && !isTextOperator) {
    return (
      <MultiValuePicker
        id={`filter-value-${condition.id}`}
        options={options}
        selected={condition.values}
        onChange={onChange}
      />
    )
  }

  return (
    <Input
      id={`filter-value-${condition.id}`}
      className="h-8 w-[200px]"
      aria-label="Value"
      placeholder="Type a value"
      value={condition.values[0] ?? ''}
      onChange={(e) => onChange([e.target.value])}
    />
  )
}

/**
 * Several values on ONE condition are alternatives - "assignee is Ann or Bob" stays a single
 * legible row rather than becoming two rows the user then has to switch the whole bar to OR
 * for, which would also loosen every other row. This is why the join is per-bar and the
 * alternatives are per-condition.
 */
function MultiValuePicker({
  id,
  options,
  selected,
  onChange,
}: {
  id: string
  options: FilterOption[]
  selected: string[]
  onChange: (values: string[]) => void
}) {
  const toggle = (value: string) => {
    onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value])
  }

  return (
    <div className="flex flex-wrap items-center gap-1" id={id}>
      <Select value="" onValueChange={toggle}>
        <SelectTrigger className="h-8 w-[180px]" aria-label="Add a value">
          <SelectValue placeholder={selected.length ? `${selected.length} selected` : 'Choose'} />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {selected.includes(o.value) ? '✓ ' : ''}
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selected.map((value) => {
        const option = options.find((o) => o.value === value)
        const label =
          value === CURRENT_USER ? 'Me'
            : value === UNASSIGNED ? 'Nobody'
            : option?.label ?? value
        return (
          <Badge
            key={value}
            variant="secondary"
            className="cursor-pointer gap-1"
            onClick={() => toggle(value)}
            title="Remove"
          >
            {label}
            <span aria-hidden>×</span>
          </Badge>
        )
      })}
    </div>
  )
}
