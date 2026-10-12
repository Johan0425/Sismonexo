// Atlas sísmico: todos los eventos reales del catálogo sobre el mapa, con filtros, capas, inspector y exportación.
import type { Map as MLMap } from 'maplibre-gl'
import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ChartFrame, ProvenanceContext, XYChart } from '@/charts/Chart'
import { ActiveFilters, FilterSheet } from '@/components/Filters'
import { EventInspector, useNames } from '@/components/Inspectors'
import { useTheme } from '@/components/Shell'
import { EmptyState, Gate, IconButton, Kpis, Note, Select, Sheet, Counter } from '@/components/ui'
import { eventId, eventSource, loadActiveEvents, setSessionEvents, loadGeo, loadIndex, loadZones, useAsync, type Events, type IndexData } from '@/lib/data'
import { dataUrlToBlob, download, downloadCsv, downloadGeoJson, provenance } from '@/lib/export'
import { dayEnd, dayStart, fmtDate, fmtInt, fmtKm, fmtMag, fmtNum, isoDay } from '@/lib/format'
import { assignZones, filterEvents, placeName, zonePolygons } from '@/lib/geo'
import { ramp, rampCss } from '@/lib/scales'
import { autoBin, BIN_LABEL, histogram, summarize, timeSeries } from '@/lib/stats'
import { describeFilters, useApp, type ZoneMetric } from '@/lib/store'
import { loadZoneData, paintZones } from '@/lib/zonedata'
import { MAX_COLUMNS, pickEvent, useEventLayers, useZoneLayer } from '@/map/layers'
import { MapView, mapSnapshot } from '@/map/MapView'
import { EventLegend, ExportMenu, LayerPanel, useMedia, ZoneLegendBox } from '@/map/MapUi'
import { copyLink } from '@/components/Palette'

const ZONE_LAYERS: { value: ZoneMetric | 'ninguna'; label: string }[] = [
  { value: 'ninguna', label: 'Ninguna' },
  { value: 'probabilidad', label: 'Probabilidad estimada (experimental)' },
  { value: 'tasa', label: 'Tasa histórica' },
  { value: 'incertidumbre', label: 'Incertidumbre' },
  { value: 'calidad', label: 'Cobertura y calidad del catálogo' },
  { value: 'cambio', label: 'Cambio frente al periodo anterior' },
]

export default function Atlas() {
  const imported = useApp((s) => s.imported)
  const ev = useAsync(loadActiveEvents, [imported])
  const index = useAsync(loadIndex, [])
  useEffect(() => {
    document.title = 'Atlas sísmico · SismoNexo Colombia'
  }, [])
  return (
    <Gate of={[ev, index] as const}>
      {(e, i) => <AtlasMap ev={e} index={i} />}
    </Gate>
  )
}

