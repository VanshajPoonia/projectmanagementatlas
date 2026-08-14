'use client'

import React from "react"

import { useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Badge } from '@/components/ui/badge'
import { UserPlus, Mail, Calendar, Users, Trash2, Eye, EyeOff, Edit, Shield, ToggleLeft, ToggleRight } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { describeDeactivation, describeDeletion } from '@/lib/deprovision'

interface EnhancedUserManagementProps {
  users: any[]
  currentUserId: string
}

export default function EnhancedUserManagement({ users: initialUsers, currentUserId }: EnhancedUserManagementProps) {
  const [users, setUsers] = useState(initialUsers)
  const [open, setOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [selectedUser, setSelectedUser] = useState<any>(null)
  const [email, setEmail] = useState('')
  const [fullName, setFullName] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const supabase = createClient()
  const router = useRouter()

  const refreshUsers = async () => {
    const { data } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false })
    if (data) {
      setUsers(data)
    }
  }

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    setSuccess(null)

    try {
      const response = await fetch('/api/admin/create-user', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, fullName, password, role }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to create user')
      }

      setSuccess(`User ${fullName} created successfully!`)
      setEmail('')
      setFullName('')
      setPassword('')
      setRole('user')
      setOpen(false)
      
      await refreshUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to create user')
    } finally {
      setLoading(false)
    }
  }

  const handleDeleteUser = async (userId: string, userName: string) => {
    // Count their boards first, so the confirmation can say what will change hands rather
    // than leaving the operator to discover it afterwards.
    const { count: boardCount } = await supabase
      .from('boards')
      .select('id', { count: 'exact', head: true })
      .eq('created_by', userId)

    if (!confirm(describeDeletion(userName, boardCount ?? 0))) {
      return
    }

    try {
      const response = await fetch('/api/admin/delete-user', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId }),
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        // The server refuses for reasons worth reading — deleting yourself, or removing the
        // last super admin. Replacing them with "Failed to delete user" told the operator
        // nothing and made a deliberate refusal look like a bug.
        throw new Error(body?.error || 'Failed to delete user')
      }

      setSuccess(
        body?.boardsTransferred
          ? `${userName} was deleted. Their work was kept, and ${body.boardsTransferred} board${body.boardsTransferred === 1 ? '' : 's'} transferred to you.`
          : `${userName} was deleted. Their work was kept.`
      )
      await refreshUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to delete user')
    }
  }

  // Goes through the API route rather than writing `profiles` directly. Two reasons: the
  // direct write did nothing at all (nothing read is_active, so a "deactivated" person kept
  // working), and migration 101 revoked authenticated's UPDATE on that column so the old
  // call would now fail outright. The route sets the flag AND bans the account at the auth
  // server, which is what actually stops them signing in.
  const handleToggleActive = async (userId: string, currentStatus: boolean, userName: string) => {
    const turningOff = currentStatus
    if (turningOff && !confirm(describeDeactivation(userName))) return

    try {
      const response = await fetch('/api/admin/set-user-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId, isActive: !currentStatus }),
      })

      const body = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(body?.error || 'Failed to update user status')

      setSuccess(
        turningOff
          ? `${userName} is signed out and cannot sign back in. Their work is untouched, and you can switch this back on.`
          : `${userName} can sign in again.`
      )
      await refreshUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to update user status')
    }
  }

  /** True while the edit dialog is pointed at the signed-in super admin's own account. */
  const editingSelf = selectedUser?.id === currentUserId

  const handleEditUser = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const self = selectedUser.id === currentUserId
    const changedPassword = Boolean(password)

    try {
      const response = await fetch('/api/admin/update-user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: selectedUser.id,
          fullName: selectedUser.full_name,
          role: selectedUser.role,
          password: password || undefined,
        }),
      })

      // The route refuses a self role change by name; surfacing its message beats
      // "Failed to update user", which made a deliberate refusal look like an outage.
      const body = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(body?.error || 'Failed to update user')
      }

      setPassword('')
      setEditOpen(false)

      // Supabase revokes every session for an account whose password changes — including the
      // one that just made the change. Verified in a browser: the very next navigation bounced
      // to /login. Refreshing the user list here would fire a query with a dead token and leave
      // the operator on a page where nothing works, so sign out cleanly and send them to the
      // sign-in page instead of pretending the session survived.
      if (self && changedPassword) {
        setSuccess('Your password has been changed. Signing you out so you can use it…')
        await supabase.auth.signOut().catch(() => {})
        router.push('/login')
        return
      }

      setSuccess(
        self
          ? 'Your details have been updated.'
          : changedPassword
            ? `${selectedUser.full_name || selectedUser.email} was updated and their password reset.`
            : 'User updated successfully'
      )
      await refreshUsers()
    } catch (err: any) {
      setError(err.message || 'Failed to update user')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {success && (
        <Alert className="border-green-200 bg-green-50 text-green-900 dark:border-green-900 dark:bg-green-950 dark:text-green-100">
          <AlertDescription>{success}</AlertDescription>
        </Alert>
      )}
      
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">User Management</h2>
          <p className="text-muted-foreground">Full admin control over team members</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2">
              <UserPlus className="w-4 h-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create New User</DialogTitle>
              <DialogDescription>
                Create a new user account with email and password
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Full Name</Label>
                <Input
                  id="fullName"
                  placeholder="John Doe"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="john@goatlasgo.us"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="Min 6 characters"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="role">Role</Label>
                <Select value={role} onValueChange={setRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Creating...' : 'Create User'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {users.map((user) => (
          <Card key={user.id} className="hover:shadow-lg transition-shadow">
            <CardHeader>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center text-white font-semibold text-lg">
                    {user.full_name?.charAt(0) || user.email?.charAt(0).toUpperCase()}
                  </div>
                  <div>
                    <CardTitle className="text-base">{user.full_name || 'No name'}</CardTitle>
                    <CardDescription className="flex items-center gap-1 text-xs">
                      <Mail className="w-3 h-3" />
                      {user.email}
                    </CardDescription>
                  </div>
                </div>
                {user.role === 'super_admin' ? (
                  <Badge variant="default" className="bg-purple-600 gap-1">
                    <Shield className="w-3 h-3" />
                    Super Admin
                  </Badge>
                ) : user.role === 'admin' ? (
                  <Badge variant="default" className="bg-blue-600 gap-1">
                    <Shield className="w-3 h-3" />
                    Admin
                  </Badge>
                ) : (
                  <Badge variant="outline">User</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Calendar className="w-4 h-4" />
                  Joined {new Date(user.created_at).toLocaleDateString('en-US')}
                </div>
                <Badge variant={user.is_active === false ? 'destructive' : 'default'} className="text-xs">
                  {user.is_active === false ? 'Inactive' : 'Active'}
                </Badge>
              </div>
              
              {/* Your own card gets Edit and nothing else. Changing your own password was
                  previously impossible from here — the whole action block was hidden — which
                  meant the one person who administers every other account had no way to rotate
                  their own credentials in the place they manage credentials. Delete and Switch
                  off access stay hidden for yourself: both are refused server-side anyway
                  (a super admin cannot delete themselves), and a button that always errors is
                  worse than no button. */}
              {user.id === currentUserId ? (
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full gap-2 bg-transparent"
                  onClick={() => {
                    setSelectedUser(user)
                    setPassword('')
                    setEditOpen(true)
                  }}
                >
                  <Edit className="w-3 h-3" />
                  Edit my details
                </Button>
              ) : (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="flex-1 gap-2 bg-transparent"
                      onClick={() => {
                        setSelectedUser(user)
                        setPassword('')
                        setEditOpen(true)
                      }}
                    >
                      <Edit className="w-3 h-3" />
                      Edit
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      className="flex-1 gap-2"
                      onClick={() => handleDeleteUser(user.id, user.full_name || user.email)}
                    >
                      <Trash2 className="w-3 h-3" />
                      Delete
                    </Button>
                  </div>
                  <Button
                    variant={user.is_active === false ? 'default' : 'outline'}
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => handleToggleActive(user.id, user.is_active !== false, user.full_name || user.email)}
                  >
                    {user.is_active === false ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                    {/* Named for what it does, not for a state. "Deactivate" sat next to a
                        red Delete button and read as the milder cosmetic option, which is
                        the opposite of the truth: this is the reversible way to remove
                        access, and Delete is the permanent one. */}
                    {user.is_active === false ? 'Restore access' : 'Switch off access'}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Edit User Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editingSelf ? 'Edit my details' : 'Edit User'}</DialogTitle>
            <DialogDescription>
              {editingSelf
                ? 'Change your own name or password. Your role is fixed here.'
                : 'Update user details and reset password'}
            </DialogDescription>
          </DialogHeader>
          {selectedUser && (
            <form onSubmit={handleEditUser} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="editFullName">Full Name</Label>
                <Input
                  id="editFullName"
                  value={selectedUser.full_name}
                  onChange={(e) => setSelectedUser({ ...selectedUser, full_name: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editEmail">Email (Read-only)</Label>
                <Input
                  id="editEmail"
                  value={selectedUser.email}
                  disabled
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="editPassword">New Password (Optional)</Label>
                <div className="flex gap-2">
                  <Input
                    id="editPassword"
                    type={showPassword ? 'text' : 'password'}
                    placeholder="Leave empty to keep current"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    minLength={6}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                </div>
                {editingSelf && (
                  <p className="text-xs text-muted-foreground">
                    Changing your own password signs you out everywhere, including here. You will
                    be sent to the sign-in page to use the new one.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="editRole">Role</Label>
                {/* Demoting yourself out of super_admin locks you out of this page — and if
                    you were the last one, out of the org's only super-admin surface entirely.
                    The server refuses a self role change too; this just stops the control
                    from looking usable. */}
                <Select
                  value={selectedUser.role}
                  onValueChange={(val) => setSelectedUser({ ...selectedUser, role: val })}
                  disabled={editingSelf}
                >
                  {/* The Label above has always pointed at "editRole"; nothing carried that id,
                      so the label named no control for a screen reader. */}
                  <SelectTrigger id="editRole">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="user">User</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                    <SelectItem value="super_admin">Super Admin</SelectItem>
                  </SelectContent>
                </Select>
                {editingSelf && (
                  <p className="text-xs text-muted-foreground">
                    You cannot change your own role. Ask the other super admin to change it for you.
                  </p>
                )}
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? 'Updating...' : editingSelf ? 'Save my details' : 'Update User'}
              </Button>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
