// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { rpcMock, toastMock, supabaseMock } = vi.hoisted(() => {
  const rpc = vi.fn()
  const bucket = {
    createSignedUrls: vi.fn(async () => ({ data: [], error: null })),
    list: vi.fn(async () => ({ data: [], error: null })),
  }
  return {
    rpcMock: rpc,
    toastMock: { error: vi.fn(), success: vi.fn() },
    supabaseMock: { rpc, storage: { from: () => bucket } },
  }
})

vi.mock('@/lib/supabase/client', () => ({ createClient: () => supabaseMock }))
vi.mock('sonner', () => ({ toast: toastMock }))
// The shell needs a router and live data. These tests are about the post cards inside it.
vi.mock('@/components/shell/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }))
vi.mock('@/components/theme/theme-controls', () => ({ ThemeControls: () => null }))
vi.mock('@/components/shell/workspace-nav', () => ({ buildWorkspaceNav: () => [] }))
vi.mock('@/lib/modules', () => ({ useAppModules: () => ({}) }))
vi.mock('@/lib/use-marketing-calendars', () => ({ useMarketingCalendars: () => ({ calendars: [] }) }))

import SocialView from './social-view'
import type { CaptionVersion, SocialPost } from '@/lib/social-review'

const BOBBY = 'u-bobby'

function post(over: Partial<SocialPost> = {}): SocialPost {
  return {
    id: 'p1',
    brand: 'Shanks Realty Group',
    platform: 'facebook',
    format: 'post',
    title: 'Myth vs fact',
    caption: 'New words for the post.',
    hashtags: ['stlouis'],
    scheduled_for: null,
    media: [],
    status: 'pending',
    created_at: '2026-11-20T10:00:00+00:00',
    updated_at: '2026-11-20T10:00:00+00:00',
    ...over,
  }
}

function version(id: string, over: Partial<CaptionVersion>): CaptionVersion {
  return {
    id,
    post_id: 'p1',
    caption: '',
    hashtags: [],
    source: 'edited',
    restored_from: null,
    edited_by: BOBBY,
    created_at: '2026-11-23T10:00:00+00:00',
    ...over,
  }
}

function renderView(p: SocialPost, versions: CaptionVersion[] = []) {
  return render(
    <SocialView
      user={{ id: BOBBY, role: 'super_admin', full_name: 'Bobby Shanks' }}
      initialPosts={[p]}
      initialReviews={[]}
      initialVersions={versions}
      versionsError={null}
      people={{ [BOBBY]: 'Bobby Shanks' }}
    />,
  )
}

beforeEach(() => {
  rpcMock.mockReset()
  toastMock.error.mockReset()
  toastMock.success.mockReset()
})

describe('editing a description', () => {
  it('saves through the history RPC with the wording it started from', async () => {
    rpcMock.mockResolvedValue({
      data: [
        version('v1', { source: 'uploaded', edited_by: null, caption: 'New words for the post.', hashtags: ['stlouis'], created_at: '2026-11-23T10:00:00.000001+00:00' }),
        version('v2', { caption: 'Better words.', hashtags: ['stlouis', 'realtor'], created_at: '2026-11-23T10:00:00.000002+00:00' }),
      ],
      error: null,
    })
    renderView(post())

    fireEvent.click(screen.getByRole('button', { name: /Edit description/ }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Better words.' } })
    fireEvent.change(screen.getByLabelText('Hashtags'), { target: { value: '#stlouis, #realtor' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }))

    await waitFor(() => expect(screen.queryByLabelText('Description')).not.toBeInTheDocument())
    expect(rpcMock).toHaveBeenCalledWith('edit_social_post_caption', {
      p_post_id: 'p1',
      p_caption: 'Better words.',
      p_hashtags: ['stlouis', 'realtor'],
      p_expected_caption: 'New words for the post.',
      p_expected_hashtags: ['stlouis'],
      p_restored_from: null,
    })
    expect(screen.getByText('Better words.')).toBeInTheDocument()
    expect(screen.getByText('#stlouis #realtor')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /History/ })).toHaveTextContent('2')
  })

  it('will not save a blank or unchanged description', () => {
    renderView(post())
    fireEvent.click(screen.getByRole('button', { name: /Edit description/ }))
    const save = screen.getByRole('button', { name: 'Save description' })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: ' \n\t' } })
    expect(save).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Changed' } })
    expect(save).toBeEnabled()
  })

  it('keeps the editor open and says why when the save is refused', async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: 'This description changed since you opened it.' } })
    renderView(post())
    fireEvent.click(screen.getByRole('button', { name: /Edit description/ }))
    fireEvent.change(screen.getByLabelText('Description'), { target: { value: 'Changed' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save description' }))

    await waitFor(() =>
      expect(toastMock.error).toHaveBeenCalledWith('The description was not saved', {
        description: 'This description changed since you opened it.',
      }),
    )
    expect(screen.getByLabelText('Description')).toHaveValue('Changed')
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByText('New words for the post.')).toBeInTheDocument()
  })

  it('is not offered once a post has gone out', () => {
    renderView(post({ status: 'posted' }))
    expect(screen.getByRole('button', { name: /Edit description/ })).toBeDisabled()
  })
})

