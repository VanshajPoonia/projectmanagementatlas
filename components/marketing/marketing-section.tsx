'use client'

import { useState } from 'react'
import { CalendarDays, FolderOpen, Share2 } from 'lucide-react'

import MarketingCalendar from '@/components/marketing/marketing-calendar'
import MarketingProjects from '@/components/marketing/marketing-projects'
import SocialBoardLoader from '@/components/social/social-board-loader'
import { cn } from '@/lib/utils'

type Section = 'calendar' | 'social' | 'projects'

type CalendarProps = React.ComponentProps<typeof MarketingCalendar>

/**
 * The Marketing tab: the calendar, with Social media and Projects as buttons next to it.
 * Each button swaps the content below. The calendar stays mounted so its place and filters
 * are still there when you come back.
 */
export default function MarketingSection({ showSocial, ...calendar }: CalendarProps & { showSocial: boolean }) {
  const [section, setSection] = useState<Section>('calendar')
  const buttons: Array<{ key: Section; label: string; Icon: typeof CalendarDays }> = [
    { key: 'calendar', label: 'Calendar', Icon: CalendarDays },
    ...(showSocial ? [{ key: 'social' as const, label: 'Social media', Icon: Share2 }] : []),
    { key: 'projects', label: 'Projects', Icon: FolderOpen },
  ]
  // The social button can vanish when an admin switches the module off while this is open.
  const current = section === 'social' && !showSocial ? 'calendar' : section

  return (
    <div className="space-y-4">
      <div className="grid grid-flow-col auto-cols-fr overflow-hidden rounded-md border sm:inline-grid" role="group" aria-label="Marketing sections">
        {buttons.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setSection(key)}
            aria-pressed={current === key}
            className={cn(
              'flex min-h-11 items-center justify-center gap-1.5 px-3 py-2 text-sm font-semibold whitespace-nowrap transition-colors sm:px-4',
              current === key ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
            {label}
          </button>
        ))}
      </div>

      <div hidden={current !== 'calendar'}>
        <MarketingCalendar {...calendar} />
      </div>
      {current === 'social' && (
        <section className="bg-background rounded-lg border p-4 shadow-sm sm:p-6">
          <SocialBoardLoader userId={calendar.userId} />
        </section>
      )}
      {current === 'projects' && (
        <section className="bg-background rounded-lg border p-4 shadow-sm sm:p-6">
          <MarketingProjects userId={calendar.userId} />
        </section>
      )}
    </div>
  )
}
