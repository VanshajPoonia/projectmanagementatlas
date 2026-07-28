'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AlertCircle, Check, Copy, Loader2, Share2, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface ShareLinkDialogProps {
  resourceType: 'board' | 'task'
  resourceId: string
  trigger?: React.ReactNode
}

interface ShareLink {
  id: string
  token: string
  expires_at: string | null
  revoked_at: string | null
  created_at: string
}

// Unguessable token: two random UUIDs, hyphens stripped (256 bits of randomness).
function genToken() {
  return (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '')
}

export function ShareLinkDialog({ resourceType, resourceId, trigger }: ShareLinkDialogProps) {
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [links, setLinks] = useState<ShareLink[]>([])
  const [linksLoading, setLinksLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [revokingId, setRevokingId] = useState<string | null>(null)
  const [expiry, setExpiry] = useState('never')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const urlFor = (token: string) => `${window.location.origin}/share/${token}`

  const load = useCallback(async () => {
    setLinksLoading(true)
    setLoadError(null)

    try {
      const { data, error } = await supabase
        .from('share_links')
        .select('id, token, expires_at, revoked_at, created_at')
        .eq('resource_type', resourceType)
        .eq('resource_id', resourceId)
        .is('revoked_at', null)
        .order('created_at', { ascending: false })

      if (error) {
        setLoadError(error.message)
        return
      }

      const now = Date.now()
      setLinks(
        ((data || []) as ShareLink[]).filter(
          link => !link.expires_at || new Date(link.expires_at).getTime() > now,
        ),
      )
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Unexpected error')
    } finally {
      setLinksLoading(false)
    }
  }, [resourceId, resourceType, supabase])

  useEffect(() => {
    if (open) void load()
  }, [load, open])

  const createLink = async () => {
    setCreating(true)
    const token = genToken()

    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser()
      if (authError || !user) {
        toast.error('Could not create link', {
          description: 'Your session has expired. Sign in again and retry.',
        })
        return
      }

      const days = expiry === 'never' ? null : Number(expiry)
      if (days != null && !Number.isFinite(days)) {
        toast.error('Could not create link', { description: 'Choose a valid expiration.' })
        return
      }
      const expiresAt = days == null ? null : new Date(Date.now() + days * 86400000).toISOString()
      const { error } = await supabase.from('share_links').insert({
        token,
        resource_type: resourceType,
        resource_id: resourceId,
        created_by: user.id,
        expires_at: expiresAt,
      })

      if (error) {
        toast.error('Could not create link', { description: error.message })
        return
      }

      await load()
      try {
        await navigator.clipboard.writeText(urlFor(token))
        toast.success('View-only link created & copied to clipboard')
      } catch {
        toast.success('View-only link created', {
          description: 'Copy it from the active links list.',
        })
      }
    } catch (error) {
      toast.error('Could not create link', {
        description: error instanceof Error ? error.message : 'Unexpected error',
      })
    } finally {
      setCreating(false)
    }
  }

  const copy = async (link: ShareLink) => {
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

    try {
      const { data, error } = await supabase
        .from('share_links')
        .update({ revoked_at: new Date().toISOString() })
        .eq('id', id)
        .is('revoked_at', null)
        .select('id')
        .maybeSingle()

      if (error) {
        toast.error('Could not revoke link', { description: error.message })
        return
      }
      if (!data) {
        toast.error('Could not revoke link', {
          description: 'The link may already be revoked or you may no longer have permission.',
        })
        await load()
        return
      }

      setLinks(current => current.filter(link => link.id !== id))
      toast.success('Link revoked')
    } catch (error) {
      toast.error('Could not revoke link', {
        description: error instanceof Error ? error.message : 'Unexpected error',
      })
    } finally {
      setRevokingId(null)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild onClick={(e) => e.stopPropagation()}>
        {trigger || <Button variant="outline" size="sm" className="gap-2"><Share2 className="h-4 w-4" /> Share</Button>}
      </DialogTrigger>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <DialogHeader>
          <DialogTitle>View-only share link</DialogTitle>
          <DialogDescription>
            Anyone with the link can view this {resourceType} without signing in. They cannot make changes.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="flex flex-col items-stretch gap-2 sm:flex-row sm:items-center">
            <Select value={expiry} onValueChange={setExpiry} disabled={creating}>
              <SelectTrigger className="w-full sm:w-40" aria-label="Link expiration"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="never">Never expires</SelectItem>
                <SelectItem value="7">Expires in 7 days</SelectItem>
                <SelectItem value="30">Expires in 30 days</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={createLink} disabled={creating} className="gap-2" aria-busy={creating}>
              {creating
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Share2 className="h-4 w-4" />}
              {creating ? 'Creating…' : 'Create link'}
            </Button>
          </div>

          {linksLoading && (
            <div className="flex items-center gap-2 rounded-md border border-dashed p-3 text-sm text-muted-foreground" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading active links…
            </div>
          )}

          {!linksLoading && loadError && (
            <div className="flex items-start justify-between gap-3 rounded-md border border-destructive/30 bg-destructive/5 p-3" role="alert">
              <div className="flex min-w-0 gap-2">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                <div>
                  <p className="text-sm font-medium">Could not load active links</p>
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">{loadError}</p>
                </div>
              </div>
              <Button variant="outline" size="sm" onClick={() => void load()}>Retry</Button>
            </div>
          )}

          {!linksLoading && !loadError && links.length === 0 && (
            <p className="rounded-md border border-dashed p-3 text-center text-sm text-muted-foreground">
              No active links yet.
            </p>
          )}

          {!linksLoading && !loadError && links.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Active links</p>
              {links.map((link) => (
                <div key={link.id} className="flex flex-wrap items-center gap-2 rounded-md border p-2">
                  <input
                    readOnly
                    value={urlFor(link.token)}
                    onFocus={(e) => e.currentTarget.select()}
                    className="min-w-40 flex-1 bg-transparent text-xs outline-none"
                  />
                  {link.expires_at && (
                    <span className="whitespace-nowrap text-[10px] text-muted-foreground">
                      expires {new Date(link.expires_at).toLocaleDateString('en-US')}
                    </span>
                  )}
                  <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => copy(link)} title="Copy link">
                    {copiedId === link.id ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                    <span className="sr-only">Copy link</span>
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-red-600"
                    onClick={() => revoke(link.id)}
                    disabled={revokingId === link.id}
                    title="Revoke link"
                  >
                    {revokingId === link.id
                      ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      : <Trash2 className="h-3.5 w-3.5" />}
                    <span className="sr-only">Revoke link</span>
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
