import { describe, expect, it } from 'vitest'
import {
  activeStatuses,
  agingAlerts,
  clientDisplayName,
  cycleTime,
  dashboardSummary,
  formatDuration,
  formatMoney,
  intervalDuration,
  isPastSla,
  isPastTargetClose,
  leadsBySource,
  openInterval,
  orderAgeDays,
  pipelineCounts,
  primaryContact,
  timeInStatus,
  type CrmClient,
  type CrmOrder,
  type CrmStatus,
  type CrmStatusInterval,
} from './crm'

const NOW = new Date('2026-08-14T12:00:00Z')
const at = (iso: string) => new Date(iso).toISOString()

const statuses: CrmStatus[] = [
  { key: 'new', label: 'New', position: 1, color: '#3b82f6', is_terminal: false, is_won: false, requires_reason: false, sla_hours: 24 },
  { key: 'in_progress', label: 'In Progress', position: 2, color: '#10b981', is_terminal: false, is_won: false, requires_reason: false, sla_hours: 72 },
  { key: 'hold', label: 'Hold', position: 3, color: '#ef4444', is_terminal: false, is_won: false, requires_reason: false, sla_hours: null },
  { key: 'won', label: 'Won', position: 4, color: '#16a34a', is_terminal: true, is_won: true, requires_reason: false, sla_hours: null },
  { key: 'cancel', label: 'Cancel', position: 5, color: '#dc2626', is_terminal: true, is_won: false, requires_reason: true, sla_hours: null },
]

function order(over: Partial<CrmOrder> = {}): CrmOrder {
  return {
    id: 'o1', order_no: 'ORD-1', client_id: 'c1', order_type: 'standard',
    status: 'new', owner_id: 'u1', priority: 'normal', estimated_value: 1000,
    target_close_date: null, opened_at: at('2026-08-14T00:00:00Z'), closed_at: null,
    ...over,
  }
}

function interval(over: Partial<CrmStatusInterval> = {}): CrmStatusInterval {
  return {
    id: crypto.randomUUID(), order_id: 'o1', status: 'new',
    entered_at: at('2026-08-14T00:00:00Z'), exited_at: null, ...over,
  }
}

describe('formatDuration', () => {
  it('matches the status-history column format', () => {
    expect(formatDuration(48 * 60_000)).toBe('48 min')
    expect(formatDuration(3 * 3_600_000 + 20 * 60_000)).toBe('3 hr 20 min')
    expect(formatDuration(2 * 3_600_000)).toBe('2 hr')
    expect(formatDuration(1.9 * 86_400_000)).toBe('1.9 days')
  })

  it('renders nonsense as a dash rather than NaN', () => {
    expect(formatDuration(Number.NaN)).toBe('-')
    expect(formatDuration(-5)).toBe('-')
  })
})

describe('intervalDuration', () => {
  it('measures an open interval to now instead of treating it as zero', () => {
    const open = interval({ entered_at: at('2026-08-14T09:00:00Z'), exited_at: null })
    expect(intervalDuration(open, NOW)).toBe(3 * 3_600_000)
  })

  it('measures a closed interval between its own stamps', () => {
    const closed = interval({
      entered_at: at('2026-08-14T09:00:00Z'),
      exited_at: at('2026-08-14T10:30:00Z'),
    })
    expect(intervalDuration(closed, NOW)).toBe(90 * 60_000)
  })
})

