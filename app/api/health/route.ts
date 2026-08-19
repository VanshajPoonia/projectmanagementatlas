import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Lightweight liveness/readiness endpoint for ops + scripts/healthcheck.mjs.
// It is NOT a product feature and exposes no user data: it confirms the process is
// up and that the database is reachable through the normal session client (so RLS
// still applies - no privileged access here).
// No auth required; returns only booleans/status, never row contents.
//
// ⚠️ A PERMISSION ERROR HERE MEANS HEALTHY, and the distinction is the whole point.
// This endpoint has no session, so it queries as `anon` - and migration 095 revoked
// every anon privilege in `public`. The probe therefore now *always* comes back
// `42501 permission denied`, and the original `checks.database = !error` reported the
// production database as down from the moment 095 landed, while it was in fact
// perfectly healthy. A monitor that is permanently red is worse than no monitor: it
// cannot tell you about the outage it exists to catch.
//
// PostgREST can only produce 42501 by asking Postgres and being refused, so receiving
// it proves the exact thing this endpoint is for: the process reached PostgREST and
// PostgREST reached the database. A genuine outage looks different - a fetch failure,
// a timeout, or a 5xx with no Postgres error code - and still reports unhealthy.
export const dynamic = 'force-dynamic'

/** Postgres "insufficient privilege". Proof of reachability, not of a problem. */
const PERMISSION_DENIED = '42501'

export async function GET() {
  const checks: Record<string, boolean> = {}

  try {
    const supabase = await createClient()
    const { error } = await supabase.from('companies').select('id').limit(1)
    checks.database = !error || error.code === PERMISSION_DENIED
  } catch {
    checks.database = false
  }

  const ok = Object.values(checks).every(Boolean)
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', checks, time: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  )
}
