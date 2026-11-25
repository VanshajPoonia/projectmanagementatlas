// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

vi.mock('./bookmarks-section', () => ({ default: () => <div>bookmark list</div> }))

import MobileBookmarks from './mobile-bookmarks'

describe('MobileBookmarks', () => {
  it('loads the list only once opened', () => {
    const { container } = render(<MobileBookmarks userId="u1" isAdmin={false} />)
    expect(screen.queryByText('bookmark list')).toBeNull()
    const details = container.querySelector('details')!
    details.open = true
    fireEvent(details, new Event('toggle'))
    expect(screen.getByText('bookmark list')).toBeTruthy()
  })
})
