// Pure rules for Projects on the Marketing tab (migration 140). No React, no Supabase.

export const PROJECT_BUCKET = 'marketing-projects'
export const NAME_MAX = 160
export const AREA_MAX = 160
export const DESCRIPTION_MAX = 5000
export const PHOTO_CAPTION_MAX = 500
/** Photos are shrunk to this long edge before they upload. */
export const PHOTO_MAX_EDGE = 1800
export const PHOTO_QUALITY = 0.82
/** What the browser will try to read. HEIC only works where the browser can decode it. */
export const PHOTO_ACCEPT = 'image/jpeg,image/png,image/webp,image/heic,image/heif'

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

export interface ProjectPhoto {
  id: string
  project_id: string
  path: string
  caption: string
  position: number
  width: number | null
  height: number | null
  bytes: number | null
}

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
