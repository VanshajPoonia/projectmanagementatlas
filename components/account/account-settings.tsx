'use client'

import { useState } from 'react'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Settings } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'

interface AccountSettingsProps {
  userId: string
  currentName: string
  email: string
}

export default function AccountSettings({ userId, currentName, email }: AccountSettingsProps) {
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState(currentName || '')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const supabase = createClient()

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password && password.length < 8) {
      toast.error('Password must be at least 8 characters')
      return
    }
    if (password && password !== confirmPassword) {
      toast.error('Passwords do not match')
      return
    }

    setSaving(true)
    try {
      const trimmedName = fullName.trim()
      if (trimmedName && trimmedName !== currentName) {
        const { error: nameError } = await supabase
          .from('profiles')
          .update({ full_name: trimmedName })
          .eq('id', userId)
        if (nameError) throw nameError
      }

      if (password) {
        const { error: pwError } = await supabase.auth.updateUser({ password })
        if (pwError) throw pwError
      }

      toast.success('Account updated', {
        description: password ? 'Your name and password were saved.' : 'Your name was saved.',
      })
      setPassword('')
      setConfirmPassword('')
      setOpen(false)

      // Reflect a changed name in the header without a manual refresh.
      if (trimmedName && trimmedName !== currentName) {
        setTimeout(() => window.location.reload(), 600)
      }
    } catch (err: any) {
      toast.error('Could not update account', { description: err?.message })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2">
          <Settings className="w-4 h-4" />
          <span className="hidden sm:inline">Account</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Account settings</DialogTitle>
          <DialogDescription>Update your display name or change your password.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSave} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="account-email">Email</Label>
            <Input id="account-email" value={email} disabled />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-name">Full name</Label>
            <Input id="account-name" value={fullName} onChange={(e) => setFullName(e.target.value)} disabled={saving} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="account-password">New password</Label>
            <Input
              id="account-password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Leave blank to keep current"
              disabled={saving}
              autoComplete="new-password"
            />
          </div>
          {password && (
            <div className="space-y-2">
              <Label htmlFor="account-confirm">Confirm new password</Label>
              <Input
                id="account-confirm"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                disabled={saving}
                autoComplete="new-password"
              />
            </div>
          )}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
