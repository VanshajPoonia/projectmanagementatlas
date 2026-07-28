// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { fromMock, getUserMock, toastError, toastSuccess } = vi.hoisted(() => ({
  fromMock: vi.fn(),
  getUserMock: vi.fn(),
  toastError: vi.fn(),
  toastSuccess: vi.fn(),
}))

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    from: fromMock,
    auth: { getUser: getUserMock },
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    error: toastError,
    success: toastSuccess,
  },
}))

import { ShareLinkDialog } from './share-link-dialog'

type QueryResult = {
  data: unknown
  error: { message: string } | null
}

function makeQuery(result: QueryResult) {
  const query: Record<string, any> = {}
  for (const method of ['select', 'eq', 'is', 'order', 'insert', 'update']) {
    query[method] = vi.fn(() => query)
  }
  query.maybeSingle = vi.fn(() => Promise.resolve(result))
  query.then = (
    resolve: (value: QueryResult) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(result).then(resolve, reject)
  return query
}

const activeLink = {
  id: 'link-1',
  token: 'a'.repeat(64),
  expires_at: null,
  revoked_at: null,
  created_at: '2026-07-28T12:00:00.000Z',
}

describe('ShareLinkDialog', () => {
  const writeText = vi.fn()

  beforeEach(() => {
    fromMock.mockReset()
    getUserMock.mockReset()
    toastError.mockReset()
    toastSuccess.mockReset()
    writeText.mockReset()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    Object.defineProperty(globalThis.crypto, 'randomUUID', {
      configurable: true,
      value: vi
        .fn()
        .mockReturnValueOnce('11111111-1111-4111-8111-111111111111')
        .mockReturnValueOnce('22222222-2222-4222-8222-222222222222'),
    })
  })

  it('shows a load failure and lets the user retry', async () => {
    fromMock
      .mockImplementationOnce(() => makeQuery({ data: null, error: { message: 'Network unavailable' } }))
      .mockImplementationOnce(() => makeQuery({ data: [], error: null }))

    render(<ShareLinkDialog resourceType="board" resourceId="board-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Network unavailable')
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))

    expect(await screen.findByText('No active links yet.')).toBeInTheDocument()
  })

  it('creates, lists, and copies a view-only link', async () => {
    const insertQuery = makeQuery({ data: null, error: null })
    fromMock
      .mockImplementationOnce(() => makeQuery({ data: [], error: null }))
      .mockImplementationOnce(() => insertQuery)
      .mockImplementationOnce(() => makeQuery({ data: [activeLink], error: null }))
    getUserMock.mockResolvedValue({
      data: { user: { id: 'user-1' } },
      error: null,
    })

    render(<ShareLinkDialog resourceType="task" resourceId="task-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await screen.findByText('No active links yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Create link' }))

    await waitFor(() => {
      expect(insertQuery.insert).toHaveBeenCalledWith(expect.objectContaining({
        resource_type: 'task',
        resource_id: 'task-1',
        created_by: 'user-1',
      }))
      expect(writeText).toHaveBeenCalledWith(expect.stringMatching(/\/share\/[a-f0-9]{64}$/))
    })
    expect(await screen.findByDisplayValue(`http://localhost:3000/share/${activeLink.token}`)).toBeInTheDocument()
    expect(toastSuccess).toHaveBeenCalledWith('View-only link created & copied to clipboard')
  })

  it('removes a link after a confirmed revocation', async () => {
    const revokeQuery = makeQuery({ data: { id: activeLink.id }, error: null })
    fromMock
      .mockImplementationOnce(() => makeQuery({ data: [activeLink], error: null }))
      .mockImplementationOnce(() => revokeQuery)

    render(<ShareLinkDialog resourceType="board" resourceId="board-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await screen.findByDisplayValue(`http://localhost:3000/share/${activeLink.token}`)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }))

    await waitFor(() => {
      expect(revokeQuery.update).toHaveBeenCalledWith({
        revoked_at: expect.any(String),
      })
      expect(screen.queryByDisplayValue(`http://localhost:3000/share/${activeLink.token}`)).not.toBeInTheDocument()
    })
    expect(toastSuccess).toHaveBeenCalledWith('Link revoked')
  })

  it('does not claim success when revocation updates no row', async () => {
    fromMock
      .mockImplementationOnce(() => makeQuery({ data: [activeLink], error: null }))
      .mockImplementationOnce(() => makeQuery({ data: null, error: null }))
      .mockImplementationOnce(() => makeQuery({ data: [activeLink], error: null }))

    render(<ShareLinkDialog resourceType="board" resourceId="board-1" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await screen.findByDisplayValue(`http://localhost:3000/share/${activeLink.token}`)
    fireEvent.click(screen.getByRole('button', { name: 'Revoke link' }))

    await waitFor(() => {
      expect(toastError).toHaveBeenCalledWith('Could not revoke link', expect.any(Object))
      expect(screen.getByDisplayValue(`http://localhost:3000/share/${activeLink.token}`)).toBeInTheDocument()
    })
    expect(toastSuccess).not.toHaveBeenCalledWith('Link revoked')
  })
})
