// Importación de catálogos en CSV, JSON o GeoJSON con validación estricta. Todo ocurre en el navegador:
// el archivo no se envía a ningún servidor y solo vive en la memoria de la pestaña.
import type { Events, GeoFC } from './data'
import { BBOX, locate } from './geo'

export const MAX_BYTES = 15 * 1024 * 1024
export const MAX_ROWS = 200_000
const ALLOWED = ['csv', 'json', 'geojson', 'txt']

export interface ImportIssue {
  rule: string
  count: number
  example?: string
}
export interface ImportResult {
  ok: boolean
  error?: string
  fileName: string
  format: string
  total: number
  accepted: number
  issues: ImportIssue[]
  mapping: Record<string, string>
  preview: { time: string; lat: number; lon: number; depth: number | null; mag: number; type: string; id: string }[]
  events?: Events
}

const ALIASES: Record<string, string[]> = {
  time: ['event_datetime_utc', 'fecha_hora_utc', 'datetime', 'time', 'fecha_hora', 'origin_time', 'fechahora'],
  date: ['fecha', 'date', 'fecha_utc'],
  hour: ['hora_utc', 'hora', 'time_utc', 'hour'],
  lat: ['latitude', 'latitud', 'lat', 'latitud_grados'],
  lon: ['longitude', 'longitud', 'lon', 'lng', 'long', 'longitud_grados'],
  depth: ['depth_km', 'profundidad', 'depth', 'profundidad_km', 'prof'],
  mag: ['magnitude', 'magnitud', 'mag', 'ml', 'mw'],
  type: ['magnitude_type', 'tipo_magnitud', 'magtype', 'tipo'],
  id: ['event_id', 'id', 'evento', 'eventid'],
}
const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/\(.*?\)/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')

/** Quita caracteres de control y recorta: ningún texto importado se interpreta como HTML ni como fórmula. */
export const sanitize = (v: unknown, max = 80): string =>
  String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>]/g, '')
    .trim()
    .slice(0, max)

export function parseCsv(text: string): string[][] {
  const first = text.slice(0, 2000).split('\n')[0] ?? ''
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : first.includes('\t') && !first.includes(',') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const c = text[i]
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') (cell += '"'), i++
        else quoted = false
      } else cell += c
    } else if (c === '"') quoted = true
    else if (c === sep) (row.push(cell), (cell = ''))
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++
      row.push(cell)
      cell = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
    } else cell += c
  }
  if (cell !== '' || row.length) (row.push(cell), rows.push(row))
  return rows.filter((r) => !(r[0] ?? '').startsWith('#'))
}

const toNum = (v: unknown): number => {
  if (typeof v === 'number') return v
  const s = String(v ?? '').trim()
  if (s === '') return NaN
  return Number(/^-?\d+,\d+$/.test(s) ? s.replace(',', '.') : s)
}
export function parseTime(v: unknown, hour?: unknown): number {
  if (typeof v === 'number') return v > 1e11 ? v / 1000 : v // milisegundos o segundos
  let s = String(v ?? '').trim()
  if (!s) return NaN
  if (hour != null && String(hour).trim()) s = `${s} ${String(hour).trim()}`
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?)?$/.exec(s)
  if (dmy) return Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1], +(dmy[4] ?? 0), +(dmy[5] ?? 0), Math.floor(+(dmy[6] ?? 0))) / 1000
  // Las horas sin zona se interpretan como UTC, que es como publica el SGC.
  const iso = /^\d{4}-\d{2}-\d{2}/.test(s) ? s.replace(' ', 'T') + (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? '' : s.length <= 10 ? 'T00:00:00Z' : 'Z') : s
  const t = Date.parse(iso)
  return Number.isFinite(t) ? t / 1000 : NaN
}

