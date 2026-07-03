'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Plus, MoreVertical, Pencil, Trash, Link as LinkIcon, Building2, Lock,
  Folder, FileText, Globe, Calendar, Mail, MessageSquare, Cloud, Database,
  Image, Video, ShoppingCart, CreditCard, Users, Settings, BookOpen,
} from 'lucide-react'
import { createClient } from '@/lib/supabase/client'

const ICONS: Record<string, any> = {
  Link: LinkIcon, Folder, FileText, Globe, Calendar, Mail, MessageSquare,
  Cloud, Database, Image, Video, ShoppingCart, CreditCard, Users, Settings, BookOpen,
}
const ICON_NAMES = Object.keys(ICONS)

interface BookmarksSectionProps {
  userId: string
  isAdmin: boolean
  /** When true, render without the outer Card chrome (a parent window provides it). */
  embedded?: boolean
  /** When true, force single-column grid (for narrow sidebar placement). */
  sidebar?: boolean
}

function faviconUrl(url: string) {
  try {
    return `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`
  } catch {
    return null
  }
}

function BookmarkTile({ bookmark, canManage, onEdit, onDelete }: any) {
  const [faviconFailed, setFaviconFailed] = useState(false)
  const favicon = !bookmark.icon && !faviconFailed ? faviconUrl(bookmark.url) : null
  const Icon = ICONS[bookmark.icon] || LinkIcon

  return (
    <div className="group relative flex items-center gap-3 rounded-lg border p-3 hover:bg-accent hover:border-primary/30 transition-colors">
      <a href={bookmark.url} target="_blank" rel="noopener noreferrer" className="flex flex-1 min-w-0 items-center gap-3">
        <div className="w-9 h-9 rounded-md bg-secondary flex items-center justify-center flex-shrink-0 overflow-hidden">
          {favicon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={favicon} alt="" className="w-5 h-5" onError={() => setFaviconFailed(true)} />
          ) : (
            <Icon className="w-4 h-4 text-foreground" />
          )}
        </div>
        <span className="truncate text-sm font-medium">{bookmark.title}</span>
      </a>
      {canManage && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="icon-sm" className="opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
              <MoreVertical className="w-4 h-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(bookmark)}>
              <Pencil className="w-4 h-4 mr-2" />
              Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onDelete(bookmark.id)} className="text-red-600">
              <Trash className="w-4 h-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  )
}

