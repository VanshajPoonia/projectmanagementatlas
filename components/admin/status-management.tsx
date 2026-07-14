'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Archive, ArchiveRestore, Plus, Pencil, Check, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface TaskStatusRow {
  id: string
  key: string
  label: string
  color: string
  position: number
  is_archived: boolean
}

function slugify(label: string) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
}

export default function StatusManagement() {
  const [statuses, setStatuses] = useState<TaskStatusRow[]>([])
  const [newLabel, setNewLabel] = useState('')
  const [newColor, setNewColor] = useState('#6366f1')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [editColor, setEditColor] = useState('#6366f1')
  const supabase = createClient()

  const load = async () => {
    const { data } = await supabase
      .from('task_statuses')
      .select('*')
      .order('position', { ascending: true })
      .order('label', { ascending: true })
    if (data) setStatuses(data)
  }

  useEffect(() => {
    load()
  }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const label = newLabel.trim()
    if (!label) return
    const key = slugify(label)
    if (!key) {
      toast.error('Please use letters or numbers in the status name')
      return
    }

    setSaving(true)
    const nextPosition = statuses.length ? Math.max(...statuses.map((s) => s.position)) + 1 : 0
    const { error } = await supabase
      .from('task_statuses')
      .insert({ key, label, color: newColor, position: nextPosition })
    setSaving(false)

    if (error) {
      toast.error(error.code === '23505' ? 'A status with that name already exists' : 'Could not add status')
      return
    }
    setNewLabel('')
    setNewColor('#6366f1')
    toast.success('Status added')
    load()
  }

  const toggleArchive = async (status: TaskStatusRow) => {
    const { error } = await supabase
      .from('task_statuses')
      .update({ is_archived: !status.is_archived })
      .eq('id', status.id)
    if (error) {
      toast.error('Could not update status')
      return
    }
    toast.success(status.is_archived ? 'Status restored' : 'Status archived')
    load()
  }

  const startEdit = (status: TaskStatusRow) => {
    setEditingId(status.id)
    setEditLabel(status.label)
    setEditColor(status.color)
  }

  const saveEdit = async (status: TaskStatusRow) => {
    const label = editLabel.trim()
    if (!label) return
    const { error } = await supabase
      .from('task_statuses')
      .update({ label, color: editColor })
      .eq('id', status.id)
    if (error) {
      toast.error('Could not save status')
      return
    }

    // Board columns are seeded with the status label as their literal title (e.g. "Done"),
    // so a status rename here would otherwise only show up in dropdowns while every board's
    // column header keeps showing the old name. Rename any column still using the old label
    // to keep boards in sync.
    if (label !== status.label) {
      await supabase.from('columns').update({ title: label }).eq('title', status.label)
    }

    setEditingId(null)
    toast.success('Status updated')
    load()
  }

  const activeStatuses = statuses.filter((s) => !s.is_archived)
  const archivedStatuses = statuses.filter((s) => s.is_archived)

  const renderRow = (status: TaskStatusRow) => (
    <div key={status.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
      {editingId === status.id ? (
        <div className="flex flex-1 items-center gap-2">
          <input
            type="color"
            value={editColor}
            onChange={(e) => setEditColor(e.target.value)}
            className="h-9 w-10 flex-shrink-0 cursor-pointer rounded border"
          />
          <Input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} className="h-9" />
          <Button size="icon-sm" variant="ghost" onClick={() => saveEdit(status)} aria-label="Save">
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-4 w-4 flex-shrink-0 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="truncate font-medium">{status.label}</span>
            <code className="hidden text-xs text-muted-foreground sm:inline">{status.key}</code>
            {status.is_archived && <Badge variant="outline" className="text-muted-foreground">Archived</Badge>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <Button size="icon-sm" variant="ghost" onClick={() => startEdit(status)} aria-label={`Edit ${status.label}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => toggleArchive(status)}>
              {status.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {status.is_archived ? 'Restore' : 'Archive'}
            </Button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle>Task Statuses</CardTitle>
        <CardDescription>
          Create or archive the statuses used across tasks. Archived statuses stay on existing tasks and remain searchable in reports — they just can&apos;t be picked for new work.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-status-label" className="text-xs">New status</Label>
            <Input
              id="new-status-label"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="e.g. Escalate to Mgmt."
              className="w-56"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-status-color" className="text-xs">Color</Label>
            <input
              id="new-status-color"
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-10 w-12 cursor-pointer rounded border"
              disabled={saving}
            />
          </div>
          <Button type="submit" className="gap-2" disabled={saving || !newLabel.trim()}>
            <Plus className="h-4 w-4" />
            Add Status
          </Button>
        </form>

        <div className="space-y-2">
          {activeStatuses.map(renderRow)}
        </div>

        {archivedStatuses.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Archive className="h-3.5 w-3.5" />
              Archived ({archivedStatuses.length})
            </div>
            {archivedStatuses.map(renderRow)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