describe('cycleTime', () => {
  const history: CrmStatusInterval[] = [
    // o1: new -> won over 5 days
    interval({ order_id: 'o1', status: 'new', entered_at: at('2026-08-01T00:00:00Z'), exited_at: at('2026-08-03T00:00:00Z') }),
    interval({ order_id: 'o1', status: 'in_progress', entered_at: at('2026-08-03T00:00:00Z'), exited_at: at('2026-08-06T00:00:00Z') }),
    interval({ order_id: 'o1', status: 'won', entered_at: at('2026-08-06T00:00:00Z'), exited_at: null }),
    // o2: new -> won over 1 day
    interval({ order_id: 'o2', status: 'new', entered_at: at('2026-08-01T00:00:00Z'), exited_at: at('2026-08-02T00:00:00Z') }),
    interval({ order_id: 'o2', status: 'won', entered_at: at('2026-08-02T00:00:00Z'), exited_at: null }),
    // o3: still in flight, never reached won
    interval({ order_id: 'o3', status: 'new', entered_at: at('2026-08-01T00:00:00Z'), exited_at: null }),
  ]

  it('averages only the orders that completed the journey', () => {
    const r = cycleTime(history, 'new', 'won')
    expect(r.durations).toHaveLength(2)
    expect(r.averageMs).toBe(3 * 86_400_000)
    expect(r.fastestMs).toBe(1 * 86_400_000)
    expect(r.slowestMs).toBe(5 * 86_400_000)
  })

  it('counts in-flight orders separately instead of biasing the average down', () => {
    expect(cycleTime(history, 'new', 'won').incomplete).toBe(1)
  })

  it('takes the median of an even sample as the midpoint of the two middle values', () => {
    expect(cycleTime(history, 'new', 'won').medianMs).toBe(3 * 86_400_000)
  })

  it('measures first-entry to first-arrival across a bounce-back', () => {
    // New -> In Progress -> New again -> Won. The real journey is the full 10 days.
    const bounced: CrmStatusInterval[] = [
      interval({ order_id: 'b1', status: 'new', entered_at: at('2026-08-01T00:00:00Z'), exited_at: at('2026-08-02T00:00:00Z') }),
      interval({ order_id: 'b1', status: 'in_progress', entered_at: at('2026-08-02T00:00:00Z'), exited_at: at('2026-08-09T00:00:00Z') }),
      interval({ order_id: 'b1', status: 'new', entered_at: at('2026-08-09T00:00:00Z'), exited_at: at('2026-08-11T00:00:00Z') }),
      interval({ order_id: 'b1', status: 'won', entered_at: at('2026-08-11T00:00:00Z'), exited_at: null }),
    ]
    expect(cycleTime(bounced, 'new', 'won').averageMs).toBe(10 * 86_400_000)
  })

  it('returns zeros rather than NaN when nothing matches', () => {
    const r = cycleTime(history, 'hold', 'won')
    expect(r.durations).toHaveLength(0)
    expect(r.averageMs).toBe(0)
    expect(r.medianMs).toBe(0)
  })
})

describe('timeInStatus', () => {
  it('totals every visit to a status, open ones included', () => {
    const rows: CrmStatusInterval[] = [
      interval({ order_id: 'a', status: 'hold', entered_at: at('2026-08-13T12:00:00Z'), exited_at: at('2026-08-14T00:00:00Z') }),
      interval({ order_id: 'b', status: 'hold', entered_at: at('2026-08-14T06:00:00Z'), exited_at: null }),
    ]
    const t = timeInStatus(rows, NOW)
    expect(t.get('hold')?.entries).toBe(2)
    expect(t.get('hold')?.totalMs).toBe(12 * 3_600_000 + 6 * 3_600_000)
  })
})

describe('isPastSla', () => {
  it('flags an order sitting past its status target', () => {
    const h = [interval({ order_id: 'o1', status: 'new', entered_at: at('2026-08-13T00:00:00Z') })]
    expect(isPastSla(order(), statuses[0], h, NOW)).toBe(true)
  })

  it('does not flag one still inside the window', () => {
    const h = [interval({ order_id: 'o1', status: 'new', entered_at: at('2026-08-14T06:00:00Z') })]
    expect(isPastSla(order(), statuses[0], h, NOW)).toBe(false)
  })

  it('never flags Hold, which has no target by design', () => {
    const h = [interval({ order_id: 'o1', status: 'hold', entered_at: at('2026-01-01T00:00:00Z') })]
    expect(isPastSla(order({ status: 'hold' }), statuses[2], h, NOW)).toBe(false)
  })

  it('never flags a terminal status however long ago it was reached', () => {
    const h = [interval({ order_id: 'o1', status: 'won', entered_at: at('2020-01-01T00:00:00Z') })]
    expect(isPastSla(order({ status: 'won' }), statuses[3], h, NOW)).toBe(false)
  })
})

