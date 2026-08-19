'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Check, Loader2, Pencil, Plus, Trash2, UserPlus, Users, X } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import { toast } from 'sonner'
import {
  describeMembership,
  membershipIndex,
  nextTeamPosition,
  personLabel,
  sortPeople,
  sortTeams,
  teamSizes,
  toggleMembership,
  unassignedPeople,
  type TeamMemberRow,
  type TeamPerson,
  type TeamRow,
} from '@/lib/teams'

// Super-admin-only team management. The route already gates on super_admin
// (app/admin/super-admin/page.tsx redirects everyone else) and migration 094's RLS enforces it
// again in Postgres, so this component does no permission checking of its own - it would be a
// third copy of a rule that is already stated twice.
//
// Membership is a people x teams grid rather than a per-team member picker: the owner asked to
// "move team members", and a move is only legible when you can see both teams at once. The
// per-team checkbox list (marketing-calendar-management.tsx) makes a move look like two
// unrelated edits in two different dialogs.
export default function TeamManagement() {
  const supabase = useMemo(() => createClient(), [])

  const [teams, setTeams] = useState<TeamRow[]>([])
  const [people, setPeople] = useState<TeamPerson[]>([])
  const [members, setMembers] = useState<TeamMemberRow[]>([])
  const [loading, setLoading] = useState(true)

  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState('#3b82f6')
  const [creating, setCreating] = useState(false)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [editName, setEditName] = useState('')
  const [editColor, setEditColor] = useState('#3b82f6')

  // Cells mid-write, keyed `${teamId}:${userId}`, so one slow toggle doesn't freeze the grid.
  const [pending, setPending] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    const [teamsRes, peopleRes, membersRes] = await Promise.all([
      supabase.from('teams').select('id,name,color,position'),
      supabase.from('profiles').select('id,full_name,email,role'),
      supabase.from('team_members').select('team_id,user_id'),
    ])
    if (teamsRes.data) setTeams(teamsRes.data)
    if (peopleRes.data) setPeople(peopleRes.data)
    if (membersRes.data) setMembers(membersRes.data)
    setLoading(false)
  }, [supabase])

  useEffect(() => {
    load()
  }, [load])

  const orderedTeams = useMemo(() => sortTeams(teams), [teams])
  const orderedPeople = useMemo(() => sortPeople(people), [people])
  const sizes = useMemo(() => teamSizes(teams, members), [teams, members])
  const index = useMemo(() => membershipIndex(members), [members])
  const unassigned = useMemo(() => unassignedPeople(people, members), [people, members])

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault()
    const name = newName.trim()
    if (!name) return
    setCreating(true)
    const { error } = await supabase
      .from('teams')
      .insert({ name, color: newColor, position: nextTeamPosition(teams) })
    setCreating(false)
    if (error) {
      toast.error(error.code === '23505' ? 'A team with that name already exists' : 'Could not create team', {
        description: error.code === '23505' ? undefined : error.message,
      })
      return
    }
    setNewName('')
    setNewColor('#3b82f6')
    toast.success('Team created')
    load()
  }

  const startEdit = (team: TeamRow) => {
    setEditingId(team.id)
    setEditName(team.name)
    setEditColor(team.color)
  }

  const saveEdit = async (team: TeamRow) => {
    const name = editName.trim()
    if (!name) return
    const { error } = await supabase.from('teams').update({ name, color: editColor }).eq('id', team.id)
    if (error) {
      toast.error(error.code === '23505' ? 'A team with that name already exists' : 'Could not save team', {
        description: error.code === '23505' ? undefined : error.message,
      })
      return
    }
    setEditingId(null)
    toast.success('Team updated')
    load()
  }

  const handleDelete = async (team: TeamRow) => {
    const size = sizes.get(team.id) ?? 0
    // team_members cascades on team delete (migration 064), so say so rather than let the
    // membership vanish silently.
    const confirmed = window.confirm(
      size > 0
        ? `Delete "${team.name}"? ${size} ${size === 1 ? 'person' : 'people'} will be removed from it. Their accounts and work are not affected.`
        : `Delete "${team.name}"?`,
    )
    if (!confirmed) return

    const { error } = await supabase.from('teams').delete().eq('id', team.id)
    if (error) {
      toast.error('Could not delete team', { description: error.message })
      return
    }
    toast.success(`Deleted "${team.name}"`)
    load()
  }

  // Every membership update goes through the functional form of setMembers. A move is two
  // ticks in quick succession, so snapshotting `members` and restoring it on failure would
  // silently discard whichever toggle happened while the first write was still in flight.
  // Undoing one cell by inverting that same cell leaves any concurrent edit intact.
  const handleToggle = async (team: TeamRow, person: TeamPerson, shouldBelong: boolean) => {
    const cell = `${team.id}:${person.id}`

    setPending((p) => new Set(p).add(cell))
    setMembers((prev) => toggleMembership(prev, team.id, person.id, shouldBelong))

    const { error } = shouldBelong
      ? await supabase.from('team_members').insert({ team_id: team.id, user_id: person.id })
      : await supabase
          .from('team_members')
          .delete()
          .eq('team_id', team.id)
          .eq('user_id', person.id)

    setPending((p) => {
      const next = new Set(p)
      next.delete(cell)
      return next
    })

    if (error) {
      setMembers((prev) => toggleMembership(prev, team.id, person.id, !shouldBelong))
      toast.error(shouldBelong ? 'Could not add to team' : 'Could not remove from team', {
        description: error.message,
      })
      return
    }

    toast.success(
      shouldBelong
        ? `${personLabel(person)} added to ${team.name}`
        : `${personLabel(person)} removed from ${team.name}`,
    )
  }

  const addEveryoneTo = async (team: TeamRow) => {
    const missing = orderedPeople.filter((p) => !index.get(p.id)?.has(team.id))
    if (missing.length === 0) {
      toast.info(`Everyone is already in ${team.name}`)
      return
    }
    const rows = missing.map((p) => ({ team_id: team.id, user_id: p.id }))
    setMembers((prev) => [...prev, ...rows])
    // upsert rather than insert: someone ticked into this team between computing `missing` and
    // sending it would collide with the composite PK and fail the whole batch.
    const { error } = await supabase
      .from('team_members')
      .upsert(rows, { onConflict: 'team_id,user_id', ignoreDuplicates: true })
    if (error) {
      await load() // resync rather than guess which of a batch of rows landed
      toast.error('Could not add everyone', { description: error.message })
      return
    }
    toast.success(`Added ${missing.length} ${missing.length === 1 ? 'person' : 'people'} to ${team.name}`)
  }

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          <span className="sr-only">Loading teams</span>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Teams
          </CardTitle>
          <CardDescription>
            Internal groupings inside the company. Everyone signed in can see the teams and who is in them; only
            super admins can change them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <form onSubmit={handleCreate} className="flex flex-wrap items-end gap-2">
            <div className="min-w-[180px] flex-1 space-y-1.5">
              <Label htmlFor="new-team-name" className="text-xs">Name</Label>
              <Input
                id="new-team-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Atlas General Contracting"
                disabled={creating}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-team-color" className="text-xs">Color</Label>
              <input
                id="new-team-color"
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="h-10 w-12 cursor-pointer rounded border"
                disabled={creating}
              />
            </div>
            <Button type="submit" className="gap-2" disabled={creating || !newName.trim()}>
              <Plus className="h-4 w-4" />
              Add Team
            </Button>
          </form>

          <div className="space-y-2">
            {orderedTeams.map((team) => (
              <div key={team.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                {editingId === team.id ? (
                  <div className="flex flex-1 flex-wrap items-center gap-2">
                    <input
                      type="color"
                      value={editColor}
                      onChange={(e) => setEditColor(e.target.value)}
                      className="h-9 w-10 flex-shrink-0 cursor-pointer rounded border"
                      aria-label={`Color for ${team.name}`}
                    />
                    <Input
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="h-9 min-w-[160px] flex-1"
                      placeholder="Team name"
                      aria-label={`Name for ${team.name}`}
                    />
                    <Button size="icon-sm" variant="ghost" onClick={() => saveEdit(team)} aria-label="Save">
                      <Check className="h-4 w-4" />
                    </Button>
                    <Button size="icon-sm" variant="ghost" onClick={() => setEditingId(null)} aria-label="Cancel">
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                ) : (
                  <>
                    <div className="flex min-w-0 items-center gap-2.5">
                      <span
                        className="h-4 w-4 flex-shrink-0 rounded-full"
                        style={{ backgroundColor: team.color }}
                      />
                      <span className="truncate font-medium">{team.name}</span>
                      <Badge variant="outline" className="text-muted-foreground">
                        {sizes.get(team.id) ?? 0} {(sizes.get(team.id) ?? 0) === 1 ? 'member' : 'members'}
                      </Badge>
                    </div>
                    <div className="flex flex-shrink-0 items-center gap-1">
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        onClick={() => addEveryoneTo(team)}
                      >
                        <UserPlus className="h-4 w-4" />
                        <span className="hidden sm:inline">Add everyone</span>
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => startEdit(team)}
                        aria-label={`Edit ${team.name}`}
                      >
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        onClick={() => handleDelete(team)}
                        aria-label={`Delete ${team.name}`}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </>
                )}
              </div>
            ))}
            {orderedTeams.length === 0 && (
              <p className="text-sm text-muted-foreground">No teams yet. Add one above.</p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Who is in which team
          </CardTitle>
          <CardDescription>
            Tick to add, untick to remove. To move someone, untick their old team and tick the new one. Changes
            save as you make them.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {unassigned.length > 0 && (
            <div className="rounded-lg border border-dashed p-3 text-sm">
              <p className="font-medium">
                {unassigned.length} {unassigned.length === 1 ? 'person is' : 'people are'} not in any team
              </p>
              <p className="mt-1 text-muted-foreground">
                New accounts do not join a team automatically: {unassigned.map(personLabel).join(', ')}
              </p>
            </div>
          )}

          {orderedTeams.length === 0 ? (
            <p className="text-sm text-muted-foreground">Add a team above to start assigning people.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <caption className="sr-only">People by team</caption>
                <thead>
                  <tr className="border-b">
                    <th scope="col" className="py-2 pr-3 text-left font-medium">Person</th>
                    {orderedTeams.map((team) => (
                      <th key={team.id} scope="col" className="px-3 py-2 text-left font-medium">
                        <span className="flex items-center gap-1.5">
                          <span
                            className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                            style={{ backgroundColor: team.color }}
                          />
                          <span className="whitespace-nowrap">{team.name}</span>
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {orderedPeople.map((person) => {
                    const personTeams = index.get(person.id)
                    return (
                      <tr key={person.id} className="hover:bg-accent/40">
                        <th scope="row" className="max-w-[220px] py-2 pr-3 text-left font-normal">
                          <span className="block truncate font-medium">{personLabel(person)}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {describeMembership(orderedTeams, personTeams)}
                          </span>
                        </th>
                        {orderedTeams.map((team) => {
                          const cell = `${team.id}:${person.id}`
                          const checked = personTeams?.has(team.id) ?? false
                          return (
                            <td key={team.id} className="px-3 py-2">
                              <input
                                type="checkbox"
                                className="h-4 w-4 cursor-pointer rounded"
                                checked={checked}
                                disabled={pending.has(cell)}
                                onChange={(e) => handleToggle(team, person, e.target.checked)}
                                aria-label={`${personLabel(person)} in ${team.name}`}
                              />
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
