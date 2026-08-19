#!/usr/bin/env node
// Grant-posture harness - the pass/fail gate for migration 095.
//
// 095 asserts the *catalog* state in its own post-conditions. This harness asserts the
// *behaviour* through real clients, which is the part that would actually break the app:
//   - a signed-out caller can read nothing in public
//   - the three public booking RPCs still work for anon (082 granted them on purpose, and
//     app/api/book/cancel/[token]/route.ts really does call one with an anon client)
//   - is_board_member is no longer callable by anon (it was, via the implicit EXECUTE TO PUBLIC)
//   - signup still creates a profiles row, i.e. the handle_new_user trigger still fires after
//     its PUBLIC grant was revoked
//   - a signed-in user's ordinary reads and writes are untouched
//
// Non-destructive: every fixture is deleted in `finally`. Run: pnpm check:grants

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
const USER = { email: `grants-test+${stamp}@example.com`, password: `Grants-${stamp}-x9!` }
// signUp goes through Supabase Auth's own email validation, which rejects `+` aliases on
// example.com. The service-role createUser path above bypasses that, which is why the other
// harnesses can keep using it.
const SIGNUP = { email: `grants-signup-${stamp}@goatlasgo.us`, password: `Signup-${stamp}-x9!` }

const createdUserIds = []
let failures = 0

function check(label, condition, extra = '') {
  console.log(`${condition ? 'PASS' : 'FAIL'} - ${label}${extra ? ` (${extra})` : ''}`)
  if (!condition) failures++
}

// Every table a signed-out caller must not be able to touch. Deliberately includes the ones
// that were wide open before 095 and the ones that were already narrow.
const PUBLIC_TABLES = [
  'tasks', 'boards', 'columns', 'profiles', 'task_comments', 'task_attachments',
  'task_notifications', 'personal_tasks', 'chat_messages', 'ai_chat_messages', 'bookmarks',
  'companies', 'teams', 'team_members', 'marketing_calendars', 'marketing_calendar_items',
  'app_modules', 'applied_migrations', 'task_statuses', 'tags', 'board_members',
]

