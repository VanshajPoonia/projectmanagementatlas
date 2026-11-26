// Reads a shared iCloud Photos link (share.icloud.com/photos/...) through CloudKit's public web
// service, the same calls icloud.com makes. Used by the Projects link import and by
// scripts/import-icloud-link.mjs, which loads it with Node's type stripping, so no @/ imports here.

import { createHash } from 'node:crypto'

const CLOUDKIT = 'https://ckdatabasews.icloud.com/database/1/com.apple.photos.cloud/production'
const PAGE_SIZE = 64

/** Bigger than any JPEG iCloud makes of a photo, so anything past it is not a photo we want. */
export const PHOTO_COPY_MAX_BYTES = 25 * 1024 * 1024

export interface ShareFile {
  url: string
  bytes: number
  width: number
  height: number
  /** A UTI such as public.jpeg or public.mpeg-4. */
  type: string
}

export interface ShareItem {
  /** CloudKit's record name for the item. It stays the same for the life of the link. */
  key: string
  name: string
  video: boolean
  durationSeconds: number | null
  original: ShareFile
  /** iCloud's own JPEG, at most 2048 px and already upright. */
  jpeg: ShareFile | null
  /** iCloud's H.264 copies of a video, 720p and smaller. */
  mp4: ShareFile | null
  mp4Small: ShareFile | null
}

type Fields = Record<string, { value?: unknown } | undefined>

export interface CloudKitRecord {
  recordName: string
  recordType: string
  fields: Fields
}

/** The token in a Photos "Copy iCloud Link" link, or null for anything else. */
export function shareToken(link: string): string | null {
  const match = /^https:\/\/(?:share\.icloud\.com\/photos\/|www\.icloud\.com\/photos\/#\/?)([0-9A-Za-z_-]{10,64})\/?(?:[?#].*)?$/.exec(link.trim())
  return match ? match[1] : null
}

export function isIcloudContentUrl(url: string): boolean {
  try {
    const u = new URL(url)
    return u.protocol === 'https:' && u.hostname.endsWith('.icloud-content.com')
  } catch {
    return false
  }
}

/** A UUID fixed by the project and the iCloud item, so the same item never goes in twice. */
export function fixedMediaId(projectId: string, itemKey: string): string {
  const h = createHash('sha1').update(`${projectId}:${itemKey}`).digest('hex')
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

function shareFile(fields: Fields, res: string, name: string): ShareFile | null {
  const asset = fields[`${res}Res`]?.value as { downloadURL?: string; size?: number } | undefined
  if (!asset?.downloadURL) return null
  return {
    url: asset.downloadURL.replace('${f}', encodeURIComponent(name)),
    bytes: Number(fields[`${res}FileSize`]?.value ?? asset.size ?? 0),
    width: Number(fields[`${res}Width`]?.value ?? 0),
    height: Number(fields[`${res}Height`]?.value ?? 0),
    type: String(fields[`${res}FileType`]?.value ?? ''),
  }
}

/** Pairs each item with its master record, in the order CloudKit returned them (oldest first). */
export function itemsFromRecords(records: CloudKitRecord[]): ShareItem[] {
  const masters = new Map(records.filter((r) => r.recordType === 'CPLMaster').map((r) => [r.recordName, r.fields]))
  const items: ShareItem[] = []
  for (const asset of records) {
    if (asset.recordType !== 'CPLAsset') continue
    const master = masters.get((asset.fields.masterRef?.value as { recordName?: string } | undefined)?.recordName ?? '')
    const name = master ? Buffer.from(String(master.filenameEnc?.value ?? ''), 'base64').toString() : ''
    const original = master && shareFile(master, 'resOriginal', name)
    if (!master || !original) continue
    const video = original.type === 'com.apple.quicktime-movie' || original.type === 'public.mpeg-4'
    const ms = Number(asset.fields.duration?.value)
    items.push({
      key: asset.recordName,
      name: name || asset.recordName,
      video,
      durationSeconds: video && ms > 0 ? Math.round(ms / 100) / 10 : null,
      original,
      jpeg: shareFile(master, 'resJPEGMed', name),
      mp4: shareFile(master, 'resVidMed', name),
      mp4Small: shareFile(master, 'resVidSmall', name),
    })
  }
  return items
}

export type ImportCopy =
  | { kind: 'image'; file: ShareFile }
  | { kind: 'video'; file: ShareFile; poster: ShareFile | null }
  | { kind: 'skip'; reason: string }

/** Which ready-made iCloud copy goes into Projects, so nothing has to be re-encoded. */
export function importCopy(item: ShareItem, maxVideoBytes: number): ImportCopy {
  if (item.video) {
    const mp4 = [item.mp4, item.mp4Small].find((f) => f && f.type === 'public.mpeg-4' && f.bytes > 0 && f.bytes <= maxVideoBytes)
    return mp4 ? { kind: 'video', file: mp4, poster: item.jpeg } : { kind: 'skip', reason: 'iCloud has no copy of this video small enough to play here' }
  }
  const jpeg = item.jpeg ?? (item.original.type === 'public.jpeg' ? item.original : null)
  if (!jpeg || jpeg.bytes > PHOTO_COPY_MAX_BYTES) return { kind: 'skip', reason: 'iCloud has no JPEG copy of this photo' }
  return { kind: 'image', file: jpeg }
}

async function cloudkit(endpoint: string, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(endpoint, { method: 'POST', headers: { 'content-type': 'text/plain', origin: 'https://www.icloud.com' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`iCloud said ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.json()
}

/** Every item behind the link, oldest first. Download links expire, so call it again for fresh ones. */
export async function listShareItems(link: string): Promise<ShareItem[]> {
  const token = shareToken(link)
  if (!token) throw new Error('That is not an iCloud Photos link. In Photos, use Share, then Copy iCloud Link.')
  const { results } = (await cloudkit(`${CLOUDKIT}/public/records/resolve?remapEnums=true`, { shortGUIDs: [{ value: token }] })) as {
    results?: Array<{ reason?: string; zoneID?: unknown; anonymousPublicAccess?: { databasePartition: string; token: string }; rootRecord?: { fields: Fields } }>
  }
  const share = results?.[0]
  if (!share?.anonymousPublicAccess) throw new Error(`iCloud could not open that link (${share?.reason ?? 'no reply'}). It may have expired.`)
  const host = share.anonymousPublicAccess.databasePartition.replace(/:443$/, '')
  const auth = encodeURIComponent(share.anonymousPublicAccess.token)
  const total = Number(share.rootRecord?.fields.assetCount?.value ?? 0)
  const records: CloudKitRecord[] = []
  for (let rank = 0; rank < total; ) {
    const page = (await cloudkit(`${host}/database/1/com.apple.photos.cloud/production/shared/records/query?remapEnums=true&publicAccessAuthToken=${auth}`, {
      query: {
        recordType: 'CPLAssetAndMasterByAssetDateWithoutHiddenOrDeleted',
        filterBy: [
          { fieldName: 'direction', comparator: 'EQUALS', fieldValue: { value: 'ASCENDING', type: 'STRING' } },
          { fieldName: 'startRank', comparator: 'EQUALS', fieldValue: { value: rank, type: 'INT64' } },
        ],
      },
      zoneID: share.zoneID,
      resultsLimit: PAGE_SIZE,
    })) as { records?: CloudKitRecord[] }
    const pageRecords = page.records ?? []
    const assets = pageRecords.filter((r) => r.recordType === 'CPLAsset').length
    if (!assets) break
    records.push(...pageRecords)
    rank += assets
  }
  return itemsFromRecords(records)
}
