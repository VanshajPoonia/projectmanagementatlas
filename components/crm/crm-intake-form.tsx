'use client'

import { useId, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

import { CrmShell, type CrmUser } from './crm-shell'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { createClient } from '@/lib/supabase/client'
import { CLIENT_TYPES, LEAD_SOURCES, activeStatuses, type CrmStatus } from '@/lib/crm'

interface Profile {
  id: string
  full_name: string | null
  email: string | null
}

interface ContactDraft {
  key: string
  first_name: string
  last_name: string
  email: string
  mobile_phone: string
}

const UNASSIGNED = '__unassigned__'

// ⚠️ Sequential, not random. These keys become DOM `id` attributes, and crypto.randomUUID()
// produces a different value on the server than on the client — so every field hydrated with a
// mismatched id and React discarded the form. A counter is deterministic: the first contact is
// `c0` in both passes, and every later one is created by a click, which only happens on the
// client where any value is safe.
function makeBlankContact(seq: number): ContactDraft {
  return { key: `c${seq}`, first_name: '', last_name: '', email: '', mobile_phone: '' }
}

/**
 * New client intake.
 *
 * The one structural requirement from the brief: a client record holds *several* contacts, for
 * trusts, families and partnerships with more than one decision-maker. So contacts are a
 * repeating group from the start rather than four fields on the client with a "second contact"
 * bolted on later; the first one is the primary.
 */
export function CrmIntakeForm({
  user,
  statuses,
  profiles,
}: {
  user: CrmUser
  statuses: CrmStatus[]
  profiles: Profile[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  // An archived status must not be offered on a brand-new record, even though the full list is
  // what gets passed in so lookups elsewhere resolve.
  const selectable = useMemo(() => activeStatuses(statuses), [statuses])

  // useId gives a prefix that is stable across server and client; the counter keeps each
  // contact's fields uniquely addressable within this form.
  const formId = useId()
  const nextSeq = useRef(0)
  const blankContact = () => makeBlankContact(nextSeq.current++)
  const [contacts, setContacts] = useState<ContactDraft[]>(() => [makeBlankContact(nextSeq.current++)])
  const [companyName, setCompanyName] = useState('')
  const [clientType, setClientType] = useState('individual')
  const [address, setAddress] = useState('')
  const [city, setCity] = useState('')
  const [stateRegion, setStateRegion] = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [leadSource, setLeadSource] = useState<string>(LEAD_SOURCES[0])
  const [status, setStatus] = useState(activeStatuses(statuses)[0]?.key ?? 'new')
  const [salesRep, setSalesRep] = useState<string>(user.id)
  const [opsRep, setOpsRep] = useState<string>(UNASSIGNED)
  const [estimatedValue, setEstimatedValue] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})

  const setContact = (key: string, patch: Partial<ContactDraft>) =>
    setContacts(cs => cs.map(c => (c.key === key ? { ...c, ...patch } : c)))

  function validate(): boolean {
    const next: Record<string, string> = {}
    contacts.forEach((c, i) => {
      if (!c.first_name.trim()) next[`${c.key}.first_name`] = 'First name is required'
      if (!c.last_name.trim()) next[`${c.key}.last_name`] = 'Last name is required'
      if (!c.email.trim()) next[`${c.key}.email`] = 'Email is required'
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email.trim())) next[`${c.key}.email`] = 'That email address is not valid'
      if (!c.mobile_phone.trim()) next[`${c.key}.mobile_phone`] = 'Mobile phone is required'
      void i
    })
    if (estimatedValue.trim() && Number.isNaN(Number(estimatedValue))) {
      next.estimatedValue = 'Enter a number, without a currency symbol'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault()
    if (saving) return
    if (!validate()) {
      toast.error('Some required details are missing.')
      return
    }
    setSaving(true)

    // The reference is drawn from a Postgres sequence inside an RPC (migration 104), not
    // counted from the rows here, so two people submitting intake at the same moment cannot be
    // handed the same C- number. 103's version took an advisory lock and read MAX(...), which
    // did not work: the lock ends with the RPC's transaction, and the INSERT below happens in
    // a separate request afterwards, so both callers read the same MAX and the second INSERT
    // died on the UNIQUE constraint.
    const { data: ref, error: refError } = await supabase.rpc('claim_crm_client_ref')
    if (refError) {
      setSaving(false)
      toast.error(`Could not reserve a client ID: ${refError.message}`)
      return
    }

    const { data: client, error } = await supabase
      .from('crm_clients')
      .insert({
        client_ref: ref,
        company_name: companyName.trim() || null,
        client_type: clientType,
        address: address.trim() || null,
        city: city.trim() || null,
        state: stateRegion.trim() || null,
        postal_code: postalCode.trim() || null,
        lead_source: leadSource,
        status,
        sales_rep_id: salesRep === UNASSIGNED ? null : salesRep,
        operations_rep_id: opsRep === UNASSIGNED ? null : opsRep,
        estimated_value: estimatedValue.trim() ? Number(estimatedValue) : 0,
        notes: notes.trim() || null,
        created_by: user.id,
      })
      .select('id')
      .single()

    if (error || !client) {
      setSaving(false)
      toast.error(error ? `Could not create the client: ${error.message}` : 'The client was not created.')
      return
    }

    const { error: contactError } = await supabase.from('crm_contacts').insert(
      contacts.map((c, index) => ({
        client_id: client.id,
        first_name: c.first_name.trim(),
        last_name: c.last_name.trim(),
        email: c.email.trim() || null,
        mobile_phone: c.mobile_phone.trim() || null,
        is_primary: index === 0,
        position: index,
      })),
    )

    setSaving(false)
    if (contactError) {
      // The client exists but has no contacts. Say so plainly rather than claiming success —
      // the record is reachable and can be completed from the client list.
      toast.error(`Client ${ref} was created, but its contacts were not saved: ${contactError.message}`)
    } else {
      toast.success(`Client ${ref} created.`)
    }
    router.push('/crm/clients')
    router.refresh()
  }

  const fieldError = (key: string) =>
    errors[key] ? <p className="text-destructive mt-1 text-xs">{errors[key]}</p> : null

  return (
    <CrmShell
      user={user}
      breadcrumbs={[{ label: 'CRM', href: '/crm' }, { label: 'Clients', href: '/crm/clients' }, { label: 'New' }]}
    >
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">New client intake</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          A client record can hold several contacts. Add one per decision-maker for a trust,
          family or partnership.
        </p>
      </header>

      <form onSubmit={submit} noValidate className="space-y-6">
        <section className="bg-card rounded-lg border">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <h2 className="font-semibold">Contacts</h2>
            <Button type="button" variant="outline" size="sm" className="gap-1.5"
              onClick={() => setContacts(cs => [...cs, blankContact()])}>
              <Plus className="h-3.5 w-3.5" /> Add customer
            </Button>
          </div>

          <div className="divide-y">
            {contacts.map((contact, index) => (
              <fieldset key={contact.key} className="grid gap-4 p-4 sm:grid-cols-2">
                <legend className="sr-only">Contact {index + 1}</legend>
                <div className="text-muted-foreground -mb-2 flex items-center justify-between text-xs font-medium sm:col-span-2">
                  <span>{index === 0 ? 'Primary contact' : `Contact ${index + 1}`}</span>
                  {contacts.length > 1 && (
                    <Button type="button" variant="ghost" size="sm" className="h-7 gap-1 px-2"
                      onClick={() => setContacts(cs => cs.filter(c => c.key !== contact.key))}>
                      <Trash2 className="h-3.5 w-3.5" />
                      <span className="sr-only sm:not-sr-only">Remove</span>
                    </Button>
                  )}
                </div>

                <div>
                  <Label htmlFor={`${formId}-${contact.key}-first`}>First name *</Label>
                  <Input id={`${formId}-${contact.key}-first`} value={contact.first_name}
                    aria-invalid={Boolean(errors[`${contact.key}.first_name`])}
                    onChange={e => setContact(contact.key, { first_name: e.target.value })} className="mt-1.5" />
                  {fieldError(`${contact.key}.first_name`)}
                </div>
                <div>
                  <Label htmlFor={`${formId}-${contact.key}-last`}>Last name *</Label>
                  <Input id={`${formId}-${contact.key}-last`} value={contact.last_name}
                    aria-invalid={Boolean(errors[`${contact.key}.last_name`])}
                    onChange={e => setContact(contact.key, { last_name: e.target.value })} className="mt-1.5" />
                  {fieldError(`${contact.key}.last_name`)}
                </div>
                <div>
                  <Label htmlFor={`${formId}-${contact.key}-email`}>Email *</Label>
                  <Input id={`${formId}-${contact.key}-email`} type="email" value={contact.email}
                    placeholder="name@example.com"
                    aria-invalid={Boolean(errors[`${contact.key}.email`])}
                    onChange={e => setContact(contact.key, { email: e.target.value })} className="mt-1.5" />
                  {fieldError(`${contact.key}.email`)}
                </div>
                <div>
                  <Label htmlFor={`${formId}-${contact.key}-mobile`}>Mobile phone *</Label>
                  <Input id={`${formId}-${contact.key}-mobile`} type="tel" value={contact.mobile_phone}
                    placeholder="(000) 000-0000"
                    aria-invalid={Boolean(errors[`${contact.key}.mobile_phone`])}
                    onChange={e => setContact(contact.key, { mobile_phone: e.target.value })} className="mt-1.5" />
                  {fieldError(`${contact.key}.mobile_phone`)}
                </div>
              </fieldset>
            ))}
          </div>
        </section>

        <section className="bg-card rounded-lg border">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">Client details</h2>
          </div>
          <div className="grid gap-4 p-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="crm-company">Company / trust / organisation</Label>
              <Input id="crm-company" value={companyName} placeholder="Optional"
                onChange={e => setCompanyName(e.target.value)} className="mt-1.5" />
            </div>
            <div>
              <Label htmlFor="crm-type">Client type</Label>
              <Select value={clientType} onValueChange={setClientType}>
                <SelectTrigger id="crm-type" className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLIENT_TYPES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="crm-address">Address</Label>
              <Input id="crm-address" value={address} placeholder="Street"
                onChange={e => setAddress(e.target.value)} className="mt-1.5" />
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label htmlFor="crm-city">City</Label>
                <Input id="crm-city" value={city} onChange={e => setCity(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="crm-state">State</Label>
                <Input id="crm-state" value={stateRegion} onChange={e => setStateRegion(e.target.value)} className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="crm-zip">ZIP</Label>
                <Input id="crm-zip" value={postalCode} onChange={e => setPostalCode(e.target.value)} className="mt-1.5" />
              </div>
            </div>
            <div>
              <Label htmlFor="crm-source">Lead source</Label>
              <Select value={leadSource} onValueChange={setLeadSource}>
                <SelectTrigger id="crm-source" className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LEAD_SOURCES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="crm-status">Status</Label>
              <Select value={status} onValueChange={setStatus}>
                <SelectTrigger id="crm-status" className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {selectable.map(s => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="crm-sales-rep">Sales rep</Label>
              <Select value={salesRep} onValueChange={setSalesRep}>
                <SelectTrigger id="crm-sales-rep" className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="crm-ops-rep">Operations rep</Label>
              <Select value={opsRep} onValueChange={setOpsRep}>
                <SelectTrigger id="crm-ops-rep" className="mt-1.5"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                  {profiles.map(p => (
                    <SelectItem key={p.id} value={p.id}>{p.full_name || p.email}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="crm-value">Estimated value</Label>
              <Input id="crm-value" inputMode="decimal" value={estimatedValue} placeholder="0.00"
                aria-invalid={Boolean(errors.estimatedValue)}
                onChange={e => setEstimatedValue(e.target.value)} className="mt-1.5" />
              {fieldError('estimatedValue')}
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="crm-notes">Client notes</Label>
              <Textarea id="crm-notes" value={notes} rows={3} className="mt-1.5"
                placeholder="Anything the team should know before the first contact."
                onChange={e => setNotes(e.target.value)} />
            </div>
          </div>
        </section>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => router.push('/crm/clients')}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving}>
            {saving ? 'Creating…' : 'Create client'}
          </Button>
        </div>
      </form>
    </CrmShell>
  )
}
