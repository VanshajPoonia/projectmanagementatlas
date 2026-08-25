'use client'

// Everything about a view that is not a filter: layout, scope, grouping, sort, which fields
// show, and how completed work is treated.
//
// Prompt E's config list is: context/project scope, include descendant level, filters, sort,
// group, subgroup, visible fields, field order, density, hierarchy behavior, completed-item
// behavior. Filters live in filter-builder.tsx; the rest is here, in that order, because that
// is roughly the order somebody sets them.
//
// ⚠️ Density is per USER, not part of the shared view - see components/shell/density.ts. It is
// rendered in this toolbar because that is where someone looks for it, but it is written to
// localStorage by the host, never into a shared saved view. Two people looking at the same
// shared view can legitimately disagree about how much they want on screen, and both are right.

import { Check, ChevronDown, Columns3, Layers, ListFilter } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import { DensityToggle } from '@/components/shell/density-toggle'
import type { Density } from '@/components/shell/density'
import {
  DESCENDANT_LABELS,
  DESCENDANT_SCOPES,
  FIELD_DESCRIPTORS,
  LAYOUTS,
  LAYOUT_LABELS,
  describeField,
  type CompletedMode,
  type DescendantScope,
  type GroupField,
  type HierarchyMode,
  type Layout,
  type SortRule,
  type ViewConfig,
} from '@/lib/view-config'

const GROUP_OPTIONS: Array<{ value: GroupField | '__none__'; label: string }> = [
  { value: '__none__', label: 'No grouping' },
  { value: 'status', label: 'Status' },
  { value: 'status_category', label: 'Status means' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'priority', label: 'Priority' },
  { value: 'board', label: 'Board' },
  { value: 'tag', label: 'Tag' },
  { value: 'type', label: 'Work type' },
  { value: 'due_bucket', label: 'Due date' },
]

const SORT_OPTIONS: Array<{ value: SortRule['field']; label: string }> = [
  { value: 'position', label: 'Manual order' },
  { value: 'title', label: 'Title' },
  { value: 'priority', label: 'Priority' },
  { value: 'due_date', label: 'Due date' },
  { value: 'created_at', label: 'Created' },
  { value: 'updated_at', label: 'Updated' },
  { value: 'status', label: 'Status' },
  { value: 'assignee', label: 'Assignee' },
  { value: 'board', label: 'Board' },
]

const COMPLETED_OPTIONS: Array<{ value: CompletedMode; label: string; hint: string }> = [
  { value: 'show', label: 'Show completed', hint: 'Everything, done or not' },
  { value: 'hide', label: 'Hide completed', hint: 'Only work still open' },
  { value: 'only', label: 'Completed only', hint: 'What has been finished or cancelled' },
]

const HIERARCHY_OPTIONS: Array<{ value: HierarchyMode; label: string; hint: string }> = [
  { value: 'parents_only', label: 'Top-level only', hint: 'Subtasks stay inside their parent' },
  { value: 'nested', label: 'Nested', hint: 'Subtasks listed under their parent' },
  { value: 'flat', label: 'Flat', hint: 'Every task as its own row, subtasks included' },
]

interface ViewToolbarProps {
  config: ViewConfig
  onChange: (patch: Partial<ViewConfig>) => void
  /** Per-user, deliberately outside the saved config. */
  density: Density
  onDensityChange: (density: Density) => void
  /** Only meaningful when the view is scoped to at least one board. */
  descendantsAvailable: boolean
  /** How many boards the current scope covers, for the honest label. */
  scopeBoardCount: number
  /** Custom fields (114), so they can be shown as columns like any built-in. */
  extraFields?: Array<{ field: string; label: string }>
}

