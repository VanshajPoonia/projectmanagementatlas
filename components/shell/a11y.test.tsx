// @vitest-environment jsdom
//
// Automated accessibility checks - ATLAS_02 Prompt A's "accessibility automation" item, and
// the one thing on its verification list that a human pass keeps missing because the failures
// are invisible: a control with no accessible name, a state carried only by colour, a
// heading order that skips a level.
//
// WHAT THIS CAN AND CANNOT DO. axe finds machine-checkable violations only, which is roughly
// a third of WCAG. It cannot tell whether a label is *meaningful*, whether focus order makes
// sense, or whether a 320px layout is usable. Those stay manual, and the browser passes in
// this slice cover them. Nothing here should be read as "the shell is accessible" - only as
// "these specific defects are not present, and cannot come back unnoticed".
//
// jsdom computes no layout, so colour-contrast is skipped: axe would report every rule as
// incomplete rather than pass, which is noise, not signal. Contrast is a real-browser check.

import { describe, expect, it, vi } from 'vitest'
import { render } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import axe, { type Result } from 'axe-core'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

import { AppSidebar, type SidebarNavGroup } from './app-sidebar'
import { Breadcrumbs } from './breadcrumbs'
import { FavoriteStar } from './favorite-star'
import { EmptyState, ErrorState, LoadingRows, PermissionDenied } from './states'

/**
 * Run axe over a rendered tree and return the violations, formatted so a failure names the
 * rule and the element rather than dumping the whole report.
 */
async function violationsOf(ui: React.ReactElement): Promise<string[]> {
  const { container } = render(ui)
  const results = await axe.run(container, {
    rules: {
      // No layout in jsdom, so this can only ever report "incomplete".
      'color-contrast': { enabled: false },
      // Fragments are rendered detached from a document skeleton; landmark and
      // page-structure rules are meaningless on a single component and are covered by the
      // real-browser pass instead.
      region: { enabled: false },
      'page-has-heading-one': { enabled: false },
      'landmark-one-main': { enabled: false },
    },
  })
  return results.violations.map(
    (v: Result) => `${v.id}: ${v.help} - ${v.nodes.map((n) => n.html).join(' | ')}`,
  )
}

const groups: SidebarNavGroup[] = [
  {
    id: 'core',
    label: 'Work',
    items: [
      { id: 'home', label: 'Home', icon: 'home', href: '/dashboard?tab=home', status: 'live' },
      { id: 'inbox', label: 'Inbox', icon: 'bell', href: '/inbox', status: 'planned' },
    ],
  },
]

describe('shell accessibility (axe)', () => {
  it('AppSidebar has no violations when expanded', async () => {
    expect(
      await violationsOf(
        <AppSidebar groups={groups} activeId="home" collapsed={false} onToggle={() => {}} />,
      ),
    ).toEqual([])
  })

  // The collapsed rail is icon-only, which is exactly where accessible names go missing.
  it('AppSidebar has no violations when collapsed to icons', async () => {
    expect(
      await violationsOf(
        <AppSidebar groups={groups} activeId="home" collapsed={true} onToggle={() => {}} />,
      ),
    ).toEqual([])
  })

  it('AppSidebar has no violations with Favourites and Recent populated', async () => {
    expect(
      await violationsOf(
        <AppSidebar
          groups={groups}
          activeId="home"
          collapsed={false}
          onToggle={() => {}}
          favorites={[{ key: 'board:1', label: 'Atlas Rebuild', href: '/dashboard/board/1' }]}
          recent={[{ label: 'SRG Listings', href: '/dashboard/board/2' }]}
        />,
      ),
    ).toEqual([])
  })

  it('Breadcrumbs have no violations', async () => {
    expect(
      await violationsOf(
        <Breadcrumbs items={[{ label: 'Projects', href: '/projects' }, { label: 'Home' }]} />,
      ),
    ).toEqual([])
  })

  it('every UX state renders without violations', async () => {
    expect(await violationsOf(<EmptyState title="No boards yet" description="Ask an admin." />)).toEqual([])
    expect(await violationsOf(<PermissionDenied />)).toEqual([])
    expect(await violationsOf(<ErrorState />)).toEqual([])
    expect(await violationsOf(<LoadingRows />)).toEqual([])
  })

  it('FavoriteStar has no violations in either state', async () => {
    expect(
      await violationsOf(<FavoriteStar active={false} label="Atlas Rebuild" onToggle={() => {}} />),
    ).toEqual([])
    expect(
      await violationsOf(<FavoriteStar active={true} label="Atlas Rebuild" onToggle={() => {}} />),
    ).toEqual([])
  })
})