function AtlasMap({ ev, index }: { ev: Events; index: IndexData }) {
  const filters = useApp((s) => s.filters)
  const atlas = useApp((s) => s.atlas)
  const fc = useApp((s) => s.fc)
  const selection = useApp((s) => s.selection)
  const { select, toast, announce } = useApp.getState()
  const theme = useTheme()
  const wide = useMedia('(min-width: 1100px)')
  const [map, setMap] = useState<MLMap | null>(null)
  const [zoneLayer, setZoneLayer] = useState<ZoneMetric | 'ninguna'>('ninguna')
  const names = useNames()

  const idx = useMemo(() => filterEvents(ev, filters), [ev, filters])
  const sum = useMemo(() => summarize(ev, idx), [ev, idx])
  useEffect(() => announce(`${fmtInt(idx.length)} eventos cumplen los filtros.`), [idx.length, announce])

  const selIndex = useMemo(() => {
    if (selection?.kind !== 'evento') return null
    for (let i = 0; i < ev.n; i++) if ((ev.src[i] ? eventId(ev, i) : ev.id[i]) === selection.id) return i
    return null
  }, [selection, ev])
  const pick = (i: number | null) => select(i == null ? null : { kind: 'evento', id: ev.src[i] ? eventId(ev, i) : ev.id[i] })

  useEventLayers({ map, ev, idx, viz: atlas.viz, colorBy: atlas.colorBy, theme, selected: selIndex })

  // Agregación por celda (hexágonos o cuadrícula) o capa de análisis por zona
  const gridUnit = atlas.viz === 'h3' ? 'h3' : atlas.viz === 'g50' ? 'g50' : null
  const grid = useAsync(async () => {
    if (!gridUnit) return null
    const zt = await loadZones(gridUnit)
    const [zoneOf, polygons] = await Promise.all([assignZones(ev, zt), zonePolygons(zt, () => loadGeo('dep'))])
    return { zt, zoneOf, polygons }
  }, [gridUnit, ev])
  const gridPaint = useMemo(() => {
    if (!gridUnit || grid.status !== 'ready' || !grid.data) return null
    const { zt, zoneOf, polygons } = grid.data
    const n = new Float64Array(zt.id.length)
    for (let k = 0; k < idx.length; k++) {
      const z = zoneOf[idx[k]]
      if (z >= 0) n[z]++
    }
    const max = Math.max(1, ...n)
    return { polygons, max, colors: Array.from(n, (v) => (v > 0 ? ramp('viridis', Math.log(v + 1) / Math.log(max + 1)) : null)) }
  }, [gridUnit, grid, idx])

  const zd = useAsync(() => (zoneLayer === 'ninguna' || gridUnit ? Promise.resolve(null) : loadZoneData(fc, filters).then(async (d) => ({ d, polygons: await zonePolygons(d.zt, () => loadGeo(d.zt.unit === 'mun' ? 'mun' : 'dep')) }))), [zoneLayer, gridUnit, fc, filters.depthMin, filters.depthMax])
  const zonePaint = useMemo(() => (zoneLayer !== 'ninguna' && zd.status === 'ready' && zd.data ? { ...paintZones(zd.data.d, zoneLayer, fc.thr), polygons: zd.data.polygons } : null), [zd, zoneLayer, fc.thr])

  useZoneLayer({
    map,
    polygons: gridPaint?.polygons ?? zonePaint?.polygons ?? null,
    colors: gridPaint?.colors ?? zonePaint?.colors ?? null,
    patterns: gridPaint ? null : (zonePaint?.patterns ?? null),
    selected: null,
    theme,
    opacity: gridPaint ? 0.82 : 0.6,
  })

  // Inclinación automática para las columnas 3D
  useEffect(() => {
    if (map && atlas.viz === 'columnas' && map.getPitch() < 20) map.easeTo({ pitch: 55, duration: document.documentElement.dataset.motion === 'reducido' ? 0 : 420 })
  }, [map, atlas.viz])

  const prov = (title: string) => provenance(index, title, { filtros: describeFilters(filters, names.dep?.get(filters.dept)) })
  const visible = (): number[] => {
    if (!map) return Array.from(idx)
    const b = map.getBounds()
    return Array.from(idx).filter((i) => b.contains([ev.lon[i], ev.lat[i]]))
  }
  const HEADER = ['event_id', 'event_datetime_utc', 'latitude', 'longitude', 'depth_km', 'magnitude', 'magnitude_type', 'department', 'municipality_or_reference', 'quality_code', 'location_error_km', 'reviewed', 'source', 'dataset_version']
  const record = (i: number) => [eventId(ev, i), new Date(ev.t[i] * 1000).toISOString(), ev.lat[i], ev.lon[i], Number.isFinite(ev.depth[i]) ? +ev.depth[i].toFixed(1) : null, +ev.mag[i].toFixed(1), ev.mtNames[ev.mt[i]], ev.dep[i] >= 0 ? (names.dep?.get(ev.depCodes[ev.dep[i]]) ?? '') : '', placeName(ev, i, names.mun, names.dep), ev.qNames[ev.q[i]], Number.isFinite(ev.err[i]) ? +ev.err[i].toFixed(1) : null, ev.status[i] ? 'sí' : 'no', eventSource(ev, i)?.name ?? '', index.dataset_version]
  const exports = [
    {
      label: 'Registros visibles (CSV)',
      hint: 'Eventos filtrados dentro del encuadre actual',
      run: () => {
        const v = visible()
        downloadCsv('sismonexo-eventos-visibles.csv', HEADER, v.map(record), prov('Eventos visibles en el atlas'))
        toast(`${fmtInt(v.length)} registros exportados con fuente y versión.`)
      },
    },
    {
      label: 'Registros visibles (GeoJSON)',
      hint: 'WGS84, con metadatos de procedencia',
      run: () => {
        const v = visible()
        downloadGeoJson('sismonexo-eventos-visibles.geojson', v.map((i) => ({ type: 'Feature' as const, id: eventId(ev, i), properties: Object.fromEntries(HEADER.map((h, k) => [h, record(i)[k]])), geometry: { type: 'Point' as const, coordinates: [ev.lon[i], ev.lat[i], Number.isFinite(ev.depth[i]) ? -ev.depth[i] * 1000 : 0] } })), prov('Eventos visibles en el atlas'))
        toast(`${fmtInt(v.length)} registros exportados en GeoJSON.`)
      },
    },
    {
      label: 'Imagen del mapa (PNG)',
      hint: 'Con las capas activas',
      run: () => {
        if (!map) return
        void mapSnapshot(map).then(({ dataUrl }) => {
          download('sismonexo-atlas.png', dataUrlToBlob(dataUrl))
          toast('Imagen del mapa descargada. Cite la fuente: SGC–RSNC, versión ' + index.dataset_version + '.')
        })
      },
    },
    { label: 'Copiar enlace a esta vista', hint: 'Incluye filtros, capas y encuadre', run: () => void copyLink().then((ok) => toast(ok ? 'Enlace copiado.' : 'No fue posible copiar; copie la dirección del navegador.')) },
  ]

  const inspector = selIndex != null ? <EventInspector ev={ev} i={selIndex} onSelect={pick} /> : null
  const summary = <Summary ev={ev} idx={idx} sum={sum} from={dayStart(filters.from)} to={dayEnd(filters.to)} onSelect={pick} names={names} />
  const capNote = atlas.viz === 'columnas' && idx.length > MAX_COLUMNS

  return (
    <ProvenanceContext.Provider value={prov}>
      <div className="map-layout">
        <MapView
          label="Mapa del atlas sísmico de Colombia"
          onMap={setMap}
          onClick={(e, m) => {
            const i = pickEvent(m, e.point)
            if (i != null) pick(i)
            else if (m.getLayer('ev-cluster')) {
              const c = m.queryRenderedFeatures(e.point, { layers: ['ev-cluster'] })[0]
              if (c) {
                toast(`Grupo de ${fmtInt(c.properties.point_count as number)} eventos; magnitud máxima ${fmtMag(c.properties.mx as number)}.`)
                m.easeTo({ center: (c.geometry as GeoJSON.Point).coordinates as [number, number], zoom: m.getZoom() + 1.6, duration: 400 })
              } else pick(null)
            } else pick(null)
          }}
          onPickCenter={(m) => {
            const r = m.getCanvas().getBoundingClientRect()
            const i = pickEvent(m, { x: r.width / 2, y: r.height / 2 }, 16)
            if (i != null) pick(i)
            else toast('No hay eventos bajo la mira. Desplace el mapa y presione Enter de nuevo.')
          }}
        >
          <div className="map-ctrl tl no-print" style={{ right: 64 }}>
            <FilterSheet count={idx.length} />
            <LayerPanel>
              <Select label="Capa de análisis por zona" value={zoneLayer} options={ZONE_LAYERS} onChange={setZoneLayer} hint={zoneLayer === 'ninguna' ? 'Se dibuja debajo de los eventos.' : `Unidad: ${index.units[fc.unit].label.toLowerCase()}. Cámbiela en «Pronóstico».`} />
            </LayerPanel>
            <ExportMenu items={exports} />
            <ActiveFilters />
            {ev.imported && (
              <button type="button" className="chip glass" style={{ borderColor: 'var(--caution)', color: 'var(--caution)' }} onClick={() => (setSessionEvents(null), useApp.getState().setImported(null), toast('Se restauró el catálogo oficial incluido.'))} aria-label={`Archivo importado ${ev.imported.name}. Volver al catálogo oficial`}>
                Archivo importado: {ev.imported.name.slice(0, 28)} · volver al catálogo oficial
              </button>
            )}
          </div>
          <div className="map-ctrl bl">
            {zonePaint && !gridUnit && <ZoneLegendBox legend={zonePaint.legend} footer={zoneLayer === 'probabilidad' ? <p className="caption" style={{ marginTop: 6 }}>Estimación experimental de SismoNexo; no es un producto oficial.</p> : undefined} />}
            <EventLegend
              viz={atlas.viz}
              colorBy={atlas.colorBy}
              extra={
                gridPaint && (
                  <>
                    <h4>Eventos por celda</h4>
                    <div className="ramp" style={{ background: rampCss('viridis') }} />
                    <div className="ticks">
                      <span>1</span>
                      <span>{fmtInt(gridPaint.max)}</span>
                    </div>
                    <p className="caption" style={{ marginTop: 4 }}>Escala logarítmica. Sin color: sin eventos.</p>
                  </>
                )
              }
            />
            {capNote && <div className="map-legend glass caption">Se muestran las {fmtInt(MAX_COLUMNS)} columnas de mayor magnitud de {fmtInt(idx.length)} eventos.</div>}
          </div>
          {idx.length === 0 && (
            <div className="glass" style={{ position: 'absolute', left: '50%', top: '50%', translate: '-50% -50%', borderRadius: 20, maxWidth: 'calc(100% - 32px)' }}>
              <EmptyState title="Ningún evento cumple los filtros">Amplíe el rango de fechas, reduzca la magnitud mínima o quite el filtro de ubicación.</EmptyState>
            </div>
          )}
          {!wide && selIndex == null && (
            <div className="map-ctrl br no-print" style={{ bottom: 12, right: 12 }}>
              <SummarySheet>{summary}</SummarySheet>
            </div>
          )}
        </MapView>
        {wide && (
          <aside className="inspector" aria-label={selIndex != null ? 'Detalle del evento seleccionado' : 'Resumen de los eventos filtrados'}>
            <div className="inspector-head">
              <h2 style={{ fontSize: 'var(--fs-18)' }}>{selIndex != null ? 'Evento seleccionado' : 'Resumen'}</h2>
              {selIndex != null && (
                <IconButton label="Cerrar detalle" size="sm" onClick={() => pick(null)}>
                  <X size={18} aria-hidden />
                </IconButton>
              )}
            </div>
            {inspector ?? summary}
          </aside>
        )}
        {!wide && (
          <Sheet open={selIndex != null} onClose={() => pick(null)} title="Evento seleccionado">
            <div style={{ margin: '0 -20px' }}>{inspector}</div>
          </Sheet>
        )}
      </div>
    </ProvenanceContext.Provider>
  )
}

