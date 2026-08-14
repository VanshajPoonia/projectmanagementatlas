import { describe, expect, it } from 'vitest'
import { autoTextColor, compositeOver, contrastRatio, readableInk, relativeLuminance, withAlpha } from './color'

const DARK_CANVAS = '#0a0a0a'
const LIGHT_CANVAS = '#ffffff'

describe('contrastRatio', () => {
  it('is 21:1 for black on white and 1:1 for a colour on itself', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 1)
    expect(contrastRatio('#e91e8c', '#e91e8c')).toBeCloseTo(1, 5)
  })

  it('is symmetric', () => {
    expect(contrastRatio('#2563eb', '#ffffff')).toBeCloseTo(contrastRatio('#ffffff', '#2563eb'), 10)
  })
})

describe('relativeLuminance', () => {
  it('anchors at the ends of the scale', () => {
    expect(relativeLuminance('#000000')).toBeCloseTo(0, 5)
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 5)
  })
})

describe('readableInk', () => {
  // The case that prompted this. The label is NOT on the raw canvas — the chip paints the
  // company colour at 8% over the card first, and that tint is what lightens the ground and
  // drags contrast down to the 4.19:1 the browser measured.
  it('lifts SRG pink to AA on its own tinted chip', () => {
    const chip = compositeOver('#e91e8c', 0.08, '#141414')
    expect(contrastRatio('#e91e8c', chip)).toBeLessThan(4.5)
    const fixed = readableInk('#e91e8c', chip)
    expect(contrastRatio(fixed, chip)).toBeGreaterThanOrEqual(4.5)
  })

  it('confirms the raw canvas was never the problem', () => {
    // Measuring against #0a0a0a says "passes" and hides the defect — the regression guard.
    expect(contrastRatio('#e91e8c', DARK_CANVAS)).toBeGreaterThan(4.5)
  })

  it('leaves a colour alone when it already passes', () => {
    const already = '#f5a3d0'
    expect(contrastRatio(already, DARK_CANVAS)).toBeGreaterThanOrEqual(4.5)
    expect(readableInk(already, DARK_CANVAS)).toBe(already)
  })

  it('darkens rather than lightens on a light canvas', () => {
    const fixed = readableInk('#ffd400', LIGHT_CANVAS)
    expect(relativeLuminance(fixed)).toBeLessThan(relativeLuminance('#ffd400'))
    expect(contrastRatio(fixed, LIGHT_CANVAS)).toBeGreaterThanOrEqual(4.5)
  })

  it('keeps the hue recognisable rather than collapsing to grey', () => {
    const fixed = readableInk('#e91e8c', DARK_CANVAS)
    const { r, g, b } = { r: parseInt(fixed.slice(1, 3), 16), g: parseInt(fixed.slice(3, 5), 16), b: parseInt(fixed.slice(5, 7), 16) }
    // still magenta-dominant: red and blue clearly above green
    expect(r).toBeGreaterThan(g)
    expect(b).toBeGreaterThan(g)
  })

  it('meets a custom ratio when asked for the 3:1 large-text floor', () => {
    const fixed = readableInk('#7c3aed', DARK_CANVAS, 3)
    expect(contrastRatio(fixed, DARK_CANVAS)).toBeGreaterThanOrEqual(3)
  })

  it('returns malformed input untouched instead of throwing', () => {
    expect(readableInk('nope', DARK_CANVAS)).toBe('nope')
    expect(readableInk('#fff', DARK_CANVAS)).toBe('#fff')
  })

  it('terminates on an impossible request', () => {
    // 21:1 is only reachable by pure black on pure white; this must give up, not hang.
    expect(readableInk('#808080', '#7f7f7f', 21)).toMatch(/^#(ffffff|000000)$/)
  })
})

describe('existing helpers still behave', () => {
  it('autoTextColor picks ink for light swatches and white for dark ones', () => {
    expect(autoTextColor('#fff842')).toBe('#111111')
    expect(autoTextColor('#111111')).toBe('#ffffff')
  })

  it('withAlpha builds an rgba string', () => {
    expect(withAlpha('#e91e8c', 0.08)).toBe('rgba(233,30,140,0.08)')
  })
})
