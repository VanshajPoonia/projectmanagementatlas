import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ShareFile, ShareItem } from '@/lib/icloud-share'

const { auth, rpc, db, later, listShareItems, deleteObject } = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as { id: string } | null },
  rpc: { allowed: true as boolean | null },
  db: {
    project: true,
    existing: [] as Array<{ id: string; position: number }>,
    inserted: [] as Array<Record<string, unknown>>,
    insertError: null as null | { code?: string; message: string },
  },
  later: [] as Array<() => Promise<void>>,
  listShareItems: vi.fn(),
  deleteObject: vi.fn(async () => undefined),
}))

vi.mock('next/server', async (actual) => ({ ...(await actual<typeof import('next/server')>()), after: (fn: () => Promise<void>) => later.push(fn) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: auth.user } }) },
    rpc: async () => ({ data: rpc.allowed, error: null }),
    from: (table: string) => {
      if (table === 'marketing_projects') {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.project ? { id: P } : null, error: null }) }) }) }
      }
      return {
        select: () => ({ eq: () => ({ order: () => ({ range: async () => ({ data: db.existing, error: null }) }) }) }),
        insert: async (row: Record<string, unknown>) => {
          db.inserted.push(row)
          return { error: db.insertError }
        },
      }
    },
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true }))
vi.mock('@/lib/r2', () => ({
  r2Config: () => ({ accountId: 'a', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' }),
  presignPut: (_c: unknown, key: string) => `https://r2/put/${key}`,
  deleteObject,
}))
vi.mock('@/lib/icloud-share', async (actual) => ({ ...(await actual<typeof import('@/lib/icloud-share')>()), listShareItems }))

import { POST } from '@/app/api/marketing-projects/icloud/route'
import { fixedMediaId } from '@/lib/icloud-share'

const P = '11111111-1111-1111-1111-111111111111'
const LINK = 'https://share.icloud.com/photos/0b0lORNjGddgmWyqJxTL9pfeg'
const file = (path: string, type: string, width: number, height: number): ShareFile => ({ url: `https://cvws.icloud-content.com/${path}`, bytes: 1000, width, height, type })
const photo = (key: string): ShareItem => ({
  key,
  name: `${key}.HEIC`,
  video: false,
  durationSeconds: null,
  original: file(`${key}/orig`, 'public.heic', 4032, 3024),
  jpeg: file(`${key}/med`, 'public.jpeg', 1536, 2048),
  mp4: null,
  mp4Small: null,
})
const video = (key: string): ShareItem => ({
  key,
  name: `${key}.MOV`,
  video: true,
  durationSeconds: 71.2,
  original: file(`${key}/orig`, 'com.apple.quicktime-movie', 1080, 1920),
  jpeg: file(`${key}/poster`, 'public.jpeg', 1080, 1920),
  mp4: file(`${key}/mp4`, 'public.mpeg-4', 720, 1280),
  mp4Small: null,
})

let puts: Array<{ key: string; type: string }>
let expired: Set<string>
const call = (body: unknown) => POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  auth.user = { id: 'u1' }
  rpc.allowed = true
  db.project = true
  db.existing = []
  db.inserted = []
  db.insertError = null
  later.length = 0
  puts = []
  expired = new Set()
  vi.clearAllMocks()
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.startsWith('https://r2/put/')) {
        puts.push({ key: url.slice('https://r2/put/'.length), type: String((init?.headers as Record<string, string>)['content-type']) })
        return new Response(null, { status: 200 })
      }
      if (expired.has(url)) return new Response('gone', { status: 410 })
      return new Response(new Uint8Array(1234))
    }),
  )
})

