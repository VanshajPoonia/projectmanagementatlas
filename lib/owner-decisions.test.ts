import { describe, it, expect } from 'vitest'
import {
  closedDecisions, closureRejectionReason, decisionRejectionReason, openDecisions, sortDecisions,
  DECISION_STATUS_LABEL, type OwnerDecision,
} from './owner-decisions'

const d = (over: Partial<OwnerDecision>): OwnerDecision => ({
  id: over.id ?? 'x', title: 'T', summary: 'S', detail: null, recommendation: null,
  status: 'open', resolution_note: null, resolved_by: null, resolved_at: null,
  position: 0, created_at: '2026-01-01T00:00:00Z', ...over,
})

describe('sortDecisions', () => {
  it('puts what is waiting on somebody above what is already settled', () => {
    // The whole reason this screen exists is that open items get lost. A resolved decision
    // sorting above an open one would recreate exactly that.
    const rows = [
      d({ id: 'closed', status: 'resolved', position: 1 }),
      d({ id: 'open', status: 'open', position: 9 }),
    ]
    expect(sortDecisions(rows).map((r) => r.id)).toEqual(['open', 'closed'])
  })

  it('treats dismissed as settled, not as waiting', () => {
    const rows = [d({ id: 'dismissed', status: 'dismissed' }), d({ id: 'open' })]
    expect(openDecisions(rows).map((r) => r.id)).toEqual(['open'])
    expect(closedDecisions(rows).map((r) => r.id)).toEqual(['dismissed'])
  })

  it('honours the order somebody gave them, then falls back to oldest first', () => {
    const rows = [
      d({ id: 'c', position: 5, created_at: '2026-01-03T00:00:00Z' }),
      d({ id: 'a', position: 1 }),
      d({ id: 'b', position: 5, created_at: '2026-01-02T00:00:00Z' }),
    ]
    expect(sortDecisions(rows).map((r) => r.id)).toEqual(['a', 'b', 'c'])
  })

  it('does not mutate its input', () => {
    const rows = [d({ id: 'b', position: 2 }), d({ id: 'a', position: 1 })]
    sortDecisions(rows)
    expect(rows.map((r) => r.id)).toEqual(['b', 'a'])
  })
})

describe('closureRejectionReason', () => {
  it('refuses to close a decision with no note', () => {
    // Mirrors migration 128's trigger. The trigger stays the authority; this only lets the
    // dialog say so before the round-trip.
    expect(closureRejectionReason('')).toBeTruthy()
    expect(closureRejectionReason('   ')).toBeTruthy()
  })

  it('accepts a real note', () => {
    expect(closureRejectionReason('Turned it on for the marketing board first.')).toBeNull()
  })

  it('refuses one longer than the column allows', () => {
    expect(closureRejectionReason('x'.repeat(4001))).toBeTruthy()
    expect(closureRejectionReason('x'.repeat(4000))).toBeNull()
  })
})

describe('decisionRejectionReason', () => {
  it('needs a title and a one-line summary', () => {
    expect(decisionRejectionReason({ title: '', summary: 'S' })).toBeTruthy()
    expect(decisionRejectionReason({ title: 'T', summary: '  ' })).toBeTruthy()
    expect(decisionRejectionReason({ title: 'T', summary: 'S' })).toBeNull()
  })

  it('enforces the same bounds the columns do', () => {
    expect(decisionRejectionReason({ title: 'x'.repeat(201), summary: 'S' })).toBeTruthy()
    expect(decisionRejectionReason({ title: 'T', summary: 'x'.repeat(501) })).toBeTruthy()
  })
})

describe('the wording', () => {
  it('says "waiting on you", not "open"', () => {
    // A status label is the only thing most readers will read. "Open" is schema vocabulary.
    expect(DECISION_STATUS_LABEL.open).toBe('Waiting on you')
  })

  it('does not call a dismissed decision rejected', () => {
    // A decision can stop being worth making without anyone having judged it badly, and a label
    // implying a verdict makes people leave things open rather than close them honestly.
    expect(DECISION_STATUS_LABEL.dismissed.toLowerCase()).not.toContain('reject')
  })
})
