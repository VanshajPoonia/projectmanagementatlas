'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  CalendarDays,
  CircleDot,
  Clock,
  Info,
  Lock,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Users,
} from 'lucide-react'

import { AppShell } from '@/components/shell/app-shell'
import { EmptyState, ErrorState } from '@/components/shell/states'
import { boardHref, buildWorkspaceNav, dashboardHost } from '@/components/shell/workspace-nav'
import type { SidebarNavGroup } from '@/components/shell/app-sidebar'
import { buildCreateCommands, type Command } from '@/components/shell/commands'
import { useRecentRecords } from '@/components/shell/use-recent-records'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ThemeControls } from '@/components/theme/theme-controls'
import { allows } from '@/lib/capabilities'
import { useAppModules, isModuleEnabled } from '@/lib/modules'
import type { ShellData } from '@/lib/shell-data'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useFavorites } from '@/lib/use-favorites'
import { isTaskOwnedBy } from '@/lib/assignees'
import { getTaskStatusLabel } from '@/lib/task-status'
import { UNANSWERED_QUESTIONS, buildMyWork, daysUntil, myWorkSummary } from '@/lib/my-work'
import { MY_WORK_SECTIONS, applyPreferences, isSectionVisible } from '@/lib/my-work-preferences'
import type { ExpandedRelation } from '@/lib/task-relations'
import { calendarDateLabel, taskDueDate } from '@/lib/calendar-grid'
import { useNow } from '@/lib/use-now'
import { cn } from '@/lib/utils'
import { useMyWorkPreferences } from './use-my-work-preferences'

interface MyWorkViewProps {
  user: any
  tasks: any[]
  /** Rows from `task_relations_expanded` - what blocks this person, and whom they block. */
  relations?: ExpandedRelation[]
  /** `task_statuses.key` for every status a super admin flagged as awaiting approval (121). */
  approvalStatusKeys?: string[]
  /** This person's own open personal tasks (030). Nobody else can see them. */
  personalTasks?: any[]
  shell?: ShellData
  /**
   * True when the task query itself failed. Without this an empty `tasks` array is
   * indistinguishable from a genuinely clear plate, and the screen cheerfully says so.
   */
  loadFailed?: boolean
  /**
   * The instant the SERVER rendered at, ISO. Required, not optional: every date on this page
   * is relative to "now", so reading the wall clock during render makes the server and the
   * client disagree about what "today" is near midnight, and React throws the subtree away.
   */
  now: string
}

/**
 * The date chip on a task row.
 *
 * ⚠️ `now` is a parameter, and the far date is formatted with `calendarDateLabel` - which keeps
 * the YEAR. The compact `shortDayLabel` shipped here briefly in August 2026 and made a task due
 * 5 Jan 2027 render identically to one due 5 Jan 2026. Fixing what a value MEANS is not licence
 * to change how it LOOKS.
 */
function dueLabel(due: unknown, now: Date): { text: string; overdue: boolean } | null {
  const days = daysUntil(due, now)
  if (days === null) return null
  if (days < 0) return { text: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, overdue: true }
  if (days === 0) return { text: 'Due today', overdue: false }
  if (days === 1) return { text: 'Due tomorrow', overdue: false }
  const date = taskDueDate({ due_date: due })
  return date ? { text: `Due ${calendarDateLabel(date)}`, overdue: false } : null
}

const SECTION_ICONS: Record<string, typeof CircleDot> = {
  overdue: AlertTriangle,
  today: CalendarDays,
  blocked: Lock,
  'awaiting-approval': ShieldCheck,
  blocking: Users,
  'in-progress': CircleDot,
  'this-week': CalendarDays,
  delegated: Users,
  personal: Lock,
  assigned: CircleDot,
}

/**
 * My Work.
 *
 * Answers five questions in the order a person needs them: what should I do next (and why),
 * what is late, what can I not act on, what is other people's work waiting on, and finally the
 * whole list. Every ranked item and every section states its own rule - an unexplained
 * ordering is a black box, and people stop trusting it the first time it disagrees with them.
 *
 * Order and visibility are a PERSONAL preference (localStorage, per user, per browser). Which
 * of those questions matters most differs by job, and one person's answer must never change
 * anybody else's screen.
 */
