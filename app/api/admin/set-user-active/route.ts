import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { REFUSAL_MESSAGES, checkDeactivation } from '@/lib/deprovision'

// Turn someone's access off, or back on.
//
// This route exists because the toggle it replaces did nothing. `profiles.is_active` was
// written by the Super Admin screen and read by absolutely nothing — no RLS policy, no
// helper, no application code. A "deactivated" person kept full access and could sign in as
// normal, while the admin who deactivated them saw a red Inactive badge.
//
// Deactivation is now the SAFE way to remove someone: it is reversible, and it keeps every
// piece of their work and its attribution intact. Deleting an account is the irreversible
// path and should be the rare one.
//
// Enforcement is deliberately layered, because no single layer covers everything:
//
//   ban      — GoTrue refuses sign-in and refresh-token exchange. The real boundary; does
//              not depend on any application code being correct.
//   is_active — migration 101 folds it into is_admin_user/is_super_admin_user/can_manage_task,
//              so elevated access dies on the very next query rather than whenever the
//              access token in their browser happens to expire.
//   proxy.ts  — signs them out on the next page load so the UI does not sit half-working.
//
// The flag is written through the service role because 101 revoked `authenticated`'s UPDATE
// on that column. Without that revoke a deactivated user could simply set it back.

/** A century. GoTrue has no "forever", and this outlives any employment. */
const BAN_FOREVER = '876000h'

export async function POST(request: Request) {
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'super_admin') {
    return NextResponse.json({ error: 'Forbidden - Super Admin only' }, { status: 403 })
  }

  if (!checkRateLimit(`set-active:${user.id}`, 20, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, please slow down.' }, { status: 429 })
  }

  const { userId, isActive } = await request.json()
  if (typeof userId !== 'string' || !userId || typeof isActive !== 'boolean') {
    return NextResponse.json({ error: 'A userId and isActive are required.' }, { status: 400 })
  }

  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  const [{ data: target }, { count: activeSuperAdmins }] = await Promise.all([
    supabaseAdmin.from('profiles').select('id, role, is_active').eq('id', userId).maybeSingle(),
    supabaseAdmin
      .from('profiles')
      .select('id', { count: 'exact', head: true })
      .eq('role', 'super_admin')
      .neq('is_active', false),
  ])

  // Same two guards as deletion. Locking yourself out, or switching off the last super
  // admin, leaves a system nobody can administer — and unlike deletion these would look
  // harmless right up until the moment nobody can log in to undo them.
  const refusal = isActive ? null : checkDeactivation(target, user.id, activeSuperAdmins ?? 0)
  if (refusal) {
    return NextResponse.json({ error: REFUSAL_MESSAGES[refusal] }, { status: 409 })
  }

  // Flag first: it is the layer that bites immediately, on the next query. If the ban below
  // fails we are left with access already narrowed rather than a ban with the flag still on.
  const { error: flagError } = await supabaseAdmin
    .from('profiles')
    .update({
      is_active: isActive,
      deactivated_at: isActive ? null : new Date().toISOString(),
      deactivated_by: isActive ? null : user.id,
    })
    .eq('id', userId)

  if (flagError) {
    return NextResponse.json({ error: flagError.message }, { status: 500 })
  }

  const { error: banError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    ban_duration: isActive ? 'none' : BAN_FOREVER,
  })

  if (banError) {
    // Report honestly rather than claiming success. The flag DID apply, so elevated access
    // is already gone; what is missing is the block on signing in again.
    return NextResponse.json(
      {
        error: isActive
          ? `Their access flag was restored, but the sign-in block could not be lifted: ${banError.message}`
          : `Their access was narrowed, but the sign-in block could not be applied: ${banError.message}. They may still be able to sign in.`,
        partial: true,
      },
      { status: 500 }
    )
  }

  // The audit row is written by migration 101's trigger, not from here, so no caller can
  // skip it.
  return NextResponse.json({ success: true })
}
