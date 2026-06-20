'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  Megaphone,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'

type MarketingSection = 'SRG' | 'AGC' | 'BOTH'
type SectionFilter = MarketingSection | 'ALL'

interface MarketingCalendarItem {
  id: string
  date: string
  day_label: string
  section: MarketingSection
  channel: string
  content: string
  is_highlighted: boolean
  position: number
}

interface MarketingCalendarCheck {
  id: string
  item_id: string
  checked_at: string
}

interface MarketingCalendarProps {
  userId: string
  userName?: string
  isAdmin?: boolean
}

interface MarketingProfile {
  id: string
  full_name: string | null
  email: string | null
}

const KAYLA_EMAIL = 'kayla@goatlasgo.us'

const CHANNELS: Array<{ section: MarketingSection; channel: string; label: string }> = [
  { section: 'SRG', channel: 'FB - Bobby', label: 'FB Bobby' },
  { section: 'SRG', channel: 'FB - SRG', label: 'FB SRG' },
  { section: 'SRG', channel: 'IG - Bobby', label: 'IG Bobby' },
  { section: 'SRG', channel: 'TT - Bobby', label: 'TT Bobby' },
  { section: 'SRG', channel: 'BLOG', label: 'Blog' },
  { section: 'SRG', channel: 'BREVO Email', label: 'Brevo' },
  { section: 'SRG', channel: 'Eagles', label: 'Eagles' },
  { section: 'BOTH', channel: 'PR Events', label: 'PR Events' },
  { section: 'AGC', channel: 'FB - AGC', label: 'FB AGC' },
  { section: 'AGC', channel: 'IG - AGC', label: 'IG AGC' },
  { section: 'AGC', channel: 'TT - AGC', label: 'TT AGC' },
  { section: 'AGC', channel: 'Advertising', label: 'Ads' },
  { section: 'AGC', channel: 'BLOG', label: 'Blog' },
  { section: 'AGC', channel: 'BREVO Email', label: 'Brevo' },
  { section: 'AGC', channel: 'OTHER', label: 'Other' },
]

const FILTERS: SectionFilter[] = ['ALL', 'SRG', 'AGC', 'BOTH']

const SECTION_STYLES: Record<MarketingSection, { header: string; chip: string; border: string }> = {
  SRG: {
    header: 'bg-[#f01515] text-[#fff842]',
    chip: 'border-[#f01515]/30 bg-[#fff5f5] text-[#b50d0d]',
    border: 'border-l-[#f01515]',
  },
  AGC: {
    header: 'bg-[#ff1818] text-[#fff842]',
    chip: 'border-[#ff1818]/30 bg-[#fff7ed] text-[#b42318]',
    border: 'border-l-[#ff1818]',
  },
  BOTH: {
    header: 'bg-[#28d846] text-[#041307]',
    chip: 'border-[#28d846]/40 bg-[#effff1] text-[#126523]',
    border: 'border-l-[#28d846]',
  },
}

const dateFormatter = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const fullDateFormatter = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
})

function parseDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
}

function startOfWeek(date: Date) {
  const next = new Date(date)
  next.setHours(0, 0, 0, 0)
  const mondayOffset = (next.getDay() + 6) % 7
  next.setDate(next.getDate() - mondayOffset)
  return next
}

function addDays(date: Date, days: number) {
  const next = new Date(date)
  next.setDate(next.getDate() + days)
  return next
}

function itemKey(date: string, section: MarketingSection, channel: string) {
  return `${date}::${section}::${channel}`
}

function sectionTitle(section: SectionFilter) {
  if (section === 'ALL') return 'All'
  return section
}

