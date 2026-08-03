import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { isValidBookingToken } from '@/lib/appointment-booking'

function anonDb() {
  return createServiceClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
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
  // share_links uses — no additional rate limiting needed on this path, only
  // someone holding the token from their confirmation email can call this.
  const { error } = await anonDb().rpc('cancel_appointment', { p_cancel_token: token })
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }

  return NextResponse.json({ ok: true })
}
