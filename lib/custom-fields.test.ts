import { describe, it, expect } from 'vitest'
import {
  validateFieldValue,
  validateFieldDefinition,
  coerceInputValue,
  formatFieldValue,
  fieldsForTask,
  isEmptyValue,
  defaultConfigFor,
  fieldKeyFromName,
  FIELD_TYPES,
  FIELD_TYPE_LABELS,
  type FieldDefinition,
  type FieldType,
} from './custom-fields'

function def(over: Partial<FieldDefinition> & { field_type: FieldType }): FieldDefinition {
  return {
    id: over.id ?? 'f1',
    key: over.key ?? 'f',
    name: over.name ?? 'Field',
    field_type: over.field_type,
    config: over.config ?? {},
    is_required: over.is_required ?? false,
    scope: over.scope ?? 'global',
    board_id: over.board_id ?? null,
    applies_to_types: over.applies_to_types ?? null,
    position: over.position ?? 0,
    is_archived: over.is_archived ?? false,
    description: over.description ?? null,
  }
}

const UUID = '11111111-2222-4333-8444-555555555555'

describe('validateFieldValue - mirrors private.validate_field_value', () => {
  it('accepts an empty value on an optional field and refuses it on a required one', () => {
    for (const empty of [null, undefined, '', '   ', []]) {
      expect(validateFieldValue(def({ field_type: 'text' }), empty).ok).toBe(true)
      expect(validateFieldValue(def({ field_type: 'text', is_required: true }), empty).ok).toBe(false)
    }
  })

  it('checks number type and bounds', () => {
    const f = def({ field_type: 'number', config: { min: 0, max: 1000 }, name: 'Budget' })
    expect(validateFieldValue(f, 'abc').error).toBe('"Budget" expects a number.')
    expect(validateFieldValue(f, -1).error).toBe('"Budget" must be at least 0.')
    expect(validateFieldValue(f, 5000).error).toBe('"Budget" must be at most 1000.')
    expect(validateFieldValue(f, 250).ok).toBe(true)
    expect(validateFieldValue(f, 0).ok).toBe(true)
  })

  it('refuses NaN and Infinity, which are not storable JSON numbers', () => {
    const f = def({ field_type: 'number' })
    expect(validateFieldValue(f, Number.NaN).ok).toBe(false)
    expect(validateFieldValue(f, Number.POSITIVE_INFINITY).ok).toBe(false)
  })

  it('accepts a real calendar date and refuses an impossible one', () => {
    const f = def({ field_type: 'date', name: 'Go live' })
    expect(validateFieldValue(f, '2026-08-22').ok).toBe(true)
    expect(validateFieldValue(f, '2024-02-29').ok).toBe(true)   // leap year
    expect(validateFieldValue(f, '2026-02-29').ok).toBe(false)  // not one
    expect(validateFieldValue(f, '2026-13-01').ok).toBe(false)
    expect(validateFieldValue(f, '2026-04-31').ok).toBe(false)
    expect(validateFieldValue(f, '2026-00-10').ok).toBe(false)
  })

  it('refuses an instant in a date field - a due date is not due at a moment', () => {
    // CLAUDE.md's Date.parse trap: an instant compared against a calendar day resolves
    // against the runtime's timezone and disagrees between server and browser.
    expect(validateFieldValue(def({ field_type: 'date' }), '2026-08-22T10:00:00Z').ok).toBe(false)
  })

  it('accepts an instant in a datetime field', () => {
    expect(validateFieldValue(def({ field_type: 'datetime' }), '2026-08-22T10:00:00Z').ok).toBe(true)
    expect(validateFieldValue(def({ field_type: 'datetime' }), 'not a time').ok).toBe(false)
  })

  it('checks select against its own options', () => {
    const f = def({ field_type: 'select', name: 'Tier', config: { options: [{ id: 'a', label: 'A' }] } })
    expect(validateFieldValue(f, 'a').ok).toBe(true)
    expect(validateFieldValue(f, 'z').error).toBe('"z" is not an option of "Tier".')
  })

  it('checks multi-select membership, element type and duplicates', () => {
    const f = def({
      field_type: 'multi_select', name: 'Labels',
      config: { options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] },
    })
    expect(validateFieldValue(f, ['x', 'y']).ok).toBe(true)
    expect(validateFieldValue(f, ['x', 'q']).ok).toBe(false)
    expect(validateFieldValue(f, ['x', 'x']).error).toBe('"Labels" cannot list the same option twice.')
    expect(validateFieldValue(f, [1, 2]).ok).toBe(false)
    expect(validateFieldValue(f, 'x').ok).toBe(false)
  })

  it('treats an empty multi-select as unset, so required is what refuses it', () => {
    const cfg = { options: [{ id: 'x', label: 'X' }] }
    expect(validateFieldValue(def({ field_type: 'multi_select', config: cfg }), []).ok).toBe(true)
    expect(validateFieldValue(def({ field_type: 'multi_select', config: cfg, is_required: true }), []).ok).toBe(false)
  })

  it('checks url and email with the SAME patterns the trigger uses', () => {
    const url = def({ field_type: 'url' })
    expect(validateFieldValue(url, 'https://example.com/x').ok).toBe(true)
    expect(validateFieldValue(url, 'http://a.b').ok).toBe(true)
    expect(validateFieldValue(url, 'example.com').ok).toBe(false)
    expect(validateFieldValue(url, 'ftp://example.com').ok).toBe(false)

    const email = def({ field_type: 'email' })
    expect(validateFieldValue(email, 'a@b.co').ok).toBe(true)
    expect(validateFieldValue(email, 'first.last+tag@sub.example.com').ok).toBe(true)
    expect(validateFieldValue(email, 'not-an-email').ok).toBe(false)
    expect(validateFieldValue(email, 'a@b').ok).toBe(false)
  })

  it('is not STRICTER than the database on addresses it would accept', () => {
    // Being wrong in the restrictive direction takes an ability from someone the database was
    // built to serve, and they cannot tell that refusal from a bug (lib/capabilities.ts).
    // These are all accepted by `^[^@\s]+@[^@\s.]+\.[^@\s]+$`, so they must pass here too.
    for (const address of ["o'brien@example.com", 'user+tag@example.co.uk', 'a_b@c.io', '"odd"@x.dev']) {
      expect(validateFieldValue(def({ field_type: 'email' }), address).ok).toBe(true)
    }
  })

  it('requires a uuid for person and relation', () => {
    expect(validateFieldValue(def({ field_type: 'person' }), UUID).ok).toBe(true)
    expect(validateFieldValue(def({ field_type: 'person' }), 'someone').ok).toBe(false)
    expect(validateFieldValue(def({ field_type: 'relation' }), UUID).ok).toBe(true)
    expect(validateFieldValue(def({ field_type: 'relation' }), '123').ok).toBe(false)
  })

  it('does not claim to check what only the database can', () => {
    // Existence of the person, existence of the work item, and board scope all need a query.
    // A well-formed uuid must pass here and be left for the trigger to accept or refuse.
    expect(validateFieldValue(def({ field_type: 'person' }), UUID).ok).toBe(true)
    expect(validateFieldValue(def({ field_type: 'relation' }), UUID).ok).toBe(true)
  })

  it('enforces max_length on text', () => {
    const f = def({ field_type: 'text', name: 'Notes', config: { max_length: 5 } })
    expect(validateFieldValue(f, 'abcde').ok).toBe(true)
    expect(validateFieldValue(f, 'abcdef').error).toBe('"Notes" is limited to 5 characters.')
  })

  it('checks checkbox is a boolean', () => {
    expect(validateFieldValue(def({ field_type: 'checkbox' }), true).ok).toBe(true)
    expect(validateFieldValue(def({ field_type: 'checkbox' }), false).ok).toBe(true)
    expect(validateFieldValue(def({ field_type: 'checkbox' }), 'yes').ok).toBe(false)
  })

  it('has a rule for every declared field type', () => {
    // If a thirteenth type is added to the DB constraint and not here, this fails rather than
    // letting the value through unvalidated.
    for (const type of FIELD_TYPES) {
      expect(FIELD_TYPE_LABELS[type]).toBeTruthy()
      const result = validateFieldValue(def({ field_type: type }), null)
      expect(result.ok).toBe(true)
    }
    expect(FIELD_TYPES).toHaveLength(12)
  })
})

