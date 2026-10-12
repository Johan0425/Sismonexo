import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { decodeEvents, eventId, eventUrl, type Events, type ForecastFile, type ZoneTable } from './data'
import { pdfText, provenance, toCsv } from './export'
import { dayEnd, dayStart, fmtDateTime, fmtPct, fmtSigned, fold, isIsoDay, isoDay } from './format'
import { assignZones, filterEvents, haversineKm, pointInGeometry } from './geo'
import { importText, parseCsv, parseTime, sanitize } from './importer'
import { intervalFor, isoApply, originDays, predictAll, zoneVector } from './models'
import { extractFilters, findDepts, parseQuery } from './nexo'
import { contrast, depthClass, P_CLASSES, pClass, pPosition } from './scales'
import { baselineForecast, binStart, bValue, gammaQuantile, histogram, normInv, timeSeries } from './stats'
import { DEFAULT_FC, DEFAULT_FILTERS, fromQuery, isTrained, sanitizeFilters, toQuery, useApp } from './store'

const DATA = resolve(__dirname, '../../public/data')
const json = <T,>(p: string) => JSON.parse(readFileSync(resolve(DATA, p), 'utf8')) as T

// Catálogo mínimo de prueba (valores inventados SOLO para pruebas automáticas; nunca se muestra en la aplicación).
function tiny(): Events {
  const t = ['2024-01-01T04:30:00Z', '2024-01-01T23:59:59Z', '2024-03-10T12:00:00Z', '2025-06-01T00:00:00Z'].map((s) => Date.parse(s) / 1000)
  return decodeEvents({
    n: 4, t, lon: [-73.1, -73.2, -77.5, -75.0], lat: [6.8, 6.8, 1.5, 4.5], depth: [150, null, 20, 45], mag: [3.1, 4.2, 5.5, 2.6],
    mt: [0, 0, 1, 1], mt_names: ['ML', 'MLr'], dep: [0, 0, 1, -1], dep_codes: ['68', '52'], mun: [0, 0, -1, -1], mun_codes: ['68418'],
    loc: [0, 0, 0, 1], loc_names: ['', 'Océano Pacífico'], q: [0, 1, 0, 2], q_names: ['A', 'B', 'D'], err: [2, null, 4, 30], src: [1, 1, 0, 0],
    status: [1, 1, 1, 0], dflag: [0, 0, 0, 0], id: ['abc123', 'def456', 'SGC2024xyz', 'SGC2025abc'],
    sources: [{ key: 'rsnc_seiscomp', name: 'SeisComP', event_url: 'https://ejemplo.test/{id}/{id}.xml', query_url: 'https://ejemplo.test/q' }, { key: 'rsnc_seisan', name: 'SEISAN', event_url: null, query_url: 'https://ejemplo.test/seisan' }],
  })
}

describe('formato y zonas horarias', () => {
  it('nunca muestra 0 % ni 100 %', () => {
    expect(fmtPct(0)).toBe('< 0,1 %')
    expect(fmtPct(0.999999)).toBe('> 99 %')
    expect(fmtPct(0.2)).toMatch(/^20\s?%$/)
    expect(fmtPct(0.034)).toMatch(/^3,4\s?%$/)
    expect(fmtPct(null)).toBe('—')
  })
  it('convierte de UTC a hora de Colombia (UTC−5) cambiando de día cuando corresponde', () => {
    const t = Date.parse('2024-01-01T04:30:00Z') / 1000
    expect(fmtDateTime(t, 'utc')).toContain('1 de ene de 2024')
    expect(fmtDateTime(t, 'utc')).toContain('04:30')
    expect(fmtDateTime(t, 'colombia')).toContain('31 de dic de 2023')
    expect(fmtDateTime(t, 'colombia')).toContain('23:30')
    expect(fmtDateTime(t, 'colombia')).toContain('hora de Colombia')
  })
  it('los filtros de fecha usan días UTC completos', () => {
    expect(dayStart('2024-01-01')).toBe(Date.UTC(2024, 0, 1) / 1000)
    expect(dayEnd('2024-01-01') - dayStart('2024-01-01')).toBe(86399)
    expect(isoDay(dayEnd('2024-12-31'))).toBe('2024-12-31')
    expect(isIsoDay('2024-02-30x')).toBe(false)
    expect(isIsoDay('2024-13-01')).toBe(false)
  })
  it('usa signo explícito y pliega tildes', () => {
    expect(fmtSigned(-1.25, 1)).toBe('−1,3')
    expect(fmtSigned(2, 0, ' pts')).toBe('+2 pts')
    expect(fold('Nariño, Bogotá')).toBe('narino, bogota')
  })
})