export default function MarketingCalendar({ userId, userName, isAdmin = false }: MarketingCalendarProps) {
  const supabase = createClient()
  const [items, setItems] = useState<MarketingCalendarItem[]>([])
  const [checkedByItem, setCheckedByItem] = useState<Map<string, MarketingCalendarCheck>>(new Map())
  const [checkUserId, setCheckUserId] = useState(userId)
  const [checkUserName, setCheckUserName] = useState(userName)
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>('ALL')
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [loading, setLoading] = useState(true)
  const [busyItemId, setBusyItemId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const loadCalendar = useCallback(async () => {
    setLoading(true)
    setError(null)

    let targetUserId = userId
    let targetUserName = userName

    if (isAdmin) {
      const { data: kaylaProfile, error: profileError } = await supabase
        .from('profiles')
        .select('id,full_name,email')
        .ilike('email', KAYLA_EMAIL)
        .maybeSingle()

      if (profileError || !kaylaProfile) {
        setItems([])
        setCheckedByItem(new Map())
        setLoading(false)
        setError('Kayla profile is not ready yet.')
        return
      }

      const profile = kaylaProfile as MarketingProfile
      targetUserId = profile.id
      targetUserName = profile.full_name || profile.email || userName
    }

    setCheckUserId(targetUserId)
    setCheckUserName(targetUserName)

    const [{ data: itemRows, error: itemsError }, { data: checkRows, error: checksError }] = await Promise.all([
      supabase
        .from('marketing_calendar_items')
        .select('id,date,day_label,section,channel,content,is_highlighted,position')
        .order('date', { ascending: true })
        .order('position', { ascending: true }),
      supabase
        .from('marketing_calendar_checks')
        .select('id,item_id,checked_at')
        .eq('user_id', targetUserId),
    ])

    setLoading(false)

    if (itemsError || checksError) {
      setError('Marketing calendar is not ready yet.')
      return
    }

    setItems((itemRows ?? []) as MarketingCalendarItem[])
    setCheckedByItem(new Map(((checkRows ?? []) as MarketingCalendarCheck[]).map((check) => [check.item_id, check])))
  }, [isAdmin, supabase, userId, userName])

  useEffect(() => {
    loadCalendar()
  }, [loadCalendar])

  const visibleChannels = useMemo(() => {
    return CHANNELS.filter((channel) => sectionFilter === 'ALL' || channel.section === sectionFilter)
  }, [sectionFilter])

  const visibleItems = useMemo(() => {
    return items.filter((item) => sectionFilter === 'ALL' || item.section === sectionFilter)
  }, [items, sectionFilter])

  const weekDays = useMemo(() => {
    return Array.from({ length: 7 }, (_, index) => addDays(weekStart, index))
  }, [weekStart])

  const weekKeys = useMemo(() => new Set(weekDays.map(toDateKey)), [weekDays])

  const itemsByDateChannel = useMemo(() => {
    const next = new Map<string, MarketingCalendarItem>()
    for (const item of visibleItems) {
      if (weekKeys.has(item.date)) {
        next.set(itemKey(item.date, item.section, item.channel), item)
      }
    }
    return next
  }, [visibleItems, weekKeys])

  const groups = useMemo(() => {
    return (['SRG', 'BOTH', 'AGC'] as MarketingSection[])
      .map((section) => ({
        section,
        channels: visibleChannels.filter((channel) => channel.section === section),
      }))
      .filter((group) => group.channels.length > 0)
  }, [visibleChannels])

  const totalVisible = visibleItems.length
  const checkedVisible = visibleItems.filter((item) => checkedByItem.has(item.id)).length
  const weekItems = visibleItems.filter((item) => weekKeys.has(item.date))
  const checkedWeek = weekItems.filter((item) => checkedByItem.has(item.id)).length
  const highlightedItems = visibleItems.filter((item) => item.is_highlighted)
  const highlightedDone = highlightedItems.filter((item) => checkedByItem.has(item.id)).length
  const completionPercent = totalVisible ? Math.round((checkedVisible / totalVisible) * 100) : 0

  const weekLabel = `${dateFormatter.format(weekDays[0])} - ${dateFormatter.format(weekDays[6])}`
  const todayKey = toDateKey(new Date())

  const toggleItem = async (item: MarketingCalendarItem) => {
    if (busyItemId) return

    const existing = checkedByItem.get(item.id)
    const previous = new Map(checkedByItem)
    setBusyItemId(item.id)

    if (existing) {
      setCheckedByItem((current) => {
        const next = new Map(current)
        next.delete(item.id)
        return next
      })

      const { error: deleteError } = await supabase
        .from('marketing_calendar_checks')
        .delete()
        .eq('item_id', item.id)
        .eq('user_id', checkUserId)

      if (deleteError) {
        setCheckedByItem(previous)
        setError('Could not update this check.')
      }
    } else {
      const optimisticCheck = {
        id: `optimistic-${item.id}`,
        item_id: item.id,
        checked_at: new Date().toISOString(),
      }
      setCheckedByItem((current) => new Map(current).set(item.id, optimisticCheck))

      const { data, error: upsertError } = await supabase
        .from('marketing_calendar_checks')
        .upsert(
          { item_id: item.id, user_id: checkUserId },
          { onConflict: 'item_id,user_id' }
        )
        .select('id,item_id,checked_at')
        .single()

      if (upsertError || !data) {
        setCheckedByItem(previous)
        setError('Could not update this check.')
      } else {
        setCheckedByItem((current) => new Map(current).set(item.id, data as MarketingCalendarCheck))
      }
    }

    setBusyItemId(null)
  }

  const resetToToday = () => setWeekStart(startOfWeek(new Date()))

  if (loading) {
    return (
      <section className="rounded-lg border bg-background">
        <div className="flex items-center gap-3 p-6">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Loading marketing calendar</span>
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-background shadow-sm">
      <div className="bg-[#070707] px-4 py-4 text-white sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-normal text-[#fff842]">
              <CalendarDays className="h-4 w-4" />
              2026 Calendar
            </div>
            <h2 className="mt-1 break-words text-2xl font-bold tracking-normal sm:text-3xl">
              {checkUserName ? `${checkUserName.split(' ')[0]}'s Posting Board` : 'Posting Board'}
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <div className="text-xl font-semibold">{completionPercent}%</div>
              <div className="text-xs text-white/70">Posted</div>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <div className="text-xl font-semibold">{checkedWeek}/{weekItems.length}</div>
              <div className="text-xs text-white/70">This week</div>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <div className="text-xl font-semibold">{highlightedDone}/{highlightedItems.length}</div>
              <div className="text-xs text-white/70">Blocks</div>
            </div>
          </div>
        </div>
      </div>

      <div className="border-b bg-[#fbfbfb] px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, -7))} aria-label="Previous week">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[168px] rounded-md border bg-background px-3 py-2 text-center text-sm font-semibold">
              {weekLabel}
            </div>
            <Button variant="outline" size="icon" onClick={() => setWeekStart(addDays(weekStart, 7))} aria-label="Next week">
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={resetToToday}>
              Today
            </Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((filter) => (
              <Button
                key={filter}
                type="button"
                size="sm"
                variant={sectionFilter === filter ? 'default' : 'outline'}
                onClick={() => setSectionFilter(filter)}
                className="min-w-14"
              >
                {sectionTitle(filter)}
              </Button>
            ))}
            <Button variant="outline" size="icon" onClick={loadCalendar} aria-label="Refresh calendar">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {items.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">Marketing calendar is empty.</div>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1120px] border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-30 w-[142px] border-b border-r bg-[#111] px-3 py-2 text-left text-xs font-bold uppercase text-white" rowSpan={2}>
                    Date
                  </th>
                  {groups.map((group) => (
                    <th
                      key={group.section}
                      colSpan={group.channels.length}
                      className={cn('border-b border-r px-3 py-2 text-center text-lg font-black tracking-normal', SECTION_STYLES[group.section].header)}
                    >
                      {group.section}
                    </th>
                  ))}
                </tr>
                <tr>
                  {visibleChannels.map((channel) => (
                    <th key={`${channel.section}-${channel.channel}`} className="w-[128px] border-b border-r bg-[#151515] px-2 py-2 text-center text-xs font-semibold text-white">
                      {channel.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekDays.map((date) => {
                  const dateKey = toDateKey(date)
                  const dayItems = weekItems.filter((item) => item.date === dateKey)
                  const dayDone = dayItems.filter((item) => checkedByItem.has(item.id)).length
                  const isToday = dateKey === todayKey

                  return (
                    <tr key={dateKey} className={cn('align-top', isToday && 'bg-[#fffef0]')}>
                      <td className="sticky left-0 z-20 border-b border-r bg-background px-3 py-3">
                        <div className="flex items-start gap-2">
                          <div className={cn('mt-1 h-2.5 w-2.5 rounded-full', isToday ? 'bg-[#28d846]' : 'bg-[#d1d5db]')} />
                          <div>
                            <div className="font-bold">{fullDateFormatter.format(date)}</div>
                            <div className="text-xs text-muted-foreground">{dayDone}/{dayItems.length} posted</div>
                          </div>
                        </div>
                      </td>
                      {visibleChannels.map((channel) => {
                        const item = itemsByDateChannel.get(itemKey(dateKey, channel.section, channel.channel))
                        const checked = item ? checkedByItem.has(item.id) : false
                        const busy = item?.id === busyItemId

                        return (
                          <td key={`${dateKey}-${channel.channel}`} className="h-[96px] border-b border-r bg-background p-1.5">
                            {item ? (
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => toggleItem(item)}
                                className={cn(
                                  'flex h-full min-h-[78px] w-full flex-col justify-between rounded-md border-l-4 p-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                  SECTION_STYLES[item.section].border,
                                  item.is_highlighted ? 'border-y-[#28d846]/60 border-r-[#28d846]/60 bg-[#ebffed]' : 'border-y-border border-r-border bg-white hover:bg-accent',
                                  checked && 'border-l-[#111] bg-[#f3f4f6] text-muted-foreground'
                                )}
                              >
                                <span className="flex items-center justify-between gap-2">
                                  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold', checked ? 'bg-[#111] text-white' : 'bg-background text-foreground')}>
                                    {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : checked ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                                    {checked ? 'Posted' : 'Open'}
                                  </span>
                                  {item.is_highlighted && <Sparkles className="h-3.5 w-3.5 text-[#128224]" />}
                                </span>
                                <span className={cn('mt-2 line-clamp-3 break-words text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]', checked && 'line-through decoration-2')}>
                                  {item.content}
                                </span>
                              </button>
                            ) : (
                              <div className="h-full min-h-[78px] rounded-md border border-dashed bg-[#fafafa]" />
                            )}
                          </td>
                        )
                      })}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="border-t bg-[#fbfbfb] px-4 py-5 sm:px-6">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-semibold">
                <Megaphone className="h-4 w-4" />
                Campaign blocks
              </div>
              <Badge variant="outline" className="gap-1">
                <BadgeCheck className="h-3 w-3" />
                {highlightedDone}/{highlightedItems.length}
              </Badge>
            </div>

            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {highlightedItems.slice(0, 12).map((item) => {
                const checked = checkedByItem.has(item.id)
                return (
                  <button
                    key={item.id}
                    type="button"
                    disabled={busyItemId === item.id}
                    onClick={() => toggleItem(item)}
                    className={cn(
                      'flex min-h-[74px] items-start gap-3 rounded-md border bg-background p-3 text-left transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                      checked && 'bg-[#f3f4f6] text-muted-foreground'
                    )}
                  >
                    <span className={cn('mt-0.5 rounded-full', checked ? 'text-[#111]' : 'text-[#128224]')}>
                      {busyItemId === item.id ? <Loader2 className="h-5 w-5 animate-spin" /> : checked ? <CheckCircle2 className="h-5 w-5" /> : <Circle className="h-5 w-5" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className={SECTION_STYLES[item.section].chip}>
                          {item.section}
                        </Badge>
                        <span className="text-xs font-medium text-muted-foreground">{dateFormatter.format(parseDate(item.date))}</span>
                        <span className="text-xs font-medium text-muted-foreground">{item.channel}</span>
                      </span>
                      <span className={cn('mt-1 block break-words text-sm font-semibold [overflow-wrap:anywhere]', checked && 'line-through decoration-2')}>
                        {item.content}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        </>
      )}
    </section>
  )
}