describe('coerceInputValue', () => {
  it('turns a numeric string into a JSON number', () => {
    expect(coerceInputValue('number', '250')).toBe(250)
    expect(coerceInputValue('number', '2.5')).toBe(2.5)
    expect(coerceInputValue('number', '-3')).toBe(-3)
  })

  it('hands back the raw string for an unparseable number, so the field gets named', () => {
    // Sending NaN would have Postgres complain about a type with no hint at which field.
    expect(coerceInputValue('number', 'abc')).toBe('abc')
    expect(validateFieldValue(def({ field_type: 'number', name: 'Budget' }), 'abc').error)
      .toBe('"Budget" expects a number.')
  })

  it('treats an empty input as cleared', () => {
    expect(coerceInputValue('text', '')).toBeNull()
    expect(coerceInputValue('text', '   ')).toBeNull()
    expect(coerceInputValue('number', '')).toBeNull()
  })

  it('preserves deliberate whitespace in long text but trims a single line', () => {
    expect(coerceInputValue('long_text', '  line one\n\n  line two  ')).toBe('  line one\n\n  line two  ')
    expect(coerceInputValue('text', '  padded  ')).toBe('padded')
  })

  it('always produces a boolean for a checkbox and an array for a multi-select', () => {
    expect(coerceInputValue('checkbox', false)).toBe(false)
    expect(coerceInputValue('checkbox', true)).toBe(true)
    expect(coerceInputValue('multi_select', ['a'])).toEqual(['a'])
    expect(coerceInputValue('multi_select', 'a' as unknown as string[])).toEqual([])
  })

  it('round-trips through validation for every type', () => {
    const cases: Array<[FieldType, string | boolean | string[], FieldDefinition]> = [
      ['text', 'hello', def({ field_type: 'text' })],
      ['number', '42', def({ field_type: 'number' })],
      ['checkbox', true, def({ field_type: 'checkbox' })],
      ['date', '2026-08-22', def({ field_type: 'date' })],
      ['datetime', '2026-08-22T09:00:00Z', def({ field_type: 'datetime' })],
      ['url', 'https://x.dev', def({ field_type: 'url' })],
      ['email', 'a@b.co', def({ field_type: 'email' })],
      ['person', UUID, def({ field_type: 'person' })],
      ['relation', UUID, def({ field_type: 'relation' })],
      ['select', 'a', def({ field_type: 'select', config: { options: [{ id: 'a', label: 'A' }] } })],
      ['multi_select', ['a'], def({ field_type: 'multi_select', config: { options: [{ id: 'a', label: 'A' }] } })],
      ['long_text', 'para', def({ field_type: 'long_text' })],
    ]
    for (const [type, raw, definition] of cases) {
      expect(validateFieldValue(definition, coerceInputValue(type, raw)).ok).toBe(true)
    }
    expect(cases).toHaveLength(FIELD_TYPES.length)
  })
})

