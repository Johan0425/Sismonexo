// Geometría y asignación espacial en el navegador. Reproduce exactamente las reglas del pipeline (zones.py).
import type { Events, GeoFC, IndexData, Unit, ZoneTable } from './data'
import { dayEnd, dayStart } from './format'
import type { Filters } from './store'

export const BBOX = { lon_min: -83, lon_max: -66, lat_min: -5, lat_max: 14 }
export const GRID_DEG: Record<string, number> = { g50: 0.45, g25: 0.225 }
export const H3_RES = 4
export const COLOMBIA_BOUNDS: [[number, number], [number, number]] = [
  [-82.2, -4.6],
  [-66.6, 13.6],
]

export function haversineKm(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = Math.PI / 180
  const dphi = (lat2 - lat1) * r
  const dl = (lon2 - lon1) * r
  const a = Math.sin(dphi / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(dl / 2) ** 2
  return 6371.0088 * 2 * Math.asin(Math.sqrt(Math.min(1, a)))
}

type Ring = number[][]
function inRing(x: number, y: number, ring: Ring): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
export function pointInGeometry(lon: number, lat: number, g: GeoJSON.Polygon | GeoJSON.MultiPolygon): boolean {
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  for (const poly of polys) {
    if (inRing(lon, lat, poly[0]) && !poly.slice(1).some((h) => inRing(lon, lat, h))) return true
  }
  return false
}
function bboxOf(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [number, number, number, number] {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
  for (const poly of polys)
    for (const [x, y] of poly[0]) {
      if (x < x0) x0 = x
      if (x > x1) x1 = x
      if (y < y0) y0 = y
      if (y > y1) y1 = y
    }
  return [x0, y0, x1, y1]
}
const fcBoxes = new WeakMap<GeoFC, [number, number, number, number][]>()
/** Índice de la entidad que contiene el punto (−1 si ninguna). */
export function locate(fc: GeoFC, lon: number, lat: number): number {
  let boxes = fcBoxes.get(fc)
  if (!boxes) fcBoxes.set(fc, (boxes = fc.features.map((f) => bboxOf(f.geometry))))
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3]) continue
    if (pointInGeometry(lon, lat, fc.features[i].geometry)) return i
  }
  return -1
}
export function featureBounds(g: GeoJSON.Polygon | GeoJSON.MultiPolygon): [[number, number], [number, number]] {
  const [x0, y0, x1, y1] = bboxOf(g)
  return [
    [x0, y0],
    [x1, y1],
  ]
}

// ------------------------------------------------------------------ zonas

const assignCache = new WeakMap<Events, Map<Unit, Int32Array>>()

export async function assignZones(ev: Events, zt: ZoneTable): Promise<Int32Array> {
  let per = assignCache.get(ev)
  if (!per) assignCache.set(ev, (per = new Map()))
  const hit = per.get(zt.unit)
  if (hit) return hit
  const out = new Int32Array(ev.n).fill(-1)
  const unit = zt.unit
  if (unit === 'dep' || unit === 'mun') {
    const codes = unit === 'dep' ? ev.depCodes : ev.munCodes
    const col = unit === 'dep' ? ev.dep : ev.mun
    const map = codes.map((c) => zt.index.get(c) ?? -1)
    for (let i = 0; i < ev.n; i++) out[i] = col[i] >= 0 ? map[col[i]] : -1
  } else if (unit in GRID_DEG) {
    const s = GRID_DEG[unit]
    for (let i = 0; i < ev.n; i++) {
      const ix = Math.floor((ev.lon[i] - BBOX.lon_min) / s)
      const iy = Math.floor((ev.lat[i] - BBOX.lat_min) / s)
      out[i] = zt.index.get(`${unit}-${ix}-${iy}`) ?? -1
    }
  } else {
    const h3 = await import('h3-js')
    for (let i = 0; i < ev.n; i++) out[i] = zt.index.get(h3.latLngToCell(ev.lat[i], ev.lon[i], H3_RES)) ?? -1
  }
  per.set(unit, out)
  return out
}

const polyCache = new Map<Unit, Promise<GeoJSON.FeatureCollection>>()

/** Polígonos de las zonas con la propiedad ``zi`` (índice en la tabla de zonas). */
export function zonePolygons(zt: ZoneTable, geo: () => Promise<GeoFC>): Promise<GeoJSON.FeatureCollection> {
  let p = polyCache.get(zt.unit)
  if (p) return p
  p = (async (): Promise<GeoJSON.FeatureCollection> => {
    const unit = zt.unit
    if (unit === 'dep' || unit === 'mun') {
      const fc = await geo()
      return {
        type: 'FeatureCollection',
        features: fc.features.flatMap((f) => {
          const zi = zt.index.get(f.properties.id)
          return zi == null ? [] : [{ type: 'Feature' as const, id: zi, properties: { zi }, geometry: f.geometry }]
        }),
      }
    }
    if (unit in GRID_DEG) {
      const s = GRID_DEG[unit]
      return {
        type: 'FeatureCollection',
        features: zt.id.map((id, zi) => {
          const [, ix, iy] = id.split('-').map(Number)
          const x0 = BBOX.lon_min + ix * s
          const y0 = BBOX.lat_min + iy * s
          return { type: 'Feature' as const, id: zi, properties: { zi }, geometry: { type: 'Polygon' as const, coordinates: [[[x0, y0], [x0 + s, y0], [x0 + s, y0 + s], [x0, y0 + s], [x0, y0]]] } }
        }),
      }
    }
    const h3 = await import('h3-js')
    return {
      type: 'FeatureCollection',
      features: zt.id.map((id, zi) => {
        const ring = h3.cellToBoundary(id, true)
        return { type: 'Feature' as const, id: zi, properties: { zi }, geometry: { type: 'Polygon' as const, coordinates: [ring] } }
      }),
    }
  })()
  polyCache.set(zt.unit, p)
  return p
}

