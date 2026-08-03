import { createClient as createAdminClient } from '@supabase/supabase-js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Lock } from 'lucide-react'
import { isValidBookingToken } from '@/lib/appointment-booking'
import CancelAppointmentButton from '@/components/appointments/cancel-appointment-button'

export const dynamic = 'force-dynamic'

function adminDb() {
  return createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function Unavailable({ title, description }: { title: string; description: string }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
      <Card className="max-w-md p-8 text-center">
        <Lock className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      </Card>
    </div>
  )
}

export default async function CancelPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isValidBookingToken(token)) {
    return <Unavailable title="Invalid cancellation link" description="This link doesn't look right. Check the URL from your confirmation email." />
  }

  const db = adminDb()
  const { data: appt, error } = await db
    .from('appointments')
    .select('status, starts_at, ends_at, host_user_id')
    .eq('cancel_token', token)
    .maybeSingle()

  if (error) {
    return <Unavailable title="This page could not be loaded" description="The service may be temporarily unavailable. Refresh the page to try again." />
  }
  if (!appt) {
    return <Unavailable title="Appointment not found" description="This link may be invalid." />
  }
  if (appt.status === 'cancelled') {
    return <Unavailable title="This appointment is already cancelled" description="No further action is needed." />
  }

  const { data: host } = await db.from('profiles').select('full_name').eq('id', appt.host_user_id).maybeSingle()
  const { data: settings } = await db.from('appointment_settings').select('timezone').eq('user_id', appt.host_user_id).maybeSingle()

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: settings?.timezone || 'UTC', weekday: 'long', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit',
  })

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Cancel appointment</CardTitle>
          <CardDescription>
            With {host?.full_name || 'your host'} on {fmt.format(new Date(appt.starts_at))}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CancelAppointmentButton token={token} />
        </CardContent>
      </Card>
    </div>
  )
}