type Row = Record<string, unknown>
function toRows(text: string, ext: string): { rows: Row[]; format: string } {
  const trimmed = text.trimStart()
  if (ext === 'csv' || ext === 'txt' || !(trimmed.startsWith('{') || trimmed.startsWith('['))) {
    const table = parseCsv(text.replace(/^﻿/, ''))
    if (table.length < 2) throw new Error('El archivo CSV no tiene filas de datos.')
    const header = table[0].map(norm)
    return { format: 'CSV', rows: table.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]]))) }
  }
  const data = JSON.parse(text) as unknown
  const obj = data as { type?: string; features?: unknown[]; datos?: unknown; events?: unknown }
  if (obj && obj.type === 'FeatureCollection' && Array.isArray(obj.features))
    return {
      format: 'GeoJSON',
      rows: obj.features.map((f) => {
        const ft = f as { properties?: Row; geometry?: { type?: string; coordinates?: number[] }; id?: unknown }
        const p = Object.fromEntries(Object.entries(ft.properties ?? {}).map(([k, v]) => [norm(k), v]))
        const c = ft.geometry?.type === 'Point' ? ft.geometry.coordinates : undefined
        return { ...p, ...(c ? { __lon: c[0], __lat: c[1] } : {}), ...(ft.id != null && p.id == null ? { id: ft.id } : {}) }
      }),
    }
  const arr = Array.isArray(data) ? data : Array.isArray(obj?.datos) ? obj.datos : Array.isArray(obj?.events) ? obj.events : null
  if (!arr) throw new Error('El JSON debe ser una lista de eventos, un objeto con «datos» o «events», o un GeoJSON FeatureCollection.')
  return { format: 'JSON', rows: (arr as Row[]).map((r) => Object.fromEntries(Object.entries(r ?? {}).map(([k, v]) => [norm(k), v]))) }
}

export async function importFile(file: File, depGeo: GeoFC | null): Promise<ImportResult> {
  const base: ImportResult = { ok: false, fileName: sanitize(file.name, 120), format: '', total: 0, accepted: 0, issues: [], mapping: {}, preview: [] }
  const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
  if (!ALLOWED.includes(ext)) return { ...base, error: `Tipo de archivo no admitido (.${sanitize(ext, 10)}). Use CSV, JSON o GeoJSON.` }
  if (file.size > MAX_BYTES) return { ...base, error: `El archivo supera el límite de ${MAX_BYTES / 1024 / 1024} MB.` }
  if (file.size === 0) return { ...base, error: 'El archivo está vacío.' }
  let text: string
  try {
    text = await file.text()
  } catch {
    return { ...base, error: 'No fue posible leer el archivo.' }
  }
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008]/.test(text.slice(0, 4000))) return { ...base, error: 'El archivo parece binario. Solo se admite texto en CSV, JSON o GeoJSON.' }
  return importText(text, base.fileName, ext, depGeo)
}

