// CRM domain logic.
//
// Everything here is pure: the reporting maths (cycle time, time-in-status, aging, SLA) has
// no Supabase client and no React in it, because those numbers are the entire reason the
// module exists and a number nobody can test is a number nobody should trust.
//
// The one non-obvious rule, which every function below obeys: an interval is measured from
// `entered_at` to `exited_at ?? now`. A status the order is still in has no exit yet, and
// treating that as zero (or skipping it) is what makes a bottleneck report quietly say the
// bottleneck is fine.

export interface CrmStatus {
  key: string
  label: string
  position: number
  color: string
  is_terminal: boolean
  is_won: boolean
  requires_reason: boolean
  sla_hours: number | null
  is_archived?: boolean
}

export interface CrmContact {
  id: string
  client_id?: string
  first_name: string
  last_name: string
  email?: string | null
  mobile_phone?: string | null
  is_primary?: boolean
  position?: number
}

export interface CrmClient {
  id: string
  client_ref: string | null
  company_name: string | null
  client_type: string
  city?: string | null
  state?: string | null
  lead_source?: string | null
  status: string
  sales_rep_id?: string | null
  operations_rep_id?: string | null
  estimated_value: number
  last_activity_at: string
  created_at: string
  crm_contacts?: CrmContact[]
}

export interface CrmOrder {
  id: string
  order_no: string | null
  client_id: string
  order_type: string
  status: string
  owner_id?: string | null
  priority: string
  estimated_value: number
  target_close_date?: string | null
  opened_at: string
  closed_at?: string | null
}

export interface CrmStatusInterval {
  id: string
  order_id: string
  status: string
  entered_at: string
  exited_at: string | null
  changed_by?: string | null
  reason?: string | null
  note?: string | null
}

export const CLIENT_TYPES = [
  { value: 'individual', label: 'Individual' },
  { value: 'business', label: 'Business' },
  { value: 'family_trust', label: 'Family / Trust' },
  { value: 'partner', label: 'Partner' },
] as const

export const LEAD_SOURCES = [
  'Referral',
  'Website',
  'Advertising',
  'Existing Client',
  'Other',
] as const

export const ORDER_PRIORITIES = [
  { value: 'low', label: 'Low' },
  { value: 'normal', label: 'Normal' },
  { value: 'high', label: 'High' },
  { value: 'urgent', label: 'Urgent' },
] as const

/** The "Reason / Disposition" list from the Status Control screen. */
export const STATUS_DISPOSITIONS = [
  'Work proceeding normally',
  'Waiting on customer',
  'Waiting on documentation',
  'Waiting on internal review',
] as const

const HOUR = 3_600_000
const DAY = 24 * HOUR

/* ── People and naming ─────────────────────────────────────────────────────────────── */

export function contactName(contact: Pick<CrmContact, 'first_name' | 'last_name'>): string {
  return `${contact.first_name ?? ''} ${contact.last_name ?? ''}`.trim()
}

/** The primary contact, or the first one, or nothing. */
export function primaryContact(contacts: readonly CrmContact[] | null | undefined): CrmContact | undefined {
  if (!contacts?.length) return undefined
  return (
    contacts.find(c => c.is_primary) ??
    [...contacts].sort((a, b) => (a.position ?? 0) - (b.position ?? 0))[0]
  )
}

/**
 * The subset needed to *name* a client. Screens that only render a label (the dashboard's
 * alert list, the order table) select these three columns and no more; requiring the full
 * CrmClient there would mean over-fetching a row just to satisfy a type.
 */
export type CrmClientSummary = Pick<CrmClient, 'id' | 'client_ref' | 'company_name'> & {
  crm_contacts?: CrmContact[]
}

/**
 * What to call this client in a list.
 *
 * The contact leads and the company qualifies, because a client record is reached by
 * remembering a person far more often than by remembering a trust's legal name. Falls back to
 * the company when there is no contact yet (an intake can be saved before contacts are added)
 * and finally to the reference, so a row is never blank.
 */
export function clientDisplayName(client: CrmClientSummary): string {
  const contact = primaryContact(client.crm_contacts)
  const person = contact ? contactName(contact) : ''
  if (person) return person
  if (client.company_name) return client.company_name
  return client.client_ref ?? 'Untitled client'
}

/* ── Durations ─────────────────────────────────────────────────────────────────────── */

function ms(from: string | Date, to: string | Date): number {
  const a = from instanceof Date ? from.getTime() : Date.parse(from)
  const b = to instanceof Date ? to.getTime() : Date.parse(to)
  if (Number.isNaN(a) || Number.isNaN(b)) return 0
  return Math.max(0, b - a)
}

