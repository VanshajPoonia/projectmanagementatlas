'use client'

import { useState, useEffect } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import Link from 'next/link'
import TaskCard from './task-card'
import CreateTaskDialog from './create-task-dialog'

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
  const supabase = createClient()

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
            .select('*, tasks(*, assigned_to:profiles!tasks_assigned_to_fkey(full_name, email), task_tags(tag:tags(*)))')
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

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-slate-100">
      <header className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center gap-4">
            <Link href={isAdmin ? '/admin' : '/dashboard'}>
              <Button variant="outline" size="sm">
                <ArrowLeft className="w-4 h-4 mr-2" />
                Back
              </Button>
            </Link>
            <div>
              <h1 className="text-xl font-bold tracking-tight">{board.title}</h1>
              <p className="text-sm text-muted-foreground">{board.description || 'No description'}</p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {columns.map((column) => (
              <div key={column.id} className="flex-shrink-0 w-80">
                <Card className="h-full">
                  <CardHeader className="flex flex-row items-center justify-between space-y-0">
                    <CardTitle className="text-lg">{column.title}</CardTitle>
                    {isAdmin && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => handleOpenCreateDialog(column)}
                      >
                        <Plus className="w-4 h-4" />
                      </Button>
                    )}
                  </CardHeader>
                  <CardContent>
                    <Droppable droppableId={column.id}>
                      {(provided, snapshot) => (
                        <div
                          ref={provided.innerRef}
                          {...provided.droppableProps}
                          className={`space-y-2 min-h-[200px] rounded-lg p-2 transition-colors ${
                            snapshot.isDraggingOver ? 'bg-accent/50' : ''
                          }`}
                        >
                          {column.tasks?.sort((a: any, b: any) => a.position - b.position).map((task: any, index: number) => (
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
                                    isDragging={snapshot.isDragging}
                                    onUpdate={async () => {
                                      const { data: updatedColumns } = await supabase
                                        .from('columns')
                                        .select('*, tasks(*, assigned_to:profiles!tasks_assigned_to_fkey(full_name, email), task_tags(tag:tags(*)))')
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
      </main>

      {isAdmin && (
        <CreateTaskDialog
          open={createDialogOpen}
          onOpenChange={setCreateDialogOpen}
          column={selectedColumn}
          users={users}
          boardId={board.id}
        />
      )}
    </div>
  )
}
