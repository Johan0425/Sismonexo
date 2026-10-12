// Estado global en memoria (Zustand) con historial para deshacer/rehacer y serialización a la URL.
// No se usa localStorage: lo que debe sobrevivir a una recarga viaja en la URL compartible.
import { create } from 'zustand'
import type { ModelKey, Unit } from './data'
import { HORIZONS, THRESHOLDS, UNITS } from './data'
import { isIsoDay, type TimeZoneMode } from './format'
import type { Lang } from './i18n'

export interface Filters {
  from: string
  to: string
  magMin: number
  magMax: number
  depthMin: number
  depthMax: number
  dept: string // código DIVIPOLA o '' (todo el catálogo)
  quality: '' | 'AB'
}
export interface ForecastParams {
  unit: Unit
  h: number
  thr: number
  model: ModelKey | 'auto'
  smooth: 0 | 1 | 2
  histFrom: number // año inicial del histórico usado (línea base recalculada)
}
export type Viz = 'puntos' | 'pulsos' | 'grupos' | 'calor' | 'columnas' | 'h3' | 'g50' | 'densidad'
export type ColorBy = 'profundidad' | 'magnitud' | 'ninguno'
export type ZoneMetric = 'probabilidad' | 'tasa' | 'incertidumbre' | 'cambio' | 'calidad'
export interface AtlasParams {
  viz: Viz
  colorBy: ColorBy
  overlays: string[] // 'dep' | 'mun' | 'amenaza' | 'relieve' | 'osm'
}
export type Selection = { kind: 'evento'; id: string } | { kind: 'zona'; unit: Unit; id: string } | null
export interface MapView {
  lon: number
  lat: number
  zoom: number
  bearing: number
  pitch: number
}
export interface Prefs {
  theme: 'sistema' | 'claro' | 'oscuro'
  density: 'comoda' | 'compacta'
  motion: 'sistema' | 'reducido'
  tz: TimeZoneMode
  sidebar: 'full' | 'min'
  /** Atajos de una sola tecla (WCAG 2.1.4 exige poder desactivarlos). */
  keys: boolean
  /** Idioma de la interfaz. El contenido se escribe en español y se traduce en tiempo de ejecución. */
  lang: Lang
}
interface Snapshot {
  filters: Filters
  fc: ForecastParams
  label: string
  at: number
}
export interface SavedView {
  name: string
  href: string
  at: number
}
export interface Toast {
  id: number
  text: string
  action?: { label: string; run: () => void }
}

export const COVERAGE = { from: '1993-06-01', to: '2026-10-10' } // se ajusta al cargar el índice
export const DEFAULT_FILTERS: Filters = { from: COVERAGE.from, to: COVERAGE.to, magMin: 2.5, magMax: 9, depthMin: 0, depthMax: 700, dept: '', quality: '' }
export const DEFAULT_FC: ForecastParams = { unit: 'g50', h: 30, thr: 4, model: 'auto', smooth: 0, histFrom: 1993 }
export const DEFAULT_ATLAS: AtlasParams = { viz: 'puntos', colorBy: 'profundidad', overlays: ['dep'] }
export const DEFAULT_VIEW: MapView = { lon: -73.2, lat: 4.4, zoom: 4.6, bearing: 0, pitch: 0 }
const DEFAULT_PREFS: Prefs = { theme: 'sistema', density: 'comoda', motion: 'sistema', tz: 'colombia', sidebar: 'full', keys: true, lang: 'es' }

interface State {
  filters: Filters
  fc: ForecastParams
  atlas: AtlasParams
  zoneMetric: ZoneMetric
  view: MapView
  selection: Selection
  prefs: Prefs
  past: Snapshot[]
  future: Snapshot[]
  saved: SavedView[]
  scenarios: { name: string; at: number; data: unknown }[]
  toasts: Toast[]
  live: string
  online: boolean
  /** Nombre del archivo importado que reemplaza al catálogo en atlas e histórico (null = catálogo oficial). */
  imported: string | null
  setImported: (name: string | null) => void
  palette: boolean
  shortcuts: boolean
  nexo: boolean
  onboarding: boolean
  setFilters: (patch: Partial<Filters>, label: string) => void
  setFc: (patch: Partial<ForecastParams>, label: string) => void
  resetFilters: () => void
  undo: () => void
  redo: () => void
  setAtlas: (patch: Partial<AtlasParams>) => void
  toggleOverlay: (k: string) => void
  setZoneMetric: (m: ZoneMetric) => void
  setView: (v: MapView) => void
  select: (s: Selection) => void
  setPrefs: (patch: Partial<Prefs>) => void
  saveView: (name: string, href: string) => void
  removeView: (at: number) => void
  saveScenario: (name: string, data: unknown) => void
  toast: (text: string, action?: Toast['action']) => void
  dismissToast: (id: number) => void
  announce: (text: string) => void
  setOpen: (k: 'palette' | 'shortcuts' | 'nexo' | 'onboarding', v: boolean) => void
  setOnline: (v: boolean) => void
  hydrate: (q: URLSearchParams) => void
  setCoverage: (from: string, to: string) => void
}

