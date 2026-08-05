'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  BadgeCheck,
  CalendarDays,
  CalendarRange,
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
import { autoTextColor as autoText, withAlpha } from '@/lib/color'
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
import {
  buildCustomWeekdayDateKeys,
  buildRecurringDateKeys,
  buildRecurringSeriesScheduleUpdates,
  centeredScrollLeft,
  dayLabelForDateKey,
  isImportedWeekendPlaceholder,
  MAX_SCHEDULED_MARKETING_POSTS,
  type MarketingRecurrencePattern,
  reconcileCompanySelection,
  toggleCompanySelection,
} from './marketing-calendar-state'
import MarketingCalendarManagement from '../admin/marketing-calendar-management'
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

interface Channel {
  channel: string
  label: string
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
  checked_at: string
  status: CheckStatus
  note: string | null
}

interface MarketingCalendarProps {
  userId: string
  userName?: string
  isAdmin?: boolean
  // Every calendar the caller can see (RLS: admins see all, everyone else sees only their
  // memberships) — fetched once by the parent dashboard via useMarketingCalendars() so both the
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
// stops rendering (perf + usability — pruning a large series one row at a
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
                                     : 'border-gray-300 bg-white shadow-xs hover:bg-accent',
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
          <button type="button"
            onClick={e => { e.stopPropagation(); onOpenAttachment() }}
            aria-label={item.attachment ? 'Open attached file' : 'Attach a file'}
            title={item.attachment ? 'Open attached file' : 'Attach a file'}
            className={cn(
              'rounded p-0.5 transition-colors',
              item.attachment
                ? 'bg-sky-100 text-sky-700 hover:bg-sky-200'
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

export default function MarketingCalendar({ userId, userName, isAdmin = false, calendars, refetchCalendars }: MarketingCalendarProps) {
  const supabase = createClient()
  const [items,         setItems]         = useState<MarketingCalendarItem[]>([])
  // Every stored completion row (posted or missed), keyed by item id. Absence of a
  // row means pending — or, for a past item, auto-"missed" (computed in stateOf).
  const [statusByItem,  setStatusByItem]  = useState<Map<string, MarketingCalendarCheck>>(new Map())
  const [calendarDate,  setCalendarDate]  = useState(() => new Date())
  const [loading,       setLoading]       = useState(true)
  const [busyItemId,    setBusyItemId]    = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const weekBoardScrollRef = useRef<HTMLDivElement>(null)
  const [todayNavigationRequest, setTodayNavigationRequest] = useState(0)

  // Which calendar instance is currently loaded (migration 085 — calendars are now admin-created,
  // named, multi-instance, each with its own member list, instead of one calendar hardcoded to a
  // single owner). Archived calendars are excluded from selection but not from the raw `calendars`
  // prop, so the management dialog can still list/restore them.
  const activeCalendars = useMemo(() => calendars.filter(c => !c.is_archived), [calendars])
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null)
  const [manageOpen, setManageOpen] = useState(false)

  // Keep the selection valid as the calendar list changes (initial load, or after an admin
  // creates/archives one) — falls back to the first available calendar, or null if none exist.
  useEffect(() => {
    setSelectedCalendarId(current => {
      if (current && activeCalendars.some(c => c.id === current)) return current
      return activeCalendars[0]?.id ?? null
    })
  }, [activeCalendars])

  const selectedCalendar = activeCalendars.find(c => c.id === selectedCalendarId) ?? null

  // Companies (business units) — dynamic, managed from the Super Admin page.
  const [companies,        setCompanies]        = useState<Company[]>([])
  // Which companies are shown in the board/grid. An empty list means "All".
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

  // Edit-event dialog (single channel). Editing a recurring instance updates
  // every instance in its series (content/highlight/companies), per how this
  // team wants recurring edits to behave.
  const [editItem,         setEditItem]         = useState<MarketingCalendarItem | null>(null)
  const [editDate,         setEditDate]         = useState('')
  const [editTime,         setEditTime]         = useState('')
  const [editCompanyIds,   setEditCompanyIds]   = useState<string[]>([])
  const [editChannel,      setEditChannel]      = useState('')
  const [editContent,      setEditContent]      = useState('')
  const [editHighlighted,  setEditHighlighted]  = useState(false)
  const [editScope,        setEditScope]        = useState<EditScope>('single')
  const [savingEdit,       setSavingEdit]       = useState(false)

  // "Add another date to this series" — a lightweight extra insert, separate
  // from the Save button, available only when editing an existing series.
  const [addDateValue, setAddDateValue] = useState('')
  const [addTimeValue, setAddTimeValue] = useState('')
  const [addingDate,   setAddingDate]   = useState(false)

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
  // Density of the pattern itself — gates whether the interactive skip
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
  // Distinguishes *why* nothing will be created — each cause needs a
  // different instruction, and "repeat until must be on/after the first
  // date" is actively misleading when the real problem is e.g. no weekday
  // selected on a Custom pattern.
  const newScheduleInvalidReason: string | null =
    finalScheduleDates.length > 0 ? null
    : newRecurrence === 'custom' && newCustomWeekdays.length === 0
      ? 'Select at least one weekday, or add specific dates below.'
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
      supabase.from('marketing_calendar_checks')
        .select('id,item_id,checked_at,status,note').eq('user_id', userId),
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
    setStatusByItem(new Map(((checkRows ?? []) as any[]).map(c => [
      c.item_id,
      { ...c, status: (c.status ?? 'posted') as CheckStatus, note: c.note ?? null } as MarketingCalendarCheck,
    ])))
  }, [selectedCalendarId, supabase, userId])

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
      arr.sort((a, b) => a.channel.localeCompare(b.channel) || a.position - b.position)
    }
    return m
  }, [visibleItems, weekKeys])

  const monthItemsByDate = useMemo(() => {
    const m = new Map<string, MarketingCalendarItem[]>()
    for (const item of visibleItems) {
      if (!monthKeys.has(item.date)) continue
      const arr = m.get(item.date) ?? []
      arr.push(item)
      m.set(item.date, arr)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.position - b.position || a.channel.localeCompare(b.channel))
    }
    return m
  }, [visibleItems, monthKeys])

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
        .delete().eq('item_id', item.id).eq('user_id', userId)
      if (e) { setStatusByItem(previous); setError('Could not update this item.') }
    } else {
      setStatusByItem(cur => new Map(cur).set(item.id, { id: `opt-${item.id}`, item_id: item.id, checked_at: new Date().toISOString(), status: next, note }))
      const { data, error: e } = await supabase.from('marketing_calendar_checks')
        .upsert({ item_id: item.id, user_id: userId, status: next, note }, { onConflict: 'item_id,user_id' })
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

  const handleAttachmentUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file || !attachmentItem) return

    const validationError = validateMarketingAsset(file)
    if (validationError) {
      setAttachmentError(validationError)
      return
    }

    const item = attachmentItem
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

  const handleAttachmentDelete = async () => {
    const item = attachmentItem
    const attachment = item?.attachment
    if (!item || !attachment) return

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
          description: `Only the first ${fanoutTargets.length} posts got the file — attach it to the rest individually.`,
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
    setEditChannel(item.channel)
    setEditContent(item.content)
    setEditHighlighted(item.is_highlighted)
    setEditScope(item.recurrence_group_id ? 'series' : 'single')
  }

  const toggleEditCompany = (id: string) =>
    setEditCompanyIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])

  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editItem || !editContent.trim() || !editChannel || editCompanyIds.length === 0) return
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
          anchorChannel: editItem.channel,
          nextChannel: editChannel,
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

      setSavingEdit(false)
      toast.success(
        `Updated ${editSeriesDateCount} date${editSeriesDateCount === 1 ? '' : 's'} across ${editSeriesChannelCount} channel${editSeriesChannelCount === 1 ? '' : 's'}`,
        updatedCount === scheduleUpdates.length ? undefined : {
          description: 'The calendar is refreshing to confirm the saved series.',
        },
      )
      setEditItem(null)
      loadCalendar()
      return
    }

    const dayLabel = dayLabelForDateKey(editDate)
    const { error: updateError } = await supabase.from('marketing_calendar_items').update({
      date:           editDate,
      time:           editTime || null,
      day_label:      dayLabel,
      channel:        editChannel,
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

    setSavingEdit(false)
    toast.success('Event updated')
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

  // Adds one more occurrence to an existing series. Deliberately reads from
  // editItem (the persisted content/highlight/companies), not the live
  // editContent/editHighlighted/editCompanyIds form state — those two can
  // differ whenever the user has typed unsaved changes but hasn't clicked
  // Save yet, and this action fires independently of that button.
  const handleAddDateToSeries = async () => {
    if (!editItem?.recurrence_group_id || !addDateValue || !selectedCalendarId) return
    setAddingDate(true)

    const { data: inserted, error: insertErr } = await supabase
      .from('marketing_calendar_items')
      .insert({
        calendar_id:    selectedCalendarId,
        assigned_to:    userId,
        date:           addDateValue,
        time:           addTimeValue || null,
        day_label:      dayLabelForDateKey(addDateValue),
        channel:        editItem.channel,
        content:        editItem.content,
        is_highlighted: editItem.is_highlighted,
        position:       0,
        source_sheet:   null,
        source_row:     null,
        source_column:  null,
        recurrence_group_id: editItem.recurrence_group_id,
      })
      .select('id')
      .single()

    if (insertErr || !inserted) {
      setAddingDate(false)
      toast.error('Could not add date to series', { description: insertErr?.message })
      return
    }

    const { error: compErr } = await supabase
      .from('marketing_calendar_item_companies')
      .insert(editItem.companies.map(c => ({ item_id: inserted.id, company_id: c.id })))

    setAddingDate(false)
    if (compErr) {
      toast.error('Date added, but companies could not be attached', { description: compErr.message })
    } else {
      toast.success('Added a date to the series')
    }
    setAddDateValue('')
    setAddTimeValue('')
    loadCalendar()
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
      <section className="force-light-theme rounded-lg border bg-background">
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
      <section className="force-light-theme overflow-hidden rounded-lg border bg-background shadow-sm">
        <div className="bg-[#070707] px-4 py-4 text-white sm:px-6">
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-normal text-[#fff842]">
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
              {selectedCalendar ? selectedCalendar.name : 'Posting Board'}
            </h2>
          </div>

          <div className="grid grid-cols-3 gap-2 text-center sm:min-w-[360px]">
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <div className="text-xl font-semibold">{completionPercent}%</div>
              <div className="text-xs text-white/70">Posted</div>
            </div>
            <div className="rounded-md border border-white/15 bg-white/10 p-3">
              <div className="text-xl font-semibold">{checkedPeriod}/{periodItems.length}</div>
              <div className="text-xs text-white/70">{viewMode === 'month' ? 'This month' : 'This week'}</div>
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
            {/* Company filter — one company at a time; an empty selection means "All". */}
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
          <p role="alert" className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
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
            <div ref={weekBoardScrollRef} data-marketing-week-scroll className="overflow-x-auto">
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

          {/* ── Month board ──────────────────────────────────────────── */}
          {viewMode === 'month' && (
            <div className="overflow-hidden">
                <div className="grid grid-cols-7 border-b bg-[#111] text-white">
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
                          inCurrentMonth ? 'bg-background' : 'bg-[#f5f5f5] text-muted-foreground',
                          isWeekend && inCurrentMonth && 'bg-[#fafafa]',
                          isToday && 'ring-2 ring-inset ring-[#111]',
                        )}>
                        <div className="mb-1 flex items-center justify-between gap-1">
                          <span className={cn(
                            'flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-xs font-bold',
                            isToday && 'bg-[#111] text-[#fff842]',
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
                                  itemState === 'missed' && 'border-red-200 bg-red-50 text-red-700',
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
                                    item.attachment ? 'text-sky-700' : 'text-muted-foreground/50 hover:text-foreground',
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
                              <span className="hidden sm:inline">+{hiddenCount} more — open week</span>
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
                                <button type="button" onClick={() => openAttachmentDialog(item)}
                                  aria-label={item.attachment ? `Open file for ${item.content}` : `Attach file to ${item.content}`}
                                  title={item.attachment ? 'Open attached file' : 'Attach a file'}
                                  className={cn(
                                    'rounded p-1 transition-colors',
                                    item.attachment
                                      ? 'bg-sky-100 text-sky-700 hover:bg-sky-200'
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
        <DialogContent className="force-light-theme max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
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
                    <FileText className="h-3.5 w-3.5 flex-shrink-0 text-sky-700" />
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
                <p role="alert" className="text-xs font-medium text-red-600">{newAttachmentError}</p>
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
                  <p role="alert" className="text-xs font-medium text-red-600">
                    {newScheduleInvalidReason}
                  </p>
                ) : (
                  <div className={cn(
                    'rounded-md border px-3 py-2.5 text-xs',
                    newScheduleTooLarge
                      ? 'border-red-200 bg-red-50 text-red-700'
                      : 'border-sky-200 bg-sky-50/70 text-sky-950',
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

                {!newScheduleDateLimitReached && newRecurrenceDates.length > 0 && (
                  newInteractiveScheduleTooLarge ? (
                    <p className="text-xs text-muted-foreground">
                      Too many dates to list individually — add specific extra dates below if needed.
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
                        className="flex items-center justify-between rounded border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-800">
                        <span>{fullDateFormatter.format(parseDate(date))} · added</span>
                        <button type="button" onClick={() => removeNewAddedDate(date)}
                          aria-label={`Remove added date ${date}`}
                          className="text-emerald-700 transition-colors hover:text-emerald-900">
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
        <DialogContent className="force-light-theme max-h-[calc(100dvh-2rem)] max-w-md overflow-y-auto">
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
                    <button type="button" onClick={() => setEditScope('single')}
                      aria-pressed={editScope === 'single'}
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-left transition-colors',
                        editScope === 'single'
                          ? 'border-[#111] bg-[#f5f5f5] ring-1 ring-[#111]'
                          : 'bg-background hover:bg-accent',
                      )}>
                      <span className="flex items-center gap-1.5 text-sm font-semibold">
                        <Circle className="h-3.5 w-3.5" /> This event
                      </span>
                      <span className="mt-0.5 block text-[11px] text-muted-foreground">
                        Only {dateFormatter.format(parseDate(editItem.date))}
                      </span>
                    </button>
                    <button type="button" onClick={() => setEditScope('series')}
                      aria-pressed={editScope === 'series'}
                      className={cn(
                        'rounded-md border px-3 py-2.5 text-left transition-colors',
                        editScope === 'series'
                          ? 'border-[#111] bg-[#fffde7] ring-1 ring-[#111]'
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
                  <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800">
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
                channels={channels} selectedChannels={editChannel ? [editChannel] : []}
                onToggleChannel={channel => setEditChannel(channel)}
                onAddChannel={handleAddChannel}
              />

              {editItem.recurrence_group_id && editScope === 'series' && (
                <div className="space-y-1.5 rounded-lg border p-3">
                  <Label className="text-xs text-muted-foreground">Add another date to this series</Label>
                  <div className="flex items-center gap-1.5">
                    <Input type="date" value={addDateValue} onChange={e => setAddDateValue(e.target.value)} className="h-8" />
                    <Input type="time" value={addTimeValue} onChange={e => setAddTimeValue(e.target.value)} className="h-8" />
                    <Button type="button" size="sm" variant="outline" className="h-8 shrink-0"
                      aria-label="Add this date to the series"
                      disabled={!addDateValue || addingDate} onClick={handleAddDateToSeries}>
                      {addingDate ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    Copies this series&apos; current content, companies, and channel.
                  </p>
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
                <Button type="submit" className="flex-1" disabled={savingEdit || !editContent.trim() || !editChannel || editCompanyIds.length === 0}>
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
        <DialogContent className="force-light-theme max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto">
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
                          <FileText className="h-10 w-10 text-sky-700" />
                          Preview is not available for this file type
                        </div>
                      ) : (
                        <div className="flex flex-col items-center gap-2 px-6 py-10 text-center text-sm text-muted-foreground">
                          <ImageIcon className="h-8 w-8" />
                          Preview unavailable
                        </div>
                      )}
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t bg-white/95 px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {attachmentItem.attachment.file_name}
                        </span>
                        <span className="block text-xs text-muted-foreground">
                          {formatMarketingAssetSize(attachmentItem.attachment.file_size)}
                        </span>
                      </span>
                      {isMarketingAssetPreviewable(attachmentItem.attachment.mime_type)
                        ? <ImageIcon className="h-4 w-4 flex-shrink-0 text-sky-700" />
                        : <FileText className="h-4 w-4 flex-shrink-0 text-sky-700" />}
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
                  className="group flex min-h-56 w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-sky-200 bg-sky-50/60 px-6 text-center transition-colors hover:border-sky-400 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-sky-700 shadow-sm ring-1 ring-sky-100 transition-transform group-hover:-translate-y-0.5">
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
                <p role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                  {attachmentError}
                </p>
              )}
            </div>
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
