import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isValidBookingToken } from '@/lib/appointment-booking'
import { sendCancellationNoticeToHost } from '@/lib/appointment-email'

function anonDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function serviceDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  // cancel_token has the same 64-hex shape as a booking token, so the same
  // format check applies even though it's a different capability.
  if (!isValidBookingToken(token)) {
    return NextResponse.json({ error: 'Invalid cancellation link' }, { status: 400 })
  }

  // cancel_token is itself an unguessable 256-bit capability, same trust model
  // share_links uses - no additional rate limiting needed on this path, only
  // someone holding the token from their confirmation email can call this.
  const { error } = await anonDb().rpc('cancel_appointment', { p_cancel_token: token })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  // Fire-and-forget from the client's perspective: the cancellation already
  // succeeded, so an email hiccup here must not turn into a failed response.
  // cancel_appointment() only ever flips status (the RPC's UPDATE touches no
  // other column), so the row's other fields are safe to read after the fact.
  void notifyHostOfCancellation(token).catch(err =>
    console.error('[book/cancel] host notification step failed for token', token, err),
  )

  return NextResponse.json({ ok: true })
}

async function notifyHostOfCancellation(cancelToken: string) {
  const db = serviceDb()

  const { data: appt } = await db
    .from('appointments')
    .select('host_user_id, guest_name, guest_email, starts_at, ends_at')
    .eq('cancel_token', cancelToken)
    .maybeSingle()

  if (!appt) return

  const [{ data: host }, { data: settings }] = await Promise.all([
    db.from('profiles').select('email').eq('id', appt.host_user_id).maybeSingle(),
    db.from('appointment_settings').select('timezone').eq('user_id', appt.host_user_id).maybeSingle(),
  ])

  await sendCancellationNoticeToHost({
    hostEmail: host?.email ?? null,
    guestName: appt.guest_name,
    guestEmail: appt.guest_email,
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    timeZone: settings?.timezone || 'UTC',
  })
}
