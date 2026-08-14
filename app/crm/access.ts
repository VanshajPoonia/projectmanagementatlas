import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * The one gate every CRM route calls.
 *
 * It answers two questions the RLS policies cannot: is there a session at all, and is the CRM
 * module switched on. RLS is still the authority on *rows* — nothing here re-implements
 * visibility — but a disabled module should not render a shell and then show empty tables, and
 * a signed-out visitor should be sent to /login rather than shown a 403-shaped page.
 *
 * Returns null when access is refused so the caller can choose where to redirect.
 */
export async function requireCrmAccess(
  supabase: SupabaseClient,
): Promise<{ profile: { id: string; role: 'user' | 'admin' | 'super_admin'; full_name: string | null; email: string | null } } | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, full_name, email, is_active')
    .eq('id', user.id)
    .single()

  // A deactivated account keeps a valid session until the token expires (migration 101 bans
  // them at the auth layer and folds is_active into the RLS helpers). This is the third layer:
  // it stops the module rendering at all rather than rendering empty because every query was
  // refused.
  if (!profile || profile.is_active === false) return null

  const { data: module } = await supabase
    .from('app_modules')
    .select('enabled')
    .eq('module_key', 'crm')
    .maybeSingle()

  // Absent row means the module was never seeded — treated as off here, which is deliberately
  // STRICTER than lib/modules.ts's generic fallback (an unknown key there stays available, so
  // a failure to read app_modules never hides working features). CRM is listed explicitly in
  // DEFAULT_MODULES as enabled:false, so the nav agrees; this is the backstop for the case
  // where the row is missing entirely rather than merely unreadable.
  if (!module?.enabled) return null

  return {
    profile: {
      id: profile.id,
      role: profile.role,
      full_name: profile.full_name,
      email: profile.email,
    },
  }
}
