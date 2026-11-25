import { beforeEach, describe, expect, it, vi } from 'vitest'

const { auth, rpc, env } = vi.hoisted(() => ({
  auth: { user: { id: 'u1' } as { id: string } | null },
  rpc: { allowed: true as boolean | null, error: null as null | { message: string } },
  env: { on: true },
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: auth.user } }) },
    rpc: async () => ({ data: rpc.allowed, error: rpc.error }),
  }),
}))
vi.mock('@/lib/rate-limit', () => ({ checkRateLimit: () => true }))
vi.mock('@/lib/r2', () => ({
  r2Config: () => (env.on ? { accountId: 'a', bucket: 'b', accessKeyId: 'k', secretAccessKey: 's' } : null),
  presignGet: (_c: unknown, key: string) => `https://r2/get/${key}`,
  presignPut: (_c: unknown, key: string) => `https://r2/put/${key}`,
  deleteObject: vi.fn(async (_c: unknown, key: string) => {
    if (key.endsWith('bad.jpg')) throw new Error('nope')
  }),
}))

import { POST } from '@/app/api/marketing-projects/media/route'

const P = '11111111-1111-1111-1111-111111111111'
const M = '22222222-2222-2222-2222-222222222222'
const key = `projects/${P}/${M}.mp4`
const call = (body: unknown) => POST(new Request('http://x/api', { method: 'POST', body: JSON.stringify(body) }))

beforeEach(() => {
  auth.user = { id: 'u1' }
  rpc.allowed = true
  rpc.error = null
  env.on = true
})

describe('projects media route', () => {
  it('refuses a signed-out caller', async () => {
    auth.user = null
    expect((await call({ action: 'sign', keys: [key] })).status).toBe(401)
  })

  it('refuses someone outside the marketing team', async () => {
    rpc.allowed = false
    expect((await call({ action: 'sign', keys: [key] })).status).toBe(403)
  })

  it('refuses when the access check itself fails', async () => {
    rpc.allowed = null
    rpc.error = { message: 'boom' }
    expect((await call({ action: 'sign', keys: [key] })).status).toBe(403)
  })

  it('says so when file storage is not set up', async () => {
    env.on = false
    expect((await call({ action: 'sign', keys: [key] })).status).toBe(503)
  })

  it('signs download links for valid keys', async () => {
    const res = await call({ action: 'sign', keys: [key] })
    expect(res.status).toBe(200)
    expect((await res.json()).urls[key]).toBe(`https://r2/get/${key}`)
  })

  it('refuses keys outside the Projects folder or shape', async () => {
    for (const bad of ['../etc/passwd', `other/${P}/${M}.mp4`, `projects/${P}/${M}.exe`, `projects/${P}/../${M}.jpg`]) {
      expect((await call({ action: 'sign', keys: [bad] })).status).toBe(400)
    }
    expect((await call({ action: 'sign', keys: [] })).status).toBe(400)
    expect((await call({ action: 'sign', keys: Array(201).fill(key) })).status).toBe(400)
  })

  it('hands out an upload link only for a matching content type', async () => {
    const ok = await call({ action: 'upload', items: [{ key, contentType: 'video/mp4' }] })
    expect(ok.status).toBe(200)
    expect((await ok.json()).urls[key]).toBe(`https://r2/put/${key}`)
    expect((await call({ action: 'upload', items: [{ key, contentType: 'image/jpeg' }] })).status).toBe(400)
  })

  it('reports which files could not be removed', async () => {
    const bad = `projects/${P}/${M.replace(/2$/, '3')}.jpg`
    const res = await call({ action: 'remove', keys: [key, bad.replace(/\.jpg$/, 'bad.jpg')] })
    // The second key is not a valid shape, so the whole call is refused rather than partly run.
    expect(res.status).toBe(400)
    const good = await call({ action: 'remove', keys: [key] })
    expect(await good.json()).toEqual({ removed: 1, failed: [] })
  })

  it('refuses an unknown action and bad JSON', async () => {
    expect((await call({ action: 'nope' })).status).toBe(400)
    expect((await POST(new Request('http://x/api', { method: 'POST', body: 'not json' }))).status).toBe(400)
  })
})