/**
 * A duration in the compact form the tables use: "48 min", "3 hr 20 min", "1.9 days".
 * Matches the Status History column in the mockup rather than inventing a second format.
 */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—'
  if (milliseconds < HOUR) {
    const mins = Math.round(milliseconds / 60_000)
    return `${mins} min`
  }
  if (milliseconds < DAY) {
    const hours = Math.floor(milliseconds / HOUR)
    const mins = Math.round((milliseconds % HOUR) / 60_000)
    return mins ? `${hours} hr ${mins} min` : `${hours} hr`
  }
  return `${(milliseconds / DAY).toFixed(1)} days`
}

/** How long an interval lasted. An open interval is measured to `now`, never treated as zero. */
export function intervalDuration(interval: CrmStatusInterval, now: Date = new Date()): number {
  return ms(interval.entered_at, interval.exited_at ?? now)
}

/* ── Order age and SLA ─────────────────────────────────────────────────────────────── */

/** Days since the order opened; frozen at closure so a closed order stops ageing. */
export function orderAgeDays(order: CrmOrder, now: Date = new Date()): number {
  return ms(order.opened_at, order.closed_at ?? now) / DAY
}

/**
 * Whether an order has been in its current status longer than that status allows.
 *
 * Terminal statuses and statuses with no `sla_hours` never breach — "Hold" is a deliberate
 * parking state and flagging it as late every time would train people to ignore the panel.
 */
export function isPastSla(
  order: CrmOrder,
  status: CrmStatus | undefined,
  history: readonly CrmStatusInterval[],
  now: Date = new Date(),
): boolean {
  if (!status || status.is_terminal || !status.sla_hours) return false
  const open = openInterval(history, order.id)
  if (!open) return false
  return intervalDuration(open, now) > status.sla_hours * HOUR
}

/** Past its target close date and still open. */
export function isPastTargetClose(order: CrmOrder, now: Date = new Date()): boolean {
  if (order.closed_at || !order.target_close_date) return false
  const target = Date.parse(`${order.target_close_date}T23:59:59`)
  return !Number.isNaN(target) && now.getTime() > target
}

/** The interval an order is currently in, if any. */
export function openInterval(
  history: readonly CrmStatusInterval[],
  orderId: string,
): CrmStatusInterval | undefined {
  return history.find(h => h.order_id === orderId && h.exited_at === null)
}

/* ── Reporting ─────────────────────────────────────────────────────────────────────── */

export interface CycleTimeResult {
  /** One entry per order that completed the journey, in milliseconds. */
  durations: number[]
  averageMs: number
  medianMs: number
  fastestMs: number
  slowestMs: number
  /** Orders that entered `from` but have not yet reached `to`. */
  incomplete: number
}

/**
 * "How long does it take an order to move from status A to status B?"
 *
 * Measured per order from the FIRST time it entered `from` to the FIRST time it reached `to`
 * at or after that. First-to-first matters: an order that bounces New -> In Progress -> New
 * -> Closed took its whole calendar journey, and measuring from the last entry to New would
 * report a fraction of the real elapsed time and make the pipeline look faster than it is.
 *
 * An order that never reached `to` is counted in `incomplete` rather than folded into the
 * average, because including in-flight work as if it were finished biases every figure down.
 */
export function cycleTime(
  history: readonly CrmStatusInterval[],
  fromStatus: string,
  toStatus: string,
): CycleTimeResult {
  const byOrder = new Map<string, CrmStatusInterval[]>()
  for (const row of history) {
    const list = byOrder.get(row.order_id)
    if (list) list.push(row)
    else byOrder.set(row.order_id, [row])
  }

  const durations: number[] = []
  let incomplete = 0

  for (const rows of byOrder.values()) {
    const ordered = [...rows].sort((a, b) => Date.parse(a.entered_at) - Date.parse(b.entered_at))
    const start = ordered.find(r => r.status === fromStatus)
    if (!start) continue
    const startedAt = Date.parse(start.entered_at)
    const end = ordered.find(r => r.status === toStatus && Date.parse(r.entered_at) >= startedAt)
    if (!end) {
      incomplete++
      continue
    }
    durations.push(Math.max(0, Date.parse(end.entered_at) - startedAt))
  }

  if (!durations.length) {
    return { durations, averageMs: 0, medianMs: 0, fastestMs: 0, slowestMs: 0, incomplete }
  }

  const sorted = [...durations].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return {
    durations,
    averageMs: durations.reduce((a, b) => a + b, 0) / durations.length,
    medianMs: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    fastestMs: sorted[0],
    slowestMs: sorted[sorted.length - 1],
    incomplete,
  }
}

/**
 * Total time spent in each status across the given history, open intervals included.
 * This is the bottleneck view: the status with the largest total is where work is sitting.
 */
export function timeInStatus(
  history: readonly CrmStatusInterval[],
  now: Date = new Date(),
): Map<string, { totalMs: number; entries: number }> {
  const out = new Map<string, { totalMs: number; entries: number }>()
  for (const row of history) {
    const current = out.get(row.status) ?? { totalMs: 0, entries: 0 }
    current.totalMs += intervalDuration(row, now)
    current.entries += 1
    out.set(row.status, current)
  }
  return out
}

