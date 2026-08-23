import { describe, it, expect } from 'vitest'
import { PARITY_CASES } from './custom-fields.cases.mjs'
import { validateFieldValue, FIELD_TYPES, type FieldDefinition, type FieldType } from './custom-fields'

/**
 * Half of the parity gate. This half asserts the TypeScript validator agrees with every case
 * in the shared list; `scripts/check-work-items.mjs` writes the same list to a real database
 * and asserts `private.validate_field_value` agrees with it too.
 *
 * Neither half can prove the mirror alone - this one never sees Postgres, and the harness never
 * imports this module. Together, a change to either implementation that is not made to the
 * other fails against a case the other still passes.
 */
describe('custom field validation - parity with private.validate_field_value', () => {
  const decidable = PARITY_CASES.filter((c) => !c.dbOnly)

  it.each(decidable.map((c) => [c.name, c] as const))('%s', (_name, testCase) => {
    const definition: FieldDefinition = {
      id: 'parity',
      key: 'parity',
      name: 'Field',
      field_type: testCase.field_type as FieldType,
      config: (testCase.config ?? {}) as FieldDefinition['config'],
      is_required: testCase.is_required ?? false,
      scope: 'global',
      board_id: null,
      applies_to_types: null,
      position: 0,
      is_archived: false,
    }
    expect(validateFieldValue(definition, testCase.value).ok).toBe(testCase.valid)
  })

  it('covers every field type, so a new one cannot be added with no parity case', () => {
    const covered = new Set(PARITY_CASES.map((c) => c.field_type))
    for (const type of FIELD_TYPES) {
      expect(covered.has(type), `no parity case for field type "${type}"`).toBe(true)
    }
  })

  it('exercises both outcomes, so the list cannot degrade into all-accept or all-refuse', () => {
    expect(decidable.some((c) => c.valid)).toBe(true)
    expect(decidable.some((c) => !c.valid)).toBe(true)
  })

  it('marks as dbOnly exactly the cases a client genuinely cannot decide', () => {
    // Existence of a person or a work item needs a query. Anything else claiming to be dbOnly
    // is a rule this module should be enforcing and quietly is not.
    for (const c of PARITY_CASES.filter((x) => x.dbOnly)) {
      expect(['person', 'relation']).toContain(c.field_type)
    }
  })
})
