'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { Plus, Search } from 'lucide-react'

import { CrmShell, type CrmUser } from './crm-shell'
import type { ShellData } from '@/lib/shell-data'
import { StatusPill } from './crm-primitives'
import { NewOrderDialog } from './new-order-dialog'
import { EmptyState } from '@/components/shell/states'
import { useNow } from '@/lib/use-now'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  activeStatuses,
  clientDisplayName,
  formatDuration,
  intervalDuration,
  isPastSla,
  openInterval,
  isPastTargetClose,
  orderAgeDays,
  type CrmClientSummary,
  type CrmOrder,
  type CrmStatus,
  type CrmStatusInterval,
} from '@/lib/crm'

interface Profile {
  id: string
  full_name: string | null
  email: string | null
}

const ALL = '__all__'

const PRIORITY_CLASS: Record<string, string> = {
  urgent: 'text-red-600 dark:text-red-400 font-medium',
  high: 'text-orange-600 dark:text-orange-400 font-medium',
  normal: '',
  low: 'text-muted-foreground',
}

export function CrmOrdersView({
  user,
  shell,
  orders,
  statuses,
  clients,
  profiles,
  openIntervals,
  initialStatus,
  serverNow,
}: {
  user: CrmUser
  /** Server-loaded modules + calendars, handed straight to CrmShell. See lib/shell-data.ts. */
  shell?: ShellData
  orders: CrmOrder[]
  statuses: CrmStatus[]
  clients: CrmClientSummary[]
  profiles: Profile[]
  openIntervals: CrmStatusInterval[]
  initialStatus: string | null
  serverNow: string
}) {
  const now = useNow(serverNow)
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState(initialStatus ?? ALL)
  const [ownerFilter, setOwnerFilter] = useState(ALL)
  const [creating, setCreating] = useState(false)

  const clientById = useMemo(() => new Map(clients.map(c => [c.id, c])), [clients])
  // Resolve against every status, offer only the live ones. See lib/crm.ts activeStatuses().
  const statusByKey = useMemo(() => new Map(statuses.map(s => [s.key, s])), [statuses])
  const selectable = useMemo(() => activeStatuses(statuses), [statuses])
  const profileById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return orders.filter(order => {
      if (statusFilter !== ALL && order.status !== statusFilter) return false
      if (ownerFilter !== ALL && (order.owner_id ?? '') !== ownerFilter) return false
      if (!q) return true
      const client = clientById.get(order.client_id)
      return [order.order_no, client ? clientDisplayName(client) : '', client?.company_name]
        .filter(Boolean)
        .some(v => String(v).toLowerCase().includes(q))
    })
  }, [orders, query, statusFilter, ownerFilter, clientById])

  return (
    <CrmShell user={user} shell={shell} breadcrumbs={[{ label: 'CRM', href: '/crm' }, { label: 'Orders' }]}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Orders</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {filtered.length} of {orders.length} order{orders.length === 1 ? '' : 's'}
          </p>
        </div>
        <Button size="sm" className="gap-1.5" onClick={() => setCreating(true)} disabled={clients.length === 0}>
          <Plus className="h-4 w-4" /> New order
        </Button>
      </header>

      {/* Search spans the row, the two filters share the next one. Fixed widths (w-60,
          w-[180px]) left a ragged 240px column down the left of a 390px phone with dead
          space beside every control. */}
      <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
        <div className="relative col-span-2 sm:col-span-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" aria-hidden />
          <Input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search order # or client"
            aria-label="Search orders"
            className="w-full pl-8 sm:w-60"
          />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter by status">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            {selectable.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={ownerFilter} onValueChange={setOwnerFilter}>
          <SelectTrigger className="w-full sm:w-[180px]" aria-label="Filter by owner">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All owners</SelectItem>
            {profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title="No orders yet"
          description={
            clients.length === 0
              ? 'Orders belong to a client, so create a client first.'
              : 'Open the first order against a client to start the pipeline.'
          }
          action={
            clients.length === 0 ? (
              <Button asChild size="sm"><Link href="/crm/clients/new">New client</Link></Button>
            ) : (
              <Button size="sm" onClick={() => setCreating(true)}>New order</Button>
            )
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="Nothing matches those filters"
          description="Widen the status or owner filter, or clear the search."
          action={
            <Button size="sm" variant="outline" onClick={() => { setQuery(''); setStatusFilter(ALL); setOwnerFilter(ALL) }}>
              Clear filters
            </Button>
          }
        />
      ) : (
        <>
        {/*
          A nine-column table on a 390px screen is a 1000px canvas you drag sideways, one
          column at a time, with the order number scrolled off before you reach the number
          you came for. Below md the same rows render as records: identity and status on the
          first line, then only the fields that carry a decision.
        */}
        <ul className="space-y-2 md:hidden">
          {filtered.map(order => {
            const client = clientById.get(order.client_id)
            const status = statusByKey.get(order.status)
            const owner = order.owner_id ? profileById.get(order.owner_id) : null
            const open = openInterval(openIntervals, order.id)
            const late = isPastSla(order, status, openIntervals, now)
            const pastTarget = isPastTargetClose(order, now)
            return (
              <li key={order.id} className="bg-card rounded-lg border">
                <Link href={`/crm/orders/${order.id}`} className="focus-visible:ring-ring block rounded-lg p-3 outline-none focus-visible:ring-2">
                  <div className="flex items-start justify-between gap-3">
                    <span className="font-mono text-xs font-medium">{order.order_no ?? 'Draft'}</span>
                    <StatusPill status={status} />
                  </div>
                  <p className="mt-1.5 font-medium">
                    {client ? clientDisplayName(client) : <span className="text-muted-foreground">Unknown client</span>}
                  </p>
                  <p className="text-muted-foreground mt-0.5 text-sm">
                    <span className="capitalize">{order.order_type}</span>
                    {' · '}
                    {owner?.full_name || owner?.email || 'Unassigned'}
                    {order.priority !== 'normal' && (
                      <span className={cn(' · capitalize', PRIORITY_CLASS[order.priority] ?? '')}>{order.priority}</span>
                    )}
                  </p>
                  <dl className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 border-t pt-2.5 text-sm">
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">In status</dt>
                      <dd className={cn('tabular-nums', late && 'text-red-600 dark:text-red-400 font-medium')}>
                        {open ? formatDuration(intervalDuration(open, now)) : '—'}
                        {late && status?.sla_hours ? (
                          <span className="sr-only"> (past the {status.sla_hours} hour target for {status.label})</span>
                        ) : null}
                      </dd>
                    </div>
                    <div className="flex gap-1.5">
                      <dt className="text-muted-foreground">Age</dt>
                      <dd className="tabular-nums">{orderAgeDays(order, now).toFixed(1)}d</dd>
                    </div>
                    {order.target_close_date && (
                      <div className="flex gap-1.5">
                        <dt className="text-muted-foreground">Target</dt>
                        <dd className={cn(pastTarget && 'text-red-600 dark:text-red-400 font-medium')}>
                          {format(new Date(`${order.target_close_date}T00:00:00`), 'd MMM')}
                        </dd>
                      </div>
                    )}
                  </dl>
                </Link>
              </li>
            )
          })}
        </ul>

        <div className="bg-card hidden overflow-hidden rounded-lg border md:block">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px] text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  {['Order #', 'Client', 'Type', 'Status', 'In status', 'Owner', 'Age', 'Target close', 'Priority'].map(h => (
                    <th key={h} scope="col" className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(order => {
                  const client = clientById.get(order.client_id)
                  const status = statusByKey.get(order.status)
                  const owner = order.owner_id ? profileById.get(order.owner_id) : null
                  const open = openInterval(openIntervals, order.id)
                  const late = isPastSla(order, status, openIntervals, now)
                  const pastTarget = isPastTargetClose(order, now)
                  return (
                    <tr key={order.id} className="hover:bg-accent/50 transition-colors">
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        <Link href={`/crm/orders/${order.id}`} className="font-mono text-xs font-medium hover:underline">
                          {order.order_no ?? 'Draft'}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {client ? clientDisplayName(client) : <span className="text-muted-foreground">Unknown</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap capitalize">{order.order_type}</td>
                      <td className="px-3 py-2.5"><StatusPill status={status} /></td>
                      {/* An SLA is a budget for the CURRENT status, not for the order's whole
                          life, so the breach is shown against time-in-status. It used to
                          redden the Age cell, which measures something else entirely and made
                          a two-day-old order look overdue because of one slow stage. */}
                      <td className={cn('px-3 py-2.5 whitespace-nowrap tabular-nums', late && 'text-red-600 dark:text-red-400 font-medium')}>
                        {open ? formatDuration(intervalDuration(open, now)) : '—'}
                        {late && status?.sla_hours ? (
                          <span className="sr-only"> (past the {status.sla_hours} hour target for {status.label})</span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap">
                        {owner?.full_name || owner?.email || <span className="text-muted-foreground">Unassigned</span>}
                      </td>
                      <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">
                        {orderAgeDays(order, now).toFixed(1)} days
                      </td>
                      <td className={cn('px-3 py-2.5 whitespace-nowrap', pastTarget && 'text-red-600 dark:text-red-400 font-medium')}>
                        {order.target_close_date ? format(new Date(`${order.target_close_date}T00:00:00`), 'd MMM') : '—'}
                      </td>
                      <td className={cn('px-3 py-2.5 whitespace-nowrap capitalize', PRIORITY_CLASS[order.priority] ?? '')}>
                        {order.priority}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}

      <NewOrderDialog
        open={creating}
        onOpenChange={setCreating}
        clients={clients}
        statuses={statuses}
        profiles={profiles}
        currentUserId={user.id}
      />
    </CrmShell>
  )
}
