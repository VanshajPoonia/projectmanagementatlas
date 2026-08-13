import { createClient as createServerClient } from '@/lib/supabase/server'
import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export async function POST(request: Request) {
  try {
    const supabase = await createServerClient()

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

    if (!checkRateLimit(`create-user:${user.id}`, 10, 60_000)) {
      return NextResponse.json({ error: 'Too many requests, please slow down.' }, { status: 429 })
    }

    const { email, password, fullName, role = 'user' } = await request.json()

    // Create Supabase admin client
    const supabaseAdmin = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      {
        auth: {
          autoRefreshToken: false,
          persistSession: false,
        },
      }
    )

    // Create user with admin client
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
      },
    })

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }

    // Set the profile's name and role.
    //
    // This used to be a bare .update().eq(), which silently depends on the on_auth_user_created
    // trigger having already inserted the row. An UPDATE matching zero rows is NOT an error in
    // PostgREST, so if the trigger were ever missing this route would report success while
    // leaving the account with no profile at all — and since profiles.role drives every
    // permission check, that user would be broken on arrival with nothing to show why.
    // (The dev sandbox was in exactly that state: the trigger lives on auth.users, outside the
    // `public` schema, so a public-only clone dropped it. Migration 096 restores it.)
    //
    // upsert makes the route correct with or without the trigger, and .select() means a failure
    // to land the row is reported instead of assumed.
    const { data: profileRows, error: profileError } = await supabaseAdmin
      .from('profiles')
      .upsert(
        { id: data.user.id, email: data.user.email, full_name: fullName, role },
        { onConflict: 'id' },
      )
      .select('id')

    if (profileError) {
      return NextResponse.json({ error: profileError.message }, { status: 400 })
    }

    if (!profileRows || profileRows.length === 0) {
      return NextResponse.json(
        { error: 'Account was created but its profile could not be saved. Check the user in Super Admin before they sign in.' },
        { status: 500 },
      )
    }

    return NextResponse.json({ success: true, user: data.user })
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 })
  }
}
