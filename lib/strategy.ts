// The SWOT canvas, and the scope it is written at.
//
// Prompt H: "Only add canvases that users will actually use... Do not build a whiteboard
// engine merely to claim parity." Migration 131's header records which of the four candidate
// canvases were built and which were refused, and why. This file is the four buckets and
// nothing more - there are no coordinates anywhere in it, because a SWOT is four lists and
// drawing it as a diagram adds an engine and no information.
//
// No React, no Supabase.

export type CanvasKey = 'swot'
export type SwotBucket = 'strength' | 'weakness' | 'opportunity' | 'threat'

export const SWOT_BUCKETS: SwotBucket[] = ['strength', 'weakness', 'opportunity', 'threat']

export const SWOT_LABELS: Record<SwotBucket, string> = {
  strength: 'Strengths',
  weakness: 'Weaknesses',
  opportunity: 'Opportunities',
  threat: 'Threats',
}

/**
 * The prompts under each heading. They exist because "Weaknesses" on its own is answered with
 * platitudes, and the difference between a useful SWOT and a decorative one is entirely in
 * whether people knew what was being asked.
 */
export const SWOT_PROMPTS: Record<SwotBucket, string> = {
  strength: 'What do we already do better than the people we compete with?',
  weakness: 'What do we know is not good enough, that is ours to fix?',
  opportunity: 'What is changing outside that we could take advantage of?',
  threat: 'What is changing outside that could hurt us if we do nothing?',
}

/** Internal versus external, which is the axis that makes the grid mean anything. */
export const SWOT_ORIGIN: Record<SwotBucket, 'internal' | 'external'> = {
  strength: 'internal',
  weakness: 'internal',
  opportunity: 'external',
  threat: 'external',
}

export interface StrategyItemRow {
  id: string
  board_id?: string | null
  canvas: CanvasKey
  bucket: SwotBucket
  body: string
  position?: number | null
  created_by?: string | null
  created_at?: string | null
}

/** board_id NULL means the whole organisation - see migration 131. */
export function itemsForScope(items: StrategyItemRow[], boardId: string | null): StrategyItemRow[] {
  return items.filter((item) => (item.board_id ?? null) === boardId)
}

export function itemsInBucket(items: StrategyItemRow[], bucket: SwotBucket): StrategyItemRow[] {
  return items
    .filter((item) => item.bucket === bucket)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0) || (a.created_at ?? '').localeCompare(b.created_at ?? ''))
}

export function scopeLabel(boardId: string | null, boardTitle?: string | null): string {
  if (!boardId) return 'Whole organisation'
  return boardTitle ?? 'A project you cannot see'
}
