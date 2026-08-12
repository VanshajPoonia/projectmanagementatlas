import { describe, expect, it } from 'vitest'
import {
  buildChatAssetPath,
  CHAT_ATTACHMENT_ACCEPT,
  MAX_CHAT_ATTACHMENT_BYTES,
  validateChatAttachment,
} from './chat-attachments'

describe('chat attachment limits', () => {
  it('allows up to 50 MB — the Supabase Free per-file ceiling (migration 093)', () => {
    expect(MAX_CHAT_ATTACHMENT_BYTES).toBe(50 * 1024 * 1024)
    expect(validateChatAttachment({
      name: 'clip.mp4', type: 'video/mp4', size: MAX_CHAT_ATTACHMENT_BYTES,
    })).toBeNull()
  })

  it('refuses anything past that ceiling', () => {
    expect(validateChatAttachment({
      name: 'huge.mp4', type: 'video/mp4', size: MAX_CHAT_ATTACHMENT_BYTES + 1,
    })).toMatch(/50 MB/)
  })

  it('accepts video and design files, which 092 had excluded before 093 widened it', () => {
    for (const file of [
      { name: 'clip.mov', type: 'video/quicktime' },
      { name: 'art.psd', type: 'image/vnd.adobe.photoshop' },
      { name: 'vector.ai', type: 'application/postscript' },
    ]) {
      expect(validateChatAttachment({ ...file, size: 20 * 1024 * 1024 })).toBeNull()
    }
    // The picker must offer them too, or the DB would accept what the UI hides.
    expect(CHAT_ATTACHMENT_ACCEPT).toContain('video/mp4')
    expect(CHAT_ATTACHMENT_ACCEPT).toContain('.psd')
  })

  it('still rejects unsupported and empty files', () => {
    expect(validateChatAttachment({ name: 'installer.exe', type: 'application/x-msdownload', size: 100 }))
      .toMatch(/image, video/)
    expect(validateChatAttachment({ name: 'empty.png', type: 'image/png', size: 0 })).toMatch(/empty/)
  })

  it('keeps every object under the sender folder the object policy reads back', () => {
    expect(buildChatAssetPath('sender-1', 'image/png', 'asset-2')).toBe('sender-1/asset-2.png')
  })
})
