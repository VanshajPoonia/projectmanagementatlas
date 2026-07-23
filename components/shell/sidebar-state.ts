// Pure, framework-free logic for the shell sidebar's persisted state. The React
// hook (use-sidebar-state.ts) wraps these with localStorage + SSR guards; keeping
// the logic here makes it unit-testable without a DOM.

export type SidebarMode = 'expanded' | 'collapsed'

export interface SidebarState {
  /** 'collapsed' = icon-only rail; 'expanded' = full labels. */
  mode: SidebarMode
}

export const DEFAULT_SIDEBAR_STATE: SidebarState = { mode: 'expanded' }

/** Per-user key so two accounts on one browser don't clobber each other. */
export function sidebarStorageKey(userId: string): string {
  return `app_sidebar_state:${userId}`
}

/** Parse persisted JSON defensively; any bad/missing value falls back to default. */
export function parseSidebarState(raw: string | null): SidebarState {
  if (!raw) return DEFAULT_SIDEBAR_STATE
  try {
    const parsed = JSON.parse(raw)
    const mode: SidebarMode = parsed?.mode === 'collapsed' ? 'collapsed' : 'expanded'
    return { mode }
  } catch {
    return DEFAULT_SIDEBAR_STATE
  }
}

export function serializeSidebarState(state: SidebarState): string {
  return JSON.stringify(state)
}

export function toggleSidebarMode(state: SidebarState): SidebarState {
  return { ...state, mode: state.mode === 'expanded' ? 'collapsed' : 'expanded' }
}

export function isCollapsed(state: SidebarState): boolean {
  return state.mode === 'collapsed'
}
