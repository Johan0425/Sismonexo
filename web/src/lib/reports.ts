// Generación de informes. Cada informe se arma con datos reales y lleva autor, institución, fecha, filtros,
// fuente, versión del modelo, mapa, gráfico, tabla principal, interpretación, limitaciones y advertencia.
import { eventId, forecastId, loadEvents, loadForecast, loadGeo, loadQuality, MODEL_ORDER, type Events, type GeoFC, type IndexData } from './data'
import { provenance, type Cell, type ReportDoc, type ReportSection } from './export'
import { dayEnd, dayStart, fmtDate, fmtInt, fmtKm, fmtMag, fmtNum, fmtPct, fmtShare, fmtSigned, isoDay, inPhrase } from './format'
import { filterEvents, placeName, zonePolygons } from './geo'
import { depthClass, DEPTH_CLASSES, NO_DATA_COLOR, P_CLASSES, pClass } from './scales'
import { summarize, timeSeries } from './stats'
import { describeFilters, isTrained, type Filters, type ForecastParams } from './store'
import { loadZoneData, type ZoneData } from './zonedata'

export type ReportType = 'zona' | 'periodo' | 'historico' | 'probabilistico' | 'modelos' | 'calidad' | 'ejecutivo' | 'metodologico'
export const REPORT_TYPES: { value: ReportType; label: string; description: string }[] = [
  { value: 'ejecutivo', label: 'Resumen ejecutivo', description: 'Una página con las cifras y mensajes principales' },
  { value: 'zona', label: 'Informe por zona', description: 'Estimación, actividad observada y contexto de una zona' },
  { value: 'periodo', label: 'Informe por periodo', description: 'Actividad registrada con los filtros activos' },
  { value: 'historico', label: 'Informe de actividad histórica', description: 'Evolución del catálogo completo año a año' },
  { value: 'probabilistico', label: 'Informe probabilístico', description: 'Pronóstico vigente por zona con su incertidumbre' },
  { value: 'modelos', label: 'Comparación de modelos', description: 'Métricas de validación de las familias de modelos' },
  { value: 'calidad', label: 'Informe de calidad de datos', description: 'Indicadores, reglas de limpieza y cobertura' },
  { value: 'metodologico', label: 'Anexo metodológico', description: 'Método, validación y limitaciones' },
]
export const LIMITATIONS = [
  'No se predicen terremotos individuales: las estimaciones son probabilidades por zona y periodo.',
  'Los eventos de magnitud alta son escasos; para M ≥ 5,0 las diferencias entre modelos son poco fiables.',
  'El catálogo cambió de sistema de procesamiento y de tipos de magnitud en marzo de 2018 y su cobertura no es uniforme.',
  'No se incluyen exposición ni vulnerabilidad: los resultados no miden riesgo ni daños esperados.',
]

export interface ReportContext {
  index: IndexData
  filters: Filters
  fc: ForecastParams
  zone?: { unit: string; id: string } | null
  names: { dep: Map<string, string> | null; mun: Map<string, string> | null }
}
export interface BuiltReport {
  doc: ReportDoc
  table: { columns: string[]; rows: Cell[][] }
  features: GeoJSON.Feature[] | null
  mapPng: { dataUrl: string; width: number; height: number } | null
}

// ------------------------------------------------------------------ imágenes (SVG con colores explícitos → PNG)