describe('isPastTargetClose', () => {
  it('is true for an open order past its date', () => {
    expect(isPastTargetClose(order({ target_close_date: '2026-08-12' }), NOW)).toBe(true)
  })
  it('gives the whole target day before flagging', () => {
    expect(isPastTargetClose(order({ target_close_date: '2026-08-14' }), NOW)).toBe(false)
  })
  it('is false once closed, however late it was', () => {
    expect(isPastTargetClose(order({ target_close_date: '2026-01-01', closed_at: at('2026-08-01T00:00:00Z') }), NOW)).toBe(false)
  })

  // The regression this replaced: the old implementation did Date.parse(`${date}T23:59:59`),
  // which carries no zone designator and so resolved against the *runtime's* timezone - UTC on
  // the server, America/Chicago in the browser, five hours apart. For a five-hour window each
  // day the two disagreed on the same order at the same instant, which is a hydration mismatch.
  // These instants sit inside that window: 03:00Z on the 15th is still the 14th in Chicago.
  it('answers identically whatever timezone the runtime is in', () => {
    const straddling = new Date('2026-08-15T03:00:00Z')
    const target = order({ target_close_date: '2026-08-14' })
    const original = process.env.TZ

    const answers = ['UTC', 'America/Chicago', 'Asia/Kolkata', 'Pacific/Auckland'].map(tz => {
      process.env.TZ = tz
      return isPastTargetClose(target, straddling)
    })
    process.env.TZ = original

    expect(new Set(answers).size).toBe(1)
    // ...and the single answer is the business timezone's, where it is still the 14th.
    expect(answers[0]).toBe(false)
  })

  it('flags the order once the business day has actually rolled over', () => {
    expect(isPastTargetClose(order({ target_close_date: '2026-08-14' }), new Date('2026-08-15T06:00:00Z'))).toBe(true)
  })
})

describe('activeStatuses', () => {
  const list: CrmStatus[] = [
    { key: 'b', label: 'B', position: 2, color: '#000', is_terminal: false, is_won: false, requires_reason: false, sla_hours: null },
    { key: 'a', label: 'A', position: 1, color: '#000', is_terminal: false, is_won: false, requires_reason: false, sla_hours: null },
    { key: 'old', label: 'Retired', position: 3, color: '#000', is_terminal: false, is_won: false, requires_reason: false, sla_hours: null, is_archived: true },
  ]

  it('drops archived statuses and orders the rest by position', () => {
    expect(activeStatuses(list).map(s => s.key)).toEqual(['a', 'b'])
  })

  it('keeps an archived status when it is the record\'s current value', () => {
    // Otherwise a Select bound to that value renders blank and the next save silently
    // rewrites a status the user never touched.
    expect(activeStatuses(list, 'old').map(s => s.key)).toEqual(['a', 'b', 'old'])
  })

  it('does not duplicate a current status that is still active', () => {
    expect(activeStatuses(list, 'a').map(s => s.key)).toEqual(['a', 'b'])
  })

  it('ignores a current status that no longer exists at all', () => {
    expect(activeStatuses(list, 'ghost').map(s => s.key)).toEqual(['a', 'b'])
  })
})

