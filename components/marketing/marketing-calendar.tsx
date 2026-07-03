'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Loader2,
  Megaphone,
  Palette,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

type MarketingSection = 'SRG' | 'AGC' | 'BOTH'
type SectionFilter = MarketingSection | 'ALL'
type RecurrencePattern = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly'

interface MarketingCalendarItem {
  id: string
  date: string
  day_label: string
  section: MarketingSection
  channel: string
  content: string
  is_highlighted: boolean
  position: number
  source_sheet?: string | null
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

interface SectionColor {
  headerBg: string
  headerText: string
}

const KAYLA_EMAIL = 'kayla@goatlasgo.us'
const LS_COLORS_KEY = 'marketing_calendar_colors_v2'

const DEFAULT_SECTION_COLORS: Record<MarketingSection, SectionColor> = {
  SRG:  { headerBg: '#e91e8c', headerText: '#ffffff' },
  AGC:  { headerBg: '#7c3aed', headerText: '#ffffff' },
  BOTH: { headerBg: '#0891b2', headerText: '#ffffff' },
}

const CHANNELS: Array<{ section: MarketingSection; channel: string; label: string }> = [
  { section: 'SRG',  channel: 'FB - Bobby',   label: 'FB Bobby' },
  { section: 'SRG',  channel: 'FB - SRG',     label: 'FB SRG'   },
  { section: 'SRG',  channel: 'IG - Bobby',   label: 'IG Bobby' },
  { section: 'SRG',  channel: 'TT - Bobby',   label: 'TT Bobby' },
  { section: 'SRG',  channel: 'BLOG',         label: 'Blog'     },
  { section: 'SRG',  channel: 'BREVO Email',  label: 'Brevo'    },
  { section: 'SRG',  channel: 'Eagles',       label: 'Eagles'   },
  { section: 'BOTH', channel: 'PR Events',    label: 'PR Events'},
  { section: 'AGC',  channel: 'FB - AGC',     label: 'FB AGC'   },
  { section: 'AGC',  channel: 'IG - AGC',     label: 'IG AGC'   },
  { section: 'AGC',  channel: 'TT - AGC',     label: 'TT AGC'   },
  { section: 'AGC',  channel: 'Advertising',  label: 'Ads'      },
  { section: 'AGC',  channel: 'BLOG',         label: 'Blog'     },
  { section: 'AGC',  channel: 'BREVO Email',  label: 'Brevo'    },
  { section: 'AGC',  channel: 'OTHER',        label: 'Other'    },
]

const FILTERS: SectionFilter[] = ['ALL', 'SRG', 'AGC', 'BOTH']

const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  none:      'No repeat',
  daily:     'Daily',
  weekly:    'Weekly',
  biweekly:  'Every 2 weeks',
  monthly:   'Monthly',
}

/* ─── colour helpers ──────────────────────────────────────────────────── */

