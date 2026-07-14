'use client'

import React from "react"

import { DialogDescription } from "@/components/ui/dialog"
import { DialogTitle } from "@/components/ui/dialog"
import { DialogHeader } from "@/components/ui/dialog"
import { DialogContent } from "@/components/ui/dialog"
import { Dialog } from "@/components/ui/dialog"
import { DropdownMenuItem } from "@/components/ui/dropdown-menu"
import { DropdownMenuContent } from "@/components/ui/dropdown-menu"
import { DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { DropdownMenu } from "@/components/ui/dropdown-menu"
import { SelectItem } from "@/components/ui/select"
import { SelectContent } from "@/components/ui/select"
import { SelectValue } from "@/components/ui/select"
import { SelectTrigger } from "@/components/ui/select"
import { Select } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { useState, useEffect, useCallback, useMemo } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus, MoreVertical, Edit, Trash, Palette, Filter, X, LayoutGrid, List, Calendar, ArrowUpDown, ArrowUp, ArrowDown, ChevronUp, Download, MessageSquare } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import TaskCard from './task-card'
import CreateTaskDialog from './create-task-dialog'
import { TaskDetailModal } from './task-detail-modal'
import ChatPanel from '@/components/chat/chat-panel'
import { getAssigneeIds, getAssignees, getAssigneeNames } from '@/lib/assignees'
import { cleanBoardDescription, cleanTaskDescription } from '@/lib/display-text'
import { getNormalizedTaskStatus, getTaskStatusLabel } from '@/lib/task-status'
import { toast } from 'sonner'

interface BoardViewProps {
  board: any
  columns: any[]
  users: any[]
  isAdmin: boolean
  currentUserId: string
}

const BOARD_COLUMNS_SELECT = '*, tasks!tasks_column_id_fkey(*, assigned_to:profiles!tasks_assigned_to_fkey(id, full_name, email), task_assignees(user_id), task_tags(tag:tags(*)))'

