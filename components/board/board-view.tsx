'use client'

import { useState, useEffect, useRef } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus, MoreVertical, Edit, Trash, Palette, Filter, X, LayoutGrid, List, Calendar } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import TaskCard from './task-card'
import CreateTaskDialog from './create-task-dialog'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { gsap } from 'gsap'
import {
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuTrigger 
} from '@/components/ui/dropdown-menu'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

interface BoardViewProps {
  board: any
  columns: any[]
  users: any[]
  isAdmin: boolean
  currentUserId: string
}

export default function BoardView({ board, columns: initialColumns, users, isAdmin, currentUserId }: BoardViewProps) {
  const [columns, setColumns] = useState(initialColumns)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [selectedColumn, setSelectedColumn] = useState<any>(null)
  const [newColumnDialogOpen, setNewColumnDialogOpen] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const [editingBoardTitle, setEditingBoardTitle] = useState(false)
  const [boardTitle, setBoardTitle] = useState(board.title)
  const [boardDescription, setBoardDescription] = useState(board.description || '')
  const [colorPickerColumn, setColorPickerColumn] = useState<string | null>(null)
  const [filterUser, setFilterUser] = useState<string>('all')
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [searchTerm, setSearchTerm] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [viewMode, setViewMode] = useState<'tile' | 'list'>('tile')
  const columnsRef = useRef<(HTMLDivElement | null)[]>([])
  const headerRef = useRef<HTMLDivElement>(null)
  const supabase = createClient()

  const columnColors = [
    '#3b82f6', // blue
    '#10b981', // green
    '#f59e0b', // amber
    '#ef4444', // red
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#06b6d4', // cyan
    '#84cc16', // lime
  ]

  // GSAP animations on mount
  useEffect(() => {
    if (headerRef.current) {
      gsap.fromTo(
        headerRef.current,
        { y: -100, opacity: 0 },
        { y: 0, opacity: 1, duration: 0.8, ease: 'power3.out' }
      )
    }

    columnsRef.current.forEach((col, index) => {
      if (col) {
        gsap.fromTo(
          col,
          { y: 50, opacity: 0, scale: 0.9 },
          { 
            y: 0, 
            opacity: 1, 
            scale: 1,
            duration: 0.6, 
            delay: index * 0.1,
            ease: 'back.out(1.2)'
          }
        )
      }
    })
  }, [columns.length])

  useEffect(() => {
    // Subscribe to real-time updates
    const channel = supabase
      .channel('board-changes')
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'tasks',
        },
        async () => {
          // Refresh tasks
          const { data: updatedColumns } = await supabase
            .from('columns')
            .select('*, tasks!tasks_column_id_fkey(*, assigned_to:profiles!tasks_assigned_to_fkey(full_name, email), task_tags(tag:tags(*)))')
            .eq('board_id', board.id)
            .order('position')
          
          if (updatedColumns) {
            setColumns(updatedColumns)
          }
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [board.id, supabase])

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result

    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const sourceColumn = columns.find(col => col.id === source.droppableId)
    const destColumn = columns.find(col => col.id === destination.droppableId)

    if (!sourceColumn || !destColumn) return

    const task = sourceColumn.tasks.find((t: any) => t.id === draggableId)
    if (!task) return

    // Update task column and position
    const newStatus = destColumn.title.toLowerCase().replace(' ', '_')
    
    await supabase
      .from('tasks')
      .update({ 
        column_id: destColumn.id,
        status: newStatus,
        position: destination.index 
      })
      .eq('id', draggableId)

    // Optimistic update
    const newColumns = columns.map(col => {
      if (col.id === source.droppableId) {
        return {
          ...col,
          tasks: col.tasks.filter((t: any) => t.id !== draggableId)
        }
      }
      if (col.id === destination.droppableId) {
        const newTasks = [...col.tasks]
        newTasks.splice(destination.index, 0, { ...task, column_id: destColumn.id, status: newStatus })
        return {
          ...col,
          tasks: newTasks
        }
      }
      return col
    })

    setColumns(newColumns)
  }

  const handleOpenCreateDialog = (column: any) => {
    setSelectedColumn(column)
    setCreateDialogOpen(true)
  }

  const handleAddColumn = async () => {
    if (!newColumnTitle.trim()) return
    
    const { data, error } = await supabase
      .from('columns')
      .insert({
        title: newColumnTitle,
        board_id: board.id,
        position: columns.length
      })
      .select()
      .single()

    if (data && !error) {
      setColumns([...columns, { ...data, tasks: [] }])
      setNewColumnTitle('')
      setNewColumnDialogOpen(false)
    }
  }

  const handleDeleteColumn = async (columnId: string) => {
    if (!confirm('Are you sure? This will delete all tasks in this column.')) return
    
    await supabase.from('columns').delete().eq('id', columnId)
    setColumns(columns.filter(col => col.id !== columnId))
  }

  const handleUpdateBoardTitle = async () => {
    if (!boardTitle.trim()) return
    
    await supabase
      .from('boards')
      .update({ title: boardTitle, description: boardDescription })
      .eq('id', board.id)
    
    setEditingBoardTitle(false)
  }

  const handleUpdateColumnColor = async (columnId: string, color: string) => {
    await supabase
      .from('columns')
      .update({ color })
      .eq('id', columnId)
    
    setColumns(columns.map(col => col.id === columnId ? { ...col, color } : col))
    setColorPickerColumn(null)
  }

  const filterTasks = (tasks: any[]) => {
    if (!tasks) return []
    
    return tasks.filter(task => {
      // Filter by user
      if (filterUser !== 'all' && task.assigned_to !== filterUser) {
        return false
      }
      
      // Filter by priority
      if (filterPriority !== 'all' && task.priority !== filterPriority) {
        return false
      }
      
      // Filter by search term
      if (searchTerm) {
        const searchLower = searchTerm.toLowerCase()
        const matchesTitle = task.title?.toLowerCase().includes(searchLower)
        const matchesDescription = task.description?.toLowerCase().includes(searchLower)
        if (!matchesTitle && !matchesDescription) {
          return false
        }
      }
      
      return true
    })
  }

  const activeFiltersCount = [
    filterUser !== 'all',
    filterPriority !== 'all',
    searchTerm !== ''
  ].filter(Boolean).length

  const clearFilters = () => {
    setFilterUser('all')
    setFilterPriority('all')
    setSearchTerm('')
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <header ref={headerRef} className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4 flex-1">
              <Link href={isAdmin ? '/admin' : '/dashboard'}>
                <Button variant="outline" size="sm">
                  <ArrowLeft className="w-4 h-4 mr-2" />
                  Back
                </Button>
              </Link>
              {editingBoardTitle && isAdmin ? (
                <div className="flex-1 max-w-xl space-y-2">
                  <Input
                    value={boardTitle}
                    onChange={(e) => setBoardTitle(e.target.value)}
                    onBlur={handleUpdateBoardTitle}
                    onKeyDown={(e) => e.key === 'Enter' && handleUpdateBoardTitle()}
                    className="font-bold text-lg"
                    autoFocus
                  />
                  <Input
                    value={boardDescription}
                    onChange={(e) => setBoardDescription(e.target.value)}
                    onBlur={handleUpdateBoardTitle}
                    placeholder="Add description..."
                    className="text-sm"
                  />
                </div>
              ) : (
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h1 className="text-xl font-bold tracking-tight">{boardTitle}</h1>
                    {isAdmin && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setEditingBoardTitle(true)}
                        className="h-6 w-6 p-0"
                      >
                        <Edit className="w-3 h-3" />
                      </Button>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{boardDescription || 'No description'}</p>
                </div>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              {/* View Toggle */}
              <div className="flex items-center border rounded-md">
                <Button 
                  onClick={() => setViewMode('tile')} 
                  variant={viewMode === 'tile' ? 'default' : 'ghost'}
                  size="sm" 
                  className="gap-2 rounded-r-none"
                >
                  <LayoutGrid className="w-4 h-4" />
                  Tile
                </Button>
                <Button 
                  onClick={() => setViewMode('list')} 
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm" 
                  className="gap-2 rounded-l-none"
                >
                  <List className="w-4 h-4" />
                  List
                </Button>
              </div>
              
              <Button 
                onClick={() => setShowFilters(!showFilters)} 
                variant={activeFiltersCount > 0 ? "default" : "outline"}
                size="sm" 
                className="gap-2 relative"
              >
                <Filter className="w-4 h-4" />
                Filters
                {activeFiltersCount > 0 && (
                  <Badge className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center">
                    {activeFiltersCount}
                  </Badge>
                )}
              </Button>
              {isAdmin && (
                <Button onClick={() => setNewColumnDialogOpen(true)} size="sm" className="gap-2">
                  <Plus className="w-4 h-4" />
                  Add Column
                </Button>
              )}
            </div>
          </div>

          {/* Filter Bar */}
          {showFilters && (
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Filter Tasks</h3>
                {activeFiltersCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 gap-2">
                    <X className="w-3 h-3" />
                    Clear all
                  </Button>
                )}
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Search</label>
                  <Input
                    placeholder="Search tasks..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="h-9"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Assigned to</label>
                  <Select value={filterUser} onValueChange={setFilterUser}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Users</SelectItem>
                      {users.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.full_name || user.email}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Priority</label>
                  <Select value={filterPriority} onValueChange={setFilterPriority}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Priorities</SelectItem>
                      <SelectItem value="1">1 - Lowest</SelectItem>
                      <SelectItem value="2">2 - Low</SelectItem>
                      <SelectItem value="3">3 - Medium</SelectItem>
                      <SelectItem value="4">4 - High</SelectItem>
                      <SelectItem value="5">5 - Highest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        {viewMode === 'tile' ? (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="flex gap-4 overflow-x-auto pb-4">
              {columns.map((column, index) => (
                <div 
                  key={column.id} 
                  ref={el => columnsRef.current[index] = el}
                  className="flex-shrink-0 w-80"
                >
                  <Card 
                    className="h-full bg-white/60 backdrop-blur-sm shadow-sm hover:shadow-lg transition-all hover:scale-[1.01] border-t-4"
                    style={{ borderTopColor: column.color || '#3b82f6' }}
                  >
                    <CardHeader 
                      className="flex flex-row items-center justify-between space-y-0 pb-3 rounded-t-lg transition-colors"
                      style={{ backgroundColor: column.color ? `${column.color}10` : undefined }}
                    >
                      <div className="flex items-center gap-2">
                        {column.color && (
                          <div 
                            className="w-3 h-3 rounded-full animate-pulse" 
                            style={{ backgroundColor: column.color }}
                          />
                        )}
                        <CardTitle className="text-lg font-semibold">{column.title}</CardTitle>
                      </div>
                      {isAdmin && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => handleOpenCreateDialog(column)}
                            className="h-8 w-8 p-0 hover:scale-110 transition-transform"
                          >
                            <Plus className="w-4 h-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="sm" className="h-8 w-8 p-0 hover:scale-110 transition-transform">
                                <MoreVertical className="w-4 h-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-48">
                              <DropdownMenuItem onClick={() => setColorPickerColumn(column.id)}>
                                <Palette className="w-4 h-4 mr-2" />
                                Change Color
                              </DropdownMenuItem>
                              <DropdownMenuItem onClick={() => handleDeleteColumn(column.id)} className="text-red-600">
                                <Trash className="w-4 h-4 mr-2" />
                                Delete Column
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      )}
                    </CardHeader>
                    <CardContent>
                      <Droppable droppableId={column.id}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`space-y-3 min-h-[200px] rounded-lg p-3 transition-all duration-300 ${
                              snapshot.isDraggingOver 
                                ? 'bg-gradient-to-b from-primary/10 to-primary/5 ring-2 ring-primary/30 scale-[1.02]' 
                                : 'bg-transparent'
                            }`}
                          >
                            {filterTasks(column.tasks || [])?.sort((a: any, b: any) => a.position - b.position).map((task: any, index: number) => (
                              <Draggable key={task.id} draggableId={task.id} index={index}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                  >
                                    <TaskCard 
                                      task={task} 
                                      isAdmin={isAdmin}
                                      users={users}
                                      board={board}
                                      isDragging={snapshot.isDragging}
                                      onUpdate={async () => {
                                        const { data: updatedColumns } = await supabase
                                          .from('columns')
                                          .select('*, tasks!tasks_column_id_fkey(*, assigned_to:profiles!tasks_assigned_to_fkey(full_name, email), task_tags(tag:tags(*)))')
                                          .eq('board_id', board.id)
                                          .order('position')
                                        if (updatedColumns) setColumns(updatedColumns)
                                      }}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </CardContent>
                  </Card>
                </div>
            ))}
          </div>
        </DragDropContext>
        ) : (
          /* List View */
          <div className="space-y-6">
            {columns.map((column) => {
              const columnTasks = filterTasks(column.tasks || [])
              if (columnTasks.length === 0) return null
              
              return (
                <Card key={column.id} className="shadow-sm">
                  <CardHeader className="pb-3" style={{ backgroundColor: column.color ? `${column.color}10` : undefined }}>
                    <div className="flex items-center gap-3">
                      {column.color && (
                        <div className="w-3 h-3 rounded-full" style={{ backgroundColor: column.color }} />
                      )}
                      <CardTitle>{column.title}</CardTitle>
                      <Badge variant="secondary">{columnTasks.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th className="text-left py-3 px-4 font-medium text-sm text-muted-foreground">Task</th>
                            <th className="text-left py-3 px-4 font-medium text-sm text-muted-foreground">Assigned</th>
                            <th className="text-left py-3 px-4 font-medium text-sm text-muted-foreground">Priority</th>
                            <th className="text-left py-3 px-4 font-medium text-sm text-muted-foreground">Due Date</th>
                            <th className="text-left py-3 px-4 font-medium text-sm text-muted-foreground">Tags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {columnTasks.sort((a: any, b: any) => a.position - b.position).map((task: any) => {
                            const assignedUser = users.find(u => u.id === task.assigned_to)
                            return (
                              <tr 
                                key={task.id} 
                                className="border-b hover:bg-accent/50 cursor-pointer transition-colors"
                                onClick={() => {
                                  /* Open task detail modal */
                                }}
                              >
                                <td className="py-3 px-4">
                                  <div className="space-y-1">
                                    <div className="font-medium">{task.title}</div>
                                    {task.description && (
                                      <div className="text-sm text-muted-foreground line-clamp-1">
                                        {task.description}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4">
                                  {assignedUser ? (
                                    <div className="flex items-center gap-2">
                                      <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center text-sm font-medium">
                                        {assignedUser.full_name?.[0] || assignedUser.email?.[0]}
                                      </div>
                                      <span className="text-sm">{assignedUser.full_name || assignedUser.email}</span>
                                    </div>
                                  ) : (
                                    <span className="text-sm text-muted-foreground">Unassigned</span>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <Badge variant={task.priority >= 4 ? 'destructive' : task.priority === 3 ? 'default' : 'secondary'}>
                                    {task.priority}
                                  </Badge>
                                </td>
                                <td className="py-3 px-4">
                                  {task.due_date ? (
                                    <div className="flex items-center gap-2 text-sm">
                                      <Calendar className="w-4 h-4" />
                                      {new Date(task.due_date).toLocaleDateString()}
                                    </div>
                                  ) : (
                                    <span className="text-sm text-muted-foreground">No date</span>
                                  )}
                                </td>
                                <td className="py-3 px-4">
                                  <div className="flex gap-1 flex-wrap">
                                    {task.task_tags?.map((tt: any) => (
                                      <Badge 
                                        key={tt.tag.id} 
                                        variant="outline"
                                        style={{ 
                                          borderColor: tt.tag.color,
                                          color: tt.tag.color 
                                        }}
                                      >
                                        {tt.tag.name}
                                      </Badge>
                                    ))}
                                  </div>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        )}
      </main>

      {isAdmin && (
        <>
          <CreateTaskDialog
            open={createDialogOpen}
            onOpenChange={setCreateDialogOpen}
            column={selectedColumn}
            users={users}
            boardId={board.id}
            board={board}
            onTaskCreated={async () => {
              const { data: updatedColumns } = await supabase
                .from('columns')
                .select('*, tasks!tasks_column_id_fkey(*, assigned_to:profiles!tasks_assigned_to_fkey(full_name, email), task_tags(tag:tags(*)))')
                .eq('board_id', board.id)
                .order('position')
              if (updatedColumns) setColumns(updatedColumns)
            }}
          />
          
          <Dialog open={newColumnDialogOpen} onOpenChange={setNewColumnDialogOpen}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Add New Column</DialogTitle>
                <DialogDescription>
                  Create a new column to organize your tasks
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <Input
                  placeholder="Column title (e.g., Review, Testing)"
                  value={newColumnTitle}
                  onChange={(e) => setNewColumnTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddColumn()}
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setNewColumnDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddColumn}>Add Column</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={colorPickerColumn !== null} onOpenChange={() => setColorPickerColumn(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Choose Column Color</DialogTitle>
                <DialogDescription>
                  Select a color to personalize your column
                </DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-4 gap-4 py-4">
                {columnColors.map((color) => (
                  <button
                    key={color}
                    onClick={() => colorPickerColumn && handleUpdateColumnColor(colorPickerColumn, color)}
                    className="w-full aspect-square rounded-lg border-2 border-transparent hover:border-primary hover:scale-110 transition-all cursor-pointer"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
