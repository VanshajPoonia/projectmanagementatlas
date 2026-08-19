'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import { AlertTriangle, ArrowRight, Clock, UserX } from 'lucide-react'

import { CrmShell, type CrmUser } from './crm-shell'
import type { ShellData } from '@/lib/shell-data'
import { StatTile, StatusPill } from './crm-primitives'
import { EmptyState, ErrorState } from '@/components/shell/states'
import { useNow } from '@/lib/use-now'
import { Button } from '@/components/ui/button'
import {
  agingAlerts,
  clientDisplayName,
  dashboardSummary,
  formatMoney,
  pipelineCounts,
  type CrmClientSummary,
  type CrmOrder,
  type CrmStatus,
  type CrmStatusInterval,
} from '@/lib/crm'

const ALERT_ICON = {
  sla: Clock,
  target: AlertTriangle,
  unassigned: UserX,
} as const

const ALERT_LABEL = {
  sla: 'Past status target',
  target: 'Past target close',
  unassigned: 'Unassigned',
} as const

export function CrmDashboard({
  user,
  shell,
  statuses,
  orders,
  openIntervals,
  clients,
  serverNow,
  loadFailed = false,
}: {
  user: CrmUser
  /** Server-loaded modules + calendars, handed straight to CrmShell. See lib/shell-data.ts. */
  shell?: ShellData
  statuses: CrmStatus[]
  orders: CrmOrder[]
  openIntervals: CrmStatusInterval[]
  clients: CrmClientSummary[]
  /**
   * True when any of the server queries behind this screen failed. Without it an error and
   * a genuinely empty CRM render identically, and every number on the page is a claim.
   */
  loadFailed?: boolean
  serverNow: string
}) {
  // One `now` for the whole render, seeded from the server so hydration matches. Calling
  // new Date() inside each helper would also let two tiles disagree by a few milliseconds.
  const now = useNow(serverNow)

  const summary = useMemo(
    () => dashboardSummary(orders, statuses, openIntervals, now),
    [orders, statuses, openIntervals, now],
  )
  const pipeline = useMemo(() => pipelineCounts(orders, statuses), [orders, statuses])
  const alerts = useMemo(
    () => agingAlerts(orders, statuses, openIntervals, now),
    [orders, statuses, openIntervals, now],
  )
  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])

  return (
    <CrmShell user={user} shell={shell} breadcrumbs={[{ label: 'CRM' }]}>
      {/* Rendered INSTEAD of the content, not above it. A count of 0 beside a failed read
          is not a small number, it is an unknown one, and showing both invites the zero
          being believed. */}
      {loadFailed ? (
        <ErrorState
          title="This screen could not load its records"
          description="Nothing is wrong with your data - the page failed to read it. Reload to try again; if it keeps failing, tell an admin."
          className="mt-6"
        />
      ) : (
      <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            Entering clients and orders, controlling workflow status, and reporting on it.
          </p>
        </div>
        <div className="flex gap-2">
          <Button asChild variant="outline" size="sm">
            <Link href="/crm/orders">View orders</Link>
          </Button>
          <Button asChild size="sm">
            <Link href="/crm/clients/new">New client</Link>
          </Button>
        </div>
      </header>

      {/* Two across on a phone; a KPI is one number and does not need a full row. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <StatTile
          label="Open orders"
          value={summary.openOrders}
          hint="Across all active statuses"
        />
        <StatTile
          label="New this week"
          value={summary.newThisWeek}
          hint="Opened in the last 7 days"
        />
        <StatTile
          label="Avg. days to close"
          value={summary.avgDaysToClose === null ? '-' : summary.avgDaysToClose.toFixed(1)}
          hint={
            summary.avgDaysToClose === null
              ? 'No orders have closed yet'
              : 'Across every closed order'
          }
        />
        <StatTile
          label="Orders past target"
          value={summary.pastSla}
          tone={summary.pastSla > 0 ? 'alert' : 'neutral'}
          hint={summary.pastSla > 0 ? 'Needs attention' : 'Everything inside target'}
        />
      </div>

      <section className="bg-card rounded-lg border">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b px-4 py-3">
          <h2 className="font-semibold">Current pipeline</h2>
          <p className="text-muted-foreground text-sm">
            {formatMoney(summary.pipelineValue)} open · {formatMoney(summary.wonValue)} won
          </p>
        </div>
        {orders.length === 0 ? (
          <EmptyState
            title="No orders yet"
            description="Create a client, then open their first order to start the pipeline."
            action={
              <Button asChild size="sm">
                <Link href="/crm/clients/new">New client</Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid grid-cols-2 gap-px lg:grid-cols-4">
            {pipeline.map(({ status, count }) => (
              <li key={status.key}>
                <Link
                  href={`/crm/orders?status=${encodeURIComponent(status.key)}`}
                  className="hover:bg-accent focus-visible:ring-ring flex items-center justify-between gap-3 px-4 py-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset"
                >
                  <StatusPill status={status} />
                  <span className="text-lg font-semibold tabular-nums">{count}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="bg-card rounded-lg border">
        <div className="flex items-baseline justify-between gap-2 border-b px-4 py-3">
          <h2 className="font-semibold">Aging alerts</h2>
          {alerts.length > 0 && (
            <span className="text-muted-foreground text-sm tabular-nums">{alerts.length}</span>
          )}
        </div>
        {alerts.length === 0 ? (
          <EmptyState
            title="Nothing is overdue"
            description="No order is past its status target, its close date, or sitting unassigned."
          />
        ) : (
          <ul className="divide-y">
            {alerts.slice(0, 12).map(alert => {
              const Icon = ALERT_ICON[alert.kind]
              const client = clientById.get(alert.order.client_id)
              return (
                <li key={alert.order.id}>
                  <Link
                    href={`/crm/orders/${alert.order.id}`}
                    className="hover:bg-accent focus-visible:ring-ring flex items-center gap-3 px-4 py-3 transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset"
                  >
                    <Icon className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {alert.order.order_no ?? 'Draft order'}
                        {client ? ` · ${clientDisplayName(client)}` : ''}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {ALERT_LABEL[alert.kind]} - {alert.detail}
                      </span>
                    </span>
                    <ArrowRight className="text-muted-foreground h-4 w-4 shrink-0" aria-hidden />
                  </Link>
                </li>
              )
            })}
          </ul>
        )}
      </section>
      </>
      )}
    </CrmShell>
  )
}
