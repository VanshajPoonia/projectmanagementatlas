'use client'

import { useEffect, useRef } from 'react'

// Dialog focus restoration.
//
// ATLAS_02 Prompt A and Prompt M both list it. It was not working: closing any dialog in this
// app left focus on `document.body`, so a keyboard or screen-reader user who opened a task
// from the middle of a board was returned to the top of the document and had to tab back
// through the entire page to find their place. Verified in a real browser, on a clean Escape
// close, before any of this slice's changes - it is a pre-existing defect, not a regression.
//
// WHY RADIX'S OWN RESTORE DOES NOT COVER IT HERE. Radix records `document.activeElement` when
// the dialog opens and re-focuses that exact node from `onCloseAutoFocus`. That works when the
// trigger is a `DialogTrigger` that stays mounted. In this codebase dialogs are driven by
// `open`/`onOpenChange` state on the host, so opening one re-renders the host, and the button
// that opened it is frequently a *new node* by the time the dialog closes. Focusing a detached
// element silently does nothing, and focus falls to body.
//
// The fix below is deliberately defensive rather than clever: remember the element, and on
// close put focus back only if it is still connected. When it is not - genuinely unavoidable
// if the trigger no longer exists - fall back to the main landmark, so a screen reader lands
// in page content rather than at the very top of the document. That is a worse outcome than
// the trigger and a much better one than body.

/**
 * Where focus goes when the original trigger no longer exists, in order of preference.
 *
 * `#app-main` is AppShell's own main element, which already carries `tabIndex={-1}` for the
 * skip link. Board pages render outside AppShell and have a plain `<main>` instead, which is
 * why the bare tag is listed too - an earlier version checked only `#app-main`, found nothing
 * on exactly the page where this matters most, and quietly left focus on body.
 */
const FALLBACK_SELECTORS = ['#app-main', 'main', '[role="main"]']

/** How often to look while the close animation finishes. */
const POLL_MS = 50
/** Give up waiting for a settled state and just restore. Radix's exit is ~200ms. */
const SETTLE_TIMEOUT_MS = 600

function isFocusable(el: Element | null | undefined): el is HTMLElement {
  return !!el && el instanceof HTMLElement && el.isConnected
}

/**
 * Focus a landmark. A `<main>` is not focusable by default, so give it `tabindex="-1"` first
 * - the standard skip-link technique. -1 keeps it out of the tab order; it only makes the
 * element a valid target for programmatic focus.
 */
function focusLandmark(): void {
  for (const selector of FALLBACK_SELECTORS) {
    const el = document.querySelector(selector)
    if (el instanceof HTMLElement) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1')
      el.focus()
      return
    }
  }
}

/**
 * Restore focus to whatever opened this dialog.
 *
 * Call from the component that owns the dialog's `open` state.
 *
 * ⚠️ TIMING IS THE WHOLE PROBLEM, and a double requestAnimationFrame is not enough. Radix
 * animates the dialog out over ~200ms, and until that finishes the dialog's own input is
 * still mounted and still holds focus. A check that runs two frames after close therefore
 * sees a perfectly healthy `activeElement`, concludes nothing is wrong, and does nothing -
 * and focus drops to `body` a moment later when the content finally unmounts. Measured
 * exactly that in a browser: INPUT#title at 100ms, BODY from 300ms onward.
 *
 * So this polls instead, and distinguishes the two endings it can see:
 *   - focus reached `body`            -> nobody caught it; restore.
 *   - focus is on something connected
 *     and outside any dialog          -> Radix or the user handled it; leave it alone.
 * Anything else means the close is still in flight, so keep waiting.
 */
export function useDialogFocusRestore(open: boolean): void {
  const trigger = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)

  useEffect(() => {
    if (typeof document === 'undefined') return

    if (open && !wasOpen.current) {
      // Opening: remember where we came from, unless focus is already nowhere.
      const active = document.activeElement
      trigger.current = isFocusable(active) && active !== document.body ? active : null
      wasOpen.current = true
      return
    }

    if (!open && wasOpen.current) {
      wasOpen.current = false
      const target = trigger.current
      trigger.current = null

      const restore = () => {
        if (isFocusable(target)) {
          target.focus()
          // focus() is a silent no-op on an element that is not focusable, which would leave
          // us on body having believed we succeeded. Check, and fall through if it did
          // nothing - this is also what covers a trigger that was re-rendered into a new node
          // while the dialog was open, which is the common case in this codebase.
          if (document.activeElement === target) return
        }
        focusLandmark()
      }

      let elapsed = 0
      const timer = setInterval(() => {
        elapsed += POLL_MS
        const active = document.activeElement

        if (!active || active === document.body) {
          clearInterval(timer)
          restore()
          return
        }
        // Still inside the dialog that is animating away - not settled yet.
        if (active.closest?.('[data-slot="dialog-content"]')) {
          if (elapsed >= SETTLE_TIMEOUT_MS) {
            clearInterval(timer)
            restore()
          }
          return
        }
        // Focus landed somewhere real and outside the dialog. Someone handled it; moving it
        // now would be the rude thing to do.
        clearInterval(timer)
      }, POLL_MS)

      return () => clearInterval(timer)
    }
  }, [open])
}
