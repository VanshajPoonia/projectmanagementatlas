'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'

import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import { ORDER_PRIORITIES, activeStatuses, clientDisplayName, type CrmClientSummary, type CrmStatus } from '@/lib/crm'

interface Profile {
  id: string
  full_name: string | null
  email: string | null
}

const UNASSIGNED = '__unassigned__'

const ORDER_TYPES = [
  { value: 'standard', label: 'Standard service' },
  { value: 'rush', label: 'Rush service' },
  { value: 'consultation', label: 'Consultation' },
]

export function NewOrderDialog({
  open,
  onOpenChange,
  clients,
  statuses,
  profiles,
  currentUserId,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  clients: CrmClientSummary[]
  statuses: CrmStatus[]
  profiles: Profile[]
  currentUserId: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  // A retired status must not be offered on a new order; the full list still arrives so
  // lookups elsewhere resolve.
  const selectable = useMemo(() => activeStatuses(statuses), [statuses])

  const [clientId, setClientId] = useState('')
  const [orderType, setOrderType] = useState('standard')
  const [status, setStatus] = useState(activeStatuses(statuses)[0]?.key ?? 'new')
  const [owner, setOwner] = useState(UNASSIGNED)
  const [priority, setPriority] = useState('normal')
  const [targetClose, setTargetClose] = useState('')
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!clientId || saving) return
    setSaving(true)

    const { data: orderNo, error: refError } = await supabase.rpc('claim_crm_order_no')
    if (refError) {
      setSaving(false)
      toast.error(`Could not reserve an order number: ${refError.message}`)
      return
    }

    // The opening status interval is written by the database trigger, not from here — the
    // history has to be true even for a code path that forgets to record it.
    const { data, error } = await supabase
      .from('crm_orders')
      .insert({
        order_no: orderNo,
        client_id: clientId,
        order_type: orderType,
        status,
        owner_id: owner === UNASSIGNED ? null : owner,
        priority,
        target_close_date: targetClose || null,
        estimated_value: value.trim() ? Number(value) : 0,
        created_by: currentUserId,
      })
      .select('id')
      .single()

    setSaving(false)
    if (error || !data) {
      toast.error(error ? `Could not create the order: ${error.message}` : 'The order was not created.')
      return
    }

    toast.success(`Order ${orderNo} created.`)
    onOpenChange(false)
    router.push(`/crm/orders/${data.id}`)
    router.refresh()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New order</DialogTitle>
          <DialogDescription>
            Orders belong to a client and carry their own status history from the moment they open.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="order-client">Client *</Label>
            <Select value={clientId} onValueChange={setClientId}>
              <SelectTrigger id="order-client" className="mt-1.5">
                <SelectValue placeholder="Choose a client" />
              </SelectTrigger>
              <SelectContent>
                {clients.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {clientDisplayName(c)}{c.client_ref ? ` · ${c.client_ref}` : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <Label htmlFor="order-type">Order type</Label>
            <Select value={orderType} onValueChange={setOrderType}>
              <SelectTrigger id="order-type" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORDER_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="order-status">Starting status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger id="order-status" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {selectable.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="order-owner">In progress to</Label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger id="order-owner" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                {profiles.map(p => <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="order-priority">Priority</Label>
            <Select value={priority} onValueChange={setPriority}>
              <SelectTrigger id="order-priority" className="mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {ORDER_PRIORITIES.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor="order-target">Target close</Label>
            <Input id="order-target" type="date" value={targetClose}
              onChange={e => setTargetClose(e.target.value)} className="mt-1.5" />
          </div>
          <div>
            <Label htmlFor="order-value">Estimated value</Label>
            <Input id="order-value" inputMode="decimal" value={value} placeholder="0.00"
              onChange={e => setValue(e.target.value)} className="mt-1.5" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={submit} disabled={!clientId || saving}>
            {saving ? 'Creating…' : 'Create order'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
