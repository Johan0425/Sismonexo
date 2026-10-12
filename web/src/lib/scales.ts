// Escalas de color científicas (perceptualmente uniformes y aptas para daltonismo) y clases de probabilidad.

const RAMPS = {
  viridis: ['#440154', '#472d7b', '#3b528b', '#2c728e', '#21918c', '#28ae80', '#5ec962', '#addc30', '#fde725'],
  cividis: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8678', '#a59c74', '#c3b369', '#e1cc55', '#fee838'],
  inferno: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'],
  // Divergente azul–neutro–ocre: solo para diferencias (cambio frente al periodo anterior).
  diverging: ['#1f5c99', '#5b8fc0', '#a9c3dc', '#eeeeea', '#e3bf94', '#c98a45', '#9a5a12'],
} as const
export type RampName = keyof typeof RAMPS

const hex = (h: string) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')

export function ramp(name: RampName, t: number): string {
  const stops = RAMPS[name]
  const x = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0)) * (stops.length - 1)
  const i = Math.min(stops.length - 2, Math.floor(x))
  const a = hex(stops[i])
  const b = hex(stops[i + 1])
  return toHex(a.map((v, k) => v + (b[k] - v) * (x - i)))
}
export const rampStops = (name: RampName) => RAMPS[name] as readonly string[]
export const rampCss = (name: RampName) => `linear-gradient(90deg, ${RAMPS[name].join(', ')})`

/** Luminancia relativa (WCAG) para decidir el color del texto sobre un fondo. */
export function luminance(h: string): number {
  const [r, g, b] = hex(h).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
export function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (l1 + 0.05) / (l2 + 0.05)
}
export const textOn = (bg: string) => (luminance(bg) > 0.4 ? '#14181b' : '#ffffff')

/** Clases de probabilidad: cada una combina color, patrón, etiqueta y rango numérico. */
export interface PClass {
  i: number
  min: number
  max: number
  label: string
  range: string
  color: string
  pattern: 'none' | 'dots' | 'lines' | 'dense' | 'cross' | 'solid'
}
const P_BREAKS = [0, 0.01, 0.05, 0.15, 0.35, 0.65, 1]
const P_LABELS = ['Muy baja', 'Baja', 'Moderada', 'Media', 'Alta', 'Muy alta']
const P_RANGES = ['< 1 %', '1–5 %', '5–15 %', '15–35 %', '35–65 %', '> 65 %']
const P_PATTERNS: PClass['pattern'][] = ['none', 'dots', 'lines', 'dense', 'cross', 'solid']
export const P_CLASSES: PClass[] = P_LABELS.map((label, i) => ({
  i,
  min: P_BREAKS[i],
  max: P_BREAKS[i + 1],
  label,
  range: P_RANGES[i],
  color: ramp('viridis', i / (P_LABELS.length - 1)),
  pattern: P_PATTERNS[i],
}))
export function pClass(p: number): PClass {
  for (let i = P_CLASSES.length - 1; i >= 0; i--) if (p >= P_CLASSES[i].min) return P_CLASSES[i]
  return P_CLASSES[0]
}
/** Posición continua de una probabilidad en la rampa (lineal por tramos entre los cortes de clase). */
export function pPosition(p: number): number {
  const c = pClass(p)
  const frac = (Math.min(p, 1) - c.min) / (c.max - c.min || 1)
  return (c.i + Math.min(1, Math.max(0, frac))) / P_CLASSES.length
}
export const pColor = (p: number) => pClass(p).color

/** Clases de profundidad del proyecto. */
export const DEPTH_CLASSES = [
  { min: 0, max: 30, label: '0–30 km', name: 'Superficial' },
  { min: 30, max: 60, label: '30–60 km', name: 'Superficial profunda' },
  { min: 60, max: 150, label: '60–150 km', name: 'Intermedia' },
  { min: 150, max: 300, label: '150–300 km', name: 'Intermedia profunda' },
  { min: 300, max: Infinity, label: 'Más de 300 km', name: 'Profunda' },
].map((c, i) => ({ ...c, i, color: ramp('viridis', 1 - i / 4) }))
export function depthClass(d: number) {
  if (!Number.isFinite(d)) return null
  for (const c of DEPTH_CLASSES) if (d < c.max) return c
  return DEPTH_CLASSES[4]
}
export const NO_DATA_COLOR = '#9aa3a9'

/** Radio del círculo (px) según magnitud: el área crece con la magnitud. */
export const magRadius = (m: number) => Math.max(2, 1.6 + (Math.max(m, 2.5) - 2.5) ** 1.7 * 2.1)

/** Cuantiles simples para leyendas de escalas continuas. */
export function quantile(sorted: ArrayLike<number>, q: number): number {
  const n = sorted.length
  if (!n) return NaN
  const x = (n - 1) * q
  const i = Math.floor(x)
  return i + 1 < n ? sorted[i] + (sorted[i + 1] - sorted[i]) * (x - i) : sorted[i]
}
