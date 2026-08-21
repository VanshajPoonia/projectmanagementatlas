/**
 * The shape of a marketing calendar as every screen consumes it, plus the one query that
 * produces it.
 *
 * Framework-free on purpose: `lib/shell-data.ts` runs inside a Server Component and may not
 * import `lib/use-marketing-calendars.ts`, which reaches `useState` and the browser Supabase
 * client. Same split, and the same reason, as `lib/module-registry.ts` vs `lib/modules.ts`.
 * `use-marketing-calendars.ts` re-exports the type, so no existing import site changed.
 */
export interface MarketingCalendarSummary {
  id: string
  name: string
  color: string
  is_archived: boolean
  /**
   * Who holds an explicit `marketing_calendar_members` row on this calendar.
   *
   * RLS (085) shows a member their own row and shows an admin the whole roster, so this is
   * complete for an admin and, for everyone else, exactly "my own membership or nothing" -
   * which is all `resolveSelectedCalendarId` asks of it. It is never evidence that a calendar
   * has no other members.
   */
  member_user_ids: string[]
}

export const MARKETING_CALENDAR_SELECT =
  'id, name, color, is_archived, marketing_calendar_members(user_id)'

/** Flattens the embedded membership rows PostgREST returns into a plain id list. */
export function toMarketingCalendarSummaries(rows: unknown): MarketingCalendarSummary[] {
  if (!Array.isArray(rows)) return []
  return rows.map((row: any) => ({
    id: row.id,
    name: row.name,
    color: row.color,
    is_archived: row.is_archived,
    member_user_ids: Array.isArray(row.marketing_calendar_members)
      ? row.marketing_calendar_members.map((m: any) => m?.user_id).filter(Boolean)
      : [],
  }))
}
