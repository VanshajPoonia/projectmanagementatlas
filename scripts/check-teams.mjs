#!/usr/bin/env node
// Teams access-control harness — the pass/fail gate for migration 094.
//
// 094 narrows team management from is_admin_user() (admin + super_admin) to
// is_super_admin_user(). That narrowing is the whole point, so the harness proves all three
// tiers at once through REAL anon-key sessions (exactly like the app):
//   - plain user   : reads teams/memberships, changes nothing
//   - admin        : reads, still changes nothing  <- the control case for the narrowing
//   - super_admin  : creates a team, adds, MOVES and removes members
//   - signed-out   : sees nothing at all (094 revoked anon's blanket grant)
//
// Non-destructive: every fixture it creates is deleted in `finally`. Run: pnpm check:teams

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anon || !service) {
  console.error('missing env: need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

assertDevDatabase()

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()

// One throwaway account per platform role, plus a subject to be moved between teams.
const ACCOUNTS = {
  user: { email: `team-user+${stamp}@example.com`, password: `Team-${stamp}-u9!`, role: 'user' },
  admin: { email: `team-admin+${stamp}@example.com`, password: `Team-${stamp}-a9!`, role: 'admin' },
  super: { email: `team-super+${stamp}@example.com`, password: `Team-${stamp}-s9!`, role: 'super_admin' },
  subject: { email: `team-subject+${stamp}@example.com`, password: `Team-${stamp}-x9!`, role: 'user' },
}

const createdUserIds = []
const createdTeamIds = []
let failures = 0

function check(label, condition, extra = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}${extra ? ` (${extra})` : ''}`)
  if (!condition) failures++
}

async function makeUser({ email, password, role }) {
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true })
  if (error) throw new Error(`createUser ${email}: ${error.message}`)
  const id = data.user.id
  createdUserIds.push(id)
  const { error: pErr } = await admin.from('profiles').upsert({ id, email, role }, { onConflict: 'id' })
  if (pErr) throw new Error(`upsert profile ${email}: ${pErr.message}`)
  return id
}

async function sessionFor({ email, password }) {
  const client = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error } = await client.auth.signInWithPassword({ email, password })
  if (error) throw new Error(`signIn ${email}: ${error.message}`)
  return client
}

try {
  const ids = {
    user: await makeUser(ACCOUNTS.user),
    admin: await makeUser(ACCOUNTS.admin),
    super: await makeUser(ACCOUNTS.super),
    subject: await makeUser(ACCOUNTS.subject),
  }

  // Two throwaway teams so "move a member between teams" is exercised against real policies
  // instead of against the seeded business units.
  const { data: teams, error: teamErr } = await admin
    .from('teams')
    .insert([
      { name: `harness-team-a-${stamp}`, position: 90 },
      { name: `harness-team-b-${stamp}`, position: 91 },
    ])
    .select('id,name')
  if (teamErr) throw new Error(`create teams: ${teamErr.message}`)
  const teamA = teams.find((t) => t.name.includes('-a-'))
  const teamB = teams.find((t) => t.name.includes('-b-'))
  createdTeamIds.push(teamA.id, teamB.id)

  await admin.from('team_members').insert({ team_id: teamA.id, user_id: ids.subject })

  const asUser = await sessionFor(ACCOUNTS.user)
  const asAdmin = await sessionFor(ACCOUNTS.admin)
  const asSuper = await sessionFor(ACCOUNTS.super)

  // --- Read access: everyone signed in can see the org chart -------------------------------
  for (const [label, client] of [['user', asUser], ['admin', asAdmin], ['super_admin', asSuper]]) {
    const { data: seenTeams } = await client.from('teams').select('id').eq('id', teamA.id)
    check(`${label}: can read teams`, (seenTeams ?? []).length === 1)
    const { data: seenMembers } = await client
      .from('team_members').select('user_id').eq('team_id', teamA.id)
    check(`${label}: can read team memberships`, (seenMembers ?? []).length === 1)
  }

  // --- Non-super-admins cannot manage ------------------------------------------------------
  for (const [label, client] of [['user', asUser], ['admin', asAdmin]]) {
    const { data: made } = await client
      .from('teams').insert({ name: `sneaked-${label}-${stamp}` }).select('id')
    check(`${label}: cannot create a team`, (made ?? []).length === 0)
    if (made?.length) createdTeamIds.push(made[0].id)

    const { data: renamed } = await client
      .from('teams').update({ name: `hijacked-${label}` }).eq('id', teamA.id).select('id')
    check(`${label}: cannot rename a team`, (renamed ?? []).length === 0)

    const { data: dropped } = await client.from('teams').delete().eq('id', teamB.id).select('id')
    check(`${label}: cannot delete a team`, (dropped ?? []).length === 0)

    const { data: added } = await client
      .from('team_members').insert({ team_id: teamB.id, user_id: ids[label === 'user' ? 'user' : 'admin'] })
      .select('user_id')
    check(`${label}: cannot add a team member`, (added ?? []).length === 0)

    const { data: removed } = await client
      .from('team_members').delete().eq('team_id', teamA.id).eq('user_id', ids.subject).select('user_id')
    check(`${label}: cannot remove a team member`, (removed ?? []).length === 0)
  }

  // --- Super admin CAN manage — the capability the owner actually asked for -----------------
  const { data: superMade } = await asSuper
    .from('teams').insert({ name: `harness-team-c-${stamp}`, position: 92 }).select('id')
  check('super_admin: CAN create a team', (superMade ?? []).length === 1)
  if (superMade?.length) createdTeamIds.push(superMade[0].id)

  const { data: superRenamed } = await asSuper
    .from('teams').update({ name: `harness-team-a-renamed-${stamp}` }).eq('id', teamA.id).select('name')
  check('super_admin: CAN rename a team', superRenamed?.[0]?.name?.includes('renamed') === true)

  const { data: superAdded } = await asSuper
    .from('team_members').insert({ team_id: teamB.id, user_id: ids.user }).select('user_id')
  check('super_admin: CAN add a team member', (superAdded ?? []).length === 1)

  // A "move" is remove-from-A + add-to-B. Assert both halves land.
  const { data: movedOut } = await asSuper
    .from('team_members').delete().eq('team_id', teamA.id).eq('user_id', ids.subject).select('user_id')
  const { data: movedIn } = await asSuper
    .from('team_members').insert({ team_id: teamB.id, user_id: ids.subject }).select('user_id')
  check('super_admin: CAN move a member between teams', (movedOut ?? []).length === 1 && (movedIn ?? []).length === 1)

  const { data: stillInA } = await asSuper
    .from('team_members').select('user_id').eq('team_id', teamA.id).eq('user_id', ids.subject)
  check('move actually left the source team', (stillInA ?? []).length === 0)

  const { data: superRemoved } = await asSuper
    .from('team_members').delete().eq('team_id', teamB.id).eq('user_id', ids.user).select('user_id')
  check('super_admin: CAN remove a team member', (superRemoved ?? []).length === 1)

  // "Add everyone" sends an upsert with ignoreDuplicates so a member added between computing
  // the batch and sending it doesn't fail the whole insert. 094 grants team_members
  // SELECT/INSERT/DELETE but deliberately NOT UPDATE, so this pins that ON CONFLICT DO NOTHING
  // really does take the no-UPDATE path — if it ever needs UPDATE, the grant is wrong.
  const batch = [
    { team_id: teamA.id, user_id: ids.subject }, // already a member -> the conflicting row
    { team_id: teamA.id, user_id: ids.user },    // genuinely new
  ]
  await asSuper.from('team_members').insert({ team_id: teamA.id, user_id: ids.subject })
  const { error: upsertErr } = await asSuper
    .from('team_members').upsert(batch, { onConflict: 'team_id,user_id', ignoreDuplicates: true })
  check('super_admin: "Add everyone" upsert survives a duplicate without UPDATE rights',
    !upsertErr, upsertErr?.message ?? '')
  const { data: batched } = await asSuper
    .from('team_members').select('user_id').eq('team_id', teamA.id)
  check('the non-duplicate half of the batch landed',
    (batched ?? []).some((m) => m.user_id === ids.user))

  // --- Signed-out sees nothing (094 revoked anon's blanket grant) ---------------------------
  const signedOut = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: anonTeams } = await signedOut.from('teams').select('id')
  check('signed-out: cannot read teams', (anonTeams ?? []).length === 0)
  const { data: anonMembers } = await signedOut.from('team_members').select('user_id')
  check('signed-out: cannot read team memberships', (anonMembers ?? []).length === 0)

  // --- The seeded business units are present and hold everyone ------------------------------
  const { data: seeded } = await asUser
    .from('teams').select('id,name').in('name', ['Atlas General Contracting', 'Shanks Realty Group'])
  check('both business-unit teams exist', (seeded ?? []).length === 2,
    (seeded ?? []).map((t) => t.name).join(', '))

  // 094 backfilled every profile that existed when it ran. This harness's own throwaway
  // accounts were created afterwards and are deliberately NOT in a team — joining a team is a
  // super-admin decision, not something a signup silently performs (see `unassigned` below).
  // So the invariant to assert is "every pre-existing profile", not "every profile".
  const { data: allProfiles } = await admin.from('profiles').select('id')
  const preExisting = (allProfiles ?? []).filter((p) => !createdUserIds.includes(p.id)).map((p) => p.id)
  for (const team of seeded ?? []) {
    const { data: members } = await admin.from('team_members').select('user_id').eq('team_id', team.id)
    const memberIds = new Set((members ?? []).map((m) => m.user_id))
    const missing = preExisting.filter((id) => !memberIds.has(id))
    check(`every pre-existing profile is in "${team.name}"`, missing.length === 0,
      `${preExisting.length - missing.length}/${preExisting.length}`)
  }

  // A new account joins no team until a super admin puts it in one. That is the intended
  // behaviour, so pin it: if someone later adds an auto-join trigger, this check tells them
  // the Super Admin > Teams "Not in any team" prompt has become dead UI.
  const { data: subjectTeams } = await admin
    .from('team_members').select('team_id').eq('user_id', ids.admin)
  check('a newly created account joins no team automatically', (subjectTeams ?? []).length === 0)

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed — only super admins manage teams; everyone signed in can read them.')
  }
} catch (e) {
  console.error('teams harness error:', e.message)
  process.exitCode = 1
} finally {
  for (const id of createdTeamIds) {
    try { await admin.from('team_members').delete().eq('team_id', id) } catch {}
    try { await admin.from('teams').delete().eq('id', id) } catch {}
  }
  for (const id of createdUserIds) {
    try { await admin.from('team_members').delete().eq('user_id', id) } catch {}
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('cleaned up test fixtures.')
}
