import { describe, expect, it } from 'vitest'

import { fixedMediaId, importCopy, isIcloudContentUrl, itemsFromRecords, shareToken, type CloudKitRecord, type ShareItem } from './icloud-share'

const MB = 1024 * 1024
const res = (prefix: string, type: string, width: number, height: number, bytes: number) => ({
  [`${prefix}Res`]: { value: { downloadURL: `https://cvws.icloud-content.com/B/${prefix}/\${f}?o=1`, size: bytes } },
  [`${prefix}FileType`]: { value: type },
  [`${prefix}Width`]: { value: width },
  [`${prefix}Height`]: { value: height },
  [`${prefix}FileSize`]: { value: bytes },
})
const name = (n: string) => ({ filenameEnc: { value: Buffer.from(n).toString('base64') } })
const asset = (recordName: string, master: string, extra: Record<string, unknown> = {}): CloudKitRecord => ({
  recordName,
  recordType: 'CPLAsset',
  fields: { masterRef: { value: { recordName: master } }, ...Object.fromEntries(Object.entries(extra).map(([k, v]) => [k, { value: v }])) },
})
const master = (recordName: string, fields: Record<string, unknown>): CloudKitRecord => ({ recordName, recordType: 'CPLMaster', fields: fields as CloudKitRecord['fields'] })

const RECORDS: CloudKitRecord[] = [
  asset('A1', 'M1'),
  master('M1', { ...name('IMG_0001.HEIC'), ...res('resOriginal', 'public.heic', 4032, 3024, 2 * MB), ...res('resJPEGMed', 'public.jpeg', 1536, 2048, 0.9 * MB) }),
  asset('A2', 'M2', { duration: 71173 }),
  master('M2', {
    ...name('IMG_0002.MOV'),
    ...res('resOriginal', 'com.apple.quicktime-movie', 1080, 1920, 170 * MB),
    ...res('resJPEGMed', 'public.jpeg', 1080, 1920, 0.2 * MB),
    ...res('resVidMed', 'public.mpeg-4', 720, 1280, 31 * MB),
    ...res('resVidSmall', 'public.mpeg-4', 360, 640, 9 * MB),
  }),
  asset('A3', 'M3'),
  master('M3', { ...name('scan.jpg'), ...res('resOriginal', 'public.jpeg', 1536, 2048, 1 * MB) }),
  // An asset whose master did not come back in the page is left out rather than guessed at.
  asset('A4', 'missing'),
]

describe('shareToken', () => {
  it('reads the token from a Copy iCloud Link link', () => {
    expect(shareToken('https://share.icloud.com/photos/0b0lORNjGddgmWyqJxTL9pfeg')).toBe('0b0lORNjGddgmWyqJxTL9pfeg')
    expect(shareToken(' https://share.icloud.com/photos/0b0lORNjGddgmWyqJxTL9pfeg/?x=1 ')).toBe('0b0lORNjGddgmWyqJxTL9pfeg')
    expect(shareToken('https://www.icloud.com/photos/#/0b0lORNjGddgmWyqJxTL9pfeg')).toBe('0b0lORNjGddgmWyqJxTL9pfeg')
  })

  it('refuses anything that is not an iCloud Photos link', () => {
    for (const bad of ['', 'http://share.icloud.com/photos/0b0lORNjGddgmWyqJxTL9pfeg', 'https://evil.com/photos/0b0lORNjGddgmWyqJxTL9pfeg', 'https://www.icloud.com/sharedalbum/#B0aGWZuqDGHnrZV', 'https://share.icloud.com/photos/../x']) {
      expect(shareToken(bad)).toBeNull()
    }
  })
})

describe('isIcloudContentUrl', () => {
  it('only accepts https links on iCloud content hosts', () => {
    expect(isIcloudContentUrl('https://cvws-h2.icloud-content.com/B/abc')).toBe(true)
    expect(isIcloudContentUrl('http://cvws-h2.icloud-content.com/B/abc')).toBe(false)
    expect(isIcloudContentUrl('https://icloud-content.com.evil.com/B/abc')).toBe(false)
    expect(isIcloudContentUrl('not a url')).toBe(false)
  })
})

describe('fixedMediaId', () => {
  it('matches the ids the first iCloud imports were stored under', () => {
    expect(fixedMediaId('11111111-1111-1111-1111-111111111111', 'AXyz-record')).toBe('ee490050-efb2-5990-bf16-e73c90ba024c')
  })
})

describe('itemsFromRecords', () => {
  const items = itemsFromRecords(RECORDS)

  it('pairs each item with its master, in order, and drops orphans', () => {
    expect(items.map((i) => [i.key, i.name, i.video])).toEqual([
      ['A1', 'IMG_0001.HEIC', false],
      ['A2', 'IMG_0002.MOV', true],
      ['A3', 'scan.jpg', false],
    ])
  })

  it('fills the file name into the download link and keeps sizes', () => {
    expect(items[0].jpeg).toEqual({ url: 'https://cvws.icloud-content.com/B/resJPEGMed/IMG_0001.HEIC?o=1', bytes: 0.9 * MB, width: 1536, height: 2048, type: 'public.jpeg' })
  })

  it('reads a video length in seconds and leaves photos without one', () => {
    expect(items[1].durationSeconds).toBe(71.2)
    expect(items[0].durationSeconds).toBeNull()
  })
})

describe('importCopy', () => {
  const [heic, mov, jpeg] = itemsFromRecords(RECORDS)

  it("uses iCloud's JPEG for a photo, or the original when it is already a JPEG", () => {
    expect(importCopy(heic, 250 * MB)).toMatchObject({ kind: 'image', file: { type: 'public.jpeg', width: 1536 } })
    expect(importCopy(jpeg, 250 * MB)).toMatchObject({ kind: 'image', file: jpeg.original })
  })

  it('skips a photo iCloud has no JPEG of', () => {
    const noJpeg: ShareItem = { ...heic, jpeg: null }
    expect(importCopy(noJpeg, 250 * MB).kind).toBe('skip')
  })

  it('uses the 720p MP4 with its poster, and falls back to the small one when that is too big', () => {
    expect(importCopy(mov, 250 * MB)).toMatchObject({ kind: 'video', file: { width: 720 }, poster: { width: 1080 } })
    expect(importCopy(mov, 20 * MB)).toMatchObject({ kind: 'video', file: { width: 360 } })
    expect(importCopy(mov, 5 * MB).kind).toBe('skip')
  })

  it('never stores a QuickTime copy as MP4', () => {
    const quicktime: ShareItem = { ...mov, mp4: { ...mov.mp4!, type: 'com.apple.quicktime-movie' }, mp4Small: null }
    expect(importCopy(quicktime, 250 * MB).kind).toBe('skip')
  })
})
