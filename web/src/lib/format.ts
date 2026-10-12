// Formato de números y fechas en español de Colombia.
// Las horas del catálogo están en UTC; la hora de Colombia es UTC−5 todo el año (sin horario de verano).

export type TimeZoneMode = 'colombia' | 'utc'

const nf = (o: Intl.NumberFormatOptions) => new Intl.NumberFormat('es-CO', o)
const INT = nf({ maximumFractionDigits: 0 })
const DEC = [0, 1, 2, 3, 4].map((d) => nf({ minimumFractionDigits: d, maximumFractionDigits: d }))

export const fmtInt = (n: number | null | undefined) => (n == null || !Number.isFinite(n) ? '—' : INT.format(n))

export const fmtNum = (n: number | null | undefined, digits = 1) =>
  n == null || !Number.isFinite(n) ? '—' : DEC[Math.min(4, Math.max(0, digits))].format(n)

/** Probabilidad como porcentaje. Nunca muestra 0 % ni 100 %: un modelo no ofrece certezas. */
export function fmtPct(p: number | null | undefined, digits?: number): string {
  if (p == null || !Number.isFinite(p)) return '—'
  if (p < 0.001) return '< 0,1 %'
  if (p > 0.99) return '> 99 %'
  const d = digits ?? (p < 0.1 ? 1 : 0)
  return `${fmtNum(p * 100, d)} %`
}

export const fmtShare = (p: number | null | undefined, digits = 1) =>
  p == null || !Number.isFinite(p) ? '—' : `${fmtNum(p * 100, digits)} %`

export const fmtMag = (m: number | null | undefined) => (m == null || !Number.isFinite(m) ? '—' : fmtNum(m, 1))
export const fmtKm = (k: number | null | undefined, digits = 0) =>
  k == null || !Number.isFinite(k) ? '—' : `${fmtNum(k, digits)} km`

export function fmtSigned(n: number | null | undefined, digits = 1, suffix = ''): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const s = n > 0 ? '+' : n < 0 ? '−' : '±'
  return `${s}${fmtNum(Math.abs(n), digits)}${suffix}`
}

export function fmtCoord(lat: number, lon: number): string {
  return `${fmtNum(Math.abs(lat), 3)}° ${lat >= 0 ? 'N' : 'S'}, ${fmtNum(Math.abs(lon), 3)}° ${lon >= 0 ? 'E' : 'O'}`
}

const dtf = (tz: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat('es-CO', { timeZone: tz, ...o })
const TZ = { colombia: 'America/Bogota', utc: 'UTC' } as const
const cache = new Map<string, Intl.DateTimeFormat>()
function f(mode: TimeZoneMode, key: string, o: Intl.DateTimeFormatOptions) {
  const k = mode + key
  let v = cache.get(k)
  if (!v) cache.set(k, (v = dtf(TZ[mode], o)))
  return v
}
const toDate = (t: number | string | Date) => (t instanceof Date ? t : typeof t === 'number' ? new Date(t * 1000) : new Date(t))
export const tzLabel = (mode: TimeZoneMode) => (mode === 'utc' ? 'UTC' : 'hora de Colombia')

/** t: segundos desde época Unix, cadena ISO o Date. */
export function fmtDateTime(t: number | string | Date, mode: TimeZoneMode = 'colombia'): string {
  const s = f(mode, 'dt', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(toDate(t))
  return `${s} (${tzLabel(mode)})`
}
export const fmtDate = (t: number | string | Date, mode: TimeZoneMode = 'utc') =>
  f(mode, 'd', { day: 'numeric', month: 'short', year: 'numeric' }).format(toDate(t))
export const fmtDateLong = (t: number | string | Date, mode: TimeZoneMode = 'utc') =>
  f(mode, 'dl', { day: 'numeric', month: 'long', year: 'numeric' }).format(toDate(t))
export const fmtMonth = (t: number | string | Date) => f('utc', 'm', { month: 'short', year: 'numeric' }).format(toDate(t))
export const fmtYear = (t: number) => String(new Date(t * 1000).getUTCFullYear())

/** Día ISO (AAAA-MM-DD) en UTC ↔ segundos. Los filtros de fecha trabajan con días UTC completos. */
export const isoDay = (t: number) => new Date(t * 1000).toISOString().slice(0, 10)
export const dayStart = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000
export const dayEnd = (iso: string) => Date.parse(`${iso}T23:59:59Z`) / 1000
export const isIsoDay = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && Number.isFinite(Date.parse(`${s}T00:00:00Z`))

export function fmtDuration(days: number): string {
  if (!Number.isFinite(days)) return '—'
  if (days < 1) return 'menos de un día'
  if (days < 60) return `${fmtInt(days)} ${Math.round(days) === 1 ? 'día' : 'días'}`
  if (days < 730) return `${fmtInt(days / 30.44)} meses`
  return `${fmtNum(days / 365.25, 1)} años`
}

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${fmtNum(n / 1024, 0)} kB`
  return `${fmtNum(n / 1024 ** 2, 1)} MB`
}

export const plural = (n: number, one: string, many: string) => `${fmtInt(n)} ${n === 1 ? one : many}`

/** Normaliza para búsquedas: minúsculas y sin tildes. */
export const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** Nombre de modelo dentro de una frase: minúscula inicial sin dañar siglas ni nombres propios (ML, ETAS, Poisson). */
export const inPhrase = (name = "") => (/^(Poisson|Random)/.test(name) ? name : name.charAt(0).toLowerCase() + name.slice(1))
