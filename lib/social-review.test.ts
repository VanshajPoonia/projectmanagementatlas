import { describe, expect, it } from 'vitest'
import {
  canSaveCaption,
  canSubmitReview,
  captionWithTags,
  countByStatus,
  groupReviewImages,
  isBlank,
  isUpdatedForReview,
  reviewImagePath,
  reviewImageProblem,
  reviewNeedsNote,
  parseHashtags,
  formatHashtags,
  sortForReview,
  sortVersions,
  versionLabel,
  wordDiff,
  type CaptionVersion,
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

describe('parseHashtags', () => {
  it('strips the #, splits on spaces and commas, and drops repeats', () => {
    expect(parseHashtags('#stlouis, realtor  ##stlouis\n#STLouis #homes')).toEqual(['stlouis', 'realtor', 'homes'])
  })

  it('round-trips through formatHashtags', () => {
    expect(parseHashtags(formatHashtags(['goATLASgo', 'roofing']))).toEqual(['goATLASgo', 'roofing'])
    expect(parseHashtags('   ')).toEqual([])
  })
})

describe('canSaveCaption', () => {
  const current = { caption: 'Old words', hashtags: ['a'] }

  it('needs a real change', () => {
    expect(canSaveCaption(current, { caption: 'Old words', hashtags: ['a'] })).toBe(false)
    expect(canSaveCaption(current, { caption: 'Old words', hashtags: ['a', 'b'] })).toBe(true)
    expect(canSaveCaption(current, { caption: 'New words', hashtags: ['a'] })).toBe(true)
  })

  it('refuses a blank or oversized caption, like save_social_caption', () => {
    expect(canSaveCaption(current, { caption: '\t\n ', hashtags: ['a'] })).toBe(false)
    expect(canSaveCaption(current, { caption: 'x'.repeat(5001), hashtags: ['a'] })).toBe(false)
    expect(canSaveCaption(current, { caption: 'x'.repeat(5000), hashtags: ['a'] })).toBe(true)
  })
})

describe('caption versions', () => {
  const v = (id: string, over: Partial<CaptionVersion>): CaptionVersion => ({
    id,
    post_id: 'p1',
    caption: id,
    hashtags: [],
    source: 'edited',
    restored_from: null,
    edited_by: 'u1',
    created_at: '2026-11-23T10:00:00.000Z',
    ...over,
  })

  it('sorts newest first, and keeps two rows from one save in the order written', () => {
    // Ids sort the other way on purpose: only the microseconds can put these in order.
    const rows = [
      v('a', { created_at: '2026-11-23T10:00:00.123402+00:00' }),
      v('z', { created_at: '2026-11-23T10:00:00.1234+00:00', source: 'uploaded' }),
      v('c', { created_at: '2026-11-24T09:00:00+00:00' }),
    ]
    expect(sortVersions(rows).map((r) => r.id)).toEqual(['c', 'a', 'z'])
  })

  it('names who saved each version', () => {
    const people = { u1: 'Bobby Shanks' }
    expect(versionLabel(v('a', { source: 'uploaded', edited_by: null }), people)).toBe('As uploaded')
    expect(versionLabel(v('b', {}), people)).toBe('Bobby Shanks edited')
    expect(versionLabel(v('c', { source: 'restored' }), people)).toBe('Bobby Shanks restored an earlier version')
    expect(versionLabel(v('d', { edited_by: null }), people)).toBe('Someone edited')
  })
})

describe('wordDiff', () => {
  const text = (parts: ReturnType<typeof wordDiff>, kind: 'same' | 'added' | 'removed') =>
    parts.filter((p) => p.kind !== (kind === 'added' ? 'removed' : 'added')).map((p) => p.text).join('')

  it('marks the words that changed and keeps the rest', () => {
    const parts = wordDiff('New roof in Imperial today.', 'New deck in Imperial this week.')
    expect(parts).toEqual([
      { kind: 'same', text: 'New ' },
      { kind: 'removed', text: 'roof' },
      { kind: 'added', text: 'deck' },
      { kind: 'same', text: ' in Imperial ' },
      { kind: 'removed', text: 'today.' },
      { kind: 'added', text: 'this week.' },
    ])
  })

  it('rebuilds both sides exactly, line breaks included', () => {
    const before = 'Line one.\n\nCall 636.275.6060'
    const after = 'Line one, updated.\n\nCall 636.275.6060 today'
    const parts = wordDiff(before, after)
    expect(text(parts, 'removed')).toBe(before)
    expect(text(parts, 'added')).toBe(after)
  })

  it('handles empty sides', () => {
    expect(wordDiff('', 'Hi there')).toEqual([{ kind: 'added', text: 'Hi there' }])
    expect(wordDiff('Hi', '')).toEqual([{ kind: 'removed', text: 'Hi' }])
    expect(wordDiff('Same', 'Same')).toEqual([{ kind: 'same', text: 'Same' }])
  })
})
