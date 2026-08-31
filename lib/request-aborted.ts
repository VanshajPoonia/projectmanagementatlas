// Is this "error" just a request we stopped caring about?
//
// ⚠️ Supabase-js aborts its in-flight fetches when a component unmounts or the page navigates,
// and PostgREST surfaces that as an ordinary error object. Logging it as a failure is wrong in
// two ways: nothing failed, and a console that cries wolf is a console people stop reading.
//
// It is not only cosmetic. The agile browser harness asserts zero console errors, and opening a
// work item and navigating away reliably produced "[v0] Failed to load comments: AbortError" -
// a red herring that has to be triaged as a real defect every time it appears, because from the
// outside a genuine load failure looks identical.

// ⚠️ Only a deliberate abort. `TimeoutError` was in this set for one draft and does NOT belong:
// a timed-out request genuinely did not complete, the viewer is looking at stale or empty data,
// and that is exactly the thing a console error should still say. The whole risk of this helper
// is hiding something real, so it stays as narrow as it can be.
const ABORT_NAMES = new Set(['AbortError'])

export function isRequestAborted(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const e = error as { name?: unknown; code?: unknown; message?: unknown; details?: unknown }
  if (typeof e.name === 'string' && ABORT_NAMES.has(e.name)) return true
  // supabase-js wraps the DOMException, so the name survives only inside the text. Both fields
  // are checked because which one carries it depends on the transport that failed.
  const text = `${typeof e.message === 'string' ? e.message : ''} ${typeof e.details === 'string' ? e.details : ''}`
  return /\bAbortError\b/.test(text) || /signal is aborted/i.test(text)
}
