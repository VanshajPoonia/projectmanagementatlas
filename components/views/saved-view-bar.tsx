'use client'

// The saved-view switcher and its save controls.
//
// Prompt E: "Scopes: personal, shared. Public/external sharing waits for client-sharing
// permissions." There are exactly two options here and there is deliberately no third: a
// "public link" control that did nothing, or that quietly meant "shared", is the defect this
// codebase keeps finding (board_members.role, app_modules, the recurrence toggle). When
// external sharing exists, it gets a control then.
//
// ⚠️ An admin sees SHARED views plus their own. Their own personal views are private, and so is
// everyone else's - 119's SELECT policy has no admin term, asserted by a post-condition. So the
// list here is never "all views", and nothing in this UI may imply it is: that is the
// hidden-vs-does-not-exist trap, and the honest framing is what the picker's own group headings
// say.

import { useState } from 'react'
import { Bookmark, ChevronDown, Plus, Save, Trash2, Users } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'
import {
  canManageView, duplicateNameWarning, groupViews, manageBlockedReason, validateViewName,
  type SavedView, type ViewScope,
} from '@/lib/saved-views'
import { describeView, type ViewConfig } from '@/lib/view-config'

interface SavedViewBarProps {
  views: SavedView[]
  activeView: SavedView | null
  config: ViewConfig
  /** True when `config` has drifted from `activeView.config`. */
  dirty: boolean
  currentUserId: string | null
  isAdmin: boolean
  /** The board this view would belong to, or null for a cross-board view. */
  boardId: string | null
  onSelect: (view: SavedView | null) => void
  onCreate: (input: { name: string; description: string; scope: ViewScope }) => Promise<void>
  onUpdate: (view: SavedView) => Promise<void>
  onDelete: (view: SavedView) => Promise<void>
  onResetToSaved: () => void
  busy?: boolean
}

export function SavedViewBar({
  views, activeView, config, dirty, currentUserId, isAdmin, boardId,
  onSelect, onCreate, onUpdate, onDelete, onResetToSaved, busy = false,
}: SavedViewBarProps) {
  const [saveOpen, setSaveOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<ViewScope>('personal')

  const { personal, shared } = groupViews(views, currentUserId)
  const canManageActive = activeView ? canManageView(activeView, currentUserId, isAdmin) : false
  const blockedReason = activeView ? manageBlockedReason(activeView, currentUserId, isAdmin) : null

  const nameError = validateViewName(name)
  const duplicate = duplicateNameWarning(views, name, scope, boardId)

  const openSaveDialog = () => {
    setName(activeView ? `${activeView.name} copy` : '')
    setDescription('')
    setScope(activeView?.scope ?? 'personal')
    setSaveOpen(true)
  }

  const submitSave = async () => {
    if (nameError) return
    await onCreate({ name, description, scope })
    setSaveOpen(false)
  }

  const saveOverActive = async () => {
    if (!activeView) return
    if (!canManageActive) {
      // Never let the button be the boundary - say why, and offer the thing that does work.
      toast.error('That view is not yours to change', {
        description: `${blockedReason} Use "Save as new" to keep your version.`,
      })
      return
    }
    await onUpdate(activeView)
  }

  const confirmDelete = async () => {
    if (!activeView) return
    const label = activeView.scope === 'shared' ? 'shared view' : 'view'
    if (!window.confirm(`Delete the ${label} "${activeView.name}"? This does not touch any task.`)) return
    await onDelete(activeView)
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" id="saved-view-picker" variant="outline" size="sm" className="h-8 max-w-[280px]">
            <Bookmark className="mr-1.5 h-4 w-4 shrink-0" aria-hidden />
            <span className="truncate">{activeView?.name ?? 'Unsaved view'}</span>
            {dirty && <span className="text-muted-foreground ml-1 shrink-0" title="Unsaved changes">•</span>}
            <ChevronDown className="ml-1 h-3 w-3 shrink-0" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-72">
          <DropdownMenuItem id="saved-view-none" onSelect={() => onSelect(null)}>
            <span className="flex-1">Start from scratch</span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="text-xs">Your views</DropdownMenuLabel>
          {personal.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs">
              None yet. Save one to reuse it.
            </DropdownMenuItem>
          ) : personal.map((view) => (
            <DropdownMenuItem key={view.id} onSelect={() => onSelect(view)}>
              <span className="flex-1 truncate">{view.name}</span>
              {view.id === activeView?.id && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">Open</Badge>}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />
          <DropdownMenuLabel className="flex items-center gap-1 text-xs">
            <Users className="h-3 w-3" aria-hidden /> Shared with everyone
          </DropdownMenuLabel>
          {shared.length === 0 ? (
            <DropdownMenuItem disabled className="text-xs">No shared views yet.</DropdownMenuItem>
          ) : shared.map((view) => (
            <DropdownMenuItem key={view.id} onSelect={() => onSelect(view)}>
              <span className="flex-1 truncate">{view.name}</span>
              {view.id === activeView?.id && <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">Open</Badge>}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {activeView && dirty && (
        <>
          <Button
            type="button" id="saved-view-save" size="sm" variant="outline" className="h-8"
            disabled={busy}
            onClick={saveOverActive}
            title={canManageActive ? `Update "${activeView.name}"` : blockedReason ?? undefined}
          >
            <Save className="mr-1 h-4 w-4" aria-hidden />
            Save changes
          </Button>
          <Button
            type="button" id="saved-view-reset" size="sm" variant="ghost" className="h-8"
            onClick={onResetToSaved}
          >
            Discard
          </Button>
        </>
      )}

      <Button type="button" id="saved-view-save-as" size="sm" variant="outline" className="h-8" onClick={openSaveDialog}>
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        {activeView ? 'Save as new' : 'Save this view'}
      </Button>

      {activeView && (
        <Button
          type="button" id="saved-view-delete" size="sm" variant="ghost"
          className="text-muted-foreground hover:text-destructive h-8"
          disabled={busy || !canManageActive}
          onClick={confirmDelete}
          title={canManageActive ? 'Delete this view' : blockedReason ?? undefined}
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          <span className="sr-only">Delete view</span>
        </Button>
      )}

      <span className="text-muted-foreground ml-auto hidden text-xs lg:inline">
        {describeView(config)}
      </span>

      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Save this view</DialogTitle>
            <DialogDescription>
              {describeView(config)}
              {boardId ? '. Saved against this board.' : '. Covers every board you can see.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="saved-view-name">Name</Label>
              <Input
                id="saved-view-name"
                value={name}
                autoFocus
                placeholder="What I look at on Monday"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && !nameError) submitSave() }}
              />
              {duplicate && <p className="text-muted-foreground text-xs">{duplicate} Saving will create a second one.</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="saved-view-description">Description (optional)</Label>
              <Input
                id="saved-view-description"
                value={description}
                placeholder="What this view is for"
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="saved-view-scope">Who can see it</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as ViewScope)}>
                <SelectTrigger id="saved-view-scope"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal">Only me</SelectItem>
                  <SelectItem value="shared">Everyone in the company</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-muted-foreground text-xs">
                {scope === 'personal'
                  ? 'Private, including from admins. Nobody else can open or edit it.'
                  : 'Anyone signed in can open it. They still only see the work their own access allows.'}
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setSaveOpen(false)}>Cancel</Button>
            <Button type="button" id="saved-view-confirm" disabled={Boolean(nameError) || busy} onClick={submitSave}>
              Save view
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
