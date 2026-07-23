import { describe, it, expect } from 'vitest'
import { hexToRgb, luminance, autoTextColor, withAlpha } from './color'

describe('color helpers', () => {
  it('parses hex into rgb channels', () => {
    expect(hexToRgb('#ffffff')).toEqual({ r: 255, g: 255, b: 255 })
    expect(hexToRgb('#000000')).toEqual({ r: 0, g: 0, b: 0 })
    expect(hexToRgb('#3366cc')).toEqual({ r: 0x33, g: 0x66, b: 0xcc })
  })

  it('computes weighted luminance', () => {
    expect(luminance({ r: 0, g: 0, b: 0 })).toBe(0)
    expect(luminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(255, 5)
    // Green is weighted most heavily.
    expect(luminance({ r: 0, g: 255, b: 0 })).toBeGreaterThan(
      luminance({ r: 0, g: 0, b: 255 })
    )
  })

  it('picks dark text on light backgrounds and light text on dark', () => {
    expect(autoTextColor('#ffffff')).toBe('#111111') // light bg → dark text
    expect(autoTextColor('#000000')).toBe('#ffffff') // dark bg → light text
    expect(autoTextColor('#111111')).toBe('#ffffff')
  })

  it('formats rgba with the given alpha', () => {
    expect(withAlpha('#3366cc', 0.5)).toBe('rgba(51,102,204,0.5)')
    expect(withAlpha('#000000', 1)).toBe('rgba(0,0,0,1)')
  })
})
