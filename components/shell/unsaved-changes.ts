'use client'

import { useEffect, useMemo } from 'react'

// Unsaved-change protection.
//
// ATLAS_02 Prompt A lists this as one of the items to verify; nothing in the app had it.
// The create-task dialog is the clearest loss: title, description, assignees, links, tags
// and a first comment, all discarded by Escape or a stray click outside, with no warning
// and no way back.
//
// Two separate exits need covering and they are not the same problem:
//
//   1. Leaving the *page* - tab close, reload, back button. Only the browser can intercept
//      this, via `beforeunload`, and modern browsers deliberately ignore any custom message
//      and show their own. That is fine; the point is the interception, not the wording.
//
//   2. Closing the *dialog* - Escape, the X, a click on the overlay. The browser knows
//      nothing about this, so the dialog has to ask.
//
// WHY window.confirm FOR (2). `@radix-ui/react-alert-dialog` is in package.json but no
// `components/ui/alert-dialog.tsx` wrapper exists, so this would mean introducing a new
// primitive - and then nesting it inside an already-open Dialog, which puts two focus traps
// in competition. That is the well-known source of "the confirm renders behind the modal"
// and "focus is lost when the inner one closes". A native confirm is plain, but it is modal,
// keyboard-operable, screen-reader-announced and impossible to dismiss by accident, which is
// exactly the job here. It is injected rather than called directly, so it is testable now
// and swappable later without touching a single call site.

/**
 * Shallow dirty check between the current form values and the values it opened with.
 *
 * Shallow is deliberate. The alternative - a deep structural compare - quietly turns
 * "the user retyped the same word" into a change, and worse, reports a *reordered* array as
 * clean if you sort it or dirty if you don't. Arrays are compared element-wise in order,
 * which is what a list of assignees or links actually means.
 *
 * Empty string, null and undefined are treated as the same "nothing here", because an input
 * that has been focused and cleared is not a change worth blocking a close over.
 */
export function isDirty(
  current: Record<string, unknown>,
  initial: Record<string, unknown>,
): boolean {
  const keys = new Set([...Object.keys(current), ...Object.keys(initial)])
  for (const key of keys) {
    if (!valuesEqual(current[key], initial[key])) return true
  }
  return false
}

function blank(value: unknown): boolean {
  return value === null || value === undefined || value === ''
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (blank(a) && blank(b)) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false
    if (a.length !== b.length) return false
    return a.every((item, i) => valuesEqual(item, b[i]))
  }
  if (a instanceof Date || b instanceof Date) {
    if (!(a instanceof Date) || !(b instanceof Date)) return false
    return a.getTime() === b.getTime()
  }
  // Objects inside a form field (a tag, a link) are compared by their JSON, which is exact
  // enough for values this shallow and avoids pulling in a deep-equal dependency.
  if (typeof a === 'object' && typeof b === 'object' && a !== null && b !== null) {
    return JSON.stringify(a) === JSON.stringify(b)
  }
  return a === b
}

export const DISCARD_PROMPT =
  'You have unsaved changes. Close anyway and lose them?'

/**
 * Wrap a Radix `onOpenChange` so closing while dirty asks first.
 *
 * Opening is never guarded - only the close transition is, and only when there is something
 * to lose. Returns the original handler untouched when the form is clean, so the common case
 * costs nothing.
 */
export function guardedOpenChange(
  dirty: boolean,
  onOpenChange: (open: boolean) => void,
  confirm: (message: string) => boolean = defaultConfirm,
  message: string = DISCARD_PROMPT,
): (open: boolean) => void {
  return (open: boolean) => {
    if (open || !dirty) {
      onOpenChange(open)
      return
    }
    if (confirm(message)) onOpenChange(false)
  }
}

function defaultConfirm(message: string): boolean {
  if (typeof window === 'undefined') return true
  return window.confirm(message)
}

/**
 * Warn before the browser navigates away from unsaved work.
 *
 * `preventDefault()` plus a non-empty `returnValue` is the combination that still works
 * across current browsers; the string itself is discarded, so it is a marker rather than a
 * message. The listener is removed as soon as the form is clean, which matters - leaving it
 * attached would prompt on every navigation for the rest of the session.
 */
export function useBeforeUnload(dirty: boolean): void {
  useEffect(() => {
    if (!dirty || typeof window === 'undefined') return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])
}

/**
 * The pair, for a dialog: warn on page-exit and guard the dialog's own close.
 *
 * `confirm` is exposed for tests and for the day this repo grows a proper AlertDialog.
 */
export function useUnsavedChanges(
  dirty: boolean,
  onOpenChange: (open: boolean) => void,
  confirm?: (message: string) => boolean,
) {
  useBeforeUnload(dirty)
  return useMemo(
    () => guardedOpenChange(dirty, onOpenChange, confirm),
    [dirty, onOpenChange, confirm],
  )
}
