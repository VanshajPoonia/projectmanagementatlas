import { describe, it, expect } from 'vitest'
import {
  parseQuickCapture,
  stripMatches,
  captureDueTimestamp,
  findMentions,
  type ParsedCapture,
} from './quick-capture'

// 2026-08-24 is a Monday. Every date assertion is anchored to it so nothing depends on the
// day this suite happens to run.
const TODAY = '2026-08-24'
const p = (input: string, opts = {}) => parseQuickCapture(input, { today: TODAY, ...opts })

const PEOPLE = [
  { id: 'u-bobby', name: 'Bobby Shanks' },
  { id: 'u-kayla', name: 'Kayla Viehland' },
  { id: 'u-tim', name: 'Tim Kennon' },
  { id: 'u-tina', name: 'Tina Marsh' },
]
const LABELS = [{ id: 't-atlas', name: 'Atlas' }, { id: 't-srg', name: 'SRG' }]

describe("Prompt D's worked example", () => {
  it('parses every field out of the example line', () => {
    const r = p('Prepare bid package tomorrow 3pm high priority @Bobby #Atlas', {
      people: PEOPLE, labels: LABELS,
    })
    expect(r.title).toBe('Prepare bid package')
    expect(r.dueDate).toBe('2026-08-25')
    expect(r.dueTime).toBe('15:00')
    expect(r.priority).toBe(2)
    expect(r.assignees).toEqual(['u-bobby'])
    expect(r.labels).toEqual(['t-atlas'])
  })

  it('produces a timestamp the task row can take', () => {
    const r = p('Prepare bid package tomorrow 3pm')
    expect(captureDueTimestamp(r)).toBe('2026-08-25T15:00:00')
  })

  it('writes a bare date when no time was given', () => {
    expect(captureDueTimestamp(p('Ship it tomorrow'))).toBe('2026-08-25')
  })
})

// This is the requirement Prompt D states outright, so it gets a property test rather than
// examples. Every character of the input must end up either in the title or inside a match.
describe('never silently discards user text', () => {
  const INPUTS = [
    'Prepare bid package tomorrow 3pm high priority @Bobby #Atlas',
    'Call the client',
    'Review drawings friday p1',
    'every monday standup at 9am',
    'Submit RFI 2026-09-01 15:30 urgent #SRG @Kayla',
    'Follow up in 3 days',
    'Nothing special here at all',
    'Ping @nobody about #missing',
    'Renew insurance 5 March',
    'eom invoice run !3',
    '   spaced   out   text   ',
    'Fix bug 12/9 low priority',
  ]

  for (const input of INPUTS) {
    it(`accounts for every character of: ${input.trim()}`, () => {
      const r = p(input, { people: PEOPLE, labels: LABELS })

      // Title is exactly the input minus the matched spans - not a re-rendering of it.
      expect(r.title).toBe(stripMatches(input, r.matches))

      // Every match quotes the input verbatim at its stated offsets.
      for (const m of r.matches) {
        expect(input.slice(m.start, m.end)).toBe(m.text)
      }

      // No two matches may claim the same character.
      const sorted = [...r.matches].sort((a, b) => a.start - b.start)
      for (let i = 1; i < sorted.length; i++) {
        expect(sorted[i].start).toBeGreaterThanOrEqual(sorted[i - 1].end)
      }

      // Nothing may vanish: every non-space character is either in the title or in a match.
      const consumed = r.matches.map((m) => m.text).join('')
      const accounted = (r.title + consumed).replace(/\s/g, '').split('').sort().join('')
      const original = input.replace(/\s/g, '').split('').sort().join('')
      expect(accounted).toBe(original)
    })
  }

  it('keeps an unmatched @name in the title and says why', () => {
    const r = p('Ping @nobody about it', { people: PEOPLE })
    expect(r.title).toBe('Ping @nobody about it')
    expect(r.assignees).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/No one here matches "@nobody"/)
  })

  it('keeps an unmatched #label in the title and says why', () => {
    const r = p('Do it #nosuchtag', { labels: LABELS })
    expect(r.title).toBe('Do it #nosuchtag')
    expect(r.labels).toEqual([])
    expect(r.warnings.join(' ')).toMatch(/No label called "#nosuchtag"/)
  })

  it('warns when parsing consumed the entire line', () => {
    const r = p('tomorrow')
    expect(r.title).toBe('')
    expect(r.warnings.join(' ')).toMatch(/no title yet/)
  })
})