describe('escalas', () => {
  it('asigna clases de probabilidad con cortes fijos', () => {
    expect(pClass(0).label).toBe('Muy baja')
    expect(pClass(0.01).label).toBe('Baja')
    expect(pClass(0.149).label).toBe('Moderada')
    expect(pClass(0.15).label).toBe('Media')
    expect(pClass(0.99).label).toBe('Muy alta')
    expect(pPosition(0)).toBe(0)
    expect(pPosition(1)).toBe(1)
    expect(pPosition(0.3)).toBeGreaterThan(pPosition(0.2))
  })
  it('cada clase tiene color, etiqueta, rango y patrón propios', () => {
    expect(new Set(P_CLASSES.map((c) => c.color)).size).toBe(6)
    expect(new Set(P_CLASSES.map((c) => c.pattern)).size).toBe(6)
  })
  it('clasifica la profundidad y mide contraste', () => {
    expect(depthClass(29.9)?.label).toBe('0–30 km')
    expect(depthClass(30)?.label).toBe('30–60 km')
    expect(depthClass(650)?.label).toBe('Más de 300 km')
    expect(depthClass(NaN)).toBeNull()
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
  })
})

describe('filtros de eventos', () => {
  const ev = tiny()
  it('filtra por fecha con límites inclusivos de día UTC', () => {
    expect(Array.from(filterEvents(ev, { ...DEFAULT_FILTERS, from: '2024-01-01', to: '2024-01-01' }))).toEqual([0, 1])
    expect(Array.from(filterEvents(ev, { ...DEFAULT_FILTERS, from: '2024-01-02', to: '2024-12-31' }))).toEqual([2])
  })
  it('filtra por magnitud, departamento y calidad', () => {
    expect(Array.from(filterEvents(ev, { ...DEFAULT_FILTERS, magMin: 4 }))).toEqual([1, 2])
    expect(Array.from(filterEvents(ev, { ...DEFAULT_FILTERS, dept: '68' }))).toEqual([0, 1])
    expect(Array.from(filterEvents(ev, { ...DEFAULT_FILTERS, quality: 'AB' }))).toEqual([0, 1, 2])
  })
  it('excluye eventos sin profundidad solo cuando se filtra por profundidad', () => {
    expect(filterEvents(ev, DEFAULT_FILTERS).length).toBe(4)
    expect(Array.from(filterEvents(ev, { ...DEFAULT_FILTERS, depthMin: 0, depthMax: 200 }))).toEqual([0, 2, 3])
  })
  it('reconstruye identificadores y enlaces al registro original', () => {
    expect(eventId(ev, 0)).toBe('SGC-SEISAN-20240101043000-abc123')
    expect(eventId(ev, 2)).toBe('SGC2024xyz')
    expect(eventUrl(ev, 2)).toEqual({ url: 'https://ejemplo.test/SGC2024xyz/SGC2024xyz.xml', direct: true })
    expect(eventUrl(ev, 0)?.direct).toBe(false)
  })
})

