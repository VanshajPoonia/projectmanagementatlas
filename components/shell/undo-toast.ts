// Undo-capable toasts.
//
// ATLAS_02 Prompt M: "Use undo where safe: archive, simple state change, drag/move, simple
// bulk edits. Use confirmation for truly destructive actions." Before this, the app had
// neither - a personal task and a bookmark were both deleted by a single unconfirmed click,
// with no toast at all, so the only feedback that anything had happened was the row
// vanishing.
//
// THE MODEL IS ACT-THEN-OFFER-TO-REVERSE, not defer-then-commit. The alternative - hold the
// delete until the toast expires - reads better in theory and fails in practice: closing the
// tab, navigating away, or a crash all leave the action half-done, and the user is told it
// happened when it did not. Acting immediately means the database and the screen always
// agree; undo is then a second, ordinary write.
//
// That only works where the reverse is genuinely exact. For a row delete it is: the caller
// captures the whole row first and restores it *with its original id*, so nothing that
// referenced it is left dangling and the restored row is not a lookalike copy. Anything
// where the reverse is approximate does not belong here - it belongs behind a confirmation.
//
// The runner below is pure and takes its toast surface as an argument, so the once-only rule
// and the failure path are unit-testable without a DOM.

/** How long an undo stays offered. Long enough to notice the row vanish and react. */
export const UNDO_DURATION_MS = 8000

export interface UndoableResult {
  ok: boolean
  /** Present when the undo failed, for the caller to surface. */
  error?: string
}

/** The bit of sonner this module needs, narrowed so tests can pass a fake. */
export interface ToastSurface {
  success: (message: string, options?: ToastOptions) => void
  error: (message: string, options?: ToastOptions) => void
}

export interface ToastOptions {
  description?: string
  duration?: number
  action?: { label: string; onClick: () => void }
}

export interface UndoableToastOptions {
  /** What just happened, in the past tense: "Task deleted". */
  message: string
  description?: string
  undoLabel?: string
  durationMs?: number
  /**
   * Reverse it. Resolves `{ ok: true }` when the original state is back.
   *
   * Must be exact, not approximate - see the module header.
   */
  onUndo: () => Promise<UndoableResult> | UndoableResult
  /** Announced after a successful undo. Defaults to "Restored". */
  undoneMessage?: string
}

/**
 * Wrap an undo callback so it can only ever run once, and so a failed undo says so.
 *
 * Once-only matters because sonner's action button stays clickable while the toast animates
 * out, and a second restore of the same row is either a duplicate-key error or, worse, a
 * duplicate row. Returning early is quieter than either.
 */
export function createUndoHandler(
  toast: ToastSurface,
  { onUndo, undoneMessage = 'Restored' }: Pick<UndoableToastOptions, 'onUndo' | 'undoneMessage'>,
): () => Promise<void> {
  let used = false
  return async () => {
    if (used) return
    used = true
    let result: UndoableResult
    try {
      result = await onUndo()
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
    if (result.ok) {
      toast.success(undoneMessage)
    } else {
      // The row is still gone and the user needs to know that, not just that a click
      // failed. Naming the state is the difference between "retry" and "recreate it".
      toast.error('Couldn’t undo that', {
        description: result.error
          ? `${result.error}. The change is still applied.`
          : 'The change is still applied.',
      })
    }
  }
}

/**
 * Show a toast that offers to reverse what just happened.
 *
 * The toast surface is injected rather than imported so this stays testable; every caller in
 * the app passes sonner's `toast`.
 */
export function showUndoableToast(toast: ToastSurface, options: UndoableToastOptions): void {
  const {
    message,
    description,
    undoLabel = 'Undo',
    durationMs = UNDO_DURATION_MS,
  } = options

  // Built once, here - building it inside onClick would hand every click a fresh closure
  // with its own `used` flag, which is exactly the guard this is supposed to provide.
  const undo = createUndoHandler(toast, options)

  toast.success(message, {
    description,
    duration: durationMs,
    action: { label: undoLabel, onClick: () => void undo() },
  })
}
