// Pure rules for Projects on the Marketing tab (migration 140). No React, no Supabase.

import { BUSINESS_TIME_ZONE, businessDate } from '@/lib/crm'

export const PROJECT_BUCKET = 'marketing-projects'
export const NAME_MAX = 160
export const AREA_MAX = 160
export const DESCRIPTION_MAX = 5000
export const PHOTO_CAPTION_MAX = 500
/** Photos are shrunk to this long edge before they upload. */
export const PHOTO_MAX_EDGE = 1800
export const PHOTO_QUALITY = 0.82
/** Plain image/*, so iPhone Safari converts HEIC to JPEG itself instead of handing over the raw file. */
export const PHOTO_ACCEPT = 'image/*'
/** Photos and videos. A picked video arrives as MOV or MP4 and is converted before it uploads. */
export const MEDIA_ACCEPT = 'image/*,video/*'
/** The biggest video a person may pick. It is shrunk in the browser before it uploads. */
export const VIDEO_MAX_SOURCE_BYTES = 500 * 1024 * 1024
/** The most one stored file can be on the Supabase Free plan, and the bucket's own limit. */
export const VIDEO_MAX_STORED_BYTES = 50 * 1024 * 1024

export interface MarketingProject {
  id: string
  name: string
  company_id: string | null
  area: string | null
  completed_on: string | null
  description: string
  created_at: string
  updated_at: string
}

export type MediaKind = 'image' | 'video'

/** One photo or video in a project. The name stays `ProjectPhoto` because most rows are photos. */
export interface ProjectPhoto {
  id: string
  project_id: string
  path: string
  kind: MediaKind
  duration_seconds: number | null
  caption: string
  position: number
  width: number | null
  height: number | null
  bytes: number | null
  created_at: string
  created_by: string | null
}

/** Both ends are `YYYY-MM-DD` calendar days in the business timezone. Empty means open-ended. */
export interface DateRange {
  from: string
  to: string
}

export const NO_RANGE: DateRange = { from: '', to: '' }

export interface ProjectDraft {
  name: string
  company_id: string
  area: string
  completed_on: string
  description: string
}

export const EMPTY_DRAFT: ProjectDraft = { name: '', company_id: '', area: '', completed_on: '', description: '' }

export function draftFrom(project: MarketingProject): ProjectDraft {
  return {
    name: project.name,
    company_id: project.company_id ?? '',
    area: project.area ?? '',
    completed_on: project.completed_on ?? '',
    description: project.description,
  }
}

export function draftProblem(draft: ProjectDraft): string | null {
  if (!/\S/.test(draft.name)) return 'Give the project a name.'
  if (draft.name.trim().length > NAME_MAX) return `The name can be at most ${NAME_MAX} characters.`
  if (draft.area.trim().length > AREA_MAX) return `The area can be at most ${AREA_MAX} characters.`
  if (draft.description.length > DESCRIPTION_MAX) return `The description can be at most ${DESCRIPTION_MAX} characters.`
  return null
}

/** The row to write: blanks become null so an empty field reads as "not set". */
export function draftToRow(draft: ProjectDraft) {
  return {
    name: draft.name.trim(),
    company_id: draft.company_id || null,
    area: draft.area.trim() || null,
    completed_on: draft.completed_on || null,
    description: draft.description.trim(),
  }
}

export function photoPath(projectId: string, photoId: string): string {
  return `${projectId}/${photoId}.jpg`
}

export function videoPath(projectId: string, mediaId: string): string {
  return `${projectId}/${mediaId}.mp4`
}

/** A video's poster frame is a JPEG stored beside it, under the same id. */
export function posterPath(path: string): string {
  return path.replace(/\.mp4$/, '.jpg')
}

export function isVideo(photo: Pick<ProjectPhoto, 'kind'>): boolean {
  return photo.kind === 'video'
}

/** The image to show for a tile: the photo itself, or a video's poster frame. */
export function thumbPath(photo: Pick<ProjectPhoto, 'kind' | 'path'>): string {
  return isVideo(photo) ? posterPath(photo.path) : photo.path
}

