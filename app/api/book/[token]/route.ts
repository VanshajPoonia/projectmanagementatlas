import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { createHmac } from 'node:crypto'
import { isValidBookingToken } from '@/lib/appointment-booking'
import { sendBookingConfirmationEmails } from '@/lib/appointment-email'

// Rate limiting only works if this route captures the REAL client IP itself -
// a browser calling the check_booking_rate_limit RPC directly could supply any
// string as its own "IP" and trivially defeat the per-IP limit. This route is
// the one place that IP is read from trusted request headers, hashed, and only
// then handed to Postgres.
function clientIpHash(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for')
  const ip = forwarded?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || 'unknown'
  // HMAC rather than a plain hash so the value isn't a stable, reversible-by-
  // rainbow-table fingerprint of the visitor's IP; the service role key is
  // already a server-only secret, reused here rather than adding a new one.
  return createHmac('sha256', process.env.SUPABASE_SERVICE_ROLE_KEY!).update(ip).digest('hex')
}

function anonDb() {
  // Deliberately the anon key, not the service role: this call should only be
  // able to do exactly what a public visitor's own browser client could do,
  // making the RPC's own grants the real security boundary, not this route.
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

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  if (!isValidBookingToken(token)) {
    return NextResponse.json({ error: 'Invalid booking link' }, { status: 400 })
  }

  let body: {
    startsAt?: string; endsAt?: string; guestName?: string; guestEmail?: string
    guestPhone?: string; note?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Malformed request' }, { status: 400 })
  }

  const { startsAt, endsAt, guestName, guestEmail, guestPhone, note } = body
  if (!startsAt || !endsAt || !guestName || !guestEmail) {
    return NextResponse.json({ error: 'Missing required fields' }, { status: 400 })
  }

  const db = anonDb()
  const ipHash = clientIpHash(request)

  const { error: rateLimitError } = await db.rpc('check_booking_rate_limit', {
    p_token: token,
    p_ip_hash: ipHash,
  })
  if (rateLimitError) {
    // The RPC's own message ("Too many attempts…" / "no longer available") is
    // safe to surface directly - it never includes anything guest-supplied.
    return NextResponse.json({ error: rateLimitError.message }, { status: 429 })
  }

  const { data: booked, error: bookError } = await db.rpc('book_appointment', {
    p_token: token,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_guest_name: guestName,
    p_guest_email: guestEmail,
    p_guest_phone: guestPhone ?? null,
    p_note: note ?? null,
  })
  if (bookError) {
    return NextResponse.json({ error: bookError.message }, { status: 400 })
  }

  const booking = Array.isArray(booked) ? booked[0] : booked
  if (!booking) {
    return NextResponse.json({ error: 'Could not complete the booking' }, { status: 500 })
  }

  // Fire-and-forget from the client's perspective: the booking already
  // succeeded, so an email hiccup here must not turn into a failed response.
  void sendConfirmationOnce(booking.id, request).catch(err =>
    console.error('[book] confirmation email step failed for', booking.id, err),
  )

  return NextResponse.json({
    id: booking.id,
    cancelToken: booking.cancel_token,
    startsAt: booking.starts_at,
    endsAt: booking.ends_at,
  })
}

/**
 * Guarded so a retried or duplicated call can never send the confirmation
 * twice: the UPDATE only matches (and only returns a row) the first time,
 * because confirmation_sent_at is NULL exactly once per appointment. No
 * endpoint exists that can re-trigger this for an appointment that already
 * has a value there.
 */
async function sendConfirmationOnce(appointmentId: string, request: Request) {
  const db = serviceDb()

  const { data: appt } = await db
    .from('appointments')
    .update({ confirmation_sent_at: new Date().toISOString() })
    .eq('id', appointmentId)
    .is('confirmation_sent_at', null)
    .select('host_user_id, guest_name, guest_email, starts_at, ends_at, cancel_token')
    .maybeSingle()

  if (!appt) return // already sent, or the row vanished - either way, do nothing

  const [{ data: host }, { data: settings }] = await Promise.all([
    db.from('profiles').select('full_name, email').eq('id', appt.host_user_id).maybeSingle(),
    db.from('appointment_settings').select('timezone').eq('user_id', appt.host_user_id).maybeSingle(),
  ])

  await sendBookingConfirmationEmails({
    guestEmail: appt.guest_email,
    guestName: appt.guest_name,
    hostEmail: host?.email ?? null,
    hostName: host?.full_name || 'the host',
    startsAt: appt.starts_at,
    endsAt: appt.ends_at,
    timeZone: settings?.timezone || 'UTC',
    cancelUrl: `${new URL(request.url).origin}/book/cancel/${appt.cancel_token}`,
  })
}
