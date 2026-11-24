'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Check, ImagePlus, Loader2, Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { compressPhoto } from '@/lib/image-compress'
import {
  AREA_MAX,
  DESCRIPTION_MAX,
  EMPTY_DRAFT,
  NAME_MAX,
  PHOTO_ACCEPT,
  PHOTO_CAPTION_MAX,
  PROJECT_BUCKET,
  coverOf,
  coverPosition,
  draftFrom,
  draftProblem,
  draftToRow,
  formatBytes,
  nextPosition,
  photoPath,
  sortPhotos,
  sortProjects,
  type MarketingProject,
  type ProjectDraft,
  type ProjectPhoto,
} from '@/lib/marketing-projects'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

const SIGNED_URL_SECONDS = 60 * 60
const PROJECT_COLUMNS = 'id, name, company_id, area, completed_on, description, created_at, updated_at'
const PHOTO_COLUMNS = 'id, project_id, path, caption, position, width, height, bytes'

interface Company {
  id: string
  code: string
  name: string
  color: string
}

function dateLabel(date: string | null): string | null {
  if (!date) return null
  return new Date(`${date}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** True when the migration that creates the tables has not been applied to this database. */
function tablesMissing(error: { code?: string; message: string }): boolean {
  return error.code === 'PGRST205' || error.code === '42P01' || /could not find the table|does not exist/i.test(error.message)
}

export default function MarketingProjects({ userId }: { userId: string }) {
  const [projects, setProjects] = useState<MarketingProject[]>([])
  const [photos, setPhotos] = useState<ProjectPhoto[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [urls, setUrls] = useState<Record<string, string>>({})
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  // null = closed, 'new' = creating, otherwise the id of the project being edited.
  const [editing, setEditing] = useState<string | 'new' | null>(null)

  const signPaths = useCallback(async (paths: string[]) => {
    if (!paths.length) return
    const { data, error } = await createClient().storage.from(PROJECT_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS)
    if (error) {
      toast.error('Could not load the project photos', { description: error.message })
      return
    }
    const signed = (data ?? []).filter((d: { path: string | null }) => d.path) as Array<{ path: string; signedUrl: string }>
    setUrls((prev) => ({ ...prev, ...Object.fromEntries(signed.map((d) => [d.path, d.signedUrl])) }))
  }, [])

  useEffect(() => {
    let active = true
    const load = async () => {
      const supabase = createClient()
      const [projectsResult, photosResult, companiesResult] = await Promise.all([
        supabase.from('marketing_projects').select(PROJECT_COLUMNS),
        supabase.from('marketing_project_photos').select(PHOTO_COLUMNS),
        supabase.from('companies').select('id, code, name, color, position, is_archived').order('position'),
      ])
      if (!active) return
      const failed = projectsResult.error ?? photosResult.error
      if (failed) {
        setLoadError(tablesMissing(failed) ? 'Projects are not set up on this database yet.' : `Could not load projects: ${failed.message}`)
      } else {
        const loadedPhotos = (photosResult.data ?? []) as ProjectPhoto[]
        setProjects((projectsResult.data ?? []) as MarketingProject[])
        setPhotos(loadedPhotos)
        void signPaths(loadedPhotos.map((p) => p.path))
      }
      setCompanies(((companiesResult.data ?? []) as Array<Company & { is_archived: boolean }>).filter((c) => !c.is_archived))
      setLoading(false)
    }
    void load()
    return () => {
      active = false
    }
  }, [signPaths])

  const photosByProject = useMemo(() => {
    const out: Record<string, ProjectPhoto[]> = {}
    for (const p of photos) (out[p.project_id] ??= []).push(p)
    return out
  }, [photos])
  const companyById = useMemo(() => new Map(companies.map((c) => [c.id, c])), [companies])
  const sorted = useMemo(() => sortProjects(projects), [projects])
  const open = projects.find((p) => p.id === openId) ?? null
  const editTarget = editing && editing !== 'new' ? (projects.find((p) => p.id === editing) ?? null) : null

  const saveProject = async (draft: ProjectDraft): Promise<boolean> => {
    const supabase = createClient()
    const row = draftToRow(draft)
    if (editTarget) {
      const { data, error } = await supabase
        .from('marketing_projects')
        .update({ ...row, updated_at: new Date().toISOString() })
        .eq('id', editTarget.id)
        .select(PROJECT_COLUMNS)
        .single()
      if (error || !data) {
        toast.error('The project was not saved', { description: error?.message })
        return false
      }
      setProjects((prev) => prev.map((p) => (p.id === editTarget.id ? (data as MarketingProject) : p)))
      toast.success('Project saved')
      return true
    }
    const { data, error } = await supabase
      .from('marketing_projects')
      .insert({ ...row, created_by: userId })
      .select(PROJECT_COLUMNS)
      .single()
    if (error || !data) {
      toast.error('The project was not created', { description: error?.message })
      return false
    }
    setProjects((prev) => [...prev, data as MarketingProject])
    setOpenId((data as MarketingProject).id)
    toast.success('Project created', { description: 'Add its best photos next.' })
    return true
  }

  const deleteProject = async (project: MarketingProject) => {
    const supabase = createClient()
    const own = photosByProject[project.id] ?? []
    const { error } = await supabase.from('marketing_projects').delete().eq('id', project.id)
    if (error) {
      toast.error('The project was not deleted', { description: error.message })
      return
    }
    // The rows are gone, so a file that will not delete only costs storage.
    if (own.length) {
      const { error: removeError } = await supabase.storage.from(PROJECT_BUCKET).remove(own.map((p) => p.path))
      if (removeError) toast.error('The project is deleted but some photo files stayed in storage', { description: removeError.message })
    }
    setProjects((prev) => prev.filter((p) => p.id !== project.id))
    setPhotos((prev) => prev.filter((p) => p.project_id !== project.id))
    setOpenId(null)
    toast.success('Project deleted')
  }

  const addPhotos = async (project: MarketingProject, files: File[], onProgress: (done: number, total: number) => void) => {
    const supabase = createClient()
    const storage = supabase.storage.from(PROJECT_BUCKET)
    let position = nextPosition(photosByProject[project.id] ?? [])
    let added = 0
    let savedBytes = 0
    for (const [i, file] of files.entries()) {
      onProgress(i, files.length)
      try {
        const shrunk = await compressPhoto(file)
        const id = crypto.randomUUID()
        const path = photoPath(project.id, id)
        const upload = await storage.upload(path, shrunk.blob, { contentType: 'image/jpeg', upsert: false })
        if (upload.error) throw new Error(upload.error.message)
        const { data, error } = await supabase
          .from('marketing_project_photos')
          .insert({ id, project_id: project.id, path, position, width: shrunk.width, height: shrunk.height, bytes: shrunk.blob.size, created_by: userId })
          .select(PHOTO_COLUMNS)
          .single()
        if (error || !data) {
          // A file with no row pointing at it would only use up the storage budget.
          await storage.remove([path])
          throw new Error(error?.message ?? 'The photo was not saved.')
        }
        position += 1
        added += 1
        savedBytes += Math.max(0, shrunk.originalBytes - shrunk.blob.size)
        setPhotos((prev) => [...prev, data as ProjectPhoto])
        void signPaths([path])
      } catch (e) {
        toast.error(`Skipped ${file.name}`, { description: e instanceof Error ? e.message : 'The upload failed.' })
      }
    }
    onProgress(files.length, files.length)
    if (added) toast.success(`${added} photo${added === 1 ? '' : 's'} added`, { description: savedBytes > 0 ? `Shrunk to save ${formatBytes(savedBytes)}.` : undefined })
  }

  const saveCaption = async (photo: ProjectPhoto, caption: string): Promise<boolean> => {
    const { error } = await createClient().from('marketing_project_photos').update({ caption }).eq('id', photo.id)
    if (error) {
      toast.error('The caption was not saved', { description: error.message })
      return false
    }
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, caption } : p)))
    return true
  }

  const makeCover = async (photo: ProjectPhoto) => {
    const position = coverPosition(photosByProject[photo.project_id] ?? [])
    const { error } = await createClient().from('marketing_project_photos').update({ position }).eq('id', photo.id)
    if (error) {
      toast.error('Could not change the cover photo', { description: error.message })
      return
    }
    setPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, position } : p)))
  }

  const removePhoto = async (photo: ProjectPhoto) => {
    const supabase = createClient()
    const { error } = await supabase.from('marketing_project_photos').delete().eq('id', photo.id)
    if (error) {
      toast.error('The photo was not removed', { description: error.message })
      return
    }
    await supabase.storage.from(PROJECT_BUCKET).remove([photo.path])
    setPhotos((prev) => prev.filter((p) => p.id !== photo.id))
  }

  if (loading) return <p className="text-muted-foreground py-16 text-center text-sm">Loading projects...</p>
  if (loadError) return <p role="alert" className="text-muted-foreground py-16 text-center text-sm">{loadError}</p>

  return (
    <div className="space-y-5">
      {open ? (
        <ProjectDetail
          project={open}
          company={open.company_id ? companyById.get(open.company_id) : undefined}
          photos={sortPhotos(photosByProject[open.id] ?? [])}
          urls={urls}
          onBack={() => setOpenId(null)}
          onEdit={() => setEditing(open.id)}
          onDelete={() => deleteProject(open)}
          onAddPhotos={(files, progress) => addPhotos(open, files, progress)}
          onCaption={saveCaption}
          onCover={makeCover}
          onRemove={removePhoto}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-muted-foreground max-w-2xl text-sm">
              Name a project, add its best photos and write it up. Photos are shrunk automatically when they upload.
            </p>
            <Button size="sm" onClick={() => setEditing('new')} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New project
            </Button>
          </div>

          {sorted.length === 0 ? (
            <div className="rounded-lg border border-dashed px-6 py-16 text-center">
              <p className="font-medium">No projects yet</p>
              <p className="text-muted-foreground mt-1 text-sm">Create the first one and add its best photos.</p>
              <Button size="sm" className="mt-4 gap-1.5" onClick={() => setEditing('new')}>
                <Plus className="h-4 w-4" />
                New project
              </Button>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {sorted.map((p) => {
                const own = photosByProject[p.id] ?? []
                const cover = coverOf(own)
                const company = p.company_id ? companyById.get(p.company_id) : undefined
                const meta = [p.area, dateLabel(p.completed_on)].filter(Boolean).join(' · ')
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setOpenId(p.id)}
                    className="bg-card hover:border-foreground/30 group overflow-hidden rounded-lg border text-left transition-colors focus-visible:ring-2 focus-visible:outline-none"
                  >
                    <div className="bg-muted relative aspect-[4/3] w-full">
                      {cover && urls[cover.path] ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={urls[cover.path]} alt="" loading="lazy" className="h-full w-full object-cover" />
                      ) : (
                        <span className="text-muted-foreground flex h-full items-center justify-center text-sm">
                          {cover ? 'Loading photo...' : 'No photos yet'}
                        </span>
                      )}
                      {own.length > 1 && (
                        <span className="absolute right-2 bottom-2 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white tabular-nums">{own.length} photos</span>
                      )}
                    </div>
                    <div className="space-y-1 p-3">
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="font-semibold break-words">{p.name}</h3>
                        {company && (
                          <Badge className="shrink-0 text-white" style={{ backgroundColor: company.color }}>
                            {company.code}
                          </Badge>
                        )}
                      </div>
                      {meta && <p className="text-muted-foreground text-xs">{meta}</p>}
                      {p.description && <p className="text-muted-foreground line-clamp-2 text-sm">{p.description}</p>}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </>
      )}

      {editing && (
        <ProjectEditor
          key={editing}
          initial={editTarget ? draftFrom(editTarget) : EMPTY_DRAFT}
          isNew={!editTarget}
          companies={companies}
          onClose={() => setEditing(null)}
          onSave={saveProject}
        />
      )}
    </div>
  )
}

function ProjectEditor({
  initial,
  isNew,
  companies,
  onClose,
  onSave,
}: {
  initial: ProjectDraft
  isNew: boolean
  companies: Company[]
  onClose: () => void
  onSave: (draft: ProjectDraft) => Promise<boolean>
}) {
  const [draft, setDraft] = useState(initial)
  const [busy, setBusy] = useState(false)
  const problem = draftProblem(draft)
  const set = <K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  const submit = async () => {
    if (problem || busy) return
    setBusy(true)
    const ok = await onSave(draft)
    setBusy(false)
    if (ok) onClose()
  }

  return (
    <Dialog open onOpenChange={(next) => !next && !busy && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isNew ? 'New project' : 'Edit project'}</DialogTitle>
          <DialogDescription>{isNew ? 'You add the photos on the next screen.' : 'Change anything about the project.'}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="project-name">Project name</Label>
            <Input id="project-name" value={draft.name} maxLength={NAME_MAX} autoFocus onChange={(e) => set('name', e.target.value)} placeholder="Kitchen remodel" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="project-company">Business</Label>
              <select
                id="project-company"
                value={draft.company_id}
                onChange={(e) => set('company_id', e.target.value)}
                className="border-input bg-background h-9 w-full rounded-md border px-2 text-sm"
              >
                <option value="">Not set</option>
                {companies.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="project-date">Finished on</Label>
              <Input id="project-date" type="date" value={draft.completed_on} onChange={(e) => set('completed_on', e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-area">Area</Label>
            <Input id="project-area" value={draft.area} maxLength={AREA_MAX} onChange={(e) => set('area', e.target.value)} placeholder="Kirkwood" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="project-description">Description</Label>
            <Textarea
              id="project-description"
              rows={6}
              value={draft.description}
              maxLength={DESCRIPTION_MAX}
              onChange={(e) => set('description', e.target.value)}
              placeholder="What was done, what the client wanted, what makes it a good one to show."
            />
            <p className="text-muted-foreground text-right text-xs tabular-nums">
              {draft.description.length}/{DESCRIPTION_MAX}
            </p>
          </div>
          {draft.name !== '' && problem && <p className="text-destructive text-sm">{problem}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!!problem || busy} className="gap-1.5">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {isNew ? 'Create project' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function ProjectDetail({
  project,
  company,
  photos,
  urls,
  onBack,
  onEdit,
  onDelete,
  onAddPhotos,
  onCaption,
  onCover,
  onRemove,
}: {
  project: MarketingProject
  company: Company | undefined
  photos: ProjectPhoto[]
  urls: Record<string, string>
  onBack: () => void
  onEdit: () => void
  onDelete: () => Promise<void>
  onAddPhotos: (files: File[], onProgress: (done: number, total: number) => void) => Promise<void>
  onCaption: (photo: ProjectPhoto, caption: string) => Promise<boolean>
  onCover: (photo: ProjectPhoto) => Promise<void>
  onRemove: (photo: ProjectPhoto) => Promise<void>
}) {
  const input = useRef<HTMLInputElement>(null)
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [viewing, setViewing] = useState<string | null>(null)
  const meta = [company?.name, project.area, dateLabel(project.completed_on)].filter(Boolean).join(' · ')
  const viewed = photos.find((p) => p.id === viewing) ?? null

  const pick = async (list: FileList | null) => {
    const files = Array.from(list ?? []).filter((f) => f.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(f.name))
    if (input.current) input.current.value = ''
    if (!files.length) return
    setProgress({ done: 0, total: files.length })
    await onAddPhotos(files, (done, total) => setProgress({ done, total }))
    setProgress(null)
  }

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 gap-1.5">
        <ArrowLeft className="h-4 w-4" />
        All projects
      </Button>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <h2 className="text-2xl font-semibold break-words">{project.name}</h2>
          {meta && <p className="text-muted-foreground text-sm">{meta}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={onEdit} className="gap-1.5">
            <Pencil className="h-4 w-4" />
            Edit
          </Button>
          {confirmDelete ? (
            <>
              <span className="text-sm">Delete this project and its photos?</span>
              <Button variant="destructive" size="sm" onClick={() => void onDelete()}>
                Delete
              </Button>
              <Button variant="outline" size="sm" onClick={() => setConfirmDelete(false)}>
                Keep
              </Button>
            </>
          ) : (
            <Button variant="outline" size="sm" onClick={() => setConfirmDelete(true)} className="gap-1.5">
              <Trash2 className="h-4 w-4" />
              Delete
            </Button>
          )}
        </div>
      </div>

      {project.description ? (
        <p className="max-w-3xl text-sm leading-relaxed whitespace-pre-wrap">{project.description}</p>
      ) : (
        <button type="button" onClick={onEdit} className="text-muted-foreground hover:text-foreground text-sm underline underline-offset-4">
          Add a description
        </button>
      )}

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="font-semibold">Photos</h3>
          <input ref={input} type="file" multiple accept={PHOTO_ACCEPT} className="sr-only" aria-label="Add photos" onChange={(e) => void pick(e.target.files)} />
          <Button size="sm" variant="outline" disabled={!!progress} onClick={() => input.current?.click()} className="gap-1.5">
            {progress ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
            {progress ? `Shrinking and uploading ${Math.min(progress.done + 1, progress.total)} of ${progress.total}` : 'Add photos'}
          </Button>
          <span className="text-muted-foreground text-xs">Pick as many as you like. Each one is shrunk before it uploads.</span>
        </div>

        {photos.length === 0 ? (
          <button
            type="button"
            onClick={() => input.current?.click()}
            disabled={!!progress}
            className="text-muted-foreground hover:border-foreground/40 flex w-full flex-col items-center gap-2 rounded-lg border border-dashed px-6 py-14 text-sm transition-colors"
          >
            <ImagePlus className="h-6 w-6" />
            Add the best photos of this project
          </button>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {photos.map((photo, i) => (
              <figure key={photo.id} className="bg-card overflow-hidden rounded-lg border">
                <button type="button" onClick={() => setViewing(photo.id)} className="bg-muted relative block aspect-[4/3] w-full" aria-label="View photo larger">
                  {urls[photo.path] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={urls[photo.path]} alt={photo.caption || project.name} loading="lazy" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-muted-foreground flex h-full items-center justify-center text-sm">Loading photo...</span>
                  )}
                  {i === 0 && (
                    <span className="absolute top-2 left-2 flex items-center gap-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                      <Star className="h-3 w-3" aria-hidden="true" /> Cover
                    </span>
                  )}
                </button>
                <figcaption className="space-y-2 p-3">
                  <CaptionField photo={photo} onSave={onCaption} />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground text-xs tabular-nums">{photo.bytes ? formatBytes(photo.bytes) : ''}</span>
                    <div className="flex gap-1">
                      {i !== 0 && (
                        <Button size="sm" variant="ghost" onClick={() => void onCover(photo)} className="h-7 gap-1 px-2 text-xs">
                          <Star className="h-3.5 w-3.5" />
                          Make cover
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => void onRemove(photo)} className="h-7 gap-1 px-2 text-xs" aria-label="Remove photo">
                        <Trash2 className="h-3.5 w-3.5" />
                        Remove
                      </Button>
                    </div>
                  </div>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>

      <Dialog open={!!viewed} onOpenChange={(next) => !next && setViewing(null)}>
        <DialogContent className="sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{project.name}</DialogTitle>
            <DialogDescription>{viewed?.caption || 'No caption'}</DialogDescription>
          </DialogHeader>
          {viewed && urls[viewed.path] && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={urls[viewed.path]} alt={viewed.caption || project.name} className={cn('max-h-[70vh] w-full rounded object-contain')} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

/** Saves when focus leaves, so a caption needs no extra button. */
function CaptionField({ photo, onSave }: { photo: ProjectPhoto; onSave: (photo: ProjectPhoto, caption: string) => Promise<boolean> }) {
  const [value, setValue] = useState(photo.caption)
  const [saved, setSaved] = useState(false)
  return (
    <div className="relative">
      <Input
        value={value}
        maxLength={PHOTO_CAPTION_MAX}
        placeholder="Caption (optional)"
        aria-label="Photo caption"
        className="h-8 pr-7 text-sm"
        onChange={(e) => {
          setValue(e.target.value)
          setSaved(false)
        }}
        onBlur={async () => {
          const next = value.trim()
          if (next === photo.caption) return
          setSaved(await onSave(photo, next))
        }}
      />
      {saved && <Check className="absolute top-2 right-2 h-4 w-4 text-emerald-600" aria-label="Saved" />}
    </div>
  )
}
