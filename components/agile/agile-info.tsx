'use client'

// The "what is this and how does it work?" affordance for agile mode.
//
// ⚠️ It appears in two places on purpose: the /agile header, where somebody lands and wonders
// what they are looking at, and Super Admin > Modules, where an admin decides whether to switch
// it on. Both render AGILE_GUIDE from lib/agile-guide.ts rather than their own copy, because the
// fact most worth getting right is the same in both, and prose duplicated by hand across
// surfaces is how a help page ends up describing a product that no longer exists.

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
import { AGILE_GUIDE } from '@/lib/agile-guide'

/**
 * @param label  render as a labelled button instead of a bare icon. Worth it where the reader
 *               has not yet decided they have a question - the empty state a board with agile
 *               off lands on is exactly that, and an unlabelled ⓘ there is easy to skip past.
 * @param id     ids must stay unique, so a second instance on one page names itself.
 */
export function AgileInfoButton({
  className,
  label,
  id = 'agile-info-button',
}: {
  className?: string
  label?: string
  id?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button
        type="button"
        variant={label ? 'outline' : 'ghost'}
        size={label ? 'sm' : 'icon-sm'}
        className={className}
        onClick={() => setOpen(true)}
        id={id}
        // A bare icon needs a name for a screen reader and a tooltip for everyone else.
        aria-label={label ? undefined : 'How agile mode works'}
        title="How agile mode works"
      >
        <Info className={label ? 'mr-1 h-4 w-4' : 'h-4 w-4'} />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* The guide is long by design, so it scrolls inside the dialog rather than pushing its
            own close button off the screen. dialog.tsx already caps height with dvh. */}
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>How agile mode works</DialogTitle>
            <DialogDescription>{AGILE_GUIDE.tagline}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 text-sm">
            <p className="text-muted-foreground leading-relaxed">{AGILE_GUIDE.summary}</p>

            {AGILE_GUIDE.sections.map((section) => (
              <section key={section.id} className="space-y-2">
                <h3 className="font-medium">{section.heading}</h3>
                <p className="text-muted-foreground leading-relaxed">{section.body}</p>

                {section.steps &&
                  (section.ordered ? (
                    <ol className="text-muted-foreground list-decimal space-y-1 pl-5 leading-relaxed">
                      {section.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  ) : (
                    <ul className="text-muted-foreground list-disc space-y-1 pl-5 leading-relaxed">
                      {section.steps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ul>
                  ))}

                {section.note && (
                  <p className="border-l-2 pl-3 leading-relaxed italic">{section.note}</p>
                )}
              </section>
            ))}

            <section className="space-y-3">
              <h3 className="font-medium">Common questions</h3>
              <dl className="space-y-3">
                {AGILE_GUIDE.faq.map((item) => (
                  <div key={item.q} className="space-y-0.5">
                    <dt className="font-medium">{item.q}</dt>
                    <dd className="text-muted-foreground leading-relaxed">{item.a}</dd>
                  </div>
                ))}
              </dl>
            </section>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
