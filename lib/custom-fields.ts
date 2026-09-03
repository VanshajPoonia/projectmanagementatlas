// Custom fields - the client's view of migration 114.
//
// ⚠️ Everything here MIRRORS `private.validate_field_value`. The database is the authority: a
// value this module accepts can still be refused, and that is fine. A value this module
// REFUSES that the database would have accepted is a bug, because the user cannot tell that
// refusal apart from the feature being broken - the same lesson lib/capabilities.ts records
// about being wrong in the restrictive direction. Every rule below names the trigger branch it
// mirrors, and `lib/custom-fields.test.ts` pins the pairs.
//
// The point of validating twice is the error message. Postgres raises
// `"Budget" must be at most 1000.` as an exception at save time; this module says the same
// thing next to the input as it is typed.

export type FieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'datetime'
  | 'checkbox'
  | 'select'
  | 'multi_select'
  | 'person'
  | 'url'
  | 'email'
  | 'relation'

export const FIELD_TYPES: FieldType[] = [
  'text', 'long_text', 'number', 'date', 'datetime', 'checkbox',
  'select', 'multi_select', 'person', 'url', 'email', 'relation',
]

/** What the admin sees when picking a type, and what it is for. */
export const FIELD_TYPE_LABELS: Record<FieldType, string> = {
  text: 'Text - a short single line',
  long_text: 'Long text - a paragraph',
  number: 'Number',
  date: 'Date - a calendar day',
  datetime: 'Date & time - a specific moment',
  checkbox: 'Checkbox - yes or no',
  select: 'Select - one of a fixed list',
  multi_select: 'Multi-select - any number from a fixed list',
  person: 'Person - someone in this workspace',
  url: 'URL',
  email: 'Email address',
  relation: 'Relation - another work item',
}

/** The types whose config carries an options list. */
export const CHOICE_TYPES: FieldType[] = ['select', 'multi_select']

export interface FieldOption {
  id: string
  label: string
  color?: string
}

export interface FieldConfig {
  options?: FieldOption[]
  min?: number
  max?: number
  max_length?: number
}

export interface FieldDefinition {
  id: string
  key: string
  name: string
  description?: string | null
  field_type: FieldType
  config: FieldConfig
  is_required: boolean
  scope: 'global' | 'board'
  board_id?: string | null
  applies_to_types?: string[] | null
  position: number
  is_archived: boolean
}