export default function BoardView({ board, columns: initialColumns, users, isAdmin, currentUserId }: BoardViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [columns, setColumns] = useState(initialColumns)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [selectedColumn, setSelectedColumn] = useState<any>(null)
  const [newColumnDialogOpen, setNewColumnDialogOpen] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const [editingBoardTitle, setEditingBoardTitle] = useState(false)
  const [boardTitle, setBoardTitle] = useState(board.title)
  const [boardDescription, setBoardDescription] = useState(cleanBoardDescription(board.description))
  const [colorPickerColumn, setColorPickerColumn] = useState<string | null>(null)
  const [filterUser, setFilterUser] = useState<string>('all')
  const [filterPriority, setFilterPriority] = useState<string>('all')
  const [filterDateRange, setFilterDateRange] = useState<'all' | 'overdue' | 'today' | 'week' | 'month'>('all')
  const [showFilters, setShowFilters] = useState(false)
  const [sortConfig, setSortConfig] = useState<Array<{
    column: 'title' | 'assigned' | 'priority' | 'dueDate'
    direction: 'asc' | 'desc'
  }>>([])
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null)
  const [taskDetailOpen, setTaskDetailOpen] = useState(false)
  const [chatDialogOpen, setChatDialogOpen] = useState(false)
  const supabase = useMemo(() => createClient(), [])
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'tile' | 'list'>('tile')

  // Deep link support: global search links here with ?task=<id> so it can open
  // the specific task, not just land on the board.
  useEffect(() => {
    const taskParam = searchParams.get('task')
    if (taskParam) {
      setSelectedTaskId(taskParam)
      setTaskDetailOpen(true)
      router.replace(`/${isAdmin ? 'admin' : 'dashboard'}/board/${board.id}`)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  const canManageTask = useCallback((task: any) => {
    const assignedToId = typeof task?.assigned_to === 'string' ? task.assigned_to : task?.assigned_to?.id
    return Boolean(
      isAdmin
      || task?.created_by === currentUserId
      || assignedToId === currentUserId
      || getAssigneeIds(task).includes(currentUserId)
    )
  }, [currentUserId, isAdmin])

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

  const refreshColumns = useCallback(async () => {
    const { data: updatedColumns } = await supabase
      .from('columns')
      .select(BOARD_COLUMNS_SELECT)
      .eq('board_id', board.id)
      .order('position')

    if (updatedColumns) {
      setColumns(updatedColumns)
    }
  }, [board.id, supabase])

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
        refreshColumns
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
    }
  }, [refreshColumns, supabase])

  const onDragEnd = async (result: DropResult) => {
    const { destination, source, draggableId } = result

    if (!destination) return
    if (destination.droppableId === source.droppableId && destination.index === source.index) return

    const sourceColumn = columns.find(col => col.id === source.droppableId)
    const destColumn = columns.find(col => col.id === destination.droppableId)

    if (!sourceColumn || !destColumn) return

    const task = sourceColumn.tasks.find((t: any) => t.id === draggableId)
    if (!task) return
    if (!canManageTask(task)) {
      toast.error('Only admins, creators, and assignees can move this task.')
      return
    }

    // Update task column and position
    const newStatus = destColumn.title.toLowerCase().replace(/ /g, '_')

    // Optimistic update
    const prevColumns = columns
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

    const { error } = await supabase
      .from('tasks')
      .update({
        column_id: destColumn.id,
        status: newStatus,
        position: destination.index
      })
      .eq('id', draggableId)

    if (error) {
      setColumns(prevColumns)
      toast.error('Could not move task', { description: error.message })
    }
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
    return tasks.filter(task => {
      const taskDescription = cleanTaskDescription(task.description)
      const matchesSearch = task.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
                           taskDescription.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesUser = filterUser === 'all' || getAssigneeIds(task).includes(filterUser)
      const matchesPriority = filterPriority === 'all' || task.priority?.toString() === filterPriority
      
      // Date filtering
      let matchesDate = true
      if (filterDateRange !== 'all') {
        if (!task.due_date) {
          return false
        }

        const dueDate = new Date(task.due_date)
        const today = new Date()
        today.setHours(0, 0, 0, 0)
        
        switch (filterDateRange) {
          case 'overdue':
            matchesDate = dueDate < today && getNormalizedTaskStatus(task) !== 'done'
            break
          case 'today':
            matchesDate = dueDate.toDateString() === today.toDateString()
            break
          case 'week':
            const weekFromNow = new Date(today)
            weekFromNow.setDate(today.getDate() + 7)
            matchesDate = dueDate >= today && dueDate <= weekFromNow
            break
          case 'month':
            const monthFromNow = new Date(today)
            monthFromNow.setMonth(today.getMonth() + 1)
            matchesDate = dueDate >= today && dueDate <= monthFromNow
            break
        }
      }
      
      return matchesSearch && matchesUser && matchesPriority && matchesDate
    })
  }
      
  const activeFiltersCount = [
    filterUser !== 'all',
    filterPriority !== 'all',
    filterDateRange !== 'all',
    searchTerm !== ''
  ].filter(Boolean).length

  const clearFilters = () => {
    setSearchTerm('')
    setFilterUser('all')
    setFilterPriority('all')
    setFilterDateRange('all')
  }

  const handleSort = (column: 'title' | 'assigned' | 'priority' | 'dueDate', event: React.MouseEvent) => {
    const existingIndex = sortConfig.findIndex(s => s.column === column)
    
    if (event.shiftKey) {
      // Shift+Click: Add to multi-sort or toggle direction
      if (existingIndex >= 0) {
        // Toggle direction for existing sort
        const newConfig = [...sortConfig]
        newConfig[existingIndex].direction = newConfig[existingIndex].direction === 'asc' ? 'desc' : 'asc'
        setSortConfig(newConfig)
      } else {
        // Add new sort column
        setSortConfig([...sortConfig, { column, direction: 'asc' }])
      }
    } else {
      // Regular click: Single column sort or toggle
      if (existingIndex >= 0 && sortConfig.length === 1) {
        // Toggle direction if it's the only sort
        setSortConfig([{ column, direction: sortConfig[0].direction === 'asc' ? 'desc' : 'asc' }])
      } else {
        // Replace with new single sort
        setSortConfig([{ column, direction: 'asc' }])
      }
    }
  }
  
  const removeSortColumn = (column: 'title' | 'assigned' | 'priority' | 'dueDate') => {
    setSortConfig(sortConfig.filter(s => s.column !== column))
  }

  const sortTasks = (tasks: any[]) => {
    if (sortConfig.length === 0) return tasks

    return [...tasks].sort((a, b) => {
      // Apply each sort in order until we find a difference
      for (const { column, direction } of sortConfig) {
        let comparison = 0

        switch (column) {
          case 'title':
            comparison = (a.title || '').localeCompare(b.title || '')
            break
          case 'assigned':
            const nameA = getAssigneeNames(a, users)[0] || 'Unassigned'
            const nameB = getAssigneeNames(b, users)[0] || 'Unassigned'
            comparison = nameA.localeCompare(nameB)
            break
          case 'priority':
            comparison = (a.priority || 0) - (b.priority || 0)
            break
          case 'dueDate':
            const dateA = a.due_date ? new Date(a.due_date).getTime() : 0
            const dateB = b.due_date ? new Date(b.due_date).getTime() : 0
            comparison = dateA - dateB
            break
        }

        const result = direction === 'asc' ? comparison : -comparison
        if (result !== 0) return result
      }

      return 0
    })
  }

  const escapeCSVValue = (value: unknown) => {
    const stringValue = value == null ? '' : String(value)
    return `"${stringValue.replace(/"/g, '""')}"`
  }

  const exportVisibleTasksToCSV = () => {
    const headers = ['Board', 'Column', 'Title', 'Description', 'Assigned To', 'Priority', 'Status', 'Due Date', 'Tags']
    const rows = columns.flatMap((column) => {
      const visibleTasks = sortTasks(filterTasks((column.tasks || []).filter((task: any) => !task.deleted_at)))

      return visibleTasks.map((task: any) => {
        const assigneeNames = getAssigneeNames(task, users)
        const tags = task.task_tags?.map((tt: any) => tt.tag?.name).filter(Boolean).join('; ') || ''

        return [
          boardTitle,
          column.title,
          task.title,
          cleanTaskDescription(task.description),
          assigneeNames.length ? assigneeNames.join('; ') : 'Unassigned',
          task.priority || '',
          getTaskStatusLabel(task),
          task.due_date ? new Date(task.due_date).toLocaleDateString('en-US') : '',
          tags,
        ]
      })
    })

    const csv = [headers, ...rows]
      .map(row => row.map(escapeCSVValue).join(','))
      .join('\n')

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `${boardTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'board'}-tasks.csv`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (window.history.length > 1) {
                    router.back()
                  } else {
                    router.push(isAdmin ? '/admin' : '/dashboard')
                  }
                }}
              >
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
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
                  {boardDescription && (
                    <p className="text-sm text-muted-foreground">{boardDescription}</p>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              {/* View Toggle */}
              <div className="flex items-center border rounded-md">
                <Button
                  onClick={() => setViewMode('tile')}
                  variant={viewMode === 'tile' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-2 rounded-r-none"
                >
                  <LayoutGrid className="w-4 h-4" />
                  <span className="hidden sm:inline">Tile</span>
                </Button>
                <Button
                  onClick={() => setViewMode('list')}
                  variant={viewMode === 'list' ? 'default' : 'ghost'}
                  size="sm"
                  className="gap-2 rounded-l-none"
                >
                  <List className="w-4 h-4" />
                  <span className="hidden sm:inline">List</span>
                </Button>
              </div>

              <Button
                onClick={() => setShowFilters(!showFilters)}
                variant={activeFiltersCount > 0 ? "default" : "outline"}
                size="sm"
                className="gap-2 relative"
              >
                <Filter className="w-4 h-4" />
                <span className="hidden sm:inline">Filters</span>
                {activeFiltersCount > 0 && (
                  <Badge className="absolute -top-2 -right-2 h-5 w-5 p-0 flex items-center justify-center">
                    {activeFiltersCount}
                  </Badge>
                )}
              </Button>
              <Button onClick={() => setChatDialogOpen(true)} variant="outline" size="sm" className="hidden md:flex gap-2">
                <MessageSquare className="w-4 h-4" />
                Chat
              </Button>
              <Button onClick={exportVisibleTasksToCSV} variant="outline" size="sm" className="gap-2">
                <Download className="w-4 h-4" />
                <span className="hidden sm:inline">Export CSV</span>
              </Button>
              {isAdmin && (
                <Button onClick={() => setNewColumnDialogOpen(true)} size="sm" className="gap-2">
                  <Plus className="w-4 h-4" />
                  <span className="hidden sm:inline">Add Column</span>
                </Button>
              )}
            </div>
          </div>

          {/* Filter Bar */}
          {showFilters && (
            <div className="border-t pt-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">Filter Tasks</h3>
                <div className="flex items-center gap-2">
                  {activeFiltersCount > 0 && (
                    <Button variant="ghost" size="sm" onClick={clearFilters} className="h-7 gap-2">
                      <X className="w-3 h-3" />
                      Clear all
                    </Button>
                  )}
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => setShowFilters(false)} 
                    className="h-7 gap-1"
                  >
                    <ChevronUp className="w-4 h-4" />
                    Collapse
                  </Button>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
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
                      <SelectItem value="1">1 - Highest</SelectItem>
                      <SelectItem value="2">2 - High</SelectItem>
                      <SelectItem value="3">3 - Medium</SelectItem>
                      <SelectItem value="4">4 - Low</SelectItem>
                      <SelectItem value="5">5 - Lowest</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Due Date</label>
                  <Select value={filterDateRange} onValueChange={(value: any) => setFilterDateRange(value)}>
                    <SelectTrigger className="h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Dates</SelectItem>
                      <SelectItem value="overdue">Overdue</SelectItem>
                      <SelectItem value="today">Due Today</SelectItem>
                      <SelectItem value="week">Due This Week</SelectItem>
                      <SelectItem value="month">Due This Month</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1800px] px-4 py-6">
        {viewMode === 'tile' ? (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="-mx-4 overflow-x-auto px-4 pb-6 snap-x snap-mandatory md:snap-none scroll-pl-4">
              <div className="flex items-start gap-4">
                {columns.map((column) => {
                  const visibleTasks = filterTasks((column.tasks || []).filter((task: any) => !task.deleted_at))
                    .sort((a: any, b: any) => a.position - b.position)

                  return (
                    <section
                      key={column.id}
                      className="w-[min(360px,calc(100vw-2rem))] flex-shrink-0 rounded-lg border bg-muted/20 snap-start"
                    >
                      <div
                        className="rounded-t-lg border-t-4 px-4 py-3"
                        style={{
                          borderTopColor: column.color || '#3b82f6',
                          backgroundColor: column.color ? `${column.color}10` : undefined,
                        }}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {column.color && (
                                <div
                                  className="h-2.5 w-2.5 rounded-full"
                                  style={{ backgroundColor: column.color }}
                                />
                              )}
                              <h2 className="truncate text-base font-semibold">{column.title}</h2>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              onClick={() => handleOpenCreateDialog(column)}
                              aria-label={`Add task to ${column.title}`}
                            >
                              <Plus className="w-4 h-4" />
                            </Button>
                            {isAdmin && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm">
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
                            )}
                          </div>
                        </div>
                      </div>

                      <Droppable droppableId={column.id}>
                        {(provided, snapshot) => (
                          <div
                            ref={provided.innerRef}
                            {...provided.droppableProps}
                            className={`space-y-3 p-3 transition-colors ${
                              snapshot.isDraggingOver
                                ? 'bg-primary/5 ring-2 ring-inset ring-primary/20'
                                : ''
                            }`}
                          >
                            {visibleTasks.map((task: any, index: number) => (
                              <Draggable key={task.id} draggableId={task.id} index={index} isDragDisabled={!canManageTask(task)}>
                                {(provided, snapshot) => (
                                  <div
                                    ref={provided.innerRef}
                                    {...provided.draggableProps}
                                    {...provided.dragHandleProps}
                                  >
                                    <TaskCard
                                      task={task}
                                      isAdmin={isAdmin}
                                      currentUserId={currentUserId}
                                      users={users}
                                      board={board}
                                      isDragging={snapshot.isDragging}
                                      onUpdate={refreshColumns}
                                    />
                                  </div>
                                )}
                              </Draggable>
                            ))}
                            {visibleTasks.length === 0 && (
                              <div className="rounded-md border border-dashed bg-background/60 px-3 py-8 text-center text-sm text-muted-foreground">
                                No tasks match this view
                              </div>
                            )}
                            {provided.placeholder}
                          </div>
                        )}
                      </Droppable>
                    </section>
                  )
                })}
              </div>
            </div>
          </DragDropContext>
        ) : (
          <div className="space-y-6">
            {/* List View */}
            {sortConfig.length > 0 && (
              <div className="flex items-center gap-2 flex-wrap bg-background/80 backdrop-blur-sm p-3 rounded-lg border">
                <span className="text-sm font-medium text-muted-foreground">Active sorts:</span>
                {sortConfig.map((sort, index) => (
                  <Badge key={sort.column} variant="secondary" className="gap-2">
                    {index + 1}. {sort.column === 'dueDate' ? 'Due Date' : sort.column.charAt(0).toUpperCase() + sort.column.slice(1)}
                    {sort.direction === 'asc' ? ' ↑' : ' ↓'}
                    <X 
                      className="w-3 h-3 cursor-pointer hover:text-destructive" 
                      onClick={() => removeSortColumn(sort.column)}
                    />
                  </Badge>
                ))}
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => setSortConfig([])}
                  className="h-6 text-xs"
                >
                  Clear all
                </Button>
              </div>
            )}

            {columns.map((column) => {
              const columnTasks = filterTasks((column.tasks || []).filter((task: any) => !task.deleted_at))
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
                    <div className="space-y-3 md:hidden">
                      {sortTasks(columnTasks).map((task: any) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          isAdmin={isAdmin}
                          currentUserId={currentUserId}
                          users={users}
                          board={board}
                          onUpdate={refreshColumns}
                        />
                      ))}
                    </div>
                    <div className="hidden overflow-x-auto md:block">
                      <table className="w-full">
                        <thead>
                          <tr className="border-b">
                            <th 
                              className="text-left py-3 px-4 font-medium text-sm text-muted-foreground cursor-pointer hover:bg-accent/50 transition-colors"
                              onClick={(e) => handleSort('title', e)}
                              title="Click to sort, Shift+Click for multi-sort"
                            >
                              <div className="flex items-center gap-2">
                                Task
                                {(() => {
                                  const sortIndex = sortConfig.findIndex(s => s.column === 'title')
                                  if (sortIndex >= 0) {
                                    const sort = sortConfig[sortIndex]
                                    return (
                                      <div className="flex items-center gap-1">
                                        {sort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                        {sortConfig.length > 1 && (
                                          <Badge variant="secondary" className="h-4 w-4 p-0 flex items-center justify-center text-[10px]">
                                            {sortIndex + 1}
                                          </Badge>
                                        )}
                                      </div>
                                    )
                                  }
                                  return <ArrowUpDown className="w-3 h-3 opacity-40" />
                                })()}
                              </div>
                            </th>
                            <th 
                              className="text-left py-3 px-4 font-medium text-sm text-muted-foreground cursor-pointer hover:bg-accent/50 transition-colors"
                              onClick={(e) => handleSort('assigned', e)}
                              title="Click to sort, Shift+Click for multi-sort"
                            >
                              <div className="flex items-center gap-2">
                                Assigned
                                {(() => {
                                  const sortIndex = sortConfig.findIndex(s => s.column === 'assigned')
                                  if (sortIndex >= 0) {
                                    const sort = sortConfig[sortIndex]
                                    return (
                                      <div className="flex items-center gap-1">
                                        {sort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                        {sortConfig.length > 1 && (
                                          <Badge variant="secondary" className="h-4 w-4 p-0 flex items-center justify-center text-[10px]">
                                            {sortIndex + 1}
                                          </Badge>
                                        )}
                                      </div>
                                    )
                                  }
                                  return <ArrowUpDown className="w-3 h-3 opacity-40" />
                                })()}
                              </div>
                            </th>
                            <th 
                              className="text-left py-3 px-4 font-medium text-sm text-muted-foreground cursor-pointer hover:bg-accent/50 transition-colors"
                              onClick={(e) => handleSort('priority', e)}
                              title="Click to sort, Shift+Click for multi-sort"
                            >
                              <div className="flex items-center gap-2">
                                Priority
                                {(() => {
                                  const sortIndex = sortConfig.findIndex(s => s.column === 'priority')
                                  if (sortIndex >= 0) {
                                    const sort = sortConfig[sortIndex]
                                    return (
                                      <div className="flex items-center gap-1">
                                        {sort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                        {sortConfig.length > 1 && (
                                          <Badge variant="secondary" className="h-4 w-4 p-0 flex items-center justify-center text-[10px]">
                                            {sortIndex + 1}
                                          </Badge>
                                        )}
                                      </div>
                                    )
                                  }
                                  return <ArrowUpDown className="w-3 h-3 opacity-40" />
                                })()}
                              </div>
                            </th>
                            <th 
                              className="text-left py-3 px-4 font-medium text-sm text-muted-foreground cursor-pointer hover:bg-accent/50 transition-colors"
                              onClick={(e) => handleSort('dueDate', e)}
                              title="Click to sort, Shift+Click for multi-sort"
                            >
                              <div className="flex items-center gap-2">
                                Due Date
                                {(() => {
                                  const sortIndex = sortConfig.findIndex(s => s.column === 'dueDate')
                                  if (sortIndex >= 0) {
                                    const sort = sortConfig[sortIndex]
                                    return (
                                      <div className="flex items-center gap-1">
                                        {sort.direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                                        {sortConfig.length > 1 && (
                                          <Badge variant="secondary" className="h-4 w-4 p-0 flex items-center justify-center text-[10px]">
                                            {sortIndex + 1}
                                          </Badge>
                                        )}
                                      </div>
                                    )
                                  }
                                  return <ArrowUpDown className="w-3 h-3 opacity-40" />
                                })()}
                              </div>
                            </th>
                            <th className="text-left py-3 px-4 font-medium text-sm text-muted-foreground">Tags</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sortTasks(columnTasks).map((task: any) => {
                            const taskAssignees = getAssignees(task, users)
                            const taskDescription = cleanTaskDescription(task.description)
                            return (
                              <tr 
                                key={task.id} 
                                className="border-b hover:bg-accent/50 cursor-pointer transition-colors"
                                onClick={() => {
                                  setSelectedTaskId(task.id)
                                  setTaskDetailOpen(true)
                                }}
                              >
                                <td className="py-3 px-4">
                                  <div className="space-y-1">
                                    <div className="break-words font-medium [overflow-wrap:anywhere]">{task.title}</div>
                                    {taskDescription && (
                                      <div className="text-sm text-muted-foreground line-clamp-1">
                                        {taskDescription}
                                      </div>
                                    )}
                                  </div>
                                </td>
                                <td className="py-3 px-4" onClick={(e) => e.stopPropagation()}>
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    className="h-9 gap-2"
                                    onClick={() => {
                                      setSelectedTaskId(task.id)
                                      setTaskDetailOpen(true)
                                    }}
                                  >
                                    {taskAssignees.length > 0 ? (
                                      <>
                                        <div className="flex -space-x-2">
                                          {taskAssignees.slice(0, 3).map((u: any) => (
                                            <div
                                              key={u.id}
                                              className="w-6 h-6 rounded-full bg-primary/10 border border-background flex items-center justify-center text-xs font-medium"
                                              title={u.full_name || u.email}
                                            >
                                              {u.full_name?.[0] || u.email?.[0]}
                                            </div>
                                          ))}
                                        </div>
                                        <span className="text-sm">
                                          {taskAssignees.length === 1
                                            ? (taskAssignees[0].full_name || taskAssignees[0].email)
                                            : `${taskAssignees.length} people`}
                                        </span>
                                      </>
                                    ) : (
                                      <span className="text-sm text-muted-foreground">Assign</span>
                                    )}
                                  </Button>
                                </td>
                                <td className="py-3 px-4">
                                  <Badge variant={task.priority <= 2 ? 'destructive' : task.priority === 3 ? 'default' : 'secondary'}>
                                    {task.priority}
                                  </Badge>
                                </td>
                                <td className="py-3 px-4">
                                  {task.due_date ? (
                                    <div className="flex items-center gap-2 text-sm">
                                      <Calendar className="w-4 h-4" />
                                      {new Date(task.due_date).toLocaleDateString('en-US')}
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

      <Dialog open={chatDialogOpen} onOpenChange={setChatDialogOpen}>
        <DialogContent className="max-w-3xl p-0">
          <DialogHeader className="sr-only">
            <DialogTitle>Team chat</DialogTitle>
            <DialogDescription>Chat with another team member from this board.</DialogDescription>
          </DialogHeader>
          <ChatPanel currentUserId={currentUserId} isAdmin={isAdmin} className="border-0 shadow-none" />
        </DialogContent>
      </Dialog>

      {selectedTaskId && (
        <TaskDetailModal
          taskId={selectedTaskId}
          open={taskDetailOpen}
          onClose={() => {
            setTaskDetailOpen(false)
            setSelectedTaskId(null)
          }}
          onUpdate={async () => {
            await refreshColumns()
          }}
          board={board}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
        />
      )}

      <CreateTaskDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        column={selectedColumn}
        users={users}
        boardId={board.id}
        board={board}
        onTaskCreated={refreshColumns}
      />

      {isAdmin && (
        <>
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
