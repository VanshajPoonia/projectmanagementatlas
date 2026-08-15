'use client'

import { useCallback, useMemo } from 'react'
import Link from 'next/link'
import { format } from 'date-fns'
import { AlertTriangle, CalendarDays, CircleDot, Info, Sparkles } from 'lucide-react'

import { AppShell } from '@/components/shell/app-shell'
import { EmptyState } from '@/components/shell/states'
import { buildWorkspaceNav } from '@/components/shell/workspace-nav'
import type { SidebarNavGroup } from '@/components/shell/app-sidebar'
import type { Command } from '@/components/shell/commands'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ThemeControls } from '@/components/theme/theme-controls'
import { useAppModules } from '@/lib/modules'
import type { ShellData } from '@/lib/shell-data'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useFavorites } from '@/lib/use-favorites'
import { isTaskOwnedBy } from '@/lib/assignees'
import { getTaskStatusLabel } from '@/lib/task-status'
import { UNANSWERED_QUESTIONS, buildMyWork, daysUntil, myWorkSummary } from '@/lib/my-work'
import { cn } from '@/lib/utils'

interface MyWorkViewProps {
  user: any
  tasks: any[]
  /**
   * Modules + marketing calendars, fetched on the server so the sidebar is correct on the
   * first frame. Optional: without it both hooks fall back to fetching on mount, which is
   * what every screen used to do. See lib/shell-data.ts.
   */
  shell?: ShellData
}

function dueLabel(due: unknown): { text: string; overdue: boolean } | null {
  const days = daysUntil(due)
  if (days === null) return null
  if (days < 0) return { text: `${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} overdue`, overdue: true }
  if (days === 0) return { text: 'Due today', overdue: false }
  if (days === 1) return { text: 'Due tomorrow', overdue: false }
  return { text: `Due ${format(new Date(due as string), 'EEE d MMM')}`, overdue: false }
}

/**
 * My Work.
 *
 * Two halves, in the order a person actually needs them: the ranked shortlist ("what
 * should I do next, and why") on top, then the full picture broken into the urgency
 * sections underneath. Every ranked item shows the reasons that put it where it is —
 * an unexplained ordering is a black box, and people stop trusting it the first time it
 * disagrees with them.
 */
