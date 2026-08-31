'use client'

// The "what is this?" affordance for agile mode.
//
// ⚠️ It exists in two places on purpose - the /agile header, where someone lands and wonders
// what they are looking at, and Super Admin > Modules, where an admin decides whether to switch
// it on. Both render AGILE_EXPLAINER from lib/agile.ts rather than their own copy, because the
// fact most worth getting right is the same in both: turning the MODULE on changes no board.
// Two hand-written explanations of one switch is how a doc ends up contradicting the product.

import { useState } from 'react'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { AGILE_EXPLAINER } from '@/lib/agile'

export function AgileInfoButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={className}
        onClick={() => setOpen(true)}
        id="agile-info-button"
        // A bare icon needs a name for a screen reader and a tooltip for everyone else.
        aria-label="What is agile mode?"
        title="What is agile mode?"
      >
        <Info className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>What agile mode is</DialogTitle>
            <DialogDescription>{AGILE_EXPLAINER.summary}</DialogDescription>
          </DialogHeader>

          <div className="space-y-4 text-sm">
            {AGILE_EXPLAINER.sections.map((section) => (
              <div key={section.heading} className="space-y-1">
                <p className="font-medium">{section.heading}</p>
                <p className="text-muted-foreground leading-relaxed">{section.body}</p>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
