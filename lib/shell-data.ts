import type { SupabaseClient } from '@supabase/supabase-js'

// From ./module-registry, not ./modules: the latter is a client module (it imports
// useState and the browser Supabase client), and a Server Component may not import one.
import { DEFAULT_MODULES, type AppModule } from './module-registry'
import {
  MARKETING_CALENDAR_SELECT,
  toMarketingCalendarSummaries,
  type MarketingCalendarSummary,
} from './marketing-calendar-summary'

/**
 * The two lists the app shell needs before it can draw a correct sidebar.
 *
 * Both used to be fetched client-side on mount, which meant every screen painted its nav
 * from lib/modules.ts's fallback first - where `crm` and `appointments` are off - and
 * corrected itself a beat later. A super admin who had just switched CRM on in Settings
 * watched it appear, which reads exactly like the thing not being saved.
 */
export interface ShellData {
  modules: AppModule[]
  calendars: MarketingCalendarSummary[]
}

/**
 * Load them on the server, with the caller's own session.
 *
 * RLS is still the authority: `app_modules` is world-readable to signed-in users (066), and
 * `marketing_calendars` already scopes itself to "every calendar for admins, only mine for
 * everyone else" (085). Nothing here re-implements visibility.
 *
 * Every consumer is a dynamic page - they all call `auth.getUser()` first - so this is never
 * served from a static cache and cannot go stale behind a toggle.
 */
export async function loadShellData(supabase: SupabaseClient): Promise<ShellData> {
  const [{ data: modules }, { data: calendars }] = await Promise.all([
    supabase.from('app_modules').select('module_key, enabled, config'),
    supabase.from('marketing_calendars').select(MARKETING_CALENDAR_SELECT).order('name'),
  ])

  return {
    // An empty result means the read failed or the table was never seeded. Falling back to
    // DEFAULT_MODULES here rather than passing `[]` keeps one rule for that case instead of
    // two: `useAppModules` treats an empty seed as "no seed" and applies the same fallback.
    modules: modules?.length ? (modules as AppModule[]) : DEFAULT_MODULES,
    calendars: toMarketingCalendarSummaries(calendars),
  }
}
