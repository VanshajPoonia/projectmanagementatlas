import { createClient } from '@/lib/supabase/server'
import { createClient as createAdminClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import { checkRateLimit } from '@/lib/rate-limit'

export async function PUT(request: Request) {
  const supabase = await createClient()

  // Check if user is admin
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', user.id)
    .single()

  if (profile?.role !== 'admin') {
    return NextResponse.json({ error: 'Forbidden - Admin only' }, { status: 403 })
  }

  if (!checkRateLimit(`update-user:${user.id}`, 10, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, please slow down.' }, { status: 429 })
  }

  const { userId, fullName, role, password } = await request.json()

  // Create admin client
  const supabaseAdmin = createAdminClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    }
  )

  try {
    // Update password if provided
    if (password) {
      const { error: passError } = await supabaseAdmin.auth.admin.updateUserById(
        userId,
        { password }
      )
      if (passError) throw passError
    }

    // Update profile
    const { error: profileError } = await supabaseAdmin
      .from('profiles')
      .update({ full_name: fullName, role })
      .eq('id', userId)

    if (profileError) throw profileError

    return NextResponse.json({ success: true })
  } catch (error: any) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
}
