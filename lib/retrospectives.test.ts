import { describe, it, expect } from 'vitest'
import {
  RETRO_TEMPLATES, RETRO_TEMPLATE_COLUMNS, retroColumns, retroColumnLabel,
  notesForColumn, groupNotes, canEditNote, canDeleteNote, retroBlockedReason, summarizeRetro,
  ANONYMITY_PROMISE, ANONYMITY_RESIDUAL,
  type RetroNoteRow, type RetroGroupRow, type RetrospectiveRow, type RetroActionRow,
} from './retrospectives'

const retro = (over: Partial<RetrospectiveRow> = {}): RetrospectiveRow => ({
  id: 'r1', board_id: 'b1', title: 'Retro', template: 'what_went_well',
  is_anonymous: false, state: 'open', created_at: '2026-09-01T00:00:00Z', ...over,
})

const note = (over: Partial<RetroNoteRow> = {}): RetroNoteRow => ({
  id: over.id ?? 'n1', retro_id: 'r1', column_key: over.column_key ?? 'well',
  body: over.body ?? 'something', vote_count: over.vote_count ?? 0,
  created_at: over.created_at ?? '2026-09-01T00:00:00Z', ...over,
})

describe('templates', () => {
  it('every template declares its columns', () => {
    for (const template of RETRO_TEMPLATES) {
      expect(RETRO_TEMPLATE_COLUMNS[template].length).toBeGreaterThan(0)
    }
  })

  it('every column key has a human label, or a retro renders a raw key', () => {
    for (const template of RETRO_TEMPLATES) {
      for (const key of RETRO_TEMPLATE_COLUMNS[template]) {
        expect(retroColumnLabel(key)).not.toBe(key)
      }
    }
  })

  it('falls back to the one-list template rather than rendering no columns at all', () => {
    expect(retroColumns('not_a_template' as never)).toEqual(['notes'])
  })

  it('renders an unknown key as itself rather than blank', () => {
    expect(retroColumnLabel('mystery')).toBe('mystery')
  })
})

describe('ordering never leaks who wrote what', () => {
  it('sorts by votes then creation time, never by author or id', () => {
    const notes = [
      note({ id: 'z', vote_count: 1, created_at: '2026-09-01T00:00:00Z', author_id: 'u1' }),
      note({ id: 'a', vote_count: 3, created_at: '2026-09-02T00:00:00Z', author_id: 'u2' }),
      note({ id: 'm', vote_count: 1, created_at: '2026-09-03T00:00:00Z', author_id: 'u1' }),
    ]
    expect(notesForColumn(notes, 'well').map((n) => n.id)).toEqual(['a', 'z', 'm'])
  })

  it('only returns notes for the column asked for', () => {
    const notes = [note({ id: 'a', column_key: 'well' }), note({ id: 'b', column_key: 'not_well' })]
    expect(notesForColumn(notes, 'not_well').map((n) => n.id)).toEqual(['b'])
  })
})

describe('grouping is what makes five weak signals read as one strong one', () => {
  const groups: RetroGroupRow[] = [{ id: 'g1', retro_id: 'r1', title: 'Handoffs', position: 0 }]

  it('weighs a theme by the sum of its notes votes', () => {
    const notes = [
      note({ id: 'a', group_id: 'g1', vote_count: 2 }),
      note({ id: 'b', group_id: 'g1', vote_count: 3 }),
      note({ id: 'c', vote_count: 4 }),
    ]
    const grouped = groupNotes(notes, groups)
    expect(grouped[0].group?.id).toBe('g1')
    expect(grouped[0].votes).toBe(5)
  })

  it('always puts ungrouped notes last', () => {
    const notes = [note({ id: 'loose', vote_count: 99 }), note({ id: 'themed', group_id: 'g1', vote_count: 1 })]
    const grouped = groupNotes(notes, groups)
    expect(grouped[grouped.length - 1].group).toBeNull()
  })

  it('treats a note pointing at a group it did not receive as ungrouped rather than dropping it', () => {
    const grouped = groupNotes([note({ id: 'orphan', group_id: 'missing' })], groups)
    const all = grouped.flatMap((g) => g.notes.map((n) => n.id))
    expect(all).toContain('orphan')
  })

  it('returns nothing at all for an empty retro rather than an empty theme', () => {
    expect(groupNotes([], groups)).toEqual([])
  })
})

describe('who may do what', () => {
  const anon = retro({ is_anonymous: true })

  it('lets the author edit an anonymous note, which author_id could never have told us', () => {
    // ⚠️ The regression this pins: deriving "mine" from author_id would make every anonymous
    // note uneditable by its own author - a UI stricter than its policy, taking an ability
    // away from exactly the people the design was built to serve.
    const mine = note({ id: 'n1', author_id: null })
    expect(canEditNote(mine, new Set(['n1']), anon)).toBe(true)
    expect(canEditNote(mine, new Set(), anon)).toBe(false)
  })

  it('stops all editing once the retro is closed', () => {
    expect(canEditNote(note({ id: 'n1' }), new Set(['n1']), retro({ state: 'closed' }))).toBe(false)
  })

  it('lets an admin remove somebody elses note but never edit it', () => {
    const theirs = note({ id: 'n2' })
    expect(canDeleteNote(theirs, new Set(), true)).toBe(true)
    expect(canEditNote(theirs, new Set(), retro())).toBe(false)
  })

  it('refuses a non-admin any hold over somebody elses note', () => {
    expect(canDeleteNote(note({ id: 'n2' }), new Set(), false)).toBe(false)
  })
})

describe('unavailable actions say why', () => {
  it('explains a closed retrospective rather than showing a dead control', () => {
    expect(retroBlockedReason(retro({ state: 'closed' }))).toContain('closed')
  })

  it('explains that there is nothing selected yet', () => {
    expect(retroBlockedReason(null)).toContain('Pick or create')
  })

  it('returns null when the action really is available', () => {
    expect(retroBlockedReason(retro())).toBeNull()
  })
})

describe('the anonymity promise states both halves', () => {
  it('says nobody can look the author up, admins included', () => {
    expect(ANONYMITY_PROMISE).toContain('including admins')
  })

  it('admits the one thing no setting can fix', () => {
    // Over-trusting a privacy feature is worse than not having it. The residual is product
    // copy, not a code comment, because the person deciding whether to speak up reads the UI.
    expect(ANONYMITY_RESIDUAL).toContain('order they appear in')
  })
})

describe('summary', () => {
  it('counts notes, votes, actions and how many became real work', () => {
    const notes = [note({ id: 'a', vote_count: 2 }), note({ id: 'b', vote_count: 1 })]
    const actions: RetroActionRow[] = [
      { id: 'x', retro_id: 'r1', body: 'do', created_at: '2026-09-01T00:00:00Z', converted_at: '2026-09-02T00:00:00Z' },
      { id: 'y', retro_id: 'r1', body: 'later', created_at: '2026-09-01T00:00:00Z' },
    ]
    const s = summarizeRetro(notes, [], actions)
    expect(s).toMatchObject({ notes: 2, votes: 3, actions: 2, convertedActions: 1 })
  })
})
