'use client'

import React from "react"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus, Kanban, Calendar, Trash2, MoreVertical, Edit, Palette, Archive, ArchiveRestore, Globe, Lock, Users, ChevronDown, ChevronRight, LayoutGrid, List } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'
import { cleanBoardDescription } from '@/lib/display-text'

interface BoardManagementProps {
  boards: any[]
}

export default function BoardManagement({ boards: initialBoards }: BoardManagementProps) {
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
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
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

      // Create default columns, using the current labels for the built-in statuses so a
      // renamed status (e.g. "Done" -> "Completed") is reflected on every new board too.
      const { data: defaultStatuses } = await supabase
        .from('task_statuses')
        .select('key, label')
        .in('key', ['to_do', 'in_progress', 'done', 'cancelled'])
      const labelFor = (key: string, fallback: string) =>
        defaultStatuses?.find((s: { key: string; label: string }) => s.key === key)?.label || fallback

      const columns = [
        { title: labelFor('to_do', 'To Do'), position: 0, board_id: board.id },
        { title: labelFor('in_progress', 'In Progress'), position: 1, board_id: board.id },
        { title: labelFor('done', 'Completed'), position: 2, board_id: board.id },
        { title: labelFor('cancelled', 'Cancelled'), position: 3, board_id: board.id },
      ]

      await supabase.from('columns').insert(columns)

      // Add explicit members for private boards
      if (isPrivate && selectedMembers.length > 0) {
        await supabase.from('board_members').insert(
          selectedMembers.map(userId => ({ board_id: board.id, user_id: userId }))
        )
      }

      setBoards([board, ...boards])
      setTitle('')
      setDescription('')
      setIsPrivate(false)
      setSelectedMembers([])
      setOpen(false)
    } catch (err) {
      setError('Failed to create board. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleEditBoard = async (board: any, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingBoard(board)
    setTitle(board.title)
    setDescription(board.description || '')
    setBoardColor(board.color || '#3b82f6')
    setIsPrivate(board.is_private ?? false)
    // Load existing members
    const { data: memberRows } = await supabase
      .from('board_members').select('user_id').eq('board_id', board.id)
    setSelectedMembers((memberRows ?? []).map((r: any) => r.user_id))
    setEditOpen(true)
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

      // Sync members: delete all then re-insert
      await supabase.from('board_members').delete().eq('board_id', editingBoard.id)
      if (isPrivate && selectedMembers.length > 0) {
        await supabase.from('board_members').insert(
          selectedMembers.map(userId => ({ board_id: editingBoard.id, user_id: userId }))
        )
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
      setSelectedMembers([])
    } catch (err) {
      setError('Failed to update board. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Archived boards are kept forever (never deleted) and visible only to admins.
  useEffect(() => {
    const loadArchived = async () => {
      const { data } = await supabase
        .from('boards')
        .select('*')
        .not('archived_at', 'is', null)
        .order('archived_at', { ascending: false })
      if (data) setArchivedBoards(data)
    }
    loadArchived()
  }, [])

  const handleArchiveBoard = async (boardId: string, boardTitle: string, e: React.MouseEvent) => {
    e.preventDefault()
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
        <DialogContent>
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
              <div className="flex gap-3 items-center">
                <Input
                  id="edit-color"
                  type="color"
                  value={boardColor}
                  onChange={(e) => setBoardColor(e.target.value)}
                  className="w-20 h-10 cursor-pointer"
                  disabled={loading}
                />
                <div className="flex-1 flex gap-2">
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
              <div className="flex gap-2">
                <button type="button" onClick={() => setIsPrivate(false)}
                  className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm transition-colors ${!isPrivate ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent'}`}>
                  <Globe className="w-4 h-4" /> Everyone
                </button>
                <button type="button" onClick={() => setIsPrivate(true)}
                  className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm transition-colors ${isPrivate ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent'}`}>
                  <Lock className="w-4 h-4" /> Private
                </button>
              </div>
              {isPrivate && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Only you and the people you pick can see this board — other admins can&apos;t</p>
                  <div className="max-h-40 overflow-y-auto rounded border divide-y">
                    {allUsers.map(u => (
                      <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-accent cursor-pointer text-sm">
                        <input type="checkbox" checked={selectedMembers.includes(u.id)}
                          onChange={ev => setSelectedMembers(prev => ev.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id))}
                          className="rounded"
                        />
                        <span className="truncate">{u.full_name || u.email}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="flex gap-2 justify-end pt-4">
              <Button type="button" variant="outline" onClick={() => setEditOpen(false)} disabled={loading}>
                Cancel
              </Button>
              <Button type="submit" disabled={loading}>
                {loading ? 'Updating...' : 'Update Board'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Board Management</h2>
          <p className="text-muted-foreground">Create and manage project boards</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center border rounded-md">
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
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="w-4 h-4" />
              New Board
            </Button>
          </DialogTrigger>
          <DialogContent>
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
                <div className="flex gap-2">
                  <button type="button" onClick={() => setIsPrivate(false)}
                    className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm transition-colors ${!isPrivate ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent'}`}>
                    <Globe className="w-4 h-4" /> Everyone
                  </button>
                  <button type="button" onClick={() => setIsPrivate(true)}
                    className={`flex items-center gap-1.5 rounded border px-3 py-2 text-sm transition-colors ${isPrivate ? 'bg-foreground text-background border-foreground' : 'hover:bg-accent'}`}>
                    <Lock className="w-4 h-4" /> Private
                  </button>
                </div>
                {isPrivate && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="w-3 h-3" /> Only you and the people you pick can see this board — other admins can&apos;t</p>
                    <div className="max-h-40 overflow-y-auto rounded border divide-y">
                      {allUsers.map(u => (
                        <label key={u.id} className="flex items-center gap-2 px-3 py-2 hover:bg-accent cursor-pointer text-sm">
                          <input type="checkbox" checked={selectedMembers.includes(u.id)}
                            onChange={ev => setSelectedMembers(prev => ev.target.checked ? [...prev, u.id] : prev.filter(id => id !== u.id))}
                            className="rounded"
                          />
                          <span className="truncate">{u.full_name || u.email}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
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
                <div className="flex cursor-pointer items-center gap-3 p-3 pr-12">
                  <Kanban className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium">{board.title}</span>
                      {board.is_private && <Lock className="w-3.5 h-3.5 flex-shrink-0 text-muted-foreground" />}
                    </div>
                    <div className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Calendar className="w-3 h-3" />
                      Last edited {new Date(board.updated_at ?? board.created_at).toLocaleDateString('en-US')}
                      {(board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email) && (
                        <span className="truncate">
                          by {board.editor?.full_name || board.editor?.email || board.creator?.full_name || board.creator?.email}
                        </span>
                      )}
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
                      className="opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition-opacity bg-background/95 backdrop-blur-sm shadow-md hover:bg-background"
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
                    className="opacity-0 group-hover:opacity-100 hover:opacity-100 focus:opacity-100 transition-opacity bg-background/95 backdrop-blur-sm shadow-md hover:bg-background"
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
        <Card className="p-12 text-center">
          <Kanban className="w-16 h-16 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-xl font-semibold mb-2">No boards yet</h3>
          <p className="text-muted-foreground mb-6">Create your first board to get started</p>
          <Button onClick={() => setOpen(true)}>
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
              <Card key={board.id} className="flex items-center justify-between gap-3 p-4 bg-muted/40">
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