/** Order counts per status key, including statuses with zero so the pipeline never has gaps. */
export function pipelineCounts(
  orders: readonly CrmOrder[],
  statuses: readonly CrmStatus[],
): { status: CrmStatus; count: number }[] {
  const counts = new Map<string, number>()
  for (const order of orders) counts.set(order.status, (counts.get(order.status) ?? 0) + 1)
  return [...statuses]
    .filter(s => !s.is_archived)
    .sort((a, b) => a.position - b.position)
    .map(status => ({ status, count: counts.get(status.key) ?? 0 }))
}

export interface DashboardSummary {
  openOrders: number
  newThisWeek: number
  /** Mean days to close across orders that actually closed; null when none have. */
  avgDaysToClose: number | null
  pastSla: number
  wonValue: number
  pipelineValue: number
}

export function dashboardSummary(
  orders: readonly CrmOrder[],
  statuses: readonly CrmStatus[],
  history: readonly CrmStatusInterval[],
  now: Date = new Date(),
): DashboardSummary {
  const byKey = new Map(statuses.map(s => [s.key, s]))
  const weekAgo = now.getTime() - 7 * DAY

  let openOrders = 0
  let newThisWeek = 0
  let pastSla = 0
  let wonValue = 0
  let pipelineValue = 0
  const closedDurations: number[] = []

  for (const order of orders) {
    const status = byKey.get(order.status)
    const isOpen = !order.closed_at && !status?.is_terminal

    if (isOpen) {
      openOrders++
      pipelineValue += Number(order.estimated_value) || 0
      if (isPastSla(order, status, history, now)) pastSla++
    }
    if (status?.is_won) wonValue += Number(order.estimated_value) || 0
    if (Date.parse(order.opened_at) >= weekAgo) newThisWeek++
    if (order.closed_at) closedDurations.push(ms(order.opened_at, order.closed_at))
  }

  return {
    openOrders,
    newThisWeek,
    avgDaysToClose: closedDurations.length
      ? closedDurations.reduce((a, b) => a + b, 0) / closedDurations.length / DAY
      : null,
    pastSla,
    wonValue,
    pipelineValue,
  }
}

export interface AgingAlert {
  order: CrmOrder
  kind: 'sla' | 'target' | 'unassigned'
  detail: string
}

/**
 * The three things the aging panel calls out, in the order it calls them out. Deliberately
 * one alert per order at most: an order that is both late and unassigned is one problem to
 * go and fix, and listing it three times makes the panel look worse than the pipeline is.
 */
export function agingAlerts(
  orders: readonly CrmOrder[],
  statuses: readonly CrmStatus[],
  history: readonly CrmStatusInterval[],
  now: Date = new Date(),
): AgingAlert[] {
  const byKey = new Map(statuses.map(s => [s.key, s]))
  const alerts: AgingAlert[] = []

  for (const order of orders) {
    const status = byKey.get(order.status)
    if (order.closed_at || status?.is_terminal) continue

    if (isPastSla(order, status, history, now)) {
      const open = openInterval(history, order.id)
      alerts.push({
        order,
        kind: 'sla',
        detail: `${formatDuration(open ? intervalDuration(open, now) : 0)} in ${status?.label ?? order.status}`,
      })
      continue
    }
    if (isPastTargetClose(order, now)) {
      alerts.push({ order, kind: 'target', detail: `Target close was ${order.target_close_date}` })
      continue
    }
    if (!order.owner_id && ms(order.opened_at, now) > DAY) {
      alerts.push({
        order,
        kind: 'unassigned',
        detail: `Unassigned for ${formatDuration(ms(order.opened_at, now))}`,
      })
    }
  }

  return alerts
}

/** Lead counts by source, with the change against a previous window. */
export function leadsBySource(
  current: readonly CrmClient[],
  previous: readonly CrmClient[],
): { source: string; current: number; previous: number; changePct: number | null }[] {
  const tally = (rows: readonly CrmClient[]) => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const key = r.lead_source?.trim() || 'Unspecified'
      m.set(key, (m.get(key) ?? 0) + 1)
    }
    return m
  }
  const now = tally(current)
  const before = tally(previous)

  return [...new Set([...now.keys(), ...before.keys()])]
    .map(source => {
      const c = now.get(source) ?? 0
      const p = before.get(source) ?? 0
      return {
        source,
        current: c,
        previous: p,
        // Growth from zero is undefined, not "+100%" — the caller renders it as "new".
        changePct: p === 0 ? null : ((c - p) / p) * 100,
      }
    })
    .sort((a, b) => b.current - a.current)
}

/** Formats a money amount the way the tiles do: $3.84M / $812K / $1,250. */
export function formatMoney(value: number): string {
  const n = Number(value) || 0
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${n.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
}
