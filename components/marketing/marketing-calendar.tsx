'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Columns3,
  Loader2,
  Megaphone,
  Palette,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  Table2,
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
import { autoTextColor as autoText, withAlpha } from '@/lib/color'
import { toast } from 'sonner'

type MarketingSection = 'SRG' | 'AGC' | 'BOTH'
type SectionFilter = MarketingSection | 'ALL'
type RecurrencePattern = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly'

interface Channel {
  section: MarketingSection
  channel: string
  label: string
}

// Composite identity for a channel: the same channel value (e.g. "BLOG") can
// exist under more than one section, so selection keys on both.
function channelKey(section: MarketingSection, channel: string) {
  return `${section}::${channel}`
}

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
const LS_VIEW_KEY = 'marketing_calendar_view'

type ViewMode = 'week' | 'grid'
const SECTION_ORDER: Record<MarketingSection, number> = { SRG: 0, BOTH: 1, AGC: 2 }

const DEFAULT_SECTION_COLORS: Record<MarketingSection, SectionColor> = {
  SRG:  { headerBg: '#e91e8c', headerText: '#ffffff' },
  AGC:  { headerBg: '#7c3aed', headerText: '#ffffff' },
  BOTH: { headerBg: '#0891b2', headerText: '#ffffff' },
}

// Fallback list used before the shared channel list loads (or if the table is
// missing). The canonical list lives in the `marketing_channels` table.
const DEFAULT_CHANNELS: Channel[] = [
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

const SECTION_FILTER_OPTIONS: MarketingSection[] = ['SRG', 'AGC', 'BOTH']

const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  none:      'No repeat',
  daily:     'Daily',
  weekly:    'Weekly',
  biweekly:  'Every 2 weeks',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
}

/* ─── colour helpers ──────────────────────────────────────────────────── */

function loadColors(): Record<MarketingSection, SectionColor> {
  if (typeof window === 'undefined') return DEFAULT_SECTION_COLORS
  try {
    const raw = localStorage.getItem(LS_COLORS_KEY)
    if (raw) return { ...DEFAULT_SECTION_COLORS, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return DEFAULT_SECTION_COLORS
}

function loadViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'week'
  try {
    const raw = localStorage.getItem(LS_VIEW_KEY)
    if (raw === 'week' || raw === 'grid') return raw
  } catch { /* ignore */ }
  return 'week'
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
    if (pattern === 'daily')     cur = addDays(cur, 1)
    if (pattern === 'weekly')    cur = addDays(cur, 7)
    if (pattern === 'biweekly')  cur = addDays(cur, 14)
    if (pattern === 'monthly')   cur = addMonths(cur, 1)
    if (pattern === 'quarterly') cur = addMonths(cur, 3)
  }
  return dates
}

/* ─── shared create/edit form fields ────────────────────────────────── */

interface EventFormFieldsProps {
  date: string
  onDateChange: (v: string) => void
  content: string
  onContentChange: (v: string) => void
  highlighted: boolean
  onToggleHighlighted: () => void
  sectionColors: Record<MarketingSection, SectionColor>
  channels: Channel[]
  /** Composite `section::channel` keys currently selected. */
  selectedKeys: string[]
  onToggleChannel: (key: string) => void
  /** Allow selecting more than one channel (create) vs. exactly one (edit). */
  multi?: boolean
  /** Section filter for the channel list ('ALL' shows every channel). */
  channelFilter: SectionFilter
  onChannelFilterChange: (v: SectionFilter) => void
  /** When provided, admins can add a brand-new channel inline. */
  onAddChannel?: (label: string, section: MarketingSection) => Promise<boolean>
}