describe('relative dates', () => {
  it('today', () => expect(p('Do it today').dueDate).toBe('2026-08-24'))
  it('tomorrow', () => expect(p('Do it tomorrow').dueDate).toBe('2026-08-25'))
  it('yesterday resolves but warns that it is in the past', () => {
    const r = p('Log it yesterday')
    expect(r.dueDate).toBe('2026-08-23')
    expect(r.warnings.join(' ')).toMatch(/in the past/)
  })
  it('in N days', () => expect(p('Follow up in 3 days').dueDate).toBe('2026-08-27'))
  it('in N weeks', () => expect(p('Review in 2 weeks').dueDate).toBe('2026-09-07'))
  it('in N months clamps like the rest of the app', () => {
    expect(parseQuickCapture('Renew in 1 month', { today: '2026-01-31' }).dueDate).toBe('2026-02-28')
  })
  it('next week', () => expect(p('Sync next week').dueDate).toBe('2026-08-31'))
  it('next month', () => expect(p('Invoice next month').dueDate).toBe('2026-09-24'))

  it('a bare weekday means the NEXT one, never today', () => {
    // TODAY is a Monday. "monday" must mean the 31st, not today.
    expect(p('Standup monday').dueDate).toBe('2026-08-31')
    expect(p('Review friday').dueDate).toBe('2026-08-28')
  })

  it('"next friday" skips the coming one', () => {
    expect(p('Deadline next friday').dueDate).toBe('2026-09-04')
  })

  it('end of week is the coming Friday', () => {
    expect(p('Wrap up eow').dueDate).toBe('2026-08-28')
  })

  it('end of month clamps to the real last day', () => {
    expect(p('Invoices eom').dueDate).toBe('2026-08-31')
    expect(parseQuickCapture('Invoices eom', { today: '2026-02-10' }).dueDate).toBe('2026-02-28')
  })
})

describe('absolute dates', () => {
  it('ISO is taken as-is and never warns', () => {
    const r = p('Submit 2026-09-01')
    expect(r.dueDate).toBe('2026-09-01')
    expect(r.warnings).toEqual([])
  })

  it('rejects an ISO date that does not exist, leaving the text in the title', () => {
    const r = p('Submit 2026-02-30')
    expect(r.dueDate).toBeNull()
    expect(r.title).toContain('2026-02-30')
    expect(r.warnings.join(' ')).toMatch(/not a real date/)
  })

  it('reads "5 March" and "March 5"', () => {
    expect(p('Renew 5 March').dueDate).toBe('2027-03-05')
    expect(p('Renew March 5').dueDate).toBe('2027-03-05')
    expect(p('Renew Mar 5th').dueDate).toBe('2027-03-05')
  })

  it('a bare day+month already past this year rolls to next year', () => {
    // TODAY is August; "5 March" cannot mean five months ago.
    expect(p('Renew 5 March').dueDate).toBe('2027-03-05')
    expect(p('Audit 1 December').dueDate).toBe('2026-12-01')
  })

  it('an explicit year is honoured even when it is in the past', () => {
    expect(p('Backdate 5 March 2025').dueDate).toBe('2025-03-05')
  })

  it('slash dates are read day-first and ALWAYS warn when genuinely ambiguous', () => {
    const r = p('Deliver 5/9')
    expect(r.dueDate).toBe('2026-09-05')
    expect(r.warnings.join(' ')).toMatch(/could be day\/month or month\/day/)
  })

  it('a slash date that can only be month-first is read that way, and says so', () => {
    // 25 is not a month, so 9/25 can only be September 25th.
    const r = p('Deliver 9/25')
    expect(r.dueDate).toBe('2026-09-25')
    expect(r.warnings.join(' ')).toMatch(/day-first would not be a real date/)
  })

  it('does not warn about a slash date with an unambiguous day', () => {
    const r = p('Deliver 25/9')
    expect(r.dueDate).toBe('2026-09-25')
    expect(r.warnings.join(' ')).not.toMatch(/could be/)
  })
})

