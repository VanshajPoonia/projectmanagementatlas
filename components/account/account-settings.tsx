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
  notifyAssignment?: boolean
  notifyUpdate?: boolean
  notifyComment?: boolean
  notifyDueSoon?: boolean
}

const NOTIFICATION_OPTIONS = [
  { key: 'assignment', column: 'notify_email_assignment', label: 'Task assignments', description: 'When you are assigned to a task' },
  { key: 'update', column: 'notify_email_update', label: 'Task updates', description: 'When details, status, or priority change' },
  { key: 'comment', column: 'notify_email_comment', label: 'New comments', description: 'When someone comments on your tasks' },
  { key: 'dueSoon', column: 'notify_email_due_soon', label: 'Due date reminders', description: 'When a task is due in 1-2 days' },
] as const

export default function AccountSettings({
  userId,
  currentName,
  email,
  notifyAssignment = true,
  notifyUpdate = true,
  notifyComment = true,
  notifyDueSoon = true,
}: AccountSettingsProps) {
  const [open, setOpen] = useState(false)
  const [fullName, setFullName] = useState(currentName || '')
  const [currentPassword, setCurrentPassword] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [prefs, setPrefs] = useState({
    assignment: notifyAssignment,
    update: notifyUpdate,
    comment: notifyComment,
    dueSoon: notifyDueSoon,
  })
  const supabase = createClient()

  const handleTogglePref = async (key: keyof typeof prefs, column: string) => {
    const newValue = !prefs[key]
    setPrefs((current) => ({ ...current, [key]: newValue }))

    const { error } = await supabase.from('profiles').update({ [column]: newValue }).eq('id', userId)
    if (error) {
      setPrefs((current) => ({ ...current, [key]: !newValue }))
      toast.error('Could not update preference', { description: error.message })
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()

    if (password) {
      if (!currentPassword) {
        toast.error('Enter your current password to set a new one')
        return
      }
      if (password.length < 8) {
        toast.error('New password must be at least 8 characters')
        return
      }
      if (password !== confirmPassword) {
        toast.error('New passwords do not match')
        return
      }
      if (password === currentPassword) {
        toast.error('New password must be different from your current password')
        return
      }
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
        // Require the current password: re-authenticate first, then update.
        // A failed sign-in returns an error and leaves the active session intact.
        const { error: verifyError } = await supabase.auth.signInWithPassword({
          email,
          password: currentPassword,
        })
        if (verifyError) {
          toast.error('Current password is incorrect')
          return
        }

        const { error: pwError } = await supabase.auth.updateUser({ password })
        if (pwError) throw pwError
      }

      toast.success('Account updated', {
        description: password ? 'Your name and password were saved.' : 'Your name was saved.',
      })
      setCurrentPassword('')
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
          <DialogDescription>Update your display name, password, or email notification preferences.</DialogDescription>
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
            <>
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
              <div className="space-y-2">
                <Label htmlFor="account-current">Current password</Label>
                <Input
                  id="account-current"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  placeholder="Required to change your password"
                  disabled={saving}
                  autoComplete="current-password"
                />
                <p className="text-xs text-muted-foreground">For security, confirm the password you use now.</p>
              </div>
            </>
          )}
          <Button type="submit" className="w-full" disabled={saving}>
            {saving ? 'Saving...' : 'Save changes'}
          </Button>
        </form>

        <div className="space-y-3 border-t pt-4">
          <Label>Email notifications</Label>
          <div className="space-y-3">
            {NOTIFICATION_OPTIONS.map(({ key, column, label, description }) => (
              <div key={key} className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground">{description}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleTogglePref(key, column)}
                  aria-label={`Toggle ${label.toLowerCase()} emails`}
                  className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
                    prefs[key] ? 'bg-primary' : 'bg-gray-300'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      prefs[key] ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ))}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
