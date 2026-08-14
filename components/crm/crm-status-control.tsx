'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { format } from 'date-fns'
import { toast } from 'sonner'

import { CrmShell, type CrmUser } from './crm-shell'
import { Field, StatTile, StatusPill } from './crm-primitives'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import { useNow } from '@/lib/use-now'
import {
  STATUS_DISPOSITIONS,
  activeStatuses,
  clientDisplayName,
  formatDuration,
  formatMoney,
  intervalDuration,
  orderAgeDays,
  timeInStatus,
  type CrmClient,
  type CrmOrder,
  type CrmStatus,
  type CrmStatusInterval,
} from '@/lib/crm'

interface Profile {
  id: string
  full_name: string | null
  email: string | null
}

/**
 * Status control: the screen that moves an order and shows what that movement cost.
 *
 * The transition itself is a plain UPDATE of crm_orders.status — the history row is written by
 * the database trigger, in the same transaction. That is deliberate: if this component wrote
 * the history, an order moved from anywhere else (an import, a future automation, psql) would
 * have a gap, and a cycle-time report built on a history with gaps is worse than no report.
 */
export function CrmStatusControl({
  user,
  order: initialOrder,
  client,
  statuses,
  history: initialHistory,
  profiles,
  serverNow,
}: {
  user: CrmUser
  order: CrmOrder
  client: CrmClient | null
  statuses: CrmStatus[]
  history: CrmStatusInterval[]
  profiles: Profile[]
  serverNow: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const now = useNow(serverNow)

  const [order, setOrder] = useState(initialOrder)
  const [history, setHistory] = useState(initialHistory)
  const [nextStatus, setNextStatus] = useState(initialOrder.status)
  const [disposition, setDisposition] = useState<string>(STATUS_DISPOSITIONS[0])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const statusByKey = useMemo(() => new Map(statuses.map(s => [s.key, s])), [statuses])
  const profileById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles])
  const current = statusByKey.get(order.status)
  const target = statusByKey.get(nextStatus)
  const totals = useMemo(() => timeInStatus(history, now), [history, now])

  // The mockup marks the cancellation reason REQUIRED. Enforced here as a disabled submit plus
  // an explanation, rather than an alert after the fact.
  //
  // `unchanged` gates the warning as well as the button: opening an order that is *already*
  // Cancel would otherwise greet the reader with "Cancel needs a reason recorded" about a
  // transition they are not making and cannot make. A validation error belongs to an action in
  // progress, not to the state of the record.
  const unchanged = nextStatus === order.status
  const reasonRequired = Boolean(target?.requires_reason) && !unchanged
  const reasonMissing = reasonRequired && !note.trim()

  async function applyChange() {
    if (saving || unchanged || reasonMissing) return
    setSaving(true)

    // The disposition rides along in the SAME update as the status. The trigger copies both
    // onto the interval it opens and blanks the carriers again, so there is never a moment
    // where the history records a move it cannot explain — and the history table itself stays
    // unwritable by the application, which is what makes it an audit trail.
    const { data, error } = await supabase
      .from('crm_orders')
      .update({
        status: nextStatus,
        status_change_reason: disposition || null,
        status_change_note: note.trim() || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', order.id)
      .select('*')

    if (error || !data?.length) {
      setSaving(false)
      // A refusal comes back as zero rows, not an error (CLAUDE.md, migration 065).
      toast.error(error ? `Could not update the status: ${error.message}` : 'You do not have permission to change this order.')
      return
    }

    const { data: fresh } = await supabase
      .from('crm_order_status_history')
      .select('*')
      .eq('order_id', order.id)
      .order('entered_at', { ascending: true })

    setOrder(data[0])
    setHistory(fresh ?? [])
    setNote('')
    // Re-point the picker at the status we just landed on. Leaving it on the old target left a
    // "Cancel needs a reason recorded" error under a form whose move had already succeeded.
    setNextStatus(data[0].status)
    setDisposition(STATUS_DISPOSITIONS[0])
    setSaving(false)
    toast.success(`Moved to ${target?.label ?? nextStatus}.`)
    router.refresh()
  }

  return (
    <CrmShell
      user={user}
      breadcrumbs={[
        { label: 'CRM', href: '/crm' },
        { label: 'Orders', href: '/crm/orders' },
        { label: order.order_no ?? 'Order' },
      ]}
    >
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">{order.order_no ?? 'Draft order'}</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {client ? (
              <Link href="/crm/clients" className="hover:underline">{clientDisplayName(client)}</Link>
            ) : 'Unknown client'}
            {' · '}opened {format(new Date(order.opened_at), 'd MMM yyyy')}
          </p>
        </div>
        <StatusPill status={current} className="text-sm" />
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatTile label="Age" value={`${orderAgeDays(order, now).toFixed(1)}d`}
          hint={order.closed_at ? 'Frozen at closure' : 'Since it opened'} />
        <StatTile label="Time in current status"
          value={formatDuration(
            intervalDuration(history.find(h => h.exited_at === null) ?? history[history.length - 1] ?? { entered_at: order.opened_at, exited_at: null } as CrmStatusInterval, now),
          )} />
        <StatTile label="Transitions" value={Math.max(0, history.length - 1)}
          hint={history.length <= 1 ? 'Has not moved yet' : undefined} />
        <StatTile label="Estimated value" value={formatMoney(order.estimated_value)} />
      </div>

      <section className="bg-card rounded-lg border">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Status control</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Every change writes a timestamped history record. That history is what the cycle-time
            reports are built from.
          </p>
        </div>

        <div className="grid gap-4 p-4 sm:grid-cols-2">
          <div>
            <Label>Current status</Label>
            <div className="mt-1.5 flex h-9 items-center rounded-md border px-3 text-sm">
              {current?.label ?? order.status}
            </div>
          </div>
          <div>
            <Label htmlFor="next-status">Change status to</Label>
            <Select value={nextStatus} onValueChange={setNextStatus}>
              <SelectTrigger id="next-status" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {activeStatuses(statuses, order.status).map(s => (
                  <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="disposition">Reason / disposition</Label>
            <Select value={disposition} onValueChange={setDisposition}>
              <SelectTrigger id="disposition" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_DISPOSITIONS.map(d => <SelectItem key={d} value={d}>{d}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="status-note">
              Status notes {reasonRequired && <span className="text-destructive">* required for {target?.label}</span>}
            </Label>
            <Textarea id="status-note" value={note} rows={3} className="mt-1.5"
              aria-invalid={reasonMissing}
              placeholder={reasonRequired ? 'Why was this lost or cancelled?' : 'Optional note explaining the transition.'}
              onChange={e => setNote(e.target.value)} />
            {reasonMissing && (
              <p className="text-destructive mt-1 text-xs">
                {target?.label} needs a reason recorded before it can be applied.
              </p>
            )}
          </div>
          <div className="sm:col-span-2 flex items-center justify-end gap-3">
            {unchanged && (
              <p className="text-muted-foreground text-xs">Pick a different status to record a change.</p>
            )}
            <Button onClick={applyChange} disabled={saving || unchanged || reasonMissing}>
              {saving ? 'Updating…' : 'Update status'}
            </Button>
          </div>
        </div>
      </section>

      <section className="bg-card rounded-lg border">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Status history</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                {['Status', 'Entered', 'Exited', 'Elapsed', 'Changed by', 'Reason'].map(h => (
                  <th key={h} scope="col" className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {[...history].reverse().map(row => {
                const by = row.changed_by ? profileById.get(row.changed_by) : null
                return (
                  <tr key={row.id}>
                    <td className="px-3 py-2.5"><StatusPill status={statusByKey.get(row.status)} /></td>
                    <td className="px-3 py-2.5 whitespace-nowrap">{format(new Date(row.entered_at), 'd MMM, h:mm a')}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {row.exited_at
                        ? format(new Date(row.exited_at), 'd MMM, h:mm a')
                        : <span className="text-muted-foreground">Current</span>}
                    </td>
                    <td className="px-3 py-2.5 whitespace-nowrap tabular-nums">{formatDuration(intervalDuration(row, now))}</td>
                    <td className="px-3 py-2.5 whitespace-nowrap">
                      {by?.full_name || by?.email || <span className="text-muted-foreground">System</span>}
                    </td>
                    {/* Both, not either: for a Cancel the note IS the mandatory reason, and
                        showing only the disposition ("Work proceeding normally") would hide
                        the one sentence explaining why the deal was lost. */}
                    <td className="text-muted-foreground max-w-[280px] px-3 py-2.5"
                        title={[row.reason, row.note].filter(Boolean).join(' — ') || undefined}>
                      {row.reason && <span className="block truncate">{row.reason}</span>}
                      {row.note && <span className="text-foreground block truncate">{row.note}</span>}
                      {!row.reason && !row.note && '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="bg-card rounded-lg border">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Time in each status</h2>
          <p className="text-muted-foreground mt-0.5 text-sm">
            Totalled across every visit, including the one still open.
          </p>
        </div>
        <dl className="grid gap-4 p-4 sm:grid-cols-3">
          {[...totals.entries()]
            .sort((a, b) => b[1].totalMs - a[1].totalMs)
            .map(([key, value]) => (
              <Field key={key} label={statusByKey.get(key)?.label ?? key}>
                {formatDuration(value.totalMs)}
                {value.entries > 1 && (
                  <span className="text-muted-foreground"> · {value.entries} visits</span>
                )}
              </Field>
            ))}
        </dl>
      </section>

      <section className="bg-card rounded-lg border p-4">
        <h2 className="mb-3 font-semibold">Order details</h2>
        <dl className="grid gap-4 sm:grid-cols-3">
          <Field label="Type">{order.order_type}</Field>
          <Field label="Priority">{order.priority}</Field>
          <Field label="In progress to">
            {order.owner_id ? profileById.get(order.owner_id)?.full_name : null}
          </Field>
          <Field label="Target close">{order.target_close_date}</Field>
          <Field label="Closed">
            {order.closed_at ? format(new Date(order.closed_at), 'd MMM yyyy, h:mm a') : null}
          </Field>
          <Field label="Client reference">{client?.client_ref}</Field>
        </dl>
      </section>
    </CrmShell>
  )
}