// The bug that made activeStatuses necessary: the pages filtered archived statuses out of the
// QUERY, so an order sitting in one had no entry in the lookup map - and every consumer reads a
// missing status as "not terminal". Archiving Won would have counted every won order as live
// pipeline. These pin the behaviour once the full list is passed, as it now is.
describe('archived statuses stay classified correctly', () => {
  const archivedWon: CrmStatus = {
    key: 'won', label: 'Won', position: 6, color: '#16a34a',
    is_terminal: true, is_won: true, requires_reason: false, sla_hours: null, is_archived: true,
  }

  it('does not count a won order as open pipeline just because its status was retired', () => {
    const orders = [order({ id: 'o1', status: 'won', estimated_value: 50_000 })]
    const summary = dashboardSummary(orders, [archivedWon], [], NOW)
    expect(summary.openOrders).toBe(0)
    expect(summary.pipelineValue).toBe(0)
    expect(summary.wonValue).toBe(50_000)
  })

  it('raises no aging alert for an order in a retired terminal status', () => {
    const orders = [order({ id: 'o1', status: 'won', target_close_date: '2020-01-01' })]
    expect(agingAlerts(orders, [archivedWon], [], NOW)).toEqual([])
  })
})

describe('orderAgeDays', () => {
  it('freezes at closure so a closed order stops ageing', () => {
    const o = order({ opened_at: at('2026-08-01T00:00:00Z'), closed_at: at('2026-08-06T00:00:00Z') })
    expect(orderAgeDays(o, NOW)).toBe(5)
    expect(orderAgeDays(o, new Date('2027-01-01T00:00:00Z'))).toBe(5)
  })
})

describe('dashboardSummary', () => {
  const orders = [
    order({ id: 'a', status: 'new', estimated_value: 1000, opened_at: at('2026-08-13T00:00:00Z') }),
    order({ id: 'b', status: 'won', estimated_value: 5000, opened_at: at('2026-08-01T00:00:00Z'), closed_at: at('2026-08-05T00:00:00Z') }),
    order({ id: 'c', status: 'in_progress', estimated_value: 2000, opened_at: at('2026-06-01T00:00:00Z') }),
  ]
  const history = [interval({ order_id: 'a', status: 'new', entered_at: at('2026-08-13T00:00:00Z') })]

  it('counts only non-terminal orders as open', () => {
    expect(dashboardSummary(orders, statuses, history, NOW).openOrders).toBe(2)
  })

  it('excludes won value from pipeline value', () => {
    const s = dashboardSummary(orders, statuses, history, NOW)
    expect(s.pipelineValue).toBe(3000)
    expect(s.wonValue).toBe(5000)
  })

  it('averages days to close over closed orders only', () => {
    expect(dashboardSummary(orders, statuses, history, NOW).avgDaysToClose).toBe(4)
  })

  it('reports null rather than zero when nothing has closed yet', () => {
    const open = [order({ id: 'x', status: 'new' })]
    expect(dashboardSummary(open, statuses, [], NOW).avgDaysToClose).toBeNull()
  })

  it('counts new-this-week on a rolling seven days', () => {
    expect(dashboardSummary(orders, statuses, history, NOW).newThisWeek).toBe(1)
  })
})

describe('agingAlerts', () => {
  it('raises at most one alert per order', () => {
    const o = order({ id: 'a', owner_id: null, status: 'new', target_close_date: '2026-08-01', opened_at: at('2026-08-01T00:00:00Z') })
    const h = [interval({ order_id: 'a', status: 'new', entered_at: at('2026-08-01T00:00:00Z') })]
    const alerts = agingAlerts([o], statuses, h, NOW)
    expect(alerts).toHaveLength(1)
    expect(alerts[0].kind).toBe('sla')
  })

  it('ignores closed orders entirely', () => {
    const o = order({ status: 'won', closed_at: at('2026-08-05T00:00:00Z'), target_close_date: '2026-01-01' })
    expect(agingAlerts([o], statuses, [], NOW)).toHaveLength(0)
  })

  it('flags an unassigned order only after a full day', () => {
    const fresh = order({ id: 'f', owner_id: null, status: 'hold', opened_at: at('2026-08-14T06:00:00Z') })
    expect(agingAlerts([fresh], statuses, [], NOW)).toHaveLength(0)
    const stale = order({ id: 's', owner_id: null, status: 'hold', opened_at: at('2026-08-12T06:00:00Z') })
    expect(agingAlerts([stale], statuses, [], NOW)[0].kind).toBe('unassigned')
  })
})

