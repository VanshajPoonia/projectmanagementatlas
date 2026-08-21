import { describe, expect, it } from 'vitest'

import { composeDictation, foldSpeechResults } from './dictation'

const res = (transcript: string, isFinal: boolean) => ({ transcript, isFinal })

describe('composeDictation', () => {
  it('shows the live guess after what was already typed', () => {
    expect(composeDictation('Call the client', '', 'about the')).toBe('Call the client about the')
  })

  it('replaces the live guess rather than appending it, as the engine revises', () => {
    // The regression this pins: the old button appended every result, so a phrase the engine
    // re-sent five times while revising it landed in the field five times.
    const base = 'Notes:'
    expect(composeDictation(base, '', 'we should')).toBe('Notes: we should')
    expect(composeDictation(base, '', 'we should call')).toBe('Notes: we should call')
    expect(composeDictation(base, '', 'we should call Bobby')).toBe('Notes: we should call Bobby')
  })

  it('keeps finalized speech and puts the live guess after it', () => {
    expect(composeDictation('Notes:', 'we should call Bobby', 'tomorrow at')).toBe(
      'Notes: we should call Bobby tomorrow at',
    )
  })

  it('settles on finalized speech alone when the interim is dropped', () => {
    expect(composeDictation('Notes:', 'we should call Bobby', '')).toBe('Notes: we should call Bobby')
  })

  it('starts the field cleanly when it was empty', () => {
    expect(composeDictation('', '', 'hello there')).toBe('hello there')
    expect(composeDictation('', 'hello there', '')).toBe('hello there')
  })

  it('leaves the field untouched when nothing has been heard yet', () => {
    expect(composeDictation('Existing text', '', '')).toBe('Existing text')
    expect(composeDictation('', '', '')).toBe('')
  })

  it('does not double a space the user already typed', () => {
    expect(composeDictation('Existing text ', '', 'more')).toBe('Existing text more')
    expect(composeDictation('Existing text\n', '', 'more')).toBe('Existing text\nmore')
  })

  it('ignores whitespace-only speech', () => {
    expect(composeDictation('Existing', '   ', '  ')).toBe('Existing')
  })
})

describe('foldSpeechResults', () => {
  it('separates the committed phrase from the one still in flight', () => {
    const { finalText, interimText } = foldSpeechResults('', [res('call the client', true), res('about the', false)], 0)
    expect(finalText).toBe('call the client')
    expect(interimText).toBe('about the')
  })

  it('accumulates finals across events, because the engine stops resending them', () => {
    let final = ''
    ;({ finalText: final } = foldSpeechResults(final, [res('first phrase', true)], 0))
    ;({ finalText: final } = foldSpeechResults(final, [res('first phrase', true), res('second phrase', true)], 1))
    expect(final).toBe('first phrase second phrase')
  })

  it('reads only from resultIndex, so an already-reported phrase is not counted twice', () => {
    const { finalText } = foldSpeechResults('already reported', [res('already reported', true), res('new', true)], 1)
    expect(finalText).toBe('already reported new')
  })

  it('never carries an interim over from a previous event', () => {
    // Interim text is a guess about the present moment. Keeping a stale one would leave words
    // in the field that the engine has already withdrawn.
    const first = foldSpeechResults('', [res('umm', false)], 0)
    expect(first.interimText).toBe('umm')
    const second = foldSpeechResults(first.finalText, [res('actually go ahead', true)], 0)
    expect(second.interimText).toBe('')
    expect(second.finalText).toBe('actually go ahead')
  })

  it('survives an empty or out-of-range event without inventing text', () => {
    expect(foldSpeechResults('kept', [], 0)).toEqual({ finalText: 'kept', interimText: '' })
    expect(foldSpeechResults('kept', [res('  ', true)], 0)).toEqual({ finalText: 'kept', interimText: '' })
    expect(foldSpeechResults('kept', [res('x', true)], -3)).toEqual({ finalText: 'kept x', interimText: '' })
  })
})
