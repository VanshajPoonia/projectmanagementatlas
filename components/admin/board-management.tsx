'use client'

import React from "react"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus, Kanban, Calendar, Trash2, MoreVertical, Edit, Palette, Archive, ArchiveRestore, Globe, Lock, ChevronDown, ChevronRight, LayoutGrid, List } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'
import { cleanBoardDescription } from '@/lib/display-text'
import BoardMemberPicker from './board-member-picker'
import {
  canManageMembership,
  isNoopPlan,
  planMembershipChanges,
  toMembershipRow,
  type MembershipRow,
} from '@/lib/board-membership'

interface BoardManagementProps {
  boards: any[]
  isSuperAdmin?: boolean
  /** Needed to tell whether this admin created the board — see canManageMembership. */
  currentUserId?: string | null
}

export default function BoardManagement({ boards: initialBoards, isSuperAdmin = false, currentUserId = null }: BoardManagementProps) {
  const [boards, setBoards] = useState(initialBoards)
  const [viewMode, setViewMode] = useState<'tile' | 'list'>('tile')
  const [archivedBoards, setArchivedBoards] = useState<any[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingBoard, setEditingBoard] = useState<any>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [boardColor, setBoardColor] = useState('#3b82f6')
  const [isPrivate, setIsPrivate] = useState(false)
  const [members, setMembers] = useState<MembershipRow[]>([])
  // What was actually in the database when the edit dialog opened. Kept separately from
  // `members` so the save can diff against it instead of rewriting every row — see
  // lib/board-membership.ts for why rewriting was a privilege-escalation bug.
  const [loadedMembers, setLoadedMembers] = useState<MembershipRow[]>([])
  const [allUsers, setAllUsers] = useState<{ id: string; full_name: string | null; email: string | null }[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

  useEffect(() => {
    supabase.from('profiles').select('id,full_name,email').order('full_name').then(
      ({ data }: { data: { id: string; full_name: string | null; email: string | null }[] | null }) => {
        if (data) setAllUsers(data)
      }
    )
  }, [])

  // The create and edit dialogs share one set of form fields, so opening Create straight
  // after an Edit used to inherit that board's title and access list. Harmless for text
  // the user can see and overwrite; not harmless for a member list.
  const openCreateDialog = () => {
    setTitle('')
    setDescription('')
    setIsPrivate(false)
    setMembers([])
    setLoadedMembers([])
    setError(null)
    setOpen(true)
  }

  const handleCreateBoard = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      const { data: board, error: boardError } = await supabase
        .from('boards')
        .insert({
          title,
          description,
          created_by: user.id,
          updated_by: user.id,
          is_private: isPrivate,
        })
        .select()
        .single()

      if (boardError) throw boardError

      // Seed the columns from the admin-managed status list, one column per ACTIVE status,
      // in the order Super Admin -> Statuses puts them. This used to ask for four specific
      // keys by name, so a status the company had added — the whole point of that screen
      // being editable — appeared in every dropdown and on no new board, and an archived
      // one kept being seeded onto boards forever. Column order is the status order because
      // that list is already arranged left-to-right in the same left-to-right sense.
      const { data: activeStatuses } = await supabase
        .from('task_statuses')
        .select('key, label, position')
        .eq('is_archived', false)
        .order('position', { ascending: true })
        .order('label', { ascending: true })

      // A board with no columns cannot be used at all and gives no hint why, so a failed or
      // empty status read falls back to the four built-ins rather than shipping an empty board.
      const seed: Array<{ key: string; label: string }> = activeStatuses?.length
        ? activeStatuses.map((s: { key: string; label: string }) => ({ key: s.key, label: s.label }))
        : [
            { key: 'to_do', label: 'To Do' },
            { key: 'in_progress', label: 'In Progress' },
            { key: 'done', label: 'Completed' },
            { key: 'cancelled', label: 'Cancelled' },
          ]

      const columns = seed.map((s, index) => ({
        title: s.label,
        position: index,
        board_id: board.id,
        status_key: s.key,
      }))

      const { error: columnError } = await supabase.from('columns').insert(columns)
      if (columnError) {
        setBoards([board, ...boards])
        setError('Board created, but its columns could not be added. Open the board to add them.')
        return
      }

      // Written for public boards too, not just private ones. Migrations 065/067 key the
      // guest/client restriction off the membership row itself rather than off `is_private`,
      // so restricting someone on an open board is both meaningful and, until now,
      // unreachable from any UI.
      if (members.length > 0) {
        const { error: memberError } = await supabase.from('board_members').insert(
          members.map(({ user_id, role }) => ({ board_id: board.id, user_id, role }))
        )
        // The board exists at this point, so failing silently here would leave a private
        // board with nobody but its creator on it and no indication why.
        if (memberError) {
          setBoards([board, ...boards])
          setError('Board created, but its access list could not be saved. Open Edit Board to try again.')
          return
        }
      }

      setBoards([board, ...boards])
      setTitle('')
      setDescription('')
      setIsPrivate(false)
      setMembers([])
      setOpen(false)
    } catch (err) {
      setError('Failed to create board. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // ⚠️ No preventDefault here, deliberately. Radix reads a prevented default on a menu item
  // as "keep the menu open", so this handler used to leave the actions menu hanging open
  // behind the dialog — and because that menu is modal, `body { pointer-events: none }` was
  // left in place after saving, making the whole page unclickable until the user dismissed
  // the menu by hand. The preventDefault looked necessary because these cards wrap their
  // content in a <Link>, but DropdownMenuContent is portaled out of that subtree, so a menu
  // item click never reaches the link in the first place.
  const handleEditBoard = async (board: any, e: React.MouseEvent) => {
    e.stopPropagation()
    setEditingBoard(board)
    setTitle(board.title)
    setDescription(board.description || '')
    setBoardColor(board.color || '#3b82f6')
    setIsPrivate(board.is_private ?? false)
    setError(null)
    // Roles come back with the rows now; dropping them here is what made the old save
    // reset everyone to 'member'.
    const { data: memberRows } = await supabase
      .from('board_members').select('user_id, role').eq('board_id', board.id)
    const loaded = (memberRows ?? []).map(toMembershipRow)
    setLoadedMembers(loaded)
    setMembers(loaded)
    setEditOpen(true)
  }

  /**
   * Apply a membership plan, returning a human-readable failure or null.
   *
   * Every write asks for its rows back and checks the count, because PostgREST does not
   * treat a zero-row DELETE or UPDATE as an error — under RLS those simply match nothing
   * and report success. That is precisely how the previous version told a non-creator
   * admin their changes had been saved when the database had rejected all of them.
   */
  const applyMembershipPlan = async (
    boardId: string,
    plan: ReturnType<typeof planMembershipChanges>,
  ): Promise<string | null> => {
    const REJECTED = 'The access list was not saved — only the board’s creator can change it.'

    if (plan.remove.length > 0) {
      const { data, error } = await supabase
        .from('board_members').delete()
        .eq('board_id', boardId).in('user_id', plan.remove).select('user_id')
      if (error) return error.message
      if ((data?.length ?? 0) !== plan.remove.length) return REJECTED
    }

    if (plan.insert.length > 0) {
      const { data, error } = await supabase
        .from('board_members')
        .insert(plan.insert.map(({ user_id, role }) => ({ board_id: boardId, user_id, role })))
        .select('user_id')
      if (error) return error.message
      if ((data?.length ?? 0) !== plan.insert.length) return REJECTED
    }

    // Grouped by role so this is at most one round-trip per distinct role, not per person.
    const byRole = new Map<string, string[]>()
    for (const row of plan.update) {
      byRole.set(row.role, [...(byRole.get(row.role) ?? []), row.user_id])
    }
    for (const [role, userIds] of byRole) {
      const { data, error } = await supabase
        .from('board_members').update({ role })
        .eq('board_id', boardId).in('user_id', userIds).select('user_id')
      if (error) return error.message
      if ((data?.length ?? 0) !== userIds.length) return REJECTED
    }

    return null
  }

  const handleUpdateBoard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingBoard) return

    setLoading(true)
    setError(null)

    try {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) throw new Error('User not authenticated')

      const updatedAt = new Date().toISOString()
      const { error } = await supabase
        .from('boards')
        .update({
          title: title.trim(),
          description: description.trim() || null,
          color: boardColor,
          is_private: isPrivate,
          updated_at: updatedAt,
          updated_by: user.id,
        })
        .eq('id', editingBoard.id)

      if (error) throw error

      // Diff, never rewrite. An edit that does not touch the access list now issues zero
      // membership writes, which is what stops an unrelated change (a title, a colour)
      // from resetting a guest's role to 'member' and handing them write access.
      const plan = planMembershipChanges(loadedMembers, members)
      if (!isNoopPlan(plan)) {
        const membershipError = await applyMembershipPlan(editingBoard.id, plan)
        if (membershipError) {
          // The board's own fields are already saved, so say so rather than implying the
          // whole save failed. The dialog stays open with the user's list intact.
          setError(`The board was saved, but its access list was not: ${membershipError}`)
          return
        }
      }

      // Look up the editor's display info from the already-loaded users list rather
      // than a second round-trip.
      const editorProfile = allUsers.find(u => u.id === user.id)

      // Update local state
      setBoards(boards.map(b =>
        b.id === editingBoard.id
          ? {
              ...b,
              title: title.trim(),
              description: description.trim(),
              color: boardColor,
              is_private: isPrivate,
              updated_at: updatedAt,
              updated_by: user.id,
              editor: editorProfile ? { full_name: editorProfile.full_name, email: editorProfile.email } : b.editor,
            }
          : b
      ))

      setEditOpen(false)
      setEditingBoard(null)
      setTitle('')
      setDescription('')
      setBoardColor('#3b82f6')
      setIsPrivate(false)
      setMembers([])
      setLoadedMembers([])
    } catch (err) {
      setError('Failed to update board. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Archived boards are kept forever and exposed by RLS only to super admins.
  useEffect(() => {
    if (!isSuperAdmin) return
    const loadArchived = async () => {
      const { data } = await supabase
        .from('boards')
        .select('*')
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false })
      if (data) setArchivedBoards(data)
    }
    loadArchived()
  }, [isSuperAdmin])

  // Same reasoning as handleEditBoard: prevented default keeps the menu (and its
  // pointer-events lock) alive after the action has run.
  const handleArchiveBoard = async (boardId: string, boardTitle: string, e: React.MouseEvent) => {
    e.stopPropagation()

    const confirmed = window.confirm(
      `Archive "${boardTitle}"?\n\nThe board and all its data are kept — it's just hidden from everyone except super admins. Only a super admin can restore it.`
    )
    if (!confirmed) return

    try {
      const { data: { user } } = await supabase.auth.getUser()
      const { data, error } = await supabase
        .from('boards')
        .update({ archived_at: new Date().toISOString(), archived_by: user?.id ?? null })
        .eq('id', boardId)
        .select()
        .single()

      if (error) throw error

      setBoards(boards.filter(b => b.id !== boardId))
      if (data) setArchivedBoards((prev) => [data, ...prev])
    } catch (err) {
      alert('Failed to archive board. Please try again.')
      console.error('Archive board error:', err)
    }
  }

  const handleRestoreBoard = async (boardId: string, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()

    try {
      const { data, error } = await supabase
        .from('boards')
        .update({ archived_at: null, archived_by: null })
        .eq('id', boardId)
        .select()
        .single()

      if (error) throw error

      setArchivedBoards((prev) => prev.filter(b => b.id !== boardId))
      if (data) setBoards((prev) => [data, ...prev])
    } catch (err: any) {
      alert(err?.message || 'Failed to restore board. Please try again.')
      console.error('Restore board error:', err)
    }
  }

  return (
    <div className="space-y-6">
      {/* Edit Board Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6">
          <DialogHeader>
            <DialogTitle>Edit Board</DialogTitle>
            <DialogDescription>Update your board details and customize its appearance</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleUpdateBoard} className="space-y-4">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <div className="space-y-2">
              <label htmlFor="edit-title" className="text-sm font-medium">
                Board Title
              </label>
              <Input
                id="edit-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Enter board title"
                required
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-description" className="text-sm font-medium">
                Description
              </label>
              <Textarea
                id="edit-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Enter board description (optional)"
                disabled={loading}
                rows={3}
              />
            </div>
            <div className="space-y-2">
              <label htmlFor="edit-color" className="text-sm font-medium flex items-center gap-2">
                <Palette className="w-4 h-4" />
                Board Color
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <Input
                  id="edit-color"
                  type="color"
                  value={boardColor}
                  onChange={(e) => setBoardColor(e.target.value)}
                  className="w-20 h-10 cursor-pointer"
                  disabled={loading}
                />
                <div className="flex min-w-48 flex-1 flex-wrap gap-2">
                  {['#3b82f6', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#06b6d4'].map(color => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setBoardColor(color)}
                      className={`w-8 h-8 rounded-full border-2 transition-all ${
                        boardColor === color ? 'border-foreground scale-110' : 'border-transparent'
                      }`}
                      style={{ backgroundColor: color }}
                      disabled={loading}
                    />
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Visibility</label>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => setIsPrivate(false)}
                  className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm transition-colors ${!isPrivate ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent'}`}>
                  <Globe className="w-4 h-4" /> Everyone
                </button>
                <button type="button" onClick={() => setIsPrivate(true)}
                  className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm transition-colors ${isPrivate ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent'}`}>
                  <Lock className="w-4 h-4" /> Private
                </button>
              </div>
              {/* Shown for public boards too — a Guest/Client row restricts someone who
                  would otherwise have full access, which only exists on open boards. */}
              <BoardMemberPicker
                users={allUsers}
                value={members}
                onChange={setMembers}
                isPrivate={isPrivate}
                disabled={loading}
                canManage={canManageMembership(editingBoard, currentUserId)}
              />
            </div>
            <div className="flex flex-col-reverse gap-2 pt-4 sm:flex-row sm:justify-end">
              <Button type="button" variant="outline" className="w-full sm:w-auto" onClick={() => setEditOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" className="w-full sm:w-auto" disabled={loading}>
                {loading ? 'Updating...' : 'Update Board'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 className="text-2xl font-bold tracking-tight">Board Management</h2>
          <p className="text-muted-foreground">Create and manage project boards</p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          <div className="flex shrink-0 items-center rounded-md border">
            <Button
              onClick={() => setViewMode('tile')}
              variant={viewMode === 'tile' ? 'default' : 'ghost'}
              size="sm"
              className="gap-2 rounded-r-none"
              aria-label="Tile view"
            >
              <LayoutGrid className="w-4 h-4" />
              <span className="hidden sm:inline">Tile</span>
            </Button>
            <Button
              onClick={() => setViewMode('list')}
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              className="gap-2 rounded-l-none"
              aria-label="List view"
            >
              <List className="w-4 h-4" />
              <span className="hidden sm:inline">List</span>
            </Button>
          </div>
        <Dialog open={open} onOpenChange={(next) => (next ? openCreateDialog() : setOpen(false))}>
          <DialogTrigger asChild>
            <Button className="min-w-0 flex-1 gap-2 sm:flex-none">
              <Plus className="w-4 h-4" />
              New Board
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto p-4 sm:p-6">
            <DialogHeader>
              <DialogTitle>Create New Board</DialogTitle>
              <DialogDescription>
                Create a new project board to organize tasks
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleCreateBoard} className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <label htmlFor="title" className="text-sm font-medium">
                  Board Title
                </label>
                <Input
                  id="title"
                  placeholder="Q1 Marketing Campaign"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  disabled={loading}
                />
              </div>
              <div className="space-y-2">
                <label htmlFor="description" className="text-sm font-medium">
                  Description
                </label>
                <Textarea
                  id="description"
                  placeholder="Board description..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={loading}
                  rows={3}
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Visibility</label>
                <div className="flex flex-wrap gap-2">
                  <button type="button" onClick={() => setIsPrivate(false)}
                    className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm transition-colors ${!isPrivate ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent'}`}>
                    <Globe className="w-4 h-4" /> Everyone
                  </button>
                  <button type="button" onClick={() => setIsPrivate(true)}
                    className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm transition-colors ${isPrivate ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent'}`}>
                    <Lock className="w-4 h-4" /> Private
                  </button>
                </div>
                {/* No canManage check on create: the person filling this in becomes the
                    board's creator, so 061's policy will accept their writes. */}
                <BoardMemberPicker
                  users={allUsers}
                  value={members}
                  onChange={setMembers}
                  isPrivate={isPrivate}
                  disabled={loading}
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating Board...' : 'Create Board'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
        </div>
      </div>

      {viewMode === 'list' && (
        <div className="space-y-2">
          {boards.map((board) => (
            <Card key={board.id} className="group relative hover:shadow-md transition-all">
              <Link href={`/admin/board/${board.id}`}>
                <div className="flex cursor-pointer items-start gap-3 p-3 pr-12 sm:items-center">
                  <Kanban className="mt-0.5 h-5 w-5 flex-shrink-0 text-muted-foreground sm:mt-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="line-clamp-2 break-words font-medium [overflow-wrap:anywhere]">{board.title}</span>
                      {board.is_private && <Lock className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />}
                    </div>
                    <div className="mt-1 flex min-w-0 items-start gap-1 text-xs text-muted-foreground">
                      <Calendar className="mt-0.5 h-3 w-3 shrink-0" />
                      <p className="min-w-0">
                        <span>Last edited {new Date(board.updated_at ?? board.created_at).toLocaleDateString('en-US')}</span>
                        {(board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email) && (
                          <span className="block truncate sm:inline">
                            {' '}by {board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email}
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                </div>
              </Link>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 z-10">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="bg-background/95 opacity-100 shadow-md backdrop-blur-sm transition-opacity hover:bg-background sm:opacity-0 sm:group-hover:opacity-100 sm:hover:opacity-100 sm:focus:opacity-100"
                      aria-label={`Actions for ${board.title}`}
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                      }}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-48">
                    <DropdownMenuItem className="cursor-pointer" onClick={(e) => handleEditBoard(board, e)}>
                      <Edit className="w-4 h-4 mr-2" />
                      Edit Board
                    </DropdownMenuItem>
                    <DropdownMenuItem className="cursor-pointer" onClick={(e) => handleArchiveBoard(board.id, board.title, e)}>
                      <Archive className="w-4 h-4 mr-2" />
                      Archive Board
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Card>
          ))}
        </div>
      )}

      {viewMode === 'tile' && (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {boards.map((board) => (
          <Card key={board.id} className="relative group hover:shadow-lg transition-all">
            <Link href={`/admin/board/${board.id}`}>
              <div className="cursor-pointer">
                <CardHeader>
                  <div className="flex items-start gap-3">
                    <div 
                      className="w-10 h-10 bg-gradient-to-br rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ 
                        backgroundImage: `linear-gradient(to bottom right, ${board.color || '#3b82f6'}, ${board.color || '#3b82f6'}dd)` 
                      }}
                    >
                      <Kanban className="w-5 h-5 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <CardTitle className="text-lg truncate">{board.title}</CardTitle>
                        {board.is_private && <Lock className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />}
                      </div>
                      {cleanBoardDescription(board.description) && (
                        <CardDescription className="text-sm line-clamp-2">
                          {cleanBoardDescription(board.description)}
                        </CardDescription>
                      )}
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    Last edited {new Date(board.updated_at ?? board.created_at).toLocaleDateString('en-US')}
                    {(board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email) && (
                      <span className="truncate">
                        by {board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email}
                      </span>
                    )}
                  </div>
                  {board.created_by !== board.updated_by && (board.creator?.full_name || board.creator?.email) && (
                    <div className="truncate text-xs text-muted-foreground">
                      Created by {board.creator.full_name || board.creator.email}
                    </div>
                  )}
                </CardContent>
              </div>
            </Link>
            
            {/* Actions Menu - stays visible when hovering */}
            <div className="absolute top-2 right-2 z-10">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="bg-background/95 opacity-100 shadow-md backdrop-blur-sm transition-opacity hover:bg-background sm:opacity-0 sm:group-hover:opacity-100 sm:hover:opacity-100 sm:focus:opacity-100"
                    aria-label={`Actions for ${board.title}`}
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                    }}
                  >
                    <MoreVertical className="w-4 h-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-48">
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={(e) => handleEditBoard(board, e)}
                  >
                    <Edit className="w-4 h-4 mr-2" />
                    Edit Board
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="cursor-pointer"
                    onClick={(e) => handleArchiveBoard(board.id, board.title, e)}
                  >
                    <Archive className="w-4 h-4 mr-2" />
                    Archive Board
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Card>
        ))}
      </div>
      )}

      {boards.length === 0 && (
        <Card className="p-6 text-center sm:p-12">
          <Kanban className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No boards yet</h3>
          <p className="text-muted-foreground mb-6">Create your first board to get started</p>
          <Button onClick={openCreateDialog}>
            <Plus className="w-4 h-4 mr-2" />
            Create Board
          </Button>
        </Card>
      )}

      {archivedBoards.length > 0 && (
        <div className="space-y-3 pt-4">
          <button
            type="button"
            onClick={() => setShowArchived(v => !v)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
            aria-expanded={showArchived}
          >
            {showArchived ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
            <Archive className="w-4 h-4" />
            Archived boards ({archivedBoards.length}) — only super admins can see these
          </button>
          {showArchived && (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {archivedBoards.map((board) => (
              <Card key={board.id} className="flex-row items-start justify-between gap-3 p-4 bg-muted/40">
                <div className="min-w-0">
                  <p className="truncate font-medium">{board.title}</p>
                  {board.archived_at && (
                    <p className="text-xs text-muted-foreground">
                      Archived {new Date(board.archived_at).toLocaleDateString('en-US')}
                    </p>
                  )}
                </div>
                <Button variant="outline" size="sm" className="gap-2 flex-shrink-0" onClick={(e) => handleRestoreBoard(board.id, e)}>
                  <ArchiveRestore className="w-4 h-4" />
                  Restore
                </Button>
              </Card>
            ))}
          </div>
          )}
        </div>
      )}
    </div>
  )
}
