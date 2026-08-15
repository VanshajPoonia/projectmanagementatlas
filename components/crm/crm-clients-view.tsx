'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Search, Send } from 'lucide-react'
import { toast } from 'sonner'

import { CrmShell, type CrmUser } from './crm-shell'
import type { ShellData } from '@/lib/shell-data'
import { Field, StatusPill } from './crm-primitives'
import { EmptyState } from '@/components/shell/states'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import { cn } from '@/lib/utils'
import {
  CLIENT_TYPES,
  activeStatuses,
  clientDisplayName,
  formatMoney,
  primaryContact,
  type CrmClient,
  type CrmStatus,
} from '@/lib/crm'

interface Profile {
  id: string
  full_name: string | null
  email: string | null
}

interface Note {
  id: string
  body: string
  created_at: string
  author_id: string | null
}

export function CrmClientsView({
  user,
  shell,
  clients: initialClients,
  statuses,
  profiles,
}: {
  user: CrmUser
  /** Server-loaded modules + calendars, handed straight to CrmShell. See lib/shell-data.ts. */
  shell?: ShellData
  clients: CrmClient[]
  statuses: CrmStatus[]
  profiles: Profile[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const [clients, setClients] = useState(initialClients)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(initialClients[0]?.id ?? null)

  const statusByKey = useMemo(() => new Map(statuses.map(s => [s.key, s])), [statuses])
  const profileById = useMemo(() => new Map(profiles.map(p => [p.id, p])), [profiles])

  // Search covers the four fields the header row shows plus the client reference, because
  // those are the things someone actually has to hand when they go looking: a name, a company,
  // an email off a thread, or a number read off a document.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return clients
    return clients.filter(client => {
      const contact = primaryContact(client.crm_contacts)
      return [
        client.client_ref,
        client.company_name,
        contact ? `${contact.first_name} ${contact.last_name}` : '',
        contact?.email,
        contact?.mobile_phone,
      ]
        .filter(Boolean)
        .some(value => String(value).toLowerCase().includes(q))
    })
  }, [clients, query])

  const selected = useMemo(
    () => filtered.find(c => c.id === selectedId) ?? filtered[0] ?? null,
    [filtered, selectedId],
  )

  const updateStatus = useCallback(
    async (clientId: string, status: string) => {
      const previous = clients
      // Optimistic, then reconciled: the select is the whole interaction, so waiting a round
      // trip to move it makes the list feel broken on a slow connection.
      setClients(cs => cs.map(c => (c.id === clientId ? { ...c, status } : c)))

      const { data, error } = await supabase
        .from('crm_clients')
        .update({ status, updated_at: new Date().toISOString() })
        .eq('id', clientId)
        .select('id')

      // PostgREST reports an RLS refusal as zero rows rather than an error, so the row count
      // is the only way to tell "saved" from "silently refused" (CLAUDE.md, migration 065).
      if (error || !data?.length) {
        setClients(previous)
        toast.error(error ? `Could not update status: ${error.message}` : 'You do not have permission to change this client.')
      }
    },
    [supabase, clients],
  )

  return (
    <CrmShell user={user} shell={shell} breadcrumbs={[{ label: 'CRM', href: '/crm' }, { label: 'Clients' }]}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Clients</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            {clients.length} client{clients.length === 1 ? '' : 's'} · change status inline without opening the record
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" aria-hidden />
            <Input
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search name, company, email, phone"
              aria-label="Search clients"
              className="w-full pl-8 sm:w-64"
            />
          </div>
          <Button asChild size="sm" className="shrink-0">
            <Link href="/crm/clients/new">New client</Link>
          </Button>
        </div>
      </header>

      {clients.length === 0 ? (
        <EmptyState
          title="No clients yet"
          description="Intake is where a client record starts. Add the first one to begin."
          action={
            <Button asChild size="sm">
              <Link href="/crm/clients/new">New client</Link>
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={`Nothing matches "${query}"`}
          description="Try a partial name, company, email address or phone number."
          action={
            <Button size="sm" variant="outline" onClick={() => setQuery('')}>
              Clear search
            </Button>
          }
        />
      ) : (
        <>
          {/*
            Below md the eight-column table becomes records. Picking a client is the whole
            point of this list (it drives the workspace underneath), so the card is the
            selection control, and the status select stays on it: changing status without
            opening the record is the feature, and it should not need a desktop.
          */}
          <ul className="space-y-2 md:hidden">
            {filtered.map(client => {
              const contact = primaryContact(client.crm_contacts)
              const rep = client.sales_rep_id ? profileById.get(client.sales_rep_id) : null
              const isSelected = selected?.id === client.id
              return (
                <li key={client.id}>
                  <div
                    role="button"
                    tabIndex={0}
                    aria-pressed={isSelected}
                    onClick={() => setSelectedId(client.id)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        setSelectedId(client.id)
                      }
                    }}
                    className={cn(
                      'focus-visible:ring-ring block w-full rounded-lg border p-3 text-left outline-none focus-visible:ring-2',
                      isSelected ? 'border-primary bg-accent' : 'bg-card',
                    )}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <span className="font-mono text-xs">{client.client_ref ?? '—'}</span>
                      <span className="text-muted-foreground text-xs">
                        {formatDistanceToNow(new Date(client.last_activity_at), { addSuffix: true })}
                      </span>
                    </div>
                    <p className="mt-1.5 font-medium">
                      {contact ? `${contact.first_name} ${contact.last_name}` : clientDisplayName(client)}
                    </p>
                    {client.company_name && (
                      <p className="text-muted-foreground text-sm">{client.company_name}</p>
                    )}
                    <p className="text-muted-foreground mt-0.5 truncate text-sm">
                      {[contact?.email, contact?.mobile_phone].filter(Boolean).join(' · ') || 'No contact details'}
                    </p>
                    <div
                      className="mt-2.5 flex items-center gap-2 border-t pt-2.5"
                      onClick={e => e.stopPropagation()}
                      onKeyDown={e => e.stopPropagation()}
                    >
                      <Select value={client.status} onValueChange={v => updateStatus(client.id, v)}>
                        <SelectTrigger className="h-9 flex-1" aria-label={`Status for ${clientDisplayName(client)}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {activeStatuses(statuses, client.status).map(s => (
                            <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <span className="text-muted-foreground shrink-0 text-sm">
                        {rep?.full_name || rep?.email || 'Unassigned'}
                      </span>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>

          <div className="bg-card hidden overflow-hidden rounded-lg border md:block">
            {/* Horizontal scroll is confined to the table so the page body never scrolls
                sideways on a narrow viewport. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[860px] text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    {['Client ID', 'Name', 'Company', 'Email', 'Mobile', 'Status', 'Sales rep', 'Last activity'].map(h => (
                      <th key={h} scope="col" className="px-3 py-2.5 text-left text-xs font-semibold whitespace-nowrap">
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {filtered.map(client => {
                    const contact = primaryContact(client.crm_contacts)
                    const rep = client.sales_rep_id ? profileById.get(client.sales_rep_id) : null
                    const isSelected = selected?.id === client.id
                    return (
                      <tr
                        key={client.id}
                        onClick={() => setSelectedId(client.id)}
                        aria-selected={isSelected}
                        className={cn('cursor-pointer transition-colors', isSelected ? 'bg-accent' : 'hover:bg-accent/50')}
                      >
                        <td className="px-3 py-2.5 font-mono text-xs whitespace-nowrap">{client.client_ref ?? '—'}</td>
                        <td className="px-3 py-2.5 font-medium whitespace-nowrap">
                          {contact ? `${contact.first_name} ${contact.last_name}` : '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{client.company_name || '—'}</td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          {contact?.email ? (
                            <a href={`mailto:${contact.email}`} className="hover:underline" onClick={e => e.stopPropagation()}>
                              {contact.email}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{contact?.mobile_phone || '—'}</td>
                        <td className="px-3 py-2.5" onClick={e => e.stopPropagation()}>
                          <Select value={client.status} onValueChange={v => updateStatus(client.id, v)}>
                            <SelectTrigger className="h-8 w-[168px]" aria-label={`Status for ${clientDisplayName(client)}`}>
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {activeStatuses(statuses, client.status).map(s => (
                                <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">{rep?.full_name || rep?.email || 'Unassigned'}</td>
                        <td className="text-muted-foreground px-3 py-2.5 whitespace-nowrap">
                          {formatDistanceToNow(new Date(client.last_activity_at), { addSuffix: true })}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {selected && (
            <ClientWorkspace
              key={selected.id}
              client={selected}
              status={statusByKey.get(selected.status)}
              profileById={profileById}
              currentUserId={user.id}
            />
          )}
        </>
      )}
    </CrmShell>
  )
}

/**
 * The record below the list: who they are, and the running account of what has happened.
 *
 * Notes are the part that matters. They are append-only in the UI (a note is a record of what
 * someone said at a point in time, not a document), and the author line is always shown so a
 * handoff note can be traced back to whoever wrote it.
 */
function ClientWorkspace({
  client,
  status,
  profileById,
  currentUserId,
}: {
  client: CrmClient
  status: CrmStatus | undefined
  profileById: Map<string, Profile>
  currentUserId: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const [notes, setNotes] = useState<Note[]>([])
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    setLoading(true)
    supabase
      .from('crm_notes')
      .select('id, body, created_at, author_id')
      .eq('client_id', client.id)
      .order('created_at', { ascending: false })
      .then(({ data }: { data: Note[] | null }) => {
        if (!active) return
        setNotes(data ?? [])
        setLoading(false)
      })
    return () => { active = false }
  }, [supabase, client.id])

  const addNote = async () => {
    const body = draft.trim()
    if (!body || saving) return
    setSaving(true)
    const { data, error } = await supabase
      .from('crm_notes')
      .insert({ client_id: client.id, body, author_id: currentUserId })
      .select('id, body, created_at, author_id')
      .single()
    setSaving(false)

    if (error || !data) {
      toast.error(error ? `Could not add note: ${error.message}` : 'Note was not saved.')
      return
    }
    setNotes(n => [data, ...n])
    setDraft('')
  }

  const contact = primaryContact(client.crm_contacts)
  const typeLabel = CLIENT_TYPES.find(t => t.value === client.client_type)?.label ?? client.client_type

  return (
    <section className="bg-card rounded-lg border">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
        <h2 className="font-semibold">
          Client workspace <span className="text-muted-foreground font-normal">— {clientDisplayName(client)}</span>
        </h2>
        <StatusPill status={status} />
      </div>

      <div className="grid gap-6 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <dl className="grid grid-cols-2 gap-4">
            <Field label="Client ID">{client.client_ref}</Field>
            <Field label="Type">{typeLabel}</Field>
            <Field label="Company">{client.company_name}</Field>
            <Field label="Lead source">{client.lead_source}</Field>
            <Field label="Email">{contact?.email}</Field>
            <Field label="Mobile">{contact?.mobile_phone}</Field>
            <Field label="Estimated value">{formatMoney(client.estimated_value)}</Field>
            <Field label="Location">
              {[client.city, client.state].filter(Boolean).join(', ')}
            </Field>
            <Field label="Sales rep">
              {client.sales_rep_id ? profileById.get(client.sales_rep_id)?.full_name : null}
            </Field>
            <Field label="Operations rep">
              {client.operations_rep_id ? profileById.get(client.operations_rep_id)?.full_name : null}
            </Field>
          </dl>

          {(client.crm_contacts?.length ?? 0) > 1 && (
            <div>
              <h3 className="text-sm font-semibold">All contacts</h3>
              <ul className="mt-2 divide-y rounded-md border">
                {client.crm_contacts!.map(c => (
                  <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                    <span className="min-w-0">
                      <span className="block truncate font-medium">
                        {c.first_name} {c.last_name}
                        {c.is_primary && (
                          <span className="text-muted-foreground ml-2 text-xs font-normal">Primary</span>
                        )}
                      </span>
                      <span className="text-muted-foreground block truncate text-xs">
                        {[c.email, c.mobile_phone].filter(Boolean).join(' · ') || 'No contact details'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="space-y-3">
          <div>
            <Label htmlFor="crm-note" className="text-sm font-semibold">
              Sales activity &amp; team notes
            </Label>
            <Textarea
              id="crm-note"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              placeholder="Prospecting note, call result, client update, handoff note…"
              rows={3}
              className="mt-2"
            />
            <div className="mt-2 flex justify-end">
              <Button size="sm" onClick={addNote} disabled={!draft.trim() || saving} className="gap-1.5">
                <Send className="h-3.5 w-3.5" />
                {saving ? 'Adding…' : 'Add note'}
              </Button>
            </div>
          </div>

          {loading ? (
            <p className="text-muted-foreground text-sm">Loading notes…</p>
          ) : notes.length === 0 ? (
            <p className="text-muted-foreground rounded-md border border-dashed p-4 text-center text-sm">
              No notes yet. The first one is usually why this client got in touch.
            </p>
          ) : (
            <ul className="space-y-3">
              {notes.map(note => {
                const author = note.author_id ? profileById.get(note.author_id) : null
                return (
                  <li key={note.id} className="text-sm">
                    <p className="text-muted-foreground text-xs">
                      <span className="text-foreground font-medium">
                        {author?.full_name || author?.email || 'Former team member'}
                      </span>{' '}
                      · {formatDistanceToNow(new Date(note.created_at), { addSuffix: true })}
                    </p>
                    <p className="mt-0.5 break-words whitespace-pre-wrap">{note.body}</p>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  )
}
