'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Search, X } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { createClient } from '@/lib/supabase/client'
import { cleanTaskDescription } from '@/lib/display-text'
import { getTaskStatusLabel } from '@/lib/task-status'

interface GlobalSearchProps {
  isAdmin: boolean
}

interface SearchableTask {
  id: string
  title: string
  description: string | null
  priority: number | null
  due_date: string | null
  status: string | null
  board_id: string
  board_title: string
  haystack: string
}

export default function GlobalSearch({ isAdmin }: GlobalSearchProps) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [tasks, setTasks] = useState<SearchableTask[]>([])
  const containerRef = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const load = async () => {
      const [{ data: taskRows }, { data: commentRows }] = await Promise.all([
        supabase
          .from('tasks')
          .select('id, title, description, priority, due_date, status, column:columns(board_id, board:boards(id, title, archived_at))')
          .is('deleted_at', null),
        supabase.from('task_comments').select('task_id, comment'),
      ])

      const commentsByTask = new Map<string, string[]>()
      for (const row of commentRows ?? []) {
        const list = commentsByTask.get(row.task_id) ?? []
        list.push(row.comment ?? '')
        commentsByTask.set(row.task_id, list)
      }

      const searchable = (taskRows ?? [])
        .filter((task: any) => task.column?.board && !task.column.board.archived_at)
        .map((task: any) => {
        const description = cleanTaskDescription(task.description)
        const boardId = task.column?.board_id
        const boardTitle = task.column?.board?.title ?? ''
        const comments = (commentsByTask.get(task.id) ?? []).join(' ')
        return {
          id: task.id,
          title: task.title,
          description,
          priority: task.priority,
          due_date: task.due_date,
          status: task.status,
          board_id: boardId,
          board_title: boardTitle,
          haystack: `${task.title} ${description} ${boardTitle} ${comments}`.toLowerCase(),
        }
      })

      setTasks(searchable)
    }
    load()
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const results = terms.length
    ? tasks.filter((task) => terms.every((term) => task.haystack.includes(term))).slice(0, 8)
    : []

  const goToTask = (task: SearchableTask) => {
    if (!task.board_id) return
    setOpen(false)
    setQuery('')
    router.push(`/${isAdmin ? 'admin' : 'dashboard'}/board/${task.board_id}`)
  }

  return (
    <div ref={containerRef} className="relative w-full max-w-sm">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false)
          }}
          placeholder="Search tasks... (multiple words = match all)"
          className="pl-8 pr-8"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {open && terms.length > 0 && (
        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-96 overflow-y-auto">
          {results.length === 0 ? (
            <p className="p-3 text-sm text-muted-foreground">No tasks match "{query}"</p>
          ) : (
            results.map((task) => (
              <button
                key={task.id}
                type="button"
                onClick={() => goToTask(task)}
                className="flex w-full flex-col items-start gap-1 border-b p-3 text-left last:border-b-0 hover:bg-accent"
              >
                <div className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{task.title}</span>
                  {task.priority && (
                    <Badge variant="outline" className="shrink-0 text-xs">
                      P{task.priority}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{task.board_title}</span>
                  {task.status && <span>&middot; {getTaskStatusLabel(task as any)}</span>}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
