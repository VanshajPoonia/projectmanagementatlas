'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
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
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Sparkles,
  Table2,
  Trash2,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { autoTextColor as autoText, withAlpha } from '@/lib/color'
import { toast } from 'sonner'

type RecurrencePattern = 'none' | 'daily' | 'weekly' | 'biweekly' | 'monthly' | 'quarterly'

// A day's item can be posted, explicitly/automatically missed, or still pending.
// "missed" is either stored (with an optional reason) or inferred for any past item
// that was never posted.
type PostState = 'posted' | 'missed' | 'pending'
type CheckStatus = 'posted' | 'missed'

interface Company {
  id: string
  code: string
  name: string
  color: string
}

interface Channel {
  channel: string
  label: string
}

interface MarketingCalendarItem {
  id: string
  date: string
  day_label: string
  channel: string
  content: string
  is_highlighted: boolean
  position: number
  source_sheet?: string | null
  recurrence_group_id?: string | null
  companies: Company[]
}

interface MarketingCalendarCheck {
  id: string
  item_id: string
  checked_at: string
  status: CheckStatus
  note: string | null
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
const LS_VIEW_KEY = 'marketing_calendar_view'

type ViewMode = 'week' | 'grid'

const RECURRENCE_LABELS: Record<RecurrencePattern, string> = {
  none:      'No repeat',
  daily:     'Daily',
  weekly:    'Weekly',
  biweekly:  'Every 2 weeks',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
}

/* ─── view-mode persistence ────────────────────────────────────────────── */

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

function itemKey(date: string, channel: string) {
  return `${date}::${channel}`
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

  companies: Company[]
  selectedCompanyIds: string[]
  onToggleCompany: (id: string) => void

  channels: Channel[]
  selectedChannels: string[]
  onToggleChannel: (channel: string) => void
  /** Allow selecting more than one channel (create) vs. exactly one (edit). */
  multiChannel?: boolean
  /** When provided, any user can add a brand-new channel inline. */
  onAddChannel?: (name: string) => Promise<boolean>
}

function EventFormFields({
  date, onDateChange, content, onContentChange, highlighted, onToggleHighlighted,
  companies, selectedCompanyIds, onToggleCompany,
  channels, selectedChannels, onToggleChannel, multiChannel = false, onAddChannel,
}: EventFormFieldsProps) {
  const [addOpen, setAddOpen] = useState(false)
  const [addName, setAddName] = useState('')
  const [addBusy, setAddBusy] = useState(false)

  const selectedChannelSet = new Set(selectedChannels)
  const selectedCompanySet = new Set(selectedCompanyIds)

  const submitAdd = async () => {
    if (!onAddChannel || !addName.trim()) return
    setAddBusy(true)
    const ok = await onAddChannel(addName.trim())
    setAddBusy(false)
    if (ok) { setAddName(''); setAddOpen(false) }
  }

  return (
    <>
      <div className="space-y-1.5">
        <Label>Date</Label>
        <Input type="date" value={date} onChange={e => onDateChange(e.target.value)} required />
      </div>

      <div className="space-y-1.5">
        <Label>Companies</Label>
        <div className="flex flex-wrap gap-1.5">
          {companies.map(c => {
            const isOn = selectedCompanySet.has(c.id)
            return (
              <button key={c.id} type="button" onClick={() => onToggleCompany(c.id)}
                className={cn('rounded border px-2.5 py-1 text-xs font-bold transition-colors',
                  isOn ? 'text-white' : 'bg-background text-foreground hover:bg-accent')}
                style={isOn ? { backgroundColor: c.color, borderColor: c.color } : {}}>
                {c.code}
              </button>
            )
          })}
          {companies.length === 0 && (
            <p className="text-xs text-muted-foreground">No companies yet — add one from the Super Admin page.</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>{multiChannel ? 'Channels' : 'Channel'}</Label>
        <div className="space-y-2 rounded-md border p-2">
          <div className="flex flex-wrap gap-1.5">
            {channels.map(c => {
              const isOn = selectedChannelSet.has(c.channel)
              return (
                <button key={c.channel} type="button" onClick={() => onToggleChannel(c.channel)}
                  className={cn('rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                    isOn ? 'bg-foreground text-background border-foreground' : 'bg-background hover:bg-accent')}>
                  {c.label}
                </button>
              )
            })}
          </div>

          {onAddChannel && (
            addOpen ? (
              <div className="flex items-center gap-1.5">
                <Input autoFocus value={addName} onChange={e => setAddName(e.target.value)}
                  placeholder="Channel name (e.g. LinkedIn)" className="h-8"
                  onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submitAdd() } }} />
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => { setAddOpen(false); setAddName('') }}>
                  Cancel
                </Button>
                <Button type="button" size="sm" className="h-8" disabled={addBusy || !addName.trim()} onClick={submitAdd}>
                  {addBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Add'}
                </Button>
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

/* ─── event card (shared between week + grid views) ───────────────────── */

interface EventEntryProps {
  item: MarketingCalendarItem
  state: PostState
  note: string | null
  busy: boolean
  editable: boolean
  dragging: boolean
  showChannelLabel: boolean
  channelLabel: string
  onOpen: () => void
  onToggle: () => void
  onEditReason: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}

function EventEntry({
  item, state, note, busy, editable, dragging, showChannelLabel, channelLabel,
  onOpen, onToggle, onEditReason, onDragStart, onDragEnd,
}: EventEntryProps) {
  const posted = state === 'posted'
  const missed = state === 'missed'
  const primaryColor = item.companies[0]?.color ?? '#64748b'
  const companyLabel = item.companies.length ? item.companies.map(c => c.code).join(' + ') : 'No company'

  return (
    <div
      role="button"
      tabIndex={0}
      draggable={editable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      onKeyDown={e => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen() }
      }}
      title={editable ? 'Click to edit, drag to reschedule' : 'Click the circle to toggle posted'}
      className={cn(
        'cursor-pointer rounded-md border p-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        posted ? 'border-transparent bg-[#f3f4f6] text-muted-foreground'
               : missed ? 'border-red-300 bg-red-50 hover:bg-red-100'
               : item.is_highlighted ? 'border-amber-300 bg-amber-100 hover:bg-amber-200'
                                     : 'border-border bg-white shadow-xs hover:bg-accent',
        dragging && 'opacity-40',
      )}>
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex flex-shrink-0 -space-x-0.5">
            {(item.companies.length ? item.companies : [{ id: 'none', color: '#9ca3af' }]).slice(0, 3).map((c, i) => (
              <span key={c.id ?? i} className="h-2 w-2 rounded-full ring-1 ring-white" style={{ backgroundColor: posted ? '#9ca3af' : c.color }} />
            ))}
          </span>
          <span className="truncate text-[10px] font-bold uppercase tracking-wide" style={{ color: posted ? undefined : missed ? '#dc2626' : primaryColor }}>
            {companyLabel}{showChannelLabel ? ` · ${channelLabel}` : ''}
          </span>
          {missed && (
            <span className="flex-shrink-0 rounded bg-red-600 px-1 text-[9px] font-bold uppercase tracking-wide text-white">
              Missed
            </span>
          )}
        </span>
        <span className="flex flex-shrink-0 items-center gap-1">
          {item.recurrence_group_id && <Repeat className="h-3 w-3 text-muted-foreground" />}
          {item.is_highlighted && <Sparkles className="h-3 w-3" style={{ color: primaryColor }} />}
          <button type="button" disabled={busy}
            onClick={e => { e.stopPropagation(); onToggle() }}
            aria-label={posted ? 'Mark as not posted' : 'Mark as posted'}
            className={cn('rounded-full transition-colors',
              posted ? 'text-green-600' : missed ? 'text-red-500 hover:text-green-600' : 'text-muted-foreground/60 hover:text-foreground')}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" />
                  : posted ? <CheckCircle2 className="h-4 w-4" />
                  : missed ? <XCircle className="h-4 w-4" />
                           : <Circle className="h-4 w-4" />}
          </button>
        </span>
      </div>
      <p className={cn('mt-1.5 break-words text-[13px] font-semibold leading-snug [overflow-wrap:anywhere]',
        posted && 'line-through decoration-2')}>
        {item.content}
      </p>
      {missed && (
        <button type="button"
          onClick={e => { e.stopPropagation(); onEditReason() }}
          className={cn('mt-1.5 flex w-full items-start gap-1 rounded border border-red-200 bg-white/60 px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-white',
            note ? 'text-red-700' : 'text-red-500/80')}>
          <Pencil className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span className="break-words [overflow-wrap:anywhere]">{note ? note : 'Add reason'}</span>
        </button>
      )}
    </div>
  )
}

/* ─── component ──────────────────────────────────────────────────────── */

export default function MarketingCalendar({ userId, userName, isAdmin = false }: MarketingCalendarProps) {
  const supabase = createClient()
  const [items,         setItems]         = useState<MarketingCalendarItem[]>([])
  // Every stored completion row (posted or missed), keyed by item id. Absence of a
  // row means pending — or, for a past item, auto-"missed" (computed in stateOf).
  const [statusByItem,  setStatusByItem]  = useState<Map<string, MarketingCalendarCheck>>(new Map())
  const [checkUserId,   setCheckUserId]   = useState(userId)
  const [checkUserName, setCheckUserName] = useState(userName)
  const [kaylaId,       setKaylaId]       = useState<string | null>(null)
  const [weekStart,     setWeekStart]     = useState(() => startOfWeek(new Date()))
  const [loading,       setLoading]       = useState(true)
  const [busyItemId,    setBusyItemId]    = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)

  // Companies (business units) — dynamic, managed from the Super Admin page.
  const [companies,        setCompanies]        = useState<Company[]>([])
  // Which companies are shown in the board/grid. Mix-and-match — e.g. SRG + AGC.
  const [activeCompanyIds, setActiveCompanyIds] = useState<string[]>([])

  // Shared, editable channel list (loaded from marketing_channels). Flat —
  // channels don't belong to a company; which companies an event is for is
  // decided per-event.
  const [channels, setChannels] = useState<Channel[]>([])

  // Week board vs channel grid (localStorage)
  const [viewMode, setViewModeState] = useState<ViewMode>(loadViewMode)
  const setViewMode = (next: ViewMode) => {
    setViewModeState(next)
    try { localStorage.setItem(LS_VIEW_KEY, next) } catch { /* ignore */ }
  }

  // Create-event dialog. Channels are multi-select (one event per channel).
  const [createOpen,       setCreateOpen]       = useState(false)
  const [newDate,          setNewDate]          = useState(toInputDate(new Date()))
  const [newCompanyIds,    setNewCompanyIds]    = useState<string[]>([])
  const [newChannels,      setNewChannels]      = useState<string[]>([])
  const [newContent,       setNewContent]       = useState('')
  const [newHighlighted,   setNewHighlighted]   = useState(false)
  const [newRecurrence,    setNewRecurrence]    = useState<RecurrencePattern>('none')
  const [newEndDate,       setNewEndDate]       = useState(toInputDate(addDays(new Date(), 28)))
  const [creating,         setCreating]         = useState(false)

  // Edit-event dialog (single channel). Editing a recurring instance updates
  // every instance in its series (content/highlight/companies), per how this
  // team wants recurring edits to behave.
  const [editItem,         setEditItem]         = useState<MarketingCalendarItem | null>(null)
  const [editDate,         setEditDate]         = useState('')
  const [editCompanyIds,   setEditCompanyIds]   = useState<string[]>([])
  const [editChannel,      setEditChannel]      = useState('')
  const [editContent,      setEditContent]      = useState('')
  const [editHighlighted,  setEditHighlighted]  = useState(false)
  const [savingEdit,       setSavingEdit]       = useState(false)

  // Drag-and-drop reschedule
  const [draggingId,  setDraggingId]  = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  // Agenda "show past" toggle
  const [showPast, setShowPast] = useState(false)

  // "Why was this missed?" dialog
  const [reasonItem,   setReasonItem]   = useState<MarketingCalendarItem | null>(null)
  const [reasonText,   setReasonText]   = useState('')
  const [savingReason, setSavingReason] = useState(false)

  const loadCalendar = useCallback(async () => {
    setLoading(true)
    setError(null)
    let targetUserId = userId
    let targetUserName = userName

    if (isAdmin) {
      const { data: kaylaProfile, error: profileError } = await supabase
        .from('profiles').select('id,full_name,email').ilike('email', KAYLA_EMAIL).maybeSingle()
      if (profileError || !kaylaProfile) {
        setItems([]); setStatusByItem(new Map()); setLoading(false)
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
        .select('id,date,day_label,channel,content,is_highlighted,position,source_sheet,recurrence_group_id,marketing_calendar_item_companies(company:companies(id,code,name,color))')
        .eq('assigned_to', targetUserId)
        .order('date', { ascending: true })
        .order('position', { ascending: true }),
      supabase.from('marketing_calendar_checks')
        .select('id,item_id,checked_at,status,note').eq('user_id', targetUserId),
    ])

    setLoading(false)
    if (itemsError || checksError) { setError('Marketing calendar is not ready yet.'); return }
    const mapped = ((itemRows ?? []) as any[]).map((row): MarketingCalendarItem => ({
      id: row.id,
      date: row.date,
      day_label: row.day_label,
      channel: row.channel,
      content: row.content,
      is_highlighted: row.is_highlighted,
      position: row.position,
      source_sheet: row.source_sheet,
      recurrence_group_id: row.recurrence_group_id,
      companies: (row.marketing_calendar_item_companies ?? []).map((r: any) => r.company).filter(Boolean),
    }))
    setItems(mapped)
    // Older rows created before the status column default to 'posted'.
    setStatusByItem(new Map(((checkRows ?? []) as any[]).map(c => [
      c.item_id,
      { ...c, status: (c.status ?? 'posted') as CheckStatus, note: c.note ?? null } as MarketingCalendarCheck,
    ])))
  }, [isAdmin, supabase, userId, userName])

  useEffect(() => { loadCalendar() }, [loadCalendar])

  // Load companies. Defaults the active filter to "everything" the first
  // time only, so a later refresh doesn't clobber a filter the user already set.
  const loadCompanies = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('id,code,name,color,position,is_archived')
      .order('position', { ascending: true })
    if (!data) return
    const active = (data as Array<Company & { position: number; is_archived: boolean }>).filter(c => !c.is_archived)
    setCompanies(active)
    setActiveCompanyIds(prev => prev.length === 0 ? active.map(c => c.id) : prev)
  }, [supabase])

  useEffect(() => { loadCompanies() }, [loadCompanies])

  // Load the shared, flat channel list.
  const loadChannels = useCallback(async () => {
    const { data } = await supabase
      .from('marketing_channels')
      .select('channel,label,is_archived,position')
      .order('position', { ascending: true })
    if (!data) return
    setChannels(
      (data as Array<Channel & { is_archived?: boolean }>)
        .filter(c => !c.is_archived)
        .map(({ channel, label }) => ({ channel, label })),
    )
  }, [supabase])

  useEffect(() => { loadChannels() }, [loadChannels])

  // Add a new shared channel. Channels are lightweight and not tied to a
  // company, so any signed-in user can add one (RLS enforces this).
  const handleAddChannel = useCallback(async (name: string): Promise<boolean> => {
    const channel = name.trim()
    if (!channel) return false
    const position = channels.length
    const { error: insErr } = await supabase
      .from('marketing_channels')
      .insert({ channel, label: channel, position })
    if (insErr) {
      toast.error('Could not add channel', {
        description: insErr.code === '23505' ? 'That channel already exists.' : insErr.message,
      })
      return false
    }
    await loadChannels()
    toast.success(`Added "${channel}"`)
    return true
  }, [channels.length, loadChannels, supabase])

  /* ── computed views ─────────────────────────────────────────────── */

  const companyVisible = useCallback(
    (itemCompanies: Company[]) =>
      activeCompanyIds.length === 0 || itemCompanies.some(c => activeCompanyIds.includes(c.id)),
    [activeCompanyIds],
  )

  const visibleItems = useMemo(() =>
    items.filter(i => companyVisible(i.companies)),
  [items, companyVisible])

  const weekDays    = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const weekKeys    = useMemo(() => new Set(weekDays.map(toDateKey)), [weekDays])
  const weekItems   = visibleItems.filter(i => weekKeys.has(i.date))

  const itemsByDateChannel = useMemo(() => {
    const m = new Map<string, MarketingCalendarItem[]>()
    for (const item of visibleItems) {
      if (!weekKeys.has(item.date)) continue
      const key = itemKey(item.date, item.channel)
      const arr = m.get(key) ?? []
      arr.push(item)
      m.set(key, arr)
    }
    for (const arr of m.values()) arr.sort((a, b) => a.position - b.position)
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
      arr.sort((a, b) => a.channel.localeCompare(b.channel) || a.position - b.position)
    }
    return m
  }, [visibleItems, weekKeys])

  const todayKey  = toDateKey(new Date())

  // Posted if stored so; missed if stored so OR if the date has already passed with
  // no posted row; otherwise pending. This is the single source of truth for a cell's
  // visual state and the counts.
  const stateOf = (item: MarketingCalendarItem): PostState => {
    const row = statusByItem.get(item.id)
    if (row?.status === 'posted') return 'posted'
    if (row?.status === 'missed') return 'missed'
    return item.date < todayKey ? 'missed' : 'pending'
  }
  const isPosted = (item: MarketingCalendarItem) => statusByItem.get(item.id)?.status === 'posted'
  const noteOf = (item: MarketingCalendarItem) => statusByItem.get(item.id)?.note ?? null

  const totalVisible = visibleItems.length
  const checkedVisible = visibleItems.filter(isPosted).length
  const missedVisible = visibleItems.filter(i => stateOf(i) === 'missed').length
  const checkedWeek = weekItems.filter(isPosted).length
  const completionPercent = totalVisible ? Math.round((checkedVisible / totalVisible) * 100) : 0

  const weekLabel = `${dateFormatter.format(weekDays[0])} – ${dateFormatter.format(weekDays[6])}`

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

  /* ── set / clear completion status ──────────────────────────────── */
  // 'clear' deletes the row (back to pending, or auto-missed for a past date).
  // 'posted'/'missed' upsert the row; marking posted wipes any missed reason.
  const setStatus = async (item: MarketingCalendarItem, next: CheckStatus | 'clear', note: string | null = null) => {
    if (busyItemId) return
    const previous = new Map(statusByItem)
    setBusyItemId(item.id)

    if (next === 'clear') {
      setStatusByItem(cur => { const n = new Map(cur); n.delete(item.id); return n })
      const { error: e } = await supabase.from('marketing_calendar_checks')
        .delete().eq('item_id', item.id).eq('user_id', checkUserId)
      if (e) { setStatusByItem(previous); setError('Could not update this item.') }
    } else {
      setStatusByItem(cur => new Map(cur).set(item.id, { id: `opt-${item.id}`, item_id: item.id, checked_at: new Date().toISOString(), status: next, note }))
      const { data, error: e } = await supabase.from('marketing_calendar_checks')
        .upsert({ item_id: item.id, user_id: checkUserId, status: next, note }, { onConflict: 'item_id,user_id' })
        .select('id,item_id,checked_at,status,note').single()
      if (e || !data) { setStatusByItem(previous); setError('Could not update this item.') }
      else setStatusByItem(cur => new Map(cur).set(item.id, data as MarketingCalendarCheck))
    }
    setBusyItemId(null)
  }

  // The circle button just toggles "posted". Everything else (missed, reasons) is
  // driven by the reason dialog and the auto-missed rule.
  const toggleItem = (item: MarketingCalendarItem) =>
    setStatus(item, isPosted(item) ? 'clear' : 'posted')

  const openReasonDialog = (item: MarketingCalendarItem) => {
    setReasonItem(item)
    setReasonText(noteOf(item) ?? '')
  }
  const handleSaveReason = async () => {
    if (!reasonItem) return
    setSavingReason(true)
    await setStatus(reasonItem, 'missed', reasonText.trim() || null)
    setSavingReason(false)
    setReasonItem(null)
  }
  // Remove the stored miss entirely — reverts to auto (still red if past) with no reason.
  const handleClearReason = async () => {
    if (!reasonItem) return
    setSavingReason(true)
    await setStatus(reasonItem, 'clear')
    setSavingReason(false)
    setReasonItem(null)
  }

  /* ── create event ───────────────────────────────────────────────── */
  const toggleNewCompany = (id: string) =>
    setNewCompanyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const toggleNewChannel = (channel: string) =>
    setNewChannels(prev => prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel])

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newContent.trim() || !kaylaId || newChannels.length === 0 || newCompanyIds.length === 0) return
    setCreating(true)