describe('geometría', () => {
  it('calcula distancias de círculo máximo', () => {
    expect(haversineKm(-74, 4, -74, 5)).toBeCloseTo(111.2, 0)
    expect(haversineKm(-74, 4, -74, 4)).toBe(0)
  })
  it('detecta puntos dentro de polígonos con huecos', () => {
    const g: GeoJSON.Polygon = { type: 'Polygon', coordinates: [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]], [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]]] }
    expect(pointInGeometry(1, 1, g)).toBe(true)
    expect(pointInGeometry(5, 5, g)).toBe(false)
    expect(pointInGeometry(11, 5, g)).toBe(false)
  })
  it('asigna eventos a la cuadrícula igual que el pipeline', async () => {
    const ev = tiny()
    const ids = ['g50-21-26', 'g50-22-26', 'g50-12-14']
    const zt = { unit: 'g50', id: ids, index: new Map(ids.map((id, i) => [id, i])) } as unknown as ZoneTable
    // lon −73,1 → ix = floor((−73,1 + 83) / 0,45) = 22; lat 6,8 → iy = floor((6,8 + 5) / 0,45) = 26
    expect(Array.from(await assignZones(ev, zt))).toEqual([1, 0, 2, -1])
  })
})

describe('estado, historial y URL compartible', () => {
  beforeEach(() => useApp.setState({ filters: DEFAULT_FILTERS, fc: DEFAULT_FC, past: [], future: [] }))
  it('corrige filtros inválidos', () => {
    const f = sanitizeFilters({ ...DEFAULT_FILTERS, from: '2025-01-01', to: '2024-01-01', magMin: 7, magMax: 3, depthMin: -5, depthMax: 9999, dept: 'x' })
    expect(f.from <= f.to).toBe(true)
    expect(f.magMax).toBeGreaterThanOrEqual(f.magMin)
    expect(f.depthMin).toBe(0)
    expect(f.depthMax).toBe(700)
    expect(f.dept).toBe('')
  })
  it('serializa y recupera el estado completo', () => {
    const s = useApp.getState()
    const state = { ...s, filters: { ...DEFAULT_FILTERS, from: '2020-01-01', magMin: 4, dept: '68', quality: 'AB' as const }, fc: { ...DEFAULT_FC, unit: 'mun' as const, h: 90, thr: 5, model: 'pois' as const }, selection: { kind: 'zona' as const, unit: 'mun' as const, id: '68418' }, zoneMetric: 'cambio' as const }
    const q = new URLSearchParams(toQuery(state))
    const back = fromQuery(q, s)
    expect(back.filters).toEqual(state.filters)
    expect(back.fc).toEqual(state.fc)
    expect(back.selection).toEqual(state.selection)
    expect(back.zoneMetric).toBe('cambio')
  })
  it('no escribe en la URL los valores por defecto', () => {
    expect(toQuery(useApp.getState())).toBe('')
  })
  it('deshace y rehace cambios de filtros', () => {
    const s = useApp.getState()
    s.setFilters({ magMin: 4 }, 'Magnitud ≥ 4')
    s.setFilters({ dept: '68' }, 'Santander')
    expect(useApp.getState().past).toHaveLength(2)
    useApp.getState().undo()
    expect(useApp.getState().filters).toMatchObject({ magMin: 4, dept: '' })
    useApp.getState().undo()
    expect(useApp.getState().filters).toEqual(DEFAULT_FILTERS)
    useApp.getState().redo()
    expect(useApp.getState().filters.magMin).toBe(4)
    expect(useApp.getState().live).toContain('rehízo')
  })
  it('distingue configuraciones entrenadas de la línea base recalculada', () => {
    const d = { depthMin: 0, depthMax: 700 }
    expect(isTrained(DEFAULT_FC, d)).toBe(true)
    expect(isTrained({ ...DEFAULT_FC, h: 45 }, d)).toBe(false)
    expect(isTrained({ ...DEFAULT_FC, thr: 4.5 }, d)).toBe(false)
    expect(isTrained({ ...DEFAULT_FC, smooth: 1 }, d)).toBe(false)
    expect(isTrained(DEFAULT_FC, { depthMin: 0, depthMax: 60 })).toBe(false)
  })
})