describe('non-colour state cues', () => {
  // axe cannot check this - "the only difference is gold vs grey" is not a machine-detectable
  // violation - so it is asserted directly. A user who cannot distinguish the two colours
  // still needs to know whether a board is starred.
  it('FavoriteStar carries its state in aria-pressed and its name, not only in colour', () => {
    const { getByRole, rerender } = render(
      <FavoriteStar active={false} label="Atlas Rebuild" onToggle={() => {}} />,
    )
    const off = getByRole('button')
    expect(off).toHaveAttribute('aria-pressed', 'false')
    expect(off).toHaveAccessibleName('Add Atlas Rebuild to favourites')

    rerender(<FavoriteStar active={true} label="Atlas Rebuild" onToggle={() => {}} />)
    const on = getByRole('button')
    expect(on).toHaveAttribute('aria-pressed', 'true')
    expect(on).toHaveAccessibleName('Remove Atlas Rebuild from favourites')
  })

  it('the loading state announces itself rather than being a silent grey block', () => {
    const { getByRole } = render(<LoadingRows />)
    const status = getByRole('status')
    expect(status).toHaveAttribute('aria-busy', 'true')
    expect(status).toHaveTextContent('Loading')
  })

  it('a planned nav item says "soon" in text, not by styling alone', () => {
    const { getByText } = render(
      <AppSidebar groups={groups} activeId="home" collapsed={false} onToggle={() => {}} />,
    )
    expect(getByText('soon')).toBeInTheDocument()
  })
})


describe('active navigation state is not carried by colour alone', () => {
  // WCAG 1.4.1. `aria-current` covered assistive tech from the start; what was missing was
  // the visual half - both bars marked the active destination with a text/background
  // colour and nothing else, which vanishes for anyone whose accent sits near the muted
  // foreground.
  const groups = [
    {
      id: 'sections',
      label: 'Workspace',
      items: [
        { id: 'home', label: 'Home', icon: 'home', href: '/dashboard?tab=tasks', status: 'live' as const },
        { id: 'boards', label: 'Boards', icon: 'kanban', href: '/dashboard?tab=boards', status: 'live' as const },
      ],
    },
  ]

  it('marks the active sidebar item with aria-current and a shape, not only a colour', () => {
    const { container } = render(
      <AppSidebar groups={groups} activeId="boards" collapsed={false} onToggle={() => {}} />,
    )
    const active = container.querySelector('[aria-current="page"]')
    expect(active).not.toBeNull()
    // A non-text child element carrying the marker - the rule is "something other than the
    // colour of the label itself".
    expect(active!.querySelector('span[aria-hidden="true"]')).not.toBeNull()
    expect(active!.className).toContain('font-semibold')
  })

  it('leaves inactive items without the marker, so it means something', () => {
    const { container } = render(
      <AppSidebar groups={groups} activeId="boards" collapsed={false} onToggle={() => {}} />,
    )
    const links = [...container.querySelectorAll('a')]
    const inactive = links.find((link) => !link.hasAttribute('aria-current'))
    expect(inactive).toBeDefined()
    expect(inactive!.className).not.toContain('font-semibold')
  })
})