describe('times', () => {
  it('3pm', () => expect(p('Meet at 3pm').dueTime).toBe('15:00'))
  it('3:30pm', () => expect(p('Meet 3:30pm').dueTime).toBe('15:30'))
  it('9am', () => expect(p('Standup 9am').dueTime).toBe('09:00'))
  it('12pm is noon', () => expect(p('Lunch 12pm').dueTime).toBe('12:00'))
  it('12am is midnight', () => expect(p('Cutover 12am').dueTime).toBe('00:00'))
  it('24-hour', () => expect(p('Deploy at 15:00').dueTime).toBe('15:00'))
  it('late 24-hour', () => expect(p('Deploy at 23:45').dueTime).toBe('23:45'))

  it('a bare "at 9" warns about the am reading it chose', () => {
    const r = p('Call at 9')
    expect(r.dueTime).toBe('09:00')
    expect(r.warnings.join(' ')).toMatch(/Type "9pm" if you meant the afternoon/)
  })

  it('a time with no date is dated today, and says so', () => {
    const r = p('Call at 3pm')
    expect(r.dueDate).toBe(TODAY)
    expect(r.warnings.join(' ')).toMatch(/time with no date/)
  })

  it('rejects an impossible time rather than clamping it', () => {
    const r = p('Deploy at 25:00')
    expect(r.dueTime).toBeNull()
  })

  it('does not read a year as a time', () => {
    expect(p('Submit 2026-09-01').dueTime).toBeNull()
  })
})

describe('priority', () => {
  it.each([
    ['urgent', 1], ['critical', 1], ['asap', 1],
    ['high priority', 2], ['important', 2],
    ['medium priority', 3], ['normal priority', 3],
    ['low priority', 4], ['lowest priority', 5],
  ])('%s -> %i', (text, value) => {
    expect(p(`Do the thing ${text}`).priority).toBe(value)
  })

  it.each([1, 2, 3, 4, 5])('p%i shorthand', (n) => {
    expect(p(`Do the thing p${n}`).priority).toBe(n)
  })

  it.each([1, 2, 3, 4, 5])('!%i shorthand', (n) => {
    expect(p(`Do the thing !${n}`).priority).toBe(n)
  })

  it('leaves the space before !2 in the title rather than eating it', () => {
    const r = p('Fix the door !2')
    expect(r.title).toBe('Fix the door')
    expect(r.priority).toBe(2)
  })

  it('ignores a number that is not a priority sigil', () => {
    expect(p('Order 6 hinges').priority).toBeNull()
    expect(p('Order p6 hinges').priority).toBeNull()
  })

  it('does not read "p1" inside a longer word', () => {
    expect(p('Check the p1234 valve').priority).toBeNull()
  })
})

describe('assignees', () => {
  it('matches a first name uniquely', () => {
    expect(p('Ship it @Kayla', { people: PEOPLE }).assignees).toEqual(['u-kayla'])
  })

  it('matches a full name written with a dot or underscore', () => {
    expect(p('Ship it @bobby.shanks', { people: PEOPLE }).assignees).toEqual(['u-bobby'])
    expect(p('Ship it @Bobby_Shanks', { people: PEOPLE }).assignees).toEqual(['u-bobby'])
  })

  it('is case-insensitive', () => {
    expect(p('Ship it @BOBBY', { people: PEOPLE }).assignees).toEqual(['u-bobby'])
  })

  it('flags an ambiguous prefix instead of silently picking one', () => {
    // "Ti" prefixes both Tim Kennon and Tina Marsh. Assigning work to the wrong person
    // quietly is the worst thing this parser could do, so it must speak up.
    const r = p('Ship it @Ti', { people: PEOPLE })
    expect(r.warnings.join(' ')).toMatch(/matches more than one person/)
  })

  it('takes several assignees', () => {
    expect(p('Review @Bobby @Kayla', { people: PEOPLE }).assignees).toEqual(['u-bobby', 'u-kayla'])
  })

  it('returns raw names when given no directory', () => {
    expect(p('Ship it @Bobby').assignees).toEqual(['Bobby'])
  })

  it('does not treat an email address as an assignee token', () => {
    const r = p('Email bobby@goatlasgo.us about it', { people: PEOPLE })
    expect(r.assignees).toEqual([])
    expect(r.title).toContain('bobby@goatlasgo.us')
  })
})

