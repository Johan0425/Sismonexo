// Carga y tipos de los artefactos reales generados por el pipeline (web/public/data).
// Todo vive en memoria: no se usa almacenamiento persistente del navegador.
import { useEffect, useState } from 'react'

export type Unit = 'dep' | 'mun' | 'h3' | 'g50' | 'g25'
export type ModelKey = 'base' | 'logit' | 'pois' | 'rf' | 'hgb' | 'etas' | 'hyb'
export const UNITS: Unit[] = ['dep', 'mun', 'h3', 'g50', 'g25']
export const HORIZONS = [7, 30, 90] as const
export const THRESHOLDS = [3.0, 4.0, 5.0] as const
export const MODEL_ORDER: ModelKey[] = ['base', 'logit', 'pois', 'rf', 'hgb', 'etas', 'hyb']
export const T0 = Date.UTC(1993, 5, 1) / 1000 // inicio del catálogo instrumental (día 0 del pipeline)

export interface SourceInfo {
  key: string
  name: string
  publisher: string
  url: string
  landing: string
  consulted_at: string
  updated_at: string
  coverage: [string, string]
  records: number
  license: string
  processing: string[]
  removed_variables: string[]
  dropped: number
  dataset_version: string
  files?: number
  note?: string
}
export interface AuditStep {
  order: number
  rule: string
  title: string
  detail: string
  rows_in: number
  rows_affected: number
  rows_dropped: number
  rows_out: number
  action: string
}
export interface FeatureInfo {
  key: string
  label: string
  unit: string
  group: string
}
export interface ExperimentSummary {
  id: string
  unit: Unit
  horizon: number
  threshold: number
  n_zones: number
  n_rows: number
  positives: number
  prevalence: number
  full_comparison: boolean
  model_version: string
  selected_model: ModelKey
  generated_at: string
  forecast_start: string
  forecast_end: string
  models: Partial<Record<ModelKey, { pr_auc: number | null; brier: number; log_loss: number; brier_skill: number | null; status: string }>>
  leakage: string[]
}
export interface IndexData {
  app: { name: string; subtitle: string; author: string; institution: string; program: string }
  dataset_version: string
  generated_at: string
  coverage: [string, string]
  min_magnitude: number
  bbox: { lon_min: number; lon_max: number; lat_min: number; lat_max: number }
  records: number
  counts: { events: number; events_bytes: number; csi: number; geo: Record<string, number>; zones: Record<Unit, number> }
  sources: SourceInfo[]
  audit: AuditStep[]
  units: Record<Unit, { label: string; resolution: string; n_zones: number; grid_deg?: number; h3_res?: number }>
  features: FeatureInfo[]
  model_info: Record<ModelKey, { name: string; family: string; interpretability: number; counts: boolean }>
  depth_classes: [number, number, string][]
  etas: Record<string, number>
  prev_event_mag: number
  experiments: ExperimentSummary[]
  official_layers: {
    hazard: { available: boolean; name: string; publisher: string; service: string; landing: string }
    faults: { available: boolean; name: string; reason: string }
  }
}

export interface Events {
  n: number
  t: Float64Array
  lon: Float32Array
  lat: Float32Array
  depth: Float32Array
  mag: Float32Array
  mt: Uint8Array
  dep: Int8Array
  mun: Int16Array
  loc: Int16Array
  q: Uint8Array
  err: Float32Array
  src: Uint8Array
  status: Uint8Array
  dflag: Uint8Array
  id: string[]
  mtNames: string[]
  depCodes: string[]
  munCodes: string[]
  locNames: string[]
  qNames: string[]
  sources: { key: string; name: string; event_url: string | null; query_url: string }[]
  /** true cuando el conjunto proviene de un archivo importado por la persona usuaria durante la sesión. */
  imported?: { name: string; importedAt: string }
}

export interface ZoneTable {
  unit: Unit
  label: string
  resolution: string
  id: string[]
  name: string[]
  department: string[]
  municipality: string[]
  area_km2: number[]
  lon: number[]
  lat: number[]
  index: Map<string, number>
}

