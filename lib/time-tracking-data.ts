// Reads and writes for the topbar timer. Every write asks for its rows back (lib/rls-write.ts).

import { classifyWrite, type WriteOutcome } from './rls-write'
import { isModuleEnabled, type AppModule } from './module-registry'
import type { TimeEntry } from './time-tracking'

type Client = { from: (table: string) => any }

const COLUMNS = 'id, started_at, ended_at, note'
const UNIQUE_VIOLATION = '23505'

export type LoadResult =
  | { kind: 'off' }
  | { kind: 'ready'; entries: TimeEntry[] }
  | { kind: 'error'; error: unknown }

export async function loadTimeTracking(supabase: Client, userId: string): Promise<LoadResult> {
  const modules = await supabase.from('app_modules').select('module_key, enabled')
  if (modules.error) return { kind: 'error', error: modules.error }
  if (!isModuleEnabled((modules.data ?? []) as AppModule[], 'time_tracking')) return { kind: 'off' }

  const entries = await supabase
    .from('time_entries')
    .select(COLUMNS)
    .eq('user_id', userId)
    .order('started_at', { ascending: false })
    .limit(2000)
  if (entries.error) return { kind: 'error', error: entries.error }
  return { kind: 'ready', entries: (entries.data ?? []) as TimeEntry[] }
}

export type StartResult =
  | { kind: 'ok'; entry: TimeEntry }
  | { kind: 'already-running' }
  | { kind: 'error'; message: string }

export async function startTimer(supabase: Client, userId: string, note: string | null): Promise<StartResult> {
  const { data, error } = await supabase
    .from('time_entries')
    .insert({ user_id: userId, started_at: new Date().toISOString(), note })
    .select(COLUMNS)
  // The partial unique index allows one running entry, so another tab got there first.
  if (error?.code === UNIQUE_VIOLATION) return { kind: 'already-running' }
  if (error) return { kind: 'error', message: error.message }
  if (!data?.length) return { kind: 'error', message: 'The timer did not start. Reload and try again.' }
  return { kind: 'ok', entry: data[0] as TimeEntry }
}

export async function stopTimer(supabase: Client, entry: TimeEntry): Promise<WriteOutcome> {
  // Never before the start, so a device clock running behind cannot trip the CHECK.
  const endedAt = new Date(Math.max(Date.now(), Date.parse(entry.started_at))).toISOString()
  const result = await supabase
    .from('time_entries')
    .update({ ended_at: endedAt })
    .eq('id', entry.id)
    .is('ended_at', null)
    .select('id')
  return classifyWrite(result)
}

export async function saveNote(supabase: Client, id: string, note: string | null): Promise<WriteOutcome> {
  const result = await supabase.from('time_entries').update({ note }).eq('id', id).select('id')
  return classifyWrite(result)
}

export async function deleteEntry(supabase: Client, id: string): Promise<WriteOutcome> {
  const result = await supabase.from('time_entries').delete().eq('id', id).select('id')
  return classifyWrite(result)
}

export async function restoreEntry(supabase: Client, userId: string, entry: TimeEntry): Promise<WriteOutcome> {
  const result = await supabase
    .from('time_entries')
    .insert({ ...entry, user_id: userId })
    .select('id')
  return classifyWrite(result)
}
