'use client'

// Strategy - Prompt H's optional layer, in one screen.
//
// FIVE TABS, EACH INDEPENDENT. Prompt H's own framing is that all of this is optional, so
// nothing here requires anything else here: a workspace can use Reviews and nothing else.
//
// ⚠️ THE ONE RULE THE WHOLE PAGE IS BUILT AROUND. Prompt H: "Display separately - execution
// progress and outcome progress. Never imply they are the same." There is no component in this
// directory that renders a single blended progress figure, and lib/goals.ts has no function
// that could produce one. A project can finish every task and still fail its outcome, and the
// number that averages the two is the one number guaranteed to be wrong.
//
// ⚠️ Everything below arrived through the caller's own session, so RLS already decided what is
// in these arrays. Nothing here re-implements visibility, and no empty list is treated as proof
// that something does not exist.

import { useCallback, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Compass } from 'lucide-react'

import { AppShell } from '@/components/shell/app-shell'
import { ErrorState } from '@/components/shell/states'
import { boardHref, buildWorkspaceNav } from '@/components/shell/workspace-nav'
import type { Role } from '@/components/shell/nav-model'
import type { SidebarNavGroup } from '@/components/shell/app-sidebar'
import { buildCreateCommands, type Command } from '@/components/shell/commands'
import { ThemeControls } from '@/components/theme/theme-controls'
import { HelpDialog } from '@/components/shell/help-dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useAppModules, isModuleEnabled } from '@/lib/modules'
import { useMarketingCalendars } from '@/lib/use-marketing-calendars'
import { useFavorites } from '@/lib/use-favorites'
import { allows } from '@/lib/capabilities'
import type { ShellData } from '@/lib/shell-data'
import type { CategorizedStatus } from '@/lib/task-status'
import type { GoalCheckinRow, GoalLinkRow, GoalRow, GoalTaskRow } from '@/lib/goals'
import type { IdeaEventRow, IdeaNoteRow, IdeaRow } from '@/lib/ideas'
import type { StrategyItemRow } from '@/lib/strategy'
import type { BoardPurposeRow } from '@/lib/strategy-data'
import { StrategyInfoButton } from './strategy-info'
import { GoalsPanel } from './goals-panel'
import { IdeasPanel } from './ideas-panel'
import { PurposePanel } from './purpose-panel'
import { SwotPanel } from './swot-panel'
import { RetroPanel } from './retro-panel'

export interface BoardOption {
  id: string
  title: string
  color?: string | null
  is_private?: boolean | null
}

export interface PersonRow {
  id: string
  full_name?: string | null
  email?: string | null
}

export interface ColumnRow {
  id: string
  board_id: string
  title: string
  status_key: string | null
  position: number
}

const TABS = ['goals', 'ideas', 'purpose', 'swot', 'reviews'] as const
type TabId = (typeof TABS)[number]

