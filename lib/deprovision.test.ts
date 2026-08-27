import { describe, expect, it } from 'vitest'
import {
  REASSIGNED_ON_DELETE,
  REFUSAL_MESSAGES,
  checkDeactivation,
  checkDeletion,
  describeDeactivation,
  describeDeletion,
} from './deprovision'

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

  // The count is of super admins, not of accounts - a lone super admin among ten users is
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
    expect(text).toMatch(/Kept:.*tasks, comments and shared bookmarks/i)
    expect(text).toMatch(
      /Destroyed:.*personal tasks, private messages, personal bookmarks and personal views/i,
    )
    expect(text).toMatch(/cannot be undone/i)
  })

  // The property that actually protects people. Deletion is irreversible and deactivation
  // is not, so the destructive dialog has to name the reversible alternative - otherwise an
  // admin who only wants to revoke access reaches for the permanent button.
  it('points at the reversible alternative', () => {
    expect(describeDeletion('Alice', 0)).toMatch(/switch off access/i)
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

describe('describeDeactivation', () => {
  it('leads with the fact that nothing is lost', () => {
    const text = describeDeactivation('Alice')
    expect(text).toMatch(/stays exactly as it is/i)
    expect(text).toMatch(/still under their name/i)
  })

  it('says it is reversible', () => {
    expect(describeDeactivation('Alice')).toMatch(/switch their access back on at any time/i)
  })

  it('says they will be signed out and locked out', () => {
    const text = describeDeactivation('Alice')
    expect(text).toMatch(/signed out/i)
    expect(text).toMatch(/cannot sign back in/i)
  })

  // It must never read like the destructive option; that inversion is what made the old
  // toggle dangerous.
  it('never claims anything is deleted', () => {
    expect(describeDeactivation('Alice')).not.toMatch(/delete|destroy|permanent/i)
  })
})

describe('checkDeactivation', () => {
  it('applies the same guards as deletion', () => {
    expect(checkDeactivation({ id: 'me', role: 'user' }, 'me', 3)).toBe('self')
    expect(checkDeactivation({ id: 'them', role: 'super_admin' }, 'me', 1)).toBe('last-super-admin')
    expect(checkDeactivation({ id: 'them', role: 'user' }, 'me', 2)).toBeNull()
  })

  // Callers must pass the count of ACTIVE super admins. A second super admin who is already
  // switched off is not a way back in, so counting them would allow locking everyone out.
  it('treats an already-inactive second super admin as no safety net', () => {
    expect(checkDeactivation({ id: 'them', role: 'super_admin' }, 'me', 1)).toBe('last-super-admin')
  })
})

describe('shared saved views', () => {
  // Migration 119 CASCADEs saved_views on the owner, which is right for a personal view and
  // destructive for a shared one: it is on everyone's picker and other people are using it.
  // The route reassigns the shared ones, so the dialog has to say so before the button is
  // pressed - an operator cannot weigh a transfer they were never told about.
  it('mentions shared-view transfer only when there are shared views', () => {
    expect(describeDeletion('Alice', 0, 0)).not.toMatch(/shared view/i)
    expect(describeDeletion('Alice', 0, 1)).toMatch(/1 shared view they created will transfer/i)
    expect(describeDeletion('Alice', 0, 3)).toMatch(/3 shared views they created will transfer/i)
  })

  it('reports boards and shared views independently', () => {
    const text = describeDeletion('Alice', 2, 4)
    expect(text).toMatch(/2 boards they created will transfer/i)
    expect(text).toMatch(/4 shared views they created will transfer/i)
  })

  it('defaults to zero so an un-updated caller cannot claim a transfer that did not happen', () => {
    expect(describeDeletion('Alice', 0)).not.toMatch(/shared view/i)
  })

  it('names shared views as reassigned, and does not claim personal ones are', () => {
    expect(REASSIGNED_ON_DELETE).toContain('boards')
    expect(REASSIGNED_ON_DELETE.some((t) => t.startsWith('saved_views'))).toBe(true)
    // The distinction is load-bearing: moving a personal view would hand the deleting admin a
    // view built to be private from admins.
    expect(REASSIGNED_ON_DELETE.join(' ')).toMatch(/shared only/i)
  })

  it('still says personal views are destroyed, because they are', () => {
    expect(describeDeletion('Alice', 0, 2)).toMatch(/Destroyed:.*personal views/i)
  })
})
