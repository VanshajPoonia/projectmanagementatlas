import { describe, expect, it } from 'vitest'
import {
  buildTaskAssetPath,
  isLargeAttachment,
  MAX_INLINE_ATTACHMENT_BYTES,
  MAX_LARGE_ATTACHMENT_BYTES,
  maxAttachmentBytes,
  validateTaskAttachment,
} from './task-attachments'

const admin = { large: false, isAdmin: true }
const member = { large: false, isAdmin: false }

describe('task attachment size limits', () => {
  it('keeps the inline path at 10 MB for everyone, admin included', () => {
    const justOver = { name: 'deck.pdf', type: 'application/pdf', size: MAX_INLINE_ATTACHMENT_BYTES + 1 }
    expect(validateTaskAttachment(justOver, member)).toMatch(/less than 10MB/)
    expect(validateTaskAttachment(justOver, admin)).toMatch(/less than 10MB/)

    const atLimit = { ...justOver, size: MAX_INLINE_ATTACHMENT_BYTES }
    expect(validateTaskAttachment(atLimit, member)).toBeNull()
  })

  it('points a member at the admin opt-in rather than just refusing', () => {
    expect(validateTaskAttachment(
      { name: 'video.mp4', type: 'video/mp4', size: 20 * 1024 * 1024 },
      member,
    )).toMatch(/Large file/)
  })

  it('lets an admin who opted in go to 50 MB', () => {
    const big = { name: 'launch.mp4', type: 'video/mp4', size: 40 * 1024 * 1024 }
    expect(validateTaskAttachment(big, { large: true, isAdmin: true })).toBeNull()
    expect(validateTaskAttachment(
      { ...big, size: MAX_LARGE_ATTACHMENT_BYTES },
      { large: true, isAdmin: true },
    )).toBeNull()
  })

  it('stops at 50 MB - the Supabase Free plan ceiling the bucket also enforces', () => {
    expect(validateTaskAttachment(
      { name: 'huge.mp4', type: 'video/mp4', size: MAX_LARGE_ATTACHMENT_BYTES + 1 },
      { large: true, isAdmin: true },
    )).toMatch(/50 MB/)
  })

  it('refuses to raise the cap for a non-admin who flips the flag', () => {
    // The client can only hide the toggle; this is the belt to RLS's braces.
    expect(validateTaskAttachment(
      { name: 'launch.mp4', type: 'video/mp4', size: 40 * 1024 * 1024 },
      { large: true, isAdmin: false },
    )).toMatch(/Only admins/)
    expect(maxAttachmentBytes({ large: true, isAdmin: false })).toBe(MAX_INLINE_ATTACHMENT_BYTES)
    expect(maxAttachmentBytes({ large: true, isAdmin: true })).toBe(MAX_LARGE_ATTACHMENT_BYTES)
  })

  it('rejects empty files on either path', () => {
    expect(validateTaskAttachment({ name: 'empty.png', type: 'image/png', size: 0 }, member))
      .toMatch(/empty/)
    expect(validateTaskAttachment({ name: 'empty.png', type: 'image/png', size: 0 }, { large: true, isAdmin: true }))
      .toMatch(/empty/)
  })
})

describe('task attachment file types', () => {
  it('applies the MIME allowlist to the large path only', () => {
    const exe = { name: 'installer.exe', type: 'application/x-msdownload', size: 1024 }
    // Inline uploads have never been type-restricted; narrowing them now would
    // break attachments that work today.
    expect(validateTaskAttachment(exe, member)).toBeNull()
    expect(validateTaskAttachment(exe, { large: true, isAdmin: true })).toMatch(/image, video/)
  })

  it('accepts a large file the browser gave no MIME type for, via its extension', () => {
    expect(validateTaskAttachment(
      { name: 'shoot.heic', type: '', size: 20 * 1024 * 1024 },
      { large: true, isAdmin: true },
    )).toBeNull()
  })
})

describe('task asset storage paths', () => {
  it('puts the object under its task id, which the object policies read back', () => {
    expect(buildTaskAssetPath('task-123', 'application/pdf', 'asset-456'))
      .toBe('task-123/asset-456.pdf')
  })

  it('tells the two attachment flavours apart by storage_path', () => {
    expect(isLargeAttachment({ storage_path: 'task-1/a.pdf' })).toBe(true)
    expect(isLargeAttachment({ storage_path: null })).toBe(false)
  })
})
