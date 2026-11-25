#!/usr/bin/env node
// Copies Projects photos from Supabase Storage to Cloudflare R2 and repoints each row.
//
//   node --env-file=.env.production.local scripts/copy-projects-to-r2.mjs --allow-prod            (dry run)
//   node --env-file=.env.production.local scripts/copy-projects-to-r2.mjs --allow-prod --apply
//   ... --apply --delete-originals     (only after the app has been checked reading from R2)
//
// Safe to re-run: rows already on R2 are skipped. A row is repointed only after the R2 copy has
// been read back at the same size. The Supabase original is left alone unless --delete-originals.
// Needs R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, NEXT_PUBLIC_SUPABASE_URL
// and SUPABASE_SERVICE_ROLE_KEY in the environment.

import { createClient } from '@supabase/supabase-js'

import { presignGet, presignPut, r2Config } from '../lib/r2.ts'

const ARGS = process.argv.slice(2)
const APPLY = ARGS.includes('--apply')
const DELETE_ORIGINALS = ARGS.includes('--delete-originals')
const BUCKET = 'marketing-projects'
const PROD_REF = 'icyfluwgyuimhwlddjyy'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''
if (url.includes(PROD_REF) && !ARGS.includes('--allow-prod')) {
  console.error('This is the LIVE database. Pass --allow-prod to continue.')
  process.exit(1)
}
const config = r2Config()
if (!config) {
  console.error('Set R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY first.')
  process.exit(1)
}
if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_SERVICE_ROLE_KEY is missing.')
  process.exit(1)
}

const supabase = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })

const { data: rows, error } = await supabase.from('marketing_project_photos').select('id, project_id, path, kind, bytes')
if (error) {
  console.error(`Could not read the photos table: ${error.message}`)
  process.exit(1)
}

const legacy = rows.filter((r) => !r.path.startsWith('projects/'))
console.log(`${rows.length} media rows, ${rows.length - legacy.length} already on R2, ${legacy.length} to copy.${APPLY ? '' : ' (dry run, nothing changes)'}`)

let copied = 0
let failed = 0
for (const row of legacy) {
  const key = `projects/${row.path}`
  try {
    if (!APPLY) {
      console.log(`  would copy ${row.path} -> ${key}`)
      continue
    }
    const { data: blob, error: downloadError } = await supabase.storage.from(BUCKET).download(row.path)
    if (downloadError || !blob) throw new Error(downloadError?.message ?? 'download failed')
    const type = row.path.endsWith('.mp4') ? 'video/mp4' : 'image/jpeg'
    const put = await fetch(presignPut(config, key), { method: 'PUT', headers: { 'content-type': type }, body: blob })
    if (!put.ok) throw new Error(`R2 refused the upload (${put.status})`)
    const back = await fetch(presignGet(config, key))
    const size = (await back.arrayBuffer()).byteLength
    if (!back.ok || size !== blob.size) throw new Error(`read-back mismatch: sent ${blob.size}, got ${size}`)
    const { error: updateError } = await supabase.from('marketing_project_photos').update({ path: key }).eq('id', row.id)
    if (updateError) throw new Error(updateError.message)
    if (DELETE_ORIGINALS) {
      const { error: removeError } = await supabase.storage.from(BUCKET).remove([row.path])
      if (removeError) console.warn(`  copied but could not remove the original ${row.path}: ${removeError.message}`)
    }
    copied += 1
    console.log(`  copied ${row.path} (${blob.size} bytes)`)
  } catch (e) {
    failed += 1
    console.error(`  FAILED ${row.path}: ${e.message}`)
  }
}
console.log(APPLY ? `Done. ${copied} copied, ${failed} failed.` : 'Dry run finished. Add --apply to copy.')
process.exit(failed ? 1 : 0)
