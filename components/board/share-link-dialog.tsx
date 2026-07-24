'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Share2, Copy, Trash2, Check } from 'lucide-react'
import { toast } from 'sonner'

interface ShareLinkDialogProps {
  resourceType: 'board' | 'task'
  resourceId: string
  trigger?: React.ReactNode
}

// Unguessable token: two random UUIDs, hyphens stripped (256 bits of randomness).
function genToken() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
}

export function ShareLinkDialog({ resourceType, resourceId, trigger }: ShareLinkDialogProps) {
  const supabase = createClient()
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [expiry, setExpiry] = useState('never')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const origin = typeof window !== 'undefined' ? window.location.origin : ''
  const urlFor = (token: string) => `${origin}/share/${token}`

  const load = async () => {
    const { data } = await supabase
      .from('share_links')
      .select('id, token, expires_at, revoked_at, created_at')
      .eq('resource_type', resourceType)
      .eq('resource_id', resourceId)
      .is('revoked_at', null)
      .order('created_at', { ascending: false })
    setLinks((data || []).filter((l: any) => !l.expires_at || new Date(l.expires_at) > new Date()))
  }

  useEffect(() => { if (open) load() }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  const createLink = async () => {
    setLoading(true)
    const token = genToken()
    let expires_at: string | null = null
    if (expiry !== 'never') expires_at = new Date(Date.now() + parseInt(expiry) * 86400000).toISOString()
    const { data: { user } } = await supabase.auth.getUser()
    const { error } = await supabase.from('share_links').insert({
      token, resource_type: resourceType, resource_id: resourceId, created_by: user?.id, expires_at,
    })
    setLoading(false)
    if (error) { toast.error('Could not create link', { description: error.message }); return }
    await load()
    try {
      await navigator.clipboard.writeText(urlFor(token))
      toast.success('View-only link created & copied to clipboard')
    } catch { toast.success('View-only link created') }
  }

  const copy = async (link: any) => {
    try {
      await navigator.clipboard.writeText(urlFor(link.token))
      setCopiedId(link.id)
      setTimeout(() => setCopiedId(null), 1500)
    } catch { toast.error('Could not copy — select and copy manually') }
  }

  const revoke = async (id: string) => {
    const { error } = await supabase.from('share_links').update({ revoked_at: new Date().toISOString() }).eq('id', id)
    if (error) { toast.error('Could not revoke', { description: error.message }); return }
    toast.success('Link revoked')
    load()
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger || <Button variant="outline" size="sm" className="gap-2"><Share2 className="h-4 w-4" /> Share</Button>}
      </DialogTrigger>
      <DialogContent onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>View-only share link</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Anyone with the link can view this {resourceType} — no sign-in, no editing. Revoke any time.
          </p>
          <div className="flex items-center gap-2">
            <Select value={expiry} onValueChange={setExpiry}>
              <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never expires</SelectItem>
                <SelectItem value="7">Expires in 7 days</SelectItem>
                <SelectItem value="30">Expires in 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={createLink} disabled={loading} className="gap-2">
              <Share2 className="h-4 w-4" /> {loading ? 'Creating…' : 'Create link'}
            </Button>
          </div>
          {links.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Active links</p>
              {links.map((link) => (
                <div key={link.id} className="flex items-center gap-2 rounded-md border p-2">
                  <input
                    readOnly
                    value={urlFor(link.token)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                  />
                  {link.expires_at && (
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                      expires {new Date(link.expires_at).toLocaleDateString('en-US')}
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(link)} title="Copy link">
                    {copiedId === link.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                  </Button>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-red-600" onClick={() => revoke(link.id)} title="Revoke link">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