/** Every Storage path that has to be signed to show these. A video needs its poster too. */
export function pathsToSign(photos: Array<Pick<ProjectPhoto, 'kind' | 'path'>>): string[] {
  return photos.flatMap((p) => (isVideo(p) ? [p.path, posterPath(p.path)] : [p.path]))
}

/** iPhone files can arrive with no type, so the extension counts too. */
export function isVideoFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type.startsWith('video/') || /\.(mp4|m4v|mov|webm|3gp|mkv)$/i.test(file.name)
}

export function isImageFile(file: Pick<File, 'type' | 'name'>): boolean {
  return file.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(file.name)
}

/** "0:07" or "2:41". */
export function durationLabel(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return ''
  const whole = Math.round(seconds)
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`
}

/** Fit inside a square of `maxEdge`, keeping the shape. Never scales up. */
export function fitWithin(width: number, height: number, maxEdge = PHOTO_MAX_EDGE): { width: number; height: number } {
  const longest = Math.max(width, height)
  if (longest <= maxEdge) return { width, height }
  const scale = maxEdge / longest
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export function sortPhotos(photos: ProjectPhoto[]): ProjectPhoto[] {
  return [...photos].sort((a, b) => a.position - b.position || a.path.localeCompare(b.path))
}

/** Position for the next photo added: after every photo the project already has. */
export function nextPosition(photos: Pick<ProjectPhoto, 'position'>[]): number {
  return photos.length ? Math.max(...photos.map((p) => p.position)) + 1 : 0
}

/** Position that puts a photo in front of the rest. */
export function coverPosition(photos: Pick<ProjectPhoto, 'position'>[]): number {
  return photos.length ? Math.min(...photos.map((p) => p.position)) - 1 : 0
}

export function coverOf(photos: ProjectPhoto[]): ProjectPhoto | null {
  return sortPhotos(photos)[0] ?? null
}

/** Newest first, by completion date when set and by when it was added otherwise. */
export function sortProjects(projects: MarketingProject[]): MarketingProject[] {
  const key = (p: MarketingProject) => p.completed_on ?? p.created_at.slice(0, 10)
  return [...projects].sort((a, b) => key(b).localeCompare(key(a)) || b.created_at.localeCompare(a.created_at))
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

const STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: BUSINESS_TIME_ZONE,
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  timeZoneName: 'short',
})

/** "Nov 25, 2026, 3:42 PM CST". Always the business timezone so everyone reads the same time. */
export function timestampLabel(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : STAMP.format(date)
}

/** The calendar day an instant falls on in the business timezone, or '' when it is missing. */
export function dayOf(iso: string | null | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : businessDate(date)
}

export function rangeIsSet(range: DateRange): boolean {
  return range.from !== '' || range.to !== ''
}

/** True when the instant's business day sits inside the range, ends included. */
export function inRange(iso: string | null | undefined, range: DateRange): boolean {
  const day = dayOf(iso)
  if (!day) return false
  if (range.from && day < range.from) return false
  if (range.to && day > range.to) return false
  return true
}

/** Photos uploaded inside the range. No range keeps every photo. */
export function photosInRange(photos: ProjectPhoto[], range: DateRange): ProjectPhoto[] {
  return rangeIsSet(range) ? photos.filter((p) => inRange(p.created_at, range)) : photos
}

/**
 * A project matches when it was created inside the range or any of its photos was uploaded inside it,
 * so a job started in October still turns up on the day Bobby adds a photo to it.
 */
export function projectInRange(project: MarketingProject, photos: ProjectPhoto[], range: DateRange): boolean {
  if (!rangeIsSet(range)) return true
  return inRange(project.created_at, range) || photos.some((p) => inRange(p.created_at, range))
}

/** The newest upload time among the photos, or null when there are none. */
export function lastUploadOf(photos: ProjectPhoto[]): string | null {
  let latest: string | null = null
  for (const p of photos) if (p.created_at && (!latest || p.created_at > latest)) latest = p.created_at
  return latest
}

/** A range typed backwards is read the way the person meant it. */
export function orderedRange(range: DateRange): DateRange {
  return range.from && range.to && range.from > range.to ? { from: range.to, to: range.from } : range
}