export default function StrategyWorkspace({
  user, boards, tasks, statuses, users, workItemTypes, columns, initial, shell, today, loadFailed,
}: {
  user: any
  boards: BoardOption[]
  tasks: (GoalTaskRow & { board_id: string | null })[]
  statuses: CategorizedStatus[]
  users: PersonRow[]
  workItemTypes: { key: string; name: string; is_active?: boolean | null }[]
  columns: ColumnRow[]
  initial: {
    goals: GoalRow[]
    links: GoalLinkRow[]
    checkins: GoalCheckinRow[]
    ideas: IdeaRow[]
    ideaEvents: IdeaEventRow[]
    ideaNotes: IdeaNoteRow[]
    canvas: StrategyItemRow[]
    purposes: BoardPurposeRow[]
  }
  shell?: ShellData
  today: string
  loadFailed?: boolean
}) {
  const router = useRouter()
  const searchParams = useSearchParams()

  const userId: string | null = user?.id ?? null
  // 'user' rather than 'member': that is the Role union the nav and capability model use, and
  // inventing a fourth name here would silently miss every `role === 'user'` branch.
  const role = (user?.role ?? 'user') as Role
  const isAdmin = role === 'admin' || role === 'super_admin'

  const modules = useAppModules(shell?.modules)
  const { calendars } = useMarketingCalendars(shell?.calendars)

  // ⚠️ boardHref is built from the viewer's PLATFORM ROLE, never from a surface flag: a
  // favourite stores the href it was created from, so getting this wrong pins an admin into
  // the stripped /dashboard board surface for as long as the star exists.
  const favoriteBoardHref = useCallback((id: string) => boardHref(role, id), [role])
  const { resolved: favoriteItems } = useFavorites(userId ?? '', { boardHref: favoriteBoardHref })

  const groups = useMemo<SidebarNavGroup[]>(
    () => buildWorkspaceNav({
      role, modules,
      canUseMarketingCalendar: isAdmin || calendars.length > 0,
      canViewAudit: allows({ userId: userId ?? '', platformRole: role }, 'audit.view'),
    }),
    [role, userId, modules, isAdmin, calendars.length],
  )

  const commands = useMemo<Command[]>(() => buildCreateCommands({ role, modules }), [role, modules])

  // The tab is in the URL so a link to "the goals page" is a link somebody can send. It is a
  // real route rather than `?tab=`, so an admin's /dashboard redirect cannot strip it.
  const urlTab = searchParams.get('view')
  const [tab, setTab] = useState<TabId>(
    TABS.includes(urlTab as TabId) ? (urlTab as TabId) : 'goals',
  )

  const chooseTab = useCallback((next: string) => {
    setTab(next as TabId)
    const params = new URLSearchParams(searchParams.toString())
    params.set('view', next)
    router.replace(`/strategy?${params.toString()}`, { scroll: false })
  }, [router, searchParams])

  const boardTitles = useMemo(
    () => new Map(boards.map((b) => [b.id, b.title])),
    [boards],
  )

  return (
    <AppShell
      user={{ id: userId ?? '', role, full_name: user?.full_name, email: user?.email }}
      groups={groups}
      activeId="strategy"
      breadcrumbs={[{ label: 'Strategy' }]}
      favorites={favoriteItems}
      commands={commands}
      topbarActions={<><ThemeControls /><HelpDialog /></>}
    >
      <div className="space-y-4 p-4 md:p-6">
        <header className="space-y-1">
          <div className="flex items-center gap-1">
            <h1 className="text-2xl font-semibold tracking-tight">Strategy</h1>
            <StrategyInfoButton />
          </div>
          <p className="text-muted-foreground text-sm">
            Why the work exists, what it is meant to change, and what you learned afterwards.
            All of it optional; none of it changes your boards.
          </p>
        </header>

        {loadFailed && (
          <ErrorState
            title="Some of this could not be loaded"
            description="The counts on this page are therefore incomplete. Reload before acting on them."
          />
        )}

        <Tabs value={tab} onValueChange={chooseTab}>
          {/* ⚠️ Scrolls inside its own container. Radix's TabsList is w-fit and does not wrap,
              so a fixed strip whose length is a function of how many things exist pushes the
              whole page sideways at 320px - the defect the board header nav hit twice and
              /agile hit once. */}
          <div className="max-w-full overflow-x-auto">
            <TabsList id="strategy-tabs">
              <TabsTrigger value="goals" id="strategy-tab-goals">Goals</TabsTrigger>
              <TabsTrigger value="ideas" id="strategy-tab-ideas">Ideas</TabsTrigger>
              <TabsTrigger value="purpose" id="strategy-tab-purpose">Purpose</TabsTrigger>
              <TabsTrigger value="swot" id="strategy-tab-swot">SWOT</TabsTrigger>
              <TabsTrigger value="reviews" id="strategy-tab-reviews">Reviews</TabsTrigger>
            </TabsList>
          </div>

          <TabsContent value="goals" className="mt-4">
            <GoalsPanel
              userId={userId}
              isAdmin={isAdmin}
              goals={initial.goals}
              links={initial.links}
              checkins={initial.checkins}
              tasks={tasks}
              statuses={statuses}
              users={users}
              boards={boards}
              boardTitles={boardTitles}
              today={today}
            />
          </TabsContent>

          <TabsContent value="ideas" className="mt-4">
            <IdeasPanel
              userId={userId}
              isAdmin={isAdmin}
              ideas={initial.ideas}
              events={initial.ideaEvents}
              notes={initial.ideaNotes}
              users={users}
              boards={boards}
              columns={columns}
              statuses={statuses}
              workItemTypes={workItemTypes}
              boardTitles={boardTitles}
            />
          </TabsContent>

          <TabsContent value="purpose" className="mt-4">
            <PurposePanel
              userId={userId}
              isAdmin={isAdmin}
              boards={boards}
              purposes={initial.purposes}
            />
          </TabsContent>

          <TabsContent value="swot" className="mt-4">
            <SwotPanel
              userId={userId}
              isAdmin={isAdmin}
              items={initial.canvas}
              boards={boards}
            />
          </TabsContent>

          <TabsContent value="reviews" className="mt-4">
            <RetroPanel
              userId={userId}
              isAdmin={isAdmin}
              boards={boards}
              users={users}
              columns={columns}
              statuses={statuses}
              today={today}
            />
          </TabsContent>
        </Tabs>

        {boards.length === 0 && tab !== 'goals' && tab !== 'ideas' && (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <Compass className="h-4 w-4" aria-hidden="true" />
            This part needs a board you can see. Goals and Ideas work without one.
          </p>
        )}
      </div>
    </AppShell>
  )
}
