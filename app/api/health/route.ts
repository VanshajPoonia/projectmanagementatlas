import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

// Lightweight liveness/readiness endpoint for ops + scripts/healthcheck.mjs.
// It is NOT a product feature and exposes no user data: it confirms the process is
// up and that the database is reachable through the normal session client (so RLS
// still applies — `companies` is publicly viewable, no privileged access here).
// No auth required; returns only booleans/status, never row contents.
export const dynamic = 'force-dynamic'

export async function GET() {
  const checks: Record<string, boolean> = {}

  try {
    const supabase = await createClient()
    const { error } = await supabase.from('companies').select('id').limit(1)
    checks.database = !error
  } catch {
    checks.database = false
  }

  const ok = Object.values(checks).every(Boolean)
  return NextResponse.json(
    { status: ok ? 'ok' : 'degraded', checks, time: new Date().toISOString() },
    { status: ok ? 200 : 503 }
  )
}
