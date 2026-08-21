'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  CalendarRange,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Columns3,
  Download,
  FileText,
  ImageIcon,
  Loader2,
  Megaphone,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Repeat,
  Settings,
  SlidersHorizontal,
  Sparkles,
  Table2,
  Trash2,
  Upload,
  X,
  XCircle,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import { autoTextColor as autoText, compositeOver, readableInk, withAlpha } from '@/lib/color'
import { useSurface } from '@/lib/use-surface'
import {
  buildMarketingAssetPath,
  formatMarketingAssetSize,
  isMarketingAssetPreviewable,
  MARKETING_ASSET_ACCEPT,
  MARKETING_ASSET_BUCKET,
  resolveMarketingAssetMimeType,
  validateMarketingAsset,
} from '@/lib/marketing-assets'
import { toast } from 'sonner'
import { ScheduleDateGrid } from './schedule-date-grid'
import {
  buildCustomWeekdayDateKeys,
  buildRecurringDateKeys,
  buildRecurringSeriesScheduleUpdates,
  centeredScrollLeft,
  dayLabelForDateKey,
  isImportedWeekendPlaceholder,
  MAX_SCHEDULED_MARKETING_POSTS,
  moveListItem,
  type MarketingRecurrencePattern,
  reconcileCompanySelection,
  toggleCompanySelection,
} from './marketing-calendar-state'
import MarketingCalendarManagement from '../admin/marketing-calendar-management'
import ChannelManager from './channel-manager'
import type { MarketingCalendarSummary } from '@/lib/use-marketing-calendars'

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

export interface Channel {
  id: string
  channel: string
  label: string
  /** Column order in the channel grid. Shared - see reorderChannels below. */
  position: number
  /** Switched off: keeps its events, but no longer occupies a column. */
  is_archived: boolean
}

interface MarketingCalendarItem {
  id: string
  date: string
  time: string | null
  day_label: string
  channel: string
  content: string
  is_highlighted: boolean
  position: number
  source_sheet?: string | null
  recurrence_group_id?: string | null
  companies: Company[]
  attachment: MarketingCalendarAttachment | null
}

interface MarketingCalendarAttachment {
  id: string
  item_id: string
  storage_path: string
  file_name: string
  mime_type: string
  file_size: number
  created_at: string
}

interface MarketingCalendarCheck {
  id: string
  item_id: string
  user_id: string
  checked_at: string
  status: CheckStatus
  note: string | null
}

// A calendar is shared, so "was this posted?" is a fact about the item, not about
// the viewer. Rows are still stored per (item_id, user_id), so one item can carry a
// mark from each member - collapse them into the one state the whole calendar sees:
// any 'posted' beats a 'missed' (someone did it), and within the same status the most
// recent mark wins. Without this, a member who never ticked anything off saw an empty
// check set and every past item fell through to auto-missed.
function resolveCheck(a: MarketingCalendarCheck, b: MarketingCalendarCheck): MarketingCalendarCheck {
  if (a.status !== b.status) return a.status === 'posted' ? a : b
  return a.checked_at >= b.checked_at ? a : b
}

interface MarketingCalendarProps {
  userId: string
  userName?: string
  isAdmin?: boolean
  // Every calendar the caller can see (RLS: admins see all, everyone else sees only their
  // memberships) - fetched once by the parent dashboard via useMarketingCalendars() so both the
  // tab-gating check and this component's switcher share one query instead of two.
  calendars: MarketingCalendarSummary[]
  refetchCalendars: () => Promise<void>
}

const LS_VIEW_KEY = 'marketing_calendar_view'
// Attaching a file at creation time fans it out to every instance the submission
// creates (recurrence x channels); cap it well below MAX_SCHEDULED_MARKETING_POSTS
// so a large recurring series can't re-upload the same file hundreds of times.
const MAX_CREATE_ATTACHMENT_FANOUT = 25

type ViewMode = 'week' | 'month' | 'grid'
type EditScope = 'single' | 'series'

const RECURRENCE_LABELS: Record<MarketingRecurrencePattern, string> = {
  none:      'No repeat',
  daily:     'Daily',
  weekly:    'Weekly',
  biweekly:  'Every 2 weeks',
  monthly:   'Monthly',
  quarterly: 'Quarterly',
  custom:    'Custom',
}

// Sunday-first, matching restriction-dialog.tsx's weekday row and the
// 0=Sunday convention buildCustomWeekdayDateKeys expects.
const WEEKDAYS = [
  { value: 0, label: 'Sun' },
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
]

// Above this many generated dates, the interactive per-date skip checklist
// stops rendering (perf + usability - pruning a large series one row at a
// time is worse than the already-solved single-occurrence-delete path).
// Manual additions stay available either way since those are one explicit
// action at a time, not a per-row render cost.
const MAX_INTERACTIVE_SCHEDULE_PREVIEW = 60

/* ─── view-mode persistence ────────────────────────────────────────────── */

function loadViewMode(): ViewMode {
  if (typeof window === 'undefined') return 'week'
  try {
    const raw = localStorage.getItem(LS_VIEW_KEY)
    if (raw === 'week' || raw === 'month' || raw === 'grid') return raw
  } catch { /* ignore */ }
  return 'week'
}

/* ─── date utilities ──────────────────────────────────────────────────── */

const dateFormatter     = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
const fullDateFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
const monthFormatter    = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' })

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
function shiftCalendarMonth(date: Date, months: number) {
  const day = date.getDate()
  const shifted = new Date(date)
  shifted.setDate(1)
  shifted.setMonth(shifted.getMonth() + months)
  const lastDay = new Date(shifted.getFullYear(), shifted.getMonth() + 1, 0).getDate()
  shifted.setDate(Math.min(day, lastDay))
  return shifted
}
function monthGridDays(date: Date) {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1)
  const firstVisible = startOfWeek(firstOfMonth)
  return Array.from({ length: 42 }, (_, index) => addDays(firstVisible, index))
}

function itemKey(date: string, channel: string) {
  return `${date}::${channel}`
}

/* ─── shared create/edit form fields ────────────────────────────────── */

interface EventFormFieldsProps {
  date: string
  onDateChange: (v: string) => void
  time: string
  onTimeChange: (v: string) => void
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
  date, onDateChange, time, onTimeChange, content, onContentChange, highlighted, onToggleHighlighted,
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
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>Date</Label>
          <Input type="date" value={date} onChange={e => onDateChange(e.target.value)} required />
        </div>
        <div className="space-y-1.5">
          <Label>Time <span className="font-normal text-muted-foreground">(optional)</span></Label>
          <Input type="time" value={time} onChange={e => onTimeChange(e.target.value)} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>Companies</Label>
        <div className="flex flex-wrap gap-1.5">
          {companies.map(c => {
            const isOn = selectedCompanySet.has(c.id)
            return (
              <button key={c.id} type="button" onClick={() => onToggleCompany(c.id)}
                className={cn('rounded border px-2.5 py-1 text-xs font-bold transition-colors',
                  !isOn && 'bg-background text-foreground hover:bg-accent')}
                // Text colour is derived from the company colour rather than pinned to white:
                // a light swatch (the yellow business unit) rendered white-on-yellow.
                style={isOn ? { backgroundColor: c.color, borderColor: c.color, color: autoText(c.color) } : {}}>
                {c.code}
              </button>
            )
          })}
          {companies.length === 0 && (
            <p className="text-xs text-muted-foreground">No companies yet. Add one from the Super Admin page.</p>
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
            highlighted ? 'bg-amber-100 border-amber-400 text-amber-800 dark:bg-amber-950/60 dark:border-amber-700 dark:text-amber-300' : 'bg-background hover:bg-accent')}>
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
  onOpenAttachment: () => void
  onToggle: () => void
  onEditReason: () => void
  onDragStart: (e: React.DragEvent) => void
  onDragEnd: () => void
}

function EventEntry({
  item, state, note, busy, editable, dragging, showChannelLabel, channelLabel,
  onOpen, onOpenAttachment, onToggle, onEditReason, onDragStart, onDragEnd,
}: EventEntryProps) {
  const posted = state === 'posted'
  const missed = state === 'missed'
  const primaryColor = item.companies[0]?.color ?? '#64748b'
  const companyLabel = item.companies.length ? item.companies.map(c => c.code).join(' + ') : 'No company'
  // A company picks its own brand hex, and it is rendered as 10px uppercase text - the
  // strictest contrast case in the calendar. Lift it against whichever surface this card
  // actually paints rather than trusting that a colour chosen on white survives dark mode.
  const surface = useSurface()
  const cardSurface = missed
    ? compositeOver('#ef4444', surface.isDark ? 0.4 : 0.12, surface.card)
    : surface.card
  const labelInk = posted ? undefined : readableInk(missed ? '#dc2626' : primaryColor, cardSurface)

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
        posted ? 'border-transparent bg-muted text-muted-foreground'
               : missed ? 'border-red-300 bg-red-50 hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40'
               : item.is_highlighted ? 'border-amber-300 bg-amber-100 hover:bg-amber-200 dark:border-amber-800 dark:bg-amber-950/60'
                                     : 'border-input bg-card shadow-xs hover:bg-accent',
        dragging && 'opacity-40',
      )}>
      <div className="flex items-center justify-between gap-1.5">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="flex flex-shrink-0 -space-x-0.5">
            {(item.companies.length ? item.companies : [{ id: 'none', color: '#9ca3af' }]).slice(0, 3).map((c, i) => (
              <span key={c.id ?? i} className="h-2 w-2 rounded-full ring-1 ring-background" style={{ backgroundColor: posted ? '#9ca3af' : c.color }} />
            ))}
          </span>
          <span className="truncate text-[10px] font-bold uppercase tracking-wide" style={{ color: labelInk }}>
            {companyLabel}{showChannelLabel ? ` · ${channelLabel}` : ''}
          </span>
          {missed && (
            <span className="flex-shrink-0 rounded bg-red-600 px-1 text-[9px] font-bold uppercase tracking-wide text-white">
              Missed
            </span>
          )}
        </span>
        <span className="flex flex-shrink-0 items-center gap-1">
          <button type="button"
            onClick={e => { e.stopPropagation(); onOpenAttachment() }}
            aria-label={item.attachment ? 'Open attached file' : 'Attach a file'}
            title={item.attachment ? 'Open attached file' : 'Attach a file'}
            className={cn(
              'rounded p-0.5 transition-colors',
              item.attachment
                ? 'bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-950/60 dark:text-sky-300'
                : 'text-muted-foreground/50 hover:bg-muted hover:text-foreground',
            )}>
            {item.attachment
              ? <FileText className="h-3.5 w-3.5" />
              : <Paperclip className="h-3.5 w-3.5" />}
          </button>
          {item.recurrence_group_id && <Repeat className="h-3 w-3 text-muted-foreground" />}
          {item.is_highlighted && <Sparkles className="h-3 w-3" style={{ color: primaryColor }} />}
          <button type="button" disabled={busy}
            onClick={e => { e.stopPropagation(); onToggle() }}
            aria-label={posted ? 'Mark as not posted' : 'Mark as posted'}
            className={cn('rounded-full transition-colors',
              posted ? 'text-green-600 dark:text-green-400' : missed ? 'text-red-500 hover:text-green-600' : 'text-muted-foreground/60 hover:text-foreground')}>
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
          className={cn('mt-1.5 flex w-full items-start gap-1 rounded border border-red-200 bg-card/60 px-1.5 py-1 text-left text-[11px] transition-colors hover:bg-card dark:border-red-900',
            note ? 'text-red-700 dark:text-red-300' : 'text-red-600 dark:text-red-300')}>
          <Pencil className="mt-0.5 h-3 w-3 flex-shrink-0" />
          <span className="break-words [overflow-wrap:anywhere]">{note ? note : 'Add reason'}</span>
        </button>
      )}
    </div>
  )
}

/* ─── component ──────────────────────────────────────────────────────── */