export interface FieldValueRow {
  id?: string
  task_id: string
  field_id: string
  value: unknown
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Mirrors the trigger's `^\d{4}-\d{2}-\d{2}$` - shape only; realness is checked separately.
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
// Mirrors `^https?://[^\s]+$` and `^[^@\s]+@[^@\s.]+\.[^@\s]+$` exactly. Deliberately loose:
// a stricter pattern here would refuse addresses the database accepts.
const URL_RE = /^https?:\/\/[^\s]+$/i
const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/i

/** A real calendar day, not merely four-two-two digits. Mirrors the trigger's `::date` cast. */
function isRealDate(text: string): boolean {
  if (!DATE_RE.test(text)) return false
  const [y, m, d] = text.split('-').map(Number)
  if (m < 1 || m > 12 || d < 1) return false
  // Day 0 of the next month is the last day of this one - handles February and leap years
  // without a table.
  return d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/**
 * Which fields apply to a given work item on a given board.
 *
 * Archived fields are dropped unless the task already holds a value for one - the same rule
 * `statusesForPicker` follows, and for the same reason: a control whose current value is not
 * among its options renders blank and silently offers to change it to something else.
 */
export function fieldsForTask(
  definitions: FieldDefinition[] | null | undefined,
  context: { boardId?: string | null; typeKey?: string | null; valuedFieldIds?: Iterable<string> },
): FieldDefinition[] {
  const held = new Set(context.valuedFieldIds ?? [])
  return (definitions ?? [])
    .filter((d) => {
      if (d.is_archived && !held.has(d.id)) return false
      if (d.board_id && d.board_id !== context.boardId) return false
      if (d.applies_to_types?.length && context.typeKey && !d.applies_to_types.includes(context.typeKey)) {
        return false
      }
      return true
    })
    .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
}

/** Is this value "not set"? Empty string and empty array count, matching the trigger. */
export function isEmptyValue(value: unknown): boolean {
  if (value === null || value === undefined) return true
  if (typeof value === 'string') return value.trim() === ''
  if (Array.isArray(value)) return value.length === 0
  return false
}

export interface ValidationResult {
  ok: boolean
  /** Present when ok is false. Worded as the database words it, so the two never disagree. */
  error?: string
}

const OK: ValidationResult = { ok: true }
const fail = (error: string): ValidationResult => ({ ok: false, error })

/**
 * Validate one value against its definition, mirroring `private.validate_field_value`.
 *
 * Note what is NOT checked here and cannot be: that a `person` really exists, that a
 * `relation` points at a real work item, that a board-scoped field belongs to this task's
 * board. Those need the database, and the database checks them. Claiming to check them here
 * would mean guessing.
 */
export function validateFieldValue(definition: FieldDefinition, value: unknown): ValidationResult {
  const { name, field_type: type, config, is_required: required } = definition

  if (isEmptyValue(value)) {
    return required ? fail(`"${name}" is required.`) : OK
  }

  switch (type) {
    case 'text':
    case 'long_text': {
      if (typeof value !== 'string') return fail(`"${name}" expects text.`)
      if (config.max_length != null && value.length > config.max_length) {
        return fail(`"${name}" is limited to ${config.max_length} characters.`)
      }
      return OK
    }

    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        return fail(`"${name}" expects a number.`)
      }
      if (config.min != null && value < config.min) return fail(`"${name}" must be at least ${config.min}.`)
      if (config.max != null && value > config.max) return fail(`"${name}" must be at most ${config.max}.`)
      return OK
    }

    case 'checkbox':
      return typeof value === 'boolean' ? OK : fail(`"${name}" expects true or false.`)

    case 'date': {
      if (typeof value !== 'string' || !DATE_RE.test(value)) {
        return fail(`"${name}" expects a date as YYYY-MM-DD.`)
      }
      // A date-only value must never be parsed into an instant - see CLAUDE.md on
      // Date.parse and BUSINESS_TIME_ZONE. Compared as a calendar date here too.
      return isRealDate(value) ? OK : fail(`"${name}" is not a real date.`)
    }

    case 'datetime': {
      if (typeof value !== 'string') return fail(`"${name}" expects a timestamp.`)
      return Number.isNaN(Date.parse(value)) ? fail(`"${name}" is not a valid timestamp.`) : OK
    }

    case 'select': {
      if (typeof value !== 'string') return fail(`"${name}" expects one option.`)
      return (config.options ?? []).some((o) => o.id === value)
        ? OK
        : fail(`"${value}" is not an option of "${name}".`)
    }

    case 'multi_select': {
      if (!Array.isArray(value)) return fail(`"${name}" expects a list of options.`)
      const ids = new Set((config.options ?? []).map((o) => o.id))
      for (const entry of value) {
        if (typeof entry !== 'string') return fail(`"${name}" expects option ids as strings.`)
        if (!ids.has(entry)) return fail(`"${entry}" is not an option of "${name}".`)
      }
      if (new Set(value).size !== value.length) {
        return fail(`"${name}" cannot list the same option twice.`)
      }
      return OK
    }

    case 'person':
      return typeof value === 'string' && UUID_RE.test(value) ? OK : fail(`"${name}" expects a person.`)

    case 'relation':
      return typeof value === 'string' && UUID_RE.test(value)
        ? OK
        : fail(`"${name}" expects a work item.`)

    case 'url':
      return typeof value === 'string' && URL_RE.test(value)
        ? OK
        : fail(`"${name}" expects a URL starting http:// or https://.`)

    case 'email':
      return typeof value === 'string' && EMAIL_RE.test(value)
        ? OK
        : fail(`"${name}" expects an email address.`)

    default: {
      // A thirteenth type added to the DB constraint and not here must refuse rather than
      // wave the value through unvalidated - the same stance the trigger's ELSE branch takes.
      const exhaustive: never = type
      return fail(`No validation rule for field type "${String(exhaustive)}".`)
    }
  }
}

