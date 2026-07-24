#!/usr/bin/env node
// Cross-tenant isolation harness — Phase 0 safety net.
//
// Signs in as two independent users and reports what each can see THROUGH RLS (using the
// anon key + a real session, exactly like the app), then tears the test users down.
//
// TODAY (pre-Phase-1) both users see the same global pool — read policies are literally
// `USING (auth.uid() IS NOT NULL)`. That is the single-tenant behaviour the rebuild removes.
// This script establishes that baseline now and becomes the pass/fail gate in Phase 1:
// once each user belongs to a different org, each must see ZERO of the other's rows.
//
// Non-destructive: it creates two throwaway users and deletes them in `finally`. It never
// touches existing data. Run: pnpm check:isolation  (loads .env.local)

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anon || !service) {
  console.error('missing env: need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

// Allowlist guard: this harness creates AND deletes users, so it must only ever run
// against the dev sandbox. Aborts before any Supabase call if pointed elsewhere.
assertDevDatabase()

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })

const stamp = Date.now()
const USERS = {
  A: { email: `iso-test-a+${stamp}@example.com`, password: `Iso-${stamp}-A-x9!` },
  B: { email: `iso-test-b+${stamp}@example.com`, password: `Iso-${stamp}-B-x9!` },
}
const TABLES = ['tasks', 'boards', 'profiles', 'task_statuses', 'tags']

async function createUser(u) {
  const { data, error } = await admin.auth.admin.createUser({ email: u.email, password: u.password, email_confirm: true })
  if (error) throw new Error(`createUser ${u.email}: ${error.message}`)
  return data.user.id
}

async function sessionFor(u) {
  const c = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await c.auth.signInWithPassword({ email: u.email, password: u.password })
  if (error) throw new Error(`signIn ${u.email}: ${error.message}`)
  return c
}

async function visibleCounts(client) {
  const out = {}
  for (const t of TABLES) {
    const { count, error } = await client.from(t).select('*', { count: 'exact', head: true })
    out[t] = error ? `err:${error.code || error.message}` : count
  }
  return out
}

let aId, bId
try {
  aId = await createUser(USERS.A)
  bId = await createUser(USERS.B)
  const [ca, cb] = [await sessionFor(USERS.A), await sessionFor(USERS.B)]
  const seenByA = await visibleCounts(ca)
  const seenByB = await visibleCounts(cb)

  console.log('user A sees:', seenByA)
  console.log('user B sees:', seenByB)

  const sharedGlobal = TABLES.filter(
    (t) => typeof seenByA[t] === 'number' && seenByA[t] > 0 && seenByA[t] === seenByB[t],
  )
  console.log('')
  if (sharedGlobal.length) {
    console.log(`BASELINE = SINGLE-TENANT: both users see the same rows in [${sharedGlobal.join(', ')}].`)
    console.log('This is expected until Phase 1. When org isolation lands, flip this script to assert')
    console.log('each user sees 0 of the other org\'s rows — that assertion is the tenancy gate.')
  } else {
    console.log('users already see disjoint/zero rows — verify this is intended before Phase 1.')
  }
} catch (e) {
  console.error('isolation harness error:', e.message)
  process.exitCode = 1
} finally {
  if (aId) await admin.auth.admin.deleteUser(aId).catch(() => {})
  if (bId) await admin.auth.admin.deleteUser(bId).catch(() => {})
  console.log('cleaned up test users.')
}
