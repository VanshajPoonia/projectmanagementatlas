'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { DEFAULT_MODULES, type AppModule } from './module-registry'

// The registry itself lives in ./module-registry (no React), so the server can import it too.
// Re-exported here so every existing `from '@/lib/modules'` import keeps working and client
// code never has to care which of the two files a symbol came from.
export {
  DEFAULT_MODULES,
  isModuleEnabled,
  type AppModule,
  type ModuleKey,
} from './module-registry'

/**
 * The enabled-module list for this viewer.
 *
 * Pass `initial` (from `loadShellData` on the server) wherever the host can. Without it the
 * first frame renders DEFAULT_MODULES - where `crm` and `appointments` are off - and
 * corrects itself once the fetch lands, so a module that is switched on visibly pops into
 * the sidebar a moment after the page appears.
 *
 * When seeded, the client fetch is skipped: every host that seeds is a dynamic server page,
 * so the prop is re-read on every navigation, including a soft one. Fetching again would
 * re-request rows the server just sent.
 */
export function useAppModules(initial?: AppModule[] | null) {
  const seeded = Boolean(initial?.length)
  const [fetched, setFetched] = useState<AppModule[] | null>(null)

  useEffect(() => {
    if (seeded) return
    let active = true
    const supabase = createClient()
    supabase
      .from('app_modules')
      .select('module_key, enabled, config')
      .then(({ data }: { data: AppModule[] | null }) => {
        if (!active || !data || data.length === 0) return
        setFetched(data)
      })
    return () => {
      active = false
    }
  }, [seeded])

  // The seed is read on every render rather than copied into state once. A `useState`
  // initializer runs only on mount, so a soft navigation carrying a newly-toggled list would
  // have been ignored for the lifetime of the component - and syncing it back with an effect
  // risks a render loop whenever the host passes a fresh array identity.
  return seeded ? initial! : (fetched ?? DEFAULT_MODULES)
}
