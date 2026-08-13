import { describe, expect, it } from 'vitest'
import { REFUSAL_MESSAGES, checkDeletion, describeDeletion } from './deprovision'

describe('checkDeletion', () => {
  const other = { id: 'them', role: 'user' }

  it('allows deleting somebody else', () => {
    expect(checkDeletion(other, 'me', 2)).toBeNull()
  })

  it('refuses deleting yourself', () => {
    expect(checkDeletion({ id: 'me', role: 'super_admin' }, 'me', 5)).toBe('self')
  })

  // Every management surface is gated on is_super_admin_user(). Removing the last one leaves
  // a running system nobody can administer, recoverable only through direct DB access.
  it('refuses removing the last super admin', () => {
    expect(checkDeletion({ id: 'them', role: 'super_admin' }, 'me', 1)).toBe('last-super-admin')
  })

  it('allows removing a super admin when another remains', () => {
    expect(checkDeletion({ id: 'them', role: 'super_admin' }, 'me', 2)).toBeNull()
  })

  // The count is of super admins, not of accounts — a lone super admin among ten users is
  // still the last one.
  it('counts super admins, not accounts', () => {
    expect(checkDeletion({ id: 'them', role: 'super_admin' }, 'me', 1)).toBe('last-super-admin')
    expect(checkDeletion({ id: 'them', role: 'admin' }, 'me', 1)).toBeNull()
  })

  it('reports a missing account rather than proceeding', () => {
    expect(checkDeletion(null, 'me', 3)).toBe('not-found')
    expect(checkDeletion(undefined, 'me', 3)).toBe('not-found')
  })

  // Self-deletion is checked before the role rule so the message names the real reason.
  it('prefers the self message when both rules would fire', () => {
    expect(checkDeletion({ id: 'me', role: 'super_admin' }, 'me', 1)).toBe('self')
  })

  it('has a message for every refusal', () => {
    for (const reason of ['self', 'last-super-admin', 'not-found'] as const) {
      expect(REFUSAL_MESSAGES[reason]).toBeTruthy()
    }
  })
})

describe('describeDeletion', () => {
  it('says plainly what is kept and what goes', () => {
    const text = describeDeletion('Alice', 0)
    expect(text).toMatch(/tasks, comments and shared bookmarks stay/i)
    expect(text).toMatch(/personal tasks, private messages and bookmarks are deleted/i)
    expect(text).toMatch(/cannot be undone/i)
  })

  it('mentions board transfer only when there are boards', () => {
    expect(describeDeletion('Alice', 0)).not.toMatch(/transfer/i)
    expect(describeDeletion('Alice', 1)).toMatch(/1 board they created will transfer to you/)
    expect(describeDeletion('Alice', 4)).toMatch(/4 boards they created will transfer to you/)
  })

  it('names the person being removed', () => {
    expect(describeDeletion('Kayla Viehland', 2)).toMatch(/Kayla Viehland/)
  })
})
