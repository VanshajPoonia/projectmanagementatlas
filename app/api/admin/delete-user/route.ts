import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { REFUSAL_MESSAGES, checkDeletion } from '@/lib/deprovision'

// Delete an account without deleting the company's work.
//
// Before migration 100 this route could not delete most accounts at all: boards.created_by
// and tasks.created_by were NOT NULL with an ON DELETE SET NULL rule, so Postgres aborted
// every delete with an opaque "Database error deleting user". Since every board here is
// created by an admin, that meant no admin could ever be deprovisioned.
//
// With the schema fixed, the foreign keys handle nearly all of it. Two things are the
// exception and are reassigned explicitly below: boards (whose creator owns a private board's
// membership list) and SHARED saved views (which other people are using).

export async function DELETE(request: Request) {
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

  if (!checkRateLimit(`delete-user:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, please slow down.' }, { status: 429 })
  }

  const { userId } = await request.json()
  if (typeof userId !== 'string' || userId.length === 0) {
    return NextResponse.json({ error: 'A userId is required.' }, { status: 400 })
  }

  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )

  try {
    const [{ data: target }, { count: superAdminCount }] = await Promise.all([
      supabaseAdmin.from('profiles').select('id, role').eq('id', userId).maybeSingle(),
      supabaseAdmin
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('role', 'super_admin'),
    ])

    const refusal = checkDeletion(target, user.id, superAdminCount ?? 0)
    if (refusal) {
      return NextResponse.json({ error: REFUSAL_MESSAGES[refusal] }, { status: 409 })
    }

    // Transfer board ownership BEFORE the delete, not after - after would be too late, the
    // rows would already carry NULL. `created_by` on a board is not a byline: migration 061
    // makes it the only authority over a private board's membership list, with no admin
    // bypass. A NULL creator would freeze that list permanently for everyone.
    //
    // Everything else is deliberately left to the foreign keys: tasks, comments and shared
    // bookmarks keep their content and go to NULL, which renders as a removed user, while
    // personal tasks, DMs, memberships and favourites are cascaded away with the account.
    const { data: transferred, error: transferError } = await supabaseAdmin
      .from('boards')
      .update({ created_by: user.id })
      .eq('created_by', userId)
      .select('id')

    if (transferError) {
      return NextResponse.json(
        { error: `Could not transfer their boards, so nothing was deleted: ${transferError.message}` },
        { status: 500 }
      )
    }

    // SHARED saved views are the second thing that must change hands, for the same reason and
    // by the same rule as boards: migration 119 gives `saved_views.owner_id` an ON DELETE
    // CASCADE, which is right for a PERSONAL view (it was private to them, including from
    // admins, and nobody else can see it) and wrong for a SHARED one. A shared view is org
    // furniture - it is on everyone's picker and someone else is using it today - so letting it
    // vanish with its author destroys other people's work, silently and with no way back.
    //
    // Only `scope = 'shared'` is touched. Reassigning their personal views would be worse than
    // deleting them: it would hand the deleting admin a private view they were never meant to
    // see, on a table built with no admin bypass on any policy.
    //
    // There is no UNIQUE (owner_id, name) on this table - 119 declined it deliberately - so a
    // transferred view cannot collide with one the new owner already has.
    const { data: viewsMoved, error: viewsError } = await supabaseAdmin
      .from('saved_views')
      .update({ owner_id: user.id })
      .eq('owner_id', userId)
      .eq('scope', 'shared')
      .select('id')

    if (viewsError) {
      return NextResponse.json(
        {
          error:
            `Their boards transferred, but their shared views did not, so nothing was deleted: ` +
            `${viewsError.message}`,
          boardsTransferred: transferred?.length ?? 0,
        },
        { status: 500 }
      )
    }

    const { error: authError } = await supabaseAdmin.auth.admin.deleteUser(userId)
    if (authError) {
      // The transfer already happened. Say so rather than reporting a clean failure - the
      // boards genuinely changed hands and the operator needs to know that.
      return NextResponse.json(
        {
          error: `The account was not deleted: ${authError.message}`,
          boardsTransferred: transferred?.length ?? 0,
          sharedViewsTransferred: viewsMoved?.length ?? 0,
        },
        { status: 500 }
      )
    }

    // The audit row is written by the trigger from migration 100, not from here, so it
    // cannot be skipped by any caller.
    return NextResponse.json({
      success: true,
      boardsTransferred: transferred?.length ?? 0,
      sharedViewsTransferred: viewsMoved?.length ?? 0,
    })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
