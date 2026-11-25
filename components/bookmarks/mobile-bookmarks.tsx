'use client'

import { useState } from 'react'
import { Bookmark, ChevronDown } from 'lucide-react'

import BookmarksSection from './bookmarks-section'

/** Phones have no bookmarks rail, so this is the same list as a collapsible block. */
export default function MobileBookmarks({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const [open, setOpen] = useState(false)
  return (
    <details
      className="group bg-muted/10 mb-4 rounded-lg border md:hidden"
      onToggle={(e) => setOpen(e.currentTarget.open)}
    >
      <summary className="flex min-h-12 cursor-pointer list-none items-center gap-2 px-3 text-sm font-medium [&::-webkit-details-marker]:hidden">
        <Bookmark className="text-muted-foreground size-4" aria-hidden="true" />
        <span className="flex-1">Bookmarks</span>
        <ChevronDown className="text-muted-foreground size-4 transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      {open && (
        <div className="border-t p-3">
          <BookmarksSection userId={userId} isAdmin={isAdmin} embedded sidebar />
        </div>
      )}
    </details>
  )
}
