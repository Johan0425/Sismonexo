// Estadística descriptiva y línea base recalculada en el navegador.
import type { Events, ZoneTable } from './data'
import { applySmoothing, smoothingWeights } from './geo'

export const DAY = 86400

// ------------------------------------------------------------------ distribución gamma

/** Aproximación de Acklam a la inversa de la normal estándar. */
export function normInv(p: number): number {
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const pl = 0.02425
  if (p <= 0) return -Infinity
  if (p >= 1) return Infinity
  if (p < pl) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p > 1 - pl) return -normInv(1 - p)
  const q = p - 0.5
  const r = q * q
  return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
}

/** Cuantil de Gamma(forma k, tasa 1) por Wilson–Hilferty; suficiente para un intervalo creíble aproximado. */
export function gammaQuantile(k: number, p: number): number {
  const z = normInv(p)
  const v = 1 - 1 / (9 * k) + z * Math.sqrt(1 / (9 * k))
  return Math.max(0, k * v * v * v)
}

// ------------------------------------------------------------------ línea base por zona

export interface BaselineInput {
  ev: Events
  zoneOf: Int32Array
  zt: ZoneTable
  threshold: number
  horizon: number
  depthMin: number
  depthMax: number
  histFromYear: number
  endT: number // segundos: origen del pronóstico (primer instante sin datos)
  smooth: 0 | 1 | 2
}
export interface ZoneForecast {
  p: Float64Array
  lo: Float64Array
  hi: Float64Array
  expected: Float64Array
  pPrev: Float64Array
  n: Float64Array // eventos sobre el umbral usados
  periods: number
  meanRate30: number
  priorEvents: number
}

/**
 * Línea base de frecuencia histórica (Poisson homogéneo con previa Gamma), igual a la del pipeline
 * pero calculada con los filtros elegidos. Tasa por 30 días = (n + a) / (T + b); P = 1 − exp(−tasa·h/30).
 */
export function baselineForecast(inp: BaselineInput): ZoneForecast {
  const { ev, zoneOf, zt, threshold, horizon, depthMin, depthMax, endT } = inp
  const nz = zt.id.length
  const startT = Math.max(ev.t[0] ?? 0, Date.UTC(inp.histFromYear, 0, 1) / 1000)
  const allDepth = depthMin <= 0 && depthMax >= 700
  const run = (end: number) => {
    const n = new Float64Array(nz)
    for (let i = 0; i < ev.n; i++) {
      const t = ev.t[i]
      if (t < startT) continue
      if (t >= end) break
      if (ev.mag[i] < threshold) continue
      if (!allDepth && !(ev.depth[i] >= depthMin && ev.depth[i] <= depthMax)) continue
      const z = zoneOf[i]
      if (z >= 0) n[z]++
    }
    const periods = Math.max((end - startT) / DAY / 30, 1)
    let total = 0
    for (let z = 0; z < nz; z++) total += n[z]
    const meanRate30 = Math.max(total / nz / periods, 1e-6)
    return { n, periods, meanRate30 }
  }
  const priorEvents = 0.5
  const now = run(endT)
  const prev = run(endT - horizon * DAY)
  const sw = smoothingWeights(zt, inp.smooth)
  const b = priorEvents / now.meanRate30
  const rate = new Float64Array(nz)
  const rLo = new Float64Array(nz)
  const rHi = new Float64Array(nz)
  for (let z = 0; z < nz; z++) {
    const k = now.n[z] + priorEvents
    rate[z] = k / (now.periods + b)
    rLo[z] = gammaQuantile(k, 0.05) / (now.periods + b)
    rHi[z] = gammaQuantile(k, 0.95) / (now.periods + b)
  }
  const bp = priorEvents / prev.meanRate30
  const ratePrev = Float64Array.from(prev.n, (n) => (n + priorEvents) / (prev.periods + bp))
  const toP = (r: Float64Array) => Float64Array.from(r, (v) => 1 - Math.exp((-v * horizon) / 30))
  const rs = applySmoothing(rate, sw)
  return {
    p: toP(rs),
    lo: toP(applySmoothing(rLo, sw)).map((v, i) => Math.min(v, 1 - Math.exp((-rs[i] * horizon) / 30))),
    hi: toP(applySmoothing(rHi, sw)).map((v, i) => Math.max(v, 1 - Math.exp((-rs[i] * horizon) / 30))),
    expected: rs.map((v) => (v * horizon) / 30),
    pPrev: toP(applySmoothing(ratePrev, sw)),
    n: now.n,
    periods: now.periods,
    meanRate30: now.meanRate30,
    priorEvents,
  }
}

// ------------------------------------------------------------------ series y distribuciones

export type Bin = 'dia' | 'semana' | 'mes' | 'anio'
export const BIN_LABEL: Record<Bin, string> = { dia: 'Día', semana: 'Semana', mes: 'Mes', anio: 'Año' }

/** Inicio (segundos UTC) del intervalo que contiene t. */
export function binStart(t: number, bin: Bin): number {
  const d = new Date(t * 1000)
  if (bin === 'dia') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000
  if (bin === 'semana') {
    const dow = (d.getUTCDay() + 6) % 7 // lunes = 0
    return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - dow) / 1000
  }
  if (bin === 'mes') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000
  return Date.UTC(d.getUTCFullYear(), 0, 1) / 1000
}
export function binNext(t: number, bin: Bin): number {
  const d = new Date(t * 1000)
  if (bin === 'dia') return t + DAY
  if (bin === 'semana') return t + 7 * DAY
  if (bin === 'mes') return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 1000
  return Date.UTC(d.getUTCFullYear() + 1, 0, 1) / 1000
}
export function autoBin(spanSeconds: number): Bin {
  const days = spanSeconds / DAY
  if (days <= 120) return 'dia'
  if (days <= 800) return 'semana'
  if (days <= 3660 * 1.2) return 'mes'
  return 'anio'
}

