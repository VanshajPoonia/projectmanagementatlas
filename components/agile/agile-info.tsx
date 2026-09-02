'use client'

// The "what is this and how does it work?" affordance for agile mode.
//
// ⚠️ It appears in three places on purpose: the /agile header, where somebody lands and wonders
// what they are looking at; the board header, once agile is on for that board; and Super Admin
// > Modules, where an admin decides whether to switch it on. All render AGILE_GUIDE from
// lib/agile-guide.ts through the shared GuideDialog, because the fact most worth getting right
// is the same in all three, and prose duplicated by hand across surfaces is how a help page
// ends up describing a product that no longer exists.

import { GuideDialog } from '@/components/shell/guide-dialog'
import { AGILE_GUIDE } from '@/lib/agile-guide'

export function AgileInfoButton({
  className,
  label,
  id = 'agile-info-button',
}: {
  className?: string
  label?: string
  id?: string
}) {
  return (
    <GuideDialog
      guide={AGILE_GUIDE}
      heading="How agile mode works"
      className={className}
      label={label}
      id={id}
    />
  )
}
