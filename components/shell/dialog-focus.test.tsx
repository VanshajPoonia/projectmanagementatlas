// @vitest-environment jsdom
//
// Dialog behaviour - ATLAS_02 Prompt A's "dialog focus restoration" and the keyboard half of
// the unsaved-change guard.
//
// ⚠️ FOCUS RESTORATION IS NOT ASSERTED HERE, deliberately. Radix returns focus to the trigger
// from inside `onCloseAutoFocus`, scheduled on a requestAnimationFrame that jsdom does not
// flush under the React 19 test environment: focus lands on `body` in jsdom while working
// correctly in a real browser. Asserting it here would mean either a failing test or a
// weakened one that passes without proving anything. It is verified in the Playwright pass
// instead, which is the environment that can actually observe it.
//
// What jsdom *can* prove, and does below: the dialog carries an accessible name and
// description, and the unsaved-change guard intercepts the Escape key - not just the visible
// close button. That second one is the real regression risk, because Escape routes through
// the same onOpenChange and is easy to forget when adding a guard.
//
// This tests the repo's own Dialog wrapper (components/ui/dialog.tsx), not Radix directly, so
// it covers the wrapper's own props too.

import { describe, expect, it } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useState } from 'react'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { guardedOpenChange } from './unsaved-changes'

function Harness({ dirty = false, confirm }: { dirty?: boolean; confirm?: (m: string) => boolean }) {
  const [open, setOpen] = useState(false)
  const onOpenChange = dirty ? guardedOpenChange(true, setOpen, confirm) : setOpen
  return (
    <div>
      <button onClick={() => setOpen(true)}>Open task</button>
      <button>Somewhere else</button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Task</DialogTitle>
            <DialogDescription>Add a task to this column</DialogDescription>
          </DialogHeader>
          <input aria-label="Title" />
        </DialogContent>
      </Dialog>
    </div>
  )
}

describe('dialog behaviour', () => {
  // Focus must at least *leave* the trigger and enter the dialog - that half jsdom can see,
  // and it is what stops a keyboard user tabbing around behind an open modal.
  it('moves focus into the dialog on open', async () => {
    render(<Harness />)
    const trigger = screen.getByRole('button', { name: 'Open task' })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(document.activeElement).not.toBe(trigger))
    expect(dialog.contains(document.activeElement)).toBe(true)
  })

  it('closes on Escape when there is nothing to lose', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }))
    await screen.findByRole('dialog')
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('gives the dialog an accessible name and description', async () => {
    render(<Harness />)
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }))
    const dialog = await screen.findByRole('dialog')
    expect(dialog).toHaveAccessibleName('Create New Task')
    expect(dialog).toHaveAccessibleDescription('Add a task to this column')
  })

  // The unsaved-change guard sits on the same onOpenChange that Radix calls for Escape, so
  // it has to intercept the key too - not only the visible close button.
  it('Escape does not close a dirty dialog when the user backs out of the prompt', async () => {
    render(<Harness dirty confirm={() => false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }))
    const dialog = await screen.findByRole('dialog')

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    // Still open, and still holding whatever was typed.
    await waitFor(() => expect(dialog).toBeInTheDocument())
  })

  it('Escape closes a dirty dialog once the user confirms', async () => {
    render(<Harness dirty confirm={() => true} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open task' }))
    await screen.findByRole('dialog')

    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })
})