export interface TimeSeries {
  t: number[]
  count: number[]
  maxMag: number[]
  medianDepth: number[]
}
export function timeSeries(ev: Events, idx: ArrayLike<number>, bin: Bin, from: number, to: number): TimeSeries {
  const t: number[] = []
  for (let s = binStart(from, bin); s <= to && t.length < 20000; s = binNext(s, bin)) t.push(s)
  const count = new Array<number>(t.length).fill(0)
  const maxMag = new Array<number>(t.length).fill(NaN)
  const depths: number[][] = t.map(() => [])
  let b = 0
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]
    const ti = ev.t[i]
    while (b + 1 < t.length && ti >= t[b + 1]) b++
    if (ti < t[b]) continue
    count[b]++
    if (!(maxMag[b] >= ev.mag[i])) maxMag[b] = ev.mag[i]
    if (Number.isFinite(ev.depth[i])) depths[b].push(ev.depth[i])
  }
  return { t, count, maxMag, medianDepth: depths.map(median) }
}

export function median(a: number[]): number {
  if (!a.length) return NaN
  const s = [...a].sort((x, y) => x - y)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
export function mean(a: ArrayLike<number>): number {
  if (!a.length) return NaN
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]
  return s / a.length
}

export function histogram(values: ArrayLike<number>, min: number, step: number, bins: number): number[] {
  const out = new Array<number>(bins).fill(0)
  for (let i = 0; i < values.length; i++) {
    const v = values[i]
    if (!Number.isFinite(v)) continue
    const k = Math.floor((v - min) / step + 1e-9)
    if (k >= 0) out[Math.min(k, bins - 1)]++
  }
  return out
}

export interface Summary {
  n: number
  maxMag: number
  maxMagIndex: number
  meanMag: number
  medianDepth: number
  meanDepth: number
  first: number
  last: number
  perMonth: number
  byDepthClass: number[]
  good: number
  noDepth: number
}
const DEPTH_EDGES = [30, 60, 150, 300]
export function summarize(ev: Events, idx: ArrayLike<number>): Summary {
  let maxMag = -Infinity
  let maxMagIndex = -1
  let sumMag = 0
  let sumDepth = 0
  let good = 0
  const depths: number[] = []
  const byDepthClass = [0, 0, 0, 0, 0]
  const qGood = ev.qNames.map((q) => q === 'A' || q === 'B')
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]
    const m = ev.mag[i]
    sumMag += m
    if (m > maxMag) {
      maxMag = m
      maxMagIndex = i
    }
    const d = ev.depth[i]
    if (Number.isFinite(d)) {
      depths.push(d)
      sumDepth += d
      let c = 0
      while (c < 4 && d >= DEPTH_EDGES[c]) c++
      byDepthClass[c]++
    }
    if (qGood[ev.q[i]]) good++
  }
  const n = idx.length
  const first = n ? ev.t[idx[0]] : NaN
  const last = n ? ev.t[idx[n - 1]] : NaN
  return {
    n,
    maxMag: n ? maxMag : NaN,
    maxMagIndex,
    meanMag: n ? sumMag / n : NaN,
    medianDepth: median(depths),
    meanDepth: depths.length ? sumDepth / depths.length : NaN,
    first,
    last,
    perMonth: NaN,
    byDepthClass,
    good,
    noDepth: n - depths.length,
  }
}

/** Valor b de Gutenberg–Richter (estimador de Aki–Utsu) sobre magnitudes ≥ mc con redondeo de 0,1. */
export function bValue(mags: ArrayLike<number>, mc: number): { b: number; se: number; n: number } | null {
  let n = 0
  let s = 0
  for (let i = 0; i < mags.length; i++)
    if (mags[i] >= mc - 1e-6) {
      n++
      s += mags[i]
    }
  if (n < 50) return null
  const b = Math.LOG10E / (s / n - (mc - 0.05))
  return { b, se: b / Math.sqrt(n), n }
}

/** Tendencia lineal simple (pendiente por paso) y cambio relativo entre la primera y la segunda mitad. */
export function trend(values: number[]): { slope: number; change: number | null; label: string } {
  const n = values.length
  if (n < 4) return { slope: 0, change: null, label: 'Sin datos suficientes' }
  const mx = (n - 1) / 2
  const my = mean(values)
  let num = 0
  let den = 0
  for (let i = 0; i < n; i++) {
    num += (i - mx) * (values[i] - my)
    den += (i - mx) ** 2
  }
  const half = n >> 1
  const a = mean(values.slice(0, half))
  const b = mean(values.slice(n - half))
  const change = a > 0 ? (b - a) / a : null
  const label = change == null ? 'Sin actividad previa comparable' : change > 0.25 ? 'En aumento' : change < -0.25 ? 'En descenso' : 'Estable'
  return { slope: den ? num / den : 0, change, label }
}

/** Eventos cercanos en espacio y tiempo a uno dado. */
export function nearby(ev: Events, i: number, km: number, days: number, dist: (a: number, b: number, c: number, d: number) => number): number[] {
  const out: number[] = []
  const t0 = ev.t[i] - days * DAY
  const t1 = ev.t[i] + days * DAY
  let lo = 0
  let hi = ev.n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ev.t[mid] < t0) lo = mid + 1
    else hi = mid
  }
  for (let j = lo; j < ev.n && ev.t[j] <= t1; j++) {
    if (j === i) continue
    if (Math.abs(ev.lat[j] - ev.lat[i]) * 111.32 > km) continue
    if (dist(ev.lon[i], ev.lat[i], ev.lon[j], ev.lat[j]) <= km) out.push(j)
  }
  return out
}