describe('estadística', () => {
  it('aproxima cuantiles normales y gamma', () => {
    expect(normInv(0.975)).toBeCloseTo(1.96, 2)
    expect(gammaQuantile(10, 0.5)).toBeCloseTo(9.67, 1)
    expect(gammaQuantile(0.5, 0.05)).toBeGreaterThanOrEqual(0)
  })
  it('agrupa series por mes sin perder eventos', () => {
    const ev = tiny()
    const ts = timeSeries(ev, [0, 1, 2, 3], 'mes', ev.t[0], ev.t[3])
    expect(ts.count.reduce((a, b) => a + b, 0)).toBe(4)
    expect(ts.count[0]).toBe(2)
    expect(ts.maxMag[0]).toBeCloseTo(4.2)
    expect(binStart(Date.parse('2024-03-10T12:00:00Z') / 1000, 'semana')).toBe(Date.UTC(2024, 2, 4) / 1000) // lunes
  })
  it('calcula histogramas y el valor b', () => {
    expect(histogram([2.5, 2.9, 3.0, 7.9], 2.5, 0.5, 9)).toEqual([2, 1, 0, 0, 0, 0, 0, 0, 1])
    expect(bValue([3, 3.1], 3)).toBeNull()
  })
  it('la línea base produce probabilidades válidas, intervalos ordenados y encoge hacia la media', () => {
    const ev = tiny()
    const zt = { unit: 'dep', id: ['68', '52', '05'], lon: [-73, -77, -75], lat: [7, 1.5, 6.5], area_km2: [30000, 33000, 63000] } as unknown as ZoneTable
    const r = baselineForecast({ ev, zoneOf: Int32Array.from([0, 0, 1, -1]), zt, threshold: 4, horizon: 30, depthMin: 0, depthMax: 700, histFromYear: 1993, endT: ev.t[3] + 86400, smooth: 0 })
    for (let z = 0; z < 3; z++) {
      expect(r.p[z]).toBeGreaterThan(0)
      expect(r.p[z]).toBeLessThan(1)
      expect(r.lo[z]).toBeLessThanOrEqual(r.p[z])
      expect(r.hi[z]).toBeGreaterThanOrEqual(r.p[z])
    }
    expect(r.p[2]).toBeGreaterThan(0) // zona sin eventos: nunca probabilidad cero
    expect(r.p[0]).toBeGreaterThan(r.p[2])
    expect(Array.from(r.n)).toEqual([1, 1, 0])
  })
})

describe('modelos exportados (paridad con el pipeline)', () => {
  const fc = json<ForecastFile>('fc/dep-30-40.json')
  it('reproduce en el navegador las probabilidades calculadas en Python', () => {
    const od = originDays(fc)
    for (let zi = 0; zi < fc.forecast.zone_ids.length; zi++) {
      const pred = predictAll(fc.lab.models, fc.features, zoneVector(fc, zi), fc.config.horizon_days, od)
      for (const k of ['base', 'logit', 'pois', 'etas', 'hgb', 'hyb'] as const) {
        // Las variables se exportan redondeadas a 3 decimales: se admite una diferencia pequeña.
        expect(Math.abs((pred.p[k] as number) - (fc.forecast.p[k] as number[])[zi]), `${k} zona ${zi}`).toBeLessThan(0.02)
      }
    }
  })
  it('la calibración isotónica es monótona y nunca devuelve 0 ni 1 exactos', () => {
    const iso = fc.lab.models.hgb.iso
    let prev = -1
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const v = isoApply(iso, p)
      expect(v).toBeGreaterThanOrEqual(prev)
      expect(v).toBeGreaterThan(0)
      expect(v).toBeLessThan(1)
      prev = v
    }
  })
  it('el intervalo de incertidumbre siempre contiene la estimación', () => {
    for (const p of [0.0005, 0.02, 0.3, 0.9]) {
      const [lo, hi] = intervalFor(fc, 'pois', p)
      expect(lo).toBeLessThanOrEqual(p)
      expect(hi).toBeGreaterThanOrEqual(p)
    }
  })
  it('la validación exportada es cronológica y con separación temporal', () => {
    for (const f of fc.folds) {
      const gap = fc.config.horizon_days * 86400000
      expect(Date.parse(f.train[1]) + gap).toBeLessThanOrEqual(Date.parse(f.val[0]))
      expect(Date.parse(f.val[1]) + gap).toBeLessThanOrEqual(Date.parse(f.test[0]))
      expect(f.gap_days).toBe(fc.config.horizon_days)
    }
    const tests = fc.folds.map((f) => Date.parse(f.test[0]))
    expect([...tests].sort((a, b) => a - b)).toEqual(tests)
    expect(fc.leakage.filter((l) => l.status === 'falla')).toEqual([])
    expect(fc.leakage).toHaveLength(6)
  })
})

