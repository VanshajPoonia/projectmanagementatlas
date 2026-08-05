'use client'

import { useEffect, useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Archive, ArchiveRestore, ArrowLeft, Calendar, Check, Loader2, Pencil, Plus, Users, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import type { MarketingCalendarSummary } from '@/lib/use-marketing-calendars'

interface MarketingCalendarManagementProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  calendars: MarketingCalendarSummary[]
  // Called after any create/rename/archive/membership change so the caller's
  // useMarketingCalendars() list (and this dialog's own `calendars` prop) refreshes.
  onChange: () => Promise<void>
}

interface ProfileOption {
  id: string
  full_name: string | null
  email: string | null
}

// Admin-only: create/rename/archive marketing calendars and manage each one's member list.
// Mirrors board-management.tsx's embedded all-profiles-checkbox member picker (this app has no
// "invite a stranger" concept — every possible member already has a profiles row) and
// company-management.tsx's flat add-form/editable-row/soft-archive chrome.
export default function MarketingCalendarManagement({ open, onOpenChange, calendars, onChange }: MarketingCalendarManagementProps) {
  const supabase = createClient()
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#3b82f6')

  const [membersFor, setMembersFor] = useState<MarketingCalendarSummary | null>(null)
  const [allProfiles, setAllProfiles] = useState<ProfileOption[]>([])
  const [selectedMemberIds, setSelectedMemberIds] = useState<string[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [savingMembers, setSavingMembers] = useState(false)

  useEffect(() => {
    if (!open) return
    supabase.from('profiles').select('id,full_name,email').order('full_name').then(
      ({ data }: { data: ProfileOption[] | null }) => {
        if (data) setAllProfiles(data)
      },
    )
  }, [open, supabase])

  const activeCalendars = calendars.filter(c => !c.is_archived)
  const archivedCalendars = calendars.filter(c => c.is_archived)

  const handleClose = (next: boolean) => {
    onOpenChange(next)
    if (!next) {
      setMembersFor(null)
      setEditingId(null)
    }
  }

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase
      .from('marketing_calendars')
      .insert({ name, color: newColor, created_by: user?.id ?? null })
    setCreating(false)
    if (error) {
      toast.error('Could not create calendar', { description: error.message })
      return
    }
    setNewName('')
    setNewColor('#3b82f6')
    toast.success(`Created "${name}"`)
    await onChange()
  }

  const startEdit = (calendar: MarketingCalendarSummary) => {
    setEditingId(calendar.id)
    setEditName(calendar.name)
    setEditColor(calendar.color)
  }

  const saveEdit = async (calendar: MarketingCalendarSummary) => {
    const name = editName.trim()
    if (!name) return
    const { error } = await supabase
      .from('marketing_calendars')
      .update({ name, color: editColor })
      .eq('id', calendar.id)
    if (error) {
      toast.error('Could not save calendar', { description: error.message })
      return
    }
    setEditingId(null)
    toast.success('Calendar updated')
    await onChange()
  }

  const toggleArchive = async (calendar: MarketingCalendarSummary) => {
    const { error } = await supabase
      .from('marketing_calendars')
      .update({ is_archived: !calendar.is_archived })
      .eq('id', calendar.id)
    if (error) {
      toast.error('Could not update calendar', { description: error.message })
      return
    }
    toast.success(calendar.is_archived ? 'Calendar restored' : 'Calendar archived')
    await onChange()
  }

  const openMembers = async (calendar: MarketingCalendarSummary) => {
    setMembersFor(calendar)
    setMembersLoading(true)
    const { data } = await supabase
      .from('marketing_calendar_members')
      .select('user_id')
      .eq('calendar_id', calendar.id)
    setSelectedMemberIds((data ?? []).map((r: { user_id: string }) => r.user_id))
    setMembersLoading(false)
  }

  // Sync membership with a delete-all-then-reinsert, same pattern board-management.tsx
  // uses for board_members — simpler than diffing, and the list is small enough that
  // this is never a meaningful cost.
  const saveMembers = async () => {
    if (!membersFor) return
    setSavingMembers(true)
    const { error: deleteError } = await supabase
      .from('marketing_calendar_members')
      .delete()
      .eq('calendar_id', membersFor.id)
    if (deleteError) {
      setSavingMembers(false)
      toast.error('Could not save member access', { description: deleteError.message })
      return
    }
    if (selectedMemberIds.length > 0) {
      const { error: insertError } = await supabase
        .from('marketing_calendar_members')
        .insert(selectedMemberIds.map(userId => ({ calendar_id: membersFor.id, user_id: userId })))
      if (insertError) {
        setSavingMembers(false)
        toast.error('Could not save member access', { description: insertError.message })
        return
      }
    }
    setSavingMembers(false)
    toast.success('Member access updated')
    setMembersFor(null)
    await onChange()
  }

  const renderRow = (calendar: MarketingCalendarSummary) => (
    <div key={calendar.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
      {editingId === calendar.id ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            type="color"
            value={editColor}
            onChange={e => setEditColor(e.target.value)}
            className="h-9 w-10 flex-shrink-0 cursor-pointer rounded border"
          />
          <Input value={editName} onChange={e => setEditName(e.target.value)} className="h-9 flex-1 min-w-[160px]" placeholder="Calendar name" />
          <Button size="icon-sm" variant="ghost" onClick={() => saveEdit(calendar)} aria-label="Save">
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-4 w-4 flex-shrink-0 rounded-full" style={{ backgroundColor: calendar.color }} />
            <span className="truncate font-medium">{calendar.name}</span>
            {calendar.is_archived && <Badge variant="outline" className="text-muted-foreground">Archived</Badge>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            {!calendar.is_archived && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => openMembers(calendar)}>
                <Users className="h-4 w-4" /> Members
              </Button>
            )}
            <Button size="icon-sm" variant="ghost" onClick={() => startEdit(calendar)} aria-label={`Edit ${calendar.name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => toggleArchive(calendar)}>
              {calendar.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {calendar.is_archived ? 'Restore' : 'Archive'}
            </Button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="force-light-theme max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
        {membersFor ? (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Users className="h-4 w-4" /> Members — {membersFor.name}
              </DialogTitle>
              <DialogDescription>
                Only these people (plus admins) can see and edit this calendar.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {membersLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="max-h-72 divide-y overflow-y-auto rounded border">
                  {allProfiles.map(p => (
                    <label key={p.id} className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-accent">
                      <input
                        type="checkbox"
                        checked={selectedMemberIds.includes(p.id)}
                        onChange={e => setSelectedMemberIds(prev =>
                          e.target.checked ? [...prev, p.id] : prev.filter(id => id !== p.id),
                        )}
                        className="rounded"
                      />
                      <span className="truncate">{p.full_name || p.email}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="gap-1.5" onClick={() => setMembersFor(null)}>
                  <ArrowLeft className="h-4 w-4" /> Back
                </Button>
                <Button type="button" className="flex-1" disabled={savingMembers} onClick={saveMembers}>
                  {savingMembers ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save access'}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Calendar className="h-4 w-4" /> Manage Calendars
              </DialogTitle>
              <DialogDescription>
                Create calendars and control who can see and edit each one.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-5">
              <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
                <div className="min-w-[160px] flex-1 space-y-1.5">
                  <Label htmlFor="new-calendar-name" className="text-xs">Name</Label>
                  <Input
                    id="new-calendar-name"
                    value={newName}
                    onChange={e => setNewName(e.target.value)}
                    placeholder="e.g. Q1 Campaigns"
                    disabled={creating}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="new-calendar-color" className="text-xs">Color</Label>
                  <input
                    id="new-calendar-color"
                    type="color"
                    value={newColor}
                    onChange={e => setNewColor(e.target.value)}
                    className="h-10 w-12 cursor-pointer rounded border"
                    disabled={creating}
                  />
                </div>
                <Button type="submit" className="gap-2" disabled={creating || !newName.trim()}>
                  <Plus className="h-4 w-4" /> Create
                </Button>
              </form>

              <div className="space-y-2">
                {activeCalendars.map(renderRow)}
                {activeCalendars.length === 0 && (
                  <p className="text-sm text-muted-foreground">No calendars yet. Add one above.</p>
                )}
              </div>

              {archivedCalendars.length > 0 && (
                <div className="space-y-2 pt-2">
                  <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                    <Archive className="h-3.5 w-3.5" />
                    Archived ({archivedCalendars.length})
                  </div>
                  {archivedCalendars.map(renderRow)}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
