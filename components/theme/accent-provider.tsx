'use client'

// The accent colour, applied once at the document root.
//
// WHY A PROVIDER AND NOT THE OLD HOOK. `useAccentTheme` returned a `style` object that
// user-dashboard spread onto one wrapper <div>. Custom properties inherit down the DOM, so
// that made the accent reach exactly the dashboard's own subtree and nothing else:
//
//   - a board renders from its own route (app/dashboard/board/[id]) outside that wrapper, so
//     opening a board dropped back to the default black;
//   - every Radix dialog, popover, dropdown and toast is portaled to document.body, which is
//     a *sibling* of the wrapper, so no overlay ever picked the colour up either.
//
// Writing the properties to document.documentElement fixes both at once: :root is an ancestor
// of the portal container as well as the app tree, so there is no subtree left to miss.
//
// WHY localStorage AND NOT A profiles COLUMN. This is the convention the repo already argued
// for in scripts/097_user_favorites.sql: presentational preferences (sidebar collapse,
// density, recents) stay per browser, and only deliberate curated data earns a table. Theme
// and accent are presentational, so they stay here. Changing that later is a provider change,
// not a migration.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { autoTextColor } from '@/lib/color'

/** Matches the cal.com ink that :root ships as --primary, so "no preference" is the default. */
export const DEFAULT_ACCENT = '#111111'

const STORAGE_PREFIX = 'dashboard_accent_'

/** Kept as the historical key shape so an accent set before this refactor still loads. */
export function accentStorageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

/**
 * The starting accent for an account that has never chosen one.
 *
 * This is the `isKaylaAccentUser` check that used to live in user-dashboard.tsx. CLAUDE.md
 * records it as deliberately kept: it is a cosmetic default, explicitly *not* access control,
 * and out of scope for the de-hardcoding work that removed the marketing-module email gate.
 * It moved here rather than being dropped because the dashboard is no longer where the accent
 * is decided — but the person still expects her dashboard to come up pink.
 */
export function accountDefaultAccent(email: string | null | undefined): string {
  return String(email ?? '').trim().toLowerCase() === 'kayla@goatlasgo.us'
    ? '#e91e8c'
    : DEFAULT_ACCENT
}

/**
 * The custom properties an accent overrides.
 *
 * Deliberately only the *action* tokens — background, foreground, card and border are left
 * alone. An accent is the colour of the primary button and the focus ring, not a re-skin of
 * every surface, and tinting surfaces here would fight the light/dark palette rather than sit
 * on top of it.
 */
const ACCENT_VARS = [
  '--primary',
  '--primary-foreground',
  '--ring',
  '--sidebar-primary',
  '--sidebar-primary-foreground',
  '--sidebar-ring',
] as const

function applyAccent(color: string | null) {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (!color) {
    for (const name of ACCENT_VARS) root.style.removeProperty(name)
    return
  }
  const ink = autoTextColor(color)
  root.style.setProperty('--primary', color)
  root.style.setProperty('--primary-foreground', ink)
  root.style.setProperty('--ring', color)
  root.style.setProperty('--sidebar-primary', color)
  root.style.setProperty('--sidebar-primary-foreground', ink)
  root.style.setProperty('--sidebar-ring', color)
}

interface AccentContextValue {
  /** The active accent, or DEFAULT_ACCENT when the user has not chosen one. */
  color: string
  /** True when the user has explicitly chosen a colour (i.e. reset would do something). */
  isCustom: boolean
  setColor: (color: string) => void
  reset: () => void
}

const AccentContext = createContext<AccentContextValue | null>(null)

export function AccentProvider({
  userId,
  defaultColor,
  children,
}: {
  userId: string | null | undefined
  /**
   * The accent to use when the user has stored none. Carries the one personalization the repo
   * keeps deliberately (see accountDefaultAccent), so Reset restores that colour rather than
   * dropping the person to plain black — which is how the old useAccentTheme behaved.
   */
  defaultColor?: string
  children: ReactNode
}) {
  const [color, setColorState] = useState<string | null>(null)

  // Read on mount (and whenever the signed-in user changes) rather than during render, so the
  // server and the first client render agree. A stored accent paints one frame late; the
  // alternative is a hydration mismatch on every page.
  useEffect(() => {
    if (!userId) {
      setColorState(null)
      applyAccent(null)
      return
    }
    let stored: string | null = null
    try {
      stored = localStorage.getItem(accentStorageKey(userId))
    } catch {
      stored = null
    }
    setColorState(stored)
    applyAccent(stored ?? defaultColor ?? null)
  }, [userId, defaultColor])

  // Clear the root properties when the provider unmounts (sign-out), so the login screen is
  // never left wearing the previous account's accent.
  useEffect(() => () => applyAccent(null), [])

  const setColor = useCallback(
    (next: string) => {
      setColorState(next)
      applyAccent(next)
      if (!userId) return
      try {
        localStorage.setItem(accentStorageKey(userId), next)
      } catch {
        /* private mode / quota — the colour still applies for this session */
      }
    },
    [userId],
  )

  const reset = useCallback(() => {
    setColorState(null)
    applyAccent(defaultColor ?? null)
    if (!userId) return
    try {
      localStorage.removeItem(accentStorageKey(userId))
    } catch {
      /* ignore */
    }
  }, [userId, defaultColor])

  const value = useMemo<AccentContextValue>(
    () => ({
      color: color ?? defaultColor ?? DEFAULT_ACCENT,
      // "Custom" means the user chose it, so a per-account default does not light up Reset.
      isCustom: color !== null,
      setColor,
      reset,
    }),
    [color, defaultColor, setColor, reset],
  )

  return <AccentContext.Provider value={value}>{children}</AccentContext.Provider>
}

/**
 * Read the accent. Safe to call outside an AccentProvider — a shell that has not been wrapped
 * yet gets the default and inert setters rather than a crash, so adding the picker to a new
 * surface is never a two-step change.
 */
export function useAccent(): AccentContextValue {
  return (
    useContext(AccentContext) ?? {
      color: DEFAULT_ACCENT,
      isCustom: false,
      setColor: () => {},
      reset: () => {},
    }
  )
}
