// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Keep the tests hermetic: next/link needs no router context here.
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))

import { AppSidebar, type SidebarNavGroup } from './app-sidebar'
import { Breadcrumbs } from './breadcrumbs'
import { EmptyState, PermissionDenied } from './states'

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

describe('AppSidebar', () => {
  it('renders group heading and item labels when expanded', () => {
    render(<AppSidebar groups={groups} activeId="home" collapsed={false} onToggle={() => {}} />)
    expect(screen.getByText('Work')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Home/ })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Inbox/ })).toBeInTheDocument()
  })

  it('marks the active item with aria-current', () => {
    render(<AppSidebar groups={groups} activeId="home" collapsed={false} onToggle={() => {}} />)
    expect(screen.getByRole('link', { name: /Home/ })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: /Inbox/ })).not.toHaveAttribute('aria-current')
  })

  it('shows a non-colour "soon" cue for planned items', () => {
    render(<AppSidebar groups={groups} activeId="home" collapsed={false} onToggle={() => {}} />)
    expect(screen.getByText('soon')).toBeInTheDocument()
  })

  it('hides text labels when collapsed (icon-only rail)', () => {
    render(<AppSidebar groups={groups} activeId="home" collapsed={true} onToggle={() => {}} />)
    // Labels are not rendered inline when collapsed (tooltip content is not mounted until hover).
    expect(screen.queryByText('Work')).not.toBeInTheDocument()
    // Links still exist (icon-only), so navigation is preserved.
    expect(screen.getAllByRole('link').length).toBe(2)
  })

  it('fires onToggle when the collapse button is pressed', () => {
    const onToggle = vi.fn()
    render(<AppSidebar groups={groups} activeId="home" collapsed={false} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: /Collapse sidebar/ }))
    expect(onToggle).toHaveBeenCalledTimes(1)
  })
})

describe('Breadcrumbs', () => {
  it('renders the trail and marks the last crumb as current', () => {
    render(<Breadcrumbs items={[{ label: 'Projects', href: '/projects' }, { label: 'Home' }]} />)
    expect(screen.getByText('Projects')).toBeInTheDocument()
    const current = screen.getByText('Home')
    expect(current).toHaveAttribute('aria-current', 'page')
  })

  it('renders nothing when empty', () => {
    const { container } = render(<Breadcrumbs items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })
})

describe('shell states', () => {
  it('EmptyState shows title and description', () => {
    render(<EmptyState title="No tasks yet" description="Create one to get started" />)
    expect(screen.getByText('No tasks yet')).toBeInTheDocument()
    expect(screen.getByText('Create one to get started')).toBeInTheDocument()
  })

  it('PermissionDenied explains that server rules still apply', () => {
    render(<PermissionDenied />)
    expect(screen.getByText(/don’t have access/i)).toBeInTheDocument()
    expect(screen.getByText(/Server-side rules still apply/i)).toBeInTheDocument()
  })
})
