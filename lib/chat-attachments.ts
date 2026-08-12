// Direct-message attachments.
//
// Until migration 092 the `chat-attachments` bucket was PUBLIC, and the client stored
// the resulting public CDN URL on chat_messages.image_url — a permanent, credential-free
// link to a private DM attachment. Objects are now addressed by storage path and
// rendered through short-lived signed URLs, with the object policies scoping reads to
// the sender, the recipient, and admins.
//
// 10 MB rather than the 50 MB task-attachment ceiling: chat is for quick shares, and
// the whole Supabase Free storage budget is 1 GB.

import {
  extensionByMimeType,
  formatUploadSize,
  resolveUploadMimeType,
  UPLOAD_ACCEPT,
  type UploadCandidate,
  type UploadMimeType,
} from './upload-mime'

export const CHAT_ASSET_BUCKET = 'chat-attachments'
export const MAX_CHAT_ATTACHMENT_BYTES = 10 * 1024 * 1024
export const CHAT_ASSET_SIGNED_URL_SECONDS = 300

// Video and Photoshop files are excluded from the bucket's allowlist in 092 — the
// accept hint is narrowed to match so the picker does not offer what the DB refuses.
const CHAT_EXCLUDED: string[] = [
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'image/vnd.adobe.photoshop',
  'application/postscript',
]

export const CHAT_ATTACHMENT_ACCEPT = UPLOAD_ACCEPT
  .split(',')
  .filter(entry => !CHAT_EXCLUDED.includes(entry) && !['.mp4', '.mov', '.webm', '.psd', '.ai', '.eps'].includes(entry))
  .join(',')

export const formatChatAttachmentSize = formatUploadSize

export function resolveChatAttachmentMimeType(
  file: Pick<UploadCandidate, 'name' | 'type'>,
): UploadMimeType | null {
  const mimeType = resolveUploadMimeType(file)
  if (!mimeType || CHAT_EXCLUDED.includes(mimeType)) return null
  return mimeType
}

/** Returns an error string to show the user, or null when the file is acceptable. */
export function validateChatAttachment(file: UploadCandidate): string | null {
  if (file.size <= 0) return 'This file is empty.'
  if (!resolveChatAttachmentMimeType(file)) {
    return 'Choose an image, PDF, Office, text, or ZIP file.'
  }
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    return 'Choose a file no larger than 10 MB.'
  }
  return null
}

/**
 * Storage path for a chat attachment. The leading segment MUST be the sender's id —
 * 092's object policies read it back with storage.foldername(name)[1] to decide who
 * may upload and delete.
 */
export function buildChatAssetPath(
  senderId: string,
  mimeType: UploadMimeType,
  assetId = crypto.randomUUID(),
) {
  return `${senderId}/${assetId}.${extensionByMimeType[mimeType]}`
}

/** Messages whose body the old client wrote for an image send. */
export function isImageMessage(message: { message?: string | null; mime_type?: string | null }) {
  return message.message === 'Image' || message.message === '📷 Image'
}
