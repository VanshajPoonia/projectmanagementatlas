'use client'

// Mounts AccentProvider for whoever is signed in, from the root layout.
//
// The layout is a server component and does not know the user, and the accent is stored per
// account (`dashboard_accent_<id>`), so the id has to be resolved on the client. This uses
// getSession() rather than getUser(): getSession reads the session already in local storage,
// while getUser revalidates against the auth server - a network round-trip on every page load
// to decide a colour is not a trade worth making. onAuthStateChange then keeps it correct
// across sign-in, sign-out and account switches without polling.

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AccentProvider, accountDefaultAccent } from './accent-provider'

/** Only the two fields this component needs; the shared client is untyped at this call site. */
type SessionLike = { user?: { id: string; email?: string | null } | null } | null

export function AccentBoot({ children }: { children: React.ReactNode }) {
  const supabase = useMemo(() => createClient(), [])
  const [account, setAccount] = useState<{ id: string; email: string | null } | null>(null)

  useEffect(() => {
    let active = true

    const read = (session: SessionLike) => {
      if (!active) return
      setAccount(session?.user ? { id: session.user.id, email: session.user.email ?? null } : null)
    }

    supabase.auth
      .getSession()
      .then(({ data }: { data: { session: SessionLike } }) => read(data.session))
    const { data: sub } = supabase.auth.onAuthStateChange(
      (_event: string, session: SessionLike) => read(session),
    )

    return () => {
      active = false
      sub.subscription.unsubscribe()
    }
  }, [supabase])

  return (
    <AccentProvider userId={account?.id ?? null} defaultColor={accountDefaultAccent(account?.email)}>
      {children}
    </AccentProvider>
  )
}
