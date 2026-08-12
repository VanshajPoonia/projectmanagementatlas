// Direct-message attachments.
//
// Until migration 092 the `chat-attachments` bucket was PUBLIC, and the client stored
// the resulting public CDN URL on chat_messages.image_url — a permanent, credential-free
// link to a private DM attachment. Objects are now addressed by storage path and
// rendered through short-lived signed URLs, with the object policies scoping reads to
// the sender, the recipient, and admins.
//
// 50 MB and the full shared type list, matching task attachments exactly (migration
// 093, owner decision). 50 MB is the Supabase **Free plan's hard per-file ceiling** —
// a bucket's limit cannot exceed the project-wide upload limit, and on Free that
// cannot be raised at all, so this is the maximum without changing plan. Bear in mind
// total storage on Free is 1 GB across every bucket: about 20 files at full size.

import {
  extensionByMimeType,
  formatUploadSize,
  resolveUploadMimeType,
  UPLOAD_ACCEPT,
  type UploadCandidate,
  type UploadMimeType,
} from './upload-mime'

export const CHAT_ASSET_BUCKET = 'chat-attachments'
export const MAX_CHAT_ATTACHMENT_BYTES = 50 * 1024 * 1024
export const CHAT_ASSET_SIGNED_URL_SECONDS = 300

// 093 widened the bucket's allowlist to the full shared set, so chat accepts exactly
// what task attachments do — no chat-specific exclusions any more.
export const CHAT_ATTACHMENT_ACCEPT = UPLOAD_ACCEPT

export const formatChatAttachmentSize = formatUploadSize

export const resolveChatAttachmentMimeType = resolveUploadMimeType

/** Returns an error string to show the user, or null when the file is acceptable. */
export function validateChatAttachment(file: UploadCandidate): string | null {
  if (file.size <= 0) return 'This file is empty.'
  if (!resolveChatAttachmentMimeType(file)) {
    return 'Choose an image, video, PDF, Office, text, or ZIP file.'
  }
  if (file.size > MAX_CHAT_ATTACHMENT_BYTES) {
    return 'Choose a file no larger than 50 MB.'
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
