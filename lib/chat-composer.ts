/**
 * Pure rules for the chat composer.
 *
 * These live here rather than inline in `components/chat/chat-panel.tsx` because the touch
 * rule below is the kind of thing that regresses silently: a keyboard-only reviewer cannot
 * see it, and the failure mode is that a phone loses the ability to type a paragraph break,
 * which is the exact bug the composer was rewritten to fix.
 */

export interface ComposerKeyEvent {
  key: string
  shiftKey: boolean
  /** True while an IME is mid-composition, when Enter commits a candidate. */
  isComposing: boolean
  /** True on a touchscreen, from `matchMedia('(pointer: coarse)')`. */
  coarsePointer: boolean
}

/**
 * Whether a keypress in the composer should send the message.
 *
 * Enter sends on a keyboard, Shift+Enter types a newline. On a touchscreen Enter always types
 * a newline and the Send button is the only way to send: a thumb has no comfortable
 * Shift+Enter, so binding send to Enter there would leave no way to write the paragraph
 * breaks this composer exists to allow.
 *
 * Keyed on the pointer rather than the viewport, matching the rule `app/globals.css` already
 * uses for touch targets - a touchscreen laptop wants the touch behaviour and a narrow
 * desktop window does not.
 */
export function shouldSendOnKey({
  key,
  shiftKey,
  isComposing,
  coarsePointer,
}: ComposerKeyEvent): boolean {
  if (key !== 'Enter') return false
  if (shiftKey) return false
  if (coarsePointer) return false
  // An IME is choosing a candidate; this Enter belongs to the input method, not to us.
  if (isComposing) return false
  return true
}

/**
 * The composer's height for a given content height, capped so a long message scrolls inside
 * the box instead of pushing the message list off the screen.
 */
export function composerHeight(scrollHeight: number, max: number): number {
  if (!Number.isFinite(scrollHeight) || scrollHeight <= 0) return 0
  return Math.min(scrollHeight, max)
}
