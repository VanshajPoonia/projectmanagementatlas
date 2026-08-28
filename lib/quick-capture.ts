// Quick capture: turn one line of typed text into a task, deterministically.
//
//     Prepare bid package tomorrow 3pm high priority @Bobby #Atlas
//
// THE RULE THAT SHAPES EVERYTHING HERE: never silently discard user text.
//
// A parser that quietly eats a word it half-recognised is worse than one that recognises
// nothing, because the user cannot tell which words survived. So every span this file consumes
// is returned in `matches` with its exact start/end offsets and the value it produced, and the
// title is literally the input with those spans cut out. The dialog renders the matches as
// removable chips over the original text, so "where did my words go" is always answerable by
// looking at the screen. `stripMatches()` exists so a test can assert that property directly
// rather than trusting it.
//
// No LLM. Prompt D is explicit that deterministic syntax must not invoke one, and it is right:
// a model that resolves "next Friday" correctly 97% of the time is unusable for scheduling,
// because the 3% is silent and the user has already moved on. Everything here is a regex over
// a closed vocabulary, and anything outside that vocabulary stays in the title untouched.
//
// Ambiguity is surfaced, never guessed away: `warnings` carries every case where the input
// could reasonably have meant something else, and the caller shows the ABSOLUTE date it chose
// so a wrong guess is visible before saving rather than discovered a week later.

import { todayInBusinessZone, addDays, dayOfWeek } from './recurrence'

export type CaptureField = 'date' | 'time' | 'priority' | 'assignee' | 'label' | 'recurrence'

export interface CaptureMatch {
  field: CaptureField
  /** The exact text consumed, verbatim from the input. */
  text: string
  start: number
  end: number
  /** What it resolved to: an ISO date, 'HH:MM', a priority number, a raw name. */
  value: string | number
  /** Human-readable interpretation, e.g. "Tuesday, 25 August 2026". Shown on the chip. */
  display?: string
}

export interface ParsedCapture {
  /** The input with every matched span removed. This is the task title, and nothing else. */
  title: string
  dueDate: string | null
  dueTime: string | null
  priority: number | null
  /** Raw @names, in order. Resolution against real people is the caller's job. */
  assignees: string[]
  /** Raw #labels, in order. */
  labels: string[]
  recurrence: { frequency: string; interval: number; weekdays: number[] | null } | null
  matches: CaptureMatch[]
  /** Ambiguity worth showing the user before they save. Never a reason to refuse. */
  warnings: string[]
}

const WEEKDAY_NAMES: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3, weds: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
}

const MONTH_NAMES: Record<string, number> = {
  jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4,
  may: 5, jun: 6, june: 6, jul: 7, july: 7, aug: 8, august: 8,
  sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11,
  dec: 12, december: 12,
}

// 1 = Highest .. 5 = Lowest, matching TASK_PRIORITIES in components/shell/commands.ts and the
// bare integer on `tasks`. Longest phrases first so "very high" is not eaten by "high".
const PRIORITY_WORDS: readonly { re: RegExp; value: number }[] = [
  { re: /\b(?:urgent|critical|highest priority|asap)\b/i, value: 1 },
  { re: /\b(?:high priority|important)\b/i, value: 2 },
  { re: /\b(?:normal|medium) priority\b/i, value: 3 },
  { re: /\blow priority\b/i, value: 4 },
  { re: /\blowest priority\b/i, value: 5 },
  { re: /\bp([1-5])\b/i, value: 0 },   // 0 = read the captured digit
  { re: /(?:^|\s)!([1-5])\b/, value: 0 },
]

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Cut every matched span out of the input and tidy the whitespace. */
export function stripMatches(input: string, matches: CaptureMatch[]): string {
  if (matches.length === 0) return input.trim()
  const sorted = [...matches].sort((a, b) => a.start - b.start)
  let out = ''
  let cursor = 0
  for (const m of sorted) {
    if (m.start < cursor) continue // overlapping match, already removed
    out += input.slice(cursor, m.start)
    cursor = m.end
  }
  out += input.slice(cursor)
  // Collapse the holes the removals left, without touching the words themselves.
  return out.replace(/\s+/g, ' ').replace(/\s+([,.;:])/g, '$1').trim()
}