describe('iCloud link import route', () => {
  it('refuses a signed-out caller and anyone outside the marketing team', async () => {
    auth.user = null
    expect((await call({ projectId: P, link: LINK })).status).toBe(401)
    auth.user = { id: 'u1' }
    rpc.allowed = false
    expect((await call({ projectId: P, link: LINK })).status).toBe(403)
  })

  it('refuses a link that is not an iCloud Photos link without calling iCloud', async () => {
    const res = await call({ projectId: P, link: 'https://example.com/photos/abcdefghijkl' })
    expect(res.status).toBe(400)
    expect(listShareItems).not.toHaveBeenCalled()
  })

  it('says so when the project is not there', async () => {
    db.project = false
    expect((await call({ projectId: P, link: LINK })).status).toBe(404)
  })

  it('passes on what iCloud said when it cannot open the link', async () => {
    listShareItems.mockRejectedValueOnce(new Error('iCloud could not open that link (ZONE_NOT_FOUND). It may have expired.'))
    const res = await call({ projectId: P, link: LINK })
    expect(res.status).toBe(502)
    expect((await res.json()).error).toMatch(/may have expired/)
  })

  it('queues only what is missing, skips what it cannot copy and replies before the work', async () => {
    const odd: ShareItem = { ...photo('C'), jpeg: null }
    listShareItems.mockResolvedValueOnce([photo('A'), video('B'), odd])
    db.existing = [{ id: fixedMediaId(P, 'A'), position: 4 }]
    const res = await call({ projectId: P, link: LINK })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ found: 3, already: 1, queued: 1, skipped: [{ name: 'C.HEIC', reason: 'iCloud has no JPEG copy of this photo' }] })
    expect(later).toHaveLength(1)
    expect(puts).toHaveLength(0)
  })

  it('copies photos before videos into R2 and files each under its fixed id, in shoot order', async () => {
    listShareItems.mockResolvedValueOnce([video('V'), photo('A')])
    db.existing = [{ id: 'x', position: 2 }]
    await call({ projectId: P, link: LINK })
    await later[0]()
    const vid = fixedMediaId(P, 'V')
    const pid = fixedMediaId(P, 'A')
    expect(puts).toEqual([
      { key: `projects/${P}/${pid}.jpg`, type: 'image/jpeg' },
      { key: `projects/${P}/${vid}.jpg`, type: 'image/jpeg' },
      { key: `projects/${P}/${vid}.mp4`, type: 'video/mp4' },
    ])
    expect(db.inserted).toEqual([
      { id: pid, project_id: P, path: `projects/${P}/${pid}.jpg`, position: 4, created_by: 'u1', kind: 'image', duration_seconds: null, width: 1536, height: 2048, bytes: 1234 },
      { id: vid, project_id: P, path: `projects/${P}/${vid}.mp4`, position: 3, created_by: 'u1', kind: 'video', duration_seconds: 71.2, width: 720, height: 1280, bytes: 1234 },
    ])
  })

  it('answers 200 and starts nothing when everything is already in', async () => {
    listShareItems.mockResolvedValueOnce([photo('A')])
    db.existing = [{ id: fixedMediaId(P, 'A'), position: 0 }]
    const res = await call({ projectId: P, link: LINK })
    expect(res.status).toBe(200)
    expect((await res.json()).queued).toBe(0)
    expect(later).toHaveLength(0)
  })

  it('removes the files of an item whose row was refused', async () => {
    listShareItems.mockResolvedValueOnce([video('V')])
    db.insertError = { message: 'nope' }
    await call({ projectId: P, link: LINK })
    await later[0]()
    const vid = fixedMediaId(P, 'V')
    expect(deleteObject).toHaveBeenCalledWith(expect.anything(), `projects/${P}/${vid}.jpg`)
    expect(deleteObject).toHaveBeenCalledWith(expect.anything(), `projects/${P}/${vid}.mp4`)
  })

  it('keeps the files when another paste of the same link filed the row first', async () => {
    listShareItems.mockResolvedValueOnce([photo('A')])
    db.insertError = { code: '23505', message: 'duplicate key' }
    await call({ projectId: P, link: LINK })
    await later[0]()
    expect(deleteObject).not.toHaveBeenCalled()
  })

  it('asks iCloud for fresh download links once when one has expired', async () => {
    const stale = photo('A')
    const fresh = { ...photo('A'), jpeg: file('A/med-fresh', 'public.jpeg', 1536, 2048) }
    listShareItems.mockResolvedValueOnce([stale, photo('B')]).mockResolvedValueOnce([fresh, photo('B')])
    expired.add(stale.jpeg!.url)
    await call({ projectId: P, link: LINK })
    await later[0]()
    expect(listShareItems).toHaveBeenCalledTimes(2)
    expect(vi.mocked(fetch)).toHaveBeenCalledWith(fresh.jpeg!.url)
    expect(db.inserted.map((r) => r.id)).toEqual(expect.arrayContaining([fixedMediaId(P, 'A'), fixedMediaId(P, 'B')]))
  })
})
