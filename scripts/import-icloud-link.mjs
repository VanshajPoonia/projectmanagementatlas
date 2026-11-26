#!/usr/bin/env node
// Imports every photo and video behind an iCloud Photos link (share.icloud.com/photos/...) into one
// Marketing Projects job, for when a phone upload of a big batch is too slow.
//
//   node --env-file=.env.production.local scripts/import-icloud-link.mjs <link> "<project name>" --allow-prod          (dry run)
//   node --env-file=.env.production.local scripts/import-icloud-link.mjs <link> "<project name>" --allow-prod --apply
//   ... --as <email>     who the uploads are credited to (default the super admin)
//   ... --limit <n>      import only the first n, to check one before the rest
//   ... --skip <names>   leave out these files, comma separated, e.g. smaller copies of a clip also shared as a MOV
//
// macOS only: sips, avconvert and ffmpeg do the shrinking, to the same limits as the browser. Each item
// gets a fixed id, so a re-run skips what is already in. Only one item is on disk at a time.

import { execFile } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import { createClient } from '@supabase/supabase-js'

import { fixedMediaId, listShareItems } from '../lib/icloud-share.ts'
import { deleteObject, presignPut, r2Config } from '../lib/r2.ts'
import { assertMigrationTarget } from './guard-db.mjs'

const run = promisify(execFile)
const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const flag = (name) => (ARGS.includes(name) ? ARGS[ARGS.indexOf(name) + 1] : undefined)
const AS_EMAIL = flag('--as') ?? 'vanshaj.admin@goatlasgo.us'
const LIMIT = Number(flag('--limit') ?? Infinity)
const SKIP = new Set((flag('--skip') ?? '').split(',').map((n) => n.trim().toLowerCase()).filter(Boolean))
const [LINK, PROJECT_NAME] = ARGS.filter((a, i) => !a.startsWith('--') && !['--as', '--limit', '--skip'].includes(ARGS[i - 1]))

// Same limits as lib/marketing-projects.ts and lib/video-compress.ts.
const PHOTO_MAX_EDGE = 1800
const POSTER_WIDTH = 640
const KEEP_AS_IS_BYTES = 20 * 1024 * 1024
const VIDEO_MAX_STORED_BYTES = 250 * 1024 * 1024
const SRGB = '/System/Library/ColorSync/Profiles/sRGB Profile.icc'

if (!LINK || !PROJECT_NAME) {
  console.error('Usage: import-icloud-link.mjs <iCloud link> "<project name>" --allow-prod [--apply] [--as <email>]')
  process.exit(1)
}
assertMigrationTarget({ allowProd: ARGS.includes('--allow-prod') })
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
const config = r2Config()
if (!config) {
  console.error('Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY first.')
  process.exit(1)
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is missing.')
  process.exit(1)
}

/** Every item behind the link, with the original file to shrink here. */
async function listItems(link) {
  return (await listShareItems(link)).map((i) => ({ key: i.key, name: i.name, video: i.video, bytes: i.original.bytes, download: i.original.url }))
}

async function probe(file) {
  const { stdout } = await run('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,color_transfer:format=duration', '-of', 'json', file])
  const info = JSON.parse(stdout)
  const video = info.streams.find((s) => s.codec_type === 'video')
  return { width: video?.width, height: video?.height, codec: video?.codec_name, hdr: /b67|smpte2084/.test(video?.color_transfer ?? ''), duration: Number(info.format?.duration) || 0 }
}

/** sips decodes HEIC and moves it to sRGB, then ffmpeg turns it upright and fits it in 1800 px. */
async function shrinkPhoto(source, dir) {
  const srgb = path.join(dir, 'srgb.jpg')
  const out = path.join(dir, 'photo.jpg')
  await run('sips', ['-s', 'format', 'jpeg', '-s', 'formatOptions', '95', '--matchTo', SRGB, source, '--out', srgb])
  const fit = `scale=w='min(${PHOTO_MAX_EDGE},iw)':h='min(${PHOTO_MAX_EDGE},ih)':force_original_aspect_ratio=decrease`
  await run('ffmpeg', ['-v', 'error', '-y', '-i', srgb, '-vf', fit, '-q:v', '3', out])
  const { width, height } = await probe(out)
  return { file: out, width, height }
}

/** avconvert turns HDR iPhone video into plain 1080p H.264, then ffmpeg moves the index to the front for streaming. */
async function shrinkVideo(source, dir) {
  const original = await probe(source)
  let encoded = source
  const small = original.codec === 'h264' && !original.hdr && statSync(source).size <= KEEP_AS_IS_BYTES
  if (!small) {
    encoded = path.join(dir, 'encoded.mp4')
    await run('avconvert', ['--source', source, '--preset', 'Preset1920x1080', '--output', encoded, '--replace'], { maxBuffer: 1 << 24 })
  }
  const out = path.join(dir, 'video.mp4')
  await run('ffmpeg', ['-v', 'error', '-y', '-i', encoded, '-map', '0:v:0', '-map', '0:a:0?', '-c', 'copy', '-movflags', '+faststart', out])
  if (statSync(out).size > VIDEO_MAX_STORED_BYTES) throw new Error('still over 250 MB after shrinking')
  const { width, height, duration } = await probe(out)
  const poster = path.join(dir, 'poster.jpg')
  await run('ffmpeg', ['-v', 'error', '-y', '-ss', String(Math.min(1, duration / 2)), '-i', out, '-frames:v', '1', '-vf', `scale='min(${POSTER_WIDTH},iw)':-2`, '-q:v', '4', poster])
  return { file: out, poster, width, height, duration }
}