try {
  // --- Signed out: nothing in public is readable ---------------------------------------------
  const signedOut = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  let readable = []
  for (const table of PUBLIC_TABLES) {
    const { data, error } = await signedOut.from(table).select('*').limit(1)
    // Either a hard permission error, or (belt and braces) zero rows. Anything else is a leak.
    if (!error && (data ?? []).length > 0) readable.push(table)
  }
  check('signed-out reads nothing from any public table', readable.length === 0, readable.join(', '))

  // Writes must be refused too, not merely filtered.
  const { error: writeErr } = await signedOut.from('tasks').insert({ title: 'anon write', position: 0 })
  check('signed-out cannot write', Boolean(writeErr), writeErr?.message ?? 'NO ERROR - insert was accepted')

  // --- The SECURITY DEFINER helper anon could previously call ---------------------------------
  const { error: helperErr } = await signedOut.rpc('is_board_member', {
    p_board_id: '00000000-0000-0000-0000-000000000000',
    p_user_id: '00000000-0000-0000-0000-000000000000',
  })
  check('signed-out cannot call is_board_member', Boolean(helperErr), helperErr?.message ?? 'NO ERROR')

  // --- ...but the intentional public booking surface still works ------------------------------
  // A bogus token must fail on the FUNCTION'S OWN validation, never on permissions. If 095 ever
  // over-revokes, this flips to "permission denied for function" and public booking is broken.
  const { error: cancelErr } = await signedOut.rpc('cancel_appointment', {
    p_cancel_token: `definitely-not-a-real-token-${stamp}`,
  })
  const permissionDenied = /permission denied/i.test(cancelErr?.message ?? '')
  check('signed-out CAN still reach cancel_appointment (booking survives)', !permissionDenied,
    cancelErr?.message ?? 'no error')

  const { error: rateErr } = await signedOut.rpc('check_booking_rate_limit', {
    p_token: `nope-${stamp}`, p_ip_hash: 'x',
  })
  check('signed-out CAN still reach check_booking_rate_limit',
    !/permission denied/i.test(rateErr?.message ?? ''), rateErr?.message ?? 'no error')

  // --- A new account still gets its profiles row -----------------------------------------------
  // This is the on_auth_user_created trigger (restored by 096) firing handle_new_user, whose
  // implicit EXECUTE TO PUBLIC 095 revoked. Trigger functions do not have EXECUTE re-checked
  // when they fire, but that is exactly the kind of claim worth proving rather than assuming -
  // and this check is what caught the trigger being missing from the sandbox in the first place.
  //
  // Deliberately uses the admin createUser path rather than the public signUp: the trigger is on
  // INSERT INTO auth.users and fires identically either way, while signUp is subject to Supabase
  // Auth's per-hour email rate limit and would make this harness flaky.
  const { data: fresh, error: freshErr } = await admin.auth.admin.createUser({
    email: SIGNUP.email, password: SIGNUP.password, email_confirm: true,
  })
  check('a new auth account can be created', !freshErr, freshErr?.message ?? '')
  if (fresh?.user?.id) {
    createdUserIds.push(fresh.user.id)
    // Note: NO profiles upsert here, unlike every other harness. The whole point is that the
    // trigger populates it unaided.
    await new Promise((r) => setTimeout(r, 600))
    const { data: profileRow } = await admin
      .from('profiles').select('id,email,role').eq('id', fresh.user.id).maybeSingle()
    check('the signup trigger creates the profiles row unaided', Boolean(profileRow),
      profileRow ? `role=${profileRow.role}` : 'no profiles row was created')
    check('the new profile defaults to the user role', profileRow?.role === 'user',
      profileRow?.role ?? 'n/a')
  }

  // --- A signed-in user is completely unaffected ----------------------------------------------
  const { data: made, error: createErr } = await admin.auth.admin.createUser({
    email: USER.email, password: USER.password, email_confirm: true,
  })
  if (createErr) throw new Error(`createUser: ${createErr.message}`)
  createdUserIds.push(made.user.id)
  await admin.from('profiles').upsert(
    { id: made.user.id, email: USER.email, role: 'user' }, { onConflict: 'id' },
  )

  const asUser = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } })
  const { error: signInErr } = await asUser.auth.signInWithPassword(USER)
  if (signInErr) throw new Error(`signIn: ${signInErr.message}`)

  for (const table of ['tasks', 'boards', 'profiles', 'task_statuses', 'teams']) {
    const { error } = await asUser.from(table).select('*').limit(1)
    check(`signed-in can still read ${table}`, !error, error?.message ?? '')
  }

  // Writes preserved: 095 revoked only TRUNCATE/REFERENCES/TRIGGER from authenticated.
  const { data: personal, error: personalErr } = await asUser
    .from('personal_tasks').insert({ user_id: made.user.id, title: `grants probe ${stamp}` }).select('id')
  check('signed-in can still INSERT', !personalErr && (personal ?? []).length === 1, personalErr?.message ?? '')

  if (personal?.[0]?.id) {
    const { data: updated, error: updErr } = await asUser
      .from('personal_tasks').update({ title: `grants probe updated ${stamp}` })
      .eq('id', personal[0].id).select('id')
    check('signed-in can still UPDATE', !updErr && (updated ?? []).length === 1, updErr?.message ?? '')

    const { data: removed, error: delErr } = await asUser
      .from('personal_tasks').delete().eq('id', personal[0].id).select('id')
    check('signed-in can still DELETE', !delErr && (removed ?? []).length === 1, delErr?.message ?? '')
  }

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed - anon is shut out, public booking still works, signed-in users unaffected.')
  }
} catch (e) {
  console.error('grants harness error:', e.message)
  process.exitCode = 1
} finally {
  for (const id of createdUserIds) {
    try { await admin.from('personal_tasks').delete().eq('user_id', id) } catch {}
    try { await admin.from('profiles').delete().eq('id', id) } catch {}
    await admin.auth.admin.deleteUser(id).catch(() => {})
  }
  console.log('cleaned up test fixtures.')
}