/** Pesos de suavizado espacial (núcleo gaussiano sobre centroides). nivel 0 = sin suavizado. */
export function smoothingWeights(zt: ZoneTable, level: 0 | 1 | 2): { idx: Int32Array; w: Float32Array; start: Int32Array } | null {
  if (!level) return null
  const n = zt.id.length
  // Longitud característica: separación típica entre centroides vecinos de la unidad.
  const typical = Math.sqrt(zt.area_km2.reduce((a, b) => a + b, 0) / n)
  const L = typical * (level === 1 ? 0.8 : 1.5)
  const R = L * 2.5
  const idx: number[] = []
  const w: number[] = []
  const start = new Int32Array(n + 1)
  for (let i = 0; i < n; i++) {
    start[i] = idx.length
    let sum = 0
    const from = idx.length
    for (let j = 0; j < n; j++) {
      if (Math.abs(zt.lat[i] - zt.lat[j]) * 111.32 > R) continue
      const d = haversineKm(zt.lon[i], zt.lat[i], zt.lon[j], zt.lat[j])
      if (d > R) continue
      const k = Math.exp(-((d / L) ** 2))
      idx.push(j)
      w.push(k)
      sum += k
    }
    for (let k = from; k < w.length; k++) w[k] /= sum
  }
  start[n] = idx.length
  return { idx: Int32Array.from(idx), w: Float32Array.from(w), start }
}
export function applySmoothing(values: Float64Array, sw: ReturnType<typeof smoothingWeights>): Float64Array {
  if (!sw) return values
  const out = new Float64Array(values.length)
  for (let i = 0; i < values.length; i++) {
    let s = 0
    for (let k = sw.start[i]; k < sw.start[i + 1]; k++) s += sw.w[k] * values[sw.idx[k]]
    out[i] = s
  }
  return out
}

// ------------------------------------------------------------------ filtros

const filterCache = new WeakMap<Events, { key: string; idx: Uint32Array }>()

/** Índices de los eventos que cumplen los filtros. Los eventos sin profundidad solo entran si el rango es completo. */
export function filterEvents(ev: Events, f: Filters): Uint32Array {
  const key = JSON.stringify(f)
  const hit = filterCache.get(ev)
  if (hit?.key === key) return hit.idx
  const t0 = dayStart(f.from)
  const t1 = dayEnd(f.to)
  const dep = f.dept ? ev.depCodes.indexOf(f.dept) : -2
  const allDepth = f.depthMin <= 0 && f.depthMax >= 700
  const good = f.quality === 'AB' ? ev.qNames.map((q) => q === 'A' || q === 'B') : null
  const out = new Uint32Array(ev.n)
  let n = 0
  // Los eventos están ordenados por tiempo: búsqueda binaria del primer índice dentro del rango.
  let lo = 0
  let hi = ev.n
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (ev.t[mid] < t0) lo = mid + 1
    else hi = mid
  }
  for (let i = lo; i < ev.n && ev.t[i] <= t1; i++) {
    const m = ev.mag[i]
    if (m < f.magMin || m > f.magMax) continue
    if (!allDepth) {
      const d = ev.depth[i]
      if (!(d >= f.depthMin && d <= f.depthMax)) continue
    }
    if (dep !== -2 && ev.dep[i] !== dep) continue
    if (good && !good[ev.q[i]]) continue
    out[n++] = i
  }
  const idx = out.slice(0, n)
  filterCache.set(ev, { key, idx })
  return idx
}

export function placeName(ev: Events, i: number, munNames: Map<string, string> | null, depNames: Map<string, string> | null): string {
  if (ev.mun[i] >= 0) {
    const m = munNames?.get(ev.munCodes[ev.mun[i]])
    const d = depNames?.get(ev.depCodes[ev.dep[i]])
    if (m && d) return `${m}, ${d}`
    if (d) return d
  }
  if (ev.dep[i] >= 0) return depNames?.get(ev.depCodes[ev.dep[i]]) ?? `Departamento ${ev.depCodes[ev.dep[i]]}`
  return ev.locNames[ev.loc[i]] || 'Fuera de los límites departamentales'
}

export function bboxInfo(idx: IndexData['bbox']): string {
  const c = (v: number, pos: string, neg: string) => `${String(Math.abs(v)).replace('.', ',')}° ${v >= 0 ? pos : neg}`
  return `${c(idx.lat_min, 'N', 'S')} a ${c(idx.lat_max, 'N', 'S')}; ${c(idx.lon_min, 'E', 'O')} a ${c(idx.lon_max, 'E', 'O')}`
}