function SummarySheet({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn glass" data-size="sm" style={{ minHeight: 44 }} onClick={() => setOpen(true)}>
        Resumen y tabla
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Resumen">
        <div style={{ margin: '0 -20px' }}>{children}</div>
      </Sheet>
    </>
  )
}

function Summary({ ev, idx, sum, from, to, onSelect, names }: { ev: Events; idx: Uint32Array; sum: ReturnType<typeof summarize>; from: number; to: number; onSelect: (i: number) => void; names: ReturnType<typeof useNames> }) {
  const bin = autoBin(to - from)
  const ts = useMemo(() => timeSeries(ev, idx, bin, from, to), [ev, idx, bin, from, to])
  const magH = useMemo(() => histogram(Array.from(idx, (i) => ev.mag[i]), 2.5, 0.5, 9), [ev, idx])
  const top = useMemo(() => Array.from(idx).sort((a, b) => ev.mag[b] - ev.mag[a]).slice(0, 12), [ev, idx])
  const peak = ts.count.length ? ts.count.indexOf(Math.max(...ts.count)) : -1
  if (!idx.length) return <div className="inspector-body"><p className="muted small">Sin eventos para resumir con los filtros actuales.</p></div>
  return (
    <div className="inspector-body">
      <section aria-label="Indicadores">
        <Kpis
          label="Indicadores de los eventos filtrados"
          items={[
            { label: 'Eventos', value: <Counter value={sum.n} /> },
            { label: 'Magnitud máxima', value: fmtMag(sum.maxMag) },
            { label: 'Profundidad mediana', value: fmtKm(sum.medianDepth) },
            { label: 'Calidad A o B', value: `${fmtNum((sum.good / sum.n) * 100, 0)} %` },
          ]}
        />
        <p className="caption" style={{ marginTop: 8 }}>
          Actividad observada entre el {fmtDate(sum.first)} y el {fmtDate(sum.last)}. Fuente: SGC–RSNC.
        </p>
      </section>
      <section>
        <ChartFrame
          title={`Eventos por ${BIN_LABEL[bin].toLowerCase()}`}
          summary={`Serie temporal de ${fmtInt(sum.n)} eventos agrupados por ${BIN_LABEL[bin].toLowerCase()}.${peak >= 0 ? ` El máximo fue de ${fmtInt(ts.count[peak])} eventos en el intervalo que inicia el ${fmtDate(ts.t[peak])}.` : ''}`}
          table={{ columns: ['Inicio del intervalo (UTC)', 'Eventos', 'Magnitud máxima'], rows: ts.t.map((t, k) => [isoDay(t), ts.count[k], Number.isFinite(ts.maxMag[k]) ? +ts.maxMag[k].toFixed(1) : null]) }}
        >
          {(w) => <XYChart width={w} height={170} x={{ type: 'time' }} y={{}} series={[{ key: 'n', label: 'Eventos', color: 'var(--s1)', type: 'bar', data: ts.t.map((t, k) => [t, ts.count[k]]) }]} />}
        </ChartFrame>
      </section>
      <section>
        <ChartFrame
          title="Distribución de magnitudes"
          summary={`Número de eventos por intervalo de media unidad de magnitud. La escala vertical es logarítmica porque los eventos grandes son mucho menos frecuentes (ley de Gutenberg–Richter).`}
          table={{ columns: ['Magnitud', 'Eventos'], rows: magH.map((v, k) => [k === 8 ? '≥ 6,5' : `${fmtNum(2.5 + k * 0.5, 1)}–${fmtNum(3 + k * 0.5, 1)}`, v]) }}
        >
          {(w) => <XYChart width={w} height={160} x={{ type: 'band', categories: magH.map((_, k) => (k === 8 ? '6,5+' : fmtNum(2.5 + k * 0.5, 1))) }} y={{ log: true, domain: [0.8, Math.max(10, ...magH) * 1.3], format: fmtInt }} series={[{ key: 'm', label: 'Eventos', color: 'var(--s1)', type: 'bar', data: magH.map((v, k) => [k, v]) }]} />}
        </ChartFrame>
      </section>
      <section aria-label="Eventos de mayor magnitud">
        <h4>Eventos de mayor magnitud</h4>
        <p className="caption" style={{ marginBottom: 8 }}>Alternativa tabular al mapa: seleccione un evento para ver su detalle.</p>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Fecha (UTC)</th>
                <th scope="col" className="r">M</th>
                <th scope="col" className="r">Prof.</th>
                <th scope="col">Lugar</th>
              </tr>
            </thead>
            <tbody>
              {top.map((i) => (
                <tr key={i}>
                  <th scope="row">
                    <button type="button" className="rowlink" onClick={() => onSelect(i)}>
                      {isoDay(ev.t[i])}
                    </button>
                  </th>
                  <td className="r">{fmtMag(ev.mag[i])}</td>
                  <td className="r">{Number.isFinite(ev.depth[i]) ? fmtInt(ev.depth[i]) : '—'}</td>
                  <td>{placeName(ev, i, names.mun, names.dep)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sum.noDepth > 0 && <Note>{fmtInt(sum.noDepth)} eventos del filtro no tienen profundidad reportada.</Note>}
      </section>
    </div>
  )
}

