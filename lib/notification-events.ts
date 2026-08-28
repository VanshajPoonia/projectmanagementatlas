// A one-line channel between the Inbox screen and the unread badge in the topbar.
//
// ⚠️ THIS EXISTS BECAUSE A BADGE THAT DISAGREES WITH THE PAGE IS WORSE THAN NO BADGE. The bell
// lives in AppTopbar and the inbox content is a sibling several levels down, with no shared
// state between them, so marking everything read left the page empty and the bell still saying
// 3 until its next two-minute poll. Measured in a real browser, not reasoned about.
//
// A DOM event rather than a context provider or a store: the two components are in different
// trees on some routes (a board renders outside AppShell entirely), one of them is optional,
// and neither needs to know the other exists. Nothing is passed - the listener refetches, so
// there is no second copy of the count that could itself go stale.

export const INBOX_CHANGED_EVENT = 'atlas:inbox-changed'

/** Say that this person's notifications changed. Safe to call on the server; it does nothing. */
export function notifyInboxChanged() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(INBOX_CHANGED_EVENT))
}