export default function MyWorkView({ user, tasks, shell }: MyWorkViewProps) {
  const isAdmin = user?.role === 'admin' || user?.role === 'super_admin'
  const basePath = isAdmin ? '/admin' : '/dashboard'

  // The sidebar's Favourites block. My Work has no board list of its own, which is exactly
  // why useFavorites resolves its own targets rather than taking them as a prop.
  const favoriteBoardHref = useCallback(
    (boardId: string) => `${basePath}/board/${boardId}`,
    [basePath],
  )
  const { resolved: favoriteItems } = useFavorites(user?.id, { boardHref: favoriteBoardHref })

  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)

  const mine = useMemo(() => tasks.filter((task) => isTaskOwnedBy(task, user?.id)), [tasks, user?.id])
  const { sections, next } = useMemo(
    () => buildMyWork(mine, tasks, user?.id),
    [mine, tasks, user?.id],
  )
  const summary = useMemo(() => myWorkSummary(mine), [mine])

  const groups: SidebarNavGroup[] = useMemo(
    () =>
      buildWorkspaceNav({
        role: user?.role ?? 'user',
        modules,
        canUseMarketingCalendar: isAdmin || calendars.length > 0,
      }),
    [user?.role, modules, isAdmin, calendars.length],
  )

  // The palette's Create section. Both are honest navigations to where the create
  // affordance actually lives — no capability gate, because neither performs a write.
  const commands: Command[] = useMemo(
    () => [
      {
        id: 'create:board-task',
        group: 'create',
        label: 'New task on a board',
        hint: 'Opens Boards',
        icon: 'plus',
        href: '/dashboard?tab=boards',
      },
      {
        id: 'create:personal-task',
        group: 'create',
        label: 'New personal task',
        hint: 'Private to you',
        icon: 'plus',
        href: '/dashboard?tab=personal',
      },
    ],
    [],
  )

  return (
    <AppShell
      user={{ id: user?.id, role: user?.role, full_name: user?.full_name, email: user?.email }}
      groups={groups}
      activeId="my-work"
      breadcrumbs={[{ label: 'My Work' }]}
      favorites={favoriteItems}
      commands={commands}
      topbarActions={<ThemeControls />}
    >
      <div className="mx-auto w-full max-w-5xl space-y-6 p-4 md:p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">My Work</h1>
          <p className="text-muted-foreground text-sm">
            Everything assigned to you, across every board you can see.
          </p>
        </header>

        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Open" value={summary.open} />
          <Stat label="Overdue" value={summary.overdue} tone={summary.overdue > 0 ? 'danger' : 'plain'} />
          <Stat label="Due today" value={summary.dueToday} />
        </dl>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Sparkles className="size-4" aria-hidden="true" />
              What to do next
            </CardTitle>
            <CardDescription>
              Ranked by how close the deadline is, then priority, then whether it is already
              started. Each item shows the reasons it placed where it did.
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
                {next.map(({ task, reasons, isOverdue }, index) => (
                  <li key={task.id}>
                    <Link
                      href={task.board_id ? `${basePath}/board/${task.board_id}` : '#'}
                      className={cn(
                        'hover:border-primary/30 flex items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-accent',
                        index === 0 && 'border-primary/40 bg-primary/5',
                        isOverdue && 'border-red-300 bg-red-50/40 dark:border-red-800 dark:bg-red-950/40',
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
                        <p className="text-muted-foreground mt-0.5 text-xs">
                          {reasons.join(' · ')}
                        </p>
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

        {sections.length === 0 ? (
          <EmptyState
            icon={<CalendarDays />}
            title="No open work is assigned to you"
            description="This screen gathers everything you own across every board, so you don’t have to check them one at a time. Once something is assigned to you it shows up here."
            action={
              <Link href="/dashboard?tab=boards" className="text-primary text-sm font-medium underline">
                Browse boards
              </Link>
            }
          />
        ) : (
          sections.map((section) => (
            <Card key={section.id}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  {section.id === 'overdue' ? (
                    <AlertTriangle className="size-4 text-red-600 dark:text-red-400" aria-hidden="true" />
                  ) : (
                    <CircleDot className="size-4" aria-hidden="true" />
                  )}
                  {section.title}
                  <Badge variant="secondary" className="ml-1">
                    {section.tasks.length}
                  </Badge>
                </CardTitle>
                {/* Every section explains what it contains — a bare heading leaves the
                    reader guessing at the rule that put a task in front of them. */}
                <CardDescription>{section.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2">
                  {section.tasks.map((task: any) => {
                    const due = dueLabel(task.due_date)
                    return (
                      <li key={task.id}>
                        <Link
                          href={task.board_id ? `${basePath}/board/${task.board_id}` : '#'}
                          className="hover:border-primary/30 flex items-center gap-3 rounded-lg border p-3 transition-colors hover:bg-accent"
                        >
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-medium">{task.title}</p>
                            <p className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-x-2 text-xs">
                              {task.board_title && <span className="truncate">{task.board_title}</span>}
                              <span>{getTaskStatusLabel(task)}</span>
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
          ))
        )}

        {/* Stated rather than silently omitted: a "Blocked" section that guessed would be
            trusted, and wrong once is enough to poison every other number on the page. */}
        <section aria-labelledby="my-work-gaps" className="text-muted-foreground rounded-lg border border-dashed p-4 text-xs">
          <h2 id="my-work-gaps" className="flex items-center gap-2 font-medium">
            <Info className="size-3.5" aria-hidden="true" />
            Not answered here yet
          </h2>
          <ul className="mt-2 space-y-1">
            {UNANSWERED_QUESTIONS.map((entry) => (
              <li key={entry.question}>
                {entry.question} — needs {entry.blockedBy}.
              </li>
            ))}
          </ul>
        </section>
      </div>
    </AppShell>
  )
}

function Stat({ label, value, tone = 'plain' }: { label: string; value: number; tone?: 'plain' | 'danger' }) {
  return (
    <div className="rounded-lg border p-3">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className={cn('mt-1 text-2xl font-semibold tabular-nums', tone === 'danger' && 'text-red-600 dark:text-red-400')}>
        {value}
      </dd>
    </div>
  )
}
