import { describe, expect, it, vi } from 'vitest'
import {
  UNDO_DURATION_MS,
  createUndoHandler,
  showUndoableToast,
  type ToastOptions,
  type ToastSurface,
} from './undo-toast'

function fakeToast() {
  const success = vi.fn<(m: string, o?: ToastOptions) => void>()
  const error = vi.fn<(m: string, o?: ToastOptions) => void>()
  const surface: ToastSurface = { success, error }
  return { surface, success, error }
}

describe('createUndoHandler', () => {
  it('runs the undo and confirms it', async () => {
    const { surface, success } = fakeToast()
    const onUndo = vi.fn().mockResolvedValue({ ok: true })
    await createUndoHandler(surface, { onUndo })()
    expect(onUndo).toHaveBeenCalledOnce()
    expect(success).toHaveBeenCalledWith('Restored')
  })

  it('uses a caller-supplied confirmation', async () => {
    const { surface, success } = fakeToast()
    await createUndoHandler(surface, {
      onUndo: () => ({ ok: true }),
      undoneMessage: 'Bookmark restored',
    })()
    expect(success).toHaveBeenCalledWith('Bookmark restored')
  })

  // sonner's action button stays clickable while the toast animates out, so a second
  // restore of the same row is either a duplicate-key error or a duplicate row.
  it('only ever runs once, however many times it is clicked', async () => {
    const { surface } = fakeToast()
    const onUndo = vi.fn().mockResolvedValue({ ok: true })
    const handler = createUndoHandler(surface, { onUndo })
    await Promise.all([handler(), handler(), handler()])
    expect(onUndo).toHaveBeenCalledOnce()
  })

  // A failed undo must say the change is still applied. "Couldn't undo" alone leaves the
  // user unable to tell whether to retry or recreate the thing by hand.
  it('reports a failed undo and says the change still stands', async () => {
    const { surface, error, success } = fakeToast()
    await createUndoHandler(surface, {
      onUndo: () => ({ ok: false, error: 'permission denied' }),
    })()
    expect(success).not.toHaveBeenCalled()
    expect(error).toHaveBeenCalledWith('Couldn’t undo that', {
      description: 'permission denied. The change is still applied.',
    })
  })

  it('still says the change stands when the failure carries no message', async () => {
    const { surface, error } = fakeToast()
    await createUndoHandler(surface, { onUndo: () => ({ ok: false }) })()
    expect(error).toHaveBeenCalledWith('Couldn’t undo that', {
      description: 'The change is still applied.',
    })
  })

  it('turns a thrown error into the same honest failure message', async () => {
    const { surface, error } = fakeToast()
    await createUndoHandler(surface, {
      onUndo: () => {
        throw new Error('network down')
      },
    })()
    expect(error).toHaveBeenCalledWith('Couldn’t undo that', {
      description: 'network down. The change is still applied.',
    })
  })

  it('accepts a synchronous undo', async () => {
    const { surface, success } = fakeToast()
    await createUndoHandler(surface, { onUndo: () => ({ ok: true }) })()
    expect(success).toHaveBeenCalledWith('Restored')
  })

  // A handler that threw once has still "been used" - retrying would be a second write
  // against a state the caller can no longer reason about.
  it('does not re-arm after a failure', async () => {
    const { surface } = fakeToast()
    const onUndo = vi.fn().mockResolvedValue({ ok: false, error: 'nope' })
    const handler = createUndoHandler(surface, { onUndo })
    await handler()
    await handler()
    expect(onUndo).toHaveBeenCalledOnce()
  })
})

describe('showUndoableToast', () => {
  it('shows the message with an Undo action', () => {
    const { surface, success } = fakeToast()
    showUndoableToast(surface, { message: 'Task deleted', onUndo: () => ({ ok: true }) })
    const [message, options] = success.mock.calls[0]
    expect(message).toBe('Task deleted')
    expect(options?.action?.label).toBe('Undo')
    expect(options?.duration).toBe(UNDO_DURATION_MS)
  })

  it('passes through a description and a custom label and duration', () => {
    const { surface, success } = fakeToast()
    showUndoableToast(surface, {
      message: 'Bookmark deleted',
      description: 'Only you could see it.',
      undoLabel: 'Put it back',
      durationMs: 3000,
      onUndo: () => ({ ok: true }),
    })
    const [, options] = success.mock.calls[0]
    expect(options?.description).toBe('Only you could see it.')
    expect(options?.action?.label).toBe('Put it back')
    expect(options?.duration).toBe(3000)
  })

  it('runs the undo when the action is clicked', async () => {
    const { surface, success } = fakeToast()
    const onUndo = vi.fn().mockResolvedValue({ ok: true })
    showUndoableToast(surface, { message: 'Task deleted', onUndo })
    success.mock.calls[0][1]?.action?.onClick()
    await vi.waitFor(() => expect(onUndo).toHaveBeenCalledOnce())
  })

  // The regression this guards: building the handler inside onClick gives every click its
  // own `used` flag, so the once-only rule silently stops applying.
  it('shares one handler across clicks, so double-clicking Undo restores once', async () => {
    const { surface, success } = fakeToast()
    const onUndo = vi.fn().mockResolvedValue({ ok: true })
    showUndoableToast(surface, { message: 'Task deleted', onUndo })
    const click = success.mock.calls[0][1]?.action?.onClick
    click?.()
    click?.()
    click?.()
    await vi.waitFor(() => expect(onUndo).toHaveBeenCalledOnce())
  })
})
