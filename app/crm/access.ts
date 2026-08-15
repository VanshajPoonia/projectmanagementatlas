import type { SupabaseClient } from '@supabase/supabase-js'

import { loadShellData, type ShellData } from '@/lib/shell-data'

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
export async function requireCrmAccess(supabase: SupabaseClient): Promise<{
  profile: { id: string; role: 'user' | 'admin' | 'super_admin'; full_name: string | null; email: string | null }
  /** Passed straight to CrmShell so its sidebar is right on the first frame. */
  shell: ShellData
} | null> {
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

  // The whole module list, not just the CRM row: CrmShell needs it to build the sidebar, and
  // narrowing this query only meant the shell re-fetched the same table from the browser a
  // moment later and rendered the fallback nav until it arrived.
  const shell = await loadShellData(supabase)
  const module = shell.modules.find(m => m.module_key === 'crm')

  // No row, or an unreadable table, is treated as off — deliberately STRICTER than
  // lib/modules.ts's generic fallback, where an unknown key stays available so a failure to
  // read app_modules never hides working features. Both paths land on refused: a missing row
  // makes `find` undefined, and an unreadable table makes loadShellData return
  // DEFAULT_MODULES, which lists crm as enabled:false. The nav agrees either way.
  if (!module?.enabled) return null

  return {
    profile: {
      id: profile.id,
      role: profile.role,
      full_name: profile.full_name,
      email: profile.email,
    },
    shell,
  }
}
