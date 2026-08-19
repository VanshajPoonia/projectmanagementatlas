export function hexToRgb(hex: string) {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  return { r, g, b }
}

export function luminance({ r, g, b }: { r: number; g: number; b: number }) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function autoTextColor(hex: string) {
  return luminance(hexToRgb(hex)) > 160 ? '#111111' : '#ffffff'
}

export function withAlpha(hex: string, a: number) {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${a})`
}

/* ── Contrast ─────────────────────────────────────────────────────────────────────────
 * User-chosen colours (a company's brand colour, a board's accent) get used directly as
 * *text* in places. That is fine on white and quietly illegible on #0a0a0a: SRG's pink
 * measured 4.19:1 against the dark canvas, under the 4.5:1 AA floor for body text. These
 * helpers keep the hue the user picked and move only its lightness until it clears the bar.
 */

/** WCAG relative luminance. Note this is gamma-corrected, unlike `luminance` above. */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex)
  const [rs, gs, bs] = [r, g, b].map(v => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/** WCAG contrast ratio between two hex colours: 1 (identical) to 21 (black on white). */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function rgbToHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)))
  return `#${[r, g, b].map(v => clamp(v).toString(16).padStart(2, '0')).join('')}`
}

/**
 * `foreground` at `alpha` painted over `background`, as an opaque hex.
 *
 * Needed because these surfaces are tinted rather than filled: a channel chip is the company
 * colour at 8% over the card, so the colour a label actually sits on is neither the company
 * colour nor the card. Measuring contrast against either one gets the wrong answer - which is
 * exactly how a 4.19:1 label read as "fine" for so long.
 */
export function compositeOver(foreground: string, alpha: number, background: string): string {
  const f = hexToRgb(foreground)
  const b = hexToRgb(background)
  const a = Math.max(0, Math.min(1, alpha))
  return rgbToHex(f.r * a + b.r * (1 - a), f.g * a + b.g * (1 - a), f.b * a + b.b * (1 - a))
}

/**
 * The same colour, lightened or darkened just enough to be readable on `background`.
 *
 * Hue and saturation are preserved - the point is that SRG still looks like SRG - and only
 * lightness moves, one step at a time toward whichever end of the scale the background is
 * not. Returns the input unchanged when it already passes, and gives up gracefully at pure
 * white/black rather than looping.
 */
export function readableInk(hex: string, background: string, minRatio = 4.5): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(hex) || !/^#[0-9a-fA-F]{6}$/.test(background)) return hex
  if (contrastRatio(hex, background) >= minRatio) return hex

  // Move away from the background: lighten on a dark ground, darken on a light one.
  const towardWhite = relativeLuminance(background) < 0.5
  let { r, g, b } = hexToRgb(hex)

  for (let i = 0; i < 24; i++) {
    r = towardWhite ? r + (255 - r) * 0.12 : r * 0.88
    g = towardWhite ? g + (255 - g) * 0.12 : g * 0.88
    b = towardWhite ? b + (255 - b) * 0.12 : b * 0.88
    const next = rgbToHex(r, g, b)
    if (contrastRatio(next, background) >= minRatio) return next
  }
  return towardWhite ? '#ffffff' : '#000000'
}
