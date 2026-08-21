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
import { Tooltip, TooltipTrigger, TooltipContent } from "@/components/ui/tooltip"
import { useState, useEffect, useCallback, useMemo } from 'react'
import { DragDropContext, Droppable, Draggable, DropResult } from '@hello-pangea/dnd'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ArrowLeft, Plus, MoreVertical, Edit, Trash, Palette, Filter, X, LayoutGrid, List, Calendar, ArrowUpDown, ArrowUp, ArrowDown, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Download, MessageSquare, Lock, Kanban, SlidersHorizontal, Archive, ArchiveRestore, GripVertical, Pencil, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'
import TaskCard from './task-card'
import CreateTaskDialog from './create-task-dialog'
import { TaskDetailModal } from './task-detail-modal'
import { ShareLinkDialog } from './share-link-dialog'
import ChatPanel from '@/components/chat/chat-panel'
import MobileBottomNav, { type NavItem } from '@/components/dashboard/mobile-bottom-nav'
import { getAssigneeIds, getAssignees, getAssigneeNames } from '@/lib/assignees'
import { allows, can, type Actor, type PlatformRole } from '@/lib/capabilities'
import { classifyWrite, writeFailureMessage } from '@/lib/rls-write'
import { ActionGuard } from '@/components/shell/action-guard'
import { CommandPalette } from '@/components/shell/command-palette'
import {
  buildBoardContextCommands,
  buildWorkItemContextCommands,
  type Command,
} from '@/components/shell/commands'
import { moveTaskToColumn, setTaskPriority } from '@/lib/task-mutations'
import { useRememberRecord } from '@/components/shell/use-recent-records'
import { FavoriteStar } from '@/components/shell/favorite-star'
import { useFavorites } from '@/lib/use-favorites'
import { DensityToggle } from '@/components/shell/density-toggle'
import { useDensity } from '@/components/shell/use-density'
import { ThemeControls } from '@/components/theme/theme-controls'
import { cleanBoardDescription, cleanTaskDescription } from '@/lib/display-text'
import { getNormalizedTaskStatus, getTaskStatusLabel, statusesMissingFromBoard } from '@/lib/task-status'
import { moveListItem } from '@/lib/reorder'
import { useTaskStatusList } from '@/lib/use-task-statuses'
import { useAppModules } from '@/lib/modules'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import type { ShellData } from '@/lib/shell-data'
import { boardHref as buildBoardHref, buildWorkspaceNav, dashboardHost } from '@/components/shell/workspace-nav'
import { navIcon } from '@/components/shell/nav-icons'
import { Label } from '@/components/ui/label'
import { toast } from 'sonner'

interface BoardViewProps {
  board: any
  columns: any[]
  users: any[]
  /**
   * Board-surface admin override. `/dashboard/board/[id]` passes false even for a real
   * admin, deliberately, so that route keeps non-admin edit rules. It is NOT the viewer's
   * platform role - see `platformRole`.
   */
  isAdmin: boolean
  isSuperAdmin?: boolean
  /**
   * The viewer's actual `profiles.role`, independent of the `isAdmin` override above.
   * Capabilities that mirror `private.is_admin_user()` rather than this surface's edit
   * rules (large uploads, audit, module config) must read this one. It used to be
   * hardcoded to 'user' here with a comment arguing nothing on this surface read it -
   * true at the time, and a trap for the next capability added.
   */
  platformRole?: PlatformRole
  currentUserId: string
  /** The caller's board_members row for this board, if any (null = no row = full default access). */
  boardRole?: 'member' | 'guest' | 'client' | null
  /**
   * Every board this viewer may open, for the header's board switcher. Already
   * RLS-filtered by the server route, so a private board a non-member cannot see is
   * simply absent - the switcher never has to decide what to hide.
   */
  boards?: Array<{ id: string; title: string; is_private?: boolean }>
  /**
   * Enabled modules + marketing calendars, fetched on the server. A board renders outside
   * AppShell, so without this its header nav has nothing to gate on. Optional: both hooks
   * fall back to fetching on mount, which is what every screen used to do.
   */
  shell?: ShellData
}

const BOARD_COLUMNS_SELECT = '*, tasks!tasks_column_id_fkey(*, assigned_to:profiles!tasks_assigned_to_fkey(id, full_name, email), task_assignees(user_id), task_tags(tag:tags(*)))'

// Distinguishes a column drag from a card drag inside one DragDropContext. Cards keep the
// library's default type, so the two can never accept each other's payload.
const COLUMN_DRAG_TYPE = 'BOARD_COLUMN'

// Which destinations the phone's bottom bar keeps on the bar itself, after Home. See the
// memo that consumes it for why these three and not simply the first few in nav order.
const BOARD_BAR_PRIORITY = ['boards', 'chat', 'my-work']

