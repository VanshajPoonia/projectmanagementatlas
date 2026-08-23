// Shared parity cases for the custom-field engine.
//
// WHY THIS FILE EXISTS, AND WHY IT IS .mjs
// lib/custom-fields.ts claims to MIRROR private.validate_field_value. A claim like that decays
// the moment either side is edited alone, and neither a unit test nor an RLS harness can catch
// the drift on its own - the unit test never sees Postgres, and the harness never imports the
// TypeScript.
//
// So both read this list. `lib/custom-fields.parity.test.ts` asserts the TypeScript validator
// agrees with every `valid` flag below; `scripts/check-work-items.mjs` writes every case to the
// real database and asserts the trigger agrees with the same flags. If the two implementations
// ever diverge, one of them fails against a case the other passes.
//
// Plain .mjs with no imports so a Node script and a vitest run can both load it unbuilt.
//
// Cases marked `dbOnly: true` are ones the client CANNOT decide - existence of a person, of a
// related work item, board scope. The harness checks them; the parity test skips them, because
// a client that guessed at them would be wrong in the restrictive direction.

/** @typedef {{name: string, field_type: string, config?: object, is_required?: boolean, value: unknown, valid: boolean, dbOnly?: boolean}} ParityCase */

/** @type {ParityCase[]} */
export const PARITY_CASES = [
  // ---- text / long_text ----
  { name: 'text accepts a string', field_type: 'text', value: 'hello', valid: true },
  { name: 'text refuses a number', field_type: 'text', value: 42, valid: false },
  { name: 'text refuses a boolean', field_type: 'text', value: true, valid: false },
  { name: 'text within max_length', field_type: 'text', config: { max_length: 5 }, value: 'abcde', valid: true },
  { name: 'text over max_length', field_type: 'text', config: { max_length: 5 }, value: 'abcdef', valid: false },
  { name: 'long_text accepts newlines', field_type: 'long_text', value: 'a\nb', valid: true },
  { name: 'optional text accepts null', field_type: 'text', value: null, valid: true },
  { name: 'required text refuses null', field_type: 'text', is_required: true, value: null, valid: false },
  { name: 'required text refuses whitespace', field_type: 'text', is_required: true, value: '   ', valid: false },
  { name: 'required text accepts content', field_type: 'text', is_required: true, value: 'x', valid: true },

  // ---- number ----
  { name: 'number accepts an integer', field_type: 'number', value: 7, valid: true },
  { name: 'number accepts a decimal', field_type: 'number', value: 2.5, valid: true },
  { name: 'number accepts a negative', field_type: 'number', value: -3, valid: true },
  { name: 'number refuses a numeric string', field_type: 'number', value: '7', valid: false },
  { name: 'number at its min', field_type: 'number', config: { min: 0 }, value: 0, valid: true },
  { name: 'number below its min', field_type: 'number', config: { min: 0 }, value: -1, valid: false },
  { name: 'number at its max', field_type: 'number', config: { max: 10 }, value: 10, valid: true },
  { name: 'number above its max', field_type: 'number', config: { max: 10 }, value: 11, valid: false },

  // ---- checkbox ----
  { name: 'checkbox accepts true', field_type: 'checkbox', value: true, valid: true },
  { name: 'checkbox accepts false', field_type: 'checkbox', value: false, valid: true },
  { name: 'checkbox refuses a string', field_type: 'checkbox', value: 'yes', valid: false },
  { name: 'checkbox refuses a number', field_type: 'checkbox', value: 1, valid: false },

  // ---- date ----
  { name: 'date accepts YYYY-MM-DD', field_type: 'date', value: '2026-08-22', valid: true },
  { name: 'date accepts a leap day in a leap year', field_type: 'date', value: '2024-02-29', valid: true },
  { name: 'date refuses a leap day in a common year', field_type: 'date', value: '2026-02-29', valid: false },
  { name: 'date refuses month 13', field_type: 'date', value: '2026-13-01', valid: false },
  { name: 'date refuses day 31 in April', field_type: 'date', value: '2026-04-31', valid: false },
  { name: 'date refuses an instant', field_type: 'date', value: '2026-08-22T10:00:00Z', valid: false },
  { name: 'date refuses a slashed date', field_type: 'date', value: '22/08/2026', valid: false },

  // ---- datetime ----
  { name: 'datetime accepts an ISO instant', field_type: 'datetime', value: '2026-08-22T10:00:00Z', valid: true },
  { name: 'datetime accepts a plain date', field_type: 'datetime', value: '2026-08-22', valid: true },
  { name: 'datetime refuses prose', field_type: 'datetime', value: 'next tuesday', valid: false },

  // ---- select ----
  {
    name: 'select accepts a defined option', field_type: 'select',
    config: { options: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }, value: 'a', valid: true,
  },
  {
    name: 'select refuses an undefined option', field_type: 'select',
    config: { options: [{ id: 'a', label: 'A' }] }, value: 'z', valid: false,
  },
  {
    name: 'select refuses an array', field_type: 'select',
    config: { options: [{ id: 'a', label: 'A' }] }, value: ['a'], valid: false,
  },

  // ---- multi_select ----
  {
    name: 'multi_select accepts defined options', field_type: 'multi_select',
    config: { options: [{ id: 'x', label: 'X' }, { id: 'y', label: 'Y' }] }, value: ['x', 'y'], valid: true,
  },
  {
    name: 'multi_select accepts one option', field_type: 'multi_select',
    config: { options: [{ id: 'x', label: 'X' }] }, value: ['x'], valid: true,
  },
  {
    name: 'multi_select refuses an unknown option', field_type: 'multi_select',
    config: { options: [{ id: 'x', label: 'X' }] }, value: ['x', 'q'], valid: false,
  },
  {
    name: 'multi_select refuses duplicates', field_type: 'multi_select',
    config: { options: [{ id: 'x', label: 'X' }] }, value: ['x', 'x'], valid: false,
  },
  {
    name: 'multi_select refuses a bare string', field_type: 'multi_select',
    config: { options: [{ id: 'x', label: 'X' }] }, value: 'x', valid: false,
  },
  {
    name: 'multi_select refuses non-string elements', field_type: 'multi_select',
    config: { options: [{ id: 'x', label: 'X' }] }, value: [1], valid: false,
  },
  {
    name: 'optional multi_select accepts an empty list', field_type: 'multi_select',
    config: { options: [{ id: 'x', label: 'X' }] }, value: [], valid: true,
  },
  {
    name: 'required multi_select refuses an empty list', field_type: 'multi_select',
    is_required: true, config: { options: [{ id: 'x', label: 'X' }] }, value: [], valid: false,
  },

  // ---- url ----
  { name: 'url accepts https', field_type: 'url', value: 'https://example.com/x?y=1', valid: true },
  { name: 'url accepts http', field_type: 'url', value: 'http://a.b', valid: true },
  { name: 'url refuses a bare domain', field_type: 'url', value: 'example.com', valid: false },
  { name: 'url refuses another scheme', field_type: 'url', value: 'ftp://example.com', valid: false },
  { name: 'url refuses a space', field_type: 'url', value: 'https://a b.com', valid: false },

  // ---- email ----
  { name: 'email accepts a plain address', field_type: 'email', value: 'a@b.co', valid: true },
  { name: 'email accepts plus-addressing', field_type: 'email', value: 'first.last+tag@sub.example.com', valid: true },
  { name: 'email accepts an apostrophe', field_type: 'email', value: "o'brien@example.com", valid: true },
  { name: 'email refuses a missing @', field_type: 'email', value: 'not-an-email', valid: false },
  { name: 'email refuses a missing dot', field_type: 'email', value: 'a@b', valid: false },
  { name: 'email refuses a space', field_type: 'email', value: 'a b@c.co', valid: false },

  // ---- person / relation: the shape both sides agree on ----
  { name: 'person refuses a non-uuid', field_type: 'person', value: 'somebody', valid: false },
  { name: 'relation refuses a non-uuid', field_type: 'relation', value: '123', valid: false },
  {
    name: 'person refuses a well-formed uuid that is nobody',
    field_type: 'person', value: '00000000-0000-4000-8000-000000000000', valid: false, dbOnly: true,
  },
  {
    name: 'relation refuses a well-formed uuid that is no work item',
    field_type: 'relation', value: '00000000-0000-4000-8000-000000000000', valid: false, dbOnly: true,
  },
]
