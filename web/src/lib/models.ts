// Evaluación en el navegador de los modelos exportados por el pipeline (laboratorio de escenarios).
// La lógica replica modeling.py; la paridad con los valores exportados se comprueba en las pruebas.
import type { ForecastFile, IsoExport, LabModels, ModelKey, PrepExport, TreeExport } from './data'
import { T0 } from './data'

const EPS = 1e-6
export const clip01 = (p: number) => Math.min(1 - EPS, Math.max(EPS, p))
export const logit = (p: number) => {
  const q = clip01(p)
  return Math.log(q / (1 - q))
}
export const sigmoid = (x: number) => 1 / (1 + Math.exp(-x))

export function isoApply(iso: IsoExport, p: number): number {
  const { x, y } = iso
  if (p <= x[0]) return y[0]
  const n = x.length
  if (p >= x[n - 1]) return y[n - 1]
  let lo = 0
  let hi = n - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (x[mid] <= p) lo = mid
    else hi = mid
  }
  const span = x[hi] - x[lo]
  return span > 0 ? y[lo] + ((y[hi] - y[lo]) * (p - x[lo])) / span : y[hi]
}

function prep(p: PrepExport, features: string[], x: number[]): number[] {
  const logSet = new Set(p.log_features)
  return x.map((v, j) => {
    let z = logSet.has(features[j]) ? Math.log1p(Math.max(v, 0)) : v
    if (!Number.isFinite(z)) z = p.median[j]
    return (z - p.mean[j]) / p.std[j]
  })
}
const dot = (a: number[], b: number[]) => a.reduce((s, v, i) => s + v * b[i], 0)

export function treeValue(t: TreeExport, x: number[]): number {
  let k = 0
  while (t.v[k] == null) {
    const v = x[t.f[k]]
    const left = Number.isFinite(v) ? v <= (t.t[k] as number) : !!t.m[k]
    k = left ? t.l[k] : t.r[k]
  }
  return t.v[k] as number
}

export interface Prediction {
  p: Partial<Record<ModelKey, number>>
  expected: Partial<Record<ModelKey, number>>
  hgbRaw: number
}

/**
 * x: vector de variables en el orden de ``features`` (NaN para faltantes).
 * originDays: días entre el inicio del catálogo y el origen del pronóstico.
 */
export function predictAll(lab: LabModels, features: string[], x: number[], horizon: number, originDays: number): Prediction {
  const f = (name: string) => x[features.indexOf(name)]
  const p: Prediction['p'] = {}
  const expected: Prediction['expected'] = {}

  const periods = originDays / 30
  const rate30 = (f('rate_hist') * periods + lab.base.prior_events) / (periods + lab.base.prior_periods)
  expected.base = (rate30 * horizon) / 30
  p.base = clip01(1 - Math.exp(-expected.base))

  p.logit = clip01(isoApply(lab.logit.iso, sigmoid(dot(lab.logit.coef, prep(lab.logit.prep, features, x)) + lab.logit.intercept)))

  const mu = Math.min(1e4, Math.exp(dot(lab.pois.coef, prep(lab.pois.prep, features, x)) + lab.pois.intercept))
  expected.pois = mu
  p.pois = clip01(1 - (1 + lab.pois.alpha * mu) ** (-1 / lab.pois.alpha))

  const ex = Math.min(1e4, Math.exp(lab.etas.coef[0] * Math.log((f('rate_hist') * horizon) / 30 + lab.etas.eps) + lab.etas.coef[1] * f('etas_trigger') + lab.etas.intercept))
  expected.etas = ex
  p.etas = clip01(1 - Math.exp(-ex))

  let raw = lab.hgb.baseline
  for (const t of lab.hgb.trees) raw += treeValue(t, x)
  p.hgb = clip01(isoApply(lab.hgb.iso, sigmoid(raw)))

  p.hyb = clip01(sigmoid(lab.hyb.inputs.reduce((s, k, i) => s + lab.hyb.coef[i] * logit(p[k] as number), lab.hyb.intercept)))
  return { p, expected, hgbRaw: raw }
}

export const originDays = (fc: ForecastFile) => Math.round((Date.parse(`${fc.forecast.forecast_start}T00:00:00Z`) / 1000 - T0) / 86400)
export const zoneVector = (fc: ForecastFile, zi: number) => fc.forecast.features[zi].map((v) => (v == null ? NaN : v))

/** Intervalo de incertidumbre empírico: frecuencia observada (Jeffreys 90 %) en el tramo de probabilidad. */
export function intervalFor(fc: ForecastFile, model: ModelKey, p: number): [number, number] {
  const bins = fc.models[model]?.uncertainty_bins
  if (!bins?.length) return [p, p]
  let i = bins.findIndex((b) => p <= b.p_max)
  if (i < 0) i = bins.length - 1
  return [Math.min(bins[i].lo, p), Math.max(bins[i].hi, p)]
}

/** Sensibilidad: cambio de la probabilidad al mover cada variable ±1 paso dentro de su rango histórico. */
export function sensitivity(fc: ForecastFile, x: number[], model: ModelKey, steps: Record<string, number>): { feature: string; down: number; up: number }[] {
  const od = originDays(fc)
  const h = fc.config.horizon_days
  const base = predictAll(fc.lab.models, fc.features, x, h, od).p[model] as number
  return Object.entries(steps).map(([feature, step]) => {
    const j = fc.features.indexOf(feature)
    const r = fc.lab.ranges[feature]
    const cur = Number.isFinite(x[j]) ? x[j] : (r.q005 + r.q995) / 2
    const at = (v: number) => {
      const y = [...x]
      y[j] = Math.min(r.max, Math.max(r.min, v))
      return (predictAll(fc.lab.models, fc.features, y, h, od).p[model] as number) - base
    }
    return { feature, down: at(cur - step), up: at(cur + step) }
  })
}