async function svgPng(svg: string, w: number, h: number): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = new Image()
  const done = new Promise<void>((res, rej) => ((img.onload = () => res()), (img.onerror = () => rej(new Error('No fue posible generar la imagen del informe.')))))
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  await done
  const c = document.createElement('canvas')
  c.width = w * 2
  c.height = h * 2
  const g = c.getContext('2d')
  if (!g) throw new Error('El navegador no permite generar imágenes.')
  g.scale(2, 2)
  g.drawImage(img, 0, 0, w, h)
  return { dataUrl: c.toDataURL('image/png'), width: w, height: h }
}
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const VB = { x0: -82.6, x1: -66.2, y0: -4.9, y1: 13.9 }
const MW = 460
const MH = Math.round((MW * (VB.y1 - VB.y0)) / (VB.x1 - VB.x0))
const mx = (lon: number) => (((lon - VB.x0) / (VB.x1 - VB.x0)) * MW).toFixed(1)
const my = (lat: number) => (((VB.y1 - lat) / (VB.y1 - VB.y0)) * MH).toFixed(1)
const ringPath = (g: GeoJSON.Polygon | GeoJSON.MultiPolygon, every = 2) =>
  (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((poly) => poly[0].filter((_, k) => k % every === 0 || k === poly[0].length - 1).map(([x, y], k) => `${k ? 'L' : 'M'}${mx(x)} ${my(y)}`).join('') + 'Z').join('')

function mapSvg(geo: GeoFC, body: string, legend: string): string {
  const base = geo.features.map((f) => ringPath(f.geometry)).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${MW}" height="${MH + 26}" viewBox="0 0 ${MW} ${MH + 26}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#ffffff"/><rect width="${MW}" height="${MH}" fill="#e3e9ec"/><path d="${base}" fill="#fdfdfb" stroke="#8b979e" stroke-width="0.5"/>${body}<path d="${base}" fill="none" stroke="#5a676f" stroke-width="0.4"/><text x="4" y="${MH + 17}" font-size="10" fill="#55606a">${esc(legend)}</text></svg>`
}
export function eventsMap(geo: GeoFC, ev: Events, idx: ArrayLike<number>): Promise<{ dataUrl: string; width: number; height: number }> {
  let pick = Array.from(idx as ArrayLike<number>)
  if (pick.length > 6000) pick = pick.sort((a, b) => ev.mag[b] - ev.mag[a]).slice(0, 6000)
  pick.sort((a, b) => ev.mag[a] - ev.mag[b])
  const body = pick.map((i) => `<circle cx="${mx(ev.lon[i])}" cy="${my(ev.lat[i])}" r="${(0.7 + Math.max(0, ev.mag[i] - 2.5) ** 1.5 * 0.9).toFixed(1)}" fill="${depthClass(ev.depth[i])?.color ?? NO_DATA_COLOR}" fill-opacity="0.75" stroke="#20282d" stroke-width="0.15"/>`).join('')
  return svgPng(mapSvg(geo, body, `Color: profundidad (${DEPTH_CLASSES.map((c) => c.label).join(' · ')}). Tamaño: magnitud.`), MW, MH + 26)
}
export async function zonesMap(geo: GeoFC, polygons: GeoJSON.FeatureCollection, colors: (string | null)[], highlight: number | null, legend: string) {
  const body = polygons.features
    .map((f) => {
      const zi = (f.properties as { zi: number }).zi
      const c = colors[zi]
      return c ? `<path d="${ringPath(f.geometry as GeoJSON.Polygon, 1)}" fill="${c}" fill-opacity="0.85" stroke="${zi === highlight ? '#000000' : 'none'}" stroke-width="${zi === highlight ? 2 : 0}"/>` : ''
    })
    .join('')
  const hl = highlight != null ? polygons.features.filter((f) => (f.properties as { zi: number }).zi === highlight).map((f) => `<path d="${ringPath(f.geometry as GeoJSON.Polygon, 1)}" fill="none" stroke="#000000" stroke-width="2"/>`).join('') : ''
  return svgPng(mapSvg(geo, body + hl, legend), MW, MH + 26)
}
export function barsPng(labels: string[], values: number[], title: string, fmt: (v: number) => string = fmtInt, color = '#0b5f6b') {
  const w = 500
  const h = 210
  const m = { l: 48, r: 8, t: 24, b: 30 }
  const max = Math.max(...values, 1e-9)
  const bw = (w - m.l - m.r) / values.length
  const every = Math.max(1, Math.ceil(values.length / 10))
  const bars = values.map((v, i) => `<rect x="${(m.l + i * bw + bw * 0.12).toFixed(1)}" y="${(h - m.b - (v / max) * (h - m.t - m.b)).toFixed(1)}" width="${(bw * 0.76).toFixed(1)}" height="${((v / max) * (h - m.t - m.b)).toFixed(1)}" fill="${color}"/>`).join('')
  const xs = labels.map((l, i) => (i % every ? '' : `<text x="${(m.l + i * bw + bw / 2).toFixed(1)}" y="${h - 12}" font-size="10" fill="#55606a" text-anchor="middle">${esc(l)}</text>`)).join('')
  const ys = [0, 0.5, 1].map((t) => `<line x1="${m.l}" x2="${w - m.r}" y1="${h - m.b - t * (h - m.t - m.b)}" y2="${h - m.b - t * (h - m.t - m.b)}" stroke="#dde1e3"/><text x="${m.l - 6}" y="${h - m.b - t * (h - m.t - m.b) + 3}" font-size="10" fill="#55606a" text-anchor="end">${fmt(max * t)}</text>`).join('')
  return svgPng(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" font-family="Helvetica, Arial, sans-serif"><rect width="100%" height="100%" fill="#ffffff"/><text x="${m.l}" y="14" font-size="11" font-weight="bold" fill="#1b1f23">${esc(title)}</text>${ys}${bars}${xs}</svg>`, w, h)
}

// ------------------------------------------------------------------ constructores

const shortZone = (n: string) => n.replace(/^(Celda|Hexágono)[^·]*· /, '')
const limits = (): ReportSection => ({ heading: 'Limitaciones', bullets: LIMITATIONS })
const eventRows = (ev: Events, list: number[], ctx: ReportContext): Cell[][] => list.map((i) => [isoDay(ev.t[i]), fmtMag(ev.mag[i]), Number.isFinite(ev.depth[i]) ? fmtInt(ev.depth[i]) : '—', placeName(ev, i, ctx.names.mun, ctx.names.dep), eventId(ev, i)])
const EVENT_COLS = ['Fecha (UTC)', 'Magnitud', 'Profundidad (km)', 'Lugar', 'Identificador']
const eventFeatures = (ev: Events, list: number[]): GeoJSON.Feature[] => list.map((i) => ({ type: 'Feature', id: eventId(ev, i), properties: { event_id: eventId(ev, i), event_datetime_utc: new Date(ev.t[i] * 1000).toISOString(), magnitude: +ev.mag[i].toFixed(1), depth_km: Number.isFinite(ev.depth[i]) ? +ev.depth[i].toFixed(1) : null }, geometry: { type: 'Point', coordinates: [ev.lon[i], ev.lat[i]] } }))

async function trainedParams(ctx: ReportContext): Promise<ForecastParams> {
  return isTrained(ctx.fc, { depthMin: 0, depthMax: 700 }) ? ctx.fc : { ...ctx.fc, h: [7, 30, 90].includes(ctx.fc.h) ? ctx.fc.h : 30, thr: [3, 4, 5].includes(ctx.fc.thr) ? ctx.fc.thr : 4, smooth: 0, histFrom: 1993 }
}
const fcFilters = (zd: ZoneData, p: ForecastParams, ctx: ReportContext) => [`Unidad: ${ctx.index.units[p.unit].label}`, `Horizonte: ${p.h} días (${fmtDate(zd.start)} a ${fmtDate(zd.end)})`, `Umbral: M ≥ ${fmtNum(p.thr, 1)}`, `Modelo: ${zd.modelName}`]
const forecastTable = (zd: ZoneData, order: number[]): { columns: string[]; rows: Cell[][] } => ({
  columns: ['Zona', 'Probabilidad', 'Intervalo 90 %', 'Clase', 'Tasa esperada'],
  rows: order.map((z) => [shortZone(zd.zt.name[z]), fmtPct(zd.p[z]), `${fmtPct(zd.lo[z])} – ${fmtPct(zd.hi[z])}`, pClass(zd.p[z]).label, zd.expected ? fmtNum(zd.expected[z], 2) : '—']),
})
const P_LEGEND = `Probabilidad: ${P_CLASSES.map((c) => `${c.label} ${c.range}`).join(' · ')}`

export async function buildReport(type: ReportType, ctx: ReportContext): Promise<BuiltReport> {
  const { index } = ctx
  const [ev, geo] = await Promise.all([loadEvents(), loadGeo('dep')])
  const prov = (title: string, extra = {}) => provenance(index, title, extra)
  const depName = ctx.names.dep?.get(ctx.filters.dept)

  if (type === 'periodo' || type === 'historico') {
    const f = type === 'historico' ? { ...ctx.filters, from: index.coverage[0].slice(0, 10), to: index.coverage[1].slice(0, 10), dept: '', magMin: 2.5, magMax: 9, depthMin: 0, depthMax: 700, quality: '' as const } : ctx.filters
    const idx = filterEvents(ev, f)
    const s = summarize(ev, idx)
    const ts = timeSeries(ev, idx, 'anio', dayStart(f.from), dayEnd(f.to))
    const top = Array.from(idx).sort((a, b) => ev.mag[b] - ev.mag[a]).slice(0, 15)
    const months = Math.max((dayEnd(f.to) - dayStart(f.from)) / 86400 / 30.44, 1)
    const [chart, mapPng] = await Promise.all([barsPng(ts.t.map((t) => String(new Date(t * 1000).getUTCFullYear())), ts.count, 'Eventos por año'), eventsMap(geo, ev, idx)])
    const yearTable = { columns: ['Año', 'Eventos', 'Magnitud máxima', 'Profundidad mediana (km)'], rows: ts.t.map((t, k) => [new Date(t * 1000).getUTCFullYear(), ts.count[k], Number.isFinite(ts.maxMag[k]) ? fmtMag(ts.maxMag[k]) : '—', Number.isFinite(ts.medianDepth[k]) ? fmtInt(ts.medianDepth[k]) : '—'] as Cell[]) }
    const table = type === 'historico' ? yearTable : { columns: EVENT_COLS, rows: eventRows(ev, top, ctx) }
    const title = type === 'historico' ? 'Informe de actividad histórica' : 'Informe por periodo'
    return {
      table,
      features: eventFeatures(ev, top),
      mapPng,
      doc: {
        title,
        subtitle: `Actividad sísmica registrada entre el ${fmtDate(dayStart(f.from))} y el ${fmtDate(dayEnd(f.to))}`,
        prov: prov(title, { filtros: describeFilters(f, depName) }),
        sections: [
          { heading: 'Resumen', paragraphs: [`En el periodo se registraron ${fmtInt(s.n)} eventos que cumplen los filtros (${fmtNum(s.n / months, 1)} por mes en promedio). La magnitud máxima fue ${fmtMag(s.maxMag)} y la profundidad mediana ${fmtKm(s.medianDepth)}. El ${s.n ? fmtShare(s.good / s.n, 0) : '—'} de los eventos tiene localización de calidad A o B.`] },
          { heading: 'Gráfico: eventos por año', image: { ...chart, caption: 'Conteo anual de eventos del periodo. Fuente: SGC–RSNC.' } },
          { heading: 'Mapa', image: { ...mapPng, caption: 'Eventos del periodo. Límites: DANE, MGN 2025.' } },
          { heading: type === 'historico' ? 'Tabla principal: actividad por año' : 'Tabla principal: eventos de mayor magnitud', table },
          { heading: 'Interpretación', paragraphs: ['Los conteos describen actividad observada en el catálogo, no la actividad real completa: los sismos pequeños se detectan mejor donde y cuando la red de estaciones es más densa. Los cambios entre años deben leerse junto con la evolución de la red y del procesamiento (cambio de sistema en marzo de 2018).'] },
          limits(),
        ],
      },
    }
  }

  if (type === 'zona' || type === 'probabilistico' || type === 'ejecutivo') {
    const p = await trainedParams(type === 'zona' && ctx.zone ? { ...ctx, fc: { ...ctx.fc, unit: ctx.zone.unit as ForecastParams['unit'] } } : ctx)
    const zd = await loadZoneData(p, { depthMin: 0, depthMax: 700 })
    const polygons = await zonePolygons(zd.zt, () => loadGeo(zd.zt.unit === 'mun' ? 'mun' : 'dep'))
    const order = Array.from(zd.p.keys()).sort((a, b) => zd.p[b] - zd.p[a])
    const colors = Array.from(zd.p, (v) => pClass(v).color)
    const mean = zd.p.reduce((a, b) => a + b, 0) / zd.p.length
    const m = zd.file?.models[zd.model]
    const base = zd.file?.models.base
    const provF = (t: string) => prov(t, { version_modelo: zd.modelVersion, pronostico_generado: zd.generatedAt, filtros: fcFilters(zd, p, ctx) })
    const modelPara = m && base ? `Validación walk-forward de ${inPhrase(zd.modelName)}: PR-AUC ${fmtNum(m.walk_forward.pr_auc ?? NaN, 3)} (línea base ${fmtNum(base.walk_forward.pr_auc ?? NaN, 3)}; sin información ${fmtNum(zd.file!.config.prevalence, 3)}), Brier ${fmtNum(m.walk_forward.brier, 4)} (${fmtSigned((m.walk_forward.brier_skill ?? 0) * 100, 1, ' %')} frente a la base). Estado de calibración: ${zd.calibration}.` : 'Estimación con la línea base recalculada; sin validación walk-forward propia.'
    const interp = 'Una probabilidad alta no significa que un terremoto ocurrirá con certeza. Una probabilidad baja tampoco significa ausencia total de actividad. Los valores expresan con qué frecuencia zonas-periodo parecidas registraron al menos un evento en el pasado; no indican daños ni un evento inminente.'

    if (type === 'zona') {
      const zi = (ctx.zone && zd.zt.index.get(ctx.zone.id)) ?? order[0]
      const idx: number[] = []
      for (let i = 0; i < ev.n; i++) if (zd.zoneOf[i] === zi) idx.push(i)
      const s = summarize(ev, idx)
      const y0 = 1993
      const y1 = new Date(ev.t[ev.n - 1] * 1000).getUTCFullYear()
      const byYear = Array.from({ length: y1 - y0 + 1 }, () => 0)
      idx.forEach((i) => byYear[new Date(ev.t[i] * 1000).getUTCFullYear() - y0]++)
      const top = [...idx].sort((a, b) => ev.mag[b] - ev.mag[a]).slice(0, 12)
      const [chart, mapPng] = await Promise.all([barsPng(byYear.map((_, k) => String(y0 + k)), byYear, 'Eventos por año en la zona'), zonesMap(geo, polygons, colors, zi, P_LEGEND)])
      const table = { columns: ['Indicador', 'Valor'], rows: [
        ['Probabilidad estimada', fmtPct(zd.p[zi])], ['Intervalo de incertidumbre (90 %)', `${fmtPct(zd.lo[zi])} – ${fmtPct(zd.hi[zi])}`], ['Clase', pClass(zd.p[zi]).label], ['Tasa esperada de eventos', zd.expected ? fmtNum(zd.expected[zi], 2) : '—'],
        ['Variación frente al periodo anterior', fmtSigned((zd.p[zi] - zd.pPrev[zi]) * 100, 1, ' puntos')], ['Media de todas las zonas', fmtPct(mean)], ['Registros históricos en la zona', fmtInt(s.n)], ['Magnitud máxima registrada', fmtMag(s.maxMag)], ['Profundidad mediana', fmtKm(s.medianDepth)], ['Localizaciones de calidad A o B', s.n ? fmtShare(s.good / s.n, 0) : '—'],
      ] as Cell[][] }
      return {
        table, mapPng,
        features: polygons.features.filter((f) => (f.properties as { zi: number }).zi === zi).map((f) => ({ ...f, properties: { zone_id: zd.zt.id[zi], zone_name: zd.zt.name[zi], probability: +zd.p[zi].toFixed(5), uncertainty_low: +zd.lo[zi].toFixed(5), uncertainty_high: +zd.hi[zi].toFixed(5), model_version: zd.modelVersion } })),
        doc: {
          title: 'Informe por zona', subtitle: zd.zt.name[zi], prov: provF('Informe por zona'),
          sections: [
            { heading: 'Estimación', paragraphs: [`Probabilidad de registrar al menos un evento de magnitud ${fmtNum(p.thr, 1)} o superior entre el ${fmtDate(zd.start)} y el ${fmtDate(zd.end)}: ${fmtPct(zd.p[zi])} (intervalo del 90 %: ${fmtPct(zd.lo[zi])} a ${fmtPct(zd.hi[zi])}).`, modelPara] },
            { heading: 'Tabla principal', table },
            { heading: 'Mapa', image: { ...mapPng, caption: 'Probabilidad estimada por zona; la zona del informe aparece con borde negro. Estimación experimental, no oficial.' } },
            { heading: 'Gráfico: actividad observada', image: { ...chart, caption: 'Eventos registrados por año dentro de la zona (M ≥ 2,5). Fuente: SGC–RSNC.' } },
            { heading: 'Eventos de mayor magnitud en la zona', table: { columns: EVENT_COLS, rows: eventRows(ev, top, ctx) } },
            { heading: 'Interpretación', paragraphs: [interp] },
            limits(),
          ],
        },
      }
    }
    const mapPng = await zonesMap(geo, polygons, colors, null, P_LEGEND)
    const table = forecastTable(zd, order.slice(0, type === 'ejecutivo' ? 8 : 25))
    const classes = P_CLASSES.map((c) => zd.p.filter((v) => pClass(v).i === c.i).length)
    const chart = await barsPng(P_CLASSES.map((c) => c.range), classes, 'Número de zonas por clase de probabilidad')
    const features = polygons.features.map((f) => {
      const zi = (f.properties as { zi: number }).zi
      return { ...f, properties: { zone_id: zd.zt.id[zi], zone_name: zd.zt.name[zi], probability: +zd.p[zi].toFixed(5), uncertainty_low: +zd.lo[zi].toFixed(5), uncertainty_high: +zd.hi[zi].toFixed(5), class: pClass(zd.p[zi]).label, model_version: zd.modelVersion } }
    })
    if (type === 'probabilistico')
      return {
        table, mapPng, features,
        doc: {
          title: 'Informe probabilístico', subtitle: `Próximos ${p.h} días · M ≥ ${fmtNum(p.thr, 1)} · ${index.units[p.unit].label}`, prov: provF('Informe probabilístico'),
          sections: [
            { heading: 'Resumen', paragraphs: [`Se estimó la probabilidad en ${fmtInt(zd.zt.id.length)} zonas. La probabilidad media es ${fmtPct(mean)}; ${fmtInt(zd.p.filter((v) => v >= 0.15).length)} zonas tienen 15 % o más.`, modelPara] },
            { heading: 'Mapa', image: { ...mapPng, caption: 'Probabilidad estimada por zona. Estimación experimental de SismoNexo; no es un producto oficial.' } },
            { heading: 'Gráfico: zonas por clase', image: { ...chart, caption: 'Distribución de las zonas en las seis clases de probabilidad.' } },
            { heading: 'Tabla principal: zonas con mayor probabilidad', table },
            { heading: 'Interpretación', paragraphs: [interp] },
            limits(),
          ],
        },
      }
    const idxAll = filterEvents(ev, { ...ctx.filters, from: index.coverage[0].slice(0, 10), to: index.coverage[1].slice(0, 10), dept: '', magMin: 2.5, magMax: 9, depthMin: 0, depthMax: 700, quality: '' })
    const s = summarize(ev, idxAll)
    return {
      table, mapPng, features,
      doc: {
        title: 'Resumen ejecutivo', subtitle: index.app.subtitle, prov: provF('Resumen ejecutivo'),
        sections: [
          { heading: 'Qué es', paragraphs: ['SismoNexo Colombia es un prototipo académico que organiza el catálogo sísmico público del Servicio Geológico Colombiano y estima, por zona y periodo, la probabilidad de registrar actividad sobre un umbral de magnitud. No predice sismos individuales ni emite alertas.'] },
          { heading: 'Cifras principales', bullets: [
            `${fmtInt(s.n)} eventos reales de magnitud ${fmtNum(index.min_magnitude, 1)} o superior entre ${fmtDate(index.coverage[0])} y ${fmtDate(index.coverage[1])}; magnitud máxima ${fmtMag(s.maxMag)}.`,
            `${index.audit.length} reglas de calidad auditadas; ${fmtInt(index.audit.reduce((a, r) => a + r.rows_dropped, 0))} duplicados descartados; ningún valor imputado.`,
            `${index.experiments.length} configuraciones de modelos entrenadas (5 unidades geográficas × 3 horizontes × 3 umbrales) con validación walk-forward y detector de fugas.`,
            modelPara,
          ] },
          { heading: 'Mapa: pronóstico vigente', image: { ...mapPng, caption: `Probabilidad de al menos un evento M ≥ ${fmtNum(p.thr, 1)} en ${p.h} días (${fmtDate(zd.start)} a ${fmtDate(zd.end)}). Estimación experimental.` } },
          { heading: 'Gráfico: zonas por clase', image: { ...chart, caption: 'Distribución de las zonas en las seis clases de probabilidad.' } },
          { heading: 'Tabla principal: zonas con mayor probabilidad', table },
          { heading: 'Interpretación', paragraphs: [interp, 'El resultado más importante es metodológico: con validación cronológica estricta, los modelos de aprendizaje automático mejoran poco a la frecuencia histórica, y para eventos grandes no la mejoran. La plataforma lo muestra tal cual.'] },
          limits(),
        ],
      },
    }
  }

  if (type === 'modelos') {
    const p = await trainedParams(ctx)
    const fc = await loadForecast(forecastId(p.unit, p.h, p.thr))
    const keys = MODEL_ORDER.filter((k) => fc.models[k])
    const table = { columns: ['Modelo', 'PR-AUC', 'ROC-AUC', 'Brier', 'Mejora Brier', 'Log-loss', 'ECE', 'Calibración'], rows: keys.map((k) => { const m = fc.models[k]!; const w = m.walk_forward; return [m.name, fmtNum(w.pr_auc ?? NaN, 3), fmtNum(w.roc_auc ?? NaN, 3), fmtNum(w.brier, 4), fmtSigned((w.brier_skill ?? 0) * 100, 1, ' %'), fmtNum(w.log_loss, 4), fmtNum(w.ece, 4), m.calibration_status] as Cell[] }) }
    const chart = await barsPng(keys.map((k) => ({ base: 'Base', logit: 'Logística', pois: 'Poisson', rf: 'R. Forest', hgb: 'Boosting', etas: 'ETAS', hyb: 'Híbrido' })[k]), keys.map((k) => fc.models[k]!.walk_forward.pr_auc ?? 0), 'PR-AUC por modelo (validación walk-forward)', (v) => fmtNum(v, 2))
    const zd = await loadZoneData(p, { depthMin: 0, depthMax: 700 })
    const polygons = await zonePolygons(zd.zt, () => loadGeo(zd.zt.unit === 'mun' ? 'mun' : 'dep'))
    const mapPng = await zonesMap(geo, polygons, Array.from(zd.p, (v) => pClass(v).color), null, P_LEGEND)
    return {
      table, mapPng, features: null,
      doc: {
        title: 'Comparación de modelos', subtitle: `${fc.config.unit_label} · ${fc.config.horizon_days} días · M ≥ ${fmtNum(fc.config.threshold, 1)}`,
        prov: prov('Comparación de modelos', { version_modelo: fc.config.model_version, pronostico_generado: fc.forecast.generated_at, filtros: [`Unidad: ${fc.config.unit_label}`, `Horizonte: ${fc.config.horizon_days} días`, `Umbral: M ≥ ${fmtNum(fc.config.threshold, 1)}`] }),
        sections: [
          { heading: 'Diseño de la validación', paragraphs: [`${fc.folds.length} bloques walk-forward de ventana creciente, con separación de ${fc.config.horizon_days} días entre entrenamiento, validación y prueba. ${fmtInt(fc.config.n_rows)} zonas-periodo; ${fmtInt(fc.config.positives)} con evento (prevalencia ${fmtShare(fc.config.prevalence, 2)}). Modelo por defecto: ${fc.models[fc.selected_model]?.name} (${fc.selection_rule.toLowerCase()})`] },
          { heading: 'Tabla principal: métricas', table: { ...table, note: 'PR-AUC y Brier son las métricas principales. No se usa la exactitud (accuracy) para elegir modelo.' } },
          { heading: 'Gráfico', image: { ...chart, caption: `PR-AUC en todos los bloques. Referencia sin información: ${fmtNum(fc.config.prevalence, 3)}.` } },
          { heading: 'Mapa: pronóstico del modelo por defecto', image: { ...mapPng, caption: 'Probabilidad estimada por zona. Estimación experimental, no oficial.' } },
          { heading: 'Detector de fugas de información', table: { columns: ['Comprobación', 'Resultado', 'Detalle'], rows: fc.leakage.map((l) => [l.title, l.status === 'ok' ? 'Sin hallazgos' : l.status, l.detail]) } },
          { heading: 'Interpretación', paragraphs: ['Un modelo solo se justifica si mejora a la línea base de frecuencia histórica en datos posteriores a su entrenamiento, y si sus probabilidades están calibradas. Cuando la mejora es pequeña o inestable entre bloques, se prefiere el modelo más simple.'] },
          limits(),
        ],
      },
    }
  }

  if (type === 'calidad') {
    const q = await loadQuality()
    const idx = filterEvents(ev, { ...ctx.filters, from: index.coverage[0].slice(0, 10), to: index.coverage[1].slice(0, 10), dept: '', magMin: 2.5, magMax: 9, depthMin: 0, depthMax: 700, quality: '' })
    const [chart, mapPng] = await Promise.all([barsPng(q.by_year.map((y) => String(y.year)), q.by_year.map((y) => y.n), 'Eventos por año en el catálogo limpio'), eventsMap(geo, ev, idx)])
    const table = { columns: ['Regla', 'Título', 'Acción', 'Afectados', 'Descartados'], rows: index.audit.map((a) => [a.rule, a.title, a.action, fmtInt(a.rows_affected), fmtInt(a.rows_dropped)] as Cell[]) }
    return {
      table, mapPng, features: null,
      doc: {
        title: 'Informe de calidad de datos', subtitle: `Catálogo instrumental RSNC · versión ${index.dataset_version}`, prov: prov('Informe de calidad de datos'),
        sections: [
          { heading: 'Indicadores', bullets: [`Registros descargados: ${fmtInt(q.totals.records_downloaded)}; finales: ${fmtInt(q.totals.records)}; descartados: ${fmtInt(q.totals.records_dropped)} (duplicados).`, `Coordenadas inválidas: ${fmtInt(q.totals.invalid_coordinates)}. Magnitudes faltantes: ${fmtInt(q.totals.missing_magnitude)}. Profundidades fuera de rango anuladas: ${fmtInt(q.totals.depth_out_of_range)}. Profundidad fijada en 0 km por la fuente: ${fmtInt(q.totals.depth_fixed_zero)}.`, `Eventos revisados por analista: ${fmtShare(q.totals.reviewed_share, 2)}. Fuera de los límites departamentales: ${fmtInt(q.totals.outside_departments)}.`] },
          { heading: 'Tabla principal: reglas de calidad y auditoría', table },
          { heading: 'Gráfico: cobertura por año', image: { ...chart, caption: 'Eventos por año (M ≥ 2,5).' } },
          { heading: 'Mapa: densidad del catálogo', image: { ...mapPng, caption: 'Los 6.000 eventos de mayor magnitud del catálogo.' } },
          { heading: 'Rupturas estructurales (prueba de Pettitt)', table: { columns: ['Serie', 'Cambio', 'Mediana antes', 'Mediana después'], rows: q.breaks.map((b) => [b.label, b.date, fmtNum(b.median_before, 1), fmtNum(b.median_after, 1)]) } },
          { heading: 'Interpretación', paragraphs: [q.instrument_changes[0]?.detail ?? '', 'Las rupturas detectadas reflejan sobre todo la evolución de la red y del procesamiento. Por eso los modelos se evalúan en bloques recientes y las series largas se interpretan con cautela.'] },
          limits(),
        ],
      },
    }
  }

  // Anexo metodológico
  const fc = await loadForecast(forecastId('g50', 30, 4))
  const zd = await loadZoneData({ unit: 'g50', h: 30, thr: 4, model: 'auto', smooth: 0, histFrom: 1993 }, { depthMin: 0, depthMax: 700 })
  const polygons = await zonePolygons(zd.zt, () => loadGeo('dep'))
  const mapPng = await zonesMap(geo, polygons, Array.from(zd.p, (v) => pClass(v).color), null, P_LEGEND)
  const table = { columns: ['Variable', 'Grupo', 'Unidad'], rows: index.features.map((f) => [f.label, f.group, f.unit] as Cell[]) }
  const chart = await barsPng(fc.folds.map((f) => f.test[0].slice(0, 4)), fc.folds.map((f) => f.test_positives), 'Zonas-periodo con evento en cada bloque de prueba')
  return {
    table, mapPng, features: null,
    doc: {
      title: 'Anexo metodológico', subtitle: 'Datos, variables, modelos, validación y limitaciones', prov: prov('Anexo metodológico', { version_modelo: fc.config.model_version, pronostico_generado: fc.forecast.generated_at }),
      sections: [
        { heading: '1. Objetivo', paragraphs: ['Estimar, para cada zona y horizonte (7, 30 y 90 días; principal 30), la probabilidad de registrar al menos un evento con magnitud igual o superior a un umbral (3,0; 4,0; 5,0). No se estima la fecha, la ubicación exacta ni la magnitud de eventos individuales.'] },
        { heading: '2. Datos', paragraphs: [`Catálogo instrumental de la RSNC (SGC): ${fmtInt(index.records)} eventos entre ${fmtDate(index.coverage[0])} y ${fmtDate(index.coverage[1])}, M ≥ ${fmtNum(index.min_magnitude, 1)}. Limpieza con ${index.audit.length} reglas auditadas; sin imputación. Límites: DANE, MGN 2025.`] },
        { heading: '3. Zonas y periodos', paragraphs: [`Unidades: ${Object.values(index.units).map((u) => `${u.label} (${fmtInt(u.n_zones)})`).join(', ')}. Cada fila es una zona en una fecha de origen; las variables usan solo el pasado y la etiqueta el intervalo siguiente.`] },
        { heading: '4. Variables (tabla principal)', table },
        { heading: '5. Modelos', bullets: MODEL_ORDER.map((k) => `${index.model_info[k].name}: ${index.model_info[k].family}.`) },
        { heading: '6. Validación', paragraphs: [`Walk-forward de ventana creciente en ${fc.folds.length} bloques con separación temporal igual al horizonte. Calibración isotónica ajustada solo en validación. Los dos bloques más recientes son la prueba final. Detector automático de seis tipos de fuga de información.`], image: { ...chart, caption: 'Casos positivos por bloque de prueba (cuadrícula de 50 km, 30 días, M ≥ 4,0).' } },
        { heading: '7. Incertidumbre', paragraphs: ['Intervalo del 90 % a partir de la frecuencia observada en validación (Jeffreys) por tramo de probabilidad. La interfaz no muestra nunca 0 % ni 100 %.'] },
        { heading: '8. Mapa de referencia', image: { ...mapPng, caption: 'Pronóstico vigente de la configuración principal. Estimación experimental.' } },
        { heading: 'Interpretación', paragraphs: ['Los resultados son asociaciones estadísticas sobre patrones históricos. Las explicaciones (SHAP, permutación, dependencias parciales) describen el modelo, no la causa física de los sismos.'] },
        limits(),
      ],
    },
  }
}
