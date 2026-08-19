// Task attachments come in two flavours, and this module is the single place that
// decides which one a given file takes.
//
//   inline  - base64 data URI in task_attachments.file_data. Anyone who can manage
//             the task may upload one. Capped at 10 MB because every byte lands
//             inside the Postgres database, inflated 33% by base64 encoding.
//   large   - the bytes live in the task-assets Storage bucket and the row carries
//             a storage_path instead. Admin-only, and the admin has to opt in per
//             upload. Capped at 50 MB - the Supabase Free plan's hard per-file
//             ceiling, which no configuration can raise.
//
// Migration 091 enforces both halves in the database: a CHECK makes file_data and
// storage_path mutually exclusive, and the INSERT policy rejects a storage_path
// from anyone private.is_admin_user() is false for. Nothing here is a security
// boundary - it exists to give a good error before the round trip.

import {
  extensionByMimeType,
  formatUploadSize,
  isUploadPreviewable,
  resolveUploadMimeType,
  UPLOAD_ACCEPT,
  type UploadCandidate,
  type UploadMimeType,
} from './upload-mime'

export const TASK_ASSET_BUCKET = 'task-assets'

/** The inline base64 path. Must stay in step with 043's octet_length CHECK. */
export const MAX_INLINE_ATTACHMENT_BYTES = 10 * 1024 * 1024
/** The admin-only Storage path. Must stay in step with 091's bucket file_size_limit. */
export const MAX_LARGE_ATTACHMENT_BYTES = 50 * 1024 * 1024

/** Signed download URLs are short-lived by design; long enough to start a 50 MB download. */
export const TASK_ASSET_SIGNED_URL_SECONDS = 300

export const TASK_ATTACHMENT_ACCEPT = UPLOAD_ACCEPT

export const resolveTaskAttachmentMimeType = resolveUploadMimeType
export const isTaskAttachmentPreviewable = isUploadPreviewable
export const formatAttachmentSize = formatUploadSize

export type TaskAttachmentMimeType = UploadMimeType

export interface TaskAttachmentRow {
  id: string
  task_id: string
  file_name: string
  file_type: string | null
  file_size: number | null
  storage_path: string | null
  file_data?: string | null
  created_at: string
  uploaded_by?: { full_name?: string | null; email?: string | null } | null
}

/** A row is storage-backed iff it carries a path - the DB CHECK guarantees the XOR. */
export function isLargeAttachment(
  attachment: Pick<TaskAttachmentRow, 'storage_path'>,
): boolean {
  return Boolean(attachment.storage_path)
}

/**
 * The ceiling that applies to a given upload. `large` is the admin's per-upload
 * opt-in; it only raises the limit when the caller is actually an admin, so a
 * non-admin cannot lift their own cap by flipping a client-side flag.
 */
export function maxAttachmentBytes(
  { large, isAdmin }: { large: boolean; isAdmin: boolean },
): number {
  return large && isAdmin ? MAX_LARGE_ATTACHMENT_BYTES : MAX_INLINE_ATTACHMENT_BYTES
}

/**
 * Validates a file against whichever path it is taking. Returns an error string to
 * show the user, or null when the file is acceptable.
 *
 * The inline path deliberately does NOT check the MIME allowlist: it never has
 * (any file type could be base64'd into the column) and narrowing it here would
 * break uploads that work today. The allowlist applies only to the large path,
 * where the bucket and the storage policies enforce it anyway.
 */
export function validateTaskAttachment(
  file: UploadCandidate,
  { large, isAdmin }: { large: boolean; isAdmin: boolean },
): string | null {
  if (file.size <= 0) return 'This file is empty.'

  if (large && !isAdmin) {
    return 'Only admins can upload large files.'
  }

  if (!large) {
    return file.size > MAX_INLINE_ATTACHMENT_BYTES
      ? 'File size must be less than 10MB. Admins can turn on "Large file" to attach up to 50 MB.'
      : null
  }

  if (!resolveTaskAttachmentMimeType(file)) {
    return 'Large uploads must be an image, video, PDF, Office, text, or ZIP file.'
  }
  if (file.size > MAX_LARGE_ATTACHMENT_BYTES) {
    return 'Choose a file no larger than 50 MB.'
  }
  return null
}

/**
 * Storage path for a large attachment. The leading segment MUST be the task id -
 * 091's object policies read it back with storage.foldername(name)[1] to decide
 * who may read, write, and delete the object.
 */
export function buildTaskAssetPath(
  taskId: string,
  mimeType: TaskAttachmentMimeType,
  assetId = crypto.randomUUID(),
) {
  return `${taskId}/${assetId}.${extensionByMimeType[mimeType]}`
}