describe('labels', () => {
  it('matches a tag by name, case-insensitively', () => {
    expect(p('Do it #atlas', { labels: LABELS }).labels).toEqual(['t-atlas'])
  })
  it('returns raw names when given no tag list', () => {
    expect(p('Do it #Atlas').labels).toEqual(['Atlas'])
  })
  it('takes several labels', () => {
    expect(p('Do it #Atlas #SRG', { labels: LABELS }).labels).toEqual(['t-atlas', 't-srg'])
  })
})

describe('recurrence', () => {
  it('every monday', () => {
    expect(p('Standup every monday').recurrence).toEqual({ frequency: 'weekly', interval: 1, weekdays: [1] })
  })
  it('every 2 weeks', () => {
    expect(p('Sync every 2 weeks').recurrence).toEqual({ frequency: 'weekly', interval: 2, weekdays: null })
  })
  it('every day', () => {
    expect(p('Check every day').recurrence).toEqual({ frequency: 'daily', interval: 1, weekdays: null })
  })
  it('weekly', () => {
    expect(p('Report weekly').recurrence?.frequency).toBe('weekly')
  })
  it('annually becomes yearly', () => {
    expect(p('Renew annually').recurrence?.frequency).toBe('yearly')
  })

  it('"every monday" is NOT also read as the date "monday"', () => {
    // The bare-weekday date rule would happily eat "monday" out of "every monday" and set a
    // one-off due date, silently turning a repeating task into a single one.
    const r = p('Standup every monday')
    expect(r.recurrence).not.toBeNull()
    expect(r.dueDate).toBeNull()
    expect(r.title).toBe('Standup')
  })
})

describe('plain text is left alone', () => {
  it('keeps a sentence with no syntax intact', () => {
    const r = p('Call the client about the revised scope')
    expect(r.title).toBe('Call the client about the revised scope')
    expect(r.matches).toEqual([])
    expect(r.warnings).toEqual([])
  })

  it('returns an empty result for empty input rather than throwing', () => {
    const r = p('')
    expect(r.title).toBe('')
    expect(r.dueDate).toBeNull()
  })

  it('does not mangle punctuation left behind by a removal', () => {
    expect(p('Draft the memo, tomorrow').title).toBe('Draft the memo,')
  })
})

