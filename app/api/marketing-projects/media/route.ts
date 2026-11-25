import { NextResponse } from 'next/server'

import { createClient } from '@/lib/supabase/server'
import { checkRateLimit } from '@/lib/rate-limit'
import { R2_KEY_PATTERN } from '@/lib/marketing-projects'
import { deleteObject, presignGet, presignPut, r2Config } from '@/lib/r2'

// Hands out short-lived links for Projects media in Cloudflare R2. R2 sits outside Supabase's row
// rules, so this route is the only door: it asks the database whether the caller may work with
// Projects (the same function every Projects policy uses) before it signs anything.

const MAX_KEYS = 200
const CONTENT_TYPE: Record<string, string> = { jpg: 'image/jpeg', mp4: 'video/mp4' }

type Body =
  | { action: 'sign'; keys: string[] }
  | { action: 'upload'; items: Array<{ key: string; contentType: string }> }
  | { action: 'remove'; keys: string[] }

function validKeys(keys: unknown): keys is string[] {
  return Array.isArray(keys) && keys.length > 0 && keys.length <= MAX_KEYS && keys.every((k) => typeof k === 'string' && R2_KEY_PATTERN.test(k))
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: allowed, error: accessError } = await supabase.rpc('marketing_projects_access')
  if (accessError || allowed !== true) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!checkRateLimit(`projects-media:${user.id}`, 120, 60_000)) {
    return NextResponse.json({ error: 'Too many requests, please slow down.' }, { status: 429 })
  }

  const config = r2Config()
  if (!config) return NextResponse.json({ error: 'File storage is not set up yet.' }, { status: 503 })

  let body: Body
  try {
    body = (await request.json()) as Body
  } catch {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 400 })
  }

  if (body.action === 'sign') {
    if (!validKeys(body.keys)) return NextResponse.json({ error: 'Those files are not valid.' }, { status: 400 })
    return NextResponse.json({ urls: Object.fromEntries(body.keys.map((k) => [k, presignGet(config, k)])) })
  }

  if (body.action === 'upload') {
    const items = body.items
    const keys = Array.isArray(items) ? items.map((i) => i?.key) : []
    if (!validKeys(keys)) return NextResponse.json({ error: 'Those files are not valid.' }, { status: 400 })
    const mismatch = items.some((i) => CONTENT_TYPE[i.key.slice(i.key.lastIndexOf('.') + 1).toLowerCase()] !== i.contentType)
    if (mismatch) return NextResponse.json({ error: 'Only JPEG photos and MP4 videos can be uploaded.' }, { status: 400 })
    return NextResponse.json({ urls: Object.fromEntries(items.map((i) => [i.key, presignPut(config, i.key)])) })
  }

  if (body.action === 'remove') {
    if (!validKeys(body.keys)) return NextResponse.json({ error: 'Those files are not valid.' }, { status: 400 })
    const results = await Promise.allSettled(body.keys.map((k) => deleteObject(config, k)))
    const failed = body.keys.filter((_, i) => results[i].status === 'rejected')
    return NextResponse.json({ removed: body.keys.length - failed.length, failed })
  }

  return NextResponse.json({ error: 'Unknown action.' }, { status: 400 })
}
