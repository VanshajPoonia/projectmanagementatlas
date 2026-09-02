// The module registry: pure data and pure functions, no React.
//
// Split out of lib/modules.ts so the server can read it. That file imports `useState` and the
// browser Supabase client, and Next.js refuses to let a Server Component import a module that
// reaches `useEffect` - which is exactly what happened the moment lib/shell-data.ts wanted
// DEFAULT_MODULES for its fallback. Duplicating the list here instead would have been worse:
// this codebase's recurring failure is two copies of one truth drifting apart.
//
// lib/modules.ts re-exports everything below, so every existing import still works and client
// code has no reason to know this file exists.

export type ModuleKey =
  | 'boards'
  | 'personal_tasks'
  | 'chat'
  | 'calendar'
  | 'bookmarks'
  | 'marketing_calendar'
  | 'reports'
  | 'ai_assistant'
  | 'appointments'
  | 'project_ids'
  | 'crm'
  | 'agile'
  | 'strategy'

export interface AppModule {
  module_key: ModuleKey
  enabled: boolean
  config?: Record<string, unknown>
}

// Fallback whenever app_modules can't be loaded (or a key isn't seeded yet), so every module
// stays available - matches pre-migration-066 behavior, where nothing was ever gated.
export const DEFAULT_MODULES: AppModule[] = [
  { module_key: 'boards', enabled: true },
  { module_key: 'personal_tasks', enabled: true },
  { module_key: 'chat', enabled: true },
  { module_key: 'calendar', enabled: true },
  { module_key: 'bookmarks', enabled: true },
  { module_key: 'marketing_calendar', enabled: true },
  { module_key: 'reports', enabled: true },
  { module_key: 'ai_assistant', enabled: true },
  { module_key: 'project_ids', enabled: true },
  // The one module that defaults OFF (migration 080 seeds enabled=false). It stays off in the
  // fallback too: if app_modules can't be read we must not reveal a module a super admin has
  // never switched on, which is the opposite of the every-module-stays-available rule above.
  { module_key: 'appointments', enabled: false },
  // Same reasoning as appointments: 103 seeds it disabled, and the fallback must not reveal
  // a module a super admin has never switched on.
  { module_key: 'crm', enabled: false },
  // Prompt G's optional agile mode (migration 123 seeds it disabled). Same rule again, and
  // here it matters twice over: the whole point of the module is that a marketing,
  // contracting, real-estate, finance or operations board never has Scrum vocabulary put in
  // front of it, so a fallback that revealed it would defeat the feature's first requirement.
  { module_key: 'agile', enabled: false },
  // Prompt H's optional strategy layer (migration 129 seeds it disabled). Same rule again:
  // the fallback must not reveal a module a super admin has never switched on, and this one
  // adds a whole page to the sidebar rather than a widget in a corner.
  { module_key: 'strategy', enabled: false },
]

/**
 * Is this module switched on for the workspace?
 *
 * ⚠️ A key that is ABSENT from `app_modules` falls back to DEFAULT_MODULES, not to `true`.
 * That matters the moment a module's migration has not reached a database yet: this function
 * used to return `true` for any unknown key while `isModuleEnabledOnServer` fell back to
 * DEFAULT_MODULES, so the two disagreed about exactly the modules that seed OFF. The visible
 * result would be a nav item for a module the server then refuses - a dead link for everyone,
 * which is the defect this repo keeps re-learning.
 *
 * It never bit before only because `appointments`, `crm` and `agile` all had their rows
 * everywhere by the time anything read them. `strategy` (129) is the first module whose code
 * can reach a database that predates its migration, and prod is exactly that database today.
 *
 * A key in neither place still returns `true`, which is the original every-module-available
 * rule: a failure to read `app_modules` must never silently hide working features.
 */
export function isModuleEnabled(modules: AppModule[], key: ModuleKey): boolean {
  const found = modules.find((m) => m.module_key === key)
  if (found) return found.enabled
  return DEFAULT_MODULES.find((module) => module.module_key === key)?.enabled ?? true
}

/**
 * Read one module's switch on the server, with the caller's own session.
 *
 * ⚠️ This exists because a module toggle that only hides a button is not a toggle. The AI
 * assistant was gated at three render sites and nowhere else, so switching it off in
 * Super Admin > Modules removed the widget while `POST /api/ai-chat` kept answering - the
 * same "UI-deep" defect migration 104 had to fix for `requires_reason`. Any module with a
 * server route of its own owes that route this check.
 *
 * The fallback follows lib/modules.ts's rule rather than requireCrmAccess's stricter one:
 * a module absent from `app_modules` stays AVAILABLE, so a failure to read the table can
 * never silently disable working features for everyone. Modules that must fail closed
 * (appointments, crm) carry `enabled: false` in DEFAULT_MODULES and so are refused by this
 * same lookup.
 */
export async function isModuleEnabledOnServer(
  supabase: { from: (table: string) => any },
  key: ModuleKey,
): Promise<boolean> {
  const { data } = await supabase
    .from('app_modules')
    .select('module_key, enabled')
    .eq('module_key', key)
    .maybeSingle()

  if (data) return Boolean(data.enabled)
  return DEFAULT_MODULES.find((module) => module.module_key === key)?.enabled ?? true
}