describe('"next <weekday>" always lands in the following calendar week', () => {
  // The tempting property - "next X" is always seven days after bare "X" - is FALSE, and
  // believing it is how the first implementation shipped with "next friday" meaning "friday".
  // Said on a Tuesday, "next Monday" and "Monday" are the same day, because that Monday is
  // already in next week. The invariant that does hold is stated here instead.
  const DAYS = ['2026-08-23', '2026-08-24', '2026-08-25', '2026-08-26', '2026-08-27', '2026-08-28', '2026-08-29']
  const dayNum = (iso: string) => Date.parse(iso + 'T00:00:00Z') / 86400000

  for (const today of DAYS) {
    for (const day of ['sunday', 'monday', 'friday']) {
      it(`${day} from ${today}`, () => {
        const bare = parseQuickCapture(`Do it ${day}`, { today }).dueDate!
        const next = parseQuickCapture(`Do it next ${day}`, { today }).dueDate!

        // Never today or earlier, in either reading.
        expect(bare > today).toBe(true)
        expect(next > today).toBe(true)

        // "next X" is never sooner than a bare "X" - it either matches it or skips a week.
        expect(dayNum(next)).toBeGreaterThanOrEqual(dayNum(bare))
        expect([0, 7]).toContain(dayNum(next) - dayNum(bare))

        // And it is always inside next calendar week, Sunday-anchored.
        const weekStart = dayNum(today) + (7 - new Date(today + 'T00:00:00Z').getUTCDay())
        expect(dayNum(next)).toBeGreaterThanOrEqual(weekStart)
        expect(dayNum(next)).toBeLessThan(weekStart + 7)
      })
    }
  }

  it('skips a week when the bare weekday is still in this week', () => {
    // Monday the 24th: Friday the 28th is this week, so "next friday" must skip to the 4th.
    expect(parseQuickCapture('Do it friday', { today: '2026-08-24' }).dueDate).toBe('2026-08-28')
    expect(parseQuickCapture('Do it next friday', { today: '2026-08-24' }).dueDate).toBe('2026-09-04')
  })

  it('agrees with the bare weekday when that day is already in next week', () => {
    // Friday the 28th: the coming Monday is the 31st, which IS next week's Monday.
    expect(parseQuickCapture('Do it monday', { today: '2026-08-28' }).dueDate).toBe('2026-08-31')
    expect(parseQuickCapture('Do it next monday', { today: '2026-08-28' }).dueDate).toBe('2026-08-31')
  })
})

describe('recurrence phrases describe themselves correctly on the chip', () => {
  // The chip is what the user checks before saving, and it is also what convinced the first
  // version of this dialog that recurrence was handled - it was displayed and then dropped.
  it.each([
    ['Standup every monday', 'every Monday'],
    ['Sync every 2 weeks', 'every 2 weeks'],
    ['Check every day', 'every day'],
    ['Backup every 3 days', 'every 3 days'],
    ['Report weekly', 'every week'],
    ['Renew annually', 'every year'],
    ['Review monthly', 'every month'],
  ])('%s -> %s', (input, expected) => {
    const m = p(input).matches.find((x) => x.field === 'recurrence')
    expect(m?.display).toBe(expected)
  })
})

describe('findMentions', () => {
  const people = [
    { id: 'bobby', name: 'Bobby Shanks' },
    { id: 'kayla', name: 'Kayla Viehland' },
    { id: 'kogan', name: 'Kogan Smith' },
    { id: 'kayleigh', name: 'Kayleigh Brown' },
  ]

  it('finds an @name anywhere in free text', () => {
    expect(findMentions('can you look at this @bobby before friday', people).map((m) => m.id))
      .toEqual(['bobby'])
  })

  it('finds several, and never notifies the same person twice', () => {
    const found = findMentions('@bobby @kogan @bobby take a look', people)
    expect(found.map((m) => m.id)).toEqual(['bobby', 'kogan'])
  })

  it('resolves a full name as well as a first name', () => {
    expect(findMentions('@Kayla.Viehland ping', people).map((m) => m.id)).toEqual(['kayla'])
  })

  it('flags an ambiguous token rather than picking whoever sorts first', () => {
    // "kay" prefixes both Kayla and Kayleigh. The caller skips ambiguous hits: telling the
    // wrong person they were addressed is a harm they have no way to detect.
    const [hit] = findMentions('@kay please review', people)
    expect(hit.ambiguous).toBe(true)
  })

  it('ignores a token that matches nobody, and an email address', () => {
    expect(findMentions('email bob@example.com about @nobody', people).map((m) => m.id)).toEqual([])
  })

  it('survives empty and missing input', () => {
    expect(findMentions('', people)).toEqual([])
    expect(findMentions('hello @bobby', [])).toEqual([])
    expect(findMentions(null as any, people)).toEqual([])
  })

  it('shares its resolution rule with quick capture, so @bobby cannot mean two people', () => {
    const mentioned = findMentions('Ship it @bobby', people)
    const assigned = parseQuickCapture('Ship it @bobby', { people }).assignees
    expect(mentioned.map((m) => m.id)).toEqual(assigned)
  })
})
