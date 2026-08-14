'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Check, Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface BookingLink {
  id: string
  token: string
  created_at: string
  expires_at: string | null
  revoked_at: string | null
}

// Same shape as share-link-dialog.tsx's genToken: two random UUIDs, hyphens
// stripped (256 bits), matching what migration 082's CHECK constraint expects.
function genToken() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
}

export default function BookingLinkPanel({ userId }: { userId: string }) {
  const [links, setLinks] = useState<BookingLink[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const supabase = createClient()

  const urlFor = (token: string) => `${window.location.origin}/book/${token}`

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('appointment_booking_links')
      .select('id, token, created_at, expires_at, revoked_at')
      .eq('host_user_id', userId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })

    if (!error) {
      const now = Date.now()
      const rows = (data ?? []) as BookingLink[]
      setLinks(rows.filter(l => !l.expires_at || new Date(l.expires_at).getTime() > now))
    }
    setLoading(false)
  }, [supabase, userId])

  useEffect(() => {
    load()
  }, [load])

  const createLink = async () => {
    setCreating(true)
    const token = genToken()
    const { error } = await supabase.from('appointment_booking_links').insert({
      token, host_user_id: userId, created_by: userId,
    })
    setCreating(false)

    if (error) {
      toast.error('Could not create booking link', { description: error.message })
      return
    }
    await load()
    try {
      await navigator.clipboard.writeText(urlFor(token))
      toast.success('Booking link created & copied to clipboard')
    } catch {
      toast.success('Booking link created')
    }
  }

  const copy = async (link: BookingLink) => {
    try {
      await navigator.clipboard.writeText(urlFor(link.token))
      setCopiedId(link.id)
      setTimeout(() => setCopiedId(null), 1500)
      toast.success('Link copied')
    } catch {
      toast.error('Could not copy', { description: 'Select the link and copy it manually.' })
    }
  }

  const revoke = async (id: string) => {
    setRevokingId(id)
    const { error } = await supabase
      .from('appointment_booking_links')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', id)
    setRevokingId(null)

    if (error) {
      toast.error('Could not revoke link', { description: error.message })
      return
    }
    setLinks(current => current.filter(l => l.id !== id))
    toast.success('Booking link revoked')
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Booking links</CardTitle>
          <CardDescription>
            Anyone with a link can book an appointment with you, subject to your preferences and
            restrictions above.
          </CardDescription>
        </div>
        <Button onClick={createLink} disabled={creating} className="flex-shrink-0 gap-2">
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Create link
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
        ) : links.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No active booking links yet.</p>
        ) : (
          <div className="space-y-2">
            {links.map(link => (
              <div key={link.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                <input
                  readOnly
                  value={urlFor(link.token)}
                  onFocus={e => e.currentTarget.select()}
                  className="min-w-40 flex-1 bg-transparent text-xs outline-none"
                />
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(link)} title="Copy link">
                  {copiedId === link.id ? <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  <span className="sr-only">Copy link</span>
                </Button>
                <Button
                  variant="ghost" size="icon" className="h-7 w-7 text-red-600 dark:text-red-400"
                  onClick={() => revoke(link.id)} disabled={revokingId === link.id} title="Revoke link"
                >
                  {revokingId === link.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                  <span className="sr-only">Revoke link</span>
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
