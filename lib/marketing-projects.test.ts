import { describe, expect, it } from 'vitest'
import {
  durationLabel,
  isImageFile,
  isVideoFile,
  pathsToSign,
  posterPath,
  thumbPath,
  mediaKey,
  isR2Path,
  splitPaths,
  coverOf,
  coverPosition,
  draftProblem,
  draftToRow,
  EMPTY_DRAFT,
  fitWithin,
  formatBytes,
  nextPosition,
  photoPath,
  sortPhotos,
  sortProjects,
  inRange,
  lastUploadOf,
  orderedRange,
  photosInRange,
  projectInRange,
  timestampLabel,
  type MarketingProject,
  type ProjectPhoto,
} from './marketing-projects'

const photo = (id: string, position: number): ProjectPhoto => ({
  id,
  project_id: 'p',
  path: `p/${id}.jpg`,
  kind: 'image',
  duration_seconds: null,
  caption: '',
  position,
  width: null,
  height: null,
  bytes: null,
  created_at: '2026-11-25T15:42:00+00:00',
  created_by: null,
})

const project = (id: string, over: Partial<MarketingProject> = {}): MarketingProject => ({
  id,
  name: id,
  company_id: null,
  area: null,
  completed_on: null,
  description: '',
  created_at: '2026-11-01T10:00:00+00:00',
  updated_at: '2026-11-01T10:00:00+00:00',
  ...over,
})

describe('fitWithin', () => {
  it('shrinks the long edge and keeps the shape', () => {
    expect(fitWithin(4000, 3000, 1800)).toEqual({ width: 1800, height: 1350 })
    expect(fitWithin(3000, 4000, 1800)).toEqual({ width: 1350, height: 1800 })
  })
  it('never scales up', () => {
    expect(fitWithin(800, 600, 1800)).toEqual({ width: 800, height: 600 })
  })
  it('never returns a zero edge', () => {
    expect(fitWithin(10000, 1, 1800)).toEqual({ width: 1800, height: 1 })
  })
})

describe('draftProblem', () => {
  it('needs a real name', () => {
    expect(draftProblem(EMPTY_DRAFT)).toMatch(/name/)
    expect(draftProblem({ ...EMPTY_DRAFT, name: ' \t\n' })).toMatch(/name/)
    expect(draftProblem({ ...EMPTY_DRAFT, name: 'Kitchen remodel' })).toBeNull()
  })
  it('caps the description', () => {
    expect(draftProblem({ ...EMPTY_DRAFT, name: 'x', description: 'a'.repeat(5001) })).toMatch(/5000/)
  })
})

describe('draftToRow', () => {
  it('trims and turns blanks into null', () => {
    expect(draftToRow({ name: ' Deck ', company_id: '', area: '  ', completed_on: '', description: ' Cedar. ' })).toEqual({
      name: 'Deck',
      company_id: null,
      area: null,
      completed_on: null,
      description: 'Cedar.',
    })
  })
})

