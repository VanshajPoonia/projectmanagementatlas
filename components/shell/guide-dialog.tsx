'use client'

// One dialog that renders any ProductGuide.
//
// ⚠️ Extracted from components/agile/agile-info.tsx when the strategy module needed the same
// affordance. Copying it would have given the product two guide dialogs that drift in layout
// and in what they choose to render - a section with `steps` shown in one and swallowed in
// the other is a real failure mode, because nothing errors.
//
// Everything it shows comes from the guide object, so a section added to the data appears here
// with no change to this file.

import { useState } from 'react'
import { Info } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import type { ProductGuide } from '@/lib/product-guide'

export function GuideDialog({
  guide,
  heading,
  className,
  label,
  id,
}: {
  guide: ProductGuide
  /** The dialog's title and the button's accessible name. */
  heading: string
  className?: string
  /**
   * Render as a labelled button instead of a bare icon. Worth it where the reader has not yet
   * decided they have a question - an empty state is exactly that, and an unlabelled ⓘ there
   * is easy to skip past.
   */
  label?: string
  /** Ids must stay unique, so a second instance on one page names itself. */
  id: string
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
        aria-label={label ? undefined : heading}
        title={heading}
      >
        <Info className={label ? 'mr-1 h-4 w-4' : 'h-4 w-4'} />
        {label}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        {/* The guide is long by design, so it scrolls inside the dialog rather than pushing its
            own close button off the screen. dialog.tsx already caps height with dvh. */}
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>{heading}</DialogTitle>
            <DialogDescription>{guide.tagline}</DialogDescription>
          </DialogHeader>

          <div className="space-y-6 text-sm">
            <p className="text-muted-foreground leading-relaxed">{guide.summary}</p>

            {guide.sections.map((section) => (
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
                {guide.faq.map((item) => (
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
