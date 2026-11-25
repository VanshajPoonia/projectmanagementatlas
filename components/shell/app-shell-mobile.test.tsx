// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

// Node's own localStorage is undefined under vitest, and the shell's hooks read it on mount.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() },
})

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))
// The real topbar pulls in Supabase and the timer. Keep only the part under test.
vi.mock('./app-topbar', () => ({
  AppTopbar: ({ onOpenMenu, actions }: any) => (
    <header>
      <button aria-label="Open menu" onClick={onOpenMenu} />
      <div data-testid="topbar-actions">{actions}</div>
    </header>
  ),
}))
vi.mock('./command-palette', () => ({ CommandPalette: () => null }))

import { AppShell } from './app-shell'
import type { SidebarNavGroup } from './app-sidebar'

const item = (id: string, label: string) => ({ id, label, icon: 'home', href: `/x/${id}`, status: 'live' as const })
const user = { id: 'u1', role: 'admin' as const, full_name: 'Vanshaj', email: 'v@example.com' }

const groups: SidebarNavGroup[] = [
  { id: 'a', label: 'Work', items: ['home', 'my-work', 'inbox', 'views', 'personal'].map((id) => item(id, id)) },
  { id: 'b', label: 'Workspace', items: [item('calendar', 'Calendar'), item('marketing', 'Marketing'), item('social', 'Social media')] },
]

describe('the phone hamburger menu', () => {
  it('opens a menu listing every page, grouped, with the current one marked', () => {
    render(<AppShell user={user} groups={groups} activeId="marketing">{null}</AppShell>)
    expect(screen.queryByRole('navigation', { name: 'All pages' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    const nav = within(screen.getByRole('navigation', { name: 'All pages' }))
    expect(nav.getByRole('link', { name: 'Marketing' })).toHaveAttribute('aria-current', 'page')
    expect(nav.getByRole('link', { name: 'Social media' })).toHaveAttribute('href', '/x/social')
    expect(nav.getByRole('link', { name: 'Calendar' })).not.toHaveAttribute('aria-current')
    const menu = within(screen.getByRole('dialog'))
    expect(menu.getByText('Workspace')).toBeInTheDocument()
    expect(menu.getByText('v@example.com')).toBeInTheDocument()
  })

  it('closes after you pick a page', () => {
    render(<AppShell user={user} groups={groups} activeId="home">{null}</AppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    fireEvent.click(within(screen.getByRole('navigation', { name: 'All pages' })).getByRole('link', { name: 'Calendar' }))
    expect(screen.queryByRole('navigation', { name: 'All pages' })).toBeNull()
  })

  it('carries the account controls the top bar gives up on a phone', () => {
    render(<AppShell user={user} groups={groups} activeId="home" topbarActions={<button>Sign Out</button>}>{null}</AppShell>)
    fireEvent.click(screen.getByRole('button', { name: 'Open menu' }))
    expect(within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign Out' })).toBeInTheDocument()
  })

  it('keeps the five shortcut tabs along the bottom', () => {
    render(<AppShell user={user} groups={groups} activeId="home">{null}</AppShell>)
    const bar = screen.getAllByRole('navigation', { name: 'Primary' }).find((n) => n.className.includes('fixed'))!
    expect(within(bar).getAllByRole('link')).toHaveLength(5)
  })
})
