import { describe, expect, it } from 'vitest'
import {
  canSubmitReview,
  captionWithTags,
  countByStatus,
  groupReviewImages,
  isBlank,
  isUpdatedForReview,
  reviewImagePath,
  reviewImageProblem,
  reviewNeedsNote,
  sortForReview,
  type SocialPost,
  type SocialReview,
} from './social-review'

function post(id: string, over: Partial<SocialPost> = {}): SocialPost {
  return {
    id,
    brand: 'ATLAS General Contracting',
    platform: 'facebook',
    format: 'reel',
    title: id,
    caption: '',
    hashtags: [],
    scheduled_for: null,
    media: [],
    status: 'pending',
    created_at: '2026-11-17T10:00:00Z',
    updated_at: '2026-11-17T10:00:00Z',
    ...over,
  }
}

function review(post_id: string, decision: SocialReview['decision'], created_at: string): SocialReview {
  return { id: `${post_id}-${created_at}`, post_id, reviewer_id: 'bobby', decision, note: decision === 'approved' ? null : 'note', created_at }
}

describe('review notes', () => {
  it('lets an approval through without a note', () => {
    expect(reviewNeedsNote('approved')).toBe(false)
    expect(canSubmitReview('approved', '')).toBe(true)
  })

  it('needs a real note to reject, ask for changes or comment', () => {
    for (const d of ['rejected', 'changes_requested', 'comment'] as const) {
      expect(canSubmitReview(d, '')).toBe(false)
      expect(canSubmitReview(d, '\t\n  ')).toBe(false)
      expect(canSubmitReview(d, 'Use the other photo')).toBe(true)
    }
  })

  it('treats whitespace of any kind as blank, like the database check', () => {
    expect(isBlank(' \t\n')).toBe(true)
    expect(isBlank(null)).toBe(true)
    expect(isBlank('ok')).toBe(false)
  })
})

describe('countByStatus', () => {
  it('counts every status', () => {
    const counts = countByStatus([post('a'), post('b', { status: 'approved' }), post('c', { status: 'approved' })])
    expect(counts).toEqual({ pending: 1, approved: 2, changes_requested: 0, rejected: 0, posted: 0 })
  })
})

describe('sortForReview', () => {
  it('puts the soonest first and unscheduled last', () => {
    const sorted = sortForReview([
      post('late', { scheduled_for: '2026-12-07T14:00:00Z' }),
      post('none'),
      post('soon', { scheduled_for: '2026-11-19T14:00:00Z' }),
    ])
    expect(sorted.map((p) => p.id)).toEqual(['soon', 'late', 'none'])
  })
})

describe('captionWithTags', () => {
  it('adds hashtags after a blank line', () => {
    expect(captionWithTags({ caption: 'Done. ', hashtags: ['goATLASgo', 'roofing'] })).toBe('Done.\n\n#goATLASgo #roofing')
    expect(captionWithTags({ caption: 'Done.', hashtags: [] })).toBe('Done.')
  })
})

describe('isUpdatedForReview', () => {
  it('is false for a post nobody has touched since upload', () => {
    expect(isUpdatedForReview(post('a'), [])).toBe(false)
  })

  it('is true when the post changed after upload and nobody has decided yet', () => {
    expect(isUpdatedForReview(post('a', { updated_at: '2026-11-20T09:00:00Z' }), [])).toBe(true)
  })

  it('is true when the post changed after the latest decision', () => {
    const p = post('a', { status: 'changes_requested', updated_at: '2026-11-20T09:00:00Z' })
    expect(isUpdatedForReview(p, [review('a', 'changes_requested', '2026-11-19T16:27:00Z')])).toBe(true)
  })

  it('clears once a decision lands after the change, the way the trigger stamps it', () => {
    const p = post('a', { status: 'approved', updated_at: '2026-11-21T08:00:00Z' })
    expect(isUpdatedForReview(p, [review('a', 'approved', '2026-11-21T08:00:00Z')])).toBe(false)
  })

  it('ignores comments and other posts', () => {
    const p = post('a', { updated_at: '2026-11-20T09:00:00Z' })
    const reviews = [review('a', 'comment', '2026-11-20T10:00:00Z'), review('b', 'approved', '2026-11-20T11:00:00Z')]
    expect(isUpdatedForReview(p, reviews)).toBe(true)
  })
})

describe('review images', () => {
  const id = '3f1c2a9e-8b7d-4c6a-9f10-2b3c4d5e6f70'

  it('takes JPG and PNG up to the bucket limit and nothing else', () => {
    expect(reviewImageProblem({ type: 'image/jpeg', size: 1000 })).toBeNull()
    expect(reviewImageProblem({ type: 'image/png', size: 52428800 })).toBeNull()
    expect(reviewImageProblem({ type: 'image/png', size: 52428801 })).toBe('That image is over 50 MB.')
    expect(reviewImageProblem({ type: 'image/heic', size: 1000 })).toBe('Use a JPG or PNG image.')
    expect(reviewImageProblem({ type: 'image/webp', size: 1000 })).toBe('Use a JPG or PNG image.')
  })

  it('names the file after the review so the two stay tied', () => {
    expect(reviewImagePath(id, 1, 'image/jpeg')).toBe(`reviews/${id}_1.jpg`)
    expect(reviewImagePath(id, 2, 'image/png')).toBe(`reviews/${id}_2.png`)
  })

  it('groups listed files by review in upload order and skips anything else', () => {
    const other = '00000000-0000-0000-0000-000000000001'
    expect(groupReviewImages([`${id}_10.jpg`, `${id}_2.png`, `${other}_1.jpg`, '.emptyFolderPlaceholder', 'stray.jpg'])).toEqual({
      [id]: [`reviews/${id}_2.png`, `reviews/${id}_10.jpg`],
      [other]: [`reviews/${other}_1.jpg`],
    })
  })
})