async function download(from, to) {
  const res = await fetch(from)
  if (!res.ok) throw Object.assign(new Error(`download said ${res.status}`), { status: res.status })
  writeFileSync(to, Buffer.from(await res.arrayBuffer()))
}

async function put(key, file, contentType) {
  const res = await fetch(presignPut(config, key), { method: 'PUT', headers: { 'content-type': contentType }, body: readFileSync(file) })
  if (!res.ok) throw new Error(`R2 refused ${key} (${res.status})`)
}

const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: matches, error: projectError } = await supabase.from('marketing_projects').select('id, name').ilike('name', `%${PROJECT_NAME}%`)
if (projectError) throw new Error(projectError.message)
if (matches.length !== 1) {
  console.error(`"${PROJECT_NAME}" matches ${matches.length} projects${matches.length ? `: ${matches.map((p) => p.name).join(', ')}` : ''}. Name exactly one.`)
  process.exit(1)
}
const project = matches[0]
const { data: uploader } = await supabase.from('profiles').select('id, full_name').eq('email', AS_EMAIL).maybeSingle()
if (!uploader) {
  console.error(`No profile for ${AS_EMAIL}.`)
  process.exit(1)
}
const { data: existing, error: photosError } = await supabase.from('marketing_project_photos').select('id, position').eq('project_id', project.id)
if (photosError) throw new Error(photosError.message)

let items = await listItems(LINK)
const have = new Set(existing.map((p) => p.id))
let position = existing.length ? Math.max(...existing.map((p) => p.position)) + 1 : 0
// Positions follow the shoot order, but photos run first so the job fills in before the slow videos.
const plan = items.map((item) => ({ ...item, id: fixedMediaId(project.id, item.key) })).filter((item) => !have.has(item.id) && !SKIP.has(item.name.toLowerCase())).map((item) => ({ ...item, position: position++ }))
plan.sort((a, b) => Number(a.video) - Number(b.video))
const skipped = items.filter((item) => SKIP.has(item.name.toLowerCase()) && !have.has(fixedMediaId(project.id, item.key))).length
const already = items.length - plan.length - skipped
plan.splice(LIMIT)
const videos = plan.filter((i) => i.video).length
console.log(`${project.name}: ${items.length} items behind the link, ${already} already in, ${skipped} skipped, ${plan.length - videos} photos and ${videos} videos to import as ${uploader.full_name}.${APPLY ? '' : ' (dry run)'}`)

let added = 0
let failed = 0
for (const [n, item] of plan.entries()) {
  const label = `[${n + 1}/${plan.length}] ${item.name}`
  if (!APPLY) {
    console.log(`  would import ${label} (${(item.bytes / 1e6).toFixed(1)} MB) at position ${item.position}`)
    continue
  }
  const dir = mkdtempSync(path.join(tmpdir(), 'icloud-import-'))
  const uploaded = []
  try {
    const source = path.join(dir, `source${path.extname(item.name).toLowerCase()}`)
    try {
      await download(item.download, source)
    } catch (e) {
      if (!e.status) throw e
      items = await listItems(LINK)
      await download(items.find((i) => i.key === item.key).download, source)
    }
    const key = `projects/${project.id}/${item.id}.${item.video ? 'mp4' : 'jpg'}`
    let row
    if (item.video) {
      const shrunk = await shrinkVideo(source, dir)
      await put(key.replace(/\.mp4$/, '.jpg'), shrunk.poster, 'image/jpeg')
      uploaded.push(key.replace(/\.mp4$/, '.jpg'))
      await put(key, shrunk.file, 'video/mp4')
      uploaded.push(key)
      row = { kind: 'video', duration_seconds: Math.round(shrunk.duration * 10) / 10, width: shrunk.width, height: shrunk.height, bytes: statSync(shrunk.file).size }
    } else {
      const shrunk = await shrinkPhoto(source, dir)
      await put(key, shrunk.file, 'image/jpeg')
      uploaded.push(key)
      row = { kind: 'image', width: shrunk.width, height: shrunk.height, bytes: statSync(shrunk.file).size }
    }
    const { error } = await supabase.from('marketing_project_photos').insert({ id: item.id, project_id: project.id, path: key, position: item.position, created_by: uploader.id, ...row })
    if (error) throw new Error(error.message)
    added += 1
    console.log(`  ${label} -> ${(row.bytes / 1e6).toFixed(1)} MB ${row.width}x${row.height}`)
  } catch (e) {
    failed += 1
    console.error(`  FAILED ${label}: ${e.message}`)
    for (const key of uploaded) await deleteObject(config, key).catch((err) => console.error(`  could not remove ${key}: ${err.message}`))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
console.log(APPLY ? `Done. ${added} imported, ${failed} failed.` : 'Dry run finished. Add --apply to import.')
process.exit(failed ? 1 : 0)
