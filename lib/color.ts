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
