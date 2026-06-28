// In-memory sliding-window rate limiter. Keyed by caller (admin user id) + route,
// so one admin hammering an endpoint can't be confused with another's normal usage.
//
// Limitation: state lives in the serverless function's own memory, so it resets on
// cold start and isn't shared across concurrent instances. That's an acceptable
// trade-off here — these routes already require an authenticated admin session, so
// this is defense-in-depth (caps runaway/scripted abuse from a single warm instance),
// not the only control. A durable limit would need a shared store (e.g. Upstash Redis).

const buckets = new Map<string, number[]>()

export function checkRateLimit(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now()
  const timestamps = (buckets.get(key) ?? []).filter((t) => now - t < windowMs)

  if (timestamps.length >= limit) {
    buckets.set(key, timestamps)
    return false
  }

  timestamps.push(now)
  buckets.set(key, timestamps)
  return true
}
