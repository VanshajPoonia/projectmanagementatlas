'use client'

import { useEffect, useState } from 'react'

/** "⌘" on Apple devices, "Ctrl" elsewhere. Starts as "⌘" so the server and first paint agree. */
export function useModKey(): string {
  const [key, setKey] = useState('⌘')
  useEffect(() => {
    const platform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform ?? navigator.platform ?? ''
    if (!/mac|iphone|ipad|ipod/i.test(platform)) setKey('Ctrl')
  }, [])
  return key
}
