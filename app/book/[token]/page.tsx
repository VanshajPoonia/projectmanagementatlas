import { createClient as createAdminClient } from '@supabase/supabase-js'
import { Card } from '@/components/ui/card'
import { Lock } from 'lucide-react'
import { isBookingLinkActive, isValidBookingToken } from '@/lib/appointment-booking'
import BookingForm from '@/components/appointments/booking-form'

// Public, unauthenticated view — always fetch fresh, never cache availability.
export const dynamic = 'force-dynamic'

// Service-role client: this route is the ONLY place a host's settings/restrictions
// are read without a session, and only ever for the single host a validated
// booking token points at — mirrors app/share/[token]/page.tsx exactly.
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

export default async function BookPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isValidBookingToken(token)) {
    return <Unavailable title="This link is no longer available" description="The booking link may have been revoked, expired, or is invalid." />
  }

  const db = adminDb()

  const { data: link, error: linkError } = await db
    .from('appointment_booking_links')
    .select('host_user_id, revoked_at, expires_at')
    .eq('token', token)
    .maybeSingle()

  if (linkError) {
    return <Unavailable title="This booking page could not be loaded" description="The service may be temporarily unavailable. Refresh the page to try again." />
  }
  if (!isBookingLinkActive(link)) {
    return <Unavailable title="This link is no longer available" description="The booking link may have been revoked, expired, or is invalid." />
  }

  const [{ data: host }, { data: settings }, { data: restrictions }, { data: existing }] = await Promise.all([
    db.from('profiles').select('full_name, email').eq('id', link.host_user_id).maybeSingle(),
    db
      .from('appointment_settings')
      .select('min_duration_minutes, max_duration_minutes, required_lead_time_hours, allow_same_day, allow_overlaps, max_overlaps, timezone')
      .eq('user_id', link.host_user_id)
      .maybeSingle(),
    // 'reason' is deliberately excluded — a public visitor should never learn
    // WHY the host is unavailable, only that they are.
    db
      .from('appointment_restrictions')
      .select('starts_on, ends_on, is_all_day, starts_at_time, ends_at_time, weekdays')
      .eq('user_id', link.host_user_id),
    // Only start/end for confirmed appointments in the near future — no guest
    // details are ever sent to the public page.
    db
      .from('appointments')
      .select('starts_at, ends_at')
      .eq('host_user_id', link.host_user_id)
      .eq('status', 'confirmed')
      .gte('starts_at', new Date().toISOString())
      .lte('starts_at', new Date(Date.now() + 90 * 86400000).toISOString()),
  ])

  if (!settings) {
    return <Unavailable title="This host isn't taking bookings yet" description="Booking preferences haven't been set up. Check back later." />
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/20 p-4 py-10">
      <div className="w-full max-w-lg">
        <BookingForm
          token={token}
          hostName={host?.full_name || 'your host'}
          settings={settings}
          restrictions={restrictions ?? []}
          existing={existing ?? []}
        />
      </div>
    </div>
  )
}
