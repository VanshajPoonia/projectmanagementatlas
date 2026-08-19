'use client'

// A clock that does not break hydration.
//
// Any view that renders "3.4 days old" or "48 min in this status" is reading the current time
// during render. On a server-rendered page that is evaluated twice - once on the server, once
// on the client a moment later - and the two answers differ, so React reports a hydration
// mismatch and throws away the subtree. The CRM tables hit this on every row.
//
// The fix is to make the first client render agree with the server by construction: the server
// passes the instant it rendered at, that exact value is used for hydration, and only after
// mount does the clock become the browser's own. Nothing flickers, because the two values are
// milliseconds apart.

import { useEffect, useState } from 'react'

export function useNow(serverNow: string): Date {
  const [now, setNow] = useState(() => new Date(serverNow))

  // Runs after hydration has already matched, so replacing the value here is safe.
  useEffect(() => setNow(new Date()), [])

  return now
}
