'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Lock, MoveRight } from 'lucide-react'
import { toast } from 'sonner'
import { useTaskStatuses } from '@/lib/use-task-statuses'
import { logTaskActivity } from '@/lib/task-activity'
import {
  chooseDestinationColumn,
  describeMove,
  selectableBoards,
  type BoardOption,
  type DestinationColumn,
} from '@/lib/move-task'

interface MoveTaskDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  taskId: string
  /** The task's current status key, used to pick a sensible landing column. */
  taskStatus?: string | null
  currentBoardId?: string | null
  currentBoardTitle?: string | null
  currentUserId?: string | null
  /** Called after the move succeeds, with the destination board id. */
  onMoved: (destinationBoardId: string) => void
}

export function MoveTaskDialog({
  open,
  onOpenChange,
  taskId,
  taskStatus,
  currentBoardId,
  currentBoardTitle,
  currentUserId,
  onMoved,
}: MoveTaskDialogProps) {
  const supabase = useMemo(() => createClient(), [])
  const taskStatuses = useTaskStatuses()

  const [boards, setBoards] = useState<BoardOption[]>([])
  const [columns, setColumns] = useState<DestinationColumn[]>([])
  const [boardId, setBoardId] = useState<string>('')
  const [columnId, setColumnId] = useState<string>('')
  const [loadingBoards, setLoadingBoards] = useState(false)
  const [loadingColumns, setLoadingColumns] = useState(false)
  const [moving, setMoving] = useState(false)

  const statusLabel = taskStatuses.find((s) => s.key === taskStatus)?.label

  // Reset every time the dialog opens. Left alone, a second move in the same session would
  // start pre-pointed at the previous destination, which is a very easy way to file a task
  // somewhere nobody meant to.
  useEffect(() => {
    if (!open) return
    setBoardId('')
    setColumnId('')
    setColumns([])

    let cancelled = false
    setLoadingBoards(true)
    ;(async () => {
      // No is_private filter and no membership join: RLS already returns only the boards this
      // user may see (061), so anything that comes back is a legitimate destination as far as
      // reading goes. Whether they may *write* there is decided by migration 102 at move time.
      const { data, error } = await supabase
        .from('boards')
        .select('id, title, archived_at, is_private')
        .order('title')

      if (cancelled) return
      setLoadingBoards(false)
      if (error) {
        toast.error('Could not load boards', { description: error.message })
        return
      }
      setBoards(selectableBoards((data ?? []) as BoardOption[], currentBoardId))
    })()

    return () => { cancelled = true }
  }, [open, supabase, currentBoardId])

  const pickBoard = useCallback(async (nextBoardId: string) => {
    setBoardId(nextBoardId)
    setColumnId('')
    setColumns([])
    setLoadingColumns(true)

    const { data, error } = await supabase
      .from('columns')
      .select('id, title, position, status_key')
      .eq('board_id', nextBoardId)
      .order('position')

    setLoadingColumns(false)
    if (error) {
      toast.error('Could not load that board’s columns', { description: error.message })
      return
    }

    const next = (data ?? []) as DestinationColumn[]
    setColumns(next)
    // Pre-select where the task would naturally land, so the common case is one click. The
    // select stays editable because "naturally" is a guess about someone else's board.
    setColumnId(chooseDestinationColumn(taskStatus, statusLabel, next)?.id ?? '')
  }, [supabase, taskStatus, statusLabel])

  const handleMove = async () => {
    if (!columnId) return
    setMoving(true)

    // move_task_to_board (migration 102) rather than a direct UPDATE: it moves the task and its
    // subtasks in one transaction, and it raises on a refusal instead of reporting zero rows,
    // which under RLS is otherwise indistinguishable from "nothing to do".
    const { data, error } = await supabase.rpc('move_task_to_board', {
      p_task_id: taskId,
      p_column_id: columnId,
    })
    setMoving(false)

    if (error || !data) {
      toast.error('Could not move this task', {
        description: error?.message ?? 'The move was refused. Nothing was changed.',
      })
      return
    }

    const destinationBoard = boards.find((b) => b.id === boardId)
    const destinationColumn = columns.find((c) => c.id === columnId)
    logTaskActivity(
      supabase,
      taskId,
      currentUserId,
      describeMove(currentBoardTitle, destinationBoard?.title, destinationColumn?.title),
    )

    toast.success(`Moved to ${destinationBoard?.title ?? 'the other board'}`, {
      description: destinationColumn?.title
        ? `It is now in “${destinationColumn.title}”, with its comments, attachments and subtasks.`
        : 'Its comments, attachments and subtasks came with it.',
    })
    onOpenChange(false)
    onMoved(data as string)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Move to another board</DialogTitle>
          <DialogDescription>
            The task keeps its comments, attachments, links, activity history and subtasks - only
            the board it sits on changes.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="move-board">Board</Label>
            <Select value={boardId} onValueChange={pickBoard} disabled={loadingBoards || moving}>
              <SelectTrigger id="move-board">
                <SelectValue placeholder={loadingBoards ? 'Loading boards…' : 'Choose a board'} />
              </SelectTrigger>
              <SelectContent>
                {boards.map((board) => (
                  <SelectItem key={board.id} value={board.id}>
                    <span className="flex items-center gap-2">
                      {board.is_private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      {board.title}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {!loadingBoards && boards.length === 0 && (
              <p className="text-xs text-muted-foreground">
                There is no other board to move this to.
              </p>
            )}
          </div>

          {boardId && (
            <div className="space-y-2">
              <Label htmlFor="move-column">Column</Label>
              <Select value={columnId} onValueChange={setColumnId} disabled={loadingColumns || moving}>
                <SelectTrigger id="move-column">
                  <SelectValue placeholder={loadingColumns ? 'Loading columns…' : 'Choose a column'} />
                </SelectTrigger>
                <SelectContent>
                  {columns.map((column) => (
                    <SelectItem key={column.id} value={column.id}>{column.title}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {!loadingColumns && columns.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  That board has no columns yet, so there is nowhere to put this task. Add a column
                  to it first.
                </p>
              )}
            </div>
          )}

          {currentBoardTitle && boardId && columnId && (
            <p className="flex flex-wrap items-center gap-1.5 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{currentBoardTitle}</span>
              <MoveRight className="h-3.5 w-3.5" />
              <span className="font-medium text-foreground">
                {boards.find((b) => b.id === boardId)?.title}
              </span>
              <span>· {columns.find((c) => c.id === columnId)?.title}</span>
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={moving}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={!columnId || moving}>
            {moving ? 'Moving…' : 'Move task'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