describe('fieldsForTask', () => {
  const global1 = def({ id: 'g1', name: 'Global', field_type: 'text', position: 1 })
  const boardOwn = def({ id: 'b1', name: 'Board', field_type: 'text', scope: 'board', board_id: 'B1', position: 0 })
  const boardOther = def({ id: 'b2', name: 'Other', field_type: 'text', scope: 'board', board_id: 'B2' })
  const bugOnly = def({ id: 't1', name: 'Severity', field_type: 'text', applies_to_types: ['bug'] })
  const archived = def({ id: 'z1', name: 'Old', field_type: 'text', is_archived: true })

  const all = [global1, boardOwn, boardOther, bugOnly, archived]

  it('keeps global fields and this board\'s, and drops another board\'s', () => {
    const ids = fieldsForTask(all, { boardId: 'B1', typeKey: 'task' }).map((d) => d.id)
    expect(ids).toContain('g1')
    expect(ids).toContain('b1')
    expect(ids).not.toContain('b2')
  })

  it('drops a field narrowed to a type this item is not', () => {
    expect(fieldsForTask(all, { boardId: 'B1', typeKey: 'task' }).map((d) => d.id)).not.toContain('t1')
    expect(fieldsForTask(all, { boardId: 'B1', typeKey: 'bug' }).map((d) => d.id)).toContain('t1')
  })

  it('hides an archived field unless this task already holds a value for it', () => {
    expect(fieldsForTask(all, { boardId: 'B1', typeKey: 'task' }).map((d) => d.id)).not.toContain('z1')
    // Same reason statusesForPicker keeps the current status: a control whose value is not
    // among its options renders blank and offers to silently change it.
    expect(
      fieldsForTask(all, { boardId: 'B1', typeKey: 'task', valuedFieldIds: ['z1'] }).map((d) => d.id),
    ).toContain('z1')
  })

  it('orders by position, then name', () => {
    expect(fieldsForTask(all, { boardId: 'B1', typeKey: 'task' }).map((d) => d.id)).toEqual(['b1', 'g1'])
  })

  it('does not narrow by type when the type is unknown', () => {
    // Failing open here matches statusesAvailableOnBoard: a briefly over-generous list beats
    // an empty one, and the database refuses anything genuinely inapplicable.
    expect(fieldsForTask(all, { boardId: 'B1', typeKey: null }).map((d) => d.id)).toContain('t1')
  })

  it('handles no definitions at all', () => {
    expect(fieldsForTask(null, { boardId: 'B1' })).toEqual([])
    expect(fieldsForTask(undefined, {})).toEqual([])
  })
})

