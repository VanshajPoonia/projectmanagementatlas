// Shared upload file-type machinery.
//
// Extracted from lib/marketing-assets.ts when task attachments gained their own
// admin-only large-file path (migration 091) and needed the identical allowlist.
// Both features accept the same set - the office/design/video/archive formats a
// PM tool actually receives - and both back it with a matching MIME CHECK
// constraint and Storage bucket allowlist in SQL, so the list must stay in ONE
// place: `079_expand_marketing_event_files.sql` and `091_task_large_attachments.sql`
// both enumerate it, and a type added here must be added there too or the object
// upload succeeds and the metadata insert then fails.

export const UPLOAD_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  'image/svg+xml',
  'image/heic',
  'image/heif',
  'image/vnd.adobe.photoshop',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/postscript',
  'text/plain',
  'text/csv',
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'application/zip',
] as const

export type UploadMimeType = (typeof UPLOAD_MIME_TYPES)[number]

export const extensionByMimeType: Record<UploadMimeType, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/heic': 'heic',
  'image/heif': 'heif',
  'image/vnd.adobe.photoshop': 'psd',
  'application/pdf': 'pdf',
  'application/msword': 'doc',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.ms-excel': 'xls',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.ms-powerpoint': 'ppt',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/postscript': 'ai',
  'text/plain': 'txt',
  'text/csv': 'csv',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'application/zip': 'zip',
}

const mimeTypeByExtension: Record<string, UploadMimeType> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  svg: 'image/svg+xml',
  heic: 'image/heic',
  heif: 'image/heif',
  psd: 'image/vnd.adobe.photoshop',
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  ai: 'application/postscript',
  eps: 'application/postscript',
  txt: 'text/plain',
  csv: 'text/csv',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  zip: 'application/zip',
}

const mimeTypeAliases: Record<string, UploadMimeType> = {
  'image/jpg': 'image/jpeg',
  'application/x-zip-compressed': 'application/zip',
  'application/x-photoshop': 'image/vnd.adobe.photoshop',
  'application/photoshop': 'image/vnd.adobe.photoshop',
}

const previewableMimeTypes = new Set<UploadMimeType>([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
])

export const UPLOAD_ACCEPT = [
  ...UPLOAD_MIME_TYPES,
  ...Object.keys(mimeTypeByExtension).map(extension => `.${extension}`),
].join(',')

export interface UploadCandidate {
  name: string
  size: number
  type: string
}

// Browsers lie about (or omit) the MIME type often enough that the extension has
// to be a fallback, not a second opinion: .heic files routinely arrive as ''.
export function resolveUploadMimeType(
  file: Pick<UploadCandidate, 'name' | 'type'>,
): UploadMimeType | null {
  const browserMimeType = file.type.toLowerCase().split(';', 1)[0].trim()
  if (UPLOAD_MIME_TYPES.includes(browserMimeType as UploadMimeType)) {
    return browserMimeType as UploadMimeType
  }
  if (mimeTypeAliases[browserMimeType]) return mimeTypeAliases[browserMimeType]

  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]
  return extension ? mimeTypeByExtension[extension] ?? null : null
}

export function isUploadPreviewable(mimeType: string) {
  return previewableMimeTypes.has(mimeType as UploadMimeType)
}

export function formatUploadSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
