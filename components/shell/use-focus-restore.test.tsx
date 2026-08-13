// @vitest-environment jsdom
//
// The focus-restore hook. Unlike Radix's own restore (which jsdom cannot observe, see
// dialog-focus.test.tsx), this one is driven by a plain interval, so fake timers can step
// through it deterministically — including the case that made the first version useless: the
// dialog content still holding focus while it animates out.

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import { render, act } from '@testing-library/react'
import '@testing-library/jest-dom/vitest'
import { useDialogFocusRestore } from './use-focus-restore'

function Harness({ open }: { open: boolean }) {
  useDialogFocusRestore(open)
  return null
}

function setup() {
  document.body.innerHTML = `
    <main id="app-main" tabindex="-1"></main>
    <button id="trigger">Add task</button>
    <div data-slot="dialog-content"><input id="field" /></div>
    <button id="elsewhere">Elsewhere</button>
  `
  return {
    trigger: document.getElementById('trigger') as HTMLButtonElement,
    field: document.getElementById('field') as HTMLInputElement,
    elsewhere: document.getElementById('elsewhere') as HTMLButtonElement,
    main: document.getElementById('app-main') as HTMLElement,
  }
}

beforeEach(() => vi.useFakeTimers())
afterEach(() => {
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('useDialogFocusRestore', () => {
  it('returns focus to the element that opened the dialog', () => {
    const els = setup()
    els.trigger.focus()
    const { rerender } = render(<Harness open={false} />)

    rerender(<Harness open={true} />)
    els.field.focus()

    rerender(<Harness open={false} />)
    els.field.blur() // content unmounts, focus falls to body
    act(() => void vi.advanceTimersByTime(200))

    expect(document.activeElement).toBe(els.trigger)
  })

  // The bug the first version shipped with: it checked once, two frames after close, saw the
  // dialog's own input still focused, concluded all was well, and did nothing — then focus
  // dropped to body when the content finally unmounted.
  it('keeps waiting while the closing dialog still holds focus', () => {
    const els = setup()
    els.trigger.focus()
    const { rerender } = render(<Harness open={false} />)
    rerender(<Harness open={true} />)
    els.field.focus()
    rerender(<Harness open={false} />)

    // Exit animation in progress: focus is still inside the dialog.
    act(() => void vi.advanceTimersByTime(150))
    expect(document.activeElement).toBe(els.field)

    // Content unmounts.
    els.field.blur()
    act(() => void vi.advanceTimersByTime(100))
    expect(document.activeElement).toBe(els.trigger)
  })

  it('gives up waiting and restores anyway if the dialog never releases focus', () => {
    const els = setup()
    els.trigger.focus()
    const { rerender } = render(<Harness open={false} />)
    rerender(<Harness open={true} />)
    els.field.focus()
    rerender(<Harness open={false} />)

    act(() => void vi.advanceTimersByTime(1000))
    expect(document.activeElement).toBe(els.trigger)
  })

  // Radix succeeding, or the user clicking something, must not be overridden.
  it('leaves focus alone when it already landed outside the dialog', () => {
    const els = setup()
    els.trigger.focus()
    const { rerender } = render(<Harness open={false} />)
    rerender(<Harness open={true} />)
    els.field.focus()

    rerender(<Harness open={false} />)
    els.elsewhere.focus()
    act(() => void vi.advanceTimersByTime(300))

    expect(document.activeElement).toBe(els.elsewhere)
  })

  // The common case in this codebase: the host re-renders while the dialog is open and the
  // trigger becomes a new node. Focusing the detached one is a silent no-op, so the hook has
  // to notice and fall back rather than believe it succeeded.
  it('falls back to the main landmark when the trigger no longer exists', () => {
    const els = setup()
    els.trigger.focus()
    const { rerender } = render(<Harness open={false} />)
    rerender(<Harness open={true} />)
    els.field.focus()

    els.trigger.remove()
    rerender(<Harness open={false} />)
    els.field.blur()
    act(() => void vi.advanceTimersByTime(200))

    expect(document.activeElement).toBe(els.main)
  })

  it('makes a plain <main> focusable rather than giving up on it', () => {
    document.body.innerHTML = `
      <main></main>
      <button id="trigger">Open</button>
      <div data-slot="dialog-content"><input id="field" /></div>
    `
    const trigger = document.getElementById('trigger') as HTMLButtonElement
    const field = document.getElementById('field') as HTMLInputElement
    const main = document.querySelector('main') as HTMLElement
    trigger.focus()

    const { rerender } = render(<Harness open={false} />)
    rerender(<Harness open={true} />)
    field.focus()
    trigger.remove()
    rerender(<Harness open={false} />)
    field.blur()
    act(() => void vi.advanceTimersByTime(200))

    expect(main).toHaveAttribute('tabindex', '-1')
    expect(document.activeElement).toBe(main)
  })

  it('does nothing at all for a dialog that never opened', () => {
    const els = setup()
    els.elsewhere.focus()
    render(<Harness open={false} />)
    act(() => void vi.advanceTimersByTime(1000))
    expect(document.activeElement).toBe(els.elsewhere)
  })

  it('stops polling when unmounted mid-close', () => {
    const els = setup()
    els.trigger.focus()
    const { rerender, unmount } = render(<Harness open={false} />)
    rerender(<Harness open={true} />)
    els.field.focus()
    rerender(<Harness open={false} />)
    unmount()
    els.field.blur()
    act(() => void vi.advanceTimersByTime(1000))
    expect(document.activeElement).not.toBe(els.trigger)
  })
})