describe('validateFieldDefinition', () => {
  it('refuses a choice field with no options', () => {
    expect(validateFieldDefinition({ name: 'Tier', field_type: 'select', config: { options: [] } }).ok).toBe(false)
  })

  it('refuses duplicate or blank option ids and blank labels', () => {
    const dup = { name: 'T', field_type: 'select' as FieldType, config: { options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] } }
    expect(validateFieldDefinition(dup).ok).toBe(false)
    const blankId = { name: 'T', field_type: 'select' as FieldType, config: { options: [{ id: ' ', label: 'A' }] } }
    expect(validateFieldDefinition(blankId).ok).toBe(false)
    const blankLabel = { name: 'T', field_type: 'select' as FieldType, config: { options: [{ id: 'a', label: '' }] } }
    expect(validateFieldDefinition(blankLabel).ok).toBe(false)
  })

  it('refuses min above max', () => {
    expect(validateFieldDefinition({ name: 'N', field_type: 'number', config: { min: 10, max: 1 } }).ok).toBe(false)
    expect(validateFieldDefinition({ name: 'N', field_type: 'number', config: { min: 1, max: 10 } }).ok).toBe(true)
  })

  it('refuses a key the database CHECK would refuse', () => {
    expect(validateFieldDefinition({ name: 'A', field_type: 'text', config: {}, key: '1bad' }).ok).toBe(false)
    expect(validateFieldDefinition({ name: 'A', field_type: 'text', config: {}, key: 'Bad' }).ok).toBe(false)
    expect(validateFieldDefinition({ name: 'A', field_type: 'text', config: {}, key: 'good_key1' }).ok).toBe(true)
  })

  it('requires a name', () => {
    expect(validateFieldDefinition({ name: '  ', field_type: 'text', config: {} }).ok).toBe(false)
  })

  it('gives a choice field a usable starting option', () => {
    expect(validateFieldDefinition({ name: 'T', field_type: 'select', config: defaultConfigFor('select') }).ok).toBe(true)
    expect(defaultConfigFor('text')).toEqual({})
  })
})

describe('formatFieldValue', () => {
  it('renders option labels rather than ids', () => {
    const sel = def({ field_type: 'select', config: { options: [{ id: 'a', label: 'Alpha' }] } })
    expect(formatFieldValue(sel, 'a')).toBe('Alpha')
    const multi = def({ field_type: 'multi_select', config: { options: [{ id: 'a', label: 'Alpha' }, { id: 'b', label: 'Beta' }] } })
    expect(formatFieldValue(multi, ['a', 'b'])).toBe('Alpha, Beta')
  })

  it('falls back to the raw id when an option was removed from the definition', () => {
    const sel = def({ field_type: 'select', config: { options: [{ id: 'a', label: 'Alpha' }] } })
    expect(formatFieldValue(sel, 'gone')).toBe('gone')
  })

  it('resolves a person and a relation through the lookup it is given', () => {
    expect(formatFieldValue(def({ field_type: 'person' }), UUID, { people: { [UUID]: 'Kayla' } })).toBe('Kayla')
    expect(formatFieldValue(def({ field_type: 'relation' }), UUID, { workItems: { [UUID]: 'Fix login' } })).toBe('Fix login')
  })

  it('renders a checkbox as words', () => {
    expect(formatFieldValue(def({ field_type: 'checkbox' }), true)).toBe('Yes')
    expect(formatFieldValue(def({ field_type: 'checkbox' }), false)).toBe('No')
  })

  it('leaves a date-only value exactly as stored, never reformatted through a timezone', () => {
    expect(formatFieldValue(def({ field_type: 'date' }), '2026-08-22')).toBe('2026-08-22')
  })

  it('renders nothing for an unset value', () => {
    expect(formatFieldValue(def({ field_type: 'text' }), null)).toBe('')
    expect(formatFieldValue(def({ field_type: 'multi_select' }), [])).toBe('')
  })
})

describe('isEmptyValue / fieldKeyFromName', () => {
  it('counts false and 0 as SET, not empty', () => {
    // A ticked-then-unticked checkbox and a budget of zero are answers, not absences.
    expect(isEmptyValue(false)).toBe(false)
    expect(isEmptyValue(0)).toBe(false)
    expect(isEmptyValue('')).toBe(true)
    expect(isEmptyValue([])).toBe(true)
    expect(isEmptyValue(null)).toBe(true)
  })

  it('slugifies a name into a database-acceptable key', () => {
    expect(fieldKeyFromName('Estimated Hours')).toBe('estimated_hours')
    expect(fieldKeyFromName('  Client / PO #  ')).toBe('client_po')
    expect(validateFieldDefinition({
      name: 'Estimated Hours', field_type: 'number', config: {},
      key: fieldKeyFromName('Estimated Hours'),
    }).ok).toBe(true)
  })
})