describe('photos', () => {
  it('names the file after the project and photo', () => {
    expect(photoPath('proj', 'ph')).toBe('proj/ph.jpg')
  })
  it('puts the lowest position first and that one is the cover', () => {
    const list = [photo('b', 2), photo('a', 1), photo('c', 3)]
    expect(sortPhotos(list).map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(coverOf(list)?.id).toBe('a')
    expect(coverOf([])).toBeNull()
  })
  it('adds after the last and covers in front of the first', () => {
    const list = [photo('a', 1), photo('b', 4)]
    expect(nextPosition(list)).toBe(5)
    expect(coverPosition(list)).toBe(0)
    expect(nextPosition([])).toBe(0)
    expect(coverPosition([])).toBe(0)
  })
})

describe('sortProjects', () => {
  it('orders newest first by completion date, then by when it was added', () => {
    const list = [
      project('old', { completed_on: '2026-01-05' }),
      project('new', { completed_on: '2026-10-05' }),
      project('undated', { created_at: '2026-11-20T10:00:00+00:00' }),
    ]
    expect(sortProjects(list).map((p) => p.id)).toEqual(['undated', 'new', 'old'])
  })
})

describe('formatBytes', () => {
  it('reads in plain units', () => {
    expect(formatBytes(900)).toBe('900 B')
    expect(formatBytes(250 * 1024)).toBe('250 KB')
    expect(formatBytes(3.5 * 1024 * 1024)).toBe('3.5 MB')
  })
})

describe('upload timestamps and date ranges', () => {
  const at = (id: string, created_at: string): ProjectPhoto => ({ ...photo(id, 0), created_at })

  it('writes the time in the business timezone', () => {
    expect(timestampLabel('2026-11-25T21:42:00+00:00')).toBe('Nov 25, 2026, 3:42 PM CST')
    expect(timestampLabel(null)).toBe('')
    expect(timestampLabel('nonsense')).toBe('')
  })

  it('judges the day where the business is, not in UTC', () => {
    // 02:00 UTC on the 26th is still the evening of the 25th in Chicago.
    const late = '2026-11-26T02:00:00+00:00'
    expect(inRange(late, { from: '2026-11-25', to: '2026-11-25' })).toBe(true)
    expect(inRange(late, { from: '2026-11-26', to: '' })).toBe(false)
  })

  it('treats both ends as included and an empty end as open', () => {
    const range = { from: '2026-11-20', to: '2026-11-25' }
    expect(inRange('2026-11-20T18:00:00+00:00', range)).toBe(true)
    expect(inRange('2026-11-25T18:00:00+00:00', range)).toBe(true)
    expect(inRange('2026-11-26T18:00:00+00:00', range)).toBe(false)
    expect(inRange('2026-11-19T18:00:00+00:00', { from: '', to: '2026-11-20' })).toBe(true)
  })

  it('keeps every photo when no range is set and filters when one is', () => {
    const list = [at('a', '2026-11-10T18:00:00+00:00'), at('b', '2026-11-25T18:00:00+00:00')]
    expect(photosInRange(list, { from: '', to: '' })).toHaveLength(2)
    expect(photosInRange(list, { from: '2026-11-24', to: '' }).map((p) => p.id)).toEqual(['b'])
  })

  it('matches a project by its own creation day or by any photo upload day', () => {
    const old = project('old', { created_at: '2026-10-01T18:00:00+00:00' })
    const range = { from: '2026-11-24', to: '2026-11-26' }
    expect(projectInRange(old, [], range)).toBe(false)
    expect(projectInRange(old, [at('a', '2026-11-25T18:00:00+00:00')], range)).toBe(true)
    expect(projectInRange(project('new', { created_at: '2026-11-25T18:00:00+00:00' }), [], range)).toBe(true)
    expect(projectInRange(old, [], { from: '', to: '' })).toBe(true)
  })

  it('finds the newest upload and swaps a backwards range', () => {
    expect(lastUploadOf([at('a', '2026-11-10T18:00:00+00:00'), at('b', '2026-11-25T18:00:00+00:00')])).toBe('2026-11-25T18:00:00+00:00')
    expect(lastUploadOf([])).toBeNull()
    expect(orderedRange({ from: '2026-11-25', to: '2026-11-20' })).toEqual({ from: '2026-11-20', to: '2026-11-25' })
  })
})

describe('video media', () => {
  it('derives the poster path from the video path', () => {
    expect(mediaKey('p', 'm', 'mp4')).toBe('projects/p/m.mp4')
    expect(posterPath('projects/p/m.mp4')).toBe('projects/p/m.jpg')
  })

  it('shows a video by its poster and signs both files', () => {
    const video = { kind: 'video' as const, path: 'p/m.mp4' }
    const image = { kind: 'image' as const, path: 'p/i.jpg' }
    expect(thumbPath(video)).toBe('p/m.jpg')
    expect(thumbPath(image)).toBe('p/i.jpg')
    expect(pathsToSign([video, image])).toEqual(['p/m.mp4', 'p/m.jpg', 'p/i.jpg'])
  })

  it('recognises a phone video by its extension when the type is empty', () => {
    expect(isVideoFile({ name: 'IMG_1.MOV', type: '' })).toBe(true)
    expect(isVideoFile({ name: 'IMG_1.HEIC', type: '' })).toBe(false)
    expect(isImageFile({ name: 'IMG_1.HEIC', type: '' })).toBe(true)
  })

  it('writes a length as minutes and seconds', () => {
    expect(durationLabel(161)).toBe('2:41')
    expect(durationLabel(7.4)).toBe('0:07')
    expect(durationLabel(null)).toBe('')
  })
})

describe('where media lives', () => {
  it('tells R2 keys from older Supabase paths', () => {
    expect(isR2Path('projects/a/b.jpg')).toBe(true)
    expect(isR2Path('a/b.jpg')).toBe(false)
    expect(splitPaths(['a/b.jpg', 'projects/a/b.mp4'])).toEqual({ supabase: ['a/b.jpg'], r2: ['projects/a/b.mp4'] })
  })
})