export interface Metrics {
  n: number
  positives: number
  prevalence: number
  decision_threshold: number
  brier: number
  log_loss: number
  evaluable: boolean | number
  pr_auc: number | null
  roc_auc: number | null
  confusion: { tp: number; fp: number; fn: number; tn: number }
  precision: number | null
  recall: number | null
  f1: number | null
  ece: number
  calibration_slope: number | null
  calibration_intercept: number | null
  brier_skill?: number | null
  info_gain_bits?: number | null
  mae_count?: number | null
}
export interface RelBin {
  p_mean: number
  observed: number
  n: number
  p_min: number
  p_max: number
  lo: number
  hi: number
}
export interface ModelResult {
  key: ModelKey
  name: string
  family: string
  interpretability: number
  counts: boolean
  walk_forward: Metrics
  final_test: Metrics
  selection: Metrics
  calibration_status: string
  stability: { pr_auc_std: number | null; pr_auc_min: number | null; pr_auc_max: number | null; brier_std: number | null }
  fit_seconds: number | null
  inference_us_per_row: number | null
  curves: { pr?: [number, number][]; roc?: [number, number][]; calibration: RelBin[] }
  uncertainty_bins: { p_max: number; lo: number; hi: number; observed: number; n: number }[]
}
export interface FoldRow {
  fold: number
  train: [string, string]
  val: [string, string]
  test: [string, string]
  n_train: number
  n_val: number
  n_test: number
  gap_days: number
  test_positives: number
  models: Partial<Record<ModelKey, Record<string, number | null>>>
}
export interface TreeExport {
  f: number[]
  t: (number | null)[]
  l: number[]
  r: number[]
  m: number[]
  v: (number | null)[]
}
export interface PrepExport {
  log_features: string[]
  median: number[]
  mean: number[]
  std: number[]
}
export interface IsoExport {
  x: number[]
  y: number[]
}
export interface LabModels {
  base: { prior_events: number; prior_periods: number; mean_rate30: number }
  logit: { prep: PrepExport; coef: number[]; intercept: number; iso: IsoExport }
  pois: { prep: PrepExport; coef: number[]; intercept: number; alpha: number }
  etas: { coef: number[]; intercept: number; eps: number }
  hgb: { baseline: number; trees: TreeExport[]; iso: IsoExport }
  hyb: { inputs: ModelKey[]; coef: number[]; intercept: number }
}
export interface ForecastFile {
  id: string
  config: {
    unit: Unit
    unit_label: string
    horizon_days: number
    threshold: number
    full_comparison: boolean
    n_zones: number
    n_rows: number
    positives: number
    prevalence: number
    origin_step_days: number
    first_origin: string
    last_labelled_origin: string
    dataset_version: string
    model_version: string
    elapsed_s: number
  }
  features: string[]
  folds: FoldRow[]
  final_fit: { train: [string, string]; val: [string, string]; n_train: number; n_val: number }
  final_test_folds: number
  models: Partial<Record<ModelKey, ModelResult>>
  selected_model: ModelKey
  selection_rule: string
  by_department: { department: string; n: number; positives: number; observed_rate: number; models: Partial<Record<ModelKey, { brier: number; pr_auc: number | null; mean_p: number }>> }[]
  by_depth: { class: string; positives: number; models: Partial<Record<ModelKey, { recall: number | null; mean_p: number | null }>> }[]
  by_magnitude: { class: string; positives: number; models: Partial<Record<ModelKey, { recall: number | null; mean_p: number | null }>> }[]
  leakage: { id: string; title: string; status: 'ok' | 'advertencia' | 'falla'; detail: string; evidence: Record<string, unknown> }[]
  explain: {
    permutation: { feature: string; drop_pr_auc: number; std: number }[]
    pdp: { feature: string; curve: [number, number][] }[]
    mean_abs_shap: { feature: string; value: number }[]
    logit_coef: { feature: string; coef: number }[]
    note: string
  }
  forecast: {
    generated_at: string
    forecast_start: string
    forecast_end: string
    previous_origin: string
    zone_ids: string[]
    p: Partial<Record<ModelKey, number[]>>
    p_prev: Partial<Record<ModelKey, number[]>>
    lo: Partial<Record<ModelKey, number[]>>
    hi: Partial<Record<ModelKey, number[]>>
    expected: Partial<Record<ModelKey, number[]>>
    features: (number | null)[][]
    shap: number[][]
    shap_base: number
    similar: [string, number, number][][]
    similar_k: number
    similar_positive: number[]
  }
  lab: { models: LabModels; ranges: Record<string, { min: number; max: number; q005: number; q995: number }> }
}