export default function MyWorkView({
  user,
  tasks,
  relations = [],
  approvalStatusKeys = [],
  personalTasks = [],
  shell,
  loadFailed = false,
  now: serverNow,
}: MyWorkViewProps) {
  // One clock for the whole page, seeded from the server so hydration matches, then the
  // browser's own after mount. Every section, count, reason and date chip below reads it.
  const now = useNow(serverNow)
  const role = user?.role ?? 'user'
  const isAdmin = role === 'admin' || role === 'super_admin'
  const basePath = dashboardHost(role)

  const favoriteBoardHref = useCallback((boardId: string) => boardHref(role, boardId), [role])
  const { resolved: favoriteItems } = useFavorites(user?.id, { boardHref: favoriteBoardHref })
  const { records: recent } = useRecentRecords(user?.id ?? '')

  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)
  const { preferences, toggle, move, reset } = useMyWorkPreferences(user?.id)

  const mine = useMemo(() => tasks.filter((task) => isTaskOwnedBy(task, user?.id)), [tasks, user?.id])

  const context = useMemo(
    () => ({
      relations,
      approvalStatusKeys: new Set(approvalStatusKeys),
      // Gated on the module, not just on whether rows came back: a section fed by a switched-
      // off module is a section nobody can act on.
      personalTasks: isModuleEnabled(modules, 'personal_tasks') ? personalTasks : [],
    }),
    [relations, approvalStatusKeys, personalTasks, modules],
  )

  const { sections, next } = useMemo(
    () => buildMyWork(mine, tasks, user?.id, now, context),
    [mine, tasks, user?.id, now, context],
  )
  const summary = useMemo(() => myWorkSummary(mine, now, context, tasks), [mine, now, context, tasks])

  const groups: SidebarNavGroup[] = useMemo(
    () =>
      buildWorkspaceNav({
        role,
        modules,
        canUseMarketingCalendar: isAdmin || calendars.length > 0,
        canViewAudit: allows({ userId: user?.id ?? '', platformRole: role }, 'audit.view'),
      }),
    [role, user?.id, modules, isAdmin, calendars.length],
  )

  const commands: Command[] = useMemo(() => buildCreateCommands({ role, modules }), [role, modules])

  /**
   * Every renderable block, keyed by the same ids the preference model uses - including the
   * two that are not lists of tasks. One list, so the customize panel cannot offer a section
   * the page does not render, and the page cannot render one the panel does not offer.
   */
  const blocks = useMemo(() => {
    const entries: Array<{ id: string; node: React.ReactNode }> = []

    entries.push({
      id: 'recommended-next',
      node: (
        <Card data-section="work-next" key="work-next">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" aria-hidden="true" />
              What to do next
            </CardTitle>
            <CardDescription>
              Ranked by whether you can act on it at all, then how close the deadline is, then
              priority, then whether it is already started. Each item shows the reasons it placed
              where it did - there is no hidden score.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {next.length === 0 ? (
              <EmptyState
                icon={<Sparkles />}
                title="Nothing is waiting on you"
                description="Every task assigned to you is done. Work assigned to you later will appear here first."
              />
            ) : (
              <ol className="space-y-2">
                {next.map(({ task, reasons, isOverdue, isBlocked }, index) => (
                  <li key={task.id}>
                    <Link
                      href={task.board_id ? boardHref(role, task.board_id) : '#'}
                      className={cn(
                        'hover:border-primary/30 flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent',
                        index === 0 && 'border-primary/40 bg-primary/5',
                        isOverdue && 'border-red-300 bg-red-50/40 dark:border-red-800 dark:bg-red-950/40',
                        // Blocked work is styled as parked rather than as urgent, because the
                        // action it needs is somewhere else.
                        isBlocked && 'border-dashed opacity-90',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold',
                          index === 0 ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{task.title}</p>
                        <p className="text-muted-foreground mt-0.5 text-xs">{reasons.join(' · ')}</p>
                      </div>
                      {task.board_title && (
                        <Badge variant="outline" className="hidden shrink-0 sm:inline-flex">
                          {task.board_title}
                        </Badge>
                      )}
                    </Link>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      ),
    })

    for (const section of sections) {
      const Icon = SECTION_ICONS[section.id] ?? CircleDot
      const isPersonal = section.id === 'personal'
      entries.push({
        id: section.id,
        node: (
          <Card key={section.id} data-section={section.id}>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Icon
                  className={cn('size-4', section.id === 'overdue' && 'text-red-600 dark:text-red-400')}
                  aria-hidden="true"
                />
                {section.title}
                <Badge variant="secondary" className="ml-1 tabular-nums">{section.tasks.length}</Badge>
              </CardTitle>
              {/* Every section explains what it contains - a bare heading leaves the reader
                  guessing at the rule that put a task in front of them. */}
              <CardDescription>{section.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {section.tasks.map((task: any) => {
                  const due = dueLabel(task.due_date, now)
                  // A personal task has no board, so it opens the Personal tab rather than a
                  // link that goes nowhere.
                  const href = isPersonal
                    ? `${basePath}?tab=personal`
                    : task.board_id
                      ? boardHref(role, task.board_id)
                      : '#'
                  return (
                    <li key={task.id}>
                      <Link
                        href={href}
                        className="hover:border-primary/30 flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">{task.title}</p>
                          <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                            {task.board_title && <span className="truncate">{task.board_title}</span>}
                            {!isPersonal && <span>{getTaskStatusLabel(task)}</span>}
                            {due && (
                              <span className={due.overdue ? 'font-medium text-red-600 dark:text-red-400' : undefined}>
                                {due.text}
                              </span>
                            )}
                          </p>
                        </div>
                      </Link>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        ),
      })
    }

    if (recent.length > 0) {
      entries.push({
        id: 'recent',
        node: (
          <Card key="recent" data-section="recent">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="size-4" aria-hidden="true" />
                Recently viewed
                <Badge variant="secondary" className="ml-1 tabular-nums">{recent.length}</Badge>
              </CardTitle>
              {/* Per browser, not per account: this is where YOU were, and it never leaves
                  this device. Said out loud so nobody wonders who else can see it. */}
              <CardDescription>Where you have been, on this browser. Nobody else sees this list.</CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {recent.map((record) => (
                  <li key={record.href}>
                    <Link
                      href={record.href}
                      className="hover:border-primary/30 flex items-center gap-3 rounded-lg border p-3 text-sm transition-colors hover:bg-accent"
                    >
                      <span className="truncate">{record.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ),
      })
    }

    return entries
  }, [sections, next, recent, role, basePath, now])

  const ordered = useMemo(() => applyPreferences(blocks, preferences), [blocks, preferences])

  return (
    <AppShell
      user={{ id: user?.id, role, full_name: user?.full_name, email: user?.email }}
      groups={groups}
      activeId="my-work"
      breadcrumbs={[{ label: 'My Work' }]}
      favorites={favoriteItems}
      commands={commands}
      topbarActions={<ThemeControls />}
    >
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">My Work</h1>
            <p className="text-muted-foreground text-sm">
              What is yours, what needs attention, what to do next, and what you are waiting on.
            </p>
          </div>

          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" id="my-work-customize">
                <SlidersHorizontal className="size-4" />
                Customize
              </Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-80">
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Sections</p>
                  {/* Says whose setting this is. A layout control that looked global would
                      make people afraid to touch it. */}
                  <p className="text-muted-foreground text-xs">
                    Yours only, on this browser. Changing it does not affect anyone else.
                  </p>
                </div>
                <ul className="space-y-1">
                  {preferences.order.map((id, index) => {
                    const meta = MY_WORK_SECTIONS.find((s) => s.id === id)
                    if (!meta) return null
                    const visible = isSectionVisible(preferences, id)
                    return (
                      <li key={id} className="flex items-center gap-1">
                        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
                          <input
                            type="checkbox"
                            id={`my-work-section-${id}`}
                            checked={visible}
                            onChange={() => toggle(id)}
                            className="size-4"
                          />
                          <span className={cn('truncate', !visible && 'text-muted-foreground line-through')}>
                            {meta.label}
                          </span>
                        </label>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Move ${meta.label} up`}
                          disabled={index === 0}
                          onClick={() => move(id, -1)}
                        >
                          <ArrowUp className="size-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7"
                          aria-label={`Move ${meta.label} down`}
                          disabled={index === preferences.order.length - 1}
                          onClick={() => move(id, 1)}
                        >
                          <ArrowDown className="size-3.5" />
                        </Button>
                      </li>
                    )
                  })}
                </ul>
                <Button variant="ghost" size="sm" className="w-full" id="my-work-reset" onClick={reset}>
                  Reset to default
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </header>

        {/* Shown INSTEAD of the counts and sections, never above them: a zero next to a failed
            query is not a small number, it is an unknown one. */}
        {loadFailed ? (
          <ErrorState
            title="Your work could not be loaded"
            description="Nothing is wrong with your tasks - this page failed to read them. Reload to try again; if it keeps failing, tell an admin."
          />
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat label="Open" value={summary.open} statId="stat-open" />
              <Stat label="Overdue" value={summary.overdue} statId="stat-overdue" tone={summary.overdue > 0 ? 'danger' : 'plain'} />
              <Stat label="Due today" value={summary.dueToday} statId="stat-due-today" />
              <Stat label="Blocked" value={summary.blocked} statId="stat-blocked" />
            </dl>

            {ordered.length === 0 ? (
              <EmptyState
                icon={<CalendarDays />}
                title="No open work is assigned to you"
                description="This screen gathers everything you own across every board, so you don’t have to check them one at a time. Once something is assigned to you it shows up here."
                action={
                  <Link href={`${basePath}?tab=boards`} className="text-primary text-sm font-medium underline">
                    Browse boards
                  </Link>
                }
              />
            ) : (
              ordered.map((entry) => <div key={entry.id}>{entry.node}</div>)
            )}
          </>
        )}

        {/* Stated rather than silently omitted: a section that guessed would be trusted, and
            wrong once is enough to poison every other number on the page. This list is two
            entries shorter than it was - 115 and 121 closed the other two. */}
        <section aria-labelledby="my-work-gaps" className="text-muted-foreground rounded-lg border border-dashed p-4 text-xs">
          <h2 id="my-work-gaps" className="flex items-center gap-2 font-medium">
            <Info className="size-3.5" aria-hidden="true" />
            Not answered here yet
          </h2>
          <ul className="mt-2 space-y-1">
            {UNANSWERED_QUESTIONS.map((entry) => (
              <li key={entry.question}>
                {entry.question} - needs {entry.blockedBy}.
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  )
}

/**
 * `statId` exists so a browser harness can read one number without guessing at DOM structure.
 * Locating by surrounding text finds nested cards and passes for the wrong reason.
 */
function Stat({ label, value, statId, tone = 'plain' }: { label: string; value: number; statId: string; tone?: 'plain' | 'danger' }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd
        id={statId}
        className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'danger' && 'text-red-600 dark:text-red-400')}
      >
        {value}
      </dd>
    </div>
  )
}
