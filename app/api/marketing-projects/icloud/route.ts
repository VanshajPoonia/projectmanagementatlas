import { after, NextResponse } from 'next/server'

import { fetchAllRows } from '@/lib/fetch-all-rows'
import { fixedMediaId, importCopy, isIcloudContentUrl, listShareItems, shareToken, type ShareFile, type ShareItem } from '@/lib/icloud-share'
import { VIDEO_MAX_STORED_BYTES, mediaKey, nextPosition, posterPath } from '@/lib/marketing-projects'
import { deleteObject, presignPut, r2Config, type R2Config } from '@/lib/r2'
import { checkRateLimit } from '@/lib/rate-limit'
import { createClient } from '@/lib/supabase/server'

// Imports every photo and video behind a shared iCloud Photos link into one Projects job. It runs
// on the server after the reply, so a big batch does not depend on a phone staying awake. It copies
// the JPEG and 720p MP4 that iCloud already keeps, so nothing is re-encoded here. Each item gets a
// fixed id (the same one scripts/import-icloud-link.mjs uses), so pasting a link again fills gaps.

export const maxDuration = 800
/** Stop starting new items with time to finish the ones in flight. */
const BUDGET_MS = 720_000
const WORKERS = 4
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Supabase = Awaited<ReturnType<typeof createClient>>

interface Job {
  id: string
  item: ShareItem
  position: number
  copy: Exclude<ReturnType<typeof importCopy>, { kind: 'skip' }>
}

export async function POST(request: Request) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: allowed, error: accessError } = await supabase.rpc('marketing_projects_access')
  if (accessError || allowed !== true) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  if (!checkRateLimit(`projects-icloud:${user.id}`, 10, 10 * 60_000)) {
    return NextResponse.json({ error: 'Too many imports at once. Wait a few minutes and paste it again.' }, { status: 429 })
  }

  const config = r2Config()
  if (!config) return NextResponse.json({ error: 'File storage is not set up yet.' }, { status: 503 })

  let body: { projectId?: unknown; link?: unknown }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Send JSON.' }, { status: 400 })
  }
  const projectId = typeof body.projectId === 'string' && UUID.test(body.projectId) ? body.projectId : null
  const link = typeof body.link === 'string' ? body.link.trim() : ''
  if (!projectId) return NextResponse.json({ error: 'Pick a project first.' }, { status: 400 })
  if (!shareToken(link)) return NextResponse.json({ error: 'That is not an iCloud Photos link. In Photos, use Share, then Copy iCloud Link.' }, { status: 400 })

  const { data: project } = await supabase.from('marketing_projects').select('id').eq('id', projectId).maybeSingle()
  if (!project) return NextResponse.json({ error: 'That project was not found.' }, { status: 404 })

  const existing = await fetchAllRows<{ id: string; position: number }>((from, to) =>
    supabase.from('marketing_project_photos').select('id, position').eq('project_id', projectId).order('id').range(from, to),
  )
  if (existing.error) return NextResponse.json({ error: `Could not read the project: ${existing.error.message}` }, { status: 500 })

  let items: ShareItem[]
  try {
    items = await listShareItems(link)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'iCloud could not open that link.' }, { status: 502 })
  }

  const have = new Set(existing.data!.map((p) => p.id))
  let position = nextPosition(existing.data!)
  const jobs: Job[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  for (const item of items) {
    const id = fixedMediaId(projectId, item.key)
    if (have.has(id)) continue
    const copy = importCopy(item, VIDEO_MAX_STORED_BYTES)
    if (copy.kind === 'skip') skipped.push({ name: item.name, reason: copy.reason })
    else jobs.push({ id, item, position: position++, copy })
  }

  if (jobs.length) after(() => runImport({ supabase, config, userId: user.id, projectId, link, jobs }))
  return NextResponse.json({ found: items.length, already: items.length - jobs.length - skipped.length, queued: jobs.length, skipped }, { status: jobs.length ? 202 : 200 })
}