function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}
function luminance({ r, g, b }: { r: number; g: number; b: number }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function autoText(hex: string) {
  return luminance(hexToRgb(hex)) > 160 ? '#111111' : '#ffffff'
}
function withAlpha(hex: string, a: number) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

function loadColors(): Record<MarketingSection, SectionColor> {
  if (typeof window === 'undefined') return DEFAULT_SECTION_COLORS
  try {
    const raw = localStorage.getItem(LS_COLORS_KEY)
    if (raw) return { ...DEFAULT_SECTION_COLORS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return DEFAULT_SECTION_COLORS
}

/* ─── date utilities ──────────────────────────────────────────────────── */

const dateFormatter     = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const fullDateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

function parseDate(date: string) {
  const [year, month, day] = date.split('-').map(Number)
  return new Date(year, month - 1, day)
}
function toDateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
function toInputDate(date: Date) { return toDateKey(date) }

function startOfWeek(date: Date) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}
function addDays(date: Date, days: number) {
  const d = new Date(date); d.setDate(d.getDate() + days); return d
}
function addMonths(date: Date, months: number) {
  const d = new Date(date); d.setMonth(d.getMonth() + months); return d
}

function itemKey(date: string, section: MarketingSection, channel: string) {
  return `${date}::${section}::${channel}`
}

/* ─── generate recurrence dates ─────────────────────────────────────── */

function generateDates(start: Date, pattern: RecurrencePattern, endDate: Date): Date[] {
  if (pattern === 'none') return [start]
  const dates: Date[] = []
  let cur = new Date(start)
  const limit = new Date(endDate)
  while (cur <= limit && dates.length < 104) {
    dates.push(new Date(cur))
    if (pattern === 'daily')    cur = addDays(cur, 1)
    if (pattern === 'weekly')   cur = addDays(cur, 7)
    if (pattern === 'biweekly') cur = addDays(cur, 14)
    if (pattern === 'monthly')  cur = addMonths(cur, 1)
  }
  return dates
}

/* ─── component ──────────────────────────────────────────────────────── */

export default function MarketingCalendar({ userId, userName, isAdmin = false }: MarketingCalendarProps) {
  const supabase = createClient()
  const [items,         setItems]         = useState<MarketingCalendarItem[]>([])
  const [checkedByItem, setCheckedByItem] = useState<Map<string, MarketingCalendarCheck>>(new Map())
  const [checkUserId,   setCheckUserId]   = useState(userId)
  const [checkUserName, setCheckUserName] = useState(userName)
  const [kaylaId,       setKaylaId]       = useState<string | null>(null)
  const [sectionFilter, setSectionFilter] = useState<SectionFilter>('ALL')
  const [weekStart,     setWeekStart]     = useState(() => startOfWeek(new Date()))
  const [loading,       setLoading]       = useState(true)
  const [busyItemId,    setBusyItemId]    = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)

  // Color customisation (localStorage)
  const [sectionColors, setSectionColorsState] = useState<Record<MarketingSection, SectionColor>>(loadColors)
  const [colorPickerOpen, setColorPickerOpen]  = useState(false)

  const saveSectionColors = (next: Record<MarketingSection, SectionColor>) => {
    setSectionColorsState(next)
    try { localStorage.setItem(LS_COLORS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  // Create-event dialog
  const [createOpen,      setCreateOpen]      = useState(false)
  const [newDate,         setNewDate]         = useState(toInputDate(new Date()))
  const [newSection,      setNewSection]      = useState<MarketingSection>('SRG')
  const [newChannel,      setNewChannel]      = useState(CHANNELS[0].channel)
  const [newContent,      setNewContent]      = useState('')
  const [newHighlighted,  setNewHighlighted]  = useState(false)
  const [newRecurrence,   setNewRecurrence]   = useState<RecurrencePattern>('none')
  const [newEndDate,      setNewEndDate]      = useState(toInputDate(addDays(new Date(), 28)))
  const [creating,        setCreating]        = useState(false)

  // Agenda "show past" toggle
  const [showPast, setShowPast] = useState(false)

  const loadCalendar = useCallback(async () => {
    setLoading(true)
    setError(null)
    let targetUserId = userId
    let targetUserName = userName

    if (isAdmin) {
      const { data: kaylaProfile, error: profileError } = await supabase
        .from('profiles').select('id,full_name,email').ilike('email', KAYLA_EMAIL).maybeSingle()
      if (profileError || !kaylaProfile) {
        setItems([]); setCheckedByItem(new Map()); setLoading(false)
        setError('Kayla profile is not ready yet.'); return
      }
      const p = kaylaProfile as MarketingProfile
      targetUserId   = p.id
      targetUserName = p.full_name || p.email || userName
      setKaylaId(p.id)
    } else {
      setKaylaId(userId)
    }

    setCheckUserId(targetUserId)
    setCheckUserName(targetUserName)

    const [{ data: itemRows, error: itemsError }, { data: checkRows, error: checksError }] = await Promise.all([
      supabase.from('marketing_calendar_items')
        .select('id,date,day_label,section,channel,content,is_highlighted,position,source_sheet')
        .eq('assigned_to', targetUserId)
        .order('date', { ascending: true })
        .order('position', { ascending: true }),
      supabase.from('marketing_calendar_checks')
        .select('id,item_id,checked_at').eq('user_id', targetUserId),
    ])

    setLoading(false)
    if (itemsError || checksError) { setError('Marketing calendar is not ready yet.'); return }
    setItems((itemRows ?? []) as MarketingCalendarItem[])
    setCheckedByItem(new Map(((checkRows ?? []) as MarketingCalendarCheck[]).map(c => [c.item_id, c])))
  }, [isAdmin, supabase, userId, userName])

  useEffect(() => { loadCalendar() }, [loadCalendar])

  // Sync channel list when section changes in create dialog
  useEffect(() => {
    const channelsForSection = CHANNELS.filter(c => c.section === newSection)
    if (channelsForSection.length) setNewChannel(channelsForSection[0].channel)
  }, [newSection])

  /* ── computed views ─────────────────────────────────────────────── */

  const visibleChannels = useMemo(() =>
    CHANNELS.filter(c => sectionFilter === 'ALL' || c.section === sectionFilter),
  [sectionFilter])

  const visibleItems = useMemo(() =>
    items.filter(i => sectionFilter === 'ALL' || i.section === sectionFilter),
  [items, sectionFilter])

  const weekDays    = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const weekKeys    = useMemo(() => new Set(weekDays.map(toDateKey)), [weekDays])
  const weekItems   = visibleItems.filter(i => weekKeys.has(i.date))

  const itemsByDateChannel = useMemo(() => {
    const m = new Map<string, MarketingCalendarItem>()
    for (const item of visibleItems) {
      if (weekKeys.has(item.date)) m.set(itemKey(item.date, item.section, item.channel), item)
    }
    return m
  }, [visibleItems, weekKeys])

  const groups = useMemo(() =>
    (['SRG', 'BOTH', 'AGC'] as MarketingSection[])
      .map(s => ({ section: s, channels: visibleChannels.filter(c => c.section === s) }))
      .filter(g => g.channels.length > 0),
  [visibleChannels])

  const totalVisible = visibleItems.length
  const checkedVisible = visibleItems.filter(i => checkedByItem.has(i.id)).length
  const checkedWeek = weekItems.filter(i => checkedByItem.has(i.id)).length
  const completionPercent = totalVisible ? Math.round((checkedVisible / totalVisible) * 100) : 0

  const weekLabel = `${dateFormatter.format(weekDays[0])} – ${dateFormatter.format(weekDays[6])}`
  const todayKey  = toDateKey(new Date())

  /* ── agenda items (bottom panel) ────────────────────────────────── */
  const agendaItems = useMemo(() => {
    const today = toDateKey(new Date())
    return visibleItems
      .filter(i => showPast || i.date >= today)
      .sort((a, b) => a.date.localeCompare(b.date) || a.position - b.position)
      .slice(0, 60)
  }, [visibleItems, showPast])

  const agendaByDate = useMemo(() => {
    const m = new Map<string, MarketingCalendarItem[]>()
    for (const item of agendaItems) {
      const arr = m.get(item.date) ?? []
      arr.push(item)
      m.set(item.date, arr)
    }
    return m
  }, [agendaItems])

  /* ── toggle check ───────────────────────────────────────────────── */
  const toggleItem = async (item: MarketingCalendarItem) => {
    if (busyItemId) return
    const existing = checkedByItem.get(item.id)
    const previous = new Map(checkedByItem)
    setBusyItemId(item.id)

    if (existing) {
      setCheckedByItem(cur => { const n = new Map(cur); n.delete(item.id); return n })
      const { error: e } = await supabase.from('marketing_calendar_checks')
        .delete().eq('item_id', item.id).eq('user_id', checkUserId)
      if (e) { setCheckedByItem(previous); setError('Could not update this check.') }
    } else {
      setCheckedByItem(cur => new Map(cur).set(item.id, { id: `opt-${item.id}`, item_id: item.id, checked_at: new Date().toISOString() }))
      const { data, error: e } = await supabase.from('marketing_calendar_checks')
        .upsert({ item_id: item.id, user_id: checkUserId }, { onConflict: 'item_id,user_id' })
        .select('id,item_id,checked_at').single()
      if (e || !data) { setCheckedByItem(previous); setError('Could not update this check.') }
      else setCheckedByItem(cur => new Map(cur).set(item.id, data as MarketingCalendarCheck))
    }
    setBusyItemId(null)
  }

  /* ── create event ───────────────────────────────────────────────── */
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newContent.trim() || !kaylaId) return
    setCreating(true)

    const startDate = parseDate(newDate)
    const endDate   = newRecurrence === 'none' ? startDate : parseDate(newEndDate)
    const dates     = generateDates(startDate, newRecurrence, endDate)

    const rows = dates.map((d, i) => ({
      assigned_to:    kaylaId,
      date:           toDateKey(d),
      day_label:      ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()],
      section:        newSection,
      channel:        newChannel,
      content:        newContent.trim(),
      is_highlighted: newHighlighted,
      position:       i,
      source_sheet:   null,
      source_row:     null,
      source_column:  null,
    }))

    const { error: insertErr } = await supabase.from('marketing_calendar_items').insert(rows)
    setCreating(false)

    if (insertErr) {
      toast.error('Could not create event', { description: insertErr.message })
    } else {
      toast.success(`Created ${rows.length} event${rows.length > 1 ? 's' : ''}`)
      setCreateOpen(false)
      setNewContent('')
      setNewHighlighted(false)
      setNewRecurrence('none')
      loadCalendar()
    }
  }

  /* ── delete user-created item ──────────────────────────────────── */
  const handleDeleteItem = async (item: MarketingCalendarItem) => {
    if (item.source_sheet !== null && item.source_sheet !== undefined) {
      toast.error('Imported events cannot be deleted from here')
      return
    }
    const { error: e } = await supabase.from('marketing_calendar_items').delete().eq('id', item.id)
    if (e) { toast.error('Could not delete event', { description: e.message }); return }
    setItems(prev => prev.filter(x => x.id !== item.id))
    toast.success('Event deleted')
  }

  const resetToToday = () => setWeekStart(startOfWeek(new Date()))

  /* ── section style helpers ──────────────────────────────────────── */
  const sectionStyle = useCallback((section: MarketingSection) => {
    const c = sectionColors[section]
    return {
      header:  { backgroundColor: c.headerBg, color: autoText(c.headerBg) },
      chipStyle: { borderColor: withAlpha(c.headerBg, 0.5), backgroundColor: withAlpha(c.headerBg, 0.08), color: c.headerBg },
      borderLeft: c.headerBg,
    }
  }, [sectionColors])

  /* ── loading ────────────────────────────────────────────────────── */
  if (loading) {
    return (
      <section className="rounded-lg border bg-background">
        <div className="flex items-center gap-3 p-6">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Loading marketing calendar…</span>
        </div>
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-background shadow-sm">

      {/* ── Header ──────────────────────────────────────────────────── */}
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
              <div className="text-xl font-semibold">{checkedVisible}/{totalVisible}</div>
              <div className="text-xs text-white/70">All time</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Controls ─────────────────────────────────────────────────── */}
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
            <Button variant="outline" size="sm" onClick={resetToToday}>Today</Button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map(f => (
              <Button key={f} type="button" size="sm" variant={sectionFilter === f ? 'default' : 'outline'}
                onClick={() => setSectionFilter(f)} className="min-w-14">
                {f === 'ALL' ? 'All' : f}
              </Button>
            ))}
            <Button variant="outline" size="icon" onClick={loadCalendar} aria-label="Refresh calendar">
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Color picker */}
            <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Customise section colours">
                  <Palette className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="w-72 p-4 space-y-4">
                <p className="text-sm font-semibold">Section colours</p>
                {(['SRG', 'AGC', 'BOTH'] as MarketingSection[]).map(s => (
                  <div key={s} className="flex items-center justify-between gap-3">
                    <span className="text-sm font-medium w-10">{s}</span>
                    <div className="flex items-center gap-2 flex-1">
                      <label className="text-xs text-muted-foreground flex-1">Header</label>
                      <input
                        type="color"
                        value={sectionColors[s].headerBg}
                        onChange={ev => {
                          const next = { ...sectionColors, [s]: { headerBg: ev.target.value, headerText: autoText(ev.target.value) } }
                          saveSectionColors(next)
                        }}
                        className="h-8 w-14 cursor-pointer rounded border p-0.5"
                      />
                      <div className="h-8 w-8 rounded flex items-center justify-center text-[10px] font-bold"
                        style={{ backgroundColor: sectionColors[s].headerBg, color: autoText(sectionColors[s].headerBg) }}>
                        {s}
                      </div>
                    </div>
                  </div>
                ))}
                <Button size="sm" variant="outline" className="w-full" onClick={() => saveSectionColors(DEFAULT_SECTION_COLORS)}>
                  Reset to defaults
                </Button>
              </PopoverContent>
            </Popover>

            {/* New event */}
            <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New event
            </Button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {items.length === 0 ? (
        <div className="p-6 text-sm text-muted-foreground">Marketing calendar is empty. Add an event to get started.</div>
      ) : (
        <>
          {/* ── Grid table ───────────────────────────────────────────── */}
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 z-30 w-[142px] border-b border-r bg-[#111] px-3 py-2 text-left text-xs font-bold uppercase text-white" rowSpan={2}>
                    Date
                  </th>
                  {groups.map(group => (
                    <th key={group.section} colSpan={group.channels.length}
                      className="border-b border-r px-3 py-2 text-center text-lg font-black tracking-normal"
                      style={sectionStyle(group.section).header}>
                      {group.section}
                    </th>
                  ))}
                </tr>
                <tr>
                  {visibleChannels.map(ch => (
                    <th key={`${ch.section}-${ch.channel}`}
                      className="w-[128px] border-b border-r bg-[#151515] px-2 py-2 text-center text-xs font-semibold text-white">
                      {ch.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekDays.map(date => {
                  const dateKey = toDateKey(date)
                  const dayItems = weekItems.filter(i => i.date === dateKey)
                  const dayDone  = dayItems.filter(i => checkedByItem.has(i.id)).length
                  const isToday  = dateKey === todayKey

                  return (
                    <tr key={dateKey} className={cn('align-top', isToday && 'bg-[#fffef0]')}>
                      <td className="sticky left-0 z-20 border-b border-r bg-background px-3 py-3">
                        <div className="flex items-start gap-2">
                          <div className={cn('mt-1 h-2.5 w-2.5 rounded-full', isToday ? 'bg-green-500' : 'bg-muted-foreground/30')} />
                          <div>
                            <div className="font-bold">{fullDateFormatter.format(date)}</div>
                            <div className="text-xs text-muted-foreground">{dayDone}/{dayItems.length} posted</div>
                          </div>
                        </div>
                      </td>
                      {visibleChannels.map(ch => {
                        const item    = itemsByDateChannel.get(itemKey(dateKey, ch.section, ch.channel))
                        const checked = item ? checkedByItem.has(item.id) : false
                        const busy    = item?.id === busyItemId
                        const col     = sectionStyle(ch.section)

                        return (
                          <td key={`${dateKey}-${ch.section}-${ch.channel}`}
                            className="h-[96px] border-b border-r bg-background p-1.5">
                            {item ? (
                              <button type="button" disabled={busy} onClick={() => toggleItem(item)}
                                className={cn(
                                  'flex h-full min-h-[78px] w-full flex-col justify-between rounded-md border-l-4 p-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                  checked ? 'border-l-[#111] bg-[#f3f4f6] text-muted-foreground'
                                          : item.is_highlighted ? 'border-y-border border-r-border bg-white hover:bg-accent'
                                          : 'border-y-border border-r-border bg-white hover:bg-accent'
                                )}
                                style={{ borderLeftColor: checked ? '#111' : col.borderLeft }}>
                                <span className="flex items-center justify-between gap-2">
                                  <span className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                    checked ? 'bg-[#111] text-white border-[#111]' : 'bg-background text-foreground')}
                                    style={checked ? {} : col.chipStyle}>
                                    {busy ? <Loader2 className="h-3 w-3 animate-spin" />
                                           : checked ? <CheckCircle2 className="h-3 w-3" />
                                                     : <Circle className="h-3 w-3" />}
                                    {checked ? 'Posted' : 'Open'}
                                  </span>
                                  {item.is_highlighted && <Sparkles className="h-3.5 w-3.5" style={{ color: col.borderLeft }} />}
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

          {/* ── Agenda panel ─────────────────────────────────────────── */}
          <div className="border-t bg-[#f8f8f8] px-4 py-5 sm:px-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 font-semibold">
                <Megaphone className="h-4 w-4" />
                Upcoming schedule
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowPast(p => !p)}
                  className={cn('rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                    showPast ? 'bg-foreground text-background border-foreground'
                             : 'bg-background text-muted-foreground border-border hover:border-foreground/40')}
                >
                  {showPast ? 'Hide past' : 'Show past'}
                </button>
                <Badge variant="outline" className="gap-1">
                  <BadgeCheck className="h-3 w-3" />
                  {checkedVisible}/{totalVisible}
                </Badge>
              </div>
            </div>

            {agendaByDate.size === 0 ? (
              <p className="text-sm text-muted-foreground">No upcoming events in the selected view.</p>
            ) : (
              <div className="space-y-5">
                {[...agendaByDate.entries()].map(([dateKey, dayItems]) => {
                  const date     = parseDate(dateKey)
                  const isToday  = dateKey === todayKey
                  const dayDone  = dayItems.filter(i => checkedByItem.has(i.id)).length
                  const allDone  = dayDone === dayItems.length

                  return (
                    <div key={dateKey}>
                      {/* Day header */}
                      <div className={cn('mb-2 flex items-center gap-3')}>
                        <div className={cn('flex h-10 w-10 flex-shrink-0 flex-col items-center justify-center rounded-lg text-center',
                          isToday ? 'bg-foreground text-background' : 'bg-muted text-foreground')}>
                          <span className="text-[10px] font-semibold uppercase leading-none">
                            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()]}
                          </span>
                          <span className="text-lg font-bold leading-tight">{date.getDate()}</span>
                        </div>
                        <div>
                          <p className="text-sm font-semibold">{fullDateFormatter.format(date)}</p>
                          <p className={cn('text-xs', allDone ? 'text-green-600 font-medium' : 'text-muted-foreground')}>
                            {allDone ? 'All posted ✓' : `${dayDone}/${dayItems.length} posted`}
                          </p>
                        </div>
                      </div>

                      {/* Event rows */}
                      <div className="ml-[52px] divide-y rounded-lg border bg-background overflow-hidden">
                        {dayItems.map(item => {
                          const checked = checkedByItem.has(item.id)
                          const col     = sectionStyle(item.section)
                          const isUserCreated = !item.source_sheet

                          return (
                            <div key={item.id} className={cn('flex items-center gap-3 px-3 py-2.5 transition-colors',
                              checked ? 'bg-muted/40' : 'hover:bg-accent/40')}>
                              {/* Status toggle */}
                              <button type="button" disabled={busyItemId === item.id} onClick={() => toggleItem(item)}
                                className="flex-shrink-0 text-muted-foreground hover:text-foreground transition-colors">
                                {busyItemId === item.id ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : checked ? <CheckCircle2 className="h-4 w-4 text-green-600" />
                                            : <Circle className="h-4 w-4" />}
                              </button>

                              {/* Section dot */}
                              <div className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: col.borderLeft }} />

                              {/* Channel chip */}
                              <span className="flex-shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                                style={col.chipStyle}>
                                {item.channel}
                              </span>

                              {/* Content */}
                              <span className={cn('min-w-0 flex-1 truncate text-sm', checked && 'text-muted-foreground line-through decoration-2')}>
                                {item.content}
                              </span>

                              {/* Badges */}
                              <div className="flex flex-shrink-0 items-center gap-1.5">
                                {item.is_highlighted && <Sparkles className="h-3.5 w-3.5" style={{ color: col.borderLeft }} />}
                                {isUserCreated && (
                                  <button type="button" onClick={() => handleDeleteItem(item)}
                                    className="text-muted-foreground hover:text-destructive transition-colors opacity-0 group-hover:opacity-100">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Create Event Dialog ──────────────────────────────────────── */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> New Marketing Event
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateEvent} className="space-y-4">

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={newDate} onChange={e => setNewDate(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label>Section</Label>
                <div className="flex gap-1.5">
                  {(['SRG','AGC','BOTH'] as MarketingSection[]).map(s => (
                    <button key={s} type="button"
                      onClick={() => setNewSection(s)}
                      className={cn('flex-1 rounded border px-2 py-1.5 text-xs font-bold transition-colors',
                        newSection === s ? 'text-white' : 'bg-background text-foreground hover:bg-accent')}
                      style={newSection === s ? { backgroundColor: sectionColors[s].headerBg } : {}}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Channel</Label>
              <div className="flex flex-wrap gap-1.5">
                {CHANNELS.filter(c => c.section === newSection).map(c => (
                  <button key={c.channel} type="button" onClick={() => setNewChannel(c.channel)}
                    className={cn('rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                      newChannel === c.channel ? 'bg-foreground text-background border-foreground' : 'bg-background hover:bg-accent')}>
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Content</Label>
              <Textarea value={newContent} onChange={e => setNewContent(e.target.value)}
                placeholder="What's being posted?" rows={2} required />
            </div>

            <div className="flex items-center gap-3">
              <button type="button" onClick={() => setNewHighlighted(h => !h)}
                className={cn('flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition-colors',
                  newHighlighted ? 'bg-amber-50 border-amber-300 text-amber-700' : 'bg-background hover:bg-accent')}>
                <Sparkles className="h-3.5 w-3.5" />
                {newHighlighted ? 'Campaign block' : 'Mark as campaign block'}
              </button>
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Repeat className="h-3.5 w-3.5" /> Repeat
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(RECURRENCE_LABELS) as RecurrencePattern[]).map(p => (
                  <button key={p} type="button" onClick={() => setNewRecurrence(p)}
                    className={cn('rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                      newRecurrence === p ? 'bg-foreground text-background border-foreground' : 'bg-background hover:bg-accent')}>
                    {RECURRENCE_LABELS[p]}
                  </button>
                ))}
              </div>
            </div>

            {newRecurrence !== 'none' && (
              <div className="space-y-1.5">
                <Label>Repeat until</Label>
                <Input type="date" value={newEndDate} min={newDate}
                  onChange={e => setNewEndDate(e.target.value)} required />
                <p className="text-xs text-muted-foreground">
                  Will create {generateDates(parseDate(newDate), newRecurrence, parseDate(newEndDate)).length} event{generateDates(parseDate(newDate), newRecurrence, parseDate(newEndDate)).length !== 1 ? 's' : ''}
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={creating || !newContent.trim()}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Create'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  )
}