let toastId = 0
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Mantiene los filtros dentro de rangos válidos y con mínimos ≤ máximos. */
export function sanitizeFilters(f: Filters): Filters {
  let from = isIsoDay(f.from) ? f.from : COVERAGE.from
  let to = isIsoDay(f.to) ? f.to : COVERAGE.to
  if (from > to) [from, to] = [to, from]
  const magMin = clamp(Math.round(f.magMin * 10) / 10, 0, 9.5)
  const magMax = clamp(Math.round(f.magMax * 10) / 10, magMin, 10)
  const depthMin = clamp(Math.round(f.depthMin), 0, 700)
  const depthMax = clamp(Math.round(f.depthMax), depthMin, 700)
  return { from, to, magMin, magMax, depthMin, depthMax, dept: /^\d{2}$/.test(f.dept) ? f.dept : '', quality: f.quality === 'AB' ? 'AB' : '' }
}
export function sanitizeFc(p: ForecastParams): ForecastParams {
  const unit = UNITS.includes(p.unit) ? p.unit : DEFAULT_FC.unit
  const h = clamp(Math.round(p.h) || 30, 1, 365)
  const thr = clamp(Math.round(p.thr * 10) / 10, 2.5, 7)
  const smooth = ([0, 1, 2].includes(p.smooth) ? p.smooth : 0) as 0 | 1 | 2
  return { unit, h, thr, model: p.model, smooth, histFrom: clamp(Math.round(p.histFrom) || 1993, 1993, 2025) }
}
/** ¿Existe un modelo entrenado para estos parámetros? Si no, se usa la línea base recalculada en el navegador. */
export function isTrained(p: ForecastParams, f: Pick<Filters, 'depthMin' | 'depthMax'>): boolean {
  return (
    (HORIZONS as readonly number[]).includes(p.h) &&
    (THRESHOLDS as readonly number[]).includes(p.thr) &&
    p.smooth === 0 &&
    p.histFrom === 1993 &&
    f.depthMin === 0 &&
    f.depthMax >= 700
  )
}

export const useApp = create<State>((set, get) => {
  const push = (label: string) => {
    const { filters, fc, past } = get()
    return { past: [...past.slice(-49), { filters, fc, label, at: Date.now() }], future: [] as Snapshot[] }
  }
  return {
    filters: DEFAULT_FILTERS,
    fc: DEFAULT_FC,
    atlas: DEFAULT_ATLAS,
    zoneMetric: 'probabilidad',
    view: DEFAULT_VIEW,
    selection: null,
    prefs: DEFAULT_PREFS,
    past: [],
    future: [],
    saved: [],
    scenarios: [],
    toasts: [],
    live: '',
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    imported: null,
    setImported: (imported) => set({ imported, selection: null }),
    palette: false,
    shortcuts: false,
    nexo: false,
    onboarding: false,
    setFilters: (patch, label) => {
      const next = sanitizeFilters({ ...get().filters, ...patch })
      if (JSON.stringify(next) === JSON.stringify(get().filters)) return
      set({ ...push(label), filters: next, live: `Filtro aplicado: ${label}.` })
    },
    setFc: (patch, label) => {
      const next = sanitizeFc({ ...get().fc, ...patch })
      if (JSON.stringify(next) === JSON.stringify(get().fc)) return
      set({ ...push(label), fc: next, live: `Parámetro del pronóstico: ${label}.` })
    },
    resetFilters: () => {
      if (JSON.stringify(get().filters) === JSON.stringify(DEFAULT_FILTERS)) return
      set({ ...push('Restablecer filtros'), filters: DEFAULT_FILTERS, live: 'Filtros restablecidos.' })
    },
    undo: () => {
      const { past, future, filters, fc } = get()
      const last = past[past.length - 1]
      if (!last) return
      set({ past: past.slice(0, -1), future: [{ filters, fc, label: last.label, at: Date.now() }, ...future], filters: last.filters, fc: last.fc, live: `Se deshizo: ${last.label}.` })
    },
    redo: () => {
      const { past, future, filters, fc } = get()
      const next = future[0]
      if (!next) return
      set({ future: future.slice(1), past: [...past, { filters, fc, label: next.label, at: Date.now() }], filters: next.filters, fc: next.fc, live: `Se rehízo: ${next.label}.` })
    },
    setAtlas: (patch) => set({ atlas: { ...get().atlas, ...patch } }),
    toggleOverlay: (k) => {
      const o = get().atlas.overlays
      set({ atlas: { ...get().atlas, overlays: o.includes(k) ? o.filter((x) => x !== k) : [...o, k] } })
    },
    setZoneMetric: (zoneMetric) => set({ zoneMetric }),
    setView: (view) => set({ view }),
    select: (selection) => set({ selection }),
    setPrefs: (patch) => set({ prefs: { ...get().prefs, ...patch } }),
    saveView: (name, href) => set({ saved: [{ name, href, at: Date.now() }, ...get().saved].slice(0, 30) }),
    removeView: (at) => set({ saved: get().saved.filter((v) => v.at !== at) }),
    saveScenario: (name, data) => set({ scenarios: [{ name, at: Date.now(), data }, ...get().scenarios].slice(0, 20) }),
    toast: (text, action) => {
      const id = ++toastId
      set({ toasts: [...get().toasts.slice(-2), { id, text, action }], live: text })
      setTimeout(() => get().dismissToast(id), action ? 8000 : 4200)
    },
    dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),
    announce: (live) => set({ live }),
    setOpen: (k, v) => set({ [k]: v } as Pick<State, typeof k>),
    setOnline: (online) => set({ online }),
    hydrate: (q) => set(fromQuery(q, get())),
    setCoverage: (from, to) => {
      COVERAGE.from = from
      COVERAGE.to = to
      DEFAULT_FILTERS.to = to
      const f = get().filters
      if (f.to === '2026-10-10' || f.to > to) set({ filters: { ...f, to } })
    },
  }
})