describe('importación de archivos', () => {
  const csv = ['# comentario', 'FECHA,HORA_UTC,LATITUD (grados),LONGITUD (grados),PROFUNDIDAD (Km),MAGNITUD', '2024-05-01,10:20:30,6.80,-73.10,150.2,4.1', '2024-05-01,10:20:30,6.80,-73.10,150.2,4.1', '2024-05-02,00:00:00,95,-73,10,3.0', '2024-05-03,00:00:00,48.8,2.3,10,3.0', '2024-05-04,00:00:00,5.0,-74.0,10,', 'no-es-fecha,,5,-74,10,3', '2024-05-05,12:00:00,"4,5",-75.5,9999,5.2'].join('\n')
  it('valida un CSV, rechaza filas inválidas y explica por qué', () => {
    const r = importText(csv, 'prueba.csv', 'csv', null)
    expect(r.ok).toBe(true)
    expect(r.format).toBe('CSV')
    expect(r.total).toBe(7)
    expect(r.accepted).toBe(2)
    const rules = Object.fromEntries(r.issues.map((i) => [i.rule, i.count]))
    expect(rules['Registro duplicado']).toBe(1)
    expect(rules['Coordenadas inválidas']).toBe(1)
    expect(rules['Fuera de la ventana de estudio (Colombia y alrededores)']).toBe(1)
    expect(rules['Magnitud ausente o fuera de rango (−1 a 9,5)']).toBe(1)
    expect(rules['Fecha ilegible o futura']).toBe(1)
    expect(r.events?.imported?.name).toBe('prueba.csv')
    expect(r.events?.t[0]).toBe(Date.parse('2024-05-01T10:20:30Z') / 1000)
    expect(Number.isNaN(r.events?.depth[1])).toBe(true) // profundidad fuera de rango: se conserva el evento sin ella
    expect(r.events?.lat[1]).toBeCloseTo(4.5)
  })
  it('acepta GeoJSON y JSON y exige las columnas obligatorias', () => {
    const gj = JSON.stringify({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'x1', properties: { event_datetime_utc: '2023-01-01T00:00:00Z', magnitude: 3.3, depth_km: 12 }, geometry: { type: 'Point', coordinates: [-75, 5] } }] })
    const r = importText(gj, 'a.geojson', 'geojson', null)
    expect(r.format).toBe('GeoJSON')
    expect(r.accepted).toBe(1)
    expect(r.preview[0].id).toBe('x1')
    expect(importText('[{"latitud":5,"longitud":-74}]', 'b.json', 'json', null).error).toContain('Faltan columnas obligatorias')
    expect(importText('{mal', 'c.json', 'json', null).error).toBe('El archivo no es un JSON válido.')
  })
  it('sanea textos y fechas', () => {
    expect(sanitize('<script>alert(1)</script>\u0000')).toBe('scriptalert(1)/script')
    expect(sanitize('a'.repeat(500)).length).toBe(80)
    expect(parseTime('15/08/2023 03:04:05')).toBe(Date.UTC(2023, 7, 15, 3, 4, 5) / 1000)
    expect(parseTime('2023-08-15 03:04:05')).toBe(Date.UTC(2023, 7, 15, 3, 4, 5) / 1000)
    expect(parseCsv('a;b\n1;"x;y"')).toEqual([['a', 'b'], ['1', 'x;y']])
  })
})

