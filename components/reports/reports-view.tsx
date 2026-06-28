'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Filter, X, Download, Calendar as CalendarIcon, Users, Tag, Printer, ExternalLink } from 'lucide-react'
import { format } from 'date-fns'
import Link from 'next/link'
import { getAssigneeIds, getAssigneeNames } from '@/lib/assignees'
import { cleanTaskDescription } from '@/lib/display-text'
import { getTaskStatusLabel } from '@/lib/task-status'
import { useTaskStatuses } from '@/lib/use-task-statuses'

interface ReportsViewProps {
  tasks: any[]
  users: any[]
  boards: any[]
}

const UNASSIGNED_FILTER_VALUE = '__unassigned__'

export default function ReportsView({ tasks, users, boards }: ReportsViewProps) {
  const [filteredTasks, setFilteredTasks] = useState(tasks)
  const [filterUser, setFilterUser] = useState<string[]>([])
  const [filterTags, setFilterTags] = useState<string[]>([])
  const [filterPriority, setFilterPriority] = useState<string[]>([])
  const [filterStatus, setFilterStatus] = useState<string[]>([])
  const [filterBoard, setFilterBoard] = useState<string[]>([])
  const [dateFrom, setDateFrom] = useState<Date>()
  const [dateTo, setDateTo] = useState<Date>()
  const [dueDateFrom, setDueDateFrom] = useState<Date>()
  const [dueDateTo, setDueDateTo] = useState<Date>()
  const [allTags, setAllTags] = useState<any[]>([])
  const supabase = createClient()
  const taskStatuses = useTaskStatuses({ includeArchived: true })

  useEffect(() => {
    loadTags()
  }, [])

  useEffect(() => {
    applyFilters()
  }, [filterUser, filterTags, filterPriority, filterStatus, filterBoard, dateFrom, dateTo, dueDateFrom, dueDateTo, tasks])

  const loadTags = async () => {
    const { data } = await supabase.from('tags').select('*').order('name')
    if (data) setAllTags(data)
  }

  const applyFilters = () => {
    let filtered = [...tasks]

    if (filterUser.length > 0) {
      filtered = filtered.filter(task => {
        const ids = getAssigneeIds(task)
        const matchesUnassigned = filterUser.includes(UNASSIGNED_FILTER_VALUE) && ids.length === 0
        return matchesUnassigned || ids.some(id => filterUser.includes(id))
      })
    }

    if (filterTags.length > 0) {
      filtered = filtered.filter(task => 
        task.task_tags?.some((tt: any) => filterTags.includes(tt.tag.id))
      )
    }

    if (filterPriority.length > 0) {
      filtered = filtered.filter(task => filterPriority.includes(task.priority?.toString()))
    }

    if (filterStatus.length > 0) {
      filtered = filtered.filter(task => filterStatus.includes(task.status))
    }

    if (filterBoard.length > 0) {
      filtered = filtered.filter(task => filterBoard.includes(task.board_id))
    }

    if (dateFrom) {
      filtered = filtered.filter(task => new Date(task.created_at) >= dateFrom)
    }

    if (dateTo) {
      filtered = filtered.filter(task => new Date(task.created_at) <= dateTo)
    }

    if (dueDateFrom) {
      filtered = filtered.filter(task => task.due_date && new Date(task.due_date) >= dueDateFrom)
    }

    if (dueDateTo) {
      filtered = filtered.filter(task => task.due_date && new Date(task.due_date) <= dueDateTo)
    }

    setFilteredTasks(filtered)
  }

  const toggleFilter = (filterArray: string[], setFilter: (arr: string[]) => void, value: string) => {
    if (filterArray.includes(value)) {
      setFilter(filterArray.filter(v => v !== value))
    } else {
      setFilter([...filterArray, value])
    }
  }

  const clearAllFilters = () => {
    setFilterUser([])
    setFilterTags([])
    setFilterPriority([])
    setFilterStatus([])
    setFilterBoard([])
    setDateFrom(undefined)
    setDateTo(undefined)
    setDueDateFrom(undefined)
    setDueDateTo(undefined)
  }

  const exportToCSV = () => {
    const headers = ['Title', 'Description', 'Priority', 'Status', 'Assigned To', 'Board', 'Created Date', 'Due Date', 'Tags']
    const rows = filteredTasks.map(task => {
      const assigneeNames = getAssigneeNames(task, users)
      const board = boards.find(b => b.id === task.board_id)
      const tags = task.task_tags?.map((tt: any) => tt.tag.name).join('; ') || ''

      return [
        task.title,
        cleanTaskDescription(task.description),
        task.priority,
        task.status,
        assigneeNames.length ? assigneeNames.join('; ') : 'Unassigned',
        board?.title || 'Unknown',
        new Date(task.created_at).toLocaleDateString(),
        task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No due date',
        tags
      ].map(cell => `"${cell}"`)
    })

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `task-report-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
  }

  // Open a clean, printable table in a new window — no file download required.
  const printReport = () => {
    const escapeHtml = (value: string) =>
      value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

    const bodyRows = filteredTasks
      .map(task => {
        const assigneeNames = getAssigneeNames(task, users)
        const board = boards.find(b => b.id === task.board_id)
        const tags = task.task_tags?.map((tt: any) => tt.tag.name).join(', ') || ''
        const cells = [
          task.title,
          assigneeNames.length ? assigneeNames.join(', ') : 'Unassigned',
          String(task.priority ?? ''),
          getTaskStatusLabel(task),
          board?.title || 'Unknown',
          task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date',
          tags,
        ]
        return `<tr>${cells.map(c => `<td>${escapeHtml(String(c))}</td>`).join('')}</tr>`
      })
      .join('')

    const win = window.open('', '_blank')
    if (!win) return
    win.document.write(`<!doctype html><html><head><title>Task Report</title>
      <style>
        body { font-family: -apple-system, system-ui, sans-serif; padding: 24px; color: #111; }
        h1 { font-size: 18px; margin: 0 0 4px; }
        p { color: #666; margin: 0 0 16px; font-size: 12px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #ddd; padding: 6px 8px; text-align: left; vertical-align: top; }
        th { background: #f5f5f5; }
        @media print { body { padding: 0; } button { display: none; } }
      </style></head><body>
      <h1>Task Report</h1>
      <p>${filteredTasks.length} tasks &middot; generated ${new Date().toLocaleString()}</p>
      <table><thead><tr>
        <th>Title</th><th>Assigned</th><th>Priority</th><th>Status</th><th>Board</th><th>Due Date</th><th>Tags</th>
      </tr></thead><tbody>${bodyRows}</tbody></table>
      <script>window.onload = () => window.print()</script>
      </body></html>`)
    win.document.close()
  }

  const activeFiltersCount = filterUser.length + filterTags.length + filterPriority.length + 
    filterStatus.length + filterBoard.length + 
    (dateFrom ? 1 : 0) + (dateTo ? 1 : 0) + (dueDateFrom ? 1 : 0) + (dueDateTo ? 1 : 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Reports & Analytics</h2>
          <p className="text-muted-foreground">Filter and analyze task data with advanced multi-filter options</p>
        </div>
        <div className="flex gap-2">
          {activeFiltersCount > 0 && (
            <Button variant="outline" onClick={clearAllFilters} className="gap-2 bg-transparent">
              <X className="w-4 h-4" />
              Clear Filters ({activeFiltersCount})
            </Button>
          )}
          <Button variant="outline" onClick={printReport} className="gap-2 bg-transparent">
            <Printer className="w-4 h-4" />
            Print
          </Button>
          <Button onClick={exportToCSV} className="gap-2">
            <Download className="w-4 h-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Filter Panel */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Filter className="w-5 h-5" />
            Advanced Filters
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* User Filter */}
          <div>
            <label className="text-sm font-medium mb-2 flex items-center gap-2">
              <Users className="w-4 h-4" />
              Filter by User (Ctrl+Click for multiple)
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {users.map(user => (
                <Badge
                  key={user.id}
                  variant={filterUser.includes(user.id) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  onClick={() => toggleFilter(filterUser, setFilterUser, user.id)}
                >
                  {user.full_name || user.email}
                  {filterUser.includes(user.id) && <X className="w-3 h-3 ml-1" />}
                </Badge>
              ))}
              <Badge
                variant={filterUser.includes(UNASSIGNED_FILTER_VALUE) ? 'default' : 'outline'}
                className="cursor-pointer border-dashed"
                onClick={() => toggleFilter(filterUser, setFilterUser, UNASSIGNED_FILTER_VALUE)}
              >
                Unassigned
                {filterUser.includes(UNASSIGNED_FILTER_VALUE) && <X className="w-3 h-3 ml-1" />}
              </Badge>
            </div>
          </div>

          {/* Tag Filter */}
          <div>
            <label className="text-sm font-medium mb-2 flex items-center gap-2">
              <Tag className="w-4 h-4" />
              Filter by Tag
            </label>
            <div className="flex flex-wrap gap-2 mt-2">
              {allTags.map(tag => (
                <Badge
                  key={tag.id}
                  variant={filterTags.includes(tag.id) ? 'default' : 'outline'}
                  className="cursor-pointer"
                  style={filterTags.includes(tag.id) ? { backgroundColor: tag.color } : {}}
                  onClick={() => toggleFilter(filterTags, setFilterTags, tag.id)}
                >
                  {tag.name}
                  {filterTags.includes(tag.id) && <X className="w-3 h-3 ml-1" />}
                </Badge>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Priority Filter */}
            <div>
              <label className="text-sm font-medium mb-2 block">Priority</label>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map(priority => (
                  <Badge
                    key={priority}
                    variant={filterPriority.includes(priority.toString()) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleFilter(filterPriority, setFilterPriority, priority.toString())}
                  >
                    {priority}
                    {filterPriority.includes(priority.toString()) && <X className="w-3 h-3 ml-1" />}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Status Filter — includes archived statuses so older tasks stay searchable */}
            <div>
              <label className="text-sm font-medium mb-2 block">Status</label>
              <div className="flex flex-wrap gap-2">
                {taskStatuses.map(status => (
                  <Badge
                    key={status.key}
                    variant={filterStatus.includes(status.key) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleFilter(filterStatus, setFilterStatus, status.key)}
                  >
                    {status.label}{status.is_archived ? ' (archived)' : ''}
                    {filterStatus.includes(status.key) && <X className="w-3 h-3 ml-1" />}
                  </Badge>
                ))}
              </div>
            </div>

            {/* Board Filter */}
            <div>
              <label className="text-sm font-medium mb-2 block">Board</label>
              <div className="flex flex-wrap gap-2">
                {boards.map(board => (
                  <Badge
                    key={board.id}
                    variant={filterBoard.includes(board.id) ? 'default' : 'outline'}
                    className="cursor-pointer"
                    onClick={() => toggleFilter(filterBoard, setFilterBoard, board.id)}
                  >
                    {board.title}
                    {filterBoard.includes(board.id) && <X className="w-3 h-3 ml-1" />}
                  </Badge>
                ))}
              </div>
            </div>
          </div>

          {/* Date Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <label className="text-sm font-medium">Entry Date Range</label>
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="flex-1 justify-start bg-transparent">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateFrom ? format(dateFrom, 'PP') : 'From'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="flex-1 justify-start bg-transparent">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dateTo ? format(dateTo, 'PP') : 'To'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <Calendar mode="single" selected={dateTo} onSelect={setDateTo} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-sm font-medium">Due Date Range</label>
              <div className="flex gap-2">
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="flex-1 justify-start bg-transparent">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDateFrom ? format(dueDateFrom, 'PP') : 'From'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <Calendar mode="single" selected={dueDateFrom} onSelect={setDueDateFrom} />
                  </PopoverContent>
                </Popover>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="flex-1 justify-start bg-transparent">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {dueDateTo ? format(dueDateTo, 'PP') : 'To'}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent>
                    <Calendar mode="single" selected={dueDateTo} onSelect={setDueDateTo} />
                  </PopoverContent>
                </Popover>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      <Card>
        <CardHeader>
          <CardTitle>Results ({filteredTasks.length} tasks)</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium">Title</th>
                  <th className="text-left py-3 px-4 font-medium">Assigned</th>
                  <th className="text-left py-3 px-4 font-medium">Priority</th>
                  <th className="text-left py-3 px-4 font-medium">Status</th>
                  <th className="text-left py-3 px-4 font-medium">Due Date</th>
                  <th className="text-left py-3 px-4 font-medium">Tags</th>
                </tr>
              </thead>
              <tbody>
                {filteredTasks.map(task => {
                  const assigneeNames = getAssigneeNames(task, users)
                  return (
                    <tr key={task.id} className="border-b hover:bg-accent/50">
                      <td className="py-3 px-4 font-medium">
                        {task.board_id ? (
                          <Link
                            href={`/admin/board/${task.board_id}`}
                            className="inline-flex items-center gap-1.5 text-left hover:text-primary hover:underline"
                          >
                            <span className="break-words [overflow-wrap:anywhere]">{task.title}</span>
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-60" />
                          </Link>
                        ) : (
                          task.title
                        )}
                      </td>
                      <td className="py-3 px-4 text-sm">{assigneeNames.length ? assigneeNames.join(', ') : 'Unassigned'}</td>
                      <td className="py-3 px-4">
                        <Badge variant={task.priority >= 4 ? 'destructive' : task.priority === 3 ? 'default' : 'secondary'}>
                          {task.priority}
                        </Badge>
                      </td>
                      <td className="py-3 px-4">
                        <Badge>{getTaskStatusLabel(task)}</Badge>
                      </td>
                      <td className="py-3 px-4 text-sm">
                        {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date'}
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex gap-1 flex-wrap">
                          {task.task_tags?.map((tt: any) => (
                            <Badge key={tt.tag.id} variant="outline" style={{ borderColor: tt.tag.color }}>
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
    </div>
  )
}
