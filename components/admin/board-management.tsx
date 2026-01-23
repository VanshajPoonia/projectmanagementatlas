'use client'

import React from "react"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Plus, Kanban, Calendar, Trash2, MoreVertical, Edit, Palette } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import Link from 'next/link'

interface BoardManagementProps {
  boards: any[]
}

export default function BoardManagement({ boards: initialBoards }: BoardManagementProps) {
  const [boards, setBoards] = useState(initialBoards)
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [editingBoard, setEditingBoard] = useState<any>(null)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [boardColor, setBoardColor] = useState('#3b82f6')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const supabase = createClient()

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
          created_by: user.id 
        })
        .select()
        .single()

      if (boardError) throw boardError

      // Create default columns
      const columns = [
        { title: 'To Do', position: 0, board_id: board.id },
        { title: 'In Progress', position: 1, board_id: board.id },
        { title: 'Done', position: 2, board_id: board.id },
      ]

      await supabase.from('columns').insert(columns)

      setBoards([board, ...boards])
      setTitle('')
      setDescription('')
      setOpen(false)
    } catch (err) {
      setError('Failed to create board. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleEditBoard = (board: any, e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setEditingBoard(board)
    setTitle(board.title)
    setDescription(board.description || '')
    setBoardColor(board.color || '#3b82f6')
    setEditOpen(true)
  }

  const handleUpdateBoard = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editingBoard) return
    
    setLoading(true)
    setError(null)

    try {
      const { error } = await supabase
        .from('boards')
        .update({
          title: title.trim(),
          description: description.trim() || null,
          color: boardColor,
        })
        .eq('id', editingBoard.id)

      if (error) throw error

      // Update local state
      setBoards(boards.map(b => 
        b.id === editingBoard.id 
          ? { ...b, title: title.trim(), description: description.trim(), color: boardColor }
          : b
      ))
      
      setEditOpen(false)
      setEditingBoard(null)
      setTitle('')
      setDescription('')
      setBoardColor('#3b82f6')
    } catch (err) {
      setError('Failed to update board. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteBoard = async (boardId: string, boardTitle: string, e: React.MouseEvent) => {
    e.preventDefault() // Prevent navigation
    e.stopPropagation() // Stop event bubbling

    const confirmed = window.confirm(
      `Are you sure you want to delete "${boardTitle}"?\n\nThis will permanently delete the board and all its tasks, columns, and data. This action cannot be undone.`
    )
    
    if (!confirmed) return

    try {
      // Delete the board (cascade will handle related data)
      const { error } = await supabase
        .from('boards')
        .delete()
        .eq('id', boardId)

      if (error) throw error

      // Update local state
      setBoards(boards.filter(b => b.id !== boardId))
    } catch (err) {
      alert('Failed to delete board. Please try again.')
      console.error('Delete board error:', err)
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
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating Board...' : 'Create Board'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

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
                      <CardTitle className="text-lg truncate">{board.title}</CardTitle>
                      <CardDescription className="text-sm line-clamp-2">
                        {board.description || 'No description'}
                      </CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Calendar className="w-4 h-4" />
                    Created {new Date(board.created_at).toLocaleDateString()}
                  </div>
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
                    className="text-destructive focus:text-destructive cursor-pointer"
                    onClick={(e) => handleDeleteBoard(board.id, board.title, e)}
                  >
                    <Trash2 className="w-4 h-4 mr-2" />
                    Delete Board
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </Card>
        ))}
      </div>

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
    </div>
  )
}
