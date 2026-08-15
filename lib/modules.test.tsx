// @vitest-environment jsdom
//
// The seeding half of useAppModules. The point of the seed is what the FIRST render shows:
// before it, every shell painted lib/modules.ts's fallback — where crm and appointments are
// off — and corrected itself once a browser fetch landed, so a module a super admin had just
// switched on visibly appeared a beat after the page did.
//
// Fetch-on-mount is asserted here too, because "seeded hosts skip the query" is only safe if
// unseeded hosts still make it.

import { describe, expect, it, vi, beforeEach } from 'vitest'
import { render, act } from '@testing-library/react'

const select = vi.fn()
vi.mock('./supabase/client', () => ({
  createClient: () => ({ from: () => ({ select }) }),
}))

import { DEFAULT_MODULES, isModuleEnabled, type AppModule } from './module-registry'
import { useAppModules } from './modules'

/** Records what the hook returned on each render, so the first frame can be asserted. */
function Harness({ initial }: { initial?: AppModule[] | null }) {
  const modules = useAppModules(initial)
  frames.push(modules)
  return null
}
let frames: AppModule[][] = []

const ALL_ON: AppModule[] = DEFAULT_MODULES.map(m => ({ ...m, enabled: true }))

beforeEach(() => {
  frames = []
  select.mockReset()
  // A promise that never settles: the fallback path must be observable before it resolves.
  select.mockReturnValue(new Promise(() => {}))
})

describe('useAppModules seeding', () => {
  it('shows the seeded list on the very first render, not after a fetch', () => {
    render(<Harness initial={ALL_ON} />)
    expect(isModuleEnabled(frames[0], 'crm')).toBe(true)
    expect(isModuleEnabled(frames[0], 'appointments')).toBe(true)
  })

  it('does not query app_modules when it was seeded', () => {
    render(<Harness initial={ALL_ON} />)
    expect(select).not.toHaveBeenCalled()
  })

  it('still queries when no seed is given', () => {
    render(<Harness />)
    expect(select).toHaveBeenCalledTimes(1)
  })

  it('falls back to DEFAULT_MODULES while an unseeded fetch is in flight', () => {
    render(<Harness />)
    // The fallback deliberately keeps crm and appointments off: a failed read must never
    // reveal a module nobody switched on.
    expect(isModuleEnabled(frames[0], 'crm')).toBe(false)
    expect(isModuleEnabled(frames[0], 'appointments')).toBe(false)
    expect(isModuleEnabled(frames[0], 'boards')).toBe(true)
  })

  // loadShellData already collapses an empty/failed read into DEFAULT_MODULES, so an empty
  // array reaching the hook means "no seed" rather than "no modules exist" — otherwise a
  // momentary read failure on the server would blank the entire sidebar.
  it('treats an empty seed as no seed and queries anyway', () => {
    render(<Harness initial={[]} />)
    expect(select).toHaveBeenCalledTimes(1)
    expect(isModuleEnabled(frames[0], 'boards')).toBe(true)
  })

  // The seed is read on every render rather than copied into state, so a soft navigation
  // carrying a freshly-toggled list is picked up. Copying it into a useState initializer
  // would pin the nav to whatever the first render happened to receive.
  it('follows a seed that changes between renders', () => {
    const crmOff = ALL_ON.map(m => (m.module_key === 'crm' ? { ...m, enabled: false } : m))
    const { rerender } = render(<Harness initial={crmOff} />)
    expect(isModuleEnabled(frames.at(-1)!, 'crm')).toBe(false)

    act(() => rerender(<Harness initial={ALL_ON} />))
    expect(isModuleEnabled(frames.at(-1)!, 'crm')).toBe(true)
    expect(select).not.toHaveBeenCalled()
  })
})