export function ViewToolbar({
  config,
  onChange,
  density,
  onDensityChange,
  descendantsAvailable,
  scopeBoardCount,
  extraFields = [],
}: ViewToolbarProps) {
  const allFields = [
    ...FIELD_DESCRIPTORS.map((d) => ({ field: d.field, label: d.label })),
    ...extraFields,
  ]

  const toggleField = (field: string) => {
    // Title is not removable: a row with no identifier is a row nobody can act on, and the
    // table's sticky first column has to hold something.
    if (field === 'title') return
    onChange({
      fields: config.fields.includes(field)
        ? config.fields.filter((f) => f !== field)
        : [...config.fields, field],
    })
  }

  const moveField = (field: string, delta: number) => {
    const index = config.fields.indexOf(field)
    const target = index + delta
    if (index < 0 || target < 0 || target >= config.fields.length) return
    const next = [...config.fields]
    ;[next[index], next[target]] = [next[target], next[index]]
    onChange({ fields: next })
  }

  const primarySort = config.sort[0]

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Layout */}
      <div className="bg-muted inline-flex rounded-md p-0.5" role="group" aria-label="Layout">
        {LAYOUTS.map((layout) => (
          <Button
            key={layout}
            type="button"
            id={`layout-${layout}`}
            size="sm"
            variant={config.layout === layout ? 'default' : 'ghost'}
            className="h-7 px-2.5 text-xs"
            aria-pressed={config.layout === layout}
            onClick={() => onChange({ layout: layout as Layout })}
          >
            {LAYOUT_LABELS[layout]}
          </Button>
        ))}
      </div>

      {/* Descendant scope - the Vikunja fix. Disabled with a REASON when it cannot apply. */}
      <Select
        value={config.descendants}
        onValueChange={(v) => onChange({ descendants: v as DescendantScope })}
        disabled={!descendantsAvailable}
      >
        <SelectTrigger
          id="view-descendants"
          className="h-8 w-[240px]"
          aria-label="How far below the chosen boards this view reaches"
          title={
            descendantsAvailable
              ? `This view spans ${scopeBoardCount} board${scopeBoardCount === 1 ? '' : 's'}`
              : 'Pick a board first - with no board chosen this view already covers everything you can see.'
          }
        >
          <Layers className="mr-1 h-3.5 w-3.5 shrink-0" aria-hidden />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {DESCENDANT_SCOPES.map((scope) => (
            <SelectItem key={scope} value={scope}>{DESCENDANT_LABELS[scope]}</SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Group */}
      <Select
        value={config.group ?? '__none__'}
        onValueChange={(v) => onChange({ group: v === '__none__' ? null : (v as GroupField) })}
      >
        <SelectTrigger id="view-group" className="h-8 w-[170px]" aria-label="Group by">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {GROUP_OPTIONS.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.value === '__none__' ? o.label : `Group by ${o.label.toLowerCase()}`}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Sort */}
      <div className="flex items-center gap-1">
        <Select
          value={primarySort?.field ?? '__none__'}
          onValueChange={(v) =>
            onChange({ sort: v === '__none__' ? [] : [{ field: v as SortRule['field'], direction: primarySort?.direction ?? 'asc' }] })
          }
        >
          <SelectTrigger id="view-sort" className="h-8 w-[150px]" aria-label="Sort by">
            <SelectValue placeholder="Sort" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Default order</SelectItem>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {primarySort && (
          <Button
            type="button"
            id="view-sort-direction"
            variant="outline"
            size="sm"
            className="h-8 px-2 text-xs"
            onClick={() =>
              onChange({ sort: [{ ...primarySort, direction: primarySort.direction === 'asc' ? 'desc' : 'asc' }] })
            }
            title={primarySort.direction === 'asc' ? 'Ascending' : 'Descending'}
          >
            {primarySort.direction === 'asc' ? '↑' : '↓'}
          </Button>
        )}
      </div>

      {/* Visible fields, in order */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" id="view-fields" variant="outline" size="sm" className="h-8">
            <Columns3 className="mr-1 h-4 w-4" aria-hidden />
            Fields
            <Badge variant="secondary" className="ml-1.5 h-4 px-1 text-[10px]">
              {config.fields.length}
            </Badge>
            <ChevronDown className="ml-0.5 h-3 w-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel>Shown, in order</DropdownMenuLabel>
          {config.fields.map((field, index) => (
            <DropdownMenuItem
              key={field}
              onSelect={(e) => e.preventDefault()}
              className="flex items-center gap-2"
            >
              <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="flex-1 truncate">
                {allFields.find((f) => f.field === field)?.label ?? field}
              </span>
              <span className="flex shrink-0 gap-0.5">
                <Button
                  type="button" variant="ghost" size="sm" className="h-6 w-6 p-0"
                  disabled={index === 0}
                  aria-label={`Move ${field} earlier`}
                  onClick={() => moveField(field, -1)}
                >↑</Button>
                <Button
                  type="button" variant="ghost" size="sm" className="h-6 w-6 p-0"
                  disabled={index === config.fields.length - 1}
                  aria-label={`Move ${field} later`}
                  onClick={() => moveField(field, 1)}
                >↓</Button>
                <Button
                  type="button" variant="ghost" size="sm" className="h-6 w-6 p-0"
                  disabled={field === 'title'}
                  title={field === 'title' ? 'The title always shows - a row with no name cannot be acted on.' : 'Hide'}
                  aria-label={`Hide ${field}`}
                  onClick={() => toggleField(field)}
                >×</Button>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Hidden</DropdownMenuLabel>
          {allFields.filter((f) => !config.fields.includes(f.field)).map((f) => (
            <DropdownMenuItem
              key={f.field}
              onSelect={(e) => { e.preventDefault(); toggleField(f.field) }}
            >
              <span className="w-3.5" aria-hidden />
              <span className="ml-2 truncate">{f.label}</span>
            </DropdownMenuItem>
          ))}
          {allFields.every((f) => config.fields.includes(f.field)) && (
            <DropdownMenuItem disabled>Every field is showing</DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Completed + hierarchy */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" id="view-options" variant="outline" size="sm" className="h-8">
            <ListFilter className="mr-1 h-4 w-4" aria-hidden />
            Options
            <ChevronDown className="ml-0.5 h-3 w-3" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuLabel>Completed work</DropdownMenuLabel>
          {COMPLETED_OPTIONS.map((o) => (
            <DropdownMenuItem
              key={o.value}
              id={`completed-${o.value}`}
              onSelect={() => onChange({ completed: o.value })}
            >
              <Check className={`h-3.5 w-3.5 shrink-0 ${config.completed === o.value ? '' : 'invisible'}`} aria-hidden />
              <span className="ml-2">
                <span className="block">{o.label}</span>
                <span className="text-muted-foreground block text-xs">{o.hint}</span>
              </span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Subtasks</DropdownMenuLabel>
          {HIERARCHY_OPTIONS.map((o) => (
            <DropdownMenuItem
              key={o.value}
              id={`hierarchy-${o.value}`}
              onSelect={() => onChange({ hierarchy: o.value })}
            >
              <Check className={`h-3.5 w-3.5 shrink-0 ${config.hierarchy === o.value ? '' : 'invisible'}`} aria-hidden />
              <span className="ml-2">
                <span className="block">{o.label}</span>
                <span className="text-muted-foreground block text-xs">{o.hint}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      <DensityToggle density={density} onChange={onDensityChange} />
    </div>
  )
}