export interface QualityData {
  totals: Record<string, number>
  by_year: {
    year: number
    n: number
    seisan: number
    m4: number
    m5: number
    mc: number | null
    median_mag: number
    median_depth: number
    median_error_km: number | null
    median_gap: number | null
    median_phases: number
    quality: Record<string, number>
    reviewed: number
    depth_fixed: number
    in_departments: number
  }[]
  calendar: [number, number, number][]
  magnitude_types: { years: number[]; families: Record<string, number[]>; detail: Record<string, number> }
  missing: Record<string, { label: string; by_year: number[]; total: number }>
  by_department: { code: string; name: string; n: number; m4: number; max_mag: number; median_depth: number | null; good_share: number; first: string; last: string }[]
  breaks: { series: string; label: string; date: string; p_value: number; median_before: number; median_after: number; significant: boolean }[]
  magnitude_histogram: [number, number][]
  instrument_changes: { date: string; title: string; detail: string; source: string }[]
  quality_code_definition: Record<string, string>
}
export interface CsiData {
  n: number
  year: number[]
  t: number[]
  lon: number[]
  lat: number[]
  depth: (number | null)[]
  mag: number[]
}
export type GeoFC = GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon, { id: string; name: string; dep?: string }>

// ------------------------------------------------------------------ carga con caché en memoria

const BASE = `${import.meta.env.BASE_URL}data/`
const cache = new Map<string, Promise<unknown>>()

