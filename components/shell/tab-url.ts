// Pure helper for reconciling a tab from the URL (?tab=) with what's allowed on a
// given surface. Keeps the deep-link logic testable and identical across the user
// and admin dashboards. See docs/design/information-architecture.md (nav-state model).

/**
 * Resolve the active tab: prefer a valid ?tab= value, then a valid persisted value,
 * then the fallback. Unknown/absent values never win so a stale URL or storage entry
 * can't strand the user on a tab that doesn't exist for their role.
 */
export function resolveActiveTab(
  urlTab: string | null,
  savedTab: string | null,
  allowed: readonly string[],
  fallback: string
): string {
  if (urlTab && allowed.includes(urlTab)) return urlTab
  if (savedTab && allowed.includes(savedTab)) return savedTab
  return fallback
}
