import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'

export type ModuleKey =
  | 'boards'
  | 'personal_tasks'
  | 'chat'
  | 'calendar'
  | 'bookmarks'
  | 'marketing_calendar'
  | 'reports'
  | 'ai_assistant'

export interface AppModule {
  module_key: ModuleKey
  enabled: boolean
  config?: Record<string, unknown>
}

// Fallback whenever app_modules can't be loaded (or a key isn't seeded yet), so every module
// stays available — matches pre-migration-066 behavior, where nothing was ever gated.
export const DEFAULT_MODULES: AppModule[] = [
  { module_key: 'boards', enabled: true },
  { module_key: 'personal_tasks', enabled: true },
  { module_key: 'chat', enabled: true },
  { module_key: 'calendar', enabled: true },
  { module_key: 'bookmarks', enabled: true },
  { module_key: 'marketing_calendar', enabled: true },
  { module_key: 'reports', enabled: true },
  { module_key: 'ai_assistant', enabled: true },
]

export function useAppModules() {
  const [modules, setModules] = useState<AppModule[]>(DEFAULT_MODULES)

  useEffect(() => {
    let active = true
    const supabase = createClient()
    supabase
      .from('app_modules')
      .select('module_key, enabled, config')
      .then(({ data }: { data: AppModule[] | null }) => {
        if (!active || !data || data.length === 0) return
        setModules(data)
      })
    return () => {
      active = false
    }
  }, [])

  return modules
}

export function isModuleEnabled(modules: AppModule[], key: ModuleKey): boolean {
  const found = modules.find((m) => m.module_key === key)
  return found ? found.enabled : true
}
