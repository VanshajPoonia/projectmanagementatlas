'use client'

// The opaque colours the app actually paints, per theme.
//
// Contrast can only be computed against a real colour, and `bg-card` is a CSS variable that
// JS cannot read cheaply per render. These mirror the values in app/globals.css so a
// user-chosen colour (a company's brand hex) can be checked against the surface it will
// actually land on before it is used as text. See lib/color.ts::readableInk.
//
// Keep in sync with :root / .dark in app/globals.css.

import { useEffect, useMemo, useState } from 'react'
import { useTheme } from 'next-themes'

export interface Surface {
  isDark: boolean
  /** --background */
  canvas: string
  /** --card, which is what most tinted chips sit on */
  card: string
  /** --muted */
  muted: string
}

export function useSurface(): Surface {
  const { resolvedTheme } = useTheme()

  // ⚠️ Mount-gated on purpose. next-themes cannot know the theme during SSR - it reads
  // localStorage on the client - so a component that inks itself from `resolvedTheme` renders
  // one colour on the server and another on hydration. React 19 reports that as a hydration
  // error, and it was doing so for every StatusPill on the orders table.
  //
  // Reporting light until mounted means a dark-mode viewer sees one frame of the light ink on
  // these small tinted elements. That is the same trade theme-toggle.tsx already makes, and it
  // is the correct way round: a frame of the wrong tint is invisible next to a hydration
  // mismatch, which makes React discard and re-render the subtree.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const isDark = mounted && resolvedTheme === 'dark'

  return useMemo(
    () => ({
      isDark,
      canvas: isDark ? '#0a0a0a' : '#ffffff',
      card: isDark ? '#141414' : '#ffffff',
      muted: isDark ? '#1a1a1a' : '#f8f9fa',
    }),
    [isDark],
  )
}
