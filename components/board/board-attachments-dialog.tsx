'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { Paperclip, Download, Trash2, Upload, FileIcon } from 'lucide-react'
import { toast } from 'sonner'

const BUCKET = 'board-assets'
const SIGNED_URL_SECONDS = 60 * 10
/** 093's ceiling, and the Supabase Free plan's hard per-file limit. */
const MAX_BYTES = 50 * 1024 * 1024

interface BoardAttachment {
  id: string
  file_name: string
  file_type: string | null
  file_size: number | null
  storage_path: string
  uploaded_by: string | null
  created_at: string
  uploader?: { full_name: string | null; email: string | null } | null
}

function humanSize(bytes: number | null): string {
  if (!bytes || bytes <= 0) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

interface BoardAttachmentsDialogProps {
  boardId: string
  currentUserId: string | null
  /** Whether this viewer may upload. Mirrors the INSERT policy: an admin who can see the board. */
  canUpload: boolean
  isSuperAdmin?: boolean
}

/**
 * Files attached to the board itself rather than to one of its cards.
 *
 * Bobby asked for attachments on "A Board/Tile/Task"; only the task half existed. A board file is
 * the home for what belongs to the project rather than to one card - the signed contract, the
 * site plan, the brief.
 *
 * Storage-backed only, deliberately. Tasks carry a legacy inline base64 column beside their
 * Storage path; boards have no such legacy, and inline bytes sit in the Postgres row inflated
 * about a third against a 500 MB database budget.
 */
export function BoardAttachmentsDialog({
  boardId, currentUserId, canUpload, isSuperAdmin = false,
}: BoardAttachmentsDialogProps) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<BoardAttachment[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('board_attachments')
      .select('*, uploader:profiles!board_attachments_uploaded_by_fkey(full_name, email)')
      .eq('board_id', boardId)
      .order('created_at', { ascending: false })
    if (error) {
      toast.error('Could not load board files', { description: error.message })
    } else {
      setRows(data ?? [])
    }
    setLoading(false)
  }, [supabase, boardId])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const upload = async (file: File) => {
    if (file.size > MAX_BYTES) {
      toast.error('File is too large', { description: `The limit is 50 MB. This one is ${humanSize(file.size)}.` })
      return
    }
    setBusy(true)
    // The path layout is load-bearing: 111's storage policies read the board id out of the
    // first folder segment, so a file uploaded anywhere else is unreadable by everyone.
    const storagePath = `${boardId}/${crypto.randomUUID()}-${file.name}`
    const { error: upErr } = await supabase.storage.from(BUCKET).upload(storagePath, file, { upsert: false })
    if (upErr) {
      setBusy(false)
      toast.error('Upload failed', { description: upErr.message })
      return
    }

    const { data, error } = await supabase
      .from('board_attachments')
      .insert({
        board_id: boardId,
        file_name: file.name,
        file_type: file.type || null,
        file_size: file.size,
        storage_path: storagePath,
        uploaded_by: currentUserId,
      })
      .select('id')

    // An RLS refusal returns zero rows and no error, so the object would be left orphaned in
    // the bucket with nothing pointing at it. Count the rows and clean up if none came back.
    if (error || !data || data.length === 0) {
      await supabase.storage.from(BUCKET).remove([storagePath])
      setBusy(false)
      toast.error('Could not attach the file', {
        description: error?.message ?? 'The upload was refused. You may not have permission on this board.',
      })
      return
    }

    setBusy(false)
    toast.success(`Attached ${file.name}`)
    await load()
  }

  const download = async (row: BoardAttachment) => {
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, SIGNED_URL_SECONDS, { download: row.file_name })
    if (error || !data?.signedUrl) {
      toast.error('Could not open the file', { description: error?.message })
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer')
  }

  const remove = async (row: BoardAttachment) => {
    if (!window.confirm(`Remove "${row.file_name}" from this board?`)) return
    setBusy(true)
    const { data, error } = await supabase
      .from('board_attachments').delete().eq('id', row.id).select('id')
    if (error || !data || data.length === 0) {
      setBusy(false)
      toast.error('Could not remove the file', {
        description: error?.message ?? 'Only the person who uploaded a file, or a super admin, can remove it.',
      })
      return
    }
    // Row first, object second: an orphaned object is invisible and cheap, whereas a row
    // pointing at a deleted object is a broken download for everyone.
    const { error: objErr } = await supabase.storage.from(BUCKET).remove([row.storage_path])
    if (objErr) console.error('[board-attachments] orphaned object:', row.storage_path, objErr)
    setBusy(false)
    await load()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {/* Icon-only at every width, deliberately. The board header is a single flex row in
            which the action strip competes with the board's own title, and a labelled button
            here measurably squeezed the title below the 100px floor that
            scripts/check-board-navigation.mjs pins. The strip has no room to grow; see the
            note in board-view.tsx about why this header became a menu in the first place. */}
        <Button variant="outline" size="icon-sm" aria-label="Board files" title="Board files">
          <Paperclip className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4" /> Board files
          </DialogTitle>
          <DialogDescription>
            Files that belong to the whole board rather than to one task. Up to 50 MB each.
          </DialogDescription>
        </DialogHeader>

        {canUpload && (
          <div>
            <input
              ref={inputRef}
              type="file"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) void upload(file)
              }}
            />
            <Button
              type="button"
              variant="outline"
              className="w-full gap-2"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              {busy ? 'Working…' : 'Add a file'}
            </Button>
          </div>
        )}

        {loading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No files on this board yet.
            {!canUpload && ' An admin can add them.'}
          </p>
        ) : (
          <ul className="space-y-2">
            {rows.map((row) => {
              const mine = Boolean(currentUserId && row.uploaded_by === currentUserId)
              return (
                <li key={row.id} className="flex items-center gap-3 rounded-md border p-2">
                  <FileIcon className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{row.file_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {[
                        humanSize(row.file_size),
                        row.uploader?.full_name || row.uploader?.email || null,
                        new Date(row.created_at).toLocaleDateString('en-US'),
                      ].filter(Boolean).join(' · ')}
                    </div>
                  </div>
                  <Button
                    variant="ghost" size="icon-sm" onClick={() => download(row)}
                    aria-label={`Download ${row.file_name}`}
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  {/* Mirrors 111's DELETE policy exactly: the uploader, or a super admin. */}
                  {(mine || isSuperAdmin) && (
                    <Button
                      variant="ghost" size="icon-sm" disabled={busy} onClick={() => remove(row)}
                      aria-label={`Remove ${row.file_name}`}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