export function importText(text: string, fileName: string, ext: string, depGeo: GeoFC | null): ImportResult {
  const base: ImportResult = { ok: false, fileName, format: '', total: 0, accepted: 0, issues: [], mapping: {}, preview: [] }
  let rows: Row[]
  let format: string
  try {
    ;({ rows, format } = toRows(text, ext))
  } catch (e) {
    return { ...base, error: e instanceof SyntaxError ? 'El archivo no es un JSON válido.' : (e as Error).message }
  }
  if (rows.length > MAX_ROWS) return { ...base, format, error: `El archivo tiene ${rows.length.toLocaleString('es-CO')} filas; el máximo es ${MAX_ROWS.toLocaleString('es-CO')}.` }
  if (!rows.length) return { ...base, format, error: 'El archivo no contiene eventos.' }
  const keys = new Set(rows.slice(0, 50).flatMap((r) => Object.keys(r)))
  const mapping: Record<string, string> = {}
  for (const [field, names] of Object.entries(ALIASES)) {
    const hit = names.find((n) => keys.has(n))
    if (hit) mapping[field] = hit
  }
  if (keys.has('__lat')) (mapping.lat = '__lat'), (mapping.lon = '__lon')
  const missing = [!(mapping.time || mapping.date) && 'fecha y hora', !mapping.lat && 'latitud', !mapping.lon && 'longitud', !mapping.mag && 'magnitud'].filter(Boolean)
  if (missing.length) return { ...base, format, total: rows.length, mapping, error: `Faltan columnas obligatorias: ${missing.join(', ')}. Columnas encontradas: ${[...keys].filter((k) => !k.startsWith('__')).slice(0, 12).map((k) => sanitize(k, 30)).join(', ')}.` }

  const issues = new Map<string, ImportIssue>()
  const flag = (rule: string, example: string) => {
    const i = issues.get(rule) ?? { rule, count: 0, example }
    i.count++
    issues.set(rule, i)
  }
  const now = Date.now() / 1000 + 86400
  const seen = new Set<string>()
  const out: { t: number; lat: number; lon: number; depth: number; mag: number; type: string; id: string }[] = []
  rows.forEach((r, n) => {
    const line = `fila ${n + 2}`
    const t = mapping.time ? parseTime(r[mapping.time]) : parseTime(r[mapping.date], mapping.hour ? r[mapping.hour] : undefined)
    const lat = toNum(r[mapping.lat])
    const lon = toNum(r[mapping.lon])
    const mag = toNum(r[mapping.mag])
    const depth = mapping.depth ? toNum(r[mapping.depth]) : NaN
    if (!Number.isFinite(t) || t < -1.2e10 || t > now) return flag('Fecha ilegible o futura', line)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return flag('Coordenadas inválidas', line)
    if (lat < BBOX.lat_min || lat > BBOX.lat_max || lon < BBOX.lon_min || lon > BBOX.lon_max) return flag('Fuera de la ventana de estudio (Colombia y alrededores)', line)
    if (!Number.isFinite(mag) || mag < -1 || mag > 9.5) return flag('Magnitud ausente o fuera de rango (−1 a 9,5)', line)
    const key = `${Math.round(t)}|${lat.toFixed(3)}|${lon.toFixed(3)}|${mag.toFixed(1)}`
    if (seen.has(key)) return flag('Registro duplicado', line)
    seen.add(key)
    let d = depth
    if (Number.isFinite(d) && (d < 0 || d > 800)) (flag('Profundidad fuera de rango (se conserva el evento sin profundidad)', line), (d = NaN))
    out.push({ t, lat, lon, depth: d, mag, type: sanitize(mapping.type ? r[mapping.type] : '', 12) || 'M', id: sanitize(mapping.id ? r[mapping.id] : '', 48) || `IMP-${n + 1}` })
  })
  out.sort((a, b) => a.t - b.t)
  const res: ImportResult = {
    ...base,
    ok: out.length > 0,
    format,
    total: rows.length,
    accepted: out.length,
    issues: [...issues.values()],
    mapping: Object.fromEntries(Object.entries(mapping).map(([k, v]) => [k, v.startsWith('__') ? 'geometría del GeoJSON' : v])),
    preview: out.slice(0, 12).map((e) => ({ time: new Date(e.t * 1000).toISOString().replace('.000', ''), lat: e.lat, lon: e.lon, depth: Number.isFinite(e.depth) ? e.depth : null, mag: e.mag, type: e.type, id: e.id })),
    error: out.length ? undefined : 'Ninguna fila superó la validación.',
  }
  if (!out.length) return res
  const n = out.length
  const types = [...new Set(out.map((e) => e.type))]
  const depCodes = depGeo ? depGeo.features.map((f) => f.properties.id) : []
  res.events = {
    n,
    t: Float64Array.from(out, (e) => e.t),
    lon: Float32Array.from(out, (e) => e.lon),
    lat: Float32Array.from(out, (e) => e.lat),
    depth: Float32Array.from(out, (e) => e.depth),
    mag: Float32Array.from(out, (e) => e.mag),
    mt: Uint8Array.from(out, (e) => types.indexOf(e.type)),
    dep: Int8Array.from(out, (e) => (depGeo ? locate(depGeo, e.lon, e.lat) : -1)),
    mun: new Int16Array(n).fill(-1),
    loc: new Int16Array(n),
    q: new Uint8Array(n),
    err: new Float32Array(n).fill(NaN),
    src: new Uint8Array(n),
    status: new Uint8Array(n).fill(1),
    dflag: new Uint8Array(n),
    id: out.map((e) => e.id),
    mtNames: types,
    depCodes,
    munCodes: [],
    locNames: ['Fuera de los límites departamentales'],
    qNames: ['N'],
    sources: [{ key: 'importado', name: `Archivo importado: ${fileName}`, event_url: null, query_url: '' }],
    imported: { name: fileName, importedAt: new Date().toISOString() },
  }
  return res
}
