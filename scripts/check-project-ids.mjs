#!/usr/bin/env node
// Write gate for the Project ID ledger (migration 090).
//
// The promise this feature makes is narrow and absolute: a project number, once grabbed, can
// never be used again, and the record of who grabbed it is not something the grabber chooses.
// Everything below exists to prove that against real RLS rather than against the client code
// that happens to call it.
//
// The one that matters most is the concurrency check: allocating "the next number" is a
// read-then-write, so without the advisory lock in claim_project_id() two people clicking Grab
// at the same instant both read the same MAX(seq). That is exactly the bug a UI test cannot
// catch and a unique index only converts into a crash for whoever loses.
//
// Every row this harness claims is deleted in finally (via the service role, which is the only
// thing that can delete from this table at all) so a run leaves the sandbox as it found it.

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anon || !service) {
  console.error('missing Supabase environment variables')
  process.exit(1)
}

assertDevDatabase()

const admin = createClient(url, service, {
  auth: { autoRefreshToken: false, persistSession: false },
})
const stamp = Date.now()

const ownerCredentials = { email: `project-id-owner+${stamp}@example.com`, password: `Pid-${stamp}-oO!` }
const otherCredentials = { email: `project-id-other+${stamp}@example.com`, password: `Pid-${stamp}-tT!` }
const adminCredentials = { email: `project-id-admin+${stamp}@example.com`, password: `Pid-${stamp}-aA!` }