describe('pipelineCounts', () => {
  it('includes statuses with no orders so the pipeline has no gaps', () => {
    const counts = pipelineCounts([order({ status: 'new' })], statuses)
    expect(counts).toHaveLength(5)
    expect(counts.find(c => c.status.key === 'won')?.count).toBe(0)
  })

  it('orders by the configured position', () => {
    expect(pipelineCounts([], statuses).map(c => c.status.key))
      .toEqual(['new', 'in_progress', 'hold', 'won', 'cancel'])
  })
})

describe('clientDisplayName', () => {
  const base: CrmClient = {
    id: 'c1', client_ref: 'C-10482', company_name: 'Martin Holdings', client_type: 'business',
    status: 'new', estimated_value: 0, last_activity_at: at('2026-08-14T00:00:00Z'),
    created_at: at('2026-08-14T00:00:00Z'),
  }

  it('prefers the primary contact over the company', () => {
    expect(clientDisplayName({
      ...base,
      crm_contacts: [
        { id: '1', first_name: 'Ann', last_name: 'Other', position: 0 },
        { id: '2', first_name: 'Jennifer', last_name: 'Martin', is_primary: true, position: 1 },
      ],
    })).toBe('Jennifer Martin')
  })

  it('falls back to the company, then the reference', () => {
    expect(clientDisplayName({ ...base, crm_contacts: [] })).toBe('Martin Holdings')
    expect(clientDisplayName({ ...base, company_name: null, crm_contacts: [] })).toBe('C-10482')
  })

  it('never renders blank', () => {
    expect(clientDisplayName({ ...base, company_name: null, client_ref: null })).toBe('Untitled client')
  })
})

describe('primaryContact', () => {
  it('falls back to the lowest position when none is marked primary', () => {
    expect(primaryContact([
      { id: '2', first_name: 'B', last_name: 'B', position: 5 },
      { id: '1', first_name: 'A', last_name: 'A', position: 1 },
    ])?.first_name).toBe('A')
  })
  it('handles an empty list', () => {
    expect(primaryContact([])).toBeUndefined()
    expect(primaryContact(undefined)).toBeUndefined()
  })
})

describe('openInterval', () => {
  it('finds the one interval with no exit', () => {
    const rows = [
      interval({ order_id: 'o1', exited_at: at('2026-08-01T00:00:00Z') }),
      interval({ order_id: 'o1', status: 'hold', exited_at: null }),
    ]
    expect(openInterval(rows, 'o1')?.status).toBe('hold')
  })
})

describe('leadsBySource', () => {
  const c = (source: string | null): CrmClient => ({
    id: crypto.randomUUID(), client_ref: null, company_name: null, client_type: 'individual',
    status: 'new', estimated_value: 0, lead_source: source,
    last_activity_at: at('2026-08-14T00:00:00Z'), created_at: at('2026-08-14T00:00:00Z'),
  })

  it('reports growth from zero as null rather than a fake +100%', () => {
    const rows = leadsBySource([c('META'), c('META')], [])
    expect(rows[0]).toMatchObject({ source: 'META', current: 2, previous: 0, changePct: null })
  })

  it('computes a real percentage change when there is a baseline', () => {
    const rows = leadsBySource([c('Referral'), c('Referral')], [c('Referral')])
    expect(rows[0].changePct).toBe(100)
  })

  it('buckets missing sources rather than dropping them', () => {
    expect(leadsBySource([c(null)], [])[0].source).toBe('Unspecified')
  })
})

describe('formatMoney', () => {
  it('matches the tile formats', () => {
    expect(formatMoney(3_840_000)).toBe('$3.84M')
    expect(formatMoney(812_000)).toBe('$812K')
    expect(formatMoney(1250)).toBe('$1K')
    expect(formatMoney(250)).toBe('$250')
    expect(formatMoney(0)).toBe('$0')
  })
})
