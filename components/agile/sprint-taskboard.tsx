'use client'

// The sprint taskboard: statuses across, story swimlanes down.
//
// Taiga's model, and Prompt G's requirement that "a user story can form a horizontal/grouped
// context containing its tasks. Tasks remain canonical work items." So a lane is a PARENT work
// item (113's `parent_task_id`), the cards inside it are its children, and both are the same
// rows the board renders - there is no story table and no copy.
//
// ⚠️ WIP badges tell the truth about whether they will be enforced. `wipStatus` is given
// `enforcementAvailable`, which is false where migration 125 is not applied, and the badge then
// says "warning" rather than implying a refusal the database will not make. A warning that
// turns out to be untrue teaches people to ignore the next one.

import { useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { EmptyState } from '@/components/shell/states'
import { WorkItemRow } from './work-item-row'
import {
  groupIntoSwimlanes, sprintNoun, wipStatus,
  type AgileSettings, type SprintLike,
} from '@/lib/agile'
import type { StatusCatalog } from '@/lib/task-status'
import type { Density } from '@/components/shell/density'

interface BoardColumn {
  id: string
  title: string
  status_key: string | null
  position: number
  wip_limit: number | null
}

interface Props {
  settings: AgileSettings
  statuses: StatusCatalog
  columns: BoardColumn[]
  density: Density
  sprint: (SprintLike & { id: string }) | null
  sprintTasks: any[]
  /** Every live task on the board, so a WIP count is the column's REAL count. */
  boardTasks: any[]
  wipEnforcementAvailable: boolean
  swimlanes: boolean
  canManage: boolean
  onOpenTask: (id: string) => void
  onEstimate: (taskId: string, value: number | null) => void
}

export function SprintTaskboard({
  settings, statuses, columns, density, sprint, sprintTasks, boardTasks,
  wipEnforcementAvailable, swimlanes, canManage, onOpenTask, onEstimate,
}: Props) {
  const ordered = useMemo(() => [...columns].sort((a, b) => a.position - b.position), [columns])

  const columnOf = (task: any) => task.column?.id ?? null

  // ⚠️ The WIP count is over EVERY live task in the column, not only the ones in this window.
  // A limit is a property of the column, and counting only sprint work would report a column
  // as half empty while it is full - and then the database (125) would refuse a move the
  // screen had just said was fine.
  const wipCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const task of boardTasks) {
      const id = columnOf(task)
      if (!id) continue
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    return counts
  }, [boardTasks])

  const lanes = useMemo(
    () => (swimlanes ? groupIntoSwimlanes(sprintTasks, 'Not under a parent item') : null),
    [swimlanes, sprintTasks],
  )

  if (!sprint) {
    return (
      <EmptyState
        title={`No ${sprintNoun(settings.terminology)} selected`}
        description={`Pick or create a ${sprintNoun(settings.terminology)} to see its board.`}
      />
    )
  }

  const cardsFor = (columnId: string, pool: any[]) =>
    pool.filter((t) => columnOf(t) === columnId)

  const renderColumnHeader = (column: BoardColumn) => {
    const status = wipStatus({
      count: wipCounts.get(column.id) ?? 0,
      limit: column.wip_limit,
      mode: settings.wip_mode,
      enforcementAvailable: wipEnforcementAvailable,
    })
    return (
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="truncate text-sm font-semibold">{column.title}</h4>
        {status.state !== 'none' && (
          <Badge
            variant={status.state === 'under' ? 'outline' : 'secondary'}
            className={`shrink-0 text-[10px] ${
              status.state === 'over' ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : ''
            }`}
            title={
              status.blocks
                ? `${status.message} Moves into this column are refused while it is full.`
                : `${status.message} This is a warning only - moves are still allowed.`
            }
          >
            WIP {status.count}/{status.limit}
            {status.state !== 'under' && (status.blocks ? ' · enforced' : ' · warning')}
          </Badge>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {lanes ? (
        lanes.map((lane) => (
          <section key={lane.id ?? '__ungrouped__'} className="rounded-lg border">
            <header className="bg-muted/40 flex items-center gap-2 border-b px-3 py-2">
              <h3 className="truncate text-sm font-semibold">{lane.title}</h3>
              <Badge variant="outline" className="text-[10px]">{lane.items.length}</Badge>
              {lane.parent && (
                <button
                  type="button"
                  onClick={() => onOpenTask(lane.parent!.id)}
                  className="text-muted-foreground hover:text-foreground ml-auto text-xs hover:underline"
                >
                  Open parent
                </button>
              )}
            </header>
            <div className="grid gap-3 overflow-x-auto p-3" style={{ gridTemplateColumns: `repeat(${ordered.length}, minmax(14rem, 1fr))` }}>
              {ordered.map((column) => (
                <div key={column.id} className="min-w-0">
                  {renderColumnHeader(column)}
                  <div className="space-y-2">
                    {cardsFor(column.id, lane.items).map((task: any) => (
                      <WorkItemRow
                        key={task.id} task={task} unit={settings.estimate_unit} statuses={statuses}
                        density={density} onOpen={onOpenTask} onEstimate={onEstimate} canEstimate={canManage}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))
      ) : (
        <div className="grid gap-3 overflow-x-auto" style={{ gridTemplateColumns: `repeat(${ordered.length}, minmax(14rem, 1fr))` }}>
          {ordered.map((column) => (
            <div key={column.id} className="bg-muted/30 min-w-0 rounded-lg p-3">
              {renderColumnHeader(column)}
              <div className="space-y-2">
                {cardsFor(column.id, sprintTasks).map((task: any) => (
                  <WorkItemRow
                    key={task.id} task={task} unit={settings.estimate_unit} statuses={statuses}
                    density={density} onOpen={onOpenTask} onEstimate={onEstimate} canEstimate={canManage}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {sprintTasks.length === 0 && (
        <EmptyState
          title={`Nothing in this ${sprintNoun(settings.terminology)} yet`}
          description="Plan work in from the backlog. The cards here are the same work items the board shows - nothing is copied."
        />
      )}
    </div>
  )
}
