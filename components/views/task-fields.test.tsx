// @vitest-environment jsdom
//
// A custom field column on /views used to render `String(value)`, and for half the field types
// a stored value is an ID rather than the thing it names: a select stores an option id, a
// person and a relation store uuids, a checkbox stores a boolean. So a column an admin had
// just created showed `option_1`, `true`, and raw uuids to every reader.
//
// `formatFieldValue` was written for exactly this and had no call site anywhere in the product
// - working code behind no route a human could take, which is this repo's most-repeated defect.
// These cases fail if FieldCell goes back to stringifying, and they fail if EvalContext stops
// carrying the definitions, which is the half that made the bug possible.
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

import { FieldCell } from './task-fields'
import { customFilterField, type EvalContext } from '@/lib/view-config'
import type { FieldDefinition } from '@/lib/custom-fields'

const definition = (over: Partial<FieldDefinition>): FieldDefinition =>
  ({
    id: 'f1', key: 'k', name: 'Field', description: null, field_type: 'text',
    config: {}, is_required: false, scope: 'global', board_id: null,
    applies_to_types: null, position: 0, is_archived: false,
    ...over,
  }) as FieldDefinition

const task = { id: 't1', title: 'A task' }

function ctxFor(def: FieldDefinition, value: unknown): EvalContext {
  return {
    currentUserId: null,
    now: new Date('2026-09-03T00:00:00Z'),
    customFields: [def],
    customValues: { t1: { [def.key]: value } },
    peopleNames: { 'user-uuid-1': 'Kayla Viehland' },
    workItemTitles: { 'task-uuid-9': 'Roof inspection' },
  }
}

function renderCell(def: FieldDefinition, value: unknown) {
  const ctx = ctxFor(def, value)
  render(<FieldCell task={task} field={customFilterField(def.key)} ctx={ctx} />)
}

describe('FieldCell renders a custom value, not the id behind it', () => {
  it('a select shows the option label, never the option id', () => {
    renderCell(
      definition({
        key: 'stage', field_type: 'select',
        config: { options: [{ id: 'option_1', label: 'Awaiting survey' }] },
      }),
      'option_1',
    )
    expect(screen.getByText('Awaiting survey')).toBeInTheDocument()
    expect(screen.queryByText('option_1')).not.toBeInTheDocument()
  })

  it('a multi-select joins labels, never ids', () => {
    renderCell(
      definition({
        key: 'trades', field_type: 'multi_select',
        config: { options: [
          { id: 'o1', label: 'Roofing' },
          { id: 'o2', label: 'Electrical' },
        ] },
      }),
      ['o1', 'o2'],
    )
    expect(screen.getByText('Roofing, Electrical')).toBeInTheDocument()
  })

  it('a checkbox reads Yes or No, not true or false', () => {
    renderCell(definition({ key: 'signed', field_type: 'checkbox' }), true)
    expect(screen.getByText('Yes')).toBeInTheDocument()
    expect(screen.queryByText('true')).not.toBeInTheDocument()
  })

  it('a person shows a name, never a uuid', () => {
    renderCell(definition({ key: 'inspector', field_type: 'person' }), 'user-uuid-1')
    expect(screen.getByText('Kayla Viehland')).toBeInTheDocument()
    expect(screen.queryByText('user-uuid-1')).not.toBeInTheDocument()
  })

  it('a relation shows the work item title, never a uuid', () => {
    renderCell(definition({ key: 'blocks', field_type: 'relation' }), 'task-uuid-9')
    expect(screen.getByText('Roof inspection')).toBeInTheDocument()
  })

  it('an unresolvable id falls back to the id rather than rendering blank', () => {
    // Honest, and deliberate: a relation may point outside the current scope. Showing nothing
    // would claim the field is empty, which is a different and worse statement than showing a
    // value we could not resolve.
    renderCell(definition({ key: 'blocks', field_type: 'relation' }), 'not-in-scope')
    expect(screen.getByText('not-in-scope')).toBeInTheDocument()
  })

  it('a definition fetched without its config degrades to the id, it does not crash', () => {
    // /views selected field_definitions without `config`, so `definition.config.options` threw
    // and the cell rendered blank - a table failing over one missing column in a query. The
    // page selects it now; this keeps the function survivable if another caller forgets.
    const def = definition({ key: 'stage', field_type: 'select' })
    delete (def as any).config
    renderCell(def, 'option_1')
    expect(screen.getByText('option_1')).toBeInTheDocument()
  })

  it('an empty value renders the muted dash, not the string "null"', () => {
    renderCell(definition({ key: 'stage', field_type: 'text' }), null)
    expect(screen.queryByText('null')).not.toBeInTheDocument()
  })

  it('without the definitions it degrades to the raw value rather than crashing', () => {
    // The old EvalContext carried values and no definitions. Keep that path survivable: a host
    // that has not been updated should render something, just not something resolved.
    const ctx: EvalContext = {
      currentUserId: null,
      now: new Date('2026-09-03T00:00:00Z'),
      customValues: { t1: { stage: 'option_1' } },
    }
    render(<FieldCell task={task} field={customFilterField('stage')} ctx={ctx} />)
    expect(screen.getByText('option_1')).toBeInTheDocument()
  })
})