// ------------------------------------------------------------------ URL compartible

const num = (s: string | null, d: number) => (s != null && s !== '' && Number.isFinite(+s) ? +s : d)

export function toQuery(s: Pick<State, 'filters' | 'fc' | 'atlas' | 'view' | 'selection' | 'prefs' | 'zoneMetric'>): string {
  const q = new URLSearchParams()
  const { filters: f, fc, atlas: a, view: v, selection: sel, prefs } = s
  const D = DEFAULT_FILTERS
  if (f.from !== D.from || f.to !== D.to) q.set('fecha', `${f.from}_${f.to}`)
  if (f.magMin !== D.magMin || f.magMax !== D.magMax) q.set('mag', `${f.magMin}_${f.magMax}`)
  if (f.depthMin !== D.depthMin || f.depthMax !== D.depthMax) q.set('prof', `${f.depthMin}_${f.depthMax}`)
  if (f.dept) q.set('dpto', f.dept)
  if (f.quality) q.set('calidad', f.quality)
  if (fc.unit !== DEFAULT_FC.unit) q.set('unidad', fc.unit)
  if (fc.h !== DEFAULT_FC.h) q.set('horizonte', String(fc.h))
  if (fc.thr !== DEFAULT_FC.thr) q.set('umbral', String(fc.thr))
  if (fc.model !== 'auto') q.set('modelo', fc.model)
  if (fc.smooth) q.set('suavizado', String(fc.smooth))
  if (fc.histFrom !== DEFAULT_FC.histFrom) q.set('desde', String(fc.histFrom))
  if (s.zoneMetric !== 'probabilidad') q.set('metrica', s.zoneMetric)
  if (a.viz !== DEFAULT_ATLAS.viz) q.set('vista', a.viz)
  if (a.colorBy !== DEFAULT_ATLAS.colorBy) q.set('color', a.colorBy)
  if (a.overlays.join() !== DEFAULT_ATLAS.overlays.join()) q.set('capas', a.overlays.join('.'))
  const dv = DEFAULT_VIEW
  if (Math.abs(v.lon - dv.lon) > 1e-3 || Math.abs(v.lat - dv.lat) > 1e-3 || Math.abs(v.zoom - dv.zoom) > 1e-2 || v.bearing || v.pitch)
    q.set('mapa', [v.lon.toFixed(3), v.lat.toFixed(3), v.zoom.toFixed(2), Math.round(v.bearing), Math.round(v.pitch)].join('_'))
  if (sel) q.set('sel', sel.kind === 'evento' ? `e.${sel.id}` : `z.${sel.unit}.${sel.id}`)
  if (prefs.theme !== 'sistema') q.set('tema', prefs.theme)
  if (prefs.tz !== 'colombia') q.set('hora', prefs.tz)
  if (prefs.lang !== 'es') q.set('idioma', prefs.lang)
  return q.toString()
}

