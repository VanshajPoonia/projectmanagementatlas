'use client'

import { Lock, Users } from 'lucide-react'

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  DEFAULT_BOARD_ROLE,
  MEMBERSHIP_LOCKED_REASON,
  ROLE_OPTIONS,
  membershipHint,
  type BoardRole,
  type MembershipRow,
} from '@/lib/board-membership'

// The board access list, shared by the create and edit dialogs so the two cannot drift.
//
// Two things this replaces, both of which were real defects rather than polish:
//
//   1. It only rendered for PRIVATE boards, and `board_members` was only written when the
//      board was private. But migrations 065/067 key the guest/client restriction off the
//      row alone, not off privacy - so on a public board the roles were both ungrantable
//      and, if set by hand, wiped on the next save.
//   2. There was no way to choose a role anywhere in the app. Guest and client were
//      enforced by RLS and covered by a passing harness, while being unreachable by any
//      human without writing SQL.
//
// Presentation follows the "hide vs disable + explain" split: a non-creator gets the list
// read-only with a stated reason, because they CAN see the board and would otherwise be
// left guessing why saving did nothing. Migration 061 is what makes that true, and the UI's
// job is to report it, not to route around it.

export interface PickerUser {
  id: string
  full_name: string | null
  email: string | null
}

interface BoardMemberPickerProps {
  users: readonly PickerUser[]
  value: readonly MembershipRow[]
  onChange: (next: MembershipRow[]) => void
  isPrivate: boolean
  disabled?: boolean
  /** False when the viewer is not the board's creator; the list goes read-only. */
  canManage?: boolean
}

export default function BoardMemberPicker({
  users,
  value,
  onChange,
  isPrivate,
  disabled = false,
  canManage = true,
}: BoardMemberPickerProps) {
  const roleByUser = new Map(value.map((row) => [row.user_id, row.role]))
  const locked = disabled || !canManage

  const setIncluded = (userId: string, included: boolean) => {
    if (!included) {
      onChange(value.filter((row) => row.user_id !== userId))
      return
    }
    if (roleByUser.has(userId)) return
    onChange([...value, { user_id: userId, role: DEFAULT_BOARD_ROLE }])
  }

  const setRole = (userId: string, role: BoardRole) => {
    onChange(value.map((row) => (row.user_id === userId ? { ...row, role } : row)))
  }

  return (
    <div className="space-y-1.5 pt-1">
      <p className="text-muted-foreground flex items-start gap-1 text-xs">
        <Users className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{membershipHint(isPrivate)}</span>
      </p>

      {/* Deliberately replaces the list rather than disabling it. 061's SELECT policy only
          returns a person their OWN membership row, so for a non-creator the list would
          render as "nobody has access" - which is not a restricted view of the truth, it is
          a false one. Explaining the restriction beats disabling a control over bad data. */}
      {!canManage ? (
        <p className="text-muted-foreground bg-muted/40 flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
          <Lock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{MEMBERSHIP_LOCKED_REASON}</span>
        </p>
      ) : (
      <div className="max-h-56 divide-y overflow-y-auto rounded border">
        {users.length === 0 && (
          <p className="text-muted-foreground px-3 py-2 text-sm">No people to choose from.</p>
        )}
        {users.map((user) => {
          const role = roleByUser.get(user.id)
          const included = role !== undefined
          const name = user.full_name || user.email || 'Unknown user'

          return (
            <div key={user.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={included}
                  disabled={locked}
                  onChange={(event) => setIncluded(user.id, event.target.checked)}
                  aria-label={`Give ${name} access to this board`}
                />
                <span className="truncate">{name}</span>
              </label>

              {included && (
                <Select
                  value={role}
                  disabled={locked}
                  onValueChange={(next) => setRole(user.id, next as BoardRole)}
                >
                  {/* Narrow on purpose: the name is the thing being scanned, the role is
                      the qualifier. A full-width select would invert that. */}
                  <SelectTrigger
                    className="h-8 w-32 shrink-0 text-xs"
                    aria-label={`Access level for ${name}`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLE_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        <span className="flex flex-col items-start">
                          <span>{option.label}</span>
                          <span className="text-muted-foreground text-xs">{option.description}</span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          )
        })}
      </div>
      )}
    </div>
  )
}