/**
 * Turn what an `<input>` gives back into the JSON shape the column stores.
 *
 * The types matter: `number` must land as a JSON number and `checkbox` as a JSON boolean, or
 * the trigger refuses them. An empty input means "cleared", which is SQL NULL - the trigger
 * normalises JSON null to NULL as well, but sending the right thing avoids relying on that.
 */
export function coerceInputValue(type: FieldType, raw: string | boolean | string[] | null): unknown {
  if (raw === null) return null
  if (type === 'checkbox') return Boolean(raw)
  if (type === 'multi_select') return Array.isArray(raw) ? raw : []
  if (typeof raw !== 'string') return raw

  const trimmed = type === 'long_text' ? raw : raw.trim()
  if (trimmed === '') return null

  if (type === 'number') {
    const n = Number(trimmed)
    // NaN is not storable and would be reported by Postgres as a type error with no hint at
    // which field. Hand back the raw string so validateFieldValue names the field instead.
    return Number.isFinite(n) ? n : trimmed
  }

  return trimmed
}

/**
 * Render a stored value for display. Never parses a date-only value into an instant.
 *
 * `config` is read defensively because a caller has to remember to SELECT it, and one did not:
 * /views fetched its definitions without that column, so every select cell threw instead of
 * rendering. Degrading to the stored id is honest - the reader sees an unresolved value rather
 * than a blank cell claiming the field is empty, and a whole table does not fail over one
 * missing column in a query.
 */
export function formatFieldValue(
  definition: FieldDefinition,
  value: unknown,
  lookup?: { people?: Record<string, string>; workItems?: Record<string, string> },
): string {
  if (isEmptyValue(value)) return ''

  switch (definition.field_type) {
    case 'checkbox':
      return value ? 'Yes' : 'No'
    case 'select':
      return (definition.config?.options ?? []).find((o) => o.id === value)?.label ?? String(value)
    case 'multi_select':
      return (Array.isArray(value) ? value : [])
        .map((id) => (definition.config?.options ?? []).find((o) => o.id === id)?.label ?? String(id))
        .join(', ')
    case 'person':
      return lookup?.people?.[String(value)] ?? String(value)
    case 'relation':
      return lookup?.workItems?.[String(value)] ?? String(value)
    case 'datetime':
      return Number.isNaN(Date.parse(String(value)))
        ? String(value)
        : new Date(String(value)).toLocaleString()
    default:
      return String(value)
  }
}

/** A blank config that satisfies the definition trigger for this type. */
export function defaultConfigFor(type: FieldType): FieldConfig {
  return CHOICE_TYPES.includes(type) ? { options: [{ id: 'option_1', label: 'Option 1' }] } : {}
}

/**
 * Is this definition storable? Mirrors `private.validate_field_definition` - the checks an
 * admin can trip over while building a field, so the dialog can say so before saving.
 */
export function validateFieldDefinition(
  draft: Pick<FieldDefinition, 'name' | 'field_type' | 'config'> & { key?: string },
): ValidationResult {
  if (!draft.name.trim()) return fail('Give the field a name.')

  if (draft.key !== undefined && !/^[a-z][a-z0-9_]*$/.test(draft.key)) {
    return fail('The key must start with a letter and use only lowercase letters, numbers and underscores.')
  }

  if (CHOICE_TYPES.includes(draft.field_type)) {
    const options = draft.config.options ?? []
    if (options.length === 0) return fail('A choice field needs at least one option.')
    const ids = options.map((o) => o.id.trim())
    if (ids.some((id) => id === '')) return fail('Every option needs an id.')
    if (new Set(ids).size !== ids.length) return fail('Two options share the same id.')
    if (options.some((o) => !o.label.trim())) return fail('Every option needs a label.')
  }

  if (draft.field_type === 'number') {
    const { min, max } = draft.config
    if (min != null && max != null && min > max) return fail('The minimum cannot exceed the maximum.')
  }

  return OK
}

/** Turn a field name into a stable key, the way status management slugifies a label. */
export function fieldKeyFromName(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}