const claimedIds = []
let failures = 0

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`)
  if (!condition) failures++
}

async function createTestUser(credentials, role = 'user', fullName = null) {
  const { data, error } = await admin.auth.admin.createUser({ ...credentials, email_confirm: true })
  if (error) throw new Error(`createUser: ${error.message}`)
  const { error: profileError } = await admin.from('profiles').upsert({
    id: data.user.id,
    email: credentials.email,
    full_name: fullName,
    role,
  }, { onConflict: 'id' })
  if (profileError) throw new Error(`upsert profile: ${profileError.message}`)
  return data.user.id
}

async function signIn(credentials) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword(credentials)
  if (error) throw new Error(`sign-in ${credentials.email}: ${error.message}`)
  return client
}

// The prefix the function should be producing — Central time, not this machine's zone and not
// UTC, so a run at 11pm CT on the last of the month still agrees with the database.
function centralYearMonth() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago', year: '2-digit', month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find(p => p.type === 'year').value
  const month = parts.find(p => p.type === 'month').value
  return `${year}${month}`
}

async function claim(client, clientName, companyId = null) {
  const { data, error } = await client.rpc('claim_project_id', {
    p_client_name: clientName,
    p_company_id: companyId,
  })
  if (data?.id) claimedIds.push(data.id)
  return { data, error }
}

try {
  const ownerId = await createTestUser(ownerCredentials, 'user', 'Ledger Owner')
  await createTestUser(otherCredentials, 'user', 'Someone Else')
  await createTestUser(adminCredentials, 'admin', 'Real Admin')

  const owner = await signIn(ownerCredentials)
  const other = await signIn(otherCredentials)
  const adminUser = await signIn(adminCredentials)

  const expectedPrefix = centralYearMonth()

  /* ── 1. a plain user can claim, and the claim records itself ─────── */
  const { data: first, error: firstError } = await claim(owner, 'Acme Roofing')
  check('a plain signed-in user can grab a project ID', !firstError && Boolean(first?.project_id))
  check('the ID is YYMM + a 4-digit sequence', /^\d{8}$/.test(first?.project_id ?? ''))
  check('the prefix is the current Central-time month', first?.project_id?.startsWith(expectedPrefix))
  check('the sequence starts at or above 1111', (first?.seq ?? 0) >= 1111)
  check('the client name is stored for cross-reference', first?.client_name === 'Acme Roofing')

  /* ── 2. the claimer is taken from the session, not supplied ──────── */
  check('grabbed_by is the calling user', first?.grabbed_by === ownerId)
  check('the claimer\'s name is snapshotted onto the row', first?.grabbed_by_name === 'Ledger Owner')
  check('the claim is timestamped', Boolean(first?.grabbed_at))

  // There is no parameter to claim on someone else's behalf — passing one finds no overload.
  const { error: spoofError } = await owner.rpc('claim_project_id', {
    p_client_name: 'Spoofed', p_company_id: null, p_grabbed_by: ownerId,
  })
  check('there is no way to claim a number under another person\'s name', Boolean(spoofError))

  /* ── 3. a number is never handed out twice ───────────────────────── */
  const { data: second } = await claim(owner, 'Second Client')
  check('the next claim is a different number', second?.project_id !== first?.project_id)
  check('the sequence advances by one', second?.seq === first?.seq + 1)

  // The real test: simultaneous claims from two different sessions. Without the advisory lock
  // these collide on MAX(seq) and either duplicate or blow up on the unique index.
  const raceSize = 8
  const racers = Array.from({ length: raceSize }, (_, i) =>
    claim(i % 2 === 0 ? owner : other, `Race client ${i}`))
  const raceResults = await Promise.all(racers)
  const raceErrors = raceResults.filter(r => r.error)
  const raceNumbers = raceResults.map(r => r.data?.project_id).filter(Boolean)
  check(`${raceSize} simultaneous claims all succeeded`, raceErrors.length === 0)
  check('every simultaneous claim got a distinct number', new Set(raceNumbers).size === raceSize)

  const { data: allRows } = await admin
    .from('project_ids').select('project_id').in('id', claimedIds)
  check('no duplicate landed in the ledger', new Set(allRows.map(r => r.project_id)).size === allRows.length)

  /* ── 4. a claim without a client name is refused ─────────────────── */
  const { error: emptyError } = await claim(owner, '   ')
  check('a blank client name is rejected', Boolean(emptyError))
  const { error: nullError } = await claim(owner, null)
  check('a missing client name is rejected', Boolean(nullError))

  /* ── 5. the RPC is the only way in ───────────────────────────────── */
  const { error: insertError } = await owner.from('project_ids').insert({
    project_id: `${expectedPrefix}9998`, year_month: expectedPrefix, seq: 9998,
    client_name: 'Hand-inserted', grabbed_by_name: 'Hand-inserted',
  })
  check('a user cannot insert straight into the ledger', Boolean(insertError))

  /* ── 6. a claimed number is permanent ────────────────────────────── */
  const victim = first.id
  for (const [who, client] of [['plain user', owner], ['admin', adminUser]]) {
    await client.from('project_ids').delete().eq('id', victim)
    const { data: stillThere } = await admin
      .from('project_ids').select('project_id').eq('id', victim).maybeSingle()
    check(`a ${who} cannot delete a used project ID`, stillThere?.project_id === first.project_id)
  }

  // The number itself, its claimer and its timestamp are not rewritable by anyone — the column
  // grant stops it before any policy is consulted.
  for (const [column, value] of [
    ['project_id', `${expectedPrefix}1000`],
    ['grabbed_by', null],
    ['grabbed_at', new Date(0).toISOString()],
  ]) {
    const { error } = await owner.from('project_ids').update({ [column]: value }).eq('id', victim)
    check(`even the claimer cannot rewrite ${column}`, Boolean(error))
  }
  const { data: untouched } = await admin
    .from('project_ids').select('project_id,grabbed_by,grabbed_at').eq('id', victim).maybeSingle()
  check('the number, claimer and timestamp survived every rewrite attempt',
    untouched?.project_id === first.project_id && untouched?.grabbed_by === ownerId)

  /* ── 7. the cross-reference stays correctable ────────────────────── */
  await owner.from('project_ids').update({ client_name: 'Acme Roofing LLC' }).eq('id', victim)
  const { data: corrected } = await admin
    .from('project_ids').select('client_name').eq('id', victim).maybeSingle()
  check('the claimer can fix a typo in the client name', corrected?.client_name === 'Acme Roofing LLC')

  await other.from('project_ids').update({ client_name: 'Hijacked' }).eq('id', victim)
  const { data: notHijacked } = await admin
    .from('project_ids').select('client_name').eq('id', victim).maybeSingle()
  check('an unrelated user cannot edit someone else\'s entry', notHijacked?.client_name === 'Acme Roofing LLC')

  await adminUser.from('project_ids').update({ client_name: 'Acme Roofing Inc' }).eq('id', victim)
  const { data: adminFixed } = await admin
    .from('project_ids').select('client_name').eq('id', victim).maybeSingle()
  check('an admin can fix anyone\'s entry', adminFixed?.client_name === 'Acme Roofing Inc')

  /* ── 8. the ledger is a shared reference ─────────────────────────── */
  const { data: seenByOther } = await other
    .from('project_ids').select('project_id').eq('id', victim).maybeSingle()
  check('everyone signed in can look up anyone\'s project number', seenByOther?.project_id === first.project_id)

  /* ── 9. signed out is not a caller ───────────────────────────────── */
  const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: anonClaimError } = await anonClient
    .rpc('claim_project_id', { p_client_name: 'Anon', p_company_id: null })
  check('an unauthenticated caller cannot grab a number', Boolean(anonClaimError))
  const { data: anonRead } = await anonClient.from('project_ids').select('project_id')
  check('an unauthenticated caller cannot read the ledger', !anonRead || anonRead.length === 0)

  /* ── 10. the module is registered so it can be switched off ──────── */
  const { data: moduleRow } = await owner
    .from('app_modules').select('module_key,enabled').eq('module_key', 'project_ids').maybeSingle()
  check('the project_ids module is registered and on', moduleRow?.enabled === true)
} finally {
  for (const id of claimedIds) {
    await admin.from('project_ids').delete().eq('id', id)
  }
  for (const credentials of [ownerCredentials, otherCredentials, adminCredentials]) {
    const { data } = await admin.auth.admin.listUsers()
    const user = data?.users?.find(u => u.email === credentials.email)
    if (user) await admin.auth.admin.deleteUser(user.id)
  }
}

console.log(failures === 0 ? '\nall checks passed' : `\n${failures} check(s) failed`)
process.exit(failures === 0 ? 0 : 1)