export class DataError extends Error {
  constructor(
    message: string,
    public kind: 'red' | 'no-encontrado' | 'formato',
  ) {
    super(message)
  }
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  let res: Response
  try {
    res = await fetch(BASE + path, { signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e
    throw new DataError('No hay conexión con el servidor de datos.', 'red')
  }
  if (!res.ok) throw new DataError(`El archivo de datos «${path}» no está disponible (HTTP ${res.status}).`, 'no-encontrado')
  try {
    return (await res.json()) as T
  } catch {
    throw new DataError(`El archivo de datos «${path}» no tiene un formato válido.`, 'formato')
  }
}

/** Carga con caché. Una carga fallida no queda en caché, para permitir reintentos. */
function load<T>(key: string, fn: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined
  if (!p) {
    p = fn().catch((e) => {
      cache.delete(key)
      throw e
    })
    cache.set(key, p)
  }
  return p
}

interface RawEvents {
  n: number
  t: number[]
  lon: number[]
  lat: number[]
  depth: (number | null)[]
  mag: number[]
  mt: number[]
  mt_names: string[]
  dep: number[]
  dep_codes: string[]
  mun: number[]
  mun_codes: string[]
  loc: number[]
  loc_names: string[]
  q: number[]
  q_names: string[]
  err: (number | null)[]
  src: number[]
  status: number[]
  dflag: number[]
  id: string[]
  sources: Events['sources']
}
const f32 = (a: (number | null)[]) => Float32Array.from(a, (v) => (v == null ? NaN : v))

export function decodeEvents(r: RawEvents): Events {
  return {
    n: r.n,
    t: Float64Array.from(r.t),
    lon: Float32Array.from(r.lon),
    lat: Float32Array.from(r.lat),
    depth: f32(r.depth),
    mag: Float32Array.from(r.mag),
    mt: Uint8Array.from(r.mt),
    dep: Int8Array.from(r.dep),
    mun: Int16Array.from(r.mun),
    loc: Int16Array.from(r.loc),
    q: Uint8Array.from(r.q),
    err: f32(r.err),
    src: Uint8Array.from(r.src),
    status: Uint8Array.from(r.status),
    dflag: Uint8Array.from(r.dflag),
    id: r.id,
    mtNames: r.mt_names,
    depCodes: r.dep_codes,
    munCodes: r.mun_codes,
    locNames: r.loc_names,
    qNames: r.q_names,
    sources: r.sources,
  }
}

export const loadIndex = () => load('index', () => fetchJson<IndexData>('index.json'))
export const loadEvents = () => load('events', async () => decodeEvents(await fetchJson<RawEvents>('events.json')))
// Catálogo activo en el atlas y el explorador histórico: el oficial incluido o un archivo importado en la sesión.
let sessionEvents: Events | null = null
export function setSessionEvents(ev: Events | null): void {
  sessionEvents = ev
}
export const loadActiveEvents = (): Promise<Events> => (sessionEvents ? Promise.resolve(sessionEvents) : loadEvents())
export const loadQuality = () => load('quality', () => fetchJson<QualityData>('quality.json'))
export const loadCsi = () => load('csi', () => fetchJson<CsiData>('csi.json'))
export const loadGeo = (k: 'dep' | 'mun') => load(`geo-${k}`, () => fetchJson<GeoFC>(`geo/${k}.geojson`))
export const loadZones = (unit: Unit) =>
  load(`zones-${unit}`, async () => {
    const z = await fetchJson<Omit<ZoneTable, 'index'>>(`zones/${unit}.json`)
    return { ...z, index: new Map(z.id.map((id, i) => [id, i])) } as ZoneTable
  })
export const forecastId = (unit: Unit, h: number, thr: number) => `${unit}-${h}-${Math.round(thr * 10)}`
export const loadForecast = (id: string) => load(`fc-${id}`, () => fetchJson<ForecastFile>(`fc/${id}.json`))

// ------------------------------------------------------------------ identificadores y enlaces

const pad = (n: number, w = 2) => String(n).padStart(w, '0')
export function eventId(ev: Events, i: number): string {
  if (ev.imported || !ev.src[i]) return ev.id[i]
  const d = new Date(ev.t[i] * 1000)
  const stamp = `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  return `SGC-SEISAN-${stamp}-${ev.id[i]}`
}
export function eventSource(ev: Events, i: number) {
  return ev.sources[ev.src[i]] ?? ev.sources[0]
}
/** Enlace al registro original. SEISAN no publica una página por evento: se enlaza la consulta oficial. */
export function eventUrl(ev: Events, i: number): { url: string; direct: boolean } | null {
  const s = eventSource(ev, i)
  if (!s) return null
  if (s.event_url) return { url: s.event_url.replaceAll('{id}', ev.id[i]), direct: true }
  return s.query_url ? { url: s.query_url, direct: false } : null
}

// ------------------------------------------------------------------ hook de carga

export type Async<T> = { status: 'loading'; data?: undefined; error?: undefined } | { status: 'ready'; data: T; error?: undefined } | { status: 'error'; data?: undefined; error: DataError; retry: () => void }

export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<Async<T>>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let alive = true
    setState((s) => (s.status === 'ready' ? s : { status: 'loading' }))
    fn().then(
      (data) => alive && setState({ status: 'ready', data }),
      (e) => {
        if (!alive || (e as Error).name === 'AbortError') return
        const err = e instanceof DataError ? e : new DataError((e as Error).message || 'Error desconocido al cargar los datos.', 'formato')
        setState({ status: 'error', error: err, retry: () => setAttempt((a) => a + 1) })
      },
    )
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, attempt])
  return state
}