/** The next date on or after `from` whose weekday is `target`. Never returns `from` itself. */
function nextWeekday(from: string, target: number): string {
  const current = dayOfWeek(from)
  const delta = ((target - current + 7) % 7) || 7
  return addDays(from, delta)
}

function formatLong(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC',
  })
}

// ---------------------------------------------------------------------------------------
// Date phrases, longest first. Order matters: "next friday" must be tried before "friday",
// or the leading "next" is orphaned into the title and the date is a week early.
// ---------------------------------------------------------------------------------------
interface DateRule {
  re: RegExp
  resolve: (m: RegExpExecArray, today: string) => { date: string | null; warn?: string }
}

const DATE_RULES: readonly DateRule[] = [
  { re: /\btoday\b/i,     resolve: (_m, today) => ({ date: today }) },
  { re: /\btomorrow\b/i,  resolve: (_m, today) => ({ date: addDays(today, 1) }) },
  { re: /\byesterday\b/i, resolve: (_m, today) => ({ date: addDays(today, -1), warn: 'Due date is in the past.' }) },

  // "end of week" is Friday here. That is a choice, not a fact, so it is stated on the chip.
  { re: /\b(?:eow|end of (?:the )?week)\b/i, resolve: (_m, today) => ({ date: nextWeekday(addDays(today, -1), 5) }) },
  { re: /\b(?:eom|end of (?:the )?month)\b/i, resolve: (_m, today) => {
      const [y, mo] = today.split('-').map(Number)
      return { date: `${y}-${pad(mo)}-${pad(new Date(Date.UTC(y, mo, 0)).getUTCDate())}` }
    } },

  { re: /\bin (\d{1,3}) (day|week|month|year)s?\b/i, resolve: (m, today) => {
      const n = Number(m[1])
      const unit = m[2].toLowerCase()
      if (unit === 'day') return { date: addDays(today, n) }
      if (unit === 'week') return { date: addDays(today, n * 7) }
      const [y, mo, d] = today.split('-').map(Number)
      const months = unit === 'month' ? n : n * 12
      const total = y * 12 + (mo - 1) + months
      const ny = Math.floor(total / 12)
      const nm = (total % 12) + 1
      const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
      return { date: `${ny}-${pad(nm)}-${pad(Math.min(d, last))}` }
    } },

  // "next friday" means the Friday of the FOLLOWING week, always a week later than a bare
  // "friday". Defined as "the target weekday inside next calendar week" rather than as
  // "nextWeekday plus seven", because the two differ whenever today is already that weekday
  // and only the calendar-week reading stays consistent across the whole week.
  { re: /\bnext (sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i,
    resolve: (m, today) => {
      const nextWeekStart = addDays(today, 7 - dayOfWeek(today))
      return { date: addDays(nextWeekStart, WEEKDAY_NAMES[m[1].toLowerCase()]) }
    } },

  { re: /\bnext (week|month|year)\b/i, resolve: (m, today) => {
      const unit = m[1].toLowerCase()
      if (unit === 'week') return { date: addDays(today, 7) }
      const [y, mo, d] = today.split('-').map(Number)
      const total = y * 12 + (mo - 1) + (unit === 'month' ? 1 : 12)
      const ny = Math.floor(total / 12)
      const nm = (total % 12) + 1
      const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate()
      return { date: `${ny}-${pad(nm)}-${pad(Math.min(d, last))}` }
    } },

  { re: /\b(?:on |this )?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i,
    resolve: (m, today) => ({ date: nextWeekday(today, WEEKDAY_NAMES[m[1].toLowerCase()]) }) },

  // ISO first: unambiguous in every locale, so it never earns a warning.
  { re: /\b(\d{4})-(\d{2})-(\d{2})\b/, resolve: (m) => {
      const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
      if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) {
        return { date: null, warn: `"${m[0]}" is not a real date, so it was left in the title.` }
      }
      return { date: `${m[1]}-${m[2]}-${m[3]}` }
    } },

  // "24 Aug" / "Aug 24" / "24 August 2027". A named month cannot be confused for a day.
  { re: /\b(\d{1,2}) (jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?(?: (\d{4}))?\b/i,
    resolve: (m, today) => monthDay(Number(m[1]), MONTH_NAMES[m[2].toLowerCase()], m[3], today) },
  { re: /\b(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.? (\d{1,2})(?:st|nd|rd|th)?(?:,? (\d{4}))?\b/i,
    resolve: (m, today) => monthDay(Number(m[2]), MONTH_NAMES[m[1].toLowerCase()], m[3], today) },

  // Numeric slash dates are genuinely ambiguous between locales and ALWAYS warn. Read
  // day-first, matching the en-GB formatting this app already uses on task cards.
  { re: /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/, resolve: (m, today) => {
      const a = Number(m[1])
      const b = Number(m[2])
      let year = m[3] ? Number(m[3]) : Number(today.slice(0, 4))
      if (year < 100) year += 2000
      const result = monthDay(a, b, String(year), today)
      if (!result.date) {
        // Day-first failed, so it can only have been month-first. Say so rather than dropping it.
        const swapped = monthDay(b, a, String(year), today)
        if (swapped.date) {
          return { date: swapped.date, warn: `Read "${m[0]}" as ${formatLong(swapped.date)} - day-first would not be a real date.` }
        }
        return { date: null, warn: `"${m[0]}" is not a real date, so it was left in the title.` }
      }
      return {
        date: result.date,
        warn: a <= 12 && b <= 12
          ? `"${m[0]}" could be day/month or month/day. Read as ${formatLong(result.date)}.`
          : undefined,
      }
    } },
]

function monthDay(day: number, month: number, yearRaw: string | undefined, today: string): { date: string | null } {
  if (!month || month < 1 || month > 12) return { date: null }
  let year = yearRaw ? Number(yearRaw) : Number(today.slice(0, 4))
  if (day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return { date: null }
  let iso = `${year}-${pad(month)}-${pad(day)}`
  // A bare "5 March" typed in December means next March, not one that has already gone.
  if (!yearRaw && iso < today) {
    year += 1
    iso = `${year}-${pad(month)}-${pad(day)}`
  }
  return { date: iso }
}

// "3pm", "3:30pm", "15:00", "at 9". A bare "at 9" is read as 9am and warns, because 9pm is an
// equally reasonable reading and the user should see which one was chosen.
const TIME_RULES: readonly { re: RegExp; resolve: (m: RegExpExecArray) => { time: string | null; warn?: string } }[] = [
  { re: /\b(?:at )?(\d{1,2}):(\d{2})\s*(am|pm)\b/i, resolve: (m) => {
      let h = Number(m[1]) % 12
      if (m[3].toLowerCase() === 'pm') h += 12
      const min = Number(m[2])
      if (Number(m[1]) < 1 || Number(m[1]) > 12 || min > 59) return { time: null }
      return { time: `${pad(h)}:${pad(min)}` }
    } },
  { re: /\b(?:at )?(\d{1,2})\s*(am|pm)\b/i, resolve: (m) => {
      let h = Number(m[1]) % 12
      if (m[2].toLowerCase() === 'pm') h += 12
      if (Number(m[1]) < 1 || Number(m[1]) > 12) return { time: null }
      return { time: `${pad(h)}:00` }
    } },
  { re: /\b(?:at )(\d{1,2}):(\d{2})\b/, resolve: (m) => {
      const h = Number(m[1])
      const min = Number(m[2])
      if (h > 23 || min > 59) return { time: null }
      return { time: `${pad(h)}:${pad(min)}` }
    } },
  { re: /\b(\d{1,2}):(\d{2})\b/, resolve: (m) => {
      const h = Number(m[1])
      const min = Number(m[2])
      if (h > 23 || min > 59) return { time: null }
      return { time: `${pad(h)}:${pad(min)}` }
    } },
  { re: /\bat (\d{1,2})\b/i, resolve: (m) => {
      const h = Number(m[1])
      if (h > 23) return { time: null }
      if (h >= 1 && h <= 11) {
        return { time: `${pad(h)}:00`, warn: `Read "at ${h}" as ${pad(h)}:00. Type "${h}pm" if you meant the afternoon.` }
      }
      return { time: `${pad(h)}:00` }
    } },
]

// "every monday", "every 2 weeks", "daily", "weekly". Deliberately narrow: only phrases whose
// meaning is not in question, since a wrong recurrence generates work indefinitely.
const RECURRENCE_RULES: readonly { re: RegExp; resolve: (m: RegExpExecArray) => ParsedCapture['recurrence'] }[] = [
  { re: /\bevery (sunday|sun|monday|mon|tuesday|tues|tue|wednesday|weds|wed|thursday|thurs|thur|thu|friday|fri|saturday|sat)\b/i,
    resolve: (m) => ({ frequency: 'weekly', interval: 1, weekdays: [WEEKDAY_NAMES[m[1].toLowerCase()]] }) },
  { re: /\bevery (\d{1,3}) (day|week|month|year)s?\b/i,
    resolve: (m) => ({ frequency: `${m[2].toLowerCase()}ly`.replace('dayly', 'daily').replace('yearly', 'yearly'), interval: Number(m[1]), weekdays: null }) },
  { re: /\bevery (day|week|month|year)\b/i,
    resolve: (m) => ({ frequency: `${m[1].toLowerCase()}ly`.replace('dayly', 'daily'), interval: 1, weekdays: null }) },
  { re: /\b(daily|weekly|monthly|yearly|annually)\b/i,
    resolve: (m) => ({ frequency: m[1].toLowerCase() === 'annually' ? 'yearly' : m[1].toLowerCase(), interval: 1, weekdays: null }) },
]

export interface ParseOptions {
  /** Business-zone today, so the harness and the tests can pin "tomorrow". */
  today?: string
  /** Known people, for resolving @tokens. Unresolved tokens stay in the title and warn. */
  people?: { id: string; name: string }[]
  /** Known tags, same contract as `people`. */
  labels?: { id: string; name: string }[]
}

/** Does [aStart,aEnd) overlap any span already claimed? */
function overlaps(claimed: CaptureMatch[], start: number, end: number): boolean {
  return claimed.some((m) => start < m.end && end > m.start)
}

/**
 * Parse one line into task fields.
 *
 * Never throws and never refuses: the worst case is that nothing matches and the whole input
 * becomes the title, which is exactly what a user typing prose should get.
 */
export function parseQuickCapture(input: string, options: ParseOptions = {}): ParsedCapture {
  const today = options.today ?? todayInBusinessZone()
  const matches: CaptureMatch[] = []
  const warnings: string[] = []

  const claim = (field: CaptureField, start: number, end: number, value: string | number, display?: string) => {
    if (overlaps(matches, start, end)) return false
    matches.push({ field, text: input.slice(start, end), start, end, value, display })
    return true
  }

  // --- sigils first. @ and # are unambiguous, so they can never be stolen by a later rule.
  const assignees: string[] = []
  const labels: string[] = []

  for (const m of input.matchAll(/@([\p{L}\p{N}][\p{L}\p{N}_.'-]*)/gu)) {
    const raw = m[1]
    const start = m.index!
    const end = start + m[0].length
    if (options.people) {
      const hit = matchPerson(raw, options.people)
      if (!hit) {
        // Leave it in the title rather than deleting a word we did not understand.
        warnings.push(`No one here matches "@${raw}", so it was left in the title.`)
        continue
      }
      if (hit.ambiguous) {
        warnings.push(`"@${raw}" matches more than one person. Pick the right one below.`)
      }
      if (claim('assignee', start, end, hit.person.id, hit.person.name)) assignees.push(hit.person.id)
      continue
    }
    if (claim('assignee', start, end, raw, raw)) assignees.push(raw)
  }

  for (const m of input.matchAll(/#([\p{L}\p{N}][\p{L}\p{N}_-]*)/gu)) {
    const raw = m[1]
    const start = m.index!
    const end = start + m[0].length
    if (options.labels) {
      const hit = options.labels.find((l) => l.name.toLowerCase() === raw.toLowerCase())
        ?? options.labels.find((l) => l.name.toLowerCase().replace(/\s+/g, '') === raw.toLowerCase())
      if (!hit) {
        warnings.push(`No label called "#${raw}", so it was left in the title.`)
        continue
      }
      if (claim('label', start, end, hit.id, hit.name)) labels.push(hit.id)
      continue
    }
    if (claim('label', start, end, raw, raw)) labels.push(raw)
  }

  // --- priority
  let priority: number | null = null
  for (const rule of PRIORITY_WORDS) {
    const m = rule.re.exec(input)
    if (!m) continue
    const value = rule.value === 0 ? Number(m[1]) : rule.value
    // "!2" and " !2" both match; anchor to the sigil so the leading space stays in the title.
    const offset = m[0].startsWith(' ') ? 1 : 0
    const start = m.index + offset
    const end = m.index + m[0].length
    if (claim('priority', start, end, value, PRIORITY_LABELS[value])) {
      priority = value
      break
    }
  }

  // --- recurrence before date, so "every monday" is not eaten by the bare "monday" rule.
  let recurrence: ParsedCapture['recurrence'] = null
  for (const rule of RECURRENCE_RULES) {
    const m = rule.re.exec(input)
    if (!m) continue
    const parsed = rule.resolve(m)
    if (!parsed) continue
    if (claim('recurrence', m.index, m.index + m[0].length, parsed.frequency, describeParsedRecurrence(parsed))) {
      recurrence = parsed
      break
    }
  }

  // --- date
  let dueDate: string | null = null
  for (const rule of DATE_RULES) {
    const m = rule.re.exec(input)
    if (!m) continue
    if (overlaps(matches, m.index, m.index + m[0].length)) continue
    const { date, warn } = rule.resolve(m, today)
    if (warn) warnings.push(warn)
    if (!date) continue
    if (claim('date', m.index, m.index + m[0].length, date, formatLong(date))) {
      dueDate = date
      break
    }
  }

  // --- time
  let dueTime: string | null = null
  for (const rule of TIME_RULES) {
    const m = rule.re.exec(input)
    if (!m) continue
    if (overlaps(matches, m.index, m.index + m[0].length)) continue
    const { time, warn } = rule.resolve(m)
    if (!time) continue
    if (claim('time', m.index, m.index + m[0].length, time, formatTime(time))) {
      dueTime = time
      if (warn) warnings.push(warn)
      break
    }
  }

  if (dueTime && !dueDate) {
    warnings.push(`A time with no date was read as today at ${formatTime(dueTime)}.`)
    dueDate = today
  }

  const title = stripMatches(input, matches)
  if (!title && matches.length > 0) {
    warnings.push('Every word was read as a field, so this task has no title yet.')
  }

  return { title, dueDate, dueTime, priority, assignees, labels, recurrence, matches, warnings }
}

export const PRIORITY_LABELS: Record<number, string> = {
  1: 'Highest', 2: 'High', 3: 'Medium', 4: 'Low', 5: 'Lowest',
}

function formatTime(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const suffix = h < 12 ? 'am' : 'pm'
  const display = h % 12 === 0 ? 12 : h % 12
  return m === 0 ? `${display}${suffix}` : `${display}:${pad(m)}${suffix}`
}

function describeParsedRecurrence(r: NonNullable<ParsedCapture['recurrence']>): string {
  const unit = r.frequency === 'daily' ? 'day' : r.frequency.replace(/ly$/, '')
  if (r.weekdays?.length) {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    return `every ${names[r.weekdays[0]]}`
  }
  return r.interval === 1 ? `every ${unit}` : `every ${r.interval} ${unit}s`
}

/**
 * Resolve an @token against real people.
 *
 * Exact full name wins, then a unique first-name or prefix hit. Anything matching two people is
 * reported as ambiguous rather than resolved to whoever sorts first - assigning work to the
 * wrong person silently is the single worst outcome this parser could produce.
 */
function matchPerson(
  raw: string,
  people: { id: string; name: string }[],
): { person: { id: string; name: string }; ambiguous: boolean } | null {
  const needle = raw.toLowerCase().replace(/[._-]/g, ' ').trim()
  if (!needle) return null

  const exact = people.filter((p) => p.name.toLowerCase() === needle)
  if (exact.length === 1) return { person: exact[0], ambiguous: false }
  if (exact.length > 1) return { person: exact[0], ambiguous: true }

  const collapsed = people.filter((p) => p.name.toLowerCase().replace(/\s+/g, '') === needle.replace(/\s+/g, ''))
  if (collapsed.length === 1) return { person: collapsed[0], ambiguous: false }

  const firstName = people.filter((p) => p.name.toLowerCase().split(/\s+/)[0] === needle)
  if (firstName.length === 1) return { person: firstName[0], ambiguous: false }
  if (firstName.length > 1) return { person: firstName[0], ambiguous: true }

  const prefix = people.filter((p) => p.name.toLowerCase().startsWith(needle))
  if (prefix.length === 1) return { person: prefix[0], ambiguous: false }
  if (prefix.length > 1) return { person: prefix[0], ambiguous: true }

  return null
}

/** One resolved `@name` inside a piece of free text. */
export interface Mention {
  /** The profile id. */
  id: string
  name: string
  /** The token as typed, without the `@`. */
  token: string
  /** True when the token matched more than one person - see below. */
  ambiguous: boolean
}

/**
 * Every `@name` in free text that resolves to a real person.
 *
 * Shares `matchPerson` with quick capture on purpose: a workspace where "@bobby" assigns work
 * to one person and mentions another would be worse than having no mentions at all, and two
 * resolvers is two chances for that to happen.
 *
 * Ambiguous hits are RETURNED AND FLAGGED rather than dropped or silently resolved. A caller
 * notifying people should skip them - telling the wrong person they were addressed is a small
 * harm, but it is one they cannot detect - while a caller rendering the comment can use the
 * flag to say why the mention did not go anywhere. Deduplicated by person, so "@ann @ann"
 * notifies Ann once.
 */
export function findMentions(text: string, people: { id: string; name: string }[]): Mention[] {
  const seen = new Set<string>()
  const found: Mention[] = []

  for (const m of String(text ?? '').matchAll(/@([\p{L}\p{N}][\p{L}\p{N}_.'-]*)/gu)) {
    const token = m[1]
    const hit = matchPerson(token, people ?? [])
    if (!hit) continue
    if (seen.has(hit.person.id)) continue
    seen.add(hit.person.id)
    found.push({ id: hit.person.id, name: hit.person.name, token, ambiguous: hit.ambiguous })
  }

  return found
}

/** The due_date value to write: a timestamp when a time was given, midnight otherwise. */
export function captureDueTimestamp(parsed: ParsedCapture): string | null {
  if (!parsed.dueDate) return null
  return parsed.dueTime ? `${parsed.dueDate}T${parsed.dueTime}:00` : parsed.dueDate
}
