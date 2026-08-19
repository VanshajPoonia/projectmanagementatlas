'use client'

import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  Check, ChevronLeft, ChevronRight, Loader2, Pencil, Plus, Power, PowerOff, X,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Channel } from './marketing-calendar'

interface ChannelManagerProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Every channel, switched-off ones included - this dialog is the only way back on. */
  channels: Channel[]
  onRename: (channel: Channel, label: string) => Promise<boolean>
  onSetArchived: (channel: Channel, archived: boolean) => Promise<void>
  /** Indices are into the ACTIVE list, which is the grid's column order. */
  onMove: (fromIndex: number, toIndex: number) => void
  onAdd: (name: string) => Promise<boolean>
}

/**
 * Rename, rearrange and switch marketing channel columns off and on.
 *
 * Why one dialog rather than controls on the grid header: a switched-off channel has no
 * column, so a header can never be the way to switch it back on. Everything that decides
 * what the grid's columns ARE belongs in one list where the off ones are still visible.
 * The header keeps drag-and-drop and its arrows, which are about the order of what is
 * already on screen.
 */
export default function ChannelManager({
  open, onOpenChange, channels, onRename, onSetArchived, onMove, onAdd,
}: ChannelManagerProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [busyId, setBusyId] = useState<string | null>(null)
  const [addName, setAddName] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  // Closing mid-edit and reopening should not resume a half-typed rename against a channel
  // that may have been renamed by someone else in between.
  useEffect(() => {
    if (!open) { setEditingId(null); setEditLabel(''); setAddName('') }
  }, [open])

  const active = channels.filter(c => !c.is_archived)
  const off = channels.filter(c => c.is_archived)

  const startEdit = (channel: Channel) => {
    setEditingId(channel.id)
    setEditLabel(channel.label)
  }

  const saveEdit = async (channel: Channel) => {
    const label = editLabel.trim()
    if (!label) return
    setBusyId(channel.id)
    const ok = await onRename(channel, label)
    setBusyId(null)
    if (ok) setEditingId(null)
  }

  const toggleArchived = async (channel: Channel) => {
    setBusyId(channel.id)
    await onSetArchived(channel, !channel.is_archived)
    setBusyId(null)
  }

  const submitAdd = async () => {
    const name = addName.trim()
    if (!name) return
    setAddBusy(true)
    const ok = await onAdd(name)
    setAddBusy(false)
    if (ok) setAddName('')
  }

  const renderRow = (channel: Channel, index: number, total: number) => {
    const busy = busyId === channel.id
    const isEditing = editingId === channel.id

    return (
      <div
        key={channel.id}
        className={cn(
          'flex items-center gap-2 rounded-lg border p-2.5',
          channel.is_archived && 'bg-muted/40',
        )}
      >
        {isEditing ? (
          <>
            <Input
              autoFocus
              value={editLabel}
              onChange={e => setEditLabel(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); saveEdit(channel) }
                if (e.key === 'Escape') setEditingId(null)
              }}
              className="h-9"
              aria-label={`Rename ${channel.label}`}
            />
            <Button size="icon-sm" variant="ghost" disabled={busy || !editLabel.trim()}
              onClick={() => saveEdit(channel)} aria-label="Save name">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
            </Button>
            <Button size="icon-sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel rename">
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <>
            {/* Ordering applies to the columns that exist, so it is shown only on the on list. */}
            {!channel.is_archived && (
              <div className="flex flex-shrink-0 items-center">
                <Button size="icon-sm" variant="ghost" disabled={index === 0 || busy}
                  onClick={() => onMove(index, index - 1)}
                  aria-label={`Move ${channel.label} left`}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <Button size="icon-sm" variant="ghost" disabled={index === total - 1 || busy}
                  onClick={() => onMove(index, index + 1)}
                  aria-label={`Move ${channel.label} right`}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            )}

            <span className="min-w-0 flex-1 truncate font-medium">{channel.label}</span>

            {channel.is_archived && (
              <Badge variant="outline" className="flex-shrink-0 text-muted-foreground">Off</Badge>
            )}

            <Button size="icon-sm" variant="ghost" disabled={busy}
              onClick={() => startEdit(channel)} aria-label={`Rename ${channel.label}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            {/* The visible text is the same on every row, so the accessible name has to carry
                the channel - otherwise this reads as thirteen identical "Turn off" buttons. */}
            <Button size="sm" variant="outline" className="flex-shrink-0 gap-1.5" disabled={busy}
              aria-label={`${channel.is_archived ? 'Turn on' : 'Turn off'} ${channel.label}`}
              onClick={() => toggleArchived(channel)}>
              {busy
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : channel.is_archived ? <Power className="h-4 w-4" /> : <PowerOff className="h-4 w-4" />}
              {channel.is_archived ? 'Turn on' : 'Turn off'}
            </Button>
          </>
        )}
      </div>
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Channels</DialogTitle>
          <DialogDescription>
            Rename a channel, rearrange the grid&apos;s columns, or switch one off. The channel
            list is shared, so every change here is one everyone on the calendar sees.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[55vh] space-y-4 overflow-y-auto pr-1">
          <div className="space-y-2">
            {active.map((channel, index) => renderRow(channel, index, active.length))}
            {active.length === 0 && (
              <p className="rounded-lg border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
                Every channel is switched off, so the grid has no columns. Turn one back on below.
              </p>
            )}
          </div>

          {off.length > 0 && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <PowerOff className="h-3.5 w-3.5" />
                Off ({off.length})
              </div>
              {/* Switched off, not deleted: their scheduled posts are kept and reappear with
                  the column. Deleting a channel would strand every post filed under it, since
                  the events reference it by name. */}
              <p className="text-xs text-muted-foreground">
                These keep their scheduled posts. Turn one back on and its column returns with
                everything still on it.
              </p>
              {off.map(channel => renderRow(channel, -1, off.length))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-2 border-t pt-4">
          <Input
            value={addName}
            onChange={e => setAddName(e.target.value)}
            placeholder="New channel (e.g. LinkedIn)"
            className="h-9"
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitAdd() } }}
          />
          <Button size="sm" className="h-9 flex-shrink-0 gap-1.5" disabled={addBusy || !addName.trim()}
            onClick={submitAdd}>
            {addBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            Add
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