export default function BoardView({ board, columns: initialColumns, users, isAdmin, isSuperAdmin = false, platformRole = 'user', currentUserId, boardRole = null, boards = [], shell }: BoardViewProps) {
  const router = useRouter()
  const searchParams = useSearchParams()
  // Feeds the shell's Recent section and the ⌘K palette's Recent group. Written here
  // rather than on the server route because it is a per-browser convenience, not data.
  // ⚠️ buildBoardHref(platformRole, …), never `isAdmin ? … : …`. On /dashboard/board/<id>
  // `isAdmin` is false even for a super admin, so building the href from it stored a
  // /dashboard link in Recents - and re-opening from Recents dropped them back into the
  // stripped surface every time, with nothing on screen saying why.
  useRememberRecord(currentUserId, {
    key: `board:${board.id}`,
    kind: 'board',
    label: board.title,
    href: buildBoardHref(platformRole, board.id),
  })
  const [columns, setColumns] = useState(initialColumns)
  // The refetch matters here and nowhere else: renaming a board column renames the status
  // behind it, and every status picker on this page is labelled from this list.
  const { statuses: taskStatuses, refetch: refetchStatuses } = useTaskStatusList()
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [selectedColumn, setSelectedColumn] = useState<any>(null)
  const [newColumnDialogOpen, setNewColumnDialogOpen] = useState(false)
  const [newColumnTitle, setNewColumnTitle] = useState('')
  const [newColumnStatusKey, setNewColumnStatusKey] = useState<string>('__none__')
  const [statusPickerColumn, setStatusPickerColumn] = useState<string | null>(null)
  const [editingBoardTitle, setEditingBoardTitle] = useState(false)
  const [boardTitle, setBoardTitle] = useState(board.title)
  const [boardDescription, setBoardDescription] = useState(cleanBoardDescription(board.description))
  const [colorPickerColumn, setColorPickerColumn] = useState<string | null>(null)
  const [renameColumnId, setRenameColumnId] = useState<string | null>(null)
  const [renameColumnValue, setRenameColumnValue] = useState('')
  const [renameColumnBusy, setRenameColumnBusy] = useState(false)
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
  const [taskDetailTab, setTaskDetailTab] = useState<'comments' | 'activity'>('comments')
  const [chatDialogOpen, setChatDialogOpen] = useState(false)
  const [commandOpen, setCommandOpen] = useState(false)
  const supabase = useMemo(() => createClient(), [])
  const [searchTerm, setSearchTerm] = useState('')
  const [viewMode, setViewMode] = useState<'tile' | 'list'>('tile')
  const { density, setDensity } = useDensity(currentUserId)

  // Favourites (migration 097). This page renders outside AppShell, so it gets no sidebar
  // Favourites block - but it is the natural place to *add* one, so the star lives by the
  // board title here.
  // Same rule as Recents above: a favourite stores the href it was created from, so an
  // href built from the surface flag pins an admin into the stripped board surface for as
  // long as the star exists.
  const favoriteBoardHref = useCallback(
    (boardId: string) => buildBoardHref(platformRole, boardId),
    [platformRole],
  )
  const {
    starred: isBoardStarred,
    isPending: isStarPending,
    toggle: toggleFavorite,
  } = useFavorites(currentUserId, { boardHref: favoriteBoardHref })

  // Deep link support: global search links here with ?task=<id> so it can open
  // the specific task, not just land on the board.
  useEffect(() => {
    const taskParam = searchParams.get('task')
    if (taskParam) {
      setSelectedTaskId(taskParam)
      setTaskDetailOpen(true)
      router.replace(buildBoardHref(platformRole, board.id))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams])

  /**
   * Boards other than this one. The switcher is only worth a control when there is
   * somewhere to switch *to*: on a workspace with one board, a dropdown whose only entry is
   * the board you are already looking at is a chevron that does nothing.
   *
   * `boards` is already RLS-filtered by the server route, so nothing is decided here about
   * what this viewer may see - which matters, because an empty list from a filtered read is
   * indistinguishable from a workspace with no boards, and this code must not treat it as
   * a claim about either.
   */
  const otherBoards = useMemo(
    () => boards.filter((entry) => entry.id !== board.id),
    [board.id, boards],
  )

  const isPlatformAdmin = platformRole === 'admin' || platformRole === 'super_admin'
  const modules = useAppModules(shell?.modules)
  const { calendars: marketingCalendars } = useMarketingCalendars(shell?.calendars)

  /**
   * The header and bottom-bar navigation, from the same builder as the sidebar and the ⌘K
   * palette.
   *
   * This used to be two hand-written arrays keyed off `isAdmin`, and it was wrong in three
   * ways at once - the third being the one that actually bit people:
   *
   *   1. It ignored `app_modules` entirely, so CRM, Appointments and Project IDs were
   *      unreachable from a board however they were configured, and Marketing was offered
   *      to every admin whether or not the module was on. That is the drift CLAUDE.md
   *      records for /admin's hand-written copy, one file over.
   *   2. It listed no My Work, which is not a module and cannot be switched off.
   *   3. `handleNavChange` wrote sessionStorage and pushed a bare `/admin` | `/dashboard`,
   *      picked from `isAdmin` - which is FALSE on /dashboard/board/<id> even for a real
   *      admin. So an admin clicking "Boards" from a board wrote `user-active-tab`, landed
   *      on /dashboard, was redirected to /admin with the query string dropped, and arrived
   *      on whatever tab they last had open. Navigating now means following the item's own
   *      href, which buildWorkspaceNav has already pointed at the right host.
   */
  const navGroups = useMemo(
    () =>
      buildWorkspaceNav({
        role: platformRole,
        modules,
        // Migration 085's rule: admin, or a member of at least one calendar.
        canUseMarketingCalendar: isPlatformAdmin || marketingCalendars.length > 0,
        canViewAudit: allows({ userId: currentUserId, platformRole }, 'audit.view'),
      }),
    [currentUserId, isPlatformAdmin, marketingCalendars.length, modules, platformRole],
  )

  const navDestinations = useMemo(() => navGroups.flatMap((group) => group.items), [navGroups])

  /**
   * The phone's bottom bar: five across before the labels start truncating, the rest behind
   * "More".
   *
   * The five are not simply the first five in nav order. Nav order is the sidebar's, where
   * Home/My Work/Personal/Calendar/Marketing come first - which on a board would push Boards
   * and Chat into the More drawer, on the one screen that IS a board. These four ids are
   * exactly what the old hardcoded bar surfaced here, so keeping them promoted means
   * sourcing the list from buildWorkspaceNav (and finally honouring app_modules) costs
   * nothing on mobile. Anything promoted but switched off simply is not in the list to find.
   */
  const [navItems, navMoreItems]: [NavItem[], NavItem[]] = useMemo(() => {
    const toNavItem = (item: { id: string; label: string; icon: string }): NavItem => ({
      value: item.id,
      label: item.label,
      icon: navIcon(item.icon),
    })

    // Home (whatever this role calls its landing tab) always leads, then the promoted ids in
    // the order above, then everything else in the nav's own order.
    const [home, ...rest] = navDestinations
    const promoted = BOARD_BAR_PRIORITY
      .map((id) => rest.find((item) => item.id === id))
      .filter((item): item is NonNullable<typeof item> => Boolean(item))
    const promotedIds = new Set(promoted.map((item) => item.id))
    const ordered = [
      ...(home ? [home] : []),
      ...promoted,
      ...rest.filter((item) => !promotedIds.has(item.id)),
    ]

    return [ordered.slice(0, 5).map(toNavItem), ordered.slice(5).map(toNavItem)]
  }, [navDestinations])

  const handleNavChange = useCallback(
    (value: string) => {
      const destination = navDestinations.find((item) => item.id === value)
      if (destination) router.push(destination.href)
    },
    [navDestinations, router],
  )

  // Delegates to lib/capabilities.ts so the board, the task tile and the detail modal
  // share one definition of "may I change this task" (they used to hold three copies).
  // Both roles travel: `isAdmin` is this surface's edit override (false on /dashboard even
  // for a real admin), `platformRole` is who the viewer actually is. Capabilities that
  // mirror private.is_admin_user() read the second one past the first.
  const actor: Actor = useMemo(
    () => ({ userId: currentUserId, platformRole, boardRole, isAdmin }),
    [currentUserId, platformRole, boardRole, isAdmin],
  )
  /**
   * The single way a task detail is opened, from any of the three views.
   *
   * The kanban card used to render its own TaskDetailModal - a second copy of the one
   * below - which meant the board had no idea which task was open, and the palette's
   * work-item context actions had nothing to act on. One opener, one modal, one answer.
   */
  const openTaskDetail = useCallback((taskId: string, tab: 'comments' | 'activity' = 'comments') => {
    setSelectedTaskId(taskId)
    setTaskDetailTab(tab)
    setTaskDetailOpen(true)
  }, [])

  const createDecision = can(actor, 'task.create')
  const manageBoardDecision = can(actor, 'project.manage', undefined, board)
  const shareBoardDecision = can(actor, 'share.external', undefined, board)
  const canManageTask = useCallback((task: any) => {
    return allows(actor, 'task.edit', {
      created_by: task?.created_by,
      assigned_to: task?.assigned_to,
      assigneeIds: getAssigneeIds(task),
    })
  }, [actor])

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

    // Two kinds of drag share this handler: a card between columns (the default type) and a
    // whole column along the board. They are told apart by the Droppable's `type`, not by
    // guessing from the ids - a column id is a valid droppableId for both.
    if (result.type === COLUMN_DRAG_TYPE) {
      await moveColumn(source.index, destination.index)
      return
    }

    const sourceColumn = columns.find(col => col.id === source.droppableId)
    const destColumn = columns.find(col => col.id === destination.droppableId)

    if (!sourceColumn || !destColumn) return

    const task = sourceColumn.tasks.find((t: any) => t.id === draggableId)
    if (!task) return
    if (!canManageTask(task)) {
      toast.error('Only admins, creators, and assignees can move this task.')
      return
    }

    // Update task column and position. Prefer the column's explicit status_key (Phase 1B FK) so
    // the stored status is deterministic even for unconventional titles like "WIP". Fall back to
    // the managed status whose label matches the destination column's title (e.g. "Completed" ->
    // key "done"), then to slugifying the title for custom columns with no managed status.
    const matchingStatus = taskStatuses.find(
      s => s.label.trim().toLowerCase() === destColumn.title.trim().toLowerCase()
    )
    const newStatus = destColumn.status_key ?? matchingStatus?.key ?? destColumn.title.toLowerCase().replace(/ /g, '_')

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

    // Asking for the row back is what makes the optimistic move honest. A refused UPDATE
    // returns zero rows and no error, so checking `error` alone left the card sitting in
    // its new column, apparently moved, until the next refresh. Column and position are
    // not inputs to can_view_task, so zero rows here can only mean refused.
    const outcome = await classifyWrite(
      await supabase
        .from('tasks')
        .update({
          column_id: destColumn.id,
          status: newStatus,
          position: destination.index,
        })
        .eq('id', draggableId)
        .select('id'),
    )
    const failure = writeFailureMessage(outcome, 'move')
    if (failure) {
      setColumns(prevColumns)
      toast.error(failure.title, { description: failure.description })
    }
  }

  const handleOpenCreateDialog = (column: any) => {
    if (column.status_key === 'cancelled') {
      toast.info('Cancelled is an archive destination', {
        description: 'Create the task in an active status, then move it to Cancelled when needed.',
      })
      return
    }
    setSelectedColumn(column)
    setCreateDialogOpen(true)
  }

  /**
   * Picking a status in the "Add column" dialog names the column after it, so a new column
   * agrees with the status list from the moment it exists. The title stays editable: it is
   * only overwritten while it is empty or still reads as the previously picked status, so a
   * name typed by hand is never silently replaced.
   */
  const handlePickNewColumnStatus = (statusKey: string) => {
    const previous = taskStatuses.find((s: any) => s.key === newColumnStatusKey)
    const next = taskStatuses.find((s: any) => s.key === statusKey)
    const titleIsDerived = !newColumnTitle.trim() || newColumnTitle.trim() === previous?.label

    setNewColumnStatusKey(statusKey)
    if (next?.label && titleIsDerived) setNewColumnTitle(next.label)
  }

  const handleAddColumn = async () => {
    if (!newColumnTitle.trim()) return

    const { data, error } = await supabase
      .from('columns')
      .insert({
        title: newColumnTitle.trim(),
        board_id: board.id,
        position: nextColumnPosition(),
        status_key: newColumnStatusKey === '__none__' ? null : newColumnStatusKey,
      })
      .select()

    // This used to be `if (data && !error)` with no else - an RLS refusal (columns are
    // admin-only) closed nothing, said nothing, and left the typed title sitting in a dialog
    // that looked like it had not been submitted yet.
    if (error || !data || data.length === 0) {
      toast.error('Could not add the column', {
        description: error?.code === '23505'
          ? 'This board already has a column for that status.'
          : error?.message ?? 'Only admins can change a board\u2019s columns.',
      })
      return
    }

    setColumns([...columns, { ...data[0], tasks: [] }])
    setNewColumnTitle('')
    setNewColumnStatusKey('__none__')
    setNewColumnDialogOpen(false)
  }

  /**
   * Persist a new left-to-right column order for this board. The order is a property of the
   * board, not of the viewer, so it moves for everyone the moment it is saved.
   *
   * Goes through reorder_board_columns (migration 106) rather than N separate UPDATEs: sent
   * separately they are N transactions, so a failure halfway leaves an order nobody chose,
   * and under RLS a refusal is a zero-row response rather than an error - indistinguishable
   * from "nothing needed changing". The RPC renumbers every column in one statement and
   * raises when it is refused.
   */
  const moveColumn = useCallback(async (fromIndex: number, toIndex: number) => {
    const next = moveListItem(columns, fromIndex, toIndex)
    if (next === columns) return

    const previous = columns
    setColumns(next)

    const { error } = await supabase.rpc('reorder_board_columns', {
      p_board_id: board.id,
      p_column_ids: next.map((col: any) => col.id),
    })

    if (error) {
      // The likeliest refusal is a stale list - someone else added or removed a column
      // since this page loaded - so put the board back and re-read it rather than leaving
      // the optimistic order on screen pretending to be saved.
      setColumns(previous)
      toast.error('Could not rearrange the columns', { description: error.message })
      refreshColumns()
    }
  }, [board.id, columns, refreshColumns, supabase])

  /**
   * Where a newly added column goes: past the highest position in use, not `columns.length`.
   * Positions are not guaranteed contiguous - deleting a column leaves a gap, and production's
   * EmpowerMe board runs 0,1,2,4,5 - so counting the columns can land a new one on top of an
   * existing position and leave the order between the two decided by nothing. The marketing
   * calendar already learned this for its channel columns; boards had not.
   */
  const nextColumnPosition = useCallback(
    () => columns.reduce((max: number, col: any) => Math.max(max, col.position ?? -1), -1) + 1,
    [columns],
  )

  /**
   * Active statuses this board has no column for. Picking one of these used to be possible in
   * every status dropdown and then refused on save, with "ask an admin to link a column" shown
   * to whoever hit it - usually the admin. The pickers no longer offer them; this is the other
   * half, so the gap is visible to the person who can close it instead of being invisible
   * until someone trips over it.
   */
  const missingStatuses = useMemo(
    () => statusesMissingFromBoard(taskStatuses, columns),
    [taskStatuses, columns],
  )

  const handleAddStatusColumn = async (statusKey: string, label: string) => {
    const { data, error } = await supabase
      .from('columns')
      .insert({
        title: label,
        board_id: board.id,
        position: nextColumnPosition(),
        status_key: statusKey,
      })
      .select()

    // Zero rows with no error is an RLS refusal, not a no-op (CLAUDE.md).
    if (error || !data || data.length === 0) {
      toast.error(`Could not add the ${label} column`, {
        description: error?.message ?? 'Only admins can change a board\u2019s columns.',
      })
      return
    }

    setColumns([...columns, { ...data[0], tasks: [] }])
    toast.success(`Added the ${label} column`, {
      description: `Tasks on this board can now be set to ${label}.`,
    })
  }

  const handleDeleteColumn = async (columnId: string) => {
    // `column.tasks` is RLS-filtered, and can_view_task hides ARCHIVED tasks from everyone
    // except a super_admin - while deleting a column only needs is_admin_user(). So a plain
    // admin looking at a column of archived work sees an empty column, and asking the client
    // whether it is empty gets back "yes" from a list that was never complete. They would
    // then confirm "Remove this empty column?" and be refused by 074's trigger with a
    // sentence contradicting what is on screen. Ask the database instead (migration 108).
    const { data: countRows, error: countError } = await supabase
      .rpc('board_column_task_count', { p_column_id: columnId })

    if (countError) {
      toast.error('Could not check whether this column is empty', { description: countError.message })
      return
    }

    // The function RETURNS TABLE, so PostgREST hands back an array of one row.
    const counts = Array.isArray(countRows) ? countRows[0] : countRows
    if (counts && counts.total > 0) {
      // Name what is actually in the way. "Archived" is the part the admin cannot see for
      // themselves, so leaving it out is what made the old refusal unreadable.
      const parts = [
        counts.active ? `${counts.active} active` : null,
        counts.archived ? `${counts.archived} archived` : null,
        counts.deleted ? `${counts.deleted} deleted` : null,
      ].filter(Boolean)
      toast.error('This column still contains tasks', {
        description: `${parts.join(', ')}. Move them to another column first; deleting the column would take them with it.`,
      })
      return
    }

    if (!confirm('Remove this empty column?')) return

    const { error } = await supabase.from('columns').delete().eq('id', columnId)
    if (error) {
      toast.error('Could not remove column', { description: error.message })
      return
    }
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

  const renameTarget = useMemo(
    () => columns.find((col: any) => col.id === renameColumnId) ?? null,
    [columns, renameColumnId],
  )
  const renameTargetStatus = useMemo(
    () => (renameTarget?.status_key ? taskStatuses.find((s: any) => s.key === renameTarget.status_key) ?? null : null),
    [renameTarget, taskStatuses],
  )

  const openRenameColumn = (column: any) => {
    setRenameColumnId(column.id)
    setRenameColumnValue(column.title ?? '')
  }

  /**
   * Rename a column, at the scope the column's own wiring dictates.
   *
   * A column linked to a status is NAMED BY that status - migration 107 renames every linked
   * column on every board whenever the status is renamed, deliberately, so that two boards
   * can never disagree about what the same thing is called. Writing `columns.title` on one
   * board would therefore produce a name that looks saved and is silently reverted by the
   * next status rename, which is worse than refusing.
   *
   * So there are two real cases, and the dialog says which one is in front of you:
   *
   *   - Linked column  -> rename the STATUS, then let 107's cascade rename every column that
   *     represents it. Same two calls status-management.tsx makes, in the same order, for
   *     exactly the same reason - this is that screen's action surfaced where you actually
   *     notice the wrong name. `task_statuses` is super-admin-only (migration 069), so a
   *     plain admin is told that rather than being handed a write that cannot land.
   *   - Custom column (no status_key) -> rename this board's column and nothing else. The
   *     status list has no claim on it; that is what "custom" means here.
   */
  const handleRenameColumn = async () => {
    const column = renameTarget
    const title = renameColumnValue.trim()
    if (!column || !title || title === column.title) {
      setRenameColumnId(null)
      return
    }

    setRenameColumnBusy(true)
    try {
      if (!column.status_key) {
        const { data, error } = await supabase
          .from('columns')
          .update({ title })
          .eq('id', column.id)
          .select('id, title')

        // Zero rows with no error is an RLS refusal, not a no-op (CLAUDE.md). `title` is not
        // an input to any visibility rule, so no re-read probe is needed here - unlike the
        // writes lib/rls-write.ts exists for.
        if (error || !data || data.length === 0) {
          toast.error('Could not rename the column', {
            description: error?.message ?? 'Only admins can change a board\u2019s columns.',
          })
          return
        }

        setColumns(columns.map((col: any) => (col.id === column.id ? { ...col, title: data[0].title } : col)))
        toast.success(`Renamed to \u201C${data[0].title}\u201D`)
        setRenameColumnId(null)
        return
      }

      const status = renameTargetStatus
      if (!status?.id) {
        toast.error('Could not rename the column', {
          description: 'The status this column tracks could not be read. Reload and try again.',
        })
        return
      }

      const { data: updated, error: statusError } = await supabase
        .from('task_statuses')
        .update({ label: title })
        .eq('id', status.id)
        .select('id, label')

      if (statusError || !updated || updated.length === 0) {
        toast.error('Could not rename the status', {
          description: statusError?.code === '23505'
            ? 'A status with that name already exists.'
            : statusError?.message ?? 'Only super admins can rename a status.',
        })
        return
      }

      // The cascade. It is an RPC rather than an UPDATE because RLS applies SELECT policies
      // to an UPDATE, so a direct sweep silently skips every private board the caller is not
      // a member of - see migration 107's header for the measurement.
      const { data: renamedCount, error: cascadeError } = await supabase
        .rpc('rename_columns_for_status', { p_status_key: column.status_key, p_title: title })

      if (cascadeError) {
        // The status really did change, so saying "could not rename" would be false. Report
        // the half that failed and re-read, rather than leaving the board claiming a name the
        // columns do not have.
        toast.warning('Status renamed, but the board columns were not', { description: cascadeError.message })
        await Promise.all([refreshColumns(), refetchStatuses()])
        return
      }

      // Every linked column on THIS board moves with it; the RPC has already done the same
      // on every other board. Reading the count back is what stops this claiming a success
      // that did not happen.
      setColumns(columns.map((col: any) => (col.status_key === column.status_key ? { ...col, title } : col)))
      await refetchStatuses()
      setRenameColumnId(null)
      toast.success(`Renamed to \u201C${title}\u201D`, {
        description: typeof renamedCount === 'number' && renamedCount > 0
          ? `${renamedCount} board ${renamedCount === 1 ? 'column' : 'columns'} renamed across every board.`
          : undefined,
      })
    } finally {
      setRenameColumnBusy(false)
    }
  }

  const handleUpdateColumnStatus = async (columnId: string, statusKey: string) => {
    const resolvedKey = statusKey === '__none__' ? null : statusKey
    const status = resolvedKey ? taskStatuses.find((s: any) => s.key === resolvedKey) : null

    // Linking also renames the column to the status label. A column that says "WIP" while
    // claiming to be "In Progress" is the disagreement this link exists to remove, and from
    // here on Super Admin -> Statuses owns that name: renaming the status renames this column
    // on every board (migration 107). Unlinking leaves the title alone - an unlinked column
    // is a custom one, named by the board.
    const patch: Record<string, unknown> = { status_key: resolvedKey }
    if (status?.label) patch.title = status.label

    const { data, error } = await supabase
      .from('columns')
      .update(patch)
      .eq('id', columnId)
      .select('id, title, status_key')

    // An RLS refusal returns zero rows and no error, so the row count is the only thing that
    // separates "saved" from "silently refused" (CLAUDE.md's board-membership lesson).
    if (error || !data || data.length === 0) {
      toast.error('Could not link this column to a status', {
        // The likeliest failure is idx_columns_board_status_key_unique: one column per status
        // per board, so a second claim on the same status is a duplicate key, not a policy.
        description: error?.code === '23505'
          ? 'Another column on this board is already linked to that status.'
          : error?.message ?? 'Only admins can change a board\u2019s columns.',
      })
      return
    }

    setColumns(columns.map(col => (
      col.id === columnId ? { ...col, status_key: resolvedKey, title: data[0].title } : col
    )))
    setStatusPickerColumn(null)
    toast.success(resolvedKey ? `Column linked to \u201C${data[0].title}\u201D` : 'Column unlinked from status')
  }

  // Subtasks are rows in the same `tasks` table and arrive in the same column payload
  // as their parents. They're rendered nested inside the parent card, so they must be
  // kept out of the column lists - otherwise every subtask also shows up as a loose
  // card and inflates the per-column counts.
  /**
   * ⌘K on a board.
   *
   * A board renders outside AppShell (kanban needs the full viewport width), so this page
   * had no command palette at all - which is why the plan's project-context and
   * work-item-context actions were declared in commands.ts and then never built. The
   * palette is mounted directly here instead of dragging the whole shell in.
   *
   * Stacking over the open task modal is fine: this subtree already opens the share and
   * move dialogs from inside it, so a dialog over a dialog is an established pattern here.
   */
  const runOnTask = useCallback(
    async (taskId: string, work: () => Promise<import('@/lib/rls-write').WriteOutcome>, subject: string) => {
      const failure = writeFailureMessage(await work(), subject)
      if (failure) {
        toast.error(failure.title, { description: failure.description })
        return
      }
      await refreshColumns()
    },
    [refreshColumns],
  )

  const copyToClipboard = useCallback(async (url: string, label: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success(`${label} copied`)
    } catch {
      // Clipboard access is refused outside a secure context and in some embedded
      // browsers. Saying so beats a command that silently does nothing.
      toast.error('Could not copy the link', { description: 'Copy it from the address bar instead.' })
    }
  }, [])

  const boardHref = buildBoardHref(platformRole, board.id)

  const paletteCommands: Command[] = useMemo(() => {
    const commands = buildBoardContextCommands({
      boardTitle: board.title,
      createDecision,
      manageDecision: manageBoardDecision,
      membersDecision: can(actor, 'members.manage', undefined, board),
      onCreate: () => {
        // Same guard the "+" button uses: cancelled is an archive destination.
        const target = columns.find((c: any) => c.status_key && c.status_key !== 'cancelled') ?? columns[0]
        if (target) handleOpenCreateDialog(target)
      },
      onFilter: () => setShowFilters(true),
      onOpenSettings: () => router.push(`${dashboardHost(platformRole)}?tab=boards`),
      onCopyLink: () => copyToClipboard(`${window.location.origin}${boardHref}`, 'Board link'),
    })

    // Work-item actions only exist when something is open to act on. Offering them with no
    // target would be a menu of commands that quietly do nothing.
    const openTask = selectedTaskId
      ? columns.flatMap((c: any) => c.tasks ?? []).find((t: any) => t.id === selectedTaskId)
      : null

    if (openTask) {
      commands.push(
        ...buildWorkItemContextCommands({
          task: {
            id: openTask.id,
            title: openTask.title,
            priority: openTask.priority,
            parentId: openTask.parent_task_id ?? null,
          },
          columns: columns.map((c: any) => ({ id: c.id, title: c.title })),
          currentColumnId: openTask.column_id,
          editDecision: can(actor, 'task.edit', {
            created_by: openTask.created_by,
            assigned_to: openTask.assigned_to,
            assigneeIds: getAssigneeIds(openTask),
          }),
          onMoveToColumn: (columnId) => {
            const destination = columns.find((c: any) => c.id === columnId)
            if (!destination) return
            const matching = taskStatuses.find(
              (status) => status.label.trim().toLowerCase() === destination.title.trim().toLowerCase(),
            )
            // Same three-step status resolution the drag handler uses, deliberately: the
            // palette must not invent a different answer for the same move.
            const status =
              destination.status_key ??
              matching?.key ??
              destination.title.toLowerCase().replace(/ /g, '_')
            runOnTask(
              openTask.id,
              () => moveTaskToColumn(supabase, openTask.id, {
                id: destination.id,
                status,
                position: boardTasks(destination).length,
              }),
              'move',
            )
          },
          onSetPriority: (priority) =>
            runOnTask(openTask.id, () => setTaskPriority(supabase, openTask.id, priority), 'priority'),
          // The detail is where assignees and labels live, and reproducing either here
          // would be a fourth copy of rules this codebase has already been bitten by
          // duplicating. The palette's job is to get you there without the mouse.
          onOpenAssignees: () => openTaskDetail(openTask.id),
          onOpenLabels: () => openTaskDetail(openTask.id),
          onCopyLink: () =>
            copyToClipboard(`${window.location.origin}${boardHref}?task=${openTask.id}`, 'Work item link'),
          onOpenParent: () => {
            if (!openTask.parent_task_id) return
            openTaskDetail(openTask.parent_task_id)
          },
          onOpenBoard: () => setTaskDetailOpen(false),
        }),
      )
    }

    return commands
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board, columns, selectedTaskId, actor, createDecision, manageBoardDecision, taskStatuses, isAdmin, runOnTask, copyToClipboard, boardHref, openTaskDetail])

  const boardTasks = (column: any) =>
    (column.tasks || []).filter((task: any) => !task.deleted_at && !task.archived_at && !task.parent_task_id)

  const archivedTasks = useMemo(
    () => columns
      .flatMap((column) => (column.tasks || []).map((task: any) => ({ ...task, archivedColumn: column })))
      .filter((task: any) => task.archived_at && !task.deleted_at && !task.parent_task_id)
      .sort((a: any, b: any) => new Date(b.archived_at).getTime() - new Date(a.archived_at).getTime()),
    [columns],
  )

  const handleRestoreTask = async (task: any) => {
    const destination = columns.find((column) => column.status_key === 'to_do')
    if (!destination) {
      toast.error('This board has no To Do column', {
        description: 'Link a column to the To Do status before restoring this task.',
      })
      return
    }

    const outcome = await classifyWrite(
      await supabase
        .from('tasks')
        .update({
          column_id: destination.id,
          status: 'to_do',
          position: boardTasks(destination).length,
          archived_at: null,
          archived_by: null,
        })
        .eq('id', task.id)
        .select('id'),
    )
    const failure = writeFailureMessage(outcome, 'restore')
    if (failure) {
      toast.error(failure.title, { description: failure.description })
      return
    }

    toast.success('Task restored to To Do')
    await refreshColumns()
  }

  // Parent id -> its subtasks, so a card can show "3/5 done" without another query.
  const subtasksByParent = useMemo(() => {
    const map = new Map<string, any[]>()
    for (const column of columns) {
      for (const task of column.tasks || []) {
        if (!task.parent_task_id || task.deleted_at || task.archived_at) continue
        const existing = map.get(task.parent_task_id)
        if (existing) existing.push(task)
        else map.set(task.parent_task_id, [task])
      }
    }
    return map
  }, [columns])

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
      const visibleTasks = sortTasks(filterTasks(boardTasks(column)))

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
      {/*
        This header is sticky, so every row it occupies is a row the board never gets back.
        On a phone it was running to roughly 240 of 844 pixels - back button, title, board
        description, creator byline, then eight controls wrapping onto two lines. Below `sm`
        the byline and description are dropped (reference detail, not something you need while
        moving work) and the back control becomes its icon.
      */}
      <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur">
        <div className="container mx-auto px-4 py-3 sm:py-4">
          <div className="flex flex-col gap-3 sm:gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex min-w-0 flex-1 items-start gap-2 sm:gap-4">
              <Button
                variant="outline"
                size="sm"
                aria-label="Back"
                onClick={() => {
                  if (window.history.length > 1) {
                    router.back()
                  } else {
                    // dashboardHost, not `isAdmin`: this surface's flag is false on
                    // /dashboard/board/<id> even for an admin, and /dashboard redirects
                    // them to /admin anyway - so the old fallback was a guaranteed
                    // double hop for exactly the people who use this app.
                    router.push(dashboardHost(platformRole))
                  }
                }}
              >
                <ArrowLeft className="w-4 h-4 sm:mr-2" />
                <span className="hidden sm:inline">Back</span>
              </Button>
              {/* The palette's entry point. ⌘K alone is not an affordance - the shell's
                  topbar has a visible button for exactly this reason, and a board renders
                  outside that topbar. */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="outline"
                    size="icon-sm"
                    onClick={() => setCommandOpen(true)}
                    aria-label="Open the command palette"
                    aria-keyshortcuts="Meta+K Control+K"
                  >
                    <SlidersHorizontal className="w-4 h-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Commands and actions (⌘K)</TooltipContent>
              </Tooltip>
              {/*
                Persistent nav so switching sections doesn't require leaving the board first
                (mobile gets the equivalent via MobileBottomNav below - this page renders
                outside the AppShell sidebar since kanban boards need the full viewport width).

                ⚠️ One menu, not a strip of icons. This was a row of unlabelled icon buttons
                back when the list was four hardcoded entries; sourcing it from
                buildWorkspaceNav grew it to a dozen, and a dozen 32px buttons ate the whole
                middle of the header - the board title was squeezed out of its own page and
                the description reflowed to one word per line. A menu costs one button's width
                whatever the workspace has switched on, and it can carry the labels, which the
                strip never could.
              */}
              <DropdownMenu>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="icon-sm" aria-label="Go to another section">
                        <LayoutGrid className="w-4 h-4" />
                      </Button>
                    </DropdownMenuTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Go to</TooltipContent>
                </Tooltip>
                <DropdownMenuContent align="start" className="w-52">
                  {navDestinations.map((item) => {
                    const Icon = navIcon(item.icon)
                    return (
                      <DropdownMenuItem key={item.id} onClick={() => router.push(item.href)} className="gap-2">
                        <Icon className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                        <span className="truncate">{item.label}</span>
                      </DropdownMenuItem>
                    )
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
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
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {/*
                      The board switcher. Moving between boards used to mean going back to a
                      dashboard, finding the boards tab and picking from the grid - three
                      screens to change one thing, on the surface where you are most likely
                      to want it. The title itself is the trigger, so the affordance costs no
                      extra header width (which is scarce here - see the note below).
                    */}
                    {otherBoards.length > 0 ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            className="group/switch -ml-1.5 flex min-w-0 items-center gap-1.5 rounded-md px-1.5 py-0.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            aria-label={`Switch board. Currently on ${boardTitle}`}
                          >
                            <h1 className="min-w-0 truncate text-lg font-bold tracking-tight sm:text-xl">{boardTitle}</h1>
                            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-data-[state=open]/switch:rotate-180" aria-hidden="true" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="max-h-[60vh] w-64 overflow-y-auto">
                          {boards.map((entry) => (
                            <DropdownMenuItem
                              key={entry.id}
                              // buildBoardHref, not the current path: an admin who arrived
                              // here through /dashboard/board/<id> must not be kept on that
                              // stripped surface for every board they open next.
                              onClick={() => router.push(buildBoardHref(platformRole, entry.id))}
                              className="gap-2"
                            >
                              {entry.is_private
                                ? <Lock className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />
                                : <Kanban className="h-4 w-4 flex-shrink-0 text-muted-foreground" aria-hidden="true" />}
                              <span className="min-w-0 flex-1 truncate">{entry.title}</span>
                              {entry.id === board.id && (
                                <Check className="h-4 w-4 flex-shrink-0 text-primary" aria-hidden="true" />
                              )}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : (
                      <h1 className="min-w-0 truncate text-lg font-bold tracking-tight sm:text-xl">{boardTitle}</h1>
                    )}
                    {/* Starring from inside the board matters more than starring from the
                        list: this is where you realise you keep coming back to it. */}
                    <FavoriteStar
                      active={isBoardStarred('board', board.id)}
                      pending={isStarPending('board', board.id)}
                      label={boardTitle}
                      onToggle={async (next) => {
                        const ok = await toggleFavorite('board', board.id, next)
                        if (!ok) {
                          toast.error('Couldn’t update favourites', {
                            description: 'The change was undone. Check your connection and try again.',
                          })
                        }
                      }}
                    />
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
                    <p className="hidden text-sm text-muted-foreground sm:block">{boardDescription}</p>
                  )}
                  {(board?.creator?.full_name || board?.creator?.email) && (
                    <p className="hidden text-xs text-muted-foreground sm:block">
                      Created by {board.creator.full_name || board.creator.email}
                    </p>
                  )}
                </div>
              )}
            </div>
            
            {/*
              Eight controls do not fit across 358px, and wrapping stranded the Add Column
              button alone on a second line - a whole extra row of a sticky header for one
              icon. Below `lg` the strip scrolls sideways at its natural width, which keeps
              the header one row tall and matches how the CRM sub-nav and the Super Admin tabs
              behave at the same width.
            */}
            <div className="-mx-4 flex items-center gap-2 overflow-x-auto px-4 pb-0.5 lg:mx-0 lg:flex-wrap lg:justify-end lg:overflow-visible lg:px-0 lg:pb-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              {/* View Toggle */}
              <div className="flex shrink-0 items-center border rounded-md">
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

              {/* Density is per viewer: one person packing the board tight must never
                  change how anyone else sees it. Persisted per user, per browser. */}
              <DensityToggle density={density} onChange={setDensity} />

              {/* A board renders outside AppShell (kanban needs the full viewport width), so it
                  gets none of the topbar's controls for free - including this one. Without it,
                  opening a board was a one-way trip out of dark mode: the only way back was to
                  navigate to a dashboard, flip it there, and come back. */}
              <ThemeControls />

              {/* This is a public-audience change, so the same capability and RLS rule
                  must gate board links and task links. In particular, a platform admin
                  explicitly narrowed to guest/client on this board stays view-only. */}
              {shareBoardDecision.allowed && (
                <ShareLinkDialog resourceType="board" resourceId={board.id} />
              )}

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

      <main className="w-full px-8 py-10 pb-24 md:px-12 md:pb-10">
        {isAdmin && missingStatuses.length > 0 && (
          <div className="mb-6 flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <span className="text-amber-900 dark:text-amber-200">
              This board has no column for{' '}
              <strong>{missingStatuses.map((s: any) => s.label).join(', ')}</strong>, so
              {missingStatuses.length === 1 ? ' that status ' : ' those statuses '}
              can&apos;t be used here.
            </span>
            {missingStatuses.map((s: any) => (
              <Button
                key={s.key}
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 bg-background"
                onClick={() => handleAddStatusColumn(s.key, s.label)}
              >
                <Plus className="h-3.5 w-3.5" />
                Add {s.label}
              </Button>
            ))}
          </div>
        )}
        {viewMode === 'tile' ? (
          <DragDropContext onDragEnd={onDragEnd}>
            <div className="-mx-8 overflow-x-auto px-8 pb-6 snap-x snap-mandatory md:-mx-12 md:snap-none md:px-12 scroll-pl-8">
              {/* Columns are rearrangeable by admins: drag a column header, or use Move left /
                  Move right in its menu (drag-and-drop is neither keyboard- nor touch-reachable -
                  the same lesson the marketing calendar's channel columns learned). The order is
                  a property of the board, so it moves for everyone. */}
              <Droppable droppableId={`board-columns-${board.id}`} type={COLUMN_DRAG_TYPE} direction="horizontal">
                {(columnsProvided) => (
              <div
                className="flex items-start gap-8"
                ref={columnsProvided.innerRef}
                {...columnsProvided.droppableProps}
              >
                {columns.map((column, columnIndex) => {
                  const visibleTasks = filterTasks(boardTasks(column))
                    .sort((a: any, b: any) => a.position - b.position)

                  return (
                    <Draggable
                      key={column.id}
                      draggableId={`column-${column.id}`}
                      index={columnIndex}
                      isDragDisabled={!isAdmin}
                    >
                      {(columnProvided, columnSnapshot) => (
                    <section
                      ref={columnProvided.innerRef}
                      {...columnProvided.draggableProps}
                      className={`w-[min(360px,calc(100vw-4rem))] flex-shrink-0 rounded-lg border bg-muted/20 snap-start ${
                        columnSnapshot.isDragging ? 'shadow-lg ring-2 ring-primary/30' : ''
                      }`}
                    >
                      <div
                        className={`rounded-t-lg border-b px-4 py-3 ${isAdmin ? 'cursor-grab active:cursor-grabbing' : ''}`}
                        {...columnProvided.dragHandleProps}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {isAdmin && (
                                <GripVertical className="h-4 w-4 flex-shrink-0 text-muted-foreground/40" aria-hidden="true" />
                              )}
                              <div
                                className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                                style={{ backgroundColor: column.color || '#3b82f6' }}
                              />
                              <h2 className="truncate text-base font-semibold">{column.title}</h2>
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {visibleTasks.length} {visibleTasks.length === 1 ? 'task' : 'tasks'}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            {/* Guests/clients previously saw nothing here, which reads as a
                                broken board rather than a permission boundary. The button
                                now stays visible but inert, and says why on hover/focus. */}
                            <ActionGuard decision={createDecision}>
                              <Button
                                size="icon-sm"
                                variant="ghost"
                                disabled={!createDecision.allowed}
                                onClick={createDecision.allowed ? () => handleOpenCreateDialog(column) : undefined}
                                aria-label={`Add task to ${column.title}`}
                              >
                                <Plus className="w-4 h-4" />
                              </Button>
                            </ActionGuard>
                            {isAdmin && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button variant="ghost" size="icon-sm">
                                    <MoreVertical className="w-4 h-4" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-48">
                                  {/* The keyboard- and touch-reachable half of rearranging. */}
                                  <DropdownMenuItem
                                    disabled={columnIndex === 0}
                                    onClick={() => moveColumn(columnIndex, columnIndex - 1)}
                                  >
                                    <ChevronLeft className="w-4 h-4 mr-2" />
                                    Move Left
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    disabled={columnIndex === columns.length - 1}
                                    onClick={() => moveColumn(columnIndex, columnIndex + 1)}
                                  >
                                    <ChevronRight className="w-4 h-4 mr-2" />
                                    Move Right
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => openRenameColumn(column)}>
                                    <Pencil className="w-4 h-4 mr-2" />
                                    Rename Column
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setColorPickerColumn(column.id)}>
                                    <Palette className="w-4 h-4 mr-2" />
                                    Change Color
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => setStatusPickerColumn(column.id)}>
                                    <SlidersHorizontal className="w-4 h-4 mr-2" />
                                    Link Status
                                  </DropdownMenuItem>
                                  <DropdownMenuItem onClick={() => handleDeleteColumn(column.id)} className="text-red-600 dark:text-red-400">
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
                                      boardRole={boardRole}
                                      density={density}
                                      users={users}
                                      board={board}
                                      columns={columns}
                                      subtasks={subtasksByParent.get(task.id)}
                                      isDragging={snapshot.isDragging}
                                      onUpdate={refreshColumns}
                                      onOpenDetail={openTaskDetail}
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
                      )}
                    </Draggable>
                  )
                })}
                {columnsProvided.placeholder}
              </div>
                )}
              </Droppable>
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
              const columnTasks = filterTasks(boardTasks(column))
              if (columnTasks.length === 0) return null
              
              return (
                <Card key={column.id} className="shadow-sm">
                  <CardHeader className="pb-3 border-b">
                    <div className="flex items-center gap-3">
                      <div className="w-3 h-3 flex-shrink-0 rounded-full" style={{ backgroundColor: column.color || '#3b82f6' }} />
                      <CardTitle>{column.title}</CardTitle>
                      <Badge variant="secondary">{columnTasks.length}</Badge>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-2 md:hidden">
                      {sortTasks(columnTasks).map((task: any) => {
                        const taskAssignees = getAssignees(task, users)
                        return (
                          <div
                            key={task.id}
                            onClick={() => {
                              openTaskDetail(task.id)
                            }}
                            className="flex items-center gap-3 rounded-md border bg-background px-3 py-2.5 active:bg-accent/50 transition-colors"
                          >
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium">{task.title}</div>
                              {task.due_date && (
                                <div className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
                                  <Calendar className="w-3 h-3" />
                                  {new Date(task.due_date).toLocaleDateString('en-US')}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-shrink-0 items-center gap-2">
                              {taskAssignees.length > 0 && (
                                <div className="flex -space-x-2">
                                  {taskAssignees.slice(0, 2).map((u: any) => (
                                    <div
                                      key={u.id}
                                      className="w-6 h-6 rounded-full bg-primary/10 border border-background flex items-center justify-center text-[10px] font-medium"
                                      title={u.full_name || u.email}
                                    >
                                      {u.full_name?.[0] || u.email?.[0]}
                                    </div>
                                  ))}
                                </div>
                              )}
                              <Badge variant={task.priority <= 2 ? 'destructive' : task.priority === 3 ? 'default' : 'secondary'} className="px-1.5 text-[10px]">
                                P{task.priority}
                              </Badge>
                            </div>
                          </div>
                        )
                      })}
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
                                  openTaskDetail(task.id)
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
                                      openTaskDetail(task.id)
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

      {isSuperAdmin && archivedTasks.length > 0 && (
        <section className="container mx-auto px-4 pb-24 md:pb-8" aria-labelledby="archived-tasks-heading">
          <Card className="border-dashed bg-muted/20">
            <CardHeader className="pb-3">
              <CardTitle id="archived-tasks-heading" className="flex items-center gap-2 text-base">
                <Archive className="h-4 w-4" />
                Archived tasks ({archivedTasks.length})
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                Cancelled tasks stay preserved here. Only super admins can see or restore them.
              </p>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {archivedTasks.map((task: any) => (
                <div key={task.id} className="flex min-w-0 items-center justify-between gap-3 rounded-lg border bg-background p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{task.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {task.archived_at
                        ? `Archived ${new Date(task.archived_at).toLocaleDateString('en-US')}`
                        : task.archivedColumn?.title}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="shrink-0 gap-1.5"
                    onClick={() => handleRestoreTask(task)}
                  >
                    <ArchiveRestore className="h-4 w-4" />
                    Restore
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>
        </section>
      )}

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
          // Refresh the board's rollup without dismissing the task being worked in.
          onSubtaskChange={() => { void refreshColumns() }}
          board={board}
          isAdmin={isAdmin}
          currentUserId={currentUserId}
          boardRole={boardRole}
          columns={columns}
          initialTab={taskDetailTab}
        />
      )}

      <CreateTaskDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        column={selectedColumn}
        columns={columns}
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
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    Status (optional - a linked column is named by its status and tracks it everywhere)
                  </label>
                  <Select value={newColumnStatusKey} onValueChange={handlePickNewColumnStatus}>
                    <SelectTrigger>
                      <SelectValue placeholder="No status mapping" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">No status mapping</SelectItem>
                      {taskStatuses.map((s: any) => (
                        <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setNewColumnDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={handleAddColumn}>Add Column</Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog
            open={renameColumnId !== null}
            onOpenChange={(next) => { if (!next && !renameColumnBusy) setRenameColumnId(null) }}
          >
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename column</DialogTitle>
                <DialogDescription>
                  {renameTargetStatus
                    ? `This column is the \u201C${renameTargetStatus.label}\u201D status. Renaming it renames that status, and every column tracking it on every board.`
                    : 'This is a custom column, so the name belongs to this board alone.'}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="rename-column-input">Name</Label>
                  <Input
                    id="rename-column-input"
                    value={renameColumnValue}
                    onChange={(e) => setRenameColumnValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key !== 'Enter') return
                      e.preventDefault()
                      if (renameTargetStatus && !isSuperAdmin) return
                      handleRenameColumn()
                    }}
                    autoFocus
                    disabled={renameColumnBusy || Boolean(renameTargetStatus && !isSuperAdmin)}
                  />
                </div>

                {/*
                  task_statuses is super-admin-only (migration 069) while columns are
                  admin-writable, so a plain admin can rename a custom column and not a
                  linked one. Saying so beats letting them type a name into a control whose
                  write the database will refuse - and beats the alternative of writing
                  columns.title anyway, which 107's cascade would silently revert on the next
                  status rename.
                */}
                {renameTargetStatus && !isSuperAdmin && (
                  <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                    Only a super admin can rename a status. To give this column a name of its
                    own instead, unlink it first with <span className="font-medium">Link Status</span> -
                    note that tasks on this board can then no longer be set to{' '}
                    <span className="font-medium">{renameTargetStatus.label}</span>.
                  </p>
                )}

                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => setRenameColumnId(null)} disabled={renameColumnBusy}>
                    Cancel
                  </Button>
                  <Button
                    onClick={handleRenameColumn}
                    disabled={
                      renameColumnBusy
                      || !renameColumnValue.trim()
                      || renameColumnValue.trim() === renameTarget?.title
                      || Boolean(renameTargetStatus && !isSuperAdmin)
                    }
                  >
                    {renameColumnBusy ? 'Renaming\u2026' : 'Rename'}
                  </Button>
                </div>
              </div>
            </DialogContent>
          </Dialog>

          <Dialog open={statusPickerColumn !== null} onOpenChange={() => setStatusPickerColumn(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Link Column to Status</DialogTitle>
                <DialogDescription>
                  Tasks moved into this column will reliably be tracked under the chosen status -
                  without a link, a status can be picked from a task's dropdown but won't stick.
                </DialogDescription>
              </DialogHeader>
              <Select
                value={columns.find(c => c.id === statusPickerColumn)?.status_key ?? '__none__'}
                onValueChange={(value) => statusPickerColumn && handleUpdateColumnStatus(statusPickerColumn, value)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="No status mapping" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">No status mapping</SelectItem>
                  {taskStatuses.map((s: any) => (
                    <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
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

      <CommandPalette
        // No nav groups: this page is not the shell, and duplicating the sidebar here
        // would offer a second, unfiltered copy of it. The context group is the point.
        groups={[]}
        role={platformRole}
        open={commandOpen}
        onOpenChange={setCommandOpen}
        commands={paletteCommands}
      />

      <MobileBottomNav items={navItems} moreItems={navMoreItems} activeTab="boards" onChange={handleNavChange} />
    </div>
  )
}
