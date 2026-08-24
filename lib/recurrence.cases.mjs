// Shared recurrence date-math cases, checked TWICE against two independent implementations:
//
//   recurrence.parity.test.ts   -> lib/recurrence.ts       nextOccurrenceDate()
//   scripts/check-recurrence.mjs -> the real database's   public.next_occurrence_date()
//
// The point is that neither side is the reference. A preview the editor draws and the dates the
// generator actually creates must be the same dates, and the only way to keep two
// implementations honest is to run one list of cases through both. Confirmed to bite: flipping
// a single `expect` here fails the vitest run AND the database harness.
//
// Plain .mjs so both a Node script and vitest can load it with no build step, exactly like
// lib/custom-fields.cases.mjs.
//
// 2026-08-24 anchors, chosen so each case pins a specific hazard rather than a happy path:
//   2026-08-24 is a Monday, 2026-08-28 a Friday, 2026-08-29 a Saturday, 2026-08-23 a Sunday.

/** @typedef {{name: string, after: string, frequency: string, interval: number, weekdays?: number[]|null, monthDay?: number|null, expect: string|null}} RecurrenceCase */

/** @type {RecurrenceCase[]} */
export const RECURRENCE_CASES = [
  // --- daily -----------------------------------------------------------------------------
  { name: 'daily, every day', after: '2026-08-24', frequency: 'daily', interval: 1, expect: '2026-08-25' },
  { name: 'daily, every 10 days', after: '2026-08-24', frequency: 'daily', interval: 10, expect: '2026-09-03' },
  { name: 'daily crosses a month boundary', after: '2026-08-31', frequency: 'daily', interval: 1, expect: '2026-09-01' },
  { name: 'daily crosses a year boundary', after: '2026-12-31', frequency: 'daily', interval: 1, expect: '2027-01-01' },
  { name: 'daily lands on a leap day', after: '2028-02-28', frequency: 'daily', interval: 1, expect: '2028-02-29' },
  { name: 'daily, interval 365', after: '2026-08-24', frequency: 'daily', interval: 365, expect: '2027-08-24' },

  // --- weekly, no weekday list -------------------------------------------------------------
  { name: 'weekly, same weekday', after: '2026-08-24', frequency: 'weekly', interval: 1, expect: '2026-08-31' },
  { name: 'weekly, fortnightly', after: '2026-08-24', frequency: 'weekly', interval: 2, expect: '2026-09-07' },
  { name: 'weekly with an empty list behaves as plain weekly', after: '2026-08-24', frequency: 'weekly', interval: 1, weekdays: [], expect: '2026-08-31' },

  // --- weekly with selected weekdays -------------------------------------------------------
  // The hazard is the week boundary: "is there another listed day left this week, or do we
  // jump?" Each of these sits on a different side of it.
  { name: 'Mon->Wed within the week (Mon/Wed/Fri)', after: '2026-08-24', frequency: 'weekly', interval: 1, weekdays: [1, 3, 5], expect: '2026-08-26' },
  { name: 'Wed->Fri within the week (Mon/Wed/Fri)', after: '2026-08-26', frequency: 'weekly', interval: 1, weekdays: [1, 3, 5], expect: '2026-08-28' },
  { name: 'Fri->next Mon, jumping the week (Mon/Wed/Fri)', after: '2026-08-28', frequency: 'weekly', interval: 1, weekdays: [1, 3, 5], expect: '2026-08-31' },
  { name: 'Sat->next Mon, nothing left this week', after: '2026-08-29', frequency: 'weekly', interval: 1, weekdays: [1], expect: '2026-08-31' },
  { name: 'Sun->next Sun, Sunday is the week start', after: '2026-08-23', frequency: 'weekly', interval: 1, weekdays: [0], expect: '2026-08-30' },
  { name: 'Sun->Mon, next day is listed', after: '2026-08-23', frequency: 'weekly', interval: 1, weekdays: [0, 1], expect: '2026-08-24' },
  { name: 'Sat->Sun, crossing into the next week by one day', after: '2026-08-29', frequency: 'weekly', interval: 1, weekdays: [0], expect: '2026-08-30' },
  { name: 'every 2 weeks, Fri->Mon skips a week', after: '2026-08-28', frequency: 'weekly', interval: 2, weekdays: [1, 5], expect: '2026-09-07' },
  { name: 'every 2 weeks, Mon->Fri stays in the week', after: '2026-08-24', frequency: 'weekly', interval: 2, weekdays: [1, 5], expect: '2026-08-28' },
  { name: 'weekdays out of order are still honoured', after: '2026-08-24', frequency: 'weekly', interval: 1, weekdays: [5, 1, 3], expect: '2026-08-26' },
  { name: 'all seven weekdays behaves as daily', after: '2026-08-24', frequency: 'weekly', interval: 1, weekdays: [0, 1, 2, 3, 4, 5, 6], expect: '2026-08-25' },
  { name: 'weekly list jumps a month boundary', after: '2026-08-31', frequency: 'weekly', interval: 1, weekdays: [1], expect: '2026-09-07' },

  // --- monthly, no explicit day ------------------------------------------------------------
  // Clamping is the whole hazard. Postgres does it; lib/recurrence.ts must do it identically.
  { name: 'monthly, same day', after: '2026-08-24', frequency: 'monthly', interval: 1, expect: '2026-09-24' },
  { name: 'monthly, quarterly', after: '2026-08-24', frequency: 'monthly', interval: 3, expect: '2026-11-24' },
  { name: 'Jan 31 + 1 month clamps to Feb 28', after: '2026-01-31', frequency: 'monthly', interval: 1, expect: '2026-02-28' },
  { name: 'Jan 31 + 1 month clamps to Feb 29 in a leap year', after: '2028-01-31', frequency: 'monthly', interval: 1, expect: '2028-02-29' },
  { name: 'Jan 30 + 1 month clamps to Feb 28', after: '2026-01-30', frequency: 'monthly', interval: 1, expect: '2026-02-28' },
  { name: 'Mar 31 + 1 month clamps to Apr 30', after: '2026-03-31', frequency: 'monthly', interval: 1, expect: '2026-04-30' },
  { name: 'monthly crosses the year boundary', after: '2026-12-15', frequency: 'monthly', interval: 1, expect: '2027-01-15' },
  { name: 'monthly, 12 months is a year', after: '2026-08-24', frequency: 'monthly', interval: 12, expect: '2027-08-24' },

  // --- monthly, explicit day-of-month ------------------------------------------------------
  { name: 'day 15 of next month', after: '2026-08-15', frequency: 'monthly', interval: 1, monthDay: 15, expect: '2026-09-15' },
  { name: 'day 31 clamps into a 30-day month', after: '2026-08-15', frequency: 'monthly', interval: 1, monthDay: 31, expect: '2026-09-30' },
  { name: 'day 31 clamps into February', after: '2026-01-15', frequency: 'monthly', interval: 1, monthDay: 31, expect: '2026-02-28' },
  { name: 'day 1 of next month', after: '2026-08-24', frequency: 'monthly', interval: 1, monthDay: 1, expect: '2026-09-01' },
  { name: 'day-of-month ignores the source day entirely', after: '2026-08-01', frequency: 'monthly', interval: 1, monthDay: 20, expect: '2026-09-20' },
  { name: 'day-of-month across the year boundary', after: '2026-12-05', frequency: 'monthly', interval: 1, monthDay: 5, expect: '2027-01-05' },

  // --- yearly ------------------------------------------------------------------------------
  { name: 'yearly', after: '2026-08-24', frequency: 'yearly', interval: 1, expect: '2027-08-24' },
  { name: 'yearly, every 2 years', after: '2026-08-24', frequency: 'yearly', interval: 2, expect: '2028-08-24' },
  { name: 'Feb 29 + 1 year clamps to Feb 28', after: '2024-02-29', frequency: 'yearly', interval: 1, expect: '2025-02-28' },
  { name: 'Feb 29 + 4 years is Feb 29 again', after: '2024-02-29', frequency: 'yearly', interval: 4, expect: '2028-02-29' },

  // --- refusals ----------------------------------------------------------------------------
  // Both sides must decline the same inputs rather than one silently inventing an answer.
  { name: 'an unknown frequency yields nothing', after: '2026-08-24', frequency: 'fortnightly', interval: 1, expect: null },
  { name: 'an empty frequency yields nothing', after: '2026-08-24', frequency: '', interval: 1, expect: null },

  // Interval 0 and negatives are refused by the CHECK constraint, but the function is called
  // directly by the preview before any row exists, so both sides must floor them to 1 rather
  // than return the same date forever and spin the caller's loop.
  { name: 'interval 0 is floored to 1', after: '2026-08-24', frequency: 'daily', interval: 0, expect: '2026-08-25' },
  { name: 'a negative interval is floored to 1', after: '2026-08-24', frequency: 'daily', interval: -5, expect: '2026-08-25' },
]
