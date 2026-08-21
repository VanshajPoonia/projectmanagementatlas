import { describe, expect, it } from 'vitest'

import { composerHeight, shouldSendOnKey } from './chat-composer'

const key = (over: Partial<Parameters<typeof shouldSendOnKey>[0]> = {}) => ({
  key: 'Enter',
  shiftKey: false,
  isComposing: false,
  coarsePointer: false,
  ...over,
})

describe('shouldSendOnKey', () => {
  it('sends on a bare Enter with a keyboard', () => {
    expect(shouldSendOnKey(key())).toBe(true)
  })

  it('types a newline on Shift+Enter rather than sending', () => {
    expect(shouldSendOnKey(key({ shiftKey: true }))).toBe(false)
  })

  it('ignores every other key', () => {
    for (const k of ['a', ' ', 'Tab', 'Escape', 'ArrowUp', 'Backspace']) {
      expect(shouldSendOnKey(key({ key: k }))).toBe(false)
    }
  })

  it('never sends on Enter on a touchscreen', () => {
    // The regression this pins: binding send to Enter on a phone leaves a thumb no way to
    // type a paragraph break, which is the original bug reappearing on mobile.
    expect(shouldSendOnKey(key({ coarsePointer: true }))).toBe(false)
    expect(shouldSendOnKey(key({ coarsePointer: true, shiftKey: true }))).toBe(false)
  })

  it('does not send while an IME is composing', () => {
    expect(shouldSendOnKey(key({ isComposing: true }))).toBe(false)
  })
})

describe('composerHeight', () => {
  it('grows with the content', () => {
    expect(composerHeight(38, 160)).toBe(38)
    expect(composerHeight(96, 160)).toBe(96)
  })

  it('caps at the maximum so the message list is not pushed off screen', () => {
    expect(composerHeight(400, 160)).toBe(160)
  })

  it('treats an unmeasurable box as zero rather than writing NaN into a style', () => {
    expect(composerHeight(0, 160)).toBe(0)
    expect(composerHeight(Number.NaN, 160)).toBe(0)
    expect(composerHeight(-10, 160)).toBe(0)
  })
})
