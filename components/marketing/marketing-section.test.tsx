// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/components/marketing/marketing-calendar', () => ({ default: () => <div>calendar body</div> }))
vi.mock('@/components/social/social-board-loader', () => ({ default: () => <div>post board body</div> }))
vi.mock('@/components/marketing/marketing-projects', () => ({ default: () => <div>projects body</div> }))

import MarketingSection from './marketing-section'

const props = { userId: 'u1', calendars: [], refetchCalendars: async () => {} }

afterEach(cleanup)

describe('MarketingSection', () => {
  it('starts on the calendar and swaps the content under each button', () => {
    render(<MarketingSection showSocial {...props} />)
    expect(screen.getByText('calendar body')).toBeVisible()
    expect(screen.queryByText('post board body')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /social media/i }))
    expect(screen.getByText('post board body')).toBeVisible()
    expect(screen.getByText('calendar body')).not.toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /projects/i }))
    expect(screen.getByText('projects body')).toBeVisible()
    expect(screen.queryByText('post board body')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: /calendar/i }))
    expect(screen.getByText('calendar body')).toBeVisible()
  })

  it('hides the Social media button when that module is off', () => {
    render(<MarketingSection showSocial={false} {...props} />)
    expect(screen.queryByRole('button', { name: /social media/i })).toBeNull()
    expect(screen.getByRole('button', { name: /projects/i })).toBeInTheDocument()
  })
})
