#!/usr/bin/env node
// Health check for the important services this app depends on.
//
// Run:  node scripts/healthcheck.mjs      (or: pnpm dlx tsx scripts/healthcheck.mjs)
//
// This is an OPS tool, not app code — it is allowed to read .env.local and, for the
// object-storage check only, use the service-role key locally. It never runs in the
// request path. See docs/development/local-setup.md and docs/architecture/current-system.md.
//
// It honestly reports the services the audit brief asks about: DB, cache, queue,
// object storage, API health, worker health, and search. Services this architecture
// does not provision (cache / queue / dedicated search) are reported as N/A — a real
// reflection of the system, not a failure.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

// --- tiny .env.local loader (no dependency) -------------------------------------
function loadEnv() {
  const env = { ...process.env }
  for (const file of ['.env.local', '.env']) {
    try {
      const raw = readFileSync(join(ROOT, file), 'utf8')
      for (const line of raw.split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
        if (!m) continue
        let [, k, v] = m
        v = v.replace(/^["']|["']$/g, '')
        if (env[k] === undefined) env[k] = v
      }
    } catch {
      /* file may not exist; that's fine */
    }
  }
  return env
}

const env = loadEnv()
const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY
const BASE_URL = env.HEALTHCHECK_BASE_URL || 'http://localhost:3000'

const results = []
function record(name, status, detail) {
  results.push({ name, status, detail })
}
// status: 'ok' | 'fail' | 'na' | 'warn' | 'skip'

async function checkDatabase() {
  if (!SUPABASE_URL || !ANON) {
    return record('Database', 'fail', 'Missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY')
  }
  try {
    // `companies` is publicly viewable under RLS, so the anon key is enough — this
    // exercises the real session-client path, not a privileged bypass.
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/companies?select=id&limit=1`,
      { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } }
    )
    if (res.ok) return record('Database', 'ok', `Supabase REST reachable (HTTP ${res.status})`)
    return record('Database', 'fail', `Supabase REST HTTP ${res.status}`)
  } catch (e) {
    return record('Database', 'fail', String(e?.message || e))
  }
}

async function checkObjectStorage() {
  if (!SUPABASE_URL) return record('Object storage', 'fail', 'Missing NEXT_PUBLIC_SUPABASE_URL')
  if (!SERVICE) {
    return record('Object storage', 'skip', 'No SERVICE_ROLE_KEY locally — cannot list buckets (ops-only check)')
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
      headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}` },
    })
    if (!res.ok) return record('Object storage', 'fail', `Storage API HTTP ${res.status}`)
    const buckets = await res.json()
    const found = Array.isArray(buckets) && buckets.some((b) => b.id === 'chat-attachments')
    return record(
      'Object storage',
      found ? 'ok' : 'warn',
      found ? "bucket 'chat-attachments' present" : "bucket 'chat-attachments' NOT found"
    )
  } catch (e) {
    return record('Object storage', 'fail', String(e?.message || e))
  }
}

async function checkApiHealth() {
  try {
    const res = await fetch(`${BASE_URL}/api/health`, { signal: AbortSignal.timeout(4000) })
    if (res.ok) {
      const body = await res.json().catch(() => ({}))
      return record('API health', 'ok', `${BASE_URL}/api/health → ${body.status || 'ok'}`)
    }
    return record('API health', 'fail', `HTTP ${res.status} from ${BASE_URL}/api/health`)
  } catch {
    return record('API health', 'skip', `No server at ${BASE_URL} (start with \`pnpm dev\`)`)
  }
}

function checkEmail() {
  const ok = Boolean(env.RESEND_API_KEY && env.EMAIL_FROM)
  record('Email (Resend)', ok ? 'ok' : 'warn', ok ? 'RESEND_API_KEY + EMAIL_FROM set' : 'config missing (no test send)')
}

function checkAi() {
  record('AI (Gemini)', env.GEMINI_API_KEY ? 'ok' : 'warn', env.GEMINI_API_KEY ? 'GEMINI_API_KEY set' : 'GEMINI_API_KEY missing')
}

function checkNonProvisioned() {
  record('Cache', 'na', 'In-memory rate-limit only; no shared cache provisioned')
  record('Queue', 'na', 'No queue/broker in this architecture')
  record('Search', 'na', 'No dedicated search service; direct Postgres queries')
  record('Worker (reminders)', 'warn', 'checkDueDateReminders exists but is UNSCHEDULED (risk R-07)')
}

const ICON = { ok: '✅', fail: '❌', na: '➖', warn: '⚠️ ', skip: '⏭️ ' }

async function main() {
  await Promise.all([checkDatabase(), checkObjectStorage(), checkApiHealth()])
  checkEmail()
  checkAi()
  checkNonProvisioned()

  console.log('\n  Health check —', new Date().toISOString())
  console.log('  ' + '-'.repeat(72))
  for (const r of results) {
    console.log(`  ${ICON[r.status] || '  '} ${r.name.padEnd(22)} ${r.detail}`)
  }
  console.log('  ' + '-'.repeat(72))
  console.log('  ✅ ok  ⚠️ warn/config  ⏭️ skipped  ➖ N/A (not provisioned)  ❌ fail\n')

  // Exit non-zero only if a genuinely-applicable service failed.
  const failed = results.some((r) => r.status === 'fail')
  process.exit(failed ? 1 : 0)
}

main()
