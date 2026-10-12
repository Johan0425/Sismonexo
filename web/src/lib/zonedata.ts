// Valores por zona para el mapa probabilístico: modelo entrenado cuando existe, o línea base recalculada.
import { forecastId, loadEvents, loadForecast, loadZones, type Events, type ForecastFile, type ModelKey, type ZoneTable } from './data'
import { assignZones } from './geo'
import { baselineForecast, DAY } from './stats'
import { isTrained, type Filters, type ForecastParams } from './store'

export interface ZoneData {
  zt: ZoneTable
  ev: Events
  zoneOf: Int32Array
  file: ForecastFile | null
  trained: boolean
  model: ModelKey
  modelName: string
  modelVersion: string
  calibration: string
  generatedAt: string
  start: string
  end: string
  p: Float64Array
  lo: Float64Array
  hi: Float64Array
  pPrev: Float64Array
  expected: Float64Array | null
  /** Motivo por el que no se usa un modelo entrenado (vacío si se usa). */
  why: string
}

const iso = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)

export async function loadZoneData(fc: ForecastParams, f: Pick<Filters, 'depthMin' | 'depthMax'>): Promise<ZoneData> {
  const [zt, ev] = await Promise.all([loadZones(fc.unit), loadEvents()])
  const zoneOf = await assignZones(ev, zt)
  if (isTrained(fc, f)) {
    const file = await loadForecast(forecastId(fc.unit, fc.h, fc.thr))
    const model = fc.model !== 'auto' && file.forecast.p[fc.model] ? fc.model : file.selected_model
    const arr = (a?: number[]) => Float64Array.from(a ?? [])
    return {
      zt, ev, zoneOf, file, trained: true, model,
      modelName: file.models[model]?.name ?? model,
      modelVersion: file.config.model_version,
      calibration: file.models[model]?.calibration_status ?? 'sin evaluar',
      generatedAt: file.forecast.generated_at, start: file.forecast.forecast_start, end: file.forecast.forecast_end,
      p: arr(file.forecast.p[model]), lo: arr(file.forecast.lo[model]), hi: arr(file.forecast.hi[model]), pPrev: arr(file.forecast.p_prev[model]),
      expected: file.forecast.expected[model] ? arr(file.forecast.expected[model]) : null,
      why: '',
    }
  }
  // Origen del pronóstico: el día siguiente al último registro, igual que en el pipeline.
  const endT = (Math.floor(ev.t[ev.n - 1] / DAY) + 1) * DAY
  const b = baselineForecast({ ev, zoneOf, zt, threshold: fc.thr, horizon: fc.h, depthMin: f.depthMin, depthMax: f.depthMax, histFromYear: fc.histFrom, endT, smooth: fc.smooth })
  const reasons: string[] = []
  if (![7, 30, 90].includes(fc.h)) reasons.push('horizonte personalizado')
  if (![3, 4, 5].includes(fc.thr)) reasons.push('umbral de magnitud personalizado')
  if (f.depthMin > 0 || f.depthMax < 700) reasons.push('filtro de profundidad')
  if (fc.histFrom !== 1993) reasons.push('periodo histórico recortado')
  if (fc.smooth) reasons.push('suavizado espacial')
  return {
    zt, ev, zoneOf, file: null, trained: false, model: 'base',
    modelName: 'Línea base de frecuencia histórica (recalculada)',
    modelVersion: `sn-${fc.unit}-h${fc.h}-m${Math.round(fc.thr * 10)}-base-recalculada`,
    calibration: 'sin evaluar',
    generatedAt: new Date().toISOString(), start: iso(endT), end: iso(endT + fc.h * DAY),
    p: b.p, lo: b.lo, hi: b.hi, pPrev: b.pPrev, expected: b.expected,
    why: reasons.join(', '),
  }
}

// ------------------------------------------------------------------ colores por métrica

import { pClass, ramp, rampCss, type RampName } from './scales'
import type { ZoneMetric } from './store'