async function download(file: ShareFile): Promise<ArrayBuffer> {
  if (!isIcloudContentUrl(file.url)) throw new Error('iCloud gave a download link to somewhere else')
  const res = await fetch(file.url)
  if (!res.ok) throw Object.assign(new Error(`iCloud said ${res.status}`), { status: res.status })
  return res.arrayBuffer()
}

async function put(config: R2Config, key: string, body: ArrayBuffer, contentType: string): Promise<void> {
  const res = await fetch(presignPut(config, key), { method: 'PUT', headers: { 'content-type': contentType }, body })
  if (!res.ok) throw new Error(`storage refused it (${res.status})`)
}

async function runImport({ supabase, config, userId, projectId, link, jobs }: { supabase: Supabase; config: R2Config; userId: string; projectId: string; link: string; jobs: Job[] }) {
  const deadline = Date.now() + BUDGET_MS
  // Download links expire, so one fresh listing is shared by every item that hits an old link.
  let fresh: Promise<Map<string, ShareItem>> | null = null
  const refreshed = async (item: ShareItem) => {
    fresh ??= listShareItems(link).then((list) => new Map(list.map((i) => [i.key, i])))
    const again = (await fresh).get(item.key)
    if (!again) throw new Error('it is no longer behind the link')
    const copy = importCopy(again, VIDEO_MAX_STORED_BYTES)
    if (copy.kind === 'skip') throw new Error(copy.reason)
    return copy
  }
  const fetchCopy = async (job: Job, pick: (copy: Job['copy']) => ShareFile | null) => {
    const file = pick(job.copy)
    if (!file) return null
    try {
      return await download(file)
    } catch (e) {
      if (!(e as { status?: number }).status) throw e
      const again = pick(await refreshed(job.item))
      return again ? download(again) : null
    }
  }

  const importOne = async (job: Job): Promise<'added' | 'already'> => {
    const video = job.copy.kind === 'video'
    const key = mediaKey(projectId, job.id, video ? 'mp4' : 'jpg')
    const uploaded: string[] = []
    try {
      if (video) {
        const poster = await fetchCopy(job, (c) => (c.kind === 'video' ? c.poster : null))
        if (poster) {
          await put(config, posterPath(key), poster, 'image/jpeg')
          uploaded.push(posterPath(key))
        }
      }
      const media = await fetchCopy(job, (c) => c.file)
      if (!media) throw new Error('iCloud sent nothing')
      await put(config, key, media, video ? 'video/mp4' : 'image/jpeg')
      uploaded.push(key)
      const { error } = await supabase.from('marketing_project_photos').insert({
        id: job.id,
        project_id: projectId,
        path: key,
        position: job.position,
        created_by: userId,
        kind: video ? 'video' : 'image',
        duration_seconds: video ? job.item.durationSeconds : null,
        width: job.copy.file.width || null,
        height: job.copy.file.height || null,
        bytes: media.byteLength,
      })
      // Another paste of the same link got there first. The file under this key is theirs too.
      if (error?.code === '23505') return 'already'
      if (error) throw new Error(error.message)
      return 'added'
    } catch (e) {
      for (const k of uploaded) await deleteObject(config, k).catch((err) => console.error(`[icloud-import] could not remove ${k}: ${err instanceof Error ? err.message : err}`))
      throw e
    }
  }

  // Photos first so the job fills in before the slow videos. Positions keep the shoot order.
  const queue = [...jobs].sort((a, b) => Number(a.copy.kind === 'video') - Number(b.copy.kind === 'video'))
  const counts = { added: 0, already: 0, failed: 0 }
  let next = 0
  const worker = async () => {
    while (next < queue.length && Date.now() < deadline) {
      const job = queue[next++]
      try {
        counts[await importOne(job)] += 1
      } catch (e) {
        counts.failed += 1
        console.error(`[icloud-import] ${projectId} ${job.item.name}: ${e instanceof Error ? e.message : e}`)
      }
    }
  }
  await Promise.all(Array.from({ length: WORKERS }, worker))
  const left = queue.length - next
  console.log(`[icloud-import] ${projectId}: ${counts.added} added, ${counts.already} already in, ${counts.failed} failed${left ? `, ${left} left for the next paste` : ''}`)
}