function EventFormFields({
  date, onDateChange, content, onContentChange, highlighted, onToggleHighlighted,
  sectionColors, channels, selectedKeys, onToggleChannel, multi = false,
  channelFilter, onChannelFilterChange, onAddChannel,
}: EventFormFieldsProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [addLabel, setAddLabel] = useState('')
  const [addSection, setAddSection] = useState<MarketingSection>('SRG')
  const [addBusy, setAddBusy] = useState(false)

  const selected = new Set(selectedKeys)
  const filtered = channels.filter(c => channelFilter === 'ALL' || c.section === channelFilter)
  const grouped = (['SRG', 'BOTH', 'AGC'] as MarketingSection[])
    .map(s => ({ section: s, list: filtered.filter(c => c.section === s) }))
    .filter(g => g.list.length > 0)

  const submitAdd = async () => {
    if (!onAddChannel || !addLabel.trim()) return
    setAddBusy(true)
    const ok = await onAddChannel(addLabel.trim(), addSection)
    setAddBusy(false)
    if (ok) { setAddLabel(''); setAddOpen(false) }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label>Date</Label>
        <Input type="date" value={date} onChange={e => onDateChange(e.target.value)} required />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{multi ? 'Channels' : 'Channel'}</Label>
          <div className="flex items-center gap-1">
            {(['ALL', ...SECTION_FILTER_OPTIONS] as SectionFilter[]).map(f => (
              <button key={f} type="button" onClick={() => onChannelFilterChange(f)}
                className={cn('rounded px-2 py-0.5 text-[11px] font-semibold transition-colors',
                  channelFilter === f ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground')}>
                {f === 'ALL' ? 'All' : f}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2 rounded-md border p-2">
          {grouped.map(group => (
            <div key={group.section} className="space-y-1">
              <div className="flex items-center gap-1.5 px-0.5">
                <span className="h-2 w-2 rounded-full" style={{ backgroundColor: sectionColors[group.section].headerBg }} />
                <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">{group.section}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {group.list.map(c => {
                  const key = channelKey(c.section, c.channel)
                  const isOn = selected.has(key)
                  return (
                    <button key={key} type="button" onClick={() => onToggleChannel(key)}
                      className={cn('rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                        isOn ? 'bg-foreground text-background border-foreground' : 'bg-background hover:bg-accent')}>
                      {c.label}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
          {grouped.length === 0 && (
            <p className="px-1 py-2 text-xs text-muted-foreground">No channels in this section yet.</p>
          )}

          {onAddChannel && (
            addOpen ? (
              <div className="space-y-2 rounded border bg-muted/40 p-2">
                <Input autoFocus value={addLabel} onChange={e => setAddLabel(e.target.value)}
                  placeholder="Channel name (e.g. LinkedIn)" className="h-8"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitAdd() } }} />
                <div className="flex items-center gap-1.5">
                  {SECTION_FILTER_OPTIONS.map(s => (
                    <button key={s} type="button" onClick={() => setAddSection(s)}
                      className={cn('flex-1 rounded border px-2 py-1 text-[11px] font-bold transition-colors',
                        addSection === s ? 'text-white' : 'bg-background hover:bg-accent')}
                      style={addSection === s ? { backgroundColor: sectionColors[s].headerBg } : {}}>
                      {s}
                    </button>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <Button type="button" size="sm" variant="outline" className="h-7 flex-1" onClick={() => { setAddOpen(false); setAddLabel('') }}>
                    Cancel
                  </Button>
                  <Button type="button" size="sm" className="h-7 flex-1" disabled={addBusy || !addLabel.trim()} onClick={submitAdd}>
                    {addBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
                  </Button>
                </div>
              </div>
            ) : (
              <button type="button" onClick={() => setAddOpen(true)}
                className="flex items-center gap-1 rounded border border-dashed px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                <Plus className="h-3.5 w-3.5" /> New channel
              </button>
            )
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Content</Label>
        <Textarea value={content} onChange={e => onContentChange(e.target.value)}
          placeholder="What's being posted?" rows={2} required />
      </div>

      <div className="flex items-center gap-3">
        <button type="button" onClick={onToggleHighlighted}
          className={cn('flex items-center gap-1.5 rounded border px-3 py-1.5 text-xs font-medium transition-colors',
            highlighted ? 'bg-amber-100 border-amber-400 text-amber-800' : 'bg-background hover:bg-accent')}>
          <Sparkles className="h-3.5 w-3.5" />
          {highlighted ? 'Campaign block' : 'Mark as campaign block'}
        </button>
      </div>
    </>
  )
}

/* ─── component ──────────────────────────────────────────────────────── */

export default function MarketingCalendar({ userId, userName, isAdmin = false }: MarketingCalendarProps) {
  const supabase = createClient()
  const [items,         setItems]         = useState<MarketingCalendarItem[]>([])
  const [checkedByItem, setCheckedByItem] = useState<Map<string, MarketingCalendarCheck>>(new Map())
  const [checkUserId,   setCheckUserId]   = useState(userId)
  const [checkUserName, setCheckUserName] = useState(userName)
  const [kaylaId,       setKaylaId]       = useState<string | null>(null)
  // Which sections are shown in the board/grid. Mix-and-match — e.g. SRG + BOTH.
  const [activeSections, setActiveSections] = useState<MarketingSection[]>(['SRG', 'AGC', 'BOTH'])
  // Shared, editable channel list (loaded from marketing_channels).
  const [channels,      setChannels]      = useState<Channel[]>(DEFAULT_CHANNELS)
  const [weekStart,     setWeekStart]     = useState(() => startOfWeek(new Date()))
  const [loading,       setLoading]       = useState(true)
  const [busyItemId,    setBusyItemId]    = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)

  // Color customisation (localStorage)
  const [sectionColors, setSectionColorsState] = useState<Record<MarketingSection, SectionColor>>(loadColors)
  const [colorPickerOpen, setColorPickerOpen]  = useState(false)

  // Week board vs channel grid (localStorage)
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode)
  const setViewMode = (next: ViewMode) => {
    setViewModeState(next)
    try { localStorage.setItem(LS_VIEW_KEY, next) } catch { /* ignore */ }
  }

  const saveSectionColors = (next: Record<MarketingSection, SectionColor>) => {
    setSectionColorsState(next)
    try { localStorage.setItem(LS_COLORS_KEY, JSON.stringify(next)) } catch { /* ignore */ }
  }

  // Create-event dialog. Channels are multi-select (one event per channel).
  const [createOpen,        setCreateOpen]        = useState(false)
  const [newDate,           setNewDate]           = useState(toInputDate(new Date()))
  const [newChannelKeys,    setNewChannelKeys]    = useState<string[]>([channelKey(DEFAULT_CHANNELS[0].section, DEFAULT_CHANNELS[0].channel)])
  const [newChannelFilter,  setNewChannelFilter]  = useState<SectionFilter>('ALL')
  const [newContent,        setNewContent]        = useState('')
  const [newHighlighted,    setNewHighlighted]    = useState(false)
  const [newRecurrence,     setNewRecurrence]     = useState<RecurrencePattern>('none')
  const [newEndDate,        setNewEndDate]        = useState(toInputDate(addDays(new Date(), 28)))
  const [creating,          setCreating]          = useState(false)

  // Edit-event dialog (single channel).
  const [editItem,          setEditItem]          = useState<MarketingCalendarItem | null>(null)
  const [editDate,          setEditDate]          = useState('')
  const [editChannelKey,    setEditChannelKey]    = useState('')
  const [editChannelFilter, setEditChannelFilter] = useState<SectionFilter>('ALL')
  const [editContent,       setEditContent]       = useState('')
  const [editHighlighted,   setEditHighlighted]   = useState(false)
  const [savingEdit,        setSavingEdit]        = useState(false)

  // Drag-and-drop reschedule
  const [draggingId,  setDraggingId]  = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

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

  // Load the shared channel list. Falls back to the built-in defaults if the
  // table is empty or unavailable, so the picker is never blank.
  const loadChannels = useCallback(async () => {
    const { data, error: chErr } = await supabase
      .from('marketing_channels')
      .select('section,channel,label,is_archived,position')
      .order('position', { ascending: true })
    if (chErr || !data || data.length === 0) return
    setChannels(
      (data as Array<Channel & { is_archived?: boolean }>)
        .filter(c => !c.is_archived)
        .map(({ section, channel, label }) => ({ section, channel, label })),
    )
  }, [supabase])

  useEffect(() => { loadChannels() }, [loadChannels])

  // Add a new shared channel (admins only, enforced by RLS). Returns success so
  // the inline form can reset itself.
  const handleAddChannel = useCallback(async (label: string, section: MarketingSection): Promise<boolean> => {
    const channel = label.trim()
    if (!channel) return false
    const position = channels.length
    const { error: insErr } = await supabase
      .from('marketing_channels')
      .insert({ section, channel, label: channel, position })
    if (insErr) {
      toast.error('Could not add channel', {
        description: insErr.code === '23505' ? 'That channel already exists in this section.' : insErr.message,
      })
      return false
    }
    await loadChannels()
    toast.success(`Added "${channel}" to ${section}`)
    return true
  }, [channels.length, loadChannels, supabase])

  /* ── computed views ─────────────────────────────────────────────── */

  // Empty selection is treated as "show everything" so the board is never blank.
  const sectionVisible = useCallback(
    (section: MarketingSection) => activeSections.length === 0 || activeSections.includes(section),
    [activeSections],
  )

  const visibleChannels = useMemo(() =>
    channels.filter(c => sectionVisible(c.section)),
  [channels, sectionVisible])

  const visibleItems = useMemo(() =>
    items.filter(i => sectionVisible(i.section)),
  [items, sectionVisible])

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

  const weekItemsByDate = useMemo(() => {
    const m = new Map<string, MarketingCalendarItem[]>()
    for (const item of visibleItems) {
      if (!weekKeys.has(item.date)) continue
      const arr = m.get(item.date) ?? []
      arr.push(item)
      m.set(item.date, arr)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) =>
        SECTION_ORDER[a.section] - SECTION_ORDER[b.section]
        || a.channel.localeCompare(b.channel)
        || a.position - b.position)
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
    if (!newContent.trim() || !kaylaId || newChannelKeys.length === 0) return
    setCreating(true)

    const startDate = parseDate(newDate)
    const endDate   = newRecurrence === 'none' ? startDate : parseDate(newEndDate)
    const dates     = generateDates(startDate, newRecurrence, endDate)

    // One row per selected channel × recurrence date. Each channel carries its
    // own section, so the grid always places the event under the right column.
    const selected = newChannelKeys
      .map(k => channels.find(c => channelKey(c.section, c.channel) === k))
      .filter((c): c is Channel => Boolean(c))

    const rows = dates.flatMap((d, i) =>
      selected.map(c => ({
        assigned_to:    kaylaId,
        date:           toDateKey(d),
        day_label:      ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()],
        section:        c.section,
        channel:        c.channel,
        content:        newContent.trim(),
        is_highlighted: newHighlighted,
        position:       i,
        source_sheet:   null,
        source_row:     null,
        source_column:  null,
      })),
    )

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

  // Toggle a channel in the multi-select create form.
  const toggleNewChannel = (key: string) =>
    setNewChannelKeys(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])

  // Open the create dialog, optionally pre-selecting a date and channel slot
  // (used when clicking an empty cell in the grid or an empty day column).
  const openCreateDialog = (opts?: { date?: string; section?: MarketingSection; channel?: string }) => {
    setNewDate(opts?.date ?? toInputDate(new Date()))
    setNewContent('')
    setNewHighlighted(false)
    setNewRecurrence('none')
    setNewChannelFilter('ALL')
    if (opts?.section && opts?.channel) {
      setNewChannelKeys([channelKey(opts.section, opts.channel)])
    } else {
      const first = channels[0]
      setNewChannelKeys(first ? [channelKey(first.section, first.channel)] : [])
    }
    setCreateOpen(true)
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

  /* ── edit user-created item ───────────────────────────────────── */
  const isEditable = (item: MarketingCalendarItem) => item.source_sheet === null || item.source_sheet === undefined

  const openEditDialog = (item: MarketingCalendarItem) => {
    if (!isEditable(item)) {
      toast.error('Imported events cannot be edited here')
      return
    }
    setEditItem(item)
    setEditDate(item.date)
    setEditChannelKey(channelKey(item.section, item.channel))
    setEditChannelFilter('ALL')
    setEditContent(item.content)
    setEditHighlighted(item.is_highlighted)
  }

  const findSlotConflict = (date: string, section: MarketingSection, channel: string, excludeId: string) =>
    items.find(i => i.id !== excludeId && i.date === date && i.section === section && i.channel === channel)

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editItem || !editContent.trim() || !editChannelKey) return

    const editChannelDef = channels.find(c => channelKey(c.section, c.channel) === editChannelKey)
    const editSection = editChannelDef?.section ?? editItem.section
    const editChannel = editChannelDef?.channel ?? editItem.channel

    const conflict = findSlotConflict(editDate, editSection, editChannel, editItem.id)
    if (conflict) {
      toast.error('That slot is already taken', { description: 'Move or delete the other event first.' })
      return
    }

    setSavingEdit(true)
    const dayLabel = ['SUN','MON','TUE','WED','THU','FRI','SAT'][parseDate(editDate).getDay()]
    const { error: e2 } = await supabase.from('marketing_calendar_items').update({
      date:           editDate,
      day_label:      dayLabel,
      section:        editSection,
      channel:        editChannel,
      content:        editContent.trim(),
      is_highlighted: editHighlighted,
    }).eq('id', editItem.id)
    setSavingEdit(false)

    if (e2) {
      toast.error('Could not update event', { description: e2.message })
    } else {
      toast.success('Event updated')
      setEditItem(null)
      loadCalendar()
    }
  }

  const handleDeleteFromEdit = async () => {
    if (!editItem) return
    await handleDeleteItem(editItem)
    setEditItem(null)
  }

  /* ── drag-and-drop reschedule ────────────────────────────────────── */
  const handleDragStart = (item: MarketingCalendarItem) => (e: React.DragEvent) => {
    if (!isEditable(item)) { e.preventDefault(); return }
    e.dataTransfer.setData('text/plain', item.id)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingId(item.id)
  }

  const handleDragEnd = () => {
    setDraggingId(null)
    setDragOverKey(null)
  }

  const handleCellDragOver = (cellKey: string) => (e: React.DragEvent) => {
    if (!draggingId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDragOverKey(cellKey)
  }

  const moveItem = async (item: MarketingCalendarItem, date: string, section: MarketingSection, channel: string) => {
    if (item.date === date && item.section === section && item.channel === channel) return
    if (findSlotConflict(date, section, channel, item.id)) {
      toast.error('That slot is already taken', { description: 'Drop it on an empty slot instead.' })
      return
    }

    const dayLabel = ['SUN','MON','TUE','WED','THU','FRI','SAT'][parseDate(date).getDay()]
    const previous = items
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, date, section, channel, day_label: dayLabel } : i))

    const { error: e3 } = await supabase.from('marketing_calendar_items')
      .update({ date, section, channel, day_label: dayLabel }).eq('id', item.id)
    if (e3) {
      setItems(previous)
      toast.error('Could not move event', { description: e3.message })
    } else {
      toast.success('Event moved')
    }
  }

  const handleCellDrop = (date: string, section: MarketingSection, channel: string) => async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverKey(null)
    const itemId = e.dataTransfer.getData('text/plain')
    const item = items.find(i => i.id === itemId)
    if (!item || !isEditable(item)) return
    setDraggingId(null)
    await moveItem(item, date, section, channel)
  }

  // Week-board drop: reschedule to another day, keeping section + channel.
  const handleDayDrop = (date: string) => async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverKey(null)
    const itemId = e.dataTransfer.getData('text/plain')
    const item = items.find(i => i.id === itemId)
    if (!item || !isEditable(item)) return
    setDraggingId(null)
    await moveItem(item, date, item.section, item.channel)
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
      <section className="force-light-theme rounded-lg border bg-background">
        <div className="flex items-center gap-3 p-6">
          <Loader2 className="h-5 w-5 animate-spin" />
          <span className="text-sm font-medium">Loading marketing calendar…</span>
        </div>
      </section>
    )
  }

  return (
    <section className="force-light-theme overflow-hidden rounded-lg border bg-background shadow-sm">

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

            <div className="ml-1 flex overflow-hidden rounded-md border">
              {([
                { mode: 'week' as ViewMode, label: 'Week',     Icon: Columns3 },
                { mode: 'grid' as ViewMode, label: 'Channels', Icon: Table2 },
              ]).map(({ mode, label, Icon }) => (
                <button key={mode} type="button" onClick={() => setViewMode(mode)}
                  className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors',
                    viewMode === mode ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground')}>
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Section filter — mix and match (e.g. SRG + BOTH). "All" selects every section. */}
            <Button type="button" size="sm" variant={activeSections.length === SECTION_FILTER_OPTIONS.length ? 'default' : 'outline'}
              onClick={() => setActiveSections([...SECTION_FILTER_OPTIONS])} className="min-w-14">
              All
            </Button>
            {SECTION_FILTER_OPTIONS.map(s => {
              const on = activeSections.includes(s)
              return (
                <Button key={s} type="button" size="sm"
                  variant={on && activeSections.length < SECTION_FILTER_OPTIONS.length ? 'default' : 'outline'}
                  onClick={() => setActiveSections(prev => {
                    const next = prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s]
                    return next.length === 0 ? [...SECTION_FILTER_OPTIONS] : next
                  })}
                  className="min-w-14"
                  style={on && activeSections.length < SECTION_FILTER_OPTIONS.length ? { backgroundColor: sectionColors[s].headerBg, borderColor: sectionColors[s].headerBg } : {}}>
                  {s}
                </Button>
              )
            })}
            <Button variant="outline" size="icon" onClick={() => { loadCalendar(); loadChannels() }} aria-label="Refresh calendar">
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Color picker */}
            <Popover open={colorPickerOpen} onOpenChange={setColorPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="icon" aria-label="Customise section colours">
                  <Palette className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="end" className="force-light-theme w-72 space-y-4 bg-background p-4">
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
            <Button size="sm" onClick={() => openCreateDialog()} className="gap-1.5">
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
          {/* ── Week board ───────────────────────────────────────────── */}
          {viewMode === 'week' && (
            <div className="overflow-x-auto">
              <div className="grid min-w-[1080px] grid-cols-7 divide-x">
                {weekDays.map(date => {
                  const dateKey    = toDateKey(date)
                  const dayItems   = weekItemsByDate.get(dateKey) ?? []
                  const dayDone    = dayItems.filter(i => checkedByItem.has(i.id)).length
                  const isToday    = dateKey === todayKey
                  const dayKey     = `day::${dateKey}`
                  const isDragOver = dragOverKey === dayKey

                  return (
                    <div key={dateKey}
                      className={cn('flex min-h-[360px] flex-col border-b transition-colors', isDragOver && 'bg-primary/5')}
                      onDragOver={handleCellDragOver(dayKey)}
                      onDragLeave={() => setDragOverKey(cur => cur === dayKey ? null : cur)}
                      onDrop={handleDayDrop(dateKey)}>

                      <div className={cn('flex items-baseline justify-between border-b px-3 py-2',
                        isToday ? 'bg-[#111] text-white' : 'bg-[#fbfbfb]')}>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[11px] font-bold uppercase">
                            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()]}
                          </span>
                          <span className="text-lg font-black leading-none">{date.getDate()}</span>
                          {isToday && <span className="rounded-full bg-[#fff842] px-1.5 text-[10px] font-bold text-[#111]">Today</span>}
                        </div>
                        <span className={cn('text-[11px] font-medium', isToday ? 'text-white/70' : 'text-muted-foreground')}>
                          {dayItems.length ? `${dayDone}/${dayItems.length} posted` : '—'}
                        </span>
                      </div>

                      <div className="flex flex-1 flex-col gap-1.5 p-1.5">
                        {dayItems.map(item => {
                          const checked  = checkedByItem.has(item.id)
                          const busy     = item.id === busyItemId
                          const col      = sectionStyle(item.section)
                          const editable = isEditable(item)
                          const chLabel  = channels.find(c => c.section === item.section && c.channel === item.channel)?.label ?? item.channel

                          return (
                            <div key={item.id}
                              role="button"
                              tabIndex={0}
                              draggable={editable}
                              onDragStart={handleDragStart(item)}
                              onDragEnd={handleDragEnd}
                              onClick={() => editable ? openEditDialog(item) : toggleItem(item)}
                              onKeyDown={e => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault()
                                  editable ? openEditDialog(item) : toggleItem(item)
                                }
                              }}
                              title={editable ? 'Click to edit, drag to another day' : 'Click the circle to toggle posted'}
                              className={cn(
                                'cursor-pointer rounded-md border p-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                checked ? 'border-transparent bg-[#f3f4f6] text-muted-foreground'
                                        : item.is_highlighted ? 'border-amber-300 bg-amber-100 hover:bg-amber-200'
                                                              : 'border-border bg-white shadow-xs hover:bg-accent',
                                draggingId === item.id && 'opacity-40'
                              )}>
                              <div className="flex items-center justify-between gap-1.5">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ backgroundColor: checked ? '#9ca3af' : col.borderLeft }} />
                                  <span className="truncate text-[10px] font-bold uppercase tracking-wide" style={{ color: checked ? undefined : col.borderLeft }}>
                                    {chLabel}
                                  </span>
                                </span>
                                <span className="flex flex-shrink-0 items-center gap-1">
                                  {item.is_highlighted && <Sparkles className="h-3 w-3" style={{ color: col.borderLeft }} />}
                                  <button type="button" disabled={busy}
                                    onClick={e => { e.stopPropagation(); toggleItem(item) }}
                                    aria-label={checked ? 'Mark as not posted' : 'Mark as posted'}
                                    className={cn('rounded-full transition-colors',
                                      checked ? 'text-green-600' : 'text-muted-foreground/60 hover:text-foreground')}>
                                    {busy ? <Loader2 className="h-4 w-4 animate-spin" />
                                          : checked ? <CheckCircle2 className="h-4 w-4" />
                                                    : <Circle className="h-4 w-4" />}
                                  </button>
                                </span>
                              </div>
                              <p className={cn('mt-1.5 break-words text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]',
                                checked && 'line-through decoration-2')}>
                                {item.content}
                              </p>
                            </div>
                          )
                        })}
                        {dayItems.length === 0 ? (
                          <button type="button" onClick={() => openCreateDialog({ date: dateKey })}
                            className={cn('flex flex-1 items-center justify-center rounded-md border border-dashed bg-[#fafafa] text-[11px] text-muted-foreground/60 transition-colors hover:border-foreground/30 hover:text-foreground',
                            isDragOver && 'border-primary/50 bg-primary/5')}>
                            <Plus className="mr-1 h-3.5 w-3.5" /> Add post
                          </button>
                        ) : (
                          <button type="button" onClick={() => openCreateDialog({ date: dateKey })}
                            className="mt-0.5 flex items-center justify-center gap-1 rounded-md border border-dashed py-1.5 text-[11px] font-medium text-muted-foreground/70 transition-colors hover:border-foreground/30 hover:text-foreground">
                            <Plus className="h-3.5 w-3.5" /> Add post
                          </button>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── Channel grid ─────────────────────────────────────────── */}
          {viewMode === 'grid' && (
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
                        const item      = itemsByDateChannel.get(itemKey(dateKey, ch.section, ch.channel))
                        const checked   = item ? checkedByItem.has(item.id) : false
                        const busy      = item?.id === busyItemId
                        const col       = sectionStyle(ch.section)
                        const cellKey   = itemKey(dateKey, ch.section, ch.channel)
                        const isDragOver = dragOverKey === cellKey
                        const editable  = item ? isEditable(item) : false

                        return (
                          <td key={cellKey}
                            className={cn('h-[96px] border-b border-r bg-background p-1.5 transition-colors',
                              isDragOver && 'bg-primary/10 ring-2 ring-inset ring-primary/40')}
                            onDragOver={handleCellDragOver(cellKey)}
                            onDragLeave={() => setDragOverKey(cur => cur === cellKey ? null : cur)}
                            onDrop={handleCellDrop(dateKey, ch.section, ch.channel)}>
                            {item ? (
                              <div
                                role="button"
                                tabIndex={0}
                                draggable={editable}
                                onDragStart={handleDragStart(item)}
                                onDragEnd={handleDragEnd}
                                onClick={() => editable ? openEditDialog(item) : toggleItem(item)}
                                onKeyDown={e => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault()
                                    editable ? openEditDialog(item) : toggleItem(item)
                                  }
                                }}
                                title={editable ? 'Click to edit, drag to reschedule' : 'Click the status pill to toggle posted'}
                                className={cn(
                                  'flex h-full min-h-[78px] w-full cursor-pointer flex-col justify-between rounded-md border p-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                                  checked ? 'border-transparent bg-[#f3f4f6] text-muted-foreground'
                                          : item.is_highlighted ? 'border-amber-300 bg-amber-100 hover:bg-amber-200'
                                                                 : 'border-border bg-white hover:bg-accent',
                                  draggingId === item.id && 'opacity-40'
                                )}>
                                <span className="flex items-center justify-between gap-2">
                                  <button type="button" disabled={busy} onClick={e => { e.stopPropagation(); toggleItem(item) }}
                                    className={cn('inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-semibold',
                                      checked ? 'bg-[#111] text-white border-[#111]' : 'bg-background text-foreground')}
                                    style={checked ? {} : col.chipStyle}>
                                    {busy ? <Loader2 className="h-3 w-3 animate-spin" />
                                           : checked ? <CheckCircle2 className="h-3 w-3" />
                                                     : <Circle className="h-3 w-3" />}
                                    {checked ? 'Posted' : 'Open'}
                                  </button>
                                  <span className="flex items-center gap-1">
                                    {item.is_highlighted && <Sparkles className="h-3.5 w-3.5" style={{ color: col.borderLeft }} />}
                                    {editable && (
                                      <button type="button" onClick={e => { e.stopPropagation(); handleDeleteItem(item) }}
                                        aria-label="Delete event" className="text-muted-foreground/70 transition-colors hover:text-destructive">
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </span>
                                </span>
                                <span className={cn('mt-2 line-clamp-3 break-words text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]', checked && 'line-through decoration-2')}>
                                  {item.content}
                                </span>
                              </div>
                            ) : (
                              <button type="button"
                                onClick={() => openCreateDialog({ date: dateKey, section: ch.section, channel: ch.channel })}
                                className={cn('group flex h-full min-h-[78px] w-full items-center justify-center rounded-md border border-dashed bg-[#fafafa] text-muted-foreground/40 transition-colors hover:border-foreground/30 hover:text-foreground',
                                isDragOver && 'border-primary/50 bg-primary/5')}>
                                <Plus className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                              </button>
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
          )}

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
                          const checked  = checkedByItem.has(item.id)
                          const col      = sectionStyle(item.section)
                          const editable = isEditable(item)

                          return (
                            <div key={item.id} className={cn('group flex items-center gap-3 px-3 py-2.5 transition-colors',
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
                              <span
                                onClick={() => editable && openEditDialog(item)}
                                className={cn('min-w-0 flex-1 truncate text-sm', editable && 'cursor-pointer hover:underline',
                                  checked && 'text-muted-foreground line-through decoration-2')}>
                                {item.content}
                              </span>

                              {/* Badges */}
                              <div className="flex flex-shrink-0 items-center gap-1.5">
                                {item.is_highlighted && <Sparkles className="h-3.5 w-3.5" style={{ color: col.borderLeft }} />}
                                {editable && (
                                  <>
                                    <button type="button" onClick={() => openEditDialog(item)}
                                      aria-label="Edit event"
                                      className="text-muted-foreground opacity-0 transition-colors hover:text-foreground group-hover:opacity-100">
                                      <Pencil className="h-3.5 w-3.5" />
                                    </button>
                                    <button type="button" onClick={() => handleDeleteItem(item)}
                                      aria-label="Delete event"
                                      className="text-muted-foreground opacity-0 transition-colors hover:text-destructive group-hover:opacity-100">
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </>
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
        <DialogContent className="force-light-theme max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> New Marketing Event
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateEvent} className="space-y-4">

            <EventFormFields
              date={newDate} onDateChange={setNewDate}
              content={newContent} onContentChange={setNewContent}
              highlighted={newHighlighted} onToggleHighlighted={() => setNewHighlighted(h => !h)}
              sectionColors={sectionColors}
              channels={channels}
              selectedKeys={newChannelKeys} onToggleChannel={toggleNewChannel} multi
              channelFilter={newChannelFilter} onChannelFilterChange={setNewChannelFilter}
              onAddChannel={handleAddChannel}
            />

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
              <Button type="submit" className="flex-1" disabled={creating || !newContent.trim() || newChannelKeys.length === 0}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : `Create${newChannelKeys.length > 1 ? ` (${newChannelKeys.length})` : ''}`}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Event Dialog ───────────────────────────────────────── */}
      <Dialog open={!!editItem} onOpenChange={open => !open && setEditItem(null)}>
        <DialogContent className="force-light-theme max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Edit Marketing Event
            </DialogTitle>
          </DialogHeader>
          {editItem && (
            <form onSubmit={handleSaveEdit} className="space-y-4">
              <EventFormFields
                date={editDate} onDateChange={setEditDate}
                content={editContent} onContentChange={setEditContent}
                highlighted={editHighlighted} onToggleHighlighted={() => setEditHighlighted(h => !h)}
                sectionColors={sectionColors}
                channels={channels}
                selectedKeys={editChannelKey ? [editChannelKey] : []}
                onToggleChannel={key => setEditChannelKey(key)}
                channelFilter={editChannelFilter} onChannelFilterChange={setEditChannelFilter}
                onAddChannel={handleAddChannel}
              />

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" size="icon" className="shrink-0 text-destructive hover:text-destructive"
                  onClick={handleDeleteFromEdit} aria-label="Delete event">
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditItem(null)}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={savingEdit || !editContent.trim() || !editChannelKey}>
                  {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
