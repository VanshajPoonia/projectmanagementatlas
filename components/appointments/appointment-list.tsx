'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Ban, ChevronDown, Loader2, Mail, Phone } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface AppointmentRow {
  id: string
  starts_at: string
  ends_at: string
  guest_name: string
  guest_email: string
  guest_phone: string | null
  note: string | null
  status: 'confirmed' | 'cancelled'
  cancel_token: string | null
}

export default function AppointmentList({ userId, timezone }: { userId: string; timezone: string }) {
  const [appointments, setAppointments] = useState<AppointmentRow[]>([])
  const [loading, setLoading] = useState(true)
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [showPast, setShowPast] = useState(false)
  const supabase = createClient()

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('appointments')
      .select('id, starts_at, ends_at, guest_name, guest_email, guest_phone, note, status, cancel_token')
      .eq('host_user_id', userId)
      .order('starts_at', { ascending: true })

    if (error) {
      toast.error('Could not load appointments', { description: error.message })
    } else {
      setAppointments((data ?? []) as AppointmentRow[])
    }
    setLoading(false)
  }, [supabase, userId])

  useEffect(() => {
    load()
  }, [load])

  const nowMs = Date.now()
  const upcoming = appointments.filter(a => a.status === 'confirmed' && new Date(a.starts_at).getTime() >= nowMs)
  const past = appointments.filter(a => a.status !== 'confirmed' || new Date(a.starts_at).getTime() < nowMs)

  // Host cancellation reuses the SAME RPC the public cancel page calls - the
  // host can read their own row's cancel_token (the SELECT policy has no
  // column restriction), so no separate host-cancel RPC is needed.
  const cancel = async (row: AppointmentRow) => {
    if (!row.cancel_token) return
    setCancellingId(row.id)
    const { error } = await supabase.rpc('cancel_appointment', { p_cancel_token: row.cancel_token })
    setCancellingId(null)

    if (error) {
      toast.error('Could not cancel this appointment', { description: error.message })
      return
    }
    toast.success('Appointment cancelled')
    await load()
  }

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone, weekday: 'short', month: 'short', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })

  const renderRow = (row: AppointmentRow, cancellable: boolean) => (
    <div key={row.id} className="flex flex-wrap items-start justify-between gap-3 rounded-lg border p-3">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{row.guest_name}</span>
          <Badge variant={row.status === 'cancelled' ? 'outline' : 'default'} className="text-[10px]">
            {row.status === 'cancelled' ? 'Cancelled' : 'Confirmed'}
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">{fmt.format(new Date(row.starts_at))}</p>
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <a href={`mailto:${row.guest_email}`} className="flex items-center gap-1 hover:text-foreground">
            <Mail className="h-3 w-3" />{row.guest_email}
          </a>
          {row.guest_phone && (
            <a href={`tel:${row.guest_phone}`} className="flex items-center gap-1 hover:text-foreground">
              <Phone className="h-3 w-3" />{row.guest_phone}
            </a>
          )}
        </div>
        {row.note && <p className="max-w-md text-xs text-muted-foreground">{row.note}</p>}
      </div>
      {cancellable && (
        <Button
          size="sm" variant="outline" className="flex-shrink-0 gap-1.5 text-red-600 dark:text-red-400"
          onClick={() => cancel(row)} disabled={cancellingId === row.id}
        >
          {cancellingId === row.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Ban className="h-3.5 w-3.5" />}
          Cancel
        </Button>
      )}
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Your appointments</CardTitle>
        <CardDescription>Booked through your public booking link.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : upcoming.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No upcoming appointments.</p>
        ) : (
          <div className="space-y-2">{upcoming.map(row => renderRow(row, true))}</div>
        )}

        {past.length > 0 && (
          <div className="space-y-2 pt-2">
            <button
              type="button"
              onClick={() => setShowPast(v => !v)}
              className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className={`h-3.5 w-3.5 transition-transform ${showPast ? 'rotate-180' : ''}`} />
              Past & cancelled ({past.length})
            </button>
            {showPast && (
              <div className="space-y-2">{past.map(row => renderRow(row, false))}</div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
