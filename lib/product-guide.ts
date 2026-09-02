// The shape of an in-product guide, and nothing else.
//
// ⚠️ Extracted from lib/agile-guide.ts when the strategy module needed a guide of its own. The
// alternative was a second GuideSection interface and a second dialog rendering it, which is
// this codebase's single most expensive recurring shape - two copies of one idea, drifting.
// The guides themselves stay in their own modules; only the vocabulary is shared.
//
// Pure data. No React, no imports.

export interface GuideSection {
  id: string
  heading: string
  /** One or two sentences. The point of the section, before any detail. */
  body: string
  /** Numbered when order matters (setup), bulleted when it does not. */
  steps?: string[]
  ordered?: boolean
  /** The caveat somebody hits on day two. */
  note?: string
}

export interface GuideQuestion {
  q: string
  a: string
}

export interface ProductGuide {
  title: string
  tagline: string
  /** The short version, shown before the sections and used as the dialog description. */
  summary: string
  sections: GuideSection[]
  faq: GuideQuestion[]
}
