import { createClient } from '@/lib/supabase/server'
import { NextResponse } from 'next/server'

export async function POST() {
  const supabase = await createClient()

  // Check if requester is admin
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
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  // Create team users
  const teamMembers = [
    { email: 'cami@goatlasgo.us', full_name: 'Cami', password: 'Ic3Ic3' },
    { email: 'kayla@goatlasgo.us', full_name: 'Kayla', password: 'Ic3Ic3' },
    { email: 'vanshaj@goatlasgo.us', full_name: 'Vanshaj', password: 'Ic3Ic3' },
    { email: 'kogan@goatlasgo.us', full_name: 'Kogan', password: 'Ic3Ic3' },
  ]

  const results = []

  for (const member of teamMembers) {
    try {
      // Create auth user using admin API
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: member.email,
        password: member.password,
        email_confirm: true,
        user_metadata: {
          full_name: member.full_name,
        }
      })

      if (authError) {
        console.error(`[v0] Error creating user ${member.email}:`, authError)
        results.push({ email: member.email, success: false, error: authError.message })
        continue
      }

      // Update profile with full name and role
      const { error: profileError } = await supabase
        .from('profiles')
        .update({
          full_name: member.full_name,
          role: 'user'
        })
        .eq('id', authData.user.id)

      if (profileError) {
        console.error(`[v0] Error updating profile for ${member.email}:`, profileError)
        results.push({ email: member.email, success: false, error: profileError.message })
      } else {
        console.log(`[v0] Successfully created user: ${member.email}`)
        results.push({ email: member.email, success: true, id: authData.user.id })
      }
    } catch (error: any) {
      console.error(`[v0] Exception creating user ${member.email}:`, error)
      results.push({ email: member.email, success: false, error: error.message })
    }
  }

  return NextResponse.json({ results })
}
