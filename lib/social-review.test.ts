import { describe, expect, it } from 'vitest'
import { canSubmitReview, captionWithTags, countByStatus, isBlank, reviewNeedsNote, sortForReview, type SocialPost } from './social-review'

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
    ...over,
  }
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