export default function MarketingCalendar({ userId, userName, isAdmin = false, calendars, refetchCalendars }: MarketingCalendarProps) {
  const supabase = createClient()
  // The opaque surfaces this view paints, so a company's brand hex can be contrast-checked
  // against the chip it actually lands on rather than assumed readable.
  const surface = useSurface()
  const [items,         setItems]         = useState<MarketingCalendarItem[]>([])
  // Every stored completion row (posted or missed), keyed by item id. Absence of a
  // row means pending - or, for a past item, auto-"missed" (computed in stateOf).
  const [statusByItem,  setStatusByItem]  = useState<Map<string, MarketingCalendarCheck>>(new Map())
  const [calendarDate,  setCalendarDate]  = useState(() => new Date())
  const [loading,       setLoading]       = useState(true)
  const [busyItemId,    setBusyItemId]    = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const weekBoardScrollRef = useRef<HTMLDivElement>(null)
  const [todayNavigationRequest, setTodayNavigationRequest] = useState(0)

  // Which calendar instance is currently loaded (migration 085 - calendars are now admin-created,
  // named, multi-instance, each with its own member list, instead of one calendar hardcoded to a
  // single owner). Archived calendars are excluded from selection but not from the raw `calendars`
  // prop, so the management dialog can still list/restore them.
  const activeCalendars = useMemo(() => calendars.filter(c => !c.is_archived), [calendars])
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)

  // Keep the selection valid as the calendar list changes (initial load, or after an admin
  // creates/archives one) - falls back to the first available calendar, or null if none exist.
  useEffect(() => {
    setSelectedCalendarId(current => {
      if (current && activeCalendars.some(c => c.id === current)) return current
      return activeCalendars[0]?.id ?? null
    })
  }, [activeCalendars])

  const selectedCalendar = activeCalendars.find(c => c.id === selectedCalendarId) ?? null

  // Companies (business units) - dynamic, managed from the Super Admin page.
  const [companies,        setCompanies]        = useState<Company[]>([])
  // Which companies are shown in the board/grid. An empty list means "All".
  const [activeCompanyIds, setActiveCompanyIds] = useState<string[]>([])

  // Shared, editable channel list (loaded from marketing_channels). Flat -
  // channels don't belong to a company; which companies an event is for is
  // decided per-event. Array order IS the column order of the channel grid.
  //
  // Every row is held, archived ones included, and only the grid filters. Fetching with
  // `.eq('is_archived', false)` instead would mean a switched-off channel has no entry in
  // any lookup, and there would be nowhere to switch it back on - the same trap the CRM
  // review found in its status lookups (CLAUDE.md).
  const [allChannels, setAllChannels] = useState<Channel[]>([])
  const channels = useMemo(() => allChannels.filter(c => !c.is_archived), [allChannels])
  const [channelManagerOpen, setChannelManagerOpen] = useState(false)
  // Channel column being dragged, and the column index it would land on.
  const [draggingChannelId, setDraggingChannelId] = useState<string | null>(null)
  const [channelDropIndex,  setChannelDropIndex]  = useState<number | null>(null)
  // Channel column being renamed in place from its own grid header, and the text so far.
  const [renamingChannelId, setRenamingChannelId] = useState<string | null>(null)
  const [renameChannelValue, setRenameChannelValue] = useState('')
  const [renameChannelBusy, setRenameChannelBusy] = useState(false)

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
  const [newRecurrence,    setNewRecurrence]    = useState<MarketingRecurrencePattern>('none')
  const [newEndDate,       setNewEndDate]       = useState(toInputDate(addDays(new Date(), 28)))
  const [newTime,          setNewTime]          = useState('')
  // Only meaningful when newRecurrence === 'custom'.
  const [newCustomWeekdays, setNewCustomWeekdays] = useState<number[]>([])
  // Exceptions to whatever the pattern generated, applied before submit.
  // Skip is a toggle (dates stay visible, struck through) rather than a
  // removal, so the user can see and undo what they excluded.
  const [newSkippedDates,  setNewSkippedDates]  = useState<Set<string>>(new Set())
  const [newAddedDates,    setNewAddedDates]    = useState<string[]>([])
  const [newExtraDate,     setNewExtraDate]     = useState('')
  const [creating,         setCreating]         = useState(false)
  const [newAttachmentFile,  setNewAttachmentFile]  = useState<File | null>(null)
  const [newAttachmentError, setNewAttachmentError] = useState<string | null>(null)
  const newAttachmentInputRef = useRef<HTMLInputElement>(null)

  // Edit-event dialog. Editing a recurring instance updates every instance in its
  // series (content/highlight/companies), per how this team wants recurring edits
  // to behave. Channels are multi-select here for the same reason they are on
  // create: ticking one that isn't on the event yet means "also post it here",
  // unticking one means those posts go away. See handleSaveEdit for the diff.
  const [editItem,         setEditItem]         = useState<MarketingCalendarItem | null>(null)
  const [editDate,         setEditDate]         = useState('')
  const [editTime,         setEditTime]         = useState('')
  const [editCompanyIds,   setEditCompanyIds]   = useState<string[]>([])
  const [editChannels,     setEditChannels]     = useState<string[]>([])
  const [editContent,      setEditContent]      = useState('')
  const [editHighlighted,  setEditHighlighted]  = useState(false)
  const [editScope,        setEditScope]        = useState<EditScope>('single')
  const [savingEdit,       setSavingEdit]       = useState(false)

  // "Add repeats" - the edit dialog's own copy of the create dialog's scheduling
  // controls, so an existing event can gain dates (or become a series at all)
  // without deleting it and starting over. Separate from the Save button: it
  // inserts new rows, it does not edit the ones already there.
  const [editRecurrence,     setEditRecurrence]     = useState<MarketingRecurrencePattern>('none')
  const [editCustomWeekdays, setEditCustomWeekdays] = useState<number[]>([])
  const [editEndDate,        setEditEndDate]        = useState('')
  const [editSkippedDates,   setEditSkippedDates]   = useState<Set<string>>(new Set())
  const [editAddedDates,     setEditAddedDates]     = useState<string[]>([])
  const [editExtraDate,      setEditExtraDate]      = useState('')
  const [addTimeValue,       setAddTimeValue]       = useState('')
  const [addingDate,         setAddingDate]         = useState(false)
  const [removingDateId,     setRemovingDateId]     = useState<string | null>(null)

  // Inline attachment field in the edit dialog.
  const editAttachmentInputRef = useRef<HTMLInputElement>(null)

  // Drag-and-drop reschedule
  const [draggingId,  setDraggingId]  = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)

  // Agenda "show past" toggle
  const [showPast, setShowPast] = useState(false)

  // "Why was this missed?" dialog
  const [reasonItem,   setReasonItem]   = useState<MarketingCalendarItem | null>(null)
  const [reasonText,   setReasonText]   = useState('')
  const [savingReason, setSavingReason] = useState(false)

  // One private social image per event. The dialog is intentionally separate
  // from editing so imported calendar blocks can also keep an asset.
  const [attachmentItem,       setAttachmentItem]       = useState<MarketingCalendarItem | null>(null)
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null)
  const [attachmentBusy,       setAttachmentBusy]       = useState<'preview' | 'upload' | 'download' | 'delete' | null>(null)
  const [attachmentError,      setAttachmentError]      = useState<string | null>(null)
  // Set when attachment metadata could not be read at all (missing table, RLS, stale
  // schema cache). Distinct from attachmentError, which is about one dialog action.
  const [attachmentsUnavailable, setAttachmentsUnavailable] = useState<string | null>(null)
  const attachmentInputRef = useRef<HTMLInputElement>(null)

  const newRecurrenceDates = useMemo(
    () => newRecurrence === 'custom'
      ? buildCustomWeekdayDateKeys(newDate, newEndDate, newCustomWeekdays)
      : buildRecurringDateKeys(newDate, newRecurrence, newEndDate),
    [newDate, newEndDate, newRecurrence, newCustomWeekdays],
  )
  // Density of the pattern itself - gates whether the interactive skip
  // checklist is even worth rendering. Distinct from what the user prunes
  // afterward (finalScheduleDates, below).
  const newScheduleDateLimitReached =
    newRecurrenceDates.length > MAX_SCHEDULED_MARKETING_POSTS
  const newInteractiveScheduleTooLarge =
    newRecurrenceDates.length > MAX_INTERACTIVE_SCHEDULE_PREVIEW

  // What will actually be submitted: pattern-generated dates minus skips,
  // plus manual additions, deduped and sorted.
  const finalScheduleDates = useMemo(() => {
    const kept = newRecurrenceDates.filter(d => !newSkippedDates.has(d))
    return Array.from(new Set([...kept, ...newAddedDates])).sort()
  }, [newRecurrenceDates, newSkippedDates, newAddedDates])

  const newScheduledPostCount = finalScheduleDates.length * newChannels.length
  const newScheduleTooLarge = newScheduledPostCount > MAX_SCHEDULED_MARKETING_POSTS
  // Distinguishes *why* nothing will be created - each cause needs a
  // different instruction, and "repeat until must be on/after the first
  // date" is actively misleading when the real problem is e.g. no weekday
  // selected on a Custom pattern.
  const newScheduleInvalidReason: string | null =
    finalScheduleDates.length > 0 ? null
    : newRecurrence === 'custom' && newCustomWeekdays.length === 0
      ? 'Select at least one weekday, or tap the days you want on the calendar below.'
    : newRecurrenceDates.length === 0
      ? 'Repeat until must be on or after the first date.'
      : 'Every generated date was skipped. Add at least one date to continue.'
  const newScheduleInvalid = newScheduleInvalidReason !== null
  const newSchedulePreview = useMemo(() => {
    if (finalScheduleDates.length <= 4) return finalScheduleDates
    return [
      ...finalScheduleDates.slice(0, 3),
      finalScheduleDates[finalScheduleDates.length - 1],
    ]
  }, [finalScheduleDates])

  const toggleNewSkippedDate = (date: string) => {
    setNewSkippedDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }

  const toggleNewCustomWeekday = (day: number) => {
    setNewCustomWeekdays(prev =>
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day].sort((a, b) => a - b),
    )
  }

  const addNewExtraDate = () => {
    if (!newExtraDate) return
    setNewAddedDates(prev => prev.includes(newExtraDate) ? prev : [...prev, newExtraDate])
    setNewExtraDate('')
  }

  const removeNewAddedDate = (date: string) =>
    setNewAddedDates(prev => prev.filter(d => d !== date))

  /**
   * Toggle one day of the schedule, from the calendar grid.
   *
   * A day is in the schedule for one of two reasons and coming out of it needs the opposite
   * move for each: a date the pattern generated is removed by SKIPPING it, and a date the user
   * added by hand is removed by dropping it from the added list. Routing both through here
   * keeps the grid and the date list below it reading and writing the same state, rather than
   * the grid becoming a second way to describe a schedule.
   */
  const toggleNewScheduleDate = (date: string) => {
    if (newRecurrenceDates.includes(date)) {
      toggleNewSkippedDate(date)
      return
    }
    setNewAddedDates(prev => prev.includes(date) ? prev.filter(d => d !== date) : [...prev, date].sort())
  }

  const loadCalendar = useCallback(async () => {
    if (!selectedCalendarId) {
      setItems([])
      setStatusByItem(new Map())
      setLoading(false)
      setError(null)
      return
    }
    setLoading(true)
    setError(null)

    const [
      { data: itemRows, error: itemsError },
      { data: checkRows, error: checksError },
      { data: attachmentRows, error: attachmentsError },
    ] = await Promise.all([
      supabase.from('marketing_calendar_items')
        .select('id,date,time,day_label,channel,content,is_highlighted,position,source_sheet,recurrence_group_id,marketing_calendar_item_companies(company:companies(id,code,name,color))')
        .eq('calendar_id', selectedCalendarId)
        .order('date', { ascending: true })
        .order('position', { ascending: true }),
      // Not filtered to userId: a mark belongs to the shared item, not to whoever is
      // looking. RLS still decides which rows come back (see resolveCheck above).
      supabase.from('marketing_calendar_checks')
        .select('id,item_id,user_id,checked_at,status,note'),
      // Attachment metadata is optional. Loading it separately prevents a
      // missing migration or stale PostgREST relationship cache from failing
      // the core item query and making a populated calendar appear empty.
      supabase.from('marketing_calendar_attachments')
        .select('id,item_id,storage_path,file_name,mime_type,file_size,created_at'),
    ])

    setLoading(false)
    if (itemsError || checksError) {
      console.error('[marketing-calendar] Core calendar load failed', {
        items: itemsError?.message,
        checks: checksError?.message,
      })
      setError('Marketing calendar is not ready yet.')
      return
    }
    // Keep the calendar rendering (see the query comment above), but never let this fail
    // silently: with no signal, an event whose file genuinely failed to load looks
    // identical to one that never had a file, and users reasonably conclude the upload
    // was lost. Surface it as a non-blocking banner instead of a console-only warning.
    if (attachmentsError) {
      console.warn('[marketing-calendar] Attachment metadata is unavailable', {
        code: attachmentsError.code,
        message: attachmentsError.message,
      })
      setAttachmentsUnavailable(attachmentsError.message)
    } else {
      setAttachmentsUnavailable(null)
    }
    const attachmentsByItemId = new Map(
      ((attachmentRows ?? []) as MarketingCalendarAttachment[])
        .map(attachment => [attachment.item_id, attachment]),
    )
    const mapped = ((itemRows ?? []) as any[])
      .filter(row => !isImportedWeekendPlaceholder(row))
      .map((row): MarketingCalendarItem => ({
        id: row.id,
        date: row.date,
        time: row.time,
        day_label: row.day_label,
        channel: row.channel,
        content: row.content,
        is_highlighted: row.is_highlighted,
        position: row.position,
        source_sheet: row.source_sheet,
        recurrence_group_id: row.recurrence_group_id,
        companies: (row.marketing_calendar_item_companies ?? []).map((r: any) => r.company).filter(Boolean),
        attachment: attachmentsByItemId.get(row.id) ?? null,
      }))
    setItems(mapped)
    // Older rows created before the status column default to 'posted'.
    const merged = new Map<string, MarketingCalendarCheck>()
    for (const row of (checkRows ?? []) as any[]) {
      const check = { ...row, status: (row.status ?? 'posted') as CheckStatus, note: row.note ?? null } as MarketingCalendarCheck
      const existing = merged.get(check.item_id)
      merged.set(check.item_id, existing ? resolveCheck(existing, check) : check)
    }
    setStatusByItem(merged)
  }, [selectedCalendarId, supabase])

  useEffect(() => { loadCalendar() }, [loadCalendar])

  // Load companies and drop filters that point at companies archived since the
  // previous refresh. [] remains the canonical "All" state.
  const loadCompanies = useCallback(async () => {
    const { data } = await supabase
      .from('companies')
      .select('id,code,name,color,position,is_archived')
      .order('position', { ascending: true })
    if (!data) return
    const active = (data as Array<Company & { position: number; is_archived: boolean }>).filter(c => !c.is_archived)
    setCompanies(active)
    setActiveCompanyIds(prev => reconcileCompanySelection(prev, active.map(c => c.id)))
  }, [supabase])

  useEffect(() => { loadCompanies() }, [loadCompanies])

  // Load the shared, flat channel list. Position order here is the grid's column
  // order, so this query is what makes a reorder stick for everyone.
  const loadChannels = useCallback(async () => {
    const { data } = await supabase
      .from('marketing_channels')
      .select('id,channel,label,is_archived,position')
      .order('position', { ascending: true })
    if (!data) return
    setAllChannels(
      (data as Array<Channel & { is_archived?: boolean | null }>)
        .map(({ id, channel, label, position, is_archived }) => ({
          id, channel, label, position, is_archived: Boolean(is_archived),
        })),
    )
  }, [supabase])

  useEffect(() => { loadChannels() }, [loadChannels])

  // Add a new shared channel. Channels are lightweight and not tied to a
  // company, so any signed-in user can add one (RLS enforces this).
  const handleAddChannel = useCallback(async (name: string): Promise<boolean> => {
    const channel = name.trim()
    if (!channel) return false
    // Past the highest existing position, not channels.length - seeded positions
    // have gaps, so counting would drop a new channel into the middle of the grid.
    const position = allChannels.reduce((max, c) => Math.max(max, c.position), -1) + 1
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
  }, [allChannels, loadChannels, supabase])

  /**
   * Persist a new channel column order. The channel list is shared, so this is a
   * change everyone sees - the same reasoning that made check-offs shared in 087.
   *
   * Goes through the reorder RPC (migration 088) rather than an UPDATE: direct
   * writes to marketing_channels are admin-only and, read literally, exclude
   * super_admin - Bobby and Kayla would both have failed silently. The RPC can
   * only renumber positions; renaming and switching off have their own RPCs
   * (migration 105, below) for the same reason and with the same gate.
   */
  const reorderChannels = useCallback(async (next: Channel[]) => {
    const previous = allChannels
    // The RPC only ever renumbers the ACTIVE channels, so the switched-off ones ride along
    // unchanged rather than being dropped from state and reappearing on the next load.
    setAllChannels([...next, ...allChannels.filter(c => c.is_archived)])

    const { error: reorderError } = await supabase.rpc('reorder_marketing_channels', {
      p_channel_ids: next.map(c => c.id),
    })
    if (reorderError) {
      // The likeliest failure is a stale list (someone else added a channel), so
      // put the columns back and re-read rather than leaving a lie on screen.
      setAllChannels(previous)
      toast.error('Could not save the column order', { description: reorderError.message })
      loadChannels()
    }
  }, [allChannels, loadChannels, supabase])

  const moveChannel = useCallback((fromIndex: number, toIndex: number) => {
    const next = moveListItem(channels, fromIndex, toIndex)
    if (next === channels) return
    void reorderChannels(next)
  }, [channels, reorderChannels])

  /**
   * Rename a channel. Goes through the rename RPC (migration 105) for two reasons, both of
   * which make a direct UPDATE wrong rather than merely inconvenient:
   *
   *   - marketing_channels' UPDATE policy reads `role = 'admin'` literally, which excludes
   *     super_admin - so Bobby and Kayla, the two people who run this calendar, would have
   *     had every rename silently do nothing (the same trap 088 hit for ordering).
   *   - marketing_calendar_items.channel is TEXT with no foreign key. Renaming the channel
   *     without re-pointing its events orphans them: they vanish from the grid, with no
   *     error and nowhere to look. The RPC does both in one transaction.
   */
  const renameChannel = useCallback(async (channel: Channel, nextLabel: string): Promise<boolean> => {
    const label = nextLabel.trim()
    if (!label) return false
    if (label === channel.label && label === channel.channel) return true

    // The stored value and the display label are kept equal on rename. They differ only on
    // the rows 054 seeded ("FB - Bobby" / "FB Bobby"); once someone renames one deliberately,
    // carrying that split forward would mean the name they typed is not the name the events
    // are filed under, and the next rename would have two things to reconcile.
    const { data: moved, error: renameError } = await supabase.rpc('rename_marketing_channel', {
      p_channel_id: channel.id,
      p_channel: label,
      p_label: label,
    })

    if (renameError) {
      toast.error('Could not rename the channel', { description: renameError.message })
      return false
    }

    await loadChannels()
    await loadCalendar()
    toast.success(`Renamed to "${label}"`, {
      description: typeof moved === 'number' && moved > 0
        ? `${moved} scheduled post${moved === 1 ? '' : 's'} moved with it.`
        : undefined,
    })
    return true
  }, [loadCalendar, loadChannels, supabase])

  /**
   * Rename a channel from its own column header.
   *
   * The dialog behind "Edit channels" could already do this, and could since migration 105 -
   * but nothing on the grid said so. The column header is where you are standing when you
   * notice the name is wrong, and it offered arrows for reordering and no way at all to
   * change the text between them, so the obvious reading was that the names were fixed.
   *
   * Same RPC as the dialog, deliberately: marketing_calendar_items.channel is TEXT with no
   * foreign key, so a rename that does not re-point its events orphans every post filed
   * under the old name. There must not be a second, thinner path to this.
   */
  const startChannelRename = useCallback((channel: Channel) => {
    setRenamingChannelId(channel.id)
    setRenameChannelValue(channel.label)
  }, [])

  const cancelChannelRename = useCallback(() => {
    setRenamingChannelId(null)
    setRenameChannelValue('')
  }, [])

  const commitChannelRename = useCallback(async (channel: Channel) => {
    const label = renameChannelValue.trim()
    // An empty box is an abandoned edit, not a request to blank the column's name.
    if (!label || label === channel.label) { cancelChannelRename(); return }

    setRenameChannelBusy(true)
    const ok = await renameChannel(channel, label)
    setRenameChannelBusy(false)
    // renameChannel has already explained the failure; staying in edit mode keeps the typed
    // name on screen so it can be corrected rather than retyped.
    if (ok) cancelChannelRename()
  }, [cancelChannelRename, renameChannel, renameChannelValue])

  /**
   * Switch a channel column off or back on. Archiving, not deleting: the events are joined
   * to the channel by its text value, so a DELETE would strand every post ever scheduled on
   * it. Off means "stop giving this a column"; the content is still there when it comes back.
   */
  const setChannelArchived = useCallback(async (channel: Channel, archived: boolean) => {
    const { data: affected, error: archiveError } = await supabase.rpc('set_marketing_channel_archived', {
      p_channel_id: channel.id,
      p_archived: archived,
    })

    if (archiveError) {
      toast.error(archived ? 'Could not turn off the channel' : 'Could not turn on the channel', {
        description: archiveError.message,
      })
      return
    }

    await loadChannels()
    toast.success(archived ? `Turned off "${channel.label}"` : `Turned on "${channel.label}"`, {
      description: archived && typeof affected === 'number' && affected > 0
        ? `${affected} scheduled post${affected === 1 ? '' : 's'} kept - turn it back on to see them.`
        : undefined,
    })
  }, [loadChannels, supabase])

  /* ── computed views ─────────────────────────────────────────────── */

  const companyVisible = useCallback(
    (itemCompanies: Company[]) =>
      activeCompanyIds.length === 0 || itemCompanies.some(c => activeCompanyIds.includes(c.id)),
    [activeCompanyIds],
  )

  const visibleItems = useMemo(() =>
    items.filter(i => companyVisible(i.companies)),
  [items, companyVisible])

  // Where a channel sits in the (rearrangeable) column order. The week and month
  // views stack several channels in one day cell, so they sort by this instead of
  // alphabetically - otherwise dragging a column would reorder the grid's columns
  // and leave those two views in a contradictory order. A channel that no longer
  // exists sorts last rather than jumping to the front.
  const channelRank = useMemo(() => {
    const m = new Map<string, number>()
    channels.forEach((c, index) => m.set(c.channel, index))
    return m
  }, [channels])

  const rankOfChannel = useCallback(
    (channel: string) => channelRank.get(channel) ?? Number.MAX_SAFE_INTEGER,
    [channelRank],
  )

  const weekStart   = useMemo(() => startOfWeek(calendarDate), [calendarDate])
  const weekDays    = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const weekKeys    = useMemo(() => new Set(weekDays.map(toDateKey)), [weekDays])
  const weekItems   = visibleItems.filter(i => weekKeys.has(i.date))
  const monthDays   = useMemo(() => monthGridDays(calendarDate), [calendarDate])
  const monthKeys   = useMemo(() => new Set(monthDays.map(toDateKey)), [monthDays])
  const monthPrefix = toDateKey(new Date(calendarDate.getFullYear(), calendarDate.getMonth(), 1)).slice(0, 7)
  const monthItems  = visibleItems.filter(i => i.date.startsWith(monthPrefix))

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
      arr.sort((a, b) => rankOfChannel(a.channel) - rankOfChannel(b.channel) || a.position - b.position)
    }
    return m
  }, [visibleItems, weekKeys, rankOfChannel])

  const monthItemsByDate = useMemo(() => {
    const m = new Map<string, MarketingCalendarItem[]>()
    for (const item of visibleItems) {
      if (!monthKeys.has(item.date)) continue
      const arr = m.get(item.date) ?? []
      arr.push(item)
      m.set(item.date, arr)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.position - b.position || rankOfChannel(a.channel) - rankOfChannel(b.channel))
    }
    return m
  }, [visibleItems, monthKeys, rankOfChannel])

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
  const periodItems = viewMode === 'month' ? monthItems : weekItems
  const checkedPeriod = periodItems.filter(isPosted).length
  const completionPercent = totalVisible ? Math.round((checkedVisible / totalVisible) * 100) : 0

  const weekLabel = `${dateFormatter.format(weekDays[0])} – ${dateFormatter.format(weekDays[6])}`
  const rangeLabel = viewMode === 'month' ? monthFormatter.format(calendarDate) : weekLabel
  const editSeriesItems = editItem?.recurrence_group_id
    ? items.filter(item => item.recurrence_group_id === editItem.recurrence_group_id)
    : editItem ? [editItem] : []
  const editSeriesDateCount = new Set(editSeriesItems.map(item => item.date)).size
  const editSeriesChannelCount = new Set(editSeriesItems.map(item => item.channel)).size

  // Occurrences on this event's own channel, one row per date, oldest first -
  // what the edit dialog lists so individual dates can be dropped. Restricted to
  // the edited channel because removing "a date" from a multi-channel series
  // would otherwise mean different things depending on which row you clicked.
  const editSeriesOccurrences = editItem
    ? editSeriesItems
      .filter(item => item.channel === editItem.channel)
      .slice()
      .sort((a, b) => a.date.localeCompare(b.date))
    : []
  const editSeriesDateKeys = editSeriesOccurrences.map(item => item.date).join(',')

  // Same generate → skip → add pipeline as the create dialog, anchored on the
  // event being edited. Dates the series already covers are dropped rather than
  // duplicated, so re-running a pattern over an existing range is a no-op.
  const editRecurrenceDates = useMemo(
    () => editRecurrence === 'custom'
      ? buildCustomWeekdayDateKeys(editDate, editEndDate, editCustomWeekdays)
      : buildRecurringDateKeys(editDate, editRecurrence, editEndDate),
    [editDate, editEndDate, editRecurrence, editCustomWeekdays],
  )
  const editInteractiveScheduleTooLarge =
    editRecurrenceDates.length > MAX_INTERACTIVE_SCHEDULE_PREVIEW
  const editNewDates = useMemo(() => {
    const taken = new Set(editSeriesDateKeys ? editSeriesDateKeys.split(',') : [])
    const kept = editRecurrenceDates.filter(d => !editSkippedDates.has(d))
    return Array.from(new Set([...kept, ...editAddedDates]))
      .filter(d => !taken.has(d))
      .sort()
  }, [editRecurrenceDates, editSkippedDates, editAddedDates, editSeriesDateKeys])
  const editAddTooLarge = editNewDates.length > MAX_SCHEDULED_MARKETING_POSTS

  const toggleEditSkippedDate = (date: string) => {
    setEditSkippedDates(prev => {
      const next = new Set(prev)
      if (next.has(date)) next.delete(date)
      else next.add(date)
      return next
    })
  }
  const toggleEditCustomWeekday = (weekday: number) =>
    setEditCustomWeekdays(prev => prev.includes(weekday)
      ? prev.filter(d => d !== weekday)
      : [...prev, weekday].sort((a, b) => a - b))
  const addEditExtraDate = () => {
    if (!editExtraDate) return
    setEditAddedDates(prev => prev.includes(editExtraDate) ? prev : [...prev, editExtraDate])
    setEditExtraDate('')
  }
  const removeEditAddedDate = (date: string) =>
    setEditAddedDates(prev => prev.filter(d => d !== date))

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
      // Clear every mark on the item, not just the caller's - otherwise un-ticking an
      // item a teammate had marked deletes nothing and the UI silently snaps back.
      // RLS still bounds this: a non-admin can only delete their own rows.
      const { error: e } = await supabase.from('marketing_calendar_checks')
        .delete().eq('item_id', item.id)
      if (e) { setStatusByItem(previous); setError('Could not update this item.') }
    } else {
      setStatusByItem(cur => new Map(cur).set(item.id, { id: `opt-${item.id}`, item_id: item.id, user_id: userId, checked_at: new Date().toISOString(), status: next, note }))
      const { data, error: e } = await supabase.from('marketing_calendar_checks')
        // checked_at is only DEFAULT NOW() on insert, so an upsert that flips an existing
        // row's status would otherwise keep the original timestamp and make it useless as
        // resolveCheck's tiebreaker. Always stamp it with the latest statement.
        .upsert({ item_id: item.id, user_id: userId, status: next, note, checked_at: new Date().toISOString() }, { onConflict: 'item_id,user_id' })
        .select('id,item_id,user_id,checked_at,status,note').single()
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
  // Remove the stored miss entirely - reverts to auto (still red if past) with no reason.
  const handleClearReason = async () => {
    if (!reasonItem) return
    setSavingReason(true)
    await setStatus(reasonItem, 'clear')
    setSavingReason(false)
    setReasonItem(null)
  }

  /* ── event file attachment ─────────────────────────────────────── */
  const openAttachmentDialog = (item: MarketingCalendarItem) => {
    setAttachmentError(null)
    setAttachmentItem(item)
  }

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    const attachment = attachmentItem?.attachment

    setAttachmentPreviewUrl(null)
    setAttachmentError(null)
    if (!attachment || !isMarketingAssetPreviewable(attachment.mime_type)) {
      setAttachmentBusy(null)
      return
    }

    setAttachmentBusy('preview')
    const loadPreview = async () => {
      const { data, error: downloadError } = await supabase.storage
        .from(MARKETING_ASSET_BUCKET)
        .download(attachment.storage_path)
      if (cancelled) return
      if (downloadError || !data) {
        setAttachmentError('The file preview could not be loaded. You can try downloading it instead.')
        setAttachmentBusy(null)
        return
      }
      objectUrl = URL.createObjectURL(data)
      setAttachmentPreviewUrl(objectUrl)
      setAttachmentBusy(null)
    }
    void loadPreview()

    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [
    attachmentItem?.attachment?.mime_type,
    attachmentItem?.attachment?.storage_path,
    attachmentItem?.id,
    supabase,
  ])

  const setItemAttachment = (
    itemId: string,
    attachment: MarketingCalendarAttachment | null,
  ) => {
    setItems(current => current.map(item =>
      item.id === itemId ? { ...item, attachment } : item,
    ))
    setAttachmentItem(current =>
      current?.id === itemId ? { ...current, attachment } : current,
    )
    // The edit dialog now shows the file inline too, and holds its own snapshot of
    // the item - without this it would keep rendering the pre-upload state.
    setEditItem(current =>
      current?.id === itemId ? { ...current, attachment } : current,
    )
  }

  // Shared by the per-event attachment dialog and by create-time attaching:
  // uploads to storage, then links the row via the item_id-keyed upsert.
  const uploadMarketingAssetForItem = useCallback(async (
    itemId: string,
    file: File,
  ): Promise<{ attachment: MarketingCalendarAttachment | null; error: string | null }> => {
    const mimeType = resolveMarketingAssetMimeType(file)
    if (!mimeType) return { attachment: null, error: 'This file type is not supported.' }
    const storagePath = buildMarketingAssetPath(itemId, mimeType)

    const { error: uploadError } = await supabase.storage
      .from(MARKETING_ASSET_BUCKET)
      .upload(storagePath, file, {
        cacheControl: '3600',
        contentType: mimeType,
        upsert: false,
      })
    if (uploadError) return { attachment: null, error: uploadError.message }

    const { data: savedAttachment, error: metadataError } = await supabase
      .from('marketing_calendar_attachments')
      .upsert({
        item_id: itemId,
        storage_path: storagePath,
        file_name: file.name,
        mime_type: mimeType,
        file_size: file.size,
        uploaded_by: userId,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'item_id' })
      .select('id,item_id,storage_path,file_name,mime_type,file_size,created_at')
      .single()

    if (metadataError || !savedAttachment) {
      await supabase.storage.from(MARKETING_ASSET_BUCKET).remove([storagePath])
      return { attachment: null, error: metadataError?.message ?? 'The file could not be linked to this event.' }
    }
    return { attachment: savedAttachment as MarketingCalendarAttachment, error: null }
  }, [supabase, userId])

  // Takes the item explicitly rather than reading attachmentItem, so the edit
  // dialog's inline file field and the dedicated file dialog share one code path.
  const attachFileToItem = async (item: MarketingCalendarItem, file: File) => {
    const validationError = validateMarketingAsset(file)
    if (validationError) {
      setAttachmentError(validationError)
      return
    }

    const previousAttachment = item.attachment

    setAttachmentBusy('upload')
    setAttachmentError(null)

    const { attachment, error } = await uploadMarketingAssetForItem(item.id, file)
    if (!attachment) {
      setAttachmentBusy(null)
      setAttachmentError(error)
      return
    }

    if (previousAttachment && previousAttachment.storage_path !== attachment.storage_path) {
      const { error: cleanupError } = await supabase.storage
        .from(MARKETING_ASSET_BUCKET)
        .remove([previousAttachment.storage_path])
      if (cleanupError) {
        toast.error('File replaced, but the old file could not be cleaned up', {
          description: cleanupError.message,
        })
      }
    }

    setItemAttachment(item.id, attachment)
    setAttachmentBusy(null)
    toast.success(previousAttachment ? 'File replaced' : 'File attached')
  }

  const handleAttachmentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !attachmentItem) return
    await attachFileToItem(attachmentItem, file)
  }

  const handleEditAttachmentChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !editItem) return
    await attachFileToItem(editItem, file)
  }

  const handleAttachmentDownload = async () => {
    const attachment = attachmentItem?.attachment
    if (!attachment) return

    setAttachmentBusy('download')
    setAttachmentError(null)
    const { data, error: downloadError } = await supabase.storage
      .from(MARKETING_ASSET_BUCKET)
      .download(attachment.storage_path)

    if (downloadError || !data) {
      setAttachmentBusy(null)
      setAttachmentError(downloadError?.message ?? 'The file could not be downloaded.')
      return
    }

    const objectUrl = URL.createObjectURL(data)
    const link = document.createElement('a')
    link.href = objectUrl
    link.download = attachment.file_name
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
    setAttachmentBusy(null)
    toast.success('File downloaded')
  }

  const removeAttachmentFromItem = async (item: MarketingCalendarItem) => {
    const attachment = item.attachment
    if (!attachment) return

    setAttachmentBusy('delete')
    setAttachmentError(null)
    const { error: metadataError } = await supabase
      .from('marketing_calendar_attachments')
      .delete()
      .eq('id', attachment.id)

    if (metadataError) {
      setAttachmentBusy(null)
      setAttachmentError(metadataError.message)
      return
    }

    const { error: storageError } = await supabase.storage
      .from(MARKETING_ASSET_BUCKET)
      .remove([attachment.storage_path])

    setItemAttachment(item.id, null)
    setAttachmentBusy(null)
    if (storageError) {
      toast.error('Attachment removed, but the stored file needs cleanup', {
        description: storageError.message,
      })
    } else {
      toast.success('Image removed')
    }
  }

  const handleAttachmentDelete = async () => {
    if (!attachmentItem) return
    await removeAttachmentFromItem(attachmentItem)
  }

  /* ── create event ───────────────────────────────────────────────── */
  const toggleNewCompany = (id: string) =>
    setNewCompanyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  const toggleNewChannel = (channel: string) =>
    setNewChannels(prev => prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel])
  const handleNewDateChange = (date: string) => {
    setNewDate(date)
    setNewEndDate(currentEnd =>
      currentEnd < date ? toInputDate(addDays(parseDate(date), 28)) : currentEnd,
    )
  }

  const handleNewAttachmentChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const validationError = validateMarketingAsset(file)
    if (validationError) {
      setNewAttachmentError(validationError)
      return
    }
    setNewAttachmentError(null)
    setNewAttachmentFile(file)
  }

  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newContent.trim() || !selectedCalendarId || newChannels.length === 0 || newCompanyIds.length === 0) return
    if (newScheduleInvalid) {
      toast.error(newScheduleInvalidReason ?? 'Choose a repeat-until date on or after the first date')
      return
    }
    if (newScheduleTooLarge) {
      toast.error('This schedule is too large', {
        description: `Narrow the date range or select fewer channels. The limit is ${MAX_SCHEDULED_MARKETING_POSTS.toLocaleString()} scheduled posts.`,
      })
      return
    }
    setCreating(true)

    // Give every row from this submission a shared id when it's a recurring
    // series, so editing any single instance can update them all later.
    const recurrenceGroupId = newRecurrence !== 'none' ? crypto.randomUUID() : null

    const rows = finalScheduleDates.flatMap((date, i) =>
      newChannels.map(channel => ({
        calendar_id:    selectedCalendarId,
        assigned_to:    userId,
        date,
        time:           newTime || null,
        day_label:      dayLabelForDateKey(date),
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

    if (compErr) {
      toast.error('Event created, but companies could not be attached', { description: compErr.message })
    } else {
      toast.success(
        newRecurrence === 'none'
          ? `Created ${inserted.length} scheduled post${inserted.length === 1 ? '' : 's'}`
          : `Created a ${finalScheduleDates.length}-date series`,
        newRecurrence === 'none' ? undefined : {
          description: `${inserted.length} channel post${inserted.length === 1 ? '' : 's'} scheduled in total.`,
        },
      )
    }

    // Each event instance stores its own attachment row (item_id-keyed), so a
    // recurring/multi-channel submission fans the same file out to every
    // instance it just created. Capped so a huge recurring series doesn't
    // silently re-upload the same file hundreds of times.
    if (newAttachmentFile) {
      const fanoutTargets = inserted.slice(0, MAX_CREATE_ATTACHMENT_FANOUT)
      const results = await Promise.all(
        fanoutTargets.map((row: { id: string }) => uploadMarketingAssetForItem(row.id, newAttachmentFile)),
      )
      const failures = results.filter(r => !r.attachment)
      // Surface the underlying reason. Without it an infrastructure fault (a missing
      // storage bucket, a revoked policy) is indistinguishable from "my file vanished",
      // which is exactly how a broken attachment path stayed undiagnosed before.
      const reason = failures.find(r => r.error)?.error ?? undefined
      if (inserted.length > fanoutTargets.length) {
        toast.error('File not attached to every post', {
          description: `Only the first ${fanoutTargets.length} posts got the file. Attach it to the rest individually.`,
        })
      } else if (failures.length > 0) {
        toast.error(
          failures.length === results.length
            ? 'Event created, but the file could not be attached'
            : `Event created, but the file could not be attached to ${failures.length} post${failures.length === 1 ? '' : 's'}`,
          reason ? { description: reason } : undefined,
        )
      }
    }

    setCreating(false)
    setCreateOpen(false)
    setNewContent('')
    setNewHighlighted(false)
    setNewRecurrence('none')
    setNewTime('')
    setNewCustomWeekdays([])
    setNewSkippedDates(new Set())
    setNewAddedDates([])
    setNewExtraDate('')
    setNewAttachmentFile(null)
    setNewAttachmentError(null)
    loadCalendar()
  }

  // Open the create dialog, optionally pre-selecting a date and channel
  // (used when clicking an empty cell in the grid or an empty day column).
  const openCreateDialog = (opts?: { date?: string; channel?: string }) => {
    const startDate = opts?.date ?? toInputDate(new Date())
    setNewDate(startDate)
    setNewEndDate(toInputDate(addDays(parseDate(startDate), 28)))
    setNewContent('')
    setNewHighlighted(false)
    setNewRecurrence('none')
    setNewTime('')
    setNewCustomWeekdays([])
    setNewSkippedDates(new Set())
    setNewAddedDates([])
    setNewExtraDate('')
    setNewCompanyIds([])
    setNewChannels(opts?.channel ? [opts.channel] : [])
    setNewAttachmentFile(null)
    setNewAttachmentError(null)
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

  /**
   * The rows an edit at this scope covers, read from `items` rather than from
   * editItem state so it is safe to call while opening the dialog. "Entire series"
   * is every row sharing the recurrence group - which for a series created across
   * several channels is several channel streams. "This event" is only the row that
   * was clicked, matching what that scope has always meant.
   */
  const itemsInScope = (item: MarketingCalendarItem, scope: EditScope) =>
    scope === 'series' && item.recurrence_group_id
      ? items.filter(i => i.recurrence_group_id === item.recurrence_group_id)
      : [item]

  const channelsInScope = (item: MarketingCalendarItem, scope: EditScope) =>
    Array.from(new Set(itemsInScope(item, scope).map(i => i.channel))).sort()

  // Switching scope changes which rows are on the table, so the ticked channels
  // have to be re-read for the new scope - otherwise a selection made against
  // "this event" would be diffed against the whole series on save.
  const selectEditScope = (scope: EditScope) => {
    setEditScope(scope)
    if (editItem) setEditChannels(channelsInScope(editItem, scope))
  }

  const toggleEditChannel = (channel: string) =>
    setEditChannels(prev =>
      prev.includes(channel) ? prev.filter(c => c !== channel) : [...prev, channel])

  // Previewed in the dialog and recomputed for real in handleSaveEdit - the save
  // path can't trust render-time values, and this can't call the save path.
  const editScopeItems = editItem ? itemsInScope(editItem, editScope) : []
  const editBaselineChannels = Array.from(new Set(editScopeItems.map(i => i.channel)))
  const editScopeDateCount = new Set(editScopeItems.map(i => i.date)).size
  const editChannelsAdded = editChannels.filter(c => !editBaselineChannels.includes(c))
  const editChannelsRemoved = editBaselineChannels.filter(c => !editChannels.includes(c))
  const editChannelIsRename = editChannelsAdded.length === 1 && editChannelsRemoved.length === 1
  const channelLabelOf = (channel: string) =>
    channels.find(c => c.channel === channel)?.label ?? channel

  const openEditDialog = (item: MarketingCalendarItem) => {
    if (!isEditable(item)) {
      toast.error('Imported events cannot be edited here')
      return
    }
    setEditItem(item)
    setEditDate(item.date)
    // Postgres returns TIME as "HH:MM:SS"; <input type="time"> needs "HH:MM".
    setEditTime(item.time?.slice(0, 5) ?? '')
    setEditCompanyIds(item.companies.map(c => c.id))
    const scope: EditScope = item.recurrence_group_id ? 'series' : 'single'
    setEditChannels(channelsInScope(item, scope))
    setEditContent(item.content)
    setEditHighlighted(item.is_highlighted)
    setEditScope(scope)
    setEditRecurrence('none')
    setEditCustomWeekdays([])
    setEditEndDate(toInputDate(addDays(parseDate(item.date), 28)))
    setEditSkippedDates(new Set())
    setEditAddedDates([])
    setEditExtraDate('')
    setAddTimeValue(item.time?.slice(0, 5) ?? '')
    setAttachmentError(null)
  }

  const toggleEditCompany = (id: string) =>
    setEditCompanyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  /**
   * Applies the channel diff computed in handleSaveEdit. Adding a channel means
   * "post this here too", so each new row is a clone of the event being edited on
   * every date the edit covers; removing one deletes that channel's rows outright.
   * Leaving them behind would make unticking a channel silently do nothing.
   *
   * (date, channel) pairs that already exist are skipped, so a diff can never
   * double-book a slot that another stream of the same series already fills.
   */
  const applyChannelDiff = async (options: {
    added: string[]
    removedIds: string[]
    dates: string[]
    template: MarketingCalendarItem
  }) => {
    const { added, removedIds, dates, template } = options
    if (removedIds.length) {
      const { error } = await supabase.from('marketing_calendar_items').delete().in('id', removedIds)
      if (error) return error
    }
    if (!added.length || !dates.length) return null

    const dropped = new Set(removedIds)
    const occupied = new Set(
      items.filter(i => !dropped.has(i.id)).map(i => itemKey(i.date, i.channel)),
    )
    const rows = dates.flatMap((date, i) =>
      added
        .filter(channel => !occupied.has(itemKey(date, channel)))
        .map(channel => ({
          calendar_id:    selectedCalendarId,
          assigned_to:    userId,
          date,
          time:           editTime || null,
          day_label:      dayLabelForDateKey(date),
          channel,
          content:        editContent.trim(),
          is_highlighted: editHighlighted,
          position:       template.position + i,
          source_sheet:   null,
          source_row:     null,
          source_column:  null,
          recurrence_group_id: template.recurrence_group_id ?? null,
        })),
    )
    if (!rows.length) return null

    const { data: inserted, error } = await supabase
      .from('marketing_calendar_items').insert(rows).select('id')
    if (error) return error
    if (!inserted?.length || !editCompanyIds.length) return null

    const { error: companyError } = await supabase
      .from('marketing_calendar_item_companies')
      .insert(inserted.flatMap((row: { id: string }) =>
        editCompanyIds.map(companyId => ({ item_id: row.id, company_id: companyId })),
      ))
    return companyError
  }

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editItem || !editContent.trim() || editChannels.length === 0 || editCompanyIds.length === 0) return

    const scopeItems = itemsInScope(editItem, editScope)
    const baselineChannels = Array.from(new Set(scopeItems.map(i => i.channel)))
    const removedChannels = baselineChannels.filter(c => !editChannels.includes(c))
    const addedChannels = editChannels.filter(c => !baselineChannels.includes(c))

    // One channel out and one in is a rename, not a delete-and-recreate: keeping
    // the existing rows preserves their ids, and with them every check-off and
    // attachment already hanging off them. That is what the old single-select
    // picker did, and it stays the default reading of "move this to a different
    // channel". Any other shape is a genuine add and/or drop.
    const renameFrom = removedChannels.length === 1 && addedChannels.length === 1 ? removedChannels[0] : null
    const renameTo   = renameFrom ? addedChannels[0] : null
    const droppedItems = renameFrom ? [] : scopeItems.filter(i => removedChannels.includes(i.channel))
    const channelsToAdd = renameFrom ? [] : addedChannels
    const scopeDates = Array.from(new Set(scopeItems.map(i => i.date)))

    if (channelsToAdd.length * scopeDates.length > MAX_SCHEDULED_MARKETING_POSTS) {
      toast.error('That would schedule too many posts', {
        description: `Adding ${channelsToAdd.length} channel${channelsToAdd.length === 1 ? '' : 's'} across ${scopeDates.length} dates exceeds the ${MAX_SCHEDULED_MARKETING_POSTS.toLocaleString()}-post limit.`,
      })
      return
    }

    if (droppedItems.length && !confirm(
      `Remove ${removedChannels.join(', ')} from this ${editScope === 'series' ? 'series' : 'event'}? `
      + `${droppedItems.length} scheduled post${droppedItems.length === 1 ? '' : 's'} will be deleted. This cannot be undone.`,
    )) return

    // Unticking the channel of the row the dialog is showing deletes that row, so
    // there is nothing left to keep the dialog open on.
    const editedRowRemoved = droppedItems.some(i => i.id === editItem.id)

    setSavingEdit(true)

    const replaceCompanies = async (itemIds: string[]) => {
      const { error: deleteError } = await supabase
        .from('marketing_calendar_item_companies')
        .delete()
        .in('item_id', itemIds)
      if (deleteError) return deleteError

      const companyRows = itemIds.flatMap(itemId =>
        editCompanyIds.map(companyId => ({ item_id: itemId, company_id: companyId })),
      )
      const { error: insertError } = await supabase
        .from('marketing_calendar_item_companies')
        .insert(companyRows)
      return insertError
    }

    if (editItem.recurrence_group_id && editScope === 'series') {
      const { data: seriesItems, error: seriesError } = await supabase
        .from('marketing_calendar_items')
        .select('id,date,channel')
        .eq('recurrence_group_id', editItem.recurrence_group_id)

      if (seriesError || !seriesItems?.length) {
        setSavingEdit(false)
        toast.error('Could not load this recurring series', { description: seriesError?.message })
        return
      }

      const scheduleUpdates = buildRecurringSeriesScheduleUpdates(
        seriesItems as Array<{ id: string; date: string; channel: string }>,
        {
          anchorDate: editItem.date,
          nextDate: editDate,
          // A rename can target a stream other than the edited row's own channel
          // (a two-channel series edited from its social row, renaming email).
          // When nothing was renamed these are equal and the helper is a no-op
          // on channel, leaving every stream's name intact.
          anchorChannel: renameFrom ?? editItem.channel,
          nextChannel: renameTo ?? editItem.channel,
        },
      )

      if (
        scheduleUpdates.length !== seriesItems.length
        || scheduleUpdates.some(update => !update.day_label)
      ) {
        setSavingEdit(false)
        toast.error('The series contains an invalid date and was not changed')
        return
      }

      // One RPC transaction updates every schedule row and every company link.
      // If any row fails validation or RLS, PostgreSQL rolls back the full
      // series instead of leaving a partially shifted timeline.
      const { data: updatedCount, error: updateError } = await supabase
        .rpc('update_marketing_calendar_series_atomic', {
          p_recurrence_group_id: editItem.recurrence_group_id,
          p_updates: scheduleUpdates,
          p_content: editContent.trim(),
          p_is_highlighted: editHighlighted,
          p_company_ids: editCompanyIds,
          p_time: editTime || null,
        })

      if (updateError) {
        setSavingEdit(false)
        setEditItem(null)
        await loadCalendar()
        toast.error('The series was not changed', {
          description: `${updateError.message}. Every occurrence remains on its previous date.`,
        })
        return
      }

      // Channels are diffed after the schedule RPC so new rows land on the dates
      // the series just moved to, not the ones it is leaving.
      const channelError = await applyChannelDiff({
        added: channelsToAdd,
        removedIds: droppedItems.map(i => i.id),
        dates: Array.from(new Set(scheduleUpdates.map(u => u.date))),
        template: editItem,
      })

      setSavingEdit(false)
      if (channelError) {
        setEditItem(null)
        await loadCalendar()
        toast.error('The series was updated, but its channels were not', {
          description: channelError.message,
        })
        return
      }

      toast.success(
        `Updated ${editSeriesDateCount} date${editSeriesDateCount === 1 ? '' : 's'} across ${editChannels.length} channel${editChannels.length === 1 ? '' : 's'}`,
        updatedCount === scheduleUpdates.length ? undefined : {
          description: 'The calendar is refreshing to confirm the saved series.',
        },
      )
      setEditItem(null)
      loadCalendar()
      return
    }

    // The edited row survives unless its own channel was dropped, in which case
    // there is no row left to write the rest of the form onto.
    if (!editedRowRemoved) {
      const dayLabel = dayLabelForDateKey(editDate)
      const { error: updateError } = await supabase.from('marketing_calendar_items').update({
        date:           editDate,
        time:           editTime || null,
        day_label:      dayLabel,
        // renameFrom only ever names a channel that is in scope, and at this scope
        // the only row in scope is this one.
        channel:        renameFrom ? renameTo! : editItem.channel,
        content:        editContent.trim(),
        is_highlighted: editHighlighted,
      }).eq('id', editItem.id)

      if (updateError) {
        setSavingEdit(false)
        toast.error('Could not update event', { description: updateError.message })
        return
      }

      const companyError = await replaceCompanies([editItem.id])
      if (companyError) {
        setSavingEdit(false)
        setEditItem(null)
        await loadCalendar()
        toast.error('Event updated, but companies could not be updated', {
          description: companyError.message,
        })
        return
      }
    }

    const channelError = await applyChannelDiff({
      added: channelsToAdd,
      removedIds: droppedItems.map(i => i.id),
      dates: [editDate],
      template: editItem,
    })

    setSavingEdit(false)
    if (channelError) {
      setEditItem(null)
      await loadCalendar()
      toast.error('Event updated, but its channels were not', { description: channelError.message })
      return
    }

    toast.success(
      channelsToAdd.length || droppedItems.length
        ? `Event updated across ${editChannels.length} channel${editChannels.length === 1 ? '' : 's'}`
        : 'Event updated',
    )
    setEditItem(null)
    loadCalendar()
  }

  const handleDeleteSeries = async (recurrenceGroupId: string) => {
    if (!confirm(
      `Delete all ${editSeriesDateCount} date${editSeriesDateCount === 1 ? '' : 's'} in this series? This cannot be undone.`,
    )) return
    const { error: e } = await supabase
      .from('marketing_calendar_items')
      .delete()
      .eq('recurrence_group_id', recurrenceGroupId)
    if (e) { toast.error('Could not delete series', { description: e.message }); return }
    setItems(prev => prev.filter(x => x.recurrence_group_id !== recurrenceGroupId))
    toast.success(`Deleted ${editSeriesDateCount} date${editSeriesDateCount === 1 ? '' : 's'}`)
  }

  const handleDeleteFromEdit = async () => {
    if (!editItem) return
    if (editItem.recurrence_group_id && editScope === 'series') {
      await handleDeleteSeries(editItem.recurrence_group_id)
    } else {
      await handleDeleteItem(editItem)
    }
    setEditItem(null)
  }

  // Adds occurrences to the event being edited. Deliberately reads from editItem
  // (the persisted content/highlight/companies), not the live
  // editContent/editHighlighted/editCompanyIds form state - those two can
  // differ whenever the user has typed unsaved changes but hasn't clicked
  // Save yet, and this action fires independently of that button.
  //
  // A one-off event has no recurrence_group_id, so adding dates to it mints one
  // and stamps the original row with it: the event becomes the anchor of a real
  // series rather than a loose pile of copies, which is what makes "Apply changes
  // to → Entire series" work on it afterwards.
  const handleAddOccurrences = async () => {
    if (!editItem || !selectedCalendarId || editNewDates.length === 0) return
    if (editAddTooLarge) {
      toast.error('That would add too many dates at once', {
        description: `Narrow the range. The limit is ${MAX_SCHEDULED_MARKETING_POSTS.toLocaleString()} posts.`,
      })
      return
    }
    setAddingDate(true)

    let recurrenceGroupId = editItem.recurrence_group_id
    if (!recurrenceGroupId) {
      recurrenceGroupId = crypto.randomUUID()
      const { error: groupErr } = await supabase
        .from('marketing_calendar_items')
        .update({ recurrence_group_id: recurrenceGroupId })
        .eq('id', editItem.id)
      if (groupErr) {
        setAddingDate(false)
        toast.error('Could not turn this event into a series', { description: groupErr.message })
        return
      }
    }

    const { data: inserted, error: insertErr } = await supabase
      .from('marketing_calendar_items')
      .insert(editNewDates.map((date, i) => ({
        calendar_id:    selectedCalendarId,
        assigned_to:    userId,
        date,
        time:           addTimeValue || null,
        day_label:      dayLabelForDateKey(date),
        channel:        editItem.channel,
        content:        editItem.content,
        is_highlighted: editItem.is_highlighted,
        position:       i,
        source_sheet:   null,
        source_row:     null,
        source_column:  null,
        recurrence_group_id: recurrenceGroupId,
      })))
      .select('id')

    if (insertErr || !inserted) {
      setAddingDate(false)
      toast.error('Could not add dates', { description: insertErr?.message })
      return
    }

    const { error: compErr } = await supabase
      .from('marketing_calendar_item_companies')
      .insert(inserted.flatMap((row: { id: string }) =>
        editItem.companies.map(c => ({ item_id: row.id, company_id: c.id }))))

    setAddingDate(false)
    if (compErr) {
      toast.error('Dates added, but companies could not be attached', { description: compErr.message })
    } else {
      toast.success(`Added ${inserted.length} date${inserted.length === 1 ? '' : 's'}`)
    }
    // Keep the dialog open on the same event - the occurrence list below refreshes
    // with the new dates, which is the confirmation that this worked.
    setEditItem(current => current ? { ...current, recurrence_group_id: recurrenceGroupId } : current)
    setEditScope('series')
    setEditRecurrence('none')
    setEditCustomWeekdays([])
    setEditSkippedDates(new Set())
    setEditAddedDates([])
    setEditExtraDate('')
    loadCalendar()
  }

  // Drops a single date from the series. The event currently open in the dialog is
  // excluded in the UI - deleting that one is what the dialog's Delete button does,
  // and it has to close the dialog, which this deliberately does not.
  const handleRemoveOccurrence = async (occurrence: MarketingCalendarItem) => {
    if (occurrence.id === editItem?.id) return
    setRemovingDateId(occurrence.id)
    const { error: e } = await supabase
      .from('marketing_calendar_items')
      .delete()
      .eq('id', occurrence.id)
    setRemovingDateId(null)
    if (e) {
      toast.error('Could not remove that date', { description: e.message })
      return
    }
    setItems(prev => prev.filter(x => x.id !== occurrence.id))
    toast.success('Date removed from the series')
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

    const dayLabel = dayLabelForDateKey(date)
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

  /* ── drag-and-drop column reorder ────────────────────────────────── */
  // Column drags and event drags share the browser's one drag session, so every
  // handler on both sides checks which kind is in flight: the cell handlers bail
  // when draggingId is null (a column is moving), and these bail when
  // draggingChannelId is null (an event is moving). Neither can trigger the other.
  const handleChannelDragStart = (channelId: string) => (e: React.DragEvent) => {
    // Firefox refuses to start a drag without a payload, even an unread one.
    e.dataTransfer.setData('text/plain', channelId)
    e.dataTransfer.effectAllowed = 'move'
    setDraggingChannelId(channelId)
  }

  const handleChannelDragOver = (index: number) => (e: React.DragEvent) => {
    if (!draggingChannelId) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setChannelDropIndex(index)
  }

  const handleChannelDragEnd = () => {
    setDraggingChannelId(null)
    setChannelDropIndex(null)
  }

  const handleChannelDrop = (index: number) => (e: React.DragEvent) => {
    if (!draggingChannelId) return
    e.preventDefault()
    const from = channels.findIndex(c => c.id === draggingChannelId)
    handleChannelDragEnd()
    if (from === -1) return
    moveChannel(from, index)
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

  const resetToToday = () => {
    setCalendarDate(new Date())
    setTodayNavigationRequest(request => request + 1)
  }

  const moveCalendar = (direction: -1 | 1) => {
    setCalendarDate(current =>
      viewMode === 'month'
        ? shiftCalendarMonth(current, direction)
        : addDays(current, direction * 7),
    )
  }

  // Returning to the current week must also reveal today's column inside the
  // horizontally scrollable week board. Run before paint and use an immediate
  // scroll so mobile browsers cannot drop the navigation during the rerender.
  useLayoutEffect(() => {
    if (todayNavigationRequest === 0 || viewMode !== 'week') return

    let frame = 0
    let attempts = 0
    const revealToday = () => {
      const container = weekBoardScrollRef.current
      const today = container?.querySelector<HTMLElement>(`[data-calendar-date="${toDateKey(new Date())}"]`)
      if (!container || !today) {
        if (attempts++ < 2) frame = requestAnimationFrame(revealToday)
        return
      }
      const containerRect = container.getBoundingClientRect()
      const todayRect = today.getBoundingClientRect()

      container.scrollTo({
        left: centeredScrollLeft({
          currentScrollLeft: container.scrollLeft,
          containerLeft: containerRect.left,
          containerWidth: containerRect.width,
          targetLeft: todayRect.left,
          targetWidth: todayRect.width,
        }),
        behavior: 'auto',
      })
    }
    frame = requestAnimationFrame(revealToday)

    return () => cancelAnimationFrame(frame)
  }, [todayNavigationRequest, viewMode, weekStart])

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

  /* ── no calendars available ────────────────────────────────────── */
  if (activeCalendars.length === 0) {
    return (
      <section className="overflow-hidden rounded-lg border bg-background shadow-sm">
        <div className="bg-brand-band px-4 py-4 text-brand-band-foreground sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-normal text-brand-accent">
            <CalendarDays className="h-4 w-4" />
            2026 Calendar
          </div>
          <h2 className="mt-1 text-2xl font-bold tracking-normal sm:text-3xl">Marketing Calendar</h2>
        </div>
        <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
          <CalendarDays className="h-10 w-10 text-muted-foreground" />
          <div>
            <h3 className="text-lg font-semibold">
              {isAdmin ? 'No marketing calendars yet' : 'No marketing calendar access yet'}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {isAdmin
                ? 'Create a calendar to start scheduling content.'
                : 'Ask an admin to add you to a marketing calendar.'}
            </p>
          </div>
          {isAdmin && (
            <Button type="button" className="gap-1.5" onClick={() => setManageOpen(true)}>
              <Plus className="h-4 w-4" /> Create calendar
            </Button>
          )}
        </div>
        {isAdmin && (
          <MarketingCalendarManagement
            open={manageOpen}
            onOpenChange={setManageOpen}
            calendars={calendars}
            onChange={refetchCalendars}
          />
        )}
      </section>
    )
  }

  return (
    <section className="overflow-hidden rounded-lg border bg-background shadow-sm">

      {/* ── Header ──────────────────────────────────────────────────── */}
      <div className="bg-brand-band px-4 py-4 text-brand-band-foreground sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-normal text-brand-accent">
              <CalendarDays className="h-4 w-4" />
              2026 Calendar
            </div>
            <h2 className="mt-1 break-words text-2xl font-bold tracking-normal sm:text-3xl">
              {selectedCalendar ? selectedCalendar.name : 'Posting Board'}
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
            <div className="rounded-md border border-brand-band-foreground/15 bg-brand-band-foreground/10 p-3">
              <div className="text-xl font-semibold">{completionPercent}%</div>
              <div className="text-xs text-brand-band-muted">Posted</div>
            </div>
            <div className="rounded-md border border-brand-band-foreground/15 bg-brand-band-foreground/10 p-3">
              <div className="text-xl font-semibold">{checkedPeriod}/{periodItems.length}</div>
              <div className="text-xs text-brand-band-muted">{viewMode === 'month' ? 'This month' : 'This week'}</div>
            </div>
            <div className="rounded-md border border-brand-band-foreground/15 bg-brand-band-foreground/10 p-3">
              <div className="text-xl font-semibold">{checkedVisible}/{totalVisible}</div>
              <div className="text-xs text-brand-band-muted">All time</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Controls ─────────────────────────────────────────────────── */}
      <div className="border-b bg-muted/40 px-4 py-4 sm:px-6">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-wrap items-center gap-2">
            {activeCalendars.length > 1 && (
              <select
                value={selectedCalendarId ?? ''}
                onChange={e => setSelectedCalendarId(e.target.value)}
                aria-label="Select calendar"
                className="h-9 rounded-md border bg-background px-2.5 text-sm font-semibold"
              >
                {activeCalendars.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <Button type="button" variant="outline" size="icon" onClick={() => moveCalendar(-1)}
              aria-label={viewMode === 'month' ? 'Previous month' : 'Previous week'}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="min-w-[168px] rounded-md border bg-background px-3 py-2 text-center text-sm font-semibold">
              {rangeLabel}
            </div>
            <Button type="button" variant="outline" size="icon" onClick={() => moveCalendar(1)}
              aria-label={viewMode === 'month' ? 'Next month' : 'Next week'}>
              <ChevronRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={resetToToday}>Today</Button>

            <div className="ml-1 flex overflow-hidden rounded-md border">
              {([
                { mode: 'week' as ViewMode, label: 'Week',     Icon: Columns3 },
                { mode: 'month' as ViewMode, label: 'Month',   Icon: CalendarRange },
                { mode: 'grid' as ViewMode, label: 'Channels', Icon: Table2 },
              ]).map(({ mode, label, Icon }) => (
                <button key={mode} type="button" onClick={() => setViewMode(mode)}
                  aria-pressed={viewMode === mode}
                  className={cn('flex items-center gap-1.5 px-3 py-2 text-xs font-semibold transition-colors',
                    viewMode === mode ? 'bg-foreground text-background' : 'bg-background text-muted-foreground hover:text-foreground')}>
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Company filter - one company at a time; an empty selection means "All". */}
            <Button type="button" size="sm" variant={activeCompanyIds.length === 0 ? 'default' : 'outline'}
              aria-pressed={activeCompanyIds.length === 0}
              onClick={() => setActiveCompanyIds([])} className="min-w-14">
              All
            </Button>
            {companies.map(c => {
              const on = activeCompanyIds.includes(c.id)
              return (
                <Button key={c.id} type="button" size="sm"
                  variant={on ? 'default' : 'outline'}
                  aria-pressed={on}
                  onClick={() => setActiveCompanyIds(prev =>
                    toggleCompanySelection(prev, c.id)
                  )}
                  className="min-w-14"
                  style={on ? { backgroundColor: c.color, borderColor: c.color } : {}}>
                  {c.code}
                </Button>
              )
            })}
            <Button variant="outline" size="icon" onClick={() => { loadCalendar(); loadChannels(); loadCompanies() }} aria-label="Refresh calendar">
              <RefreshCw className="h-4 w-4" />
            </Button>

            {/* Not admin-gated: migration 105 lets any member of a marketing calendar maintain
                the shared channel list, which is the same set of people who can see this tab.
                Manage Calendars stays admin-only - that one grants other people access. */}
            <Button type="button" variant="outline" size="sm" className="gap-1.5"
              onClick={() => setChannelManagerOpen(true)}>
              <SlidersHorizontal className="h-4 w-4" />
              Edit channels
            </Button>

            {isAdmin && (
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setManageOpen(true)}>
                <Settings className="h-4 w-4" />
                Manage Calendars
              </Button>
            )}

            {/* New event */}
            <Button size="sm" onClick={() => openCreateDialog()} className="gap-1.5">
              <Plus className="h-4 w-4" />
              New event
            </Button>
          </div>
        </div>

        {error && <p className="mt-3 text-sm text-destructive">{error}</p>}

        {attachmentsUnavailable && (
          <p role="alert" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
            Event files can&apos;t be loaded right now, so attachments are hidden. Nothing you
            uploaded has been deleted. ({attachmentsUnavailable})
          </p>
        )}
      </div>

      {items.length === 0 && !error && (
        <div className="border-b px-4 py-3 text-sm text-muted-foreground sm:px-6">
          Marketing calendar is empty. Click any slot below (or &quot;New event&quot;) to add one.
        </div>
      )}
      <>
          {/* ── Week board ───────────────────────────────────────────── */}
          {viewMode === 'week' && (
            <div ref={weekBoardScrollRef} data-marketing-week-scroll className="max-h-[75vh] overflow-auto">
              <div className="grid min-w-[1080px] grid-cols-7 divide-x">
                {weekDays.map(date => {
                  const dateKey    = toDateKey(date)
                  const dayItems   = weekItemsByDate.get(dateKey) ?? []
                  const dayDone    = dayItems.filter(isPosted).length
                  const isToday    = dateKey === todayKey
                  const dayKey     = `day::${dateKey}`
                  const isDragOver = dragOverKey === dayKey

                  return (
                    <div key={dateKey} data-calendar-date={dateKey}
                      className={cn('flex min-h-[360px] flex-col border-b transition-colors', isDragOver && 'bg-primary/5')}
                      onDragOver={handleCellDragOver(dayKey)}
                      onDragLeave={() => setDragOverKey(cur => cur === dayKey ? null : cur)}
                      onDrop={handleDayDrop(dateKey)}>

                      <div className={cn('sticky top-0 z-10 flex items-baseline justify-between border-b px-3 py-2',
                        isToday ? 'bg-foreground text-background' : 'bg-muted/40')}>
                        <div className="flex items-baseline gap-1.5">
                          <span className="text-[11px] font-bold uppercase">
                            {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][date.getDay()]}
                          </span>
                          <span className="text-lg font-black leading-none">{date.getDate()}</span>
                          {isToday && <span className="rounded-full bg-brand-accent px-1.5 text-[10px] font-bold text-brand-accent-foreground">Today</span>}
                        </div>
                        <span className={cn('text-[11px] font-medium', isToday ? 'text-brand-band-muted' : 'text-muted-foreground')}>
                          {dayItems.length ? `${dayDone}/${dayItems.length} posted` : '-'}
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
                              onOpenAttachment={() => openAttachmentDialog(item)}
                              onToggle={() => toggleItem(item)}
                              onEditReason={() => openReasonDialog(item)}
                              onDragStart={handleDragStart(item)}
                              onDragEnd={handleDragEnd}
                            />
                          )
                        })}
                        {dayItems.length === 0 ? (
                          <button type="button" onClick={() => openCreateDialog({ date: dateKey })}
                            className={cn('flex flex-1 items-center justify-center rounded-md border border-dashed bg-muted/50 text-[11px] text-muted-foreground/60 transition-colors hover:border-foreground/30 hover:text-foreground',
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

          {/* ── Month board ──────────────────────────────────────────── */}
          {viewMode === 'month' && (
            <div className="overflow-hidden">
                <div className="grid grid-cols-7 border-b bg-foreground text-background">
                  {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(day => (
                    <div key={day} className="border-r px-0.5 py-2 text-center text-[11px] font-bold uppercase tracking-wide last:border-r-0 sm:px-2">
                      <span className="sm:hidden">{day[0]}</span>
                      <span className="hidden sm:inline">{day}</span>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-7">
                  {monthDays.map(date => {
                    const dateKey = toDateKey(date)
                    const dayItems = monthItemsByDate.get(dateKey) ?? []
                    const shownItems = dayItems.slice(0, 3)
                    const hiddenCount = dayItems.length - shownItems.length
                    const inCurrentMonth = date.getMonth() === calendarDate.getMonth()
                      && date.getFullYear() === calendarDate.getFullYear()
                    const isToday = dateKey === todayKey
                    const isWeekend = date.getDay() === 0 || date.getDay() === 6

                    return (
                      <div key={dateKey} data-month-date={dateKey}
                        className={cn(
                          'group/month flex min-h-[92px] min-w-0 flex-col border-b border-r p-1 transition-colors sm:min-h-[132px] sm:p-1.5',
                          inCurrentMonth ? 'bg-background' : 'bg-muted text-muted-foreground',
                          isWeekend && inCurrentMonth && 'bg-muted/50',
                          isToday && 'ring-2 ring-inset ring-foreground',
                        )}>
                        <div className="mb-1 flex items-center justify-between gap-1">
                          <span className={cn(
                            'flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold',
                            isToday && 'bg-foreground text-brand-accent',
                          )}>
                            {date.getDate()}
                          </span>
                          {dayItems.length > 0 && (
                            <span className="text-[10px] font-medium text-muted-foreground">
                              {dayItems.filter(isPosted).length}/{dayItems.length}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-1 flex-col gap-1">
                          {shownItems.map(item => {
                            const itemState = stateOf(item)
                            const editable = isEditable(item)
                            const primaryColor = item.companies[0]?.color ?? '#64748b'
                            return (
                              <div key={item.id}
                                className={cn(
                                  'flex min-w-0 items-center gap-1 rounded border bg-background px-1 py-1 text-left text-[11px] leading-tight transition-colors hover:border-foreground/30 sm:px-1.5',
                                  itemState === 'posted' && 'text-muted-foreground line-through',
                                  itemState === 'missed' && 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300',
                                )}>
                                <button type="button"
                                  disabled={busyItemId === item.id}
                                  onClick={() => editable ? openEditDialog(item) : toggleItem(item)}
                                  aria-label={`${item.content}, ${item.channel}`}
                                  title={`${item.content} · ${item.channel}`}
                                  className="flex min-w-0 flex-1 items-center gap-1 text-left">
                                  <span className="flex flex-shrink-0 -space-x-0.5">
                                    {(item.companies.length ? item.companies : [{ id: 'none', color: '#9ca3af' }]).slice(0, 2).map((company, index) => (
                                      <span key={company.id ?? index} className="h-2 w-2 rounded-full ring-1 ring-background"
                                        style={{ backgroundColor: company.color ?? primaryColor }} />
                                    ))}
                                  </span>
                                  <span className="hidden truncate font-medium sm:block">{item.content}</span>
                                </button>
                                <button type="button"
                                  onClick={() => openAttachmentDialog(item)}
                                  aria-label={item.attachment ? `Open file for ${item.content}` : `Attach file to ${item.content}`}
                                  className={cn(
                                    'flex-shrink-0 rounded p-0.5',
                                    item.attachment ? 'text-sky-700 dark:text-sky-300' : 'text-muted-foreground/50 hover:text-foreground',
                                  )}>
                                  {item.attachment
                                    ? <FileText className="h-3 w-3" />
                                    : <Paperclip className="h-3 w-3" />}
                                </button>
                              </div>
                            )
                          })}

                          {hiddenCount > 0 && (
                            <button type="button"
                              onClick={() => { setCalendarDate(date); setViewMode('week') }}
                              className="rounded px-1.5 py-0.5 text-left text-[10px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground">
                              <span className="sm:hidden">+{hiddenCount}</span>
                              <span className="hidden sm:inline">+{hiddenCount} more - open week</span>
                            </button>
                          )}

                          <button type="button"
                            aria-label={`Add event on ${fullDateFormatter.format(date)}`}
                            aria-current={isToday ? 'date' : undefined}
                            onClick={() => openCreateDialog({ date: dateKey })}
                            className="mt-auto flex min-h-7 items-center justify-center rounded border border-dashed border-transparent text-[10px] font-medium text-muted-foreground/60 opacity-100 transition-all hover:border-foreground/30 hover:text-foreground sm:opacity-0 sm:group-hover/month:opacity-100 sm:focus-visible:opacity-100">
                            <Plus className="h-3 w-3 sm:mr-1" /><span className="hidden sm:inline">Add</span>
                          </button>
                        </div>
                      </div>
                    )
                  })}
                </div>
            </div>
          )}

          {/* ── Channel grid ─────────────────────────────────────────── */}
          {viewMode === 'grid' && (
          <div className="max-h-[75vh] overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="sticky left-0 top-0 z-40 w-[142px] border-b border-r bg-foreground px-3 py-2 text-left text-xs font-bold uppercase text-background">
                    Date
                  </th>
                  {/* Columns are rearrangeable: drag a header, or use the arrows
                      (drag-and-drop is neither keyboard- nor touch-reachable). The
                      order is shared, so it moves for every member of the calendar. */}
                  {channels.map((ch, index) => {
                    const isRenaming = renamingChannelId === ch.id
                    return (
                    <th key={ch.channel}
                      // ⚠️ Not draggable while renaming. A drag started inside the input -
                      // which is what selecting text with the mouse looks like to the browser -
                      // picks the whole column up instead, so the edit is lost to a reorder
                      // nobody asked for.
                      draggable={!isRenaming}
                      onDragStart={handleChannelDragStart(ch.id)}
                      onDragOver={handleChannelDragOver(index)}
                      onDrop={handleChannelDrop(index)}
                      onDragEnd={handleChannelDragEnd}
                      aria-label={`${ch.label} column, position ${index + 1} of ${channels.length}`}
                      className={cn(
                        'group/col sticky top-0 z-30 w-[150px] select-none border-b border-r bg-foreground/95 px-1 py-2 text-center text-xs font-semibold text-background',
                        isRenaming ? 'cursor-default' : 'cursor-grab',
                        draggingChannelId === ch.id && 'cursor-grabbing opacity-40',
                        channelDropIndex === index && draggingChannelId !== ch.id && 'ring-2 ring-inset ring-primary',
                      )}>
                      {isRenaming ? (
                        <div className="flex items-center gap-0.5">
                          <input
                            autoFocus
                            // ⚠️ size={1}, not just min-w-0. An <input> carries an intrinsic
                            // width of about 20 characters, and in a border-collapse table
                            // that beats the th's w-[150px] - so the column visibly widened
                            // the moment you started typing and snapped back when you saved.
                            size={1}
                            value={renameChannelValue}
                            disabled={renameChannelBusy}
                            onChange={e => setRenameChannelValue(e.target.value)}
                            onKeyDown={e => {
                              if (e.key === 'Enter') { e.preventDefault(); void commitChannelRename(ch) }
                              if (e.key === 'Escape') { e.preventDefault(); cancelChannelRename() }
                            }}
                            aria-label={`Rename ${ch.label}`}
                            className="h-7 min-w-0 flex-1 rounded border border-background/30 bg-background px-1.5 text-xs font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
                          />
                          <button type="button"
                            disabled={renameChannelBusy || !renameChannelValue.trim()}
                            onClick={() => void commitChannelRename(ch)}
                            aria-label="Save channel name"
                            className="rounded p-0.5 text-background/70 transition hover:bg-background/10 hover:text-background disabled:opacity-40">
                            {renameChannelBusy
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Check className="h-3.5 w-3.5" />}
                          </button>
                          <button type="button"
                            disabled={renameChannelBusy}
                            onClick={cancelChannelRename}
                            aria-label="Cancel rename"
                            className="rounded p-0.5 text-background/70 transition hover:bg-background/10 hover:text-background disabled:opacity-40">
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                      <div className="flex items-center justify-center gap-0.5">
                        <button type="button"
                          disabled={index === 0}
                          onClick={() => moveChannel(index, index - 1)}
                          aria-label={`Move ${ch.label} left`}
                          className="rounded p-0.5 text-background/50 opacity-0 transition hover:bg-background/10 hover:text-background focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-0 group-hover/col:opacity-100">
                          <ChevronLeft className="h-3.5 w-3.5" />
                        </button>
                        {/* The name is the control. A pencil sitting beside it would need a
                            fourth icon in 150px, and the two arrows already own that space. */}
                        <button type="button"
                          onClick={() => startChannelRename(ch)}
                          aria-label={`Rename ${ch.label}`}
                          className="flex min-w-0 flex-1 items-center justify-center gap-1 rounded px-0.5 py-0.5 transition hover:bg-background/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/60">
                          <span className="truncate">{ch.label}</span>
                          <Pencil className="h-3 w-3 flex-shrink-0 text-background/50 opacity-0 transition group-hover/col:opacity-100" aria-hidden="true" />
                        </button>
                        <button type="button"
                          disabled={index === channels.length - 1}
                          onClick={() => moveChannel(index, index + 1)}
                          aria-label={`Move ${ch.label} right`}
                          className="rounded p-0.5 text-background/50 opacity-0 transition hover:bg-background/10 hover:text-background focus-visible:opacity-100 disabled:pointer-events-none disabled:opacity-0 group-hover/col:opacity-100">
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      )}
                    </th>
                  )})}
                </tr>
              </thead>
              <tbody>
                {weekDays.map(date => {
                  const dateKey = toDateKey(date)
                  const dayItems = weekItems.filter(i => i.date === dateKey)
                  const dayDone  = dayItems.filter(isPosted).length
                  const isToday  = dateKey === todayKey

                  return (
                    <tr key={dateKey} className={cn('align-top', isToday && 'bg-surface-note')}>
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
                                    onOpenAttachment={() => openAttachmentDialog(item)}
                                    onToggle={() => toggleItem(item)}
                                    onEditReason={() => openReasonDialog(item)}
                                    onDragStart={handleDragStart(item)}
                                    onDragEnd={handleDragEnd}
                                  />
                                )
                              })}
                              <button type="button"
                                onClick={() => openCreateDialog({ date: dateKey, channel: ch.channel })}
                                className={cn('group flex min-h-[36px] flex-1 items-center justify-center rounded-md border border-dashed bg-muted/50 text-muted-foreground/40 transition-colors hover:border-foreground/30 hover:text-foreground')}>
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
          <div className="border-t bg-muted/60 px-4 py-5 sm:px-6">
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
                  <Badge variant="outline" className="gap-1 border-red-300 text-red-600 dark:border-red-800 dark:text-red-400">
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
                          <p className={cn('text-xs', allDone ? 'text-green-600 font-medium dark:text-green-400' : 'text-muted-foreground')}>
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
                              posted ? 'bg-muted/40' : missed ? 'bg-red-50 dark:bg-red-950/40' : 'hover:bg-accent/40')}>
                              {/* Status toggle (marks posted) */}
                              <button type="button" disabled={busyItemId === item.id} onClick={() => toggleItem(item)}
                                aria-label={posted ? 'Mark as not posted' : 'Mark as posted'}
                                className={cn('flex-shrink-0 transition-colors',
                                  posted ? 'text-green-600 dark:text-green-400' : missed ? 'text-red-500 hover:text-green-600' : 'text-muted-foreground hover:text-foreground')}>
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
                                style={{
                                  borderColor: withAlpha(primaryColor, 0.5),
                                  backgroundColor: withAlpha(primaryColor, 0.08),
                                  // The 8% tint lightens the ground, so measure against the
                                  // composited chip, not the card underneath it.
                                  color: readableInk(primaryColor, compositeOver(primaryColor, 0.08, surface.card)),
                                }}>
                                {item.channel}
                              </span>

                              {/* Content + reason */}
                              <span className="flex min-w-0 flex-1 flex-col">
                                <span
                                  onClick={() => editable && openEditDialog(item)}
                                  className={cn('truncate text-sm', editable && 'cursor-pointer hover:underline',
                                    posted && 'text-muted-foreground line-through decoration-2',
                                    missed && 'text-red-700 dark:text-red-300')}>
                                  {item.content}
                                </span>
                                {missed && (
                                  <button type="button" onClick={() => openReasonDialog(item)}
                                    className={cn('mt-0.5 flex items-center gap-1 text-left text-[11px] transition-colors hover:underline',
                                      note ? 'text-red-700 dark:text-red-300' : 'text-red-600 dark:text-red-300')}>
                                    <Pencil className="h-3 w-3 flex-shrink-0" />
                                    <span className="truncate">{note ? note : 'Add reason'}</span>
                                  </button>
                                )}
                              </span>

                              {/* Badges */}
                              <div className="flex flex-shrink-0 items-center gap-1.5">
                                <button type="button" onClick={() => openAttachmentDialog(item)}
                                  aria-label={item.attachment ? `Open file for ${item.content}` : `Attach file to ${item.content}`}
                                  title={item.attachment ? 'Open attached file' : 'Attach a file'}
                                  className={cn(
                                    'rounded p-1 transition-colors',
                                    item.attachment
                                      ? 'bg-sky-100 text-sky-700 hover:bg-sky-200 dark:bg-sky-950/60 dark:text-sky-300'
                                      : 'text-muted-foreground opacity-60 hover:bg-muted hover:text-foreground group-hover:opacity-100',
                                  )}>
                                  {item.attachment
                                    ? <FileText className="h-3.5 w-3.5" />
                                    : <Paperclip className="h-3.5 w-3.5" />}
                                </button>
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
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Plus className="h-4 w-4" /> New Marketing Event
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleCreateEvent} className="space-y-4">

            <EventFormFields
              date={newDate} onDateChange={handleNewDateChange}
              time={newTime} onTimeChange={setNewTime}
              content={newContent} onContentChange={setNewContent}
              highlighted={newHighlighted} onToggleHighlighted={() => setNewHighlighted(h => !h)}
              companies={companies} selectedCompanyIds={newCompanyIds} onToggleCompany={toggleNewCompany}
              channels={channels} selectedChannels={newChannels} onToggleChannel={toggleNewChannel} multiChannel
              onAddChannel={handleAddChannel}
            />

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Paperclip className="h-3.5 w-3.5" /> Attachment (optional)
              </Label>
              <input
                ref={newAttachmentInputRef}
                type="file"
                accept={MARKETING_ASSET_ACCEPT}
                onChange={handleNewAttachmentChange}
                className="sr-only"
                aria-label="Choose a file to attach"
              />
              {newAttachmentFile ? (
                <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                  <span className="flex min-w-0 items-center gap-1.5 text-sm">
                    <FileText className="h-3.5 w-3.5 flex-shrink-0 text-sky-700 dark:text-sky-300" />
                    <span className="truncate font-medium">{newAttachmentFile.name}</span>
                    <span className="flex-shrink-0 text-xs text-muted-foreground">
                      {formatMarketingAssetSize(newAttachmentFile.size)}
                    </span>
                  </span>
                  <button type="button" onClick={() => setNewAttachmentFile(null)}
                    aria-label="Remove attachment" className="flex-shrink-0 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <button type="button" onClick={() => newAttachmentInputRef.current?.click()}
                  className="flex w-full items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-sky-400 hover:bg-sky-50/60 hover:text-sky-700">
                  <Upload className="h-3.5 w-3.5" />
                  Choose a file
                </button>
              )}
              {newAttachmentError && (
                <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{newAttachmentError}</p>
              )}
              {(newRecurrence !== 'none' || newChannels.length > 1) && newAttachmentFile && (
                <p className="text-xs text-muted-foreground">
                  This file will be attached to every post this creates.
                </p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label className="flex items-center gap-1.5">
                <Repeat className="h-3.5 w-3.5" /> Repeat
              </Label>
              <div className="flex flex-wrap gap-1.5">
                {(Object.keys(RECURRENCE_LABELS) as MarketingRecurrencePattern[]).map(p => (
                  <button key={p} type="button" onClick={() => setNewRecurrence(p)}
                    className={cn('rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                      newRecurrence === p ? 'bg-foreground text-background border-foreground' : 'bg-background hover:bg-accent')}>
                    {RECURRENCE_LABELS[p]}
                  </button>
                ))}
              </div>
              {newRecurrence !== 'none' && (
                <p className="text-xs text-muted-foreground">You can later edit one occurrence or move and update the entire series.</p>
              )}
            </div>

            {newRecurrence === 'custom' && (
              <div className="space-y-2 rounded-lg border p-3">
                <Label className="text-xs text-muted-foreground">Repeat on</Label>
                <div className="flex flex-wrap gap-1.5">
                  {WEEKDAYS.map(day => {
                    const active = newCustomWeekdays.includes(day.value)
                    return (
                      <button key={day.value} type="button" onClick={() => toggleNewCustomWeekday(day.value)}
                        aria-pressed={active}
                        className={cn('h-9 min-w-[3rem] rounded-md border px-2 text-sm font-medium transition-colors',
                          active ? 'border-foreground bg-foreground text-background' : 'border-input bg-background hover:bg-accent')}>
                        {day.label}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {newRecurrence !== 'none' && (
              <div className="space-y-2">
                <Label>Repeat until</Label>
                <Input type="date" value={newEndDate} min={newDate}
                  onChange={e => setNewEndDate(e.target.value)} required />
                {newScheduleInvalid ? (
                  <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                    {newScheduleInvalidReason}
                  </p>
                ) : (
                  <div className={cn(
                    'rounded-md border px-3 py-2.5 text-xs',
                    newScheduleTooLarge
                      ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300'
                      : 'border-sky-200 bg-sky-50/70 text-sky-950 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200',
                  )}>
                    <p className="font-semibold">
                      {newScheduleDateLimitReached ? (
                        <>More than {MAX_SCHEDULED_MARKETING_POSTS.toLocaleString()} recurring dates</>
                      ) : (
                        <>
                          {finalScheduleDates.length} recurring date{finalScheduleDates.length === 1 ? '' : 's'}
                          {' × '}
                          {newChannels.length || 0} channel{newChannels.length === 1 ? '' : 's'}
                          {' = '}
                          {newScheduledPostCount} scheduled post{newScheduledPostCount === 1 ? '' : 's'}
                        </>
                      )}
                    </p>
                    {!newScheduleDateLimitReached && newSchedulePreview.length > 0 && (
                      <p className="mt-1 leading-relaxed text-current/75">
                        {newSchedulePreview.map((date, index) => (
                          <span key={date}>
                            {index === newSchedulePreview.length - 1 && finalScheduleDates.length > 4 ? '… ' : ''}
                            {fullDateFormatter.format(parseDate(date))}
                            {index < newSchedulePreview.length - 1 ? ' · ' : ''}
                          </span>
                        ))}
                      </p>
                    )}
                    {!newScheduleDateLimitReached && newRecurrenceDates.length > 0 && newRecurrenceDates.at(-1) !== newEndDate && (
                      <p className="mt-1 text-current/75">
                        The end date is a cutoff. The last matching {RECURRENCE_LABELS[newRecurrence].toLowerCase()} date is{' '}
                        {fullDateFormatter.format(parseDate(newRecurrenceDates.at(-1)!))}.
                      </p>
                    )}
                    {newScheduleTooLarge && (
                      <p className="mt-1 font-medium">
                        Narrow the range or select fewer channels. The limit is {MAX_SCHEDULED_MARKETING_POSTS.toLocaleString()} posts.
                      </p>
                    )}
                  </div>
                )}

                {/* Bobby asked to be able to pick the exact days on a calendar rather than
                    read them off a list, because a custom range often should NOT repeat the
                    same weekdays every week. The grid and the list below are two views of one
                    schedule: both write the same skipped/added state. The grid hides itself for
                    a range too wide to lay out, and the list still handles that case. */}
                {!newScheduleDateLimitReached && !newInteractiveScheduleTooLarge && (
                  <div className="rounded-md border p-2">
                    <ScheduleDateGrid
                      startDateKey={newDate}
                      endDateKey={newEndDate || newDate}
                      patternDates={newRecurrenceDates}
                      skippedDates={newSkippedDates}
                      addedDates={newAddedDates}
                      onToggle={toggleNewScheduleDate}
                    />
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      Tap a day to add or remove it.
                    </p>
                  </div>
                )}

                {!newScheduleDateLimitReached && newRecurrenceDates.length > 0 && (
                  newInteractiveScheduleTooLarge ? (
                    <p className="text-xs text-muted-foreground">
                      Too many dates to list individually - add specific extra dates below if needed.
                    </p>
                  ) : (
                    <div className="max-h-40 space-y-px overflow-y-auto rounded-md border p-1">
                      {newRecurrenceDates.map(date => {
                        const skipped = newSkippedDates.has(date)
                        return (
                          <div key={date}
                            className={cn('flex items-center justify-between rounded px-2 py-1 text-xs',
                              skipped ? 'text-muted-foreground' : 'hover:bg-accent')}>
                            <span className={cn(skipped && 'line-through')}>
                              {fullDateFormatter.format(parseDate(date))}
                            </span>
                            <button type="button" onClick={() => toggleNewSkippedDate(date)}
                              aria-label={skipped ? `Include ${date}` : `Skip ${date}`}
                              className="text-muted-foreground transition-colors hover:text-foreground">
                              {skipped ? 'Undo' : <X className="h-3.5 w-3.5" />}
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  )
                )}

                {newAddedDates.length > 0 && (
                  <div className="space-y-1">
                    {newAddedDates.map(date => (
                      <div key={date}
                        className="flex items-center justify-between rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <span>{fullDateFormatter.format(parseDate(date))} · added</span>
                        <button type="button" onClick={() => removeNewAddedDate(date)}
                          aria-label={`Remove added date ${date}`}
                          className="text-emerald-700 transition-colors hover:text-emerald-900 dark:text-emerald-300">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <Input type="date" value={newExtraDate} onChange={e => setNewExtraDate(e.target.value)} className="h-8" />
                  <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" disabled={!newExtraDate} onClick={addNewExtraDate}>
                    <Plus className="h-3.5 w-3.5" /> Add date
                  </Button>
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1"
                disabled={creating || !newContent.trim() || newChannels.length === 0 || newCompanyIds.length === 0 || newScheduleInvalid || newScheduleTooLarge}>
                {creating
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : newChannels.length === 0
                    ? 'Create'
                    : newRecurrence === 'none'
                    ? `Create ${newScheduledPostCount} post${newScheduledPostCount === 1 ? '' : 's'}`
                    : 'Create series'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit Event Dialog ───────────────────────────────────────── */}
      <Dialog open={!!editItem} onOpenChange={open => !open && setEditItem(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Pencil className="h-4 w-4" /> Edit Marketing Event
              {editItem?.recurrence_group_id && (
                <Badge variant="outline" className="gap-1 font-normal">
                  <Repeat className="h-3 w-3" /> Repeating
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>
              Change this event&apos;s schedule and posting details.
            </DialogDescription>
          </DialogHeader>
          {editItem && (
            <form onSubmit={handleSaveEdit} className="space-y-4">
              {editItem.recurrence_group_id && (
                <div className="space-y-2">
                  <Label>Apply changes to</Label>
                  <div className="grid grid-cols-2 gap-2">
                    <button type="button" onClick={() => selectEditScope('single')}
                      aria-pressed={editScope === 'single'}
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-left transition-colors',
                        editScope === 'single'
                          ? 'border-foreground bg-muted ring-1 ring-foreground'
                          : 'bg-background hover:bg-accent',
                      )}>
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <Circle className="h-3.5 w-3.5" /> This event
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Only {dateFormatter.format(parseDate(editItem.date))}
                      </span>
                    </button>
                    <button type="button" onClick={() => selectEditScope('series')}
                      aria-pressed={editScope === 'series'}
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-left transition-colors',
                        editScope === 'series'
                          ? 'border-foreground bg-surface-note ring-1 ring-foreground'
                          : 'bg-background hover:bg-accent',
                      )}>
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <Repeat className="h-3.5 w-3.5" /> Entire series
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        {editSeriesDateCount} date{editSeriesDateCount === 1 ? '' : 's'}
                        {' · '}
                        {editSeriesChannelCount} channel{editSeriesChannelCount === 1 ? '' : 's'}
                      </span>
                    </button>
                  </div>
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300">
                    {editScope === 'series'
                      ? 'Changing the date shifts every repeat by the same amount, keeping the recurrence spacing intact.'
                      : 'The other repeats will keep their current dates and details.'}
                  </p>
                </div>
              )}
              <EventFormFields
                date={editDate} onDateChange={setEditDate}
                time={editTime} onTimeChange={setEditTime}
                content={editContent} onContentChange={setEditContent}
                highlighted={editHighlighted} onToggleHighlighted={() => setEditHighlighted(h => !h)}
                companies={companies} selectedCompanyIds={editCompanyIds} onToggleCompany={toggleEditCompany}
                channels={channels} selectedChannels={editChannels} onToggleChannel={toggleEditChannel} multiChannel
                onAddChannel={handleAddChannel}
              />

              {/* Channel edits create and delete rows, unlike every other field in
                  this form, so say what Save will do before it does it. */}
              {(editChannelsAdded.length > 0 || editChannelsRemoved.length > 0) && (
                <p className={cn(
                  'rounded-md border px-3 py-2 text-xs leading-relaxed',
                  editChannelIsRename
                    ? 'border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200'
                    : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300',
                )}>
                  {editChannelIsRename ? (
                    <>Moves {editScope === 'series' ? 'this series' : 'this event'} from{' '}
                      <strong>{channelLabelOf(editChannelsRemoved[0])}</strong> to{' '}
                      <strong>{channelLabelOf(editChannelsAdded[0])}</strong>. Check-offs and
                      attachments come with it.</>
                  ) : (
                    <>On save:{' '}
                      {editChannelsAdded.length > 0 && (
                        <>adds <strong>{editChannelsAdded.map(channelLabelOf).join(', ')}</strong>{' '}
                          across {editScopeDateCount} date{editScopeDateCount === 1 ? '' : 's'}
                          {editChannelsRemoved.length > 0 && '; '}</>
                      )}
                      {editChannelsRemoved.length > 0 && (
                        <>deletes every <strong>{editChannelsRemoved.map(channelLabelOf).join(', ')}</strong>{' '}
                          post{editScope === 'series' ? ' in this series' : ' on this date'}</>
                      )}.
                    </>
                  )}
                </p>
              )}

              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5">
                  <Paperclip className="h-3.5 w-3.5" /> Attachment (optional)
                </Label>
                <input
                  ref={editAttachmentInputRef}
                  type="file"
                  accept={MARKETING_ASSET_ACCEPT}
                  onChange={handleEditAttachmentChange}
                  className="sr-only"
                  aria-label="Choose a file to attach"
                />
                {editItem.attachment ? (
                  <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/30 px-3 py-2">
                    <span className="flex min-w-0 items-center gap-1.5 text-sm">
                      <FileText className="h-3.5 w-3.5 flex-shrink-0 text-sky-700 dark:text-sky-300" />
                      <span className="truncate font-medium">{editItem.attachment.file_name}</span>
                      <span className="flex-shrink-0 text-xs text-muted-foreground">
                        {formatMarketingAssetSize(editItem.attachment.file_size)}
                      </span>
                    </span>
                    <span className="flex flex-shrink-0 items-center gap-1">
                      <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs"
                        disabled={attachmentBusy !== null}
                        onClick={() => editAttachmentInputRef.current?.click()}>
                        {attachmentBusy === 'upload' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Replace'}
                      </Button>
                      <button type="button" onClick={() => removeAttachmentFromItem(editItem)}
                        disabled={attachmentBusy !== null}
                        aria-label="Remove attachment"
                        className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-destructive disabled:opacity-50">
                        {attachmentBusy === 'delete' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
                      </button>
                    </span>
                  </div>
                ) : (
                  <button type="button" onClick={() => editAttachmentInputRef.current?.click()}
                    disabled={attachmentBusy !== null}
                    className="flex w-full items-center gap-1.5 rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-sky-400 hover:bg-sky-50/60 hover:text-sky-700 disabled:opacity-50">
                    {attachmentBusy === 'upload'
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Upload className="h-3.5 w-3.5" />}
                    Choose a file
                  </button>
                )}
                {attachmentError && (
                  <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">{attachmentError}</p>
                )}
                <p className="text-[11px] text-muted-foreground">
                  Files save straight away and belong to this one date, not the whole series.
                </p>
              </div>

              {/* Adding dates is its own action - it inserts new rows rather than
                  editing this one, so it does not wait for Save. */}
              <div className="space-y-3 rounded-lg border p-3">
                <div className="space-y-1.5">
                  <Label className="flex items-center gap-1.5">
                    <Repeat className="h-3.5 w-3.5" />
                    {editItem.recurrence_group_id ? 'Add more dates' : 'Repeat this event'}
                  </Label>
                  <div className="flex flex-wrap gap-1.5">
                    {(Object.keys(RECURRENCE_LABELS) as MarketingRecurrencePattern[]).map(p => (
                      <button key={p} type="button" onClick={() => setEditRecurrence(p)}
                        aria-pressed={editRecurrence === p}
                        className={cn('rounded border px-2.5 py-1 text-xs font-medium transition-colors',
                          editRecurrence === p ? 'bg-foreground text-background border-foreground' : 'bg-background hover:bg-accent')}>
                        {RECURRENCE_LABELS[p]}
                      </button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {editItem.recurrence_group_id
                      ? 'New dates copy this series’ saved content, companies, and channel.'
                      : 'Turns this one-off into a series. New dates copy its saved content, companies, and channel.'}
                  </p>
                </div>

                {editRecurrence === 'custom' && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Repeat on</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {WEEKDAYS.map(day => {
                        const active = editCustomWeekdays.includes(day.value)
                        return (
                          <button key={day.value} type="button" onClick={() => toggleEditCustomWeekday(day.value)}
                            aria-pressed={active}
                            className={cn('h-9 min-w-[3rem] rounded-md border px-2 text-sm font-medium transition-colors',
                              active ? 'border-foreground bg-foreground text-background' : 'border-input bg-background hover:bg-accent')}>
                            {day.label}
                          </button>
                        )
                      })}
                    </div>
                    {editCustomWeekdays.length === 0 && (
                      <p role="alert" className="text-xs font-medium text-red-600 dark:text-red-400">
                        Select at least one weekday, or add specific dates below.
                      </p>
                    )}
                  </div>
                )}

                {editRecurrence !== 'none' && (
                  <div className="space-y-2">
                    <Label className="text-xs text-muted-foreground">Repeat until</Label>
                    <Input type="date" value={editEndDate} min={editDate}
                      onChange={e => setEditEndDate(e.target.value)} className="h-9" />
                    {!editInteractiveScheduleTooLarge && editRecurrenceDates.length > 0 && (
                      <div className="max-h-40 space-y-px overflow-y-auto rounded-md border p-1">
                        {editRecurrenceDates.map(date => {
                          const alreadyScheduled = editSeriesDateKeys.split(',').includes(date)
                          const skipped = editSkippedDates.has(date)
                          return (
                            <div key={date}
                              className={cn('flex items-center justify-between rounded px-2 py-1 text-xs',
                                skipped || alreadyScheduled ? 'text-muted-foreground' : 'hover:bg-accent')}>
                              <span className={cn(skipped && 'line-through')}>
                                {fullDateFormatter.format(parseDate(date))}
                                {alreadyScheduled && ' · already scheduled'}
                              </span>
                              {!alreadyScheduled && (
                                <button type="button" onClick={() => toggleEditSkippedDate(date)}
                                  aria-label={skipped ? `Include ${date}` : `Skip ${date}`}
                                  className="text-muted-foreground transition-colors hover:text-foreground">
                                  {skipped ? 'Undo' : <X className="h-3.5 w-3.5" />}
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    )}
                    {editInteractiveScheduleTooLarge && (
                      <p className="text-xs text-muted-foreground">
                        Too many dates to list individually - narrow the range to review them.
                      </p>
                    )}
                  </div>
                )}

                {editAddedDates.length > 0 && (
                  <div className="space-y-1">
                    {editAddedDates.map(date => (
                      <div key={date}
                        className="flex items-center justify-between rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-300">
                        <span>{fullDateFormatter.format(parseDate(date))} · added</span>
                        <button type="button" onClick={() => removeEditAddedDate(date)}
                          aria-label={`Remove added date ${date}`}
                          className="text-emerald-700 transition-colors hover:text-emerald-900 dark:text-emerald-300">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">Add a specific date</Label>
                  <div className="flex items-center gap-1.5">
                    <Input type="date" value={editExtraDate} onChange={e => setEditExtraDate(e.target.value)} className="h-8" />
                    <Button type="button" size="sm" variant="outline" className="h-8 shrink-0"
                      disabled={!editExtraDate} onClick={addEditExtraDate}>
                      <Plus className="h-3.5 w-3.5" /> Add date
                    </Button>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <Label className="text-xs text-muted-foreground">Time for new dates</Label>
                  <Input type="time" value={addTimeValue} onChange={e => setAddTimeValue(e.target.value)}
                    className="h-8 w-32" aria-label="Time for new dates" />
                </div>

                <Button type="button" variant="outline" className="w-full"
                  disabled={addingDate || editNewDates.length === 0 || editAddTooLarge}
                  onClick={handleAddOccurrences}>
                  {addingDate
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : editAddTooLarge
                      ? `Too many dates (limit ${MAX_SCHEDULED_MARKETING_POSTS.toLocaleString()})`
                      : editNewDates.length === 0
                        ? 'No new dates selected'
                        : `Add ${editNewDates.length} date${editNewDates.length === 1 ? '' : 's'}`}
                </Button>
              </div>

              {editSeriesOccurrences.length > 1 && (
                <div className="space-y-1.5">
                  <Label className="text-xs text-muted-foreground">
                    Dates in this series ({editSeriesOccurrences.length})
                  </Label>
                  <div className="max-h-40 space-y-px overflow-y-auto rounded-md border p-1">
                    {editSeriesOccurrences.map(occurrence => {
                      const isCurrent = occurrence.id === editItem.id
                      return (
                        <div key={occurrence.id}
                          className={cn('flex items-center justify-between rounded px-2 py-1 text-xs',
                            isCurrent ? 'bg-muted font-medium' : 'hover:bg-accent')}>
                          <span>
                            {fullDateFormatter.format(parseDate(occurrence.date))}
                            {occurrence.time ? ` · ${occurrence.time.slice(0, 5)}` : ''}
                            {isCurrent && ' · editing'}
                          </span>
                          {!isCurrent && (
                            <button type="button" onClick={() => handleRemoveOccurrence(occurrence)}
                              disabled={removingDateId === occurrence.id}
                              aria-label={`Remove ${occurrence.date} from the series`}
                              className="text-muted-foreground transition-colors hover:text-destructive disabled:opacity-50">
                              {removingDateId === occurrence.id
                                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                : <X className="h-3.5 w-3.5" />}
                            </button>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" size="icon" className="shrink-0 text-destructive hover:text-destructive"
                  onClick={handleDeleteFromEdit}
                  aria-label={editItem.recurrence_group_id && editScope === 'series' ? 'Delete series' : 'Delete this event only'}
                  title={editItem.recurrence_group_id && editScope === 'series' ? 'Delete series' : 'Delete this event only'}>
                  <Trash2 className="h-4 w-4" />
                </Button>
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditItem(null)}>
                  Cancel
                </Button>
                <Button type="submit" className="flex-1" disabled={savingEdit || !editContent.trim() || editChannels.length === 0 || editCompanyIds.length === 0}>
                  {savingEdit
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : editItem.recurrence_group_id && editScope === 'series' ? 'Save series' : 'Save event'}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Event File Dialog ────────────────────────────────────────── */}
      <Dialog
        open={!!attachmentItem}
        onOpenChange={open => {
          if (!open) {
            setAttachmentItem(null)
            setAttachmentError(null)
          }
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Paperclip className="h-4 w-4" /> Event file
            </DialogTitle>
            <DialogDescription>
              This file belongs only to this calendar event and stays available to download later.
            </DialogDescription>
          </DialogHeader>

          {attachmentItem && (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 px-3 py-2.5">
                <p className="truncate text-sm font-semibold">{attachmentItem.content}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {fullDateFormatter.format(parseDate(attachmentItem.date))} · {attachmentItem.channel}
                </p>
              </div>

              <input
                ref={attachmentInputRef}
                type="file"
                accept={MARKETING_ASSET_ACCEPT}
                onChange={handleAttachmentUpload}
                className="sr-only"
                aria-label="Choose an event file"
              />

              {attachmentItem.attachment ? (
                <>
                  <div className={cn(
                    'overflow-hidden rounded-xl border',
                    isMarketingAssetPreviewable(attachmentItem.attachment.mime_type)
                      ? 'bg-[linear-gradient(45deg,#f1f5f9_25%,transparent_25%,transparent_75%,#f1f5f9_75%),linear-gradient(45deg,#f1f5f9_25%,white_25%,white_75%,#f1f5f9_75%)] bg-[length:20px_20px] bg-[position:0_0,10px_10px]'
                      : 'bg-muted/30',
                  )}>
                    <div className="flex min-h-52 items-center justify-center">
                      {attachmentBusy === 'preview' ? (
                        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                      ) : attachmentPreviewUrl ? (
                        <img
                          src={attachmentPreviewUrl}
                          alt={attachmentItem.attachment.file_name}
                          className="max-h-[52dvh] w-full object-contain"
                        />
                      ) : !isMarketingAssetPreviewable(attachmentItem.attachment.mime_type) ? (
                        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
                          <FileText className="h-10 w-10 text-sky-700 dark:text-sky-300" />
                          Preview is not available for this file type
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
                          <ImageIcon className="h-8 w-8" />
                          Preview unavailable
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t bg-background/95 px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {attachmentItem.attachment.file_name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatMarketingAssetSize(attachmentItem.attachment.file_size)}
                        </span>
                      </span>
                      {isMarketingAssetPreviewable(attachmentItem.attachment.mime_type)
                        ? <ImageIcon className="h-4 w-4 flex-shrink-0 text-sky-700 dark:text-sky-300" />
                        : <FileText className="h-4 w-4 flex-shrink-0 text-sky-700 dark:text-sky-300" />}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <Button
                      type="button"
                      onClick={handleAttachmentDownload}
                      disabled={attachmentBusy !== null}
                      className="gap-1.5"
                    >
                      {attachmentBusy === 'download'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Download className="h-4 w-4" />}
                      Download
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => attachmentInputRef.current?.click()}
                      disabled={attachmentBusy !== null}
                      className="gap-1.5"
                    >
                      {attachmentBusy === 'upload'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Upload className="h-4 w-4" />}
                      Replace
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleAttachmentDelete}
                      disabled={attachmentBusy !== null}
                      className="gap-1.5 text-destructive hover:text-destructive"
                    >
                      {attachmentBusy === 'delete'
                        ? <Loader2 className="h-4 w-4 animate-spin" />
                        : <Trash2 className="h-4 w-4" />}
                      Remove
                    </Button>
                  </div>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => attachmentInputRef.current?.click()}
                  disabled={attachmentBusy !== null}
                  className="group flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-sky-200 bg-sky-50/60 px-6 text-center transition-colors hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-sky-900 dark:bg-sky-950/40"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-card text-sky-600 shadow-sm ring-1 ring-sky-500/20 dark:text-sky-400 transition-transform group-hover:-translate-y-0.5">
                    {attachmentBusy === 'upload'
                      ? <Loader2 className="h-5 w-5 animate-spin" />
                      : <Paperclip className="h-5 w-5" />}
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-foreground">
                      {attachmentBusy === 'upload' ? 'Uploading file…' : 'Choose a file'}
                    </span>
                    <span className="mt-1 block text-xs text-muted-foreground">
                      Images, video, PDF, Office, text, or ZIP · up to 50 MB
                    </span>
                  </span>
                </button>
              )}

              {attachmentError && (
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
                  {attachmentError}
                </p>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Missed Reason Dialog ─────────────────────────────────────── */}
      <Dialog open={!!reasonItem} onOpenChange={open => !open && setReasonItem(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" /> Why was this missed?
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

      <ChannelManager
        open={channelManagerOpen}
        onOpenChange={setChannelManagerOpen}
        channels={allChannels}
        onRename={renameChannel}
        onSetArchived={setChannelArchived}
        onMove={moveChannel}
        onAdd={handleAddChannel}
      />

      {isAdmin && (
        <MarketingCalendarManagement
          open={manageOpen}
          onOpenChange={setManageOpen}
          calendars={calendars}
          onChange={refetchCalendars}
        />
      )}
    </section>
  )
}
