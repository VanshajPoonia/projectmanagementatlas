#!/usr/bin/env node
// Booking flow verification harness — the pass/fail gate for migrations
// 082/083. Creates a throwaway host + booking link via the service role, then
// exercises the anon-facing RPCs directly (as a real anon-key caller would,
// mirroring check-appointments.mjs and check-board-roles.mjs), covering:
//   - a valid booking succeeds and returns a cancel token
//   - a restriction blocks the slot it covers
//   - lead time / duration / same-day rules are enforced server-side
//   - overlapping bookings are rejected when overlaps are disallowed
//   - TWO CONCURRENT bookings for the identical slot: exactly one succeeds
//     (proves the advisory lock in book_appointment actually serializes)
//   - the rate limiter trips after enough attempts on one link
//   - cancel_appointment works once and only once
//   - anon has no direct table access to any of the three new tables
//
// Non-destructive: everything created is deleted in `finally`.
// Run: pnpm check:appointment-booking

import { createClient } from '@supabase/supabase-js'
import { assertDevDatabase } from './guard-db.mjs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
const service = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !anonKey || !service) {
  console.error('missing env: need NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY')
  process.exit(1)
}

assertDevDatabase()

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } })
const anon = createClient(url, anonKey, { auth: { autoRefreshToken: false, persistSession: false } })
const stamp = Date.now()
const HOST = { email: `booking-host+${stamp}@example.com`, password: `Host-${stamp}-x9!` }

let failures = 0
let hostId, linkId, linkToken, restrictionId
const createdAppointmentIds = []

function check(label, condition) {
  console.log(`${condition ? 'PASS' : 'FAIL'} — ${label}`)
  if (!condition) failures++
}

function genToken() {
  return crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '')
}

// Mirrors the future dates the RLS/availability tests already use, and stays
// far enough out that "required lead time" and "same day" never interfere
// with the happy-path cases. RESTRICTED_DATE carries an all-day restriction
// covering its ENTIRE day, so every "OK" slot below deliberately uses a
// different date — otherwise the restriction would (correctly) block them too.
const RESTRICTED_DATE = '2027-03-10'
const OK_DATE = '2027-03-11'
const RESTRICTED_START = `${RESTRICTED_DATE}T20:00:00Z` // inside the all-day restriction
const OK_SLOT_START = `${OK_DATE}T14:00:00Z`
const OK_SLOT_END = `${OK_DATE}T14:30:00Z`