describe('description history', () => {
  const history = [
    version('v1', { source: 'uploaded', edited_by: null, caption: 'Old words for the post.', hashtags: ['stlouis'], created_at: '2026-11-22T10:00:00+00:00' }),
    version('v2', { caption: 'New words for the post.', hashtags: ['stlouis'], created_at: '2026-11-23T10:00:00+00:00' }),
  ]

  it('marks the current version and compares an older one word by word', () => {
    renderView(post(), history)
    fireEvent.click(screen.getByRole('button', { name: /History/ }))

    const [newest, oldest] = screen.getAllByTestId('caption-version')
    expect(within(newest).getByText('Bobby Shanks edited')).toBeInTheDocument()
    expect(within(newest).getByText('Current')).toBeInTheDocument()
    expect(within(newest).queryByRole('button', { name: /Restore/ })).not.toBeInTheDocument()
    expect(within(oldest).getByText('As uploaded')).toBeInTheDocument()

    fireEvent.click(within(oldest).getByRole('button', { name: /Compare/ }))
    expect(oldest.querySelector('del')).toHaveTextContent('Old')
    expect(oldest.querySelector('ins')).toHaveTextContent('New')
  })

  it('restores an older version as a new save, so nothing is lost', async () => {
    rpcMock.mockResolvedValue({
      data: [version('v3', { source: 'restored', restored_from: 'v1', caption: 'Old words for the post.', hashtags: ['stlouis'], created_at: '2026-11-24T10:00:00+00:00' })],
      error: null,
    })
    renderView(post(), history)
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    fireEvent.click(within(screen.getAllByTestId('caption-version')[1]).getByRole('button', { name: /Restore/ }))

    await waitFor(() => expect(screen.getAllByTestId('caption-version')).toHaveLength(3))
    expect(rpcMock).toHaveBeenCalledWith('edit_social_post_caption', {
      p_post_id: 'p1',
      p_caption: 'Old words for the post.',
      p_hashtags: ['stlouis'],
      p_expected_caption: 'New words for the post.',
      p_expected_hashtags: ['stlouis'],
      p_restored_from: 'v1',
    })
    const [newest] = screen.getAllByTestId('caption-version')
    expect(within(newest).getByText('Bobby Shanks restored an earlier version')).toBeInTheDocument()
    expect(within(newest).getByText('Current')).toBeInTheDocument()
  })

  it('says so when an upload changed the wording after the last edit', () => {
    renderView(post({ caption: 'Uploaded again.' }), history)
    fireEvent.click(screen.getByRole('button', { name: /History/ }))
    expect(screen.getByText(/came from an upload/)).toBeInTheDocument()
    expect(screen.queryByText('Current')).not.toBeInTheDocument()
  })
})
