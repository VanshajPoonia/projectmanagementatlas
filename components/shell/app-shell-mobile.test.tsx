// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'

vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={typeof href === 'string' ? href : '#'} {...props}>
      {children}
    </a>
  ),
}))
// Node's own localStorage is undefined under vitest, and the shell's hooks read it on mount.
const store = new Map<string, string>()
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k), clear: () => store.clear() },
})
Object.defineProperty(window, 'matchMedia', {
  configurable: true,
  value: (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, onchange: null, dispatchEvent: () => false }),
})

vi.mock('./app-topbar', () => ({ AppTopbar: () => null }))
vi.mock('./command-palette', () => ({ CommandPalette: () => null }))

import { AppShell } from './app-shell'
import type { SidebarNavGroup } from './app-sidebar'

const item = (id: string, label: string) => ({ id, label, icon: 'home', href: `/x/${id}`, status: 'live' as const })
const user = { id: 'u1', role: 'admin' as const }

const many: SidebarNavGroup[] = [
  { id: 'a', label: 'Work', items: ['home', 'my-work', 'inbox', 'views', 'personal'].map((id) => item(id, id)) },
  { id: 'b', label: 'Workspace', items: [item('calendar', 'Calendar'), item('marketing', 'Marketing'), item('social', 'Social media')] },
]

function bottomBar() {
  return screen.getAllByRole('navigation', { name: 'Primary' }).find((n) => n.className.includes('fixed'))!
}

describe('AppShell on a phone', () => {
  it('keeps four tabs and a More tab when there is more than five places to go', () => {
    render(<AppShell user={user} groups={many} activeId="home">{null}</AppShell>)
    const bar = within(bottomBar())
    expect(bar.getAllByRole('link')).toHaveLength(4)
    expect(bar.getByRole('button', { name: /More/ })).toBeInTheDocument()
  })

  it('lists every destination, including the ones that were hidden, in the drawer', () => {
    render(<AppShell user={user} groups={many} activeId="marketing">{null}</AppShell>)
    fireEvent.click(within(bottomBar()).getByRole('button', { name: /More/ }))
    expect(screen.getByRole('link', { name: 'Marketing' })).toHaveAttribute('href', '/x/marketing')
    expect(screen.getByRole('link', { name: 'Social media' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Marketing' })).toHaveAttribute('aria-current', 'page')
  })

  it('marks More as the current tab when the open page lives inside it', () => {
    render(<AppShell user={user} groups={many} activeId="marketing">{null}</AppShell>)
    expect(within(bottomBar()).getByRole('button', { name: /More/ })).toHaveAttribute('aria-current', 'page')
  })

  it('shows all five tabs and no More when five is everything there is', () => {
    render(<AppShell user={user} groups={[many[0]]} activeId="home">{null}</AppShell>)
    const bar = within(bottomBar())
    expect(bar.getAllByRole('link')).toHaveLength(5)
    expect(bar.queryByRole('button', { name: /More/ })).toBeNull()
  })
})
