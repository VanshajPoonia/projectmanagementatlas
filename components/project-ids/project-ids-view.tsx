'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Check, Copy, Download, Hash, Pencil, Search, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  LEDGER_TIME_ZONE,
  centralYearMonth,
  formatClaimedAt,
  matchesProjectIdSearch,
  nextSequence,
  upcomingProjectIds,
  usedThisMonth,
  type ProjectIdRow,
} from '@/lib/project-ids'

interface Company {
  id: string
  code: string
  name: string
  color: string
}

/**
 * How many upcoming numbers to look ahead. Nothing is reserved, so this exists only to
 * answer two questions: what is the next number ("Next available"), and is the month full
 * (an empty list disables the grab button). It used to also render a 12-tile "Ready to use"
 * board taking the left half of the screen — removed, because a list of numbers nobody has
 * claimed is not information anyone acts on, and it pushed the one control on this page
 * that people actually use into a narrow column beside it.
 */
const PREVIEW_COUNT = 12

export default function ProjectIdsView({ userId, userName }: { userId: string; userName: string }) {
  const [rows, setRows] = useState<ProjectIdRow[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [clientName, setClientName] = useState('')
  const [companyId, setCompanyId] = useState<string | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingValue, setEditingValue] = useState('')
  /** The number claimed in this session, kept on screen so it survives the toast. */
  const [lastClaimed, setLastClaimed] = useState<ProjectIdRow | null>(null)
  /** Which project ID most recently went to the clipboard, for the transient ✓ on its button. */
  const [copiedValue, setCopiedValue] = useState<string | null>(null)
  const supabase = createClient()

  // Same pattern as share-link-dialog.tsx: clipboard writes can be refused (an insecure
  // origin, a locked-down browser), and a silent failure here means someone pastes the
  // wrong number into a contract. Report the refusal instead of assuming it worked.
  const copyProjectId = useCallback(async (projectId: string, { silent = false } = {}) => {
    try {
      await navigator.clipboard.writeText(projectId)
      setCopiedValue(projectId)
      setTimeout(() => setCopiedValue((current) => (current === projectId ? null : current)), 1500)
      if (!silent) toast.success(`${projectId} copied`)
      return true
    } catch {
      if (!silent) {
        toast.error('Could not copy', { description: 'Select the number and copy it manually.' })
      }
      return false
    }
  }, [])

  // The prefix rolls over on Central midnight, not this browser's midnight, and it is only ever
  // a display value — claim_project_id() computes its own server-side.
  const yearMonth = centralYearMonth()

  const load = useCallback(async () => {
    const [ledger, companyList] = await Promise.all([
      supabase
        .from('project_ids')
        .select('id, project_id, year_month, seq, client_name, company_id, grabbed_by, grabbed_by_name, grabbed_at')
        .order('grabbed_at', { ascending: false }),
      supabase
        .from('companies')
        .select('id, code, name, color, position, is_archived')
        .order('position', { ascending: true }),
    ])
    if (ledger.data) setRows(ledger.data as ProjectIdRow[])
    if (companyList.data) {
      setCompanies(
        (companyList.data as Array<Company & { is_archived: boolean }>).filter((c) => !c.is_archived),
      )
    }
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    load()
  }, [load])

  const nextSeq = useMemo(() => nextSequence(rows, yearMonth), [rows, yearMonth])
  const preview = useMemo(
    () => upcomingProjectIds(yearMonth, nextSeq, PREVIEW_COUNT),
    [yearMonth, nextSeq],
  )
  const monthCount = useMemo(() => usedThisMonth(rows, yearMonth), [rows, yearMonth])
  const history = useMemo(
    () => rows.filter((row) => matchesProjectIdSearch(row, search)),
    [rows, search],
  )
  const companyById = useMemo(
    () => new Map(companies.map((c) => [c.id, c])),
    [companies],
  )

  const handleClaim = async () => {
    const trimmed = clientName.trim()
    if (!trimmed) {
      toast.error('Enter a client name before grabbing a number')
      return
    }
    setClaiming(true)
    const { data, error } = await supabase.rpc('claim_project_id', {
      p_client_name: trimmed,
      p_company_id: companyId,
    })
    setClaiming(false)

    if (error || !data) {
      // The number shown in the preview is never reserved, so the usual cause of a failure here
      // is someone else claiming it a moment earlier. Re-read so the preview tells the truth.
      toast.error(error?.message ?? 'Could not grab a project ID')
      load()
      return
    }

    const claimed = data as ProjectIdRow
    setRows((prev) => [claimed, ...prev])
    setLastClaimed(claimed)
    setClientName('')
    setCompanyId(null)

    // The number is always needed somewhere else the moment it exists — a folder name, an
    // estimate, an email. Put it on the clipboard without being asked, and say so, so nobody
    // has to wonder whether it happened. `silent` because the confirmation belongs in the one
    // toast below, not two stacked on top of each other.
    const copied = await copyProjectId(claimed.project_id, { silent: true })
    toast.success(
      copied ? `${claimed.project_id} is yours, and copied` : `Project ID ${claimed.project_id} is yours`,
      { description: copied ? `Recorded for ${claimed.client_name}` : 'Use the copy button to grab it.' },
    )
  }

  const startEditing = (row: ProjectIdRow) => {
    setEditingId(row.id)
    setEditingValue(row.client_name)
  }

  const saveClientName = async (row: ProjectIdRow) => {
    const trimmed = editingValue.trim()
    if (!trimmed || trimmed === row.client_name) {
      setEditingId(null)
      return
    }
    const previous = row.client_name
    setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, client_name: trimmed } : r)))
    setEditingId(null)

    const { error } = await supabase
      .from('project_ids')
      .update({ client_name: trimmed })
      .eq('id', row.id)
    if (error) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, client_name: previous } : r)))
      toast.error('Only the person who grabbed this number (or an admin) can rename it')
    }
  }

  const exportCsv = () => {
    const header = ['Project ID', 'Client', 'Business unit', 'Grabbed by', 'Date / time (Central)']
    const escape = (value: string) => `"${String(value ?? '').replace(/"/g, '""')}"`
    const lines = [
      header.map(escape).join(','),
      ...history.map((row) =>
        [
          row.project_id,
          row.client_name,
          row.company_id ? (companyById.get(row.company_id)?.name ?? '') : '',
          row.grabbed_by_name,
          formatClaimedAt(row.grabbed_at),
        ]
          .map(escape)
          .join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = `project-ids-${yearMonth}.csv`
    link.click()
    URL.revokeObjectURL(link.href)
  }

  return (
    <div className="space-y-6">
      {/* Two across on a phone; see task-overview.tsx for why. */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatTile label="Current prefix" value={yearMonth} />
        <StatTile label="Used this month" value={loading ? '—' : String(monthCount)} />
        <StatTile label="Total IDs used" value={loading ? '—' : String(rows.length)} />
        <StatTile label="Next available" value={loading ? '—' : preview[0] ?? 'Month full'} />
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Grab a number</CardTitle>
            <CardDescription>
              Claimed as <span className="font-medium text-foreground">{userName}</span> — taken from
              your sign-in, so the record always matches who actually took it.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* The number stays on screen after the toast has gone. A toast is the wrong place
                for something you have to read digit by digit, and re-copying should not mean
                hunting for the row in the history table below. */}
            {lastClaimed && (
              <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-primary bg-primary/5 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    Just grabbed
                  </p>
                  <p className="font-mono text-2xl font-bold tracking-tight">
                    {lastClaimed.project_id}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {lastClaimed.client_name}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => copyProjectId(lastClaimed.project_id)}
                  className="gap-2"
                >
                  {copiedValue === lastClaimed.project_id ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                  {copiedValue === lastClaimed.project_id ? 'Copied' : 'Copy'}
                </Button>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="project-id-client">Client name</Label>
              <Input
                id="project-id-client"
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !claiming) handleClaim()
                }}
                placeholder="Who is this project for?"
                maxLength={200}
              />
            </div>

            {companies.length > 0 && (
              <div className="space-y-2">
                <Label>Business unit (optional)</Label>
                <div className="flex flex-wrap gap-2">
                  {companies.map((company) => {
                    const selected = companyId === company.id
                    return (
                      <button
                        key={company.id}
                        type="button"
                        onClick={() => setCompanyId(selected ? null : company.id)}
                        aria-pressed={selected}
                        className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
                          selected ? 'text-white' : 'text-muted-foreground hover:text-foreground'
                        }`}
                        style={
                          selected
                            ? { backgroundColor: company.color, borderColor: company.color }
                            : undefined
                        }
                      >
                        {company.code}
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            <Button onClick={handleClaim} disabled={claiming || preview.length === 0} className="w-full">
              <Hash className="mr-2 h-4 w-4" />
              {claiming ? 'Grabbing…' : 'Grab next project ID'}
            </Button>

            {/* Carried over from the removed "Ready to use" panel: without it a disabled
                button is the only clue that the month has run out, which reads as a bug. */}
            {!loading && preview.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Every project ID for {yearMonth} has been used. The next number becomes available
                when the month rolls over.
              </p>
            )}

            <p className="text-xs text-muted-foreground">
              A number can never be released or reused once grabbed. Times are recorded in Central
              time ({LEDGER_TIME_ZONE.split('/')[1].replace('_', ' ')}).
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <CardTitle>Used project ID history</CardTitle>
            <CardDescription>Permanent cross-reference for every claimed number.</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search ID, client, or person…"
                className="w-56 pl-8"
                aria-label="Search project ID history"
              />
            </div>
            <Button variant="outline" size="sm" onClick={exportCsv} disabled={history.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Export CSV
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
          ) : history.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {rows.length === 0
                ? 'No project numbers have been used yet.'
                : 'No entries match that search.'}
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="py-2 pr-4 font-medium">Project ID</th>
                    <th className="py-2 pr-4 font-medium">Client</th>
                    <th className="py-2 pr-4 font-medium">Unit</th>
                    <th className="py-2 pr-4 font-medium">Grabbed by</th>
                    <th className="py-2 pr-4 font-medium">Date / time (Central)</th>
                    <th className="py-2 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {history.map((row) => {
                    const company = row.company_id ? companyById.get(row.company_id) : undefined
                    const canEdit = row.grabbed_by === userId
                    return (
                      <tr key={row.id} className="border-b last:border-0">
                        <td className="py-2 pr-4 font-mono font-semibold">
                          <span className="flex items-center gap-1">
                            {row.project_id}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={() => copyProjectId(row.project_id)}
                              aria-label={`Copy project ID ${row.project_id}`}
                              title={`Copy ${row.project_id}`}
                            >
                              {copiedValue === row.project_id
                                ? <Check className="h-3.5 w-3.5" />
                                : <Copy className="h-3.5 w-3.5" />}
                            </Button>
                          </span>
                        </td>
                        <td className="py-2 pr-4">
                          {editingId === row.id ? (
                            <div className="flex items-center gap-1">
                              <Input
                                value={editingValue}
                                onChange={(e) => setEditingValue(e.target.value)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') saveClientName(row)
                                  if (e.key === 'Escape') setEditingId(null)
                                }}
                                className="h-8 w-48"
                                autoFocus
                                aria-label={`Client name for ${row.project_id}`}
                              />
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => saveClientName(row)}
                                aria-label="Save client name"
                              >
                                <Check className="h-4 w-4" />
                              </Button>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8"
                                onClick={() => setEditingId(null)}
                                aria-label="Cancel"
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : (
                            row.client_name
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          {company ? (
                            <span
                              className="rounded-full px-2 py-0.5 text-xs font-medium text-white"
                              style={{ backgroundColor: company.color }}
                            >
                              {company.code}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="py-2 pr-4">{row.grabbed_by_name}</td>
                        <td className="py-2 pr-4 text-muted-foreground">{formatClaimedAt(row.grabbed_at)}</td>
                        <td className="py-2 text-right">
                          {canEdit && editingId !== row.id && (
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-8 w-8"
                              onClick={() => startEditing(row)}
                              aria-label={`Edit client for ${row.project_id}`}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-2 sm:pt-6">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        {/* A claimed project ID is eight digits; at 2-up on a phone it has to be allowed to
            break rather than push the card wide. */}
        <p className="mt-1 font-mono text-xl font-bold tracking-tight break-all sm:text-2xl">{value}</p>
      </CardContent>
    </Card>
  )
}