export function fromQuery(q: URLSearchParams, cur: Pick<State, 'filters' | 'fc' | 'atlas' | 'view' | 'prefs' | 'zoneMetric'>) {
  const two = (k: string) => (q.get(k) ?? '').split('_')
  const [from, to] = two('fecha')
  const [m0, m1] = two('mag')
  const [d0, d1] = two('prof')
  const D = DEFAULT_FILTERS
  const filters = sanitizeFilters({
    from: from || D.from,
    to: to || D.to,
    magMin: num(m0, D.magMin),
    magMax: num(m1, D.magMax),
    depthMin: num(d0, D.depthMin),
    depthMax: num(d1, D.depthMax),
    dept: q.get('dpto') ?? '',
    quality: q.get('calidad') === 'AB' ? 'AB' : '',
  })
  const model = q.get('modelo') as ModelKey | null
  const fc = sanitizeFc({
    unit: (q.get('unidad') as Unit) ?? DEFAULT_FC.unit,
    h: num(q.get('horizonte'), DEFAULT_FC.h),
    thr: num(q.get('umbral'), DEFAULT_FC.thr),
    model: model && ['base', 'logit', 'pois', 'rf', 'hgb', 'etas', 'hyb'].includes(model) ? model : 'auto',
    smooth: num(q.get('suavizado'), 0) as 0 | 1 | 2,
    histFrom: num(q.get('desde'), DEFAULT_FC.histFrom),
  })
  const vizes: Viz[] = ['puntos', 'pulsos', 'grupos', 'calor', 'columnas', 'h3', 'g50', 'densidad']
  const viz = vizes.includes(q.get('vista') as Viz) ? (q.get('vista') as Viz) : DEFAULT_ATLAS.viz
  const colors: ColorBy[] = ['profundidad', 'magnitud', 'ninguno']
  const colorBy = colors.includes(q.get('color') as ColorBy) ? (q.get('color') as ColorBy) : DEFAULT_ATLAS.colorBy
  const overlays = q.has('capas') ? (q.get('capas') ?? '').split('.').filter((x) => ['dep', 'mun', 'amenaza', 'relieve', 'osm'].includes(x)) : DEFAULT_ATLAS.overlays
  const mv = two('mapa').map(Number)
  const view: MapView =
    mv.length === 5 && mv.every(Number.isFinite)
      ? { lon: clamp(mv[0], -95, -55), lat: clamp(mv[1], -15, 22), zoom: clamp(mv[2], 2, 14), bearing: mv[3], pitch: clamp(mv[4], 0, 75) }
      : cur.view
  const s = q.get('sel')
  let selection: Selection = null
  if (s?.startsWith('e.')) selection = { kind: 'evento', id: s.slice(2) }
  else if (s?.startsWith('z.')) {
    const [, u, ...rest] = s.split('.')
    if (UNITS.includes(u as Unit)) selection = { kind: 'zona', unit: u as Unit, id: rest.join('.') }
  }
  const theme = q.get('tema')
  const metrics: ZoneMetric[] = ['probabilidad', 'tasa', 'incertidumbre', 'cambio', 'calidad']
  return {
    filters,
    fc,
    atlas: { viz, colorBy, overlays },
    view,
    selection,
    zoneMetric: metrics.includes(q.get('metrica') as ZoneMetric) ? (q.get('metrica') as ZoneMetric) : cur.zoneMetric,
    prefs: { ...cur.prefs, theme: theme === 'claro' || theme === 'oscuro' ? theme : cur.prefs.theme, tz: q.get('hora') === 'utc' ? ('utc' as const) : cur.prefs.tz, lang: q.get('idioma') === 'en' || q.get('idioma') === 'pt' ? (q.get('idioma') as Lang) : cur.prefs.lang },
  }
}

/** Descripción legible de los filtros activos (para informes, exportaciones y lectores de pantalla). */
export function describeFilters(f: Filters, deptName?: string): string[] {
  const out = [`Fechas (UTC): ${f.from} a ${f.to}`, `Magnitud: ${String(f.magMin).replace('.', ',')} a ${String(f.magMax).replace('.', ',')}`]
  out.push(f.depthMin === 0 && f.depthMax >= 700 ? 'Profundidad: todas' : `Profundidad: ${f.depthMin} a ${f.depthMax} km`)
  out.push(`Ubicación: ${f.dept ? deptName ?? `departamento ${f.dept}` : 'toda la ventana de estudio'}`)
  if (f.quality) out.push('Calidad de localización: solo A y B')
  return out
}