    const startDate = parseDate(newDate)
    const endDate   = newRecurrence === 'none' ? startDate : parseDate(newEndDate)
    const dates     = generateDates(startDate, newRecurrence, endDate)
    // Give every row from this submission a shared id when it's a recurring
    // series, so editing any single instance can update them all later.
    const recurrenceGroupId = newRecurrence !== 'none' ? crypto.randomUUID() : null

    const rows = dates.flatMap((d, i) =>
      newChannels.map(channel => ({
        assigned_to:    kaylaId,
        date:           toDateKey(d),
        day_label:      ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()],
        channel,
        content:        newContent.trim(),
        is_highlighted: newHighlighted,
        position:       i,
        source_sheet:   null,
        source_row:     null,
        source_column:  null,
        recurrence_group_id: recurrenceGroupId,
      })),
    )

    const { data: inserted, error: insertErr } = await supabase.from('marketing_calendar_items').insert(rows).select('id')

    if (insertErr || !inserted) {
      setCreating(false)
      toast.error('Could not create event', { description: insertErr?.message })
      return
    }

    const companyRows = inserted.flatMap((row: { id: string }) => newCompanyIds.map(companyId => ({ item_id: row.id, company_id: companyId })))
    const { error: compErr } = await supabase.from('marketing_calendar_item_companies').insert(companyRows)
    setCreating(false)

    if (compErr) {
      toast.error('Event created, but companies could not be attached', { description: compErr.message })
    } else {
      toast.success(`Created ${inserted.length} event${inserted.length > 1 ? 's' : ''}`)
    }
    setCreateOpen(false)
    setNewContent('')
    setNewHighlighted(false)
    setNewRecurrence('none')
    loadCalendar()
  }

  // Open the create dialog, optionally pre-selecting a date and channel
  // (used when clicking an empty cell in the grid or an empty day column).
  const openCreateDialog = (opts?: { date?: string; channel?: string }) => {
    setNewDate(opts?.date ?? toInputDate(new Date()))
    setNewContent('')
    setNewHighlighted(false)
    setNewRecurrence('none')
    setNewCompanyIds([])
    setNewChannels(opts?.channel ? [opts.channel] : [])
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
    setEditCompanyIds(item.companies.map(c => c.id))
    setEditChannel(item.channel)
    setEditContent(item.content)
    setEditHighlighted(item.is_highlighted)
  }

  const toggleEditCompany = (id: string) =>
    setEditCompanyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editItem || !editContent.trim() || !editChannel || editCompanyIds.length === 0) return
    setSavingEdit(true)

    const dayLabel = ['SUN','MON','TUE','WED','THU','FRI','SAT'][parseDate(editDate).getDay()]
    const { error: e2 } = await supabase.from('marketing_calendar_items').update({
      date:           editDate,
      day_label:      dayLabel,
      channel:        editChannel,
      content:        editContent.trim(),
      is_highlighted: editHighlighted,
    }).eq('id', editItem.id)

    if (e2) {
      setSavingEdit(false)
      toast.error('Could not update event', { description: e2.message })
      return
    }

    await supabase.from('marketing_calendar_item_companies').delete().eq('item_id', editItem.id)
    await supabase.from('marketing_calendar_item_companies')
      .insert(editCompanyIds.map(companyId => ({ item_id: editItem.id, company_id: companyId })))

    // Editing any instance of a recurring series updates content/highlight/
    // companies on every instance in that series (not its date or channel,
    // which stay per-instance).
    let updatedAll = false
    if (editItem.recurrence_group_id) {
      const { data: siblings } = await supabase
        .from('marketing_calendar_items')
        .select('id')
        .eq('recurrence_group_id', editItem.recurrence_group_id)
        .neq('id', editItem.id)
      const siblingIds = (siblings ?? []).map((s: { id: string }) => s.id)
      if (siblingIds.length) {
        await supabase.from('marketing_calendar_items')
          .update({ content: editContent.trim(), is_highlighted: editHighlighted })
          .in('id', siblingIds)
        await supabase.from('marketing_calendar_item_companies').delete().in('item_id', siblingIds)
        const rows = siblingIds.flatMap((id: string) => editCompanyIds.map(companyId => ({ item_id: id, company_id: companyId })))
        if (rows.length) await supabase.from('marketing_calendar_item_companies').insert(rows)
        updatedAll = true
      }
    }

    setSavingEdit(false)
    toast.success(updatedAll ? 'Updated this event and all repeats' : 'Event updated')
    setEditItem(null)
    loadCalendar()
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

  const moveItem = async (item: MarketingCalendarItem, date: string, channel: string) => {
    if (item.date === date && item.channel === channel) return

    const dayLabel = ['SUN','MON','TUE','WED','THU','FRI','SAT'][parseDate(date).getDay()]
    const previous = items
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, date, channel, day_label: dayLabel } : i))

    const { error: e3 } = await supabase.from('marketing_calendar_items')
      .update({ date, channel, day_label: dayLabel }).eq('id', item.id)
    if (e3) {
      setItems(previous)
      toast.error('Could not move event', { description: e3.message })
    } else {
      toast.success('Event moved')
    }
  }

  const handleCellDrop = (date: string, channel: string) => async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverKey(null)
    const itemId = e.dataTransfer.getData('text/plain')
    const item = items.find(i => i.id === itemId)
    if (!item || !isEditable(item)) return
    setDraggingId(null)
    await moveItem(item, date, channel)
  }

  // Week-board drop: reschedule to another day, keeping channel.
  const handleDayDrop = (date: string) => async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOverKey(null)
    const itemId = e.dataTransfer.getData('text/plain')
    const item = items.find(i => i.id === itemId)
    if (!item || !isEditable(item)) return
    setDraggingId(null)
    await moveItem(item, date, item.channel)
  }

  const resetToToday = () => setWeekStart(startOfWeek(new Date()))

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
            {/* Company filter — mix and match (e.g. SRG + AGC). "All" selects every company. */}
            <Button type="button" size="sm" variant={activeCompanyIds.length === companies.length ? 'default' : 'outline'}
              onClick={() => setActiveCompanyIds(companies.map(c => c.id))} className="min-w-14">
              All
            </Button>
            {companies.map(c => {
              const on = activeCompanyIds.includes(c.id)
              const isolated = on && activeCompanyIds.length < companies.length
              return (
                <Button key={c.id} type="button" size="sm"
                  variant={isolated ? 'default' : 'outline'}
                  onClick={() => setActiveCompanyIds(prev => {
                    const next = prev.includes(c.id) ? prev.filter(x => x !== c.id) : [...prev, c.id]
                    return next.length === 0 ? companies.map(co => co.id) : next
                  })}
                  className="min-w-14"
                  style={isolated ? { backgroundColor: c.color, borderColor: c.color } : {}}>
                  {c.code}
                </Button>
              )
            })}
            <Button variant="outline" size="icon" onClick={() => { loadCalendar(); loadChannels(); loadCompanies() }} aria-label="Refresh calendar">
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* New event */}
            <Button size="sm" onClick={() => openCreateDialog()} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New event
            </Button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
      </div>

      {items.length === 0 && (
        <div className="border-b px-4 py-3 text-sm text-muted-foreground sm:px-6">
          Marketing calendar is empty. Click any slot below (or &quot;New event&quot;) to add one.
        </div>
      )}
      <>
          {/* ── Week board ───────────────────────────────────────────── */}
          {viewMode === 'week' && (
            <div className="overflow-x-auto">
              <div className="grid min-w-[1080px] grid-cols-7 divide-x">
                {weekDays.map(date => {
                  const dateKey    = toDateKey(date)
                  const dayItems   = weekItemsByDate.get(dateKey) ?? []
                  const dayDone    = dayItems.filter(isPosted).length
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
                          const busy     = item.id === busyItemId
                          const editable = isEditable(item)
                          const chLabel  = channels.find(c => c.channel === item.channel)?.label ?? item.channel

                          return (
                            <EventEntry
                              key={item.id}
                              item={item}
                              state={stateOf(item)}
                              note={noteOf(item)}
                              busy={busy}
                              editable={editable}
                              dragging={draggingId === item.id}
                              showChannelLabel
                              channelLabel={chLabel}
                              onOpen={() => editable ? openEditDialog(item) : toggleItem(item)}
                              onToggle={() => toggleItem(item)}
                              onEditReason={() => openReasonDialog(item)}
                              onDragStart={handleDragStart(item)}
                              onDragEnd={handleDragEnd}
                            />
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
                  <th className="sticky left-0 z-30 w-[142px] border-b border-r bg-[#111] px-3 py-2 text-left text-xs font-bold uppercase text-white">
                    Date
                  </th>
                  {channels.map(ch => (
                    <th key={ch.channel}
                      className="w-[150px] border-b border-r bg-[#151515] px-2 py-2 text-center text-xs font-semibold text-white">
                      {ch.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekDays.map(date => {
                  const dateKey = toDateKey(date)
                  const dayItems = weekItems.filter(i => i.date === dateKey)
                  const dayDone  = dayItems.filter(isPosted).length
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
                      {channels.map(ch => {
                        const cellItems = itemsByDateChannel.get(itemKey(dateKey, ch.channel)) ?? []
                        const cellKey   = itemKey(dateKey, ch.channel)
                        const isDragOver = dragOverKey === cellKey

                        return (
                          <td key={cellKey}
                            className={cn('min-h-[96px] border-b border-r bg-background p-1.5 align-top transition-colors',
                              isDragOver && 'bg-primary/10 ring-2 ring-inset ring-primary/40')}
                            onDragOver={handleCellDragOver(cellKey)}
                            onDragLeave={() => setDragOverKey(cur => cur === cellKey ? null : cur)}
                            onDrop={handleCellDrop(dateKey, ch.channel)}>
                            <div className="flex min-h-[78px] flex-col gap-1.5">
                              {cellItems.map(item => {
                                const busy     = item.id === busyItemId
                                const editable = isEditable(item)
                                return (
                                  <EventEntry
                                    key={item.id}
                                    item={item}
                                    state={stateOf(item)}
                                    note={noteOf(item)}
                                    busy={busy}
                                    editable={editable}
                                    dragging={draggingId === item.id}
                                    showChannelLabel={false}
                                    channelLabel={ch.label}
                                    onOpen={() => editable ? openEditDialog(item) : toggleItem(item)}
                                    onToggle={() => toggleItem(item)}
                                    onEditReason={() => openReasonDialog(item)}
                                    onDragStart={handleDragStart(item)}
                                    onDragEnd={handleDragEnd}
                                  />
                                )
                              })}
                              <button type="button"
                                onClick={() => openCreateDialog({ date: dateKey, channel: ch.channel })}
                                className={cn('group flex min-h-[36px] flex-1 items-center justify-center rounded-md border border-dashed bg-[#fafafa] text-muted-foreground/40 transition-colors hover:border-foreground/30 hover:text-foreground')}>
                                <Plus className="h-4 w-4 opacity-0 transition-opacity group-hover:opacity-100" />
                              </button>
                            </div>
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
                {missedVisible > 0 && (
                  <Badge variant="outline" className="gap-1 border-red-300 text-red-600">
                    <XCircle className="h-3 w-3" />
                    {missedVisible} missed
                  </Badge>
                )}
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
                  const dayDone  = dayItems.filter(isPosted).length
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
                          const state    = stateOf(item)
                          const posted   = state === 'posted'
                          const missed   = state === 'missed'
                          const note     = noteOf(item)
                          const editable = isEditable(item)
                          const primaryColor = item.companies[0]?.color ?? '#64748b'

                          return (
                            <div key={item.id} className={cn('group flex items-center gap-3 px-3 py-2.5 transition-colors',
                              posted ? 'bg-muted/40' : missed ? 'bg-red-50' : 'hover:bg-accent/40')}>
                              {/* Status toggle (marks posted) */}
                              <button type="button" disabled={busyItemId === item.id} onClick={() => toggleItem(item)}
                                aria-label={posted ? 'Mark as not posted' : 'Mark as posted'}
                                className={cn('flex-shrink-0 transition-colors',
                                  posted ? 'text-green-600' : missed ? 'text-red-500 hover:text-green-600' : 'text-muted-foreground hover:text-foreground')}>
                                {busyItemId === item.id ? <Loader2 className="h-4 w-4 animate-spin" />
                                  : posted ? <CheckCircle2 className="h-4 w-4" />
                                  : missed ? <XCircle className="h-4 w-4" />
                                           : <Circle className="h-4 w-4" />}
                              </button>

                              {/* Company dot(s) */}
                              <div className="flex flex-shrink-0 -space-x-0.5">
                                {(item.companies.length ? item.companies : [{ id: 'none', color: '#9ca3af' }]).slice(0, 3).map((c, i) => (
                                  <div key={c.id ?? i} className="h-2 w-2 rounded-full ring-1 ring-background" style={{ backgroundColor: c.color }} />
                                ))}
                              </div>

                              {/* Channel chip */}
                              <span className="flex-shrink-0 rounded border px-1.5 py-0.5 text-[11px] font-semibold"
                                style={{ borderColor: withAlpha(primaryColor, 0.5), backgroundColor: withAlpha(primaryColor, 0.08), color: primaryColor }}>
                                {item.channel}
                              </span>

                              {/* Content + reason */}
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span
                                  onClick={() => editable && openEditDialog(item)}
                                  className={cn('truncate text-sm', editable && 'cursor-pointer hover:underline',
                                    posted && 'text-muted-foreground line-through decoration-2',
                                    missed && 'text-red-700')}>
                                  {item.content}
                                </span>
                                {missed && (
                                  <button type="button" onClick={() => openReasonDialog(item)}
                                    className={cn('mt-0.5 flex items-center gap-1 text-left text-[11px] transition-colors hover:underline',
                                      note ? 'text-red-700' : 'text-red-500/80')}>
                                    <Pencil className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{note ? note : 'Add reason'}</span>
                                  </button>
                                )}
                              </span>

                              {/* Badges */}
                              <div className="flex flex-shrink-0 items-center gap-1.5">
                                {missed && (
                                  <span className="rounded bg-red-600 px-1 text-[9px] font-bold uppercase tracking-wide text-white">Missed</span>
                                )}
                                {item.recurrence_group_id && <Repeat className="h-3.5 w-3.5 text-muted-foreground" />}
                                {item.is_highlighted && <Sparkles className="h-3.5 w-3.5" style={{ color: primaryColor }} />}
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
              companies={companies} selectedCompanyIds={newCompanyIds} onToggleCompany={toggleNewCompany}
              channels={channels} selectedChannels={newChannels} onToggleChannel={toggleNewChannel} multiChannel
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
              {newRecurrence !== 'none' && (
                <p className="text-xs text-muted-foreground">Editing any post in this series later updates them all.</p>
              )}
            </div>

            {newRecurrence !== 'none' && (
              <div className="space-y-1.5">
                <Label>Repeat until</Label>
                <Input type="date" value={newEndDate} min={newDate}
                  onChange={e => setNewEndDate(e.target.value)} required />
                <p className="text-xs text-muted-foreground">
                  Will create {generateDates(parseDate(newDate), newRecurrence, parseDate(newEndDate)).length * Math.max(newChannels.length, 1)} event{generateDates(parseDate(newDate), newRecurrence, parseDate(newEndDate)).length * Math.max(newChannels.length, 1) !== 1 ? 's' : ''}
                </p>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={creating || !newContent.trim() || newChannels.length === 0 || newCompanyIds.length === 0}>
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : `Create${newChannels.length > 1 ? ` (${newChannels.length})` : ''}`}
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
              {editItem?.recurrence_group_id && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Repeat className="h-3 w-3" /> Repeating
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          {editItem && (
            <form onSubmit={handleSaveEdit} className="space-y-4">
              {editItem.recurrence_group_id && (
                <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  This post repeats. Saving updates the content, companies, and campaign-block flag on every post in this series — the date and channel here only change this one.
                </p>
              )}
              <EventFormFields
                date={editDate} onDateChange={setEditDate}
                content={editContent} onContentChange={setEditContent}
                highlighted={editHighlighted} onToggleHighlighted={() => setEditHighlighted(h => !h)}
                companies={companies} selectedCompanyIds={editCompanyIds} onToggleCompany={toggleEditCompany}
                channels={channels} selectedChannels={editChannel ? [editChannel] : []}
                onToggleChannel={channel => setEditChannel(channel)}
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
                <Button type="submit" className="flex-1" disabled={savingEdit || !editContent.trim() || !editChannel || editCompanyIds.length === 0}>
                  {savingEdit ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Missed Reason Dialog ─────────────────────────────────────── */}
      <Dialog open={!!reasonItem} onOpenChange={open => !open && setReasonItem(null)}>
        <DialogContent className="force-light-theme max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600" /> Why was this missed?
            </DialogTitle>
          </DialogHeader>
          {reasonItem && (
            <div className="space-y-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-sm">
                <p className="font-semibold">{reasonItem.content}</p>
                <p className="text-xs text-muted-foreground">
                  {fullDateFormatter.format(parseDate(reasonItem.date))} · {reasonItem.channel}
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Reason (optional)</Label>
                <Textarea
                  value={reasonText}
                  onChange={e => setReasonText(e.target.value)}
                  placeholder="e.g. client delayed approval, asset not ready…"
                  rows={3}
                  autoFocus
                />
                <p className="text-xs text-muted-foreground">
                  Marking it posted later clears this automatically.
                </p>
              </div>
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={handleClearReason} disabled={savingReason}>
                  Clear
                </Button>
                <Button type="button" className="flex-1" onClick={handleSaveReason} disabled={savingReason}>
                  {savingReason ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save reason'}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  )
}