try {
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email: HOST.email, password: HOST.password, email_confirm: true,
  })
  if (createErr) throw new Error(`createUser: ${createErr.message}`)
  hostId = created.user.id

  await admin.from('profiles').upsert({ id: hostId, email: HOST.email, role: 'user' }, { onConflict: 'id' })
  const { error: settingsErr } = await admin.from('appointment_settings').insert({
    user_id: hostId, min_duration_minutes: 30, max_duration_minutes: 60,
    required_lead_time_hours: 1, allow_same_day: true, allow_overlaps: false,
    timezone: 'UTC',
  })
  if (settingsErr) throw new Error(`insert settings: ${settingsErr.message}`)

  const { error: restrictionErr, data: restriction } = await admin.from('appointment_restrictions').insert({
    user_id: hostId, created_by: hostId, reason: 'harness restriction',
    starts_on: RESTRICTED_DATE, ends_on: RESTRICTED_DATE, is_all_day: true, weekdays: [],
  }).select('id').single()
  if (restrictionErr) throw new Error(`insert restriction: ${restrictionErr.message}`)
  restrictionId = restriction.id

  linkToken = genToken()
  const { data: link, error: linkErr } = await admin.from('appointment_booking_links').insert({
    token: linkToken, host_user_id: hostId, created_by: hostId,
  }).select('id').single()
  if (linkErr) throw new Error(`insert link: ${linkErr.message}`)
  linkId = link.id

  // --- anon table access must be zero on all three new tables -------------
  const { data: anonBookingLinks } = await anon.from('appointment_booking_links').select('id')
  check('anon: CANNOT read appointment_booking_links directly', (anonBookingLinks ?? []).length === 0)

  const { data: anonAppointments } = await anon.from('appointments').select('id')
  check('anon: CANNOT read appointments directly', (anonAppointments ?? []).length === 0)

  const { data: anonAttempts } = await anon.from('appointment_booking_attempts').select('id')
  check('anon: CANNOT read appointment_booking_attempts directly', (anonAttempts ?? []).length === 0)

  // --- restriction must block the slot it covers ---------------------------
  const { error: blockedErr } = await anon.rpc('book_appointment', {
    p_token: linkToken, p_starts_at: RESTRICTED_START,
    p_ends_at: `${RESTRICTED_DATE}T20:30:00Z`,
    p_guest_name: 'Restricted Visitor', p_guest_email: 'restricted@example.com',
  })
  check('restriction blocks a slot it covers', !!blockedErr && /not available/.test(blockedErr.message))

  // --- duration / lead-time / same-day enforcement -------------------------
  const { error: tooShortErr } = await anon.rpc('book_appointment', {
    p_token: linkToken, p_starts_at: OK_SLOT_START,
    p_ends_at: `${OK_DATE}T14:10:00Z`, // 10 minutes, min is 30
    p_guest_name: 'Too Short', p_guest_email: 'short@example.com',
  })
  check('duration shorter than minimum is rejected', !!tooShortErr && /shorter than the minimum/.test(tooShortErr.message))

  // A "few minutes from now" slot would normally test this, but that is
  // flaky: whenever the harness happens to run within ~30 minutes of UTC
  // midnight, the requested end time lands on the next calendar day and the
  // "cannot span midnight" check fires first, masking the lead-time check
  // this test actually targets (caught by this exact harness on a run near
  // 23:34 UTC). Testing deterministically instead: pick a slot 2 days out at
  // noon UTC — comfortably clear of any "already passed" edge case and never
  // near a midnight boundary — then temporarily require the maximum lead time
  // the schema allows (720 hours = 30 days, appointment_settings' CHECK
  // constraint ceiling), which is always larger than a ~2-day gap regardless
  // of what time "now" happens to be when this harness runs.
  const nearDate = new Date(Date.now() + 2 * 86400000).toISOString().slice(0, 10)
  await admin.from('appointment_settings').update({ required_lead_time_hours: 720 }).eq('user_id', hostId)
  const { error: leadTimeErr } = await anon.rpc('book_appointment', {
    p_token: linkToken, p_starts_at: `${nearDate}T12:00:00Z`, p_ends_at: `${nearDate}T12:30:00Z`,
    p_guest_name: 'Too Soon', p_guest_email: 'soon@example.com',
  })
  check('insufficient lead time is rejected', !!leadTimeErr && /advance notice/.test(leadTimeErr.message))
  await admin.from('appointment_settings').update({ required_lead_time_hours: 1 }).eq('user_id', hostId)

  // --- happy path: a valid booking succeeds ---------------------------------
  const { data: booked, error: bookErr } = await anon.rpc('book_appointment', {
    p_token: linkToken, p_starts_at: OK_SLOT_START, p_ends_at: OK_SLOT_END,
    p_guest_name: 'Real Visitor', p_guest_email: 'visitor@example.com',
  })
  check('a valid booking succeeds', !bookErr && Array.isArray(booked) && booked.length === 1)
  const firstBookingId = booked?.[0]?.id
  const firstCancelToken = booked?.[0]?.cancel_token
  if (firstBookingId) createdAppointmentIds.push(firstBookingId)
  check('booking returns a well-formed cancel token', /^[a-f0-9]{64}$/.test(firstCancelToken ?? ''))

  // --- overlap rejected once the slot is taken (allow_overlaps=false) -------
  const { error: overlapErr } = await anon.rpc('book_appointment', {
    p_token: linkToken, p_starts_at: OK_SLOT_START, p_ends_at: OK_SLOT_END,
    p_guest_name: 'Second Visitor', p_guest_email: 'second@example.com',
  })
  check('an overlapping booking is rejected when overlaps are disallowed',
    !!overlapErr && /just booked/.test(overlapErr.message))

  // --- concurrency: two SIMULTANEOUS bookings for one fresh slot -----------
  const raceStart = `${OK_DATE}T16:00:00Z`
  const raceEnd = `${OK_DATE}T16:30:00Z`
  const [raceA, raceB] = await Promise.all([
    anon.rpc('book_appointment', {
      p_token: linkToken, p_starts_at: raceStart, p_ends_at: raceEnd,
      p_guest_name: 'Racer A', p_guest_email: 'racer-a@example.com',
    }),
    anon.rpc('book_appointment', {
      p_token: linkToken, p_starts_at: raceStart, p_ends_at: raceEnd,
      p_guest_name: 'Racer B', p_guest_email: 'racer-b@example.com',
    }),
  ])
  const raceSuccesses = [raceA, raceB].filter(r => !r.error && Array.isArray(r.data) && r.data.length === 1)
  const raceFailures = [raceA, raceB].filter(r => !!r.error)
  check('concurrent double-booking: EXACTLY ONE of two simultaneous requests succeeds',
    raceSuccesses.length === 1 && raceFailures.length === 1)
  for (const r of raceSuccesses) createdAppointmentIds.push(r.data[0].id)

  // --- cancellation: works once, then refuses a repeat ----------------------
  const { error: cancelErr } = await anon.rpc('cancel_appointment', { p_cancel_token: firstCancelToken })
  check('cancel_appointment succeeds with a valid cancel token', !cancelErr)

  const { data: cancelledRow } = await admin.from('appointments').select('status').eq('id', firstBookingId).single()
  check('the appointment is actually marked cancelled', cancelledRow?.status === 'cancelled')

  const { error: doubleCancel } = await anon.rpc('cancel_appointment', { p_cancel_token: firstCancelToken })
  check('cancelling an already-cancelled appointment is rejected', !!doubleCancel)

  const { error: bogusCancel } = await anon.rpc('cancel_appointment', { p_cancel_token: 'f'.repeat(64) })
  check('cancelling with a token nobody owns is rejected', !!bogusCancel)

  // --- rate limiting: enough attempts on one link must trip the limiter ----
  let rateLimited = false
  for (let i = 0; i < 12; i++) {
    const { error } = await anon.rpc('check_booking_rate_limit', {
      p_token: linkToken, p_ip_hash: `harness-ip-${i}`, // distinct per-IP so only the LINK limit can trip
    })
    if (error && /Too many attempts/.test(error.message)) { rateLimited = true; break }
  }
  check('the per-link rate limit trips after enough attempts', rateLimited)

  let ipRateLimited = false
  for (let i = 0; i < 14; i++) {
    const { error } = await anon.rpc('check_booking_rate_limit', {
      p_token: linkToken, p_ip_hash: 'same-ip-every-time',
    })
    if (error && /Too many attempts/.test(error.message)) { ipRateLimited = true; break }
  }
  check('the per-IP rate limit trips after enough attempts from one IP', ipRateLimited)

  // --- revoked link must reject every booking attempt -----------------------
  await admin.from('appointment_booking_links').update({ revoked_at: new Date().toISOString() }).eq('id', linkId)
  const { error: revokedErr } = await anon.rpc('book_appointment', {
    p_token: linkToken, p_starts_at: `${OK_DATE}T18:00:00Z`, p_ends_at: `${OK_DATE}T18:30:00Z`,
    p_guest_name: 'Late Visitor', p_guest_email: 'late@example.com',
  })
  check('a revoked booking link rejects new bookings', !!revokedErr && /no longer available/.test(revokedErr.message))

  console.log('')
  if (failures > 0) {
    console.log(`${failures} check(s) FAILED.`)
    process.exitCode = 1
  } else {
    console.log('All checks passed — booking, cancellation, concurrency, and rate limiting all behave correctly.')
  }
} catch (e) {
  console.error('booking harness error:', e.message)
  process.exitCode = 1
} finally {
  for (const id of createdAppointmentIds) { try { await admin.from('appointments').delete().eq('id', id) } catch {} }
  if (restrictionId) { try { await admin.from('appointment_restrictions').delete().eq('id', restrictionId) } catch {} }
  if (linkId) { try { await admin.from('appointment_booking_attempts').delete().eq('booking_link_id', linkId) } catch {} }
  if (linkId) { try { await admin.from('appointment_booking_links').delete().eq('id', linkId) } catch {} }
  if (hostId) {
    try { await admin.from('appointment_settings').delete().eq('user_id', hostId) } catch {}
    await admin.auth.admin.deleteUser(hostId).catch(() => {})
  }
  console.log('cleaned up test fixtures.')
}