export interface ZoneLegend {
  title: string
  kind: 'clases' | 'rampa'
  ramp?: string
  min?: string
  max?: string
  mid?: string
  note?: string
}
export interface ZonePaint {
  colors: (string | null)[]
  patterns: number[] | null
  values: Float64Array
  legend: ZoneLegend
}
const pct = (v: number, d = 0) => `${(v * 100).toFixed(d).replace('.', ',')} %`
const num = (v: number, d = 1) => v.toFixed(d).replace('.', ',')

function rampPaint(values: Float64Array, name: RampName, lo: number, hi: number, log = false): (string | null)[] {
  const f = (v: number) => (log ? Math.log(v) : v)
  const a = f(lo)
  const b = f(hi)
  return Array.from(values, (v) => (Number.isFinite(v) ? ramp(name, (f(Math.max(v, lo)) - a) / (b - a || 1)) : null))
}

export function paintZones(zd: ZoneData, metric: ZoneMetric, thr: number): ZonePaint {
  const nz = zd.zt.id.length
  if (metric === 'probabilidad') {
    const cls = Array.from(zd.p, (p) => pClass(p))
    return { colors: cls.map((c) => c.color), patterns: cls.map((c) => c.i), values: zd.p, legend: { title: 'Probabilidad estimada', kind: 'clases' } }
  }
  if (metric === 'incertidumbre') {
    const w = Float64Array.from(zd.p, (_, i) => zd.hi[i] - zd.lo[i])
    const hi = Math.max(0.02, ...w)
    return { colors: rampPaint(w, 'cividis', 0, hi), patterns: null, values: w, legend: { title: 'Amplitud del intervalo de incertidumbre (90 %)', kind: 'rampa', ramp: rampCss('cividis'), min: '0', max: `${num(hi * 100, 0)} puntos`, note: 'Más claro = intervalo más ancho = menos información.' } }
  }
  if (metric === 'cambio') {
    const d = Float64Array.from(zd.p, (p, i) => p - zd.pPrev[i])
    const m = Math.max(0.01, ...Array.from(d, Math.abs))
    return { colors: Array.from(d, (v) => ramp('diverging', 0.5 + v / m / 2)), patterns: null, values: d, legend: { title: 'Cambio frente al periodo anterior', kind: 'rampa', ramp: rampCss('diverging'), min: `−${num(m * 100, 1)} pts`, mid: '0', max: `+${num(m * 100, 1)} pts`, note: 'Escala divergente: azul = bajó, ocre = subió.' } }
  }
  // Tasa histórica y calidad se calculan con el catálogo observado.
  const n = new Float64Array(nz)
  const all = new Float64Array(nz)
  const good = new Float64Array(nz)
  const qGood = zd.ev.qNames.map((q) => q === 'A' || q === 'B')
  for (let i = 0; i < zd.ev.n; i++) {
    const z = zd.zoneOf[i]
    if (z < 0) continue
    all[z]++
    if (qGood[zd.ev.q[i]]) good[z]++
    if (zd.ev.mag[i] >= thr) n[z]++
  }
  if (metric === 'tasa') {
    const months = (zd.ev.t[zd.ev.n - 1] - zd.ev.t[0]) / 86400 / 30
    const r = Float64Array.from(n, (v) => (v > 0 ? v / months : NaN))
    const hi = Math.max(0.01, ...Array.from(r).filter(Number.isFinite))
    const lo = Math.min(hi / 2, 1 / months)
    return { colors: rampPaint(r, 'viridis', lo, hi, true), patterns: null, values: r, legend: { title: `Tasa histórica observada (M ≥ ${num(thr)})`, kind: 'rampa', ramp: rampCss('viridis'), min: `${num(lo, 3)}`, max: `${num(hi, hi < 10 ? 2 : 0)} eventos / 30 días`, note: 'Escala logarítmica. Gris: sin eventos sobre el umbral.' } }
  }
  const q = Float64Array.from(all, (v, i) => (v >= 5 ? good[i] / v : NaN))
  return { colors: rampPaint(q, 'cividis', 0, 1), patterns: null, values: q, legend: { title: 'Cobertura y calidad: localizaciones A o B', kind: 'rampa', ramp: rampCss('cividis'), min: pct(0), max: pct(1), note: 'Gris: menos de 5 eventos registrados (cobertura insuficiente).' } }
}