describe('exportaciones', () => {
  const index = { dataset_version: 'rsnc-prueba', app: { author: 'Johan Antonio Peña López', institution: 'Institución Universitaria EAM' } } as never
  it('todo CSV lleva fuente, versión y advertencia, y neutraliza fórmulas', () => {
    const csv = toCsv(['a', 'b'], [['=SUMA(A1)', 1.5], ['texto, con coma', null]], provenance(index, 'Prueba', { version_modelo: 'sn-x' }))
    expect(csv.charCodeAt(0)).toBe(0xfeff)
    expect(csv).toContain('# Fuente: Servicio Geológico Colombiano')
    expect(csv).toContain('# Versión del conjunto de datos: rsnc-prueba')
    expect(csv).toContain('# Versión del modelo: sn-x')
    expect(csv).toContain('# Advertencia: Esta plataforma presenta estimaciones académicas')
    expect(csv).toContain("'=SUMA(A1),1.5")
    expect(csv).toContain('"texto, con coma",')
  })
  it('adapta símbolos que las fuentes estándar de PDF no tienen', () => {
    expect(pdfText('M ≥ 4,0 → −2 ≈ 3')).toBe('M >= 4,0 -> -2 ~ 3')
  })
})

describe('asistente Nexo', () => {
  const depts = [{ code: '68', name: 'Santander' }, { code: '54', name: 'Norte de Santander' }, { code: '05', name: 'Antioquia' }, { code: '52', name: 'Nariño' }, { code: '11', name: 'Bogotá, D. C.' }]
  const today = '2026-10-10'
  it('convierte una consulta en filtros y explica cuáles aplicó', () => {
    const it1 = parseQuery('Muéstrame los eventos de magnitud mayor a 4 en Santander durante 2024.', depts, today)
    expect(it1).toMatchObject({ kind: 'filtrar', patch: { magMin: 4, dept: '68', from: '2024-01-01', to: '2024-12-31' } })
    expect((it1 as { applied: string[] }).applied).toHaveLength(3)
    expect(extractFilters('sismos superficiales de los últimos 30 días', depts, today).patch).toMatchObject({ depthMin: 0, depthMax: 30, from: '2026-09-10', to: today })
  })
  it('no confunde Norte de Santander con Santander', () => {
    expect(findDepts('eventos en Norte de Santander', depts).map((d) => d.code)).toEqual(['54'])
    expect(findDepts('compara Antioquia y Nariño', depts).map((d) => d.code)).toEqual(['05', '52'])
  })
  it('reconoce las consultas de ejemplo', () => {
    expect(parseQuery('Compara la profundidad promedio de Antioquia y Nariño.', depts, today)).toMatchObject({ kind: 'comparar-profundidad', depts: ['05', '52'] })
    expect(parseQuery('¿Qué zonas tuvieron mayor actividad en los últimos 30 días?', depts, today)).toEqual({ kind: 'mayor-actividad', days: 30 })
    expect(parseQuery('Explícame por qué esta celda tiene una probabilidad superior a su promedio.', depts, today).kind).toBe('explicar-zona')
    expect(parseQuery('Crea un informe de esta zona.', depts, today).kind).toBe('informe-zona')
    expect(parseQuery('¿Qué significa el Brier score?', depts, today)).toMatchObject({ kind: 'glosario', term: { id: 'brier' } })
    expect(parseQuery('¿Cuál modelo está mejor calibrado?', depts, today).kind).toBe('mejor-calibrado')
  })
  it('no emite alertas y reconoce cuando no sabe', () => {
    expect(parseQuery('¿Va a temblar mañana en Bogotá?', depts, today).kind).toBe('no-alerta')
    expect(parseQuery('¿Debo evacuar?', depts, today).kind).toBe('no-alerta')
    expect(parseQuery('¿Cuál es la diferencia entre amenaza y riesgo?', depts, today).kind).toBe('distinguir')
    expect(parseQuery('¿Quién ganó el partido?', depts, today).kind).toBe('desconocido')
  })
})