export default function BookmarksSection({ userId, isAdmin, embedded = false, sidebar = false }: BookmarksSectionProps) {
  const [bookmarks, setBookmarks] = useState<any[]>([])
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [title, setTitle] = useState('')
  const [url, setUrl] = useState('')
  const [icon, setIcon] = useState<string | null>(null)
  const [scope, setScope] = useState<'personal' | 'company'>('personal')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  useEffect(() => {
    loadBookmarks()
  }, [userId])

  const loadBookmarks = async () => {
    const { data } = await supabase
      .from('bookmarks')
      .select('*')
      .order('scope', { ascending: true })
      .order('position', { ascending: true })
      .order('created_at', { ascending: true })
    if (data) setBookmarks(data)
  }

  const openCreateDialog = () => {
    setEditing(null)
    setTitle('')
    setUrl('')
    setIcon(null)
    setScope('personal')
    setError(null)
    setDialogOpen(true)
  }

  const openEditDialog = (bookmark: any) => {
    setEditing(bookmark)
    setTitle(bookmark.title)
    setUrl(bookmark.url)
    setIcon(bookmark.icon)
    setScope(bookmark.scope)
    setError(null)
    setDialogOpen(true)
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)

    const trimmedUrl = url.trim()
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setError('Link must start with http:// or https://')
      return
    }

    setSaving(true)
    const payload = {
      title: title.trim(),
      url: trimmedUrl,
      icon,
      scope,
      user_id: scope === 'personal' ? userId : null,
    }

    const { error: saveError } = editing
      ? await supabase.from('bookmarks').update(payload).eq('id', editing.id)
      : await supabase.from('bookmarks').insert({ ...payload, created_by: userId })

    setSaving(false)
    if (saveError) {
      setError('Could not save bookmark. Please try again.')
      return
    }
    setDialogOpen(false)
    loadBookmarks()
  }

  const handleDelete = async (id: string) => {
    await supabase.from('bookmarks').delete().eq('id', id)
    setBookmarks(bookmarks.filter(b => b.id !== id))
  }

  const companyBookmarks = bookmarks.filter(b => b.scope === 'company')
  const personalBookmarks = bookmarks.filter(b => b.scope === 'personal')

  const addButton = (
    <Button size="sm" onClick={openCreateDialog} className="gap-2">
      <Plus className="w-4 h-4" />
      Add Bookmark
    </Button>
  )

  const grids = (
    <div className="space-y-5">
      {companyBookmarks.length > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Building2 className="w-3.5 h-3.5" />
              Company
            </div>
            <div className={`grid gap-2 ${sidebar ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
              {companyBookmarks.map((bookmark) => (
                <BookmarkTile
                  key={bookmark.id}
                  bookmark={bookmark}
                  canManage={isAdmin}
                  onEdit={openEditDialog}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <Lock className="w-3.5 h-3.5" />
            Personal
          </div>
          {personalBookmarks.length > 0 ? (
            <div className={`grid gap-2 ${sidebar ? 'grid-cols-1' : 'sm:grid-cols-2 lg:grid-cols-3'}`}>
              {personalBookmarks.map((bookmark) => (
                <BookmarkTile
                  key={bookmark.id}
                  bookmark={bookmark}
                  canManage={true}
                  onEdit={openEditDialog}
                  onDelete={handleDelete}
                />
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No personal bookmarks yet. Add one above.</p>
          )}
        </div>
    </div>
  )

  const dialog = (
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Bookmark' : 'Add Bookmark'}</DialogTitle>
            <DialogDescription>A quick link shown on the home dashboard.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSave} className="space-y-4">
            {error && <p className="text-sm text-destructive">{error}</p>}

            <div className="space-y-2">
              <Label htmlFor="bookmark-title">Name</Label>
              <Input id="bookmark-title" value={title} onChange={(e) => setTitle(e.target.value)} required disabled={saving} placeholder="Shared Drive" />
            </div>

            <div className="space-y-2">
              <Label htmlFor="bookmark-url">Link</Label>
              <Input id="bookmark-url" value={url} onChange={(e) => setUrl(e.target.value)} required disabled={saving} placeholder="https://drive.google.com/..." />
            </div>

            {isAdmin && (
              <div className="space-y-2">
                <Label>Visibility</Label>
                <div className="flex gap-2">
                  <Button type="button" size="sm" variant={scope === 'personal' ? 'default' : 'outline'} onClick={() => setScope('personal')}>
                    Personal
                  </Button>
                  <Button type="button" size="sm" variant={scope === 'company' ? 'default' : 'outline'} onClick={() => setScope('company')}>
                    Company
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label>Icon (optional, defaults to the site's own icon)</Label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setIcon(null)}
                  className={`w-9 h-9 rounded-md border-2 flex items-center justify-center text-xs ${
                    icon === null ? 'border-primary bg-secondary' : 'border-transparent bg-secondary/50'
                  }`}
                >
                  Auto
                </button>
                {ICON_NAMES.map((name) => {
                  const IconComp = ICONS[name]
                  return (
                    <button
                      key={name}
                      type="button"
                      onClick={() => setIcon(name)}
                      className={`w-9 h-9 rounded-md border-2 flex items-center justify-center ${
                        icon === name ? 'border-primary bg-secondary' : 'border-transparent bg-secondary/50'
                      }`}
                    >
                      <IconComp className="w-4 h-4" />
                    </button>
                  )
                })}
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={saving || !title.trim() || !url.trim()}>
              {saving ? 'Saving...' : editing ? 'Save Changes' : 'Add Bookmark'}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
  )

  if (embedded) {
    return (
      <>
        <div className="mb-4 flex justify-end">{addButton}</div>
        {grids}
        {dialog}
      </>
    )
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <div>
          <CardTitle>Bookmarks</CardTitle>
          <CardDescription>Quick links to the things you use every day</CardDescription>
        </div>
        {addButton}
      </CardHeader>
      <CardContent>{grids}</CardContent>
      {dialog}
    </Card>
  )
}
