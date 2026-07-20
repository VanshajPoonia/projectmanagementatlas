'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Archive, ArchiveRestore, Plus, Pencil, Check, X, Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface CompanyRow {
  id: string
  code: string
  name: string
  color: string
  position: number
  is_archived: boolean
}

export default function CompanyManagement() {
  const [companies, setCompanies] = useState<CompanyRow[]>([])
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editCode, setEditCode] = useState('')
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#3b82f6')
  const supabase = createClient()

  const load = async () => {
    const { data } = await supabase
      .from('companies')
      .select('*')
      .order('position', { ascending: true })
      .order('name', { ascending: true })
    if (data) setCompanies(data)
  }

  useEffect(() => {
    load()
  }, [])

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault()
    const code = newCode.trim().toUpperCase()
    const name = newName.trim()
    if (!code || !name) return

    setSaving(true)
    const nextPosition = companies.length ? Math.max(...companies.map((c) => c.position)) + 1 : 0
    const { error } = await supabase
      .from('companies')
      .insert({ code, name, color: newColor, position: nextPosition })
    setSaving(false)

    if (error) {
      toast.error(error.code === '23505' ? 'A company with that code already exists' : 'Could not add company', {
        description: error.code === '23505' ? undefined : error.message,
      })
      return
    }
    setNewCode('')
    setNewName('')
    setNewColor('#3b82f6')
    toast.success('Company added')
    load()
  }

  const toggleArchive = async (company: CompanyRow) => {
    const { error } = await supabase
      .from('companies')
      .update({ is_archived: !company.is_archived })
      .eq('id', company.id)
    if (error) {
      toast.error('Could not update company', { description: error.message })
      return
    }
    toast.success(company.is_archived ? 'Company restored' : 'Company archived')
    load()
  }

  const startEdit = (company: CompanyRow) => {
    setEditingId(company.id)
    setEditCode(company.code)
    setEditName(company.name)
    setEditColor(company.color)
  }

  const saveEdit = async (company: CompanyRow) => {
    const code = editCode.trim().toUpperCase()
    const name = editName.trim()
    if (!code || !name) return
    const { error } = await supabase
      .from('companies')
      .update({ code, name, color: editColor })
      .eq('id', company.id)
    if (error) {
      toast.error(error.code === '23505' ? 'A company with that code already exists' : 'Could not save company', {
        description: error.code === '23505' ? undefined : error.message,
      })
      return
    }
    setEditingId(null)
    toast.success('Company updated')
    load()
  }

  const activeCompanies = companies.filter((c) => !c.is_archived)
  const archivedCompanies = companies.filter((c) => c.is_archived)

  const renderRow = (company: CompanyRow) => (
    <div key={company.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
      {editingId === company.id ? (
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            type="color"
            value={editColor}
            onChange={(e) => setEditColor(e.target.value)}
            className="h-9 w-10 flex-shrink-0 cursor-pointer rounded border"
          />
          <Input value={editCode} onChange={(e) => setEditCode(e.target.value)} className="h-9 w-24" placeholder="Code" />
          <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-9 flex-1 min-w-[160px]" placeholder="Full name" />
          <Button size="icon-sm" variant="ghost" onClick={() => saveEdit(company)} aria-label="Save">
            <Check className="h-4 w-4" />
          </Button>
          <Button size="icon-sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="h-4 w-4 flex-shrink-0 rounded-full" style={{ backgroundColor: company.color }} />
            <span className="truncate font-medium">{company.name}</span>
            <code className="text-xs text-muted-foreground">{company.code}</code>
            {company.is_archived && <Badge variant="outline" className="text-muted-foreground">Archived</Badge>}
          </div>
          <div className="flex flex-shrink-0 items-center gap-1">
            <Button size="icon-sm" variant="ghost" onClick={() => startEdit(company)} aria-label={`Edit ${company.name}`}>
              <Pencil className="h-4 w-4" />
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => toggleArchive(company)}>
              {company.is_archived ? <ArchiveRestore className="h-4 w-4" /> : <Archive className="h-4 w-4" />}
              {company.is_archived ? 'Restore' : 'Archive'}
            </Button>
          </div>
        </>
      )}
    </div>
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Building2 className="h-5 w-5" />
          Companies
        </CardTitle>
        <CardDescription>
          Business units used across the marketing calendar (channels, events). Archived companies stay on existing
          events but can&apos;t be picked for new ones.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2">
          <div className="space-y-1.5">
            <Label htmlFor="new-company-code" className="text-xs">Code</Label>
            <Input
              id="new-company-code"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="e.g. SRG"
              className="w-24"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-company-name" className="text-xs">Full name</Label>
            <Input
              id="new-company-name"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Shanks Realty Group"
              className="w-64"
              disabled={saving}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="new-company-color" className="text-xs">Color</Label>
            <input
              id="new-company-color"
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="h-10 w-12 cursor-pointer rounded border"
              disabled={saving}
            />
          </div>
          <Button type="submit" className="gap-2" disabled={saving || !newCode.trim() || !newName.trim()}>
            <Plus className="h-4 w-4" />
            Add Company
          </Button>
        </form>

        <div className="space-y-2">
          {activeCompanies.map(renderRow)}
          {activeCompanies.length === 0 && (
            <p className="text-sm text-muted-foreground">No companies yet. Add one above.</p>
          )}
        </div>

        {archivedCompanies.length > 0 && (
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <Archive className="h-3.5 w-3.5" />
              Archived ({archivedCompanies.length})
            </div>
            {archivedCompanies.map(renderRow)}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
