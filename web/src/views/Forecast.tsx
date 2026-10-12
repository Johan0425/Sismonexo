// Pronóstico probabilístico: probabilidad de al menos un evento sobre el umbral, por zona y horizonte.
import type { Map as MLMap } from 'maplibre-gl'
import { Settings2, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { ProvenanceContext } from '@/charts/Chart'
import { ActiveFilters } from '@/components/Filters'
import { ZoneInspector } from '@/components/Inspectors'
import { copyLink } from '@/components/Palette'
import { useTheme } from '@/components/Shell'
import { Button, ErrorState, Field, IconButton, Kpis, Note, Pill, ProbabilityBadge, Segmented, Select, Sheet, Skeleton } from '@/components/ui'
import { HORIZONS, loadGeo, loadIndex, MODEL_ORDER, THRESHOLDS, UNITS, useAsync, type IndexData, type ModelKey, type Unit } from '@/lib/data'
import { dataUrlToBlob, download, downloadCsv, downloadGeoJson, provenance } from '@/lib/export'
import { dayEnd, dayStart, fmtDate, fmtInt, fmtNum, fmtPct, fmtSigned, inPhrase } from '@/lib/format'
import { zonePolygons } from '@/lib/geo'
import { pClass } from '@/lib/scales'
import { isTrained, useApp, type ZoneMetric } from '@/lib/store'
import { loadZoneData, paintZones, type ZoneData } from '@/lib/zonedata'
import { pickZone, useZoneLayer } from '@/map/layers'
import { MapView, mapSnapshot } from '@/map/MapView'
import { ExportMenu, LayerPanel, useMedia, ZoneLegendBox } from '@/map/MapUi'

export const CERTAINTY_NOTE = 'Una probabilidad alta no significa que un terremoto ocurrirá con certeza. Una probabilidad baja tampoco significa ausencia total de actividad.'
const METRICS: { value: ZoneMetric; label: string }[] = [
  { value: 'probabilidad', label: 'Probabilidad estimada' },
  { value: 'incertidumbre', label: 'Incertidumbre' },
  { value: 'cambio', label: 'Cambio frente al periodo anterior' },
  { value: 'tasa', label: 'Tasa histórica observada' },
  { value: 'calidad', label: 'Cobertura y calidad del catálogo' },
]

export function ForecastParamsForm({ index }: { index: IndexData }) {
  const fc = useApp((s) => s.fc)
  const filters = useApp((s) => s.filters)
  const { setFc, setFilters } = useApp.getState()
  const trained = isTrained(fc, filters)
  const custom = !(HORIZONS as readonly number[]).includes(fc.h)
  const [hText, setHText] = useState(String(fc.h))
  useEffect(() => setHText(String(fc.h)), [fc.h])
  const available = index.experiments.find((e) => e.unit === fc.unit && e.horizon === fc.h && e.threshold === fc.thr)
  return (
    <div className="stack">
      <div className="field">
        <span className="label" id="hz">Horizonte</span>
        <Segmented label="Horizonte" value={custom ? -1 : fc.h} onChange={(v) => setFc({ h: v === -1 ? 45 : v }, v === -1 ? 'Horizonte personalizado' : `Horizonte de ${v} días`)} options={[{ value: 7, label: '7 días' }, { value: 30, label: '30 días' }, { value: 90, label: '90 días' }, { value: -1, label: 'Otro' }]} />
        {custom && (
          <Field label="Días del horizonte personalizado" hint="Entre 1 y 365. Solo disponible con la línea base recalculada.">
            {(p) => (
              <input
                {...p}
                className="input num"
                type="number"
                min={1}
                max={365}
                value={hText}
                onChange={(e) => setHText(e.target.value)}
                onBlur={() => {
                  const n = Math.round(+hText)
                  if (n >= 1 && n <= 365) setFc({ h: n }, `Horizonte de ${n} días`)
                  else setHText(String(fc.h))
                }}
              />
            )}
          </Field>
        )}
        <span className="hint">El horizonte principal del proyecto es de 30 días.</span>
      </div>
      <Select
        label="Umbral de magnitud"
        value={fc.thr}
        onChange={(v) => setFc({ thr: v }, `Umbral M ≥ ${fmtNum(v, 1)}`)}
        options={[3, 3.5, 4, 4.5, 5, 5.5].map((v) => ({ value: v, label: `M ≥ ${fmtNum(v, 1)}${(THRESHOLDS as readonly number[]).includes(v) ? '' : ' · solo línea base'}` }))}
        hint="Probabilidad de registrar al menos un evento de esta magnitud o mayor."
      />
      <Select label="Resolución geográfica" value={fc.unit} onChange={(v: Unit) => setFc({ unit: v }, `Unidad: ${index.units[v].label}`)} options={UNITS.map((u) => ({ value: u, label: `${index.units[u].label} · ${fmtInt(index.units[u].n_zones)} zonas` }))} />
      <Select
        label="Modelo"
        value={trained ? fc.model : 'recalc'}
        onChange={(v) => v !== 'recalc' && setFc({ model: v as ModelKey | 'auto' }, v === 'auto' ? 'Modelo por defecto' : `Modelo: ${index.model_info[v as ModelKey].name}`)}
        options={
          trained
            ? [{ value: 'auto', label: `Por defecto${available ? ` (${index.model_info[available.selected_model].name})` : ''}` }, ...MODEL_ORDER.filter((k) => available?.models[k]).map((k) => ({ value: k as string, label: index.model_info[k].name }))]
            : [{ value: 'recalc', label: 'Línea base recalculada en el navegador' }]
        }
        hint={trained ? 'El modelo por defecto es el de menor log-loss en la validación previa a la prueba final.' : 'Los modelos de aprendizaje automático solo existen para las configuraciones entrenadas (7, 30 y 90 días; M ≥ 3, 4 y 5; todas las profundidades; histórico completo; sin suavizado).'}
      />
      <Select
        label="Profundidad"
        value={`${filters.depthMin}_${filters.depthMax}`}
        onChange={(v) => {
          const [a, b] = v.split('_').map(Number)
          setFilters({ depthMin: a, depthMax: b }, `Profundidad ${a}–${b} km`)
        }}
        options={[
          { value: '0_700', label: 'Todas' },
          ...index.depth_classes.map(([lo, hi, name]) => ({ value: `${lo}_${Math.min(hi, 700)}`, label: name })),
          ...([['0_700'], ...index.depth_classes.map(([lo, hi]) => [`${lo}_${Math.min(hi, 700)}`])].some(([k]) => k === `${filters.depthMin}_${filters.depthMax}`) ? [] : [{ value: `${filters.depthMin}_${filters.depthMax}`, label: `${filters.depthMin}–${filters.depthMax} km` }]),
        ]}
      />
      <Select label="Periodo histórico utilizado" value={fc.histFrom} onChange={(v) => setFc({ histFrom: v }, v === 1993 ? 'Histórico completo' : `Histórico desde ${v}`)} options={[{ value: 1993, label: 'Completo (desde 1993)' }, { value: 2000, label: 'Desde 2000' }, { value: 2010, label: 'Desde 2010' }, { value: 2018, label: 'Desde 2018 (SeisComP)' }, { value: 2021, label: 'Últimos 5 años (desde 2021)' }]} />
      <Select label="Nivel de suavizado espacial" value={fc.smooth} onChange={(v) => setFc({ smooth: v }, ['Sin suavizado', 'Suavizado leve', 'Suavizado amplio'][v])} options={[{ value: 0 as const, label: 'Ninguno' }, { value: 1 as const, label: 'Leve' }, { value: 2 as const, label: 'Amplio' }]} hint="Promedia la tasa con las zonas vecinas." />
      {!trained && (
        <Note tone="accent">Con estos parámetros no hay un modelo entrenado. Se muestra la línea base de frecuencia histórica recalculada con sus filtros; no tiene validación walk-forward propia.</Note>
      )}
    </div>
  )
}

export default function Forecast() {
  const index = useAsync(loadIndex, [])
  const fc = useApp((s) => s.fc)
  const filters = useApp((s) => s.filters)
  const metric = useApp((s) => s.zoneMetric)
  const selection = useApp((s) => s.selection)
  const { select, setZoneMetric, toast, announce } = useApp.getState()
  const theme = useTheme()
  const wide = useMedia('(min-width: 1100px)')
  const [map, setMap] = useState<MLMap | null>(null)
  const [compare, setCompare] = useState<number | null>(null)
  const [params, setParams] = useState(false)
  useEffect(() => {
    document.title = 'Pronóstico probabilístico · SismoNexo Colombia'
  }, [])

  const zd = useAsync(() => loadZoneData(fc, filters).then(async (d) => ({ d, polygons: await zonePolygons(d.zt, () => loadGeo(d.zt.unit === 'mun' ? 'mun' : 'dep')) })), [fc, filters.depthMin, filters.depthMax])
  const d: ZoneData | null = zd.data?.d ?? null
  const paint = useMemo(() => (d ? paintZones(d, metric, fc.thr) : null), [d, metric, fc.thr])
  useEffect(() => setCompare(null), [fc.unit])

  const zi = selection?.kind === 'zona' && d && selection.unit === d.zt.unit ? (d.zt.index.get(selection.id) ?? null) : null
  const pick = (z: number | null) => select(z == null || !d ? null : { kind: 'zona', unit: d.zt.unit, id: d.zt.id[z] })
  useZoneLayer({ map, polygons: zd.data?.polygons ?? null, colors: paint?.colors ?? null, patterns: paint?.patterns ?? null, selected: zi, theme, opacity: 0.84, outline: fc.unit !== 'mun' && fc.unit !== 'g25' })

  const stats = useMemo(() => {
    if (!d) return null
    const order = Array.from(d.p.keys()).sort((a, b) => d.p[b] - d.p[a])
    const mean = d.p.reduce((a, b) => a + b, 0) / d.p.length
    return { order, mean, over15: d.p.filter((p) => p >= 0.15).length, max: d.p[order[0]], expected: d.expected ? d.expected.reduce((a, b) => a + b, 0) : null }
  }, [d])
  useEffect(() => {
    if (d && stats) announce(`Pronóstico actualizado: ${d.zt.id.length} zonas, probabilidad media ${fmtPct(stats.mean)}, modelo ${d.modelName}.`)
  }, [d, stats, announce])

  if (index.status === 'error') return <ErrorState error={index.error} retry={index.retry} />
  const idx = index.data
  const prov = (title: string) => provenance(idx!, title, { version_modelo: d?.modelVersion, pronostico_generado: d?.generatedAt, filtros: [`Horizonte: ${fc.h} días`, `Umbral: M ≥ ${fmtNum(fc.thr, 1)}`, `Unidad: ${idx?.units[fc.unit].label}`, `Modelo: ${d?.modelName}`, `Profundidad: ${filters.depthMin}–${filters.depthMax} km`, `Histórico desde ${fc.histFrom}`, `Suavizado: ${fc.smooth}`] })
  const rows = () => (d ? d.zt.id.map((id, i) => [id, d.zt.name[i], d.zt.department[i], +d.p[i].toFixed(5), +d.lo[i].toFixed(5), +d.hi[i].toFixed(5), d.expected ? +d.expected[i].toFixed(4) : null, +(d.p[i] - d.pPrev[i]).toFixed(5), pClass(d.p[i]).label, d.start, d.end, fc.thr, d.modelName, d.modelVersion, d.calibration]) : [])
  const HEADER = ['zone_id', 'zone_name', 'department', 'probability', 'uncertainty_low', 'uncertainty_high', 'expected_count', 'change_vs_previous', 'class', 'forecast_start', 'forecast_end', 'magnitude_threshold', 'model_name', 'model_version', 'calibration_status']
  const exports = [
    { label: 'Pronóstico por zona (CSV)', hint: 'Con intervalo, modelo y versión', run: () => (downloadCsv(`sismonexo-pronostico-${fc.unit}-${fc.h}d.csv`, HEADER, rows(), prov('Pronóstico probabilístico por zona')), toast('Pronóstico exportado con fuente y versión del modelo.')) },
    {
      label: 'Pronóstico por zona (GeoJSON)',
      hint: 'Polígonos con sus valores',
      run: () => {
        if (!zd.data || !d) return
        const r = rows()
        downloadGeoJson(`sismonexo-pronostico-${fc.unit}-${fc.h}d.geojson`, zd.data.polygons.features.map((f) => ({ ...f, properties: Object.fromEntries(HEADER.map((h, k) => [h, r[(f.properties as { zi: number }).zi][k]])) })), prov('Pronóstico probabilístico por zona'))
        toast('Pronóstico exportado en GeoJSON.')
      },
    },
    { label: 'Imagen del mapa (PNG)', run: () => map && void mapSnapshot(map).then(({ dataUrl }) => (download('sismonexo-pronostico.png', dataUrlToBlob(dataUrl)), toast(`Imagen descargada. Cite: SGC–RSNC, modelo ${d?.modelVersion}.`))) },
    { label: 'Copiar enlace a esta vista', run: () => void copyLink().then((ok) => toast(ok ? 'Enlace copiado.' : 'No fue posible copiar; copie la dirección del navegador.')) },
  ]

  const body =
    zd.status === 'error' ? (
      <ErrorState error={zd.error} retry={zd.retry} />
    ) : !d || !stats || !idx ? (
      <div className="inspector-body stack" role="status" aria-label="Calculando el pronóstico">
        <Skeleton h={64} r={10} />
        <Skeleton h={120} r={10} />
        <Skeleton h={220} r={10} />
      </div>
    ) : zi != null ? (
      <ZoneInspector zd={d} zi={zi} index={idx} thr={fc.thr} h={fc.h} from={dayStart(filters.from)} to={dayEnd(filters.to)} depthMin={filters.depthMin} depthMax={filters.depthMax} compare={compare} onCompare={setCompare} />
    ) : (
      <div className="inspector-body">
        <section aria-label="Texto explicativo">
          <p className="small">
            Probabilidad de registrar <b>al menos un evento de magnitud {fmtNum(fc.thr, 1)} o superior</b> en cada zona entre el <b>{fmtDate(d.start)}</b> y el <b>{fmtDate(d.end)}</b> ({fc.h} días), según <b>{inPhrase(d.modelName)}</b>.
          </p>
          <div className="row wrap" style={{ marginTop: 10 }}>
            <Pill tone={d.calibration === 'calibrado' ? 'accent' : d.calibration === 'sin evaluar' ? undefined : 'caution'}>Calibración: {d.calibration}</Pill>
            <Pill>{d.trained ? 'Modelo entrenado y validado' : 'Línea base recalculada'}</Pill>
          </div>
          <Note tone="caution">{CERTAINTY_NOTE}</Note>
        </section>
        <section aria-label="Indicadores">
          <Kpis
            label="Indicadores del pronóstico"
            items={[
              { label: 'Zonas', value: fmtInt(d.zt.id.length), sub: idx.units[fc.unit].label.toLowerCase() },
              { label: 'Probabilidad media', value: fmtPct(stats.mean) },
              { label: 'Zonas con 15 % o más', value: fmtInt(stats.over15) },
              { label: 'Eventos esperados', value: stats.expected == null ? '—' : fmtNum(stats.expected, 1), sub: stats.expected == null ? 'el modelo no estima conteos' : 'suma de todas las zonas' },
            ]}
          />
        </section>
        <section aria-label="Zonas con mayor probabilidad">
          <h4>Zonas con mayor probabilidad</h4>
          <p className="caption" style={{ marginBottom: 8 }}>Alternativa tabular al mapa. Seleccione una zona para ver su detalle y la explicación del modelo.</p>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ maxHeight: 460 }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Zona</th>
                  <th scope="col" className="r">Prob.</th>
                  <th scope="col" className="r">Intervalo 90 %</th>
                  <th scope="col">Clase</th>
                </tr>
              </thead>
              <tbody>
                {stats.order.slice(0, 15).map((z) => (
                  <tr key={z}>
                    <th scope="row" style={{ whiteSpace: 'normal', minWidth: 150 }}>
                      <button type="button" className="rowlink" style={{ textAlign: 'left' }} onClick={() => pick(z)}>
                        {d.zt.name[z].replace(/^(Celda|Hexágono)[^·]*· /, '').split(' (')[0]}
                      </button>
                    </th>
                    <td className="r">{fmtPct(d.p[z])}</td>
                    <td className="r">
                      {fmtPct(d.lo[z])}–{fmtPct(d.hi[z])}
                    </td>
                    <td>
                      <ProbabilityBadge p={d.p[z]} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        <section aria-label="Ficha del pronóstico">
          <dl className="deflist">
            <dt>Modelo utilizado</dt>
            <dd>{d.modelName}</dd>
            <dt>Versión del modelo</dt>
            <dd style={{ fontSize: 12 }}>{d.modelVersion}</dd>
            <dt>Fecha de generación</dt>
            <dd>{fmtDate(d.generatedAt)}</dd>
            <dt>Versión de los datos</dt>
            <dd style={{ fontSize: 12 }}>{idx.dataset_version}</dd>
            {d.file && (
              <>
                <dt>PR-AUC (walk-forward)</dt>
                <dd>
                  {fmtNum(d.file.models[d.model]?.walk_forward.pr_auc ?? NaN, 3)} <span className="muted">(línea base {fmtNum(d.file.models.base?.walk_forward.pr_auc ?? NaN, 3)})</span>
                </dd>
                <dt>Mejora de Brier frente a la base</dt>
                <dd>{fmtSigned((d.file.models[d.model]?.walk_forward.brier_skill ?? 0) * 100, 1, ' %')}</dd>
              </>
            )}
          </dl>
          {!d.trained && <p className="caption" style={{ marginTop: 8 }}>Sin modelo entrenado por: {d.why}.</p>}
          <p className="caption" style={{ marginTop: 8 }}>Estimación experimental y académica. La amenaza sísmica oficial la publica el Servicio Geológico Colombiano.</p>
        </section>
      </div>
    )

  return (
    <ProvenanceContext.Provider value={idx ? prov : null}>
      <div className="map-layout">
        <MapView
          label="Mapa de probabilidad estimada por zona"
          onMap={setMap}
          onClick={(e, m) => pick(pickZone(m, e.point))}
          onPickCenter={(m) => {
            const r = m.getCanvas().getBoundingClientRect()
            pick(pickZone(m, { x: r.width / 2, y: r.height / 2 }))
          }}
        >
          <div className="map-ctrl tl no-print" style={{ right: 64 }}>
            <button type="button" className="btn glass" data-size="sm" style={{ minHeight: 44 }} onClick={() => setParams(true)} aria-haspopup="dialog">
              <Settings2 size={18} aria-hidden />
              {fc.h} días · M ≥ {fmtNum(fc.thr, 1)} · {idx?.units[fc.unit].label ?? ''}
            </button>
            <LayerPanel showViz={false}>
              <Select label="Variable del mapa" value={metric} options={METRICS} onChange={setZoneMetric} />
            </LayerPanel>
            <ExportMenu items={exports} />
            <ActiveFilters />
          </div>
          <div className="map-ctrl bl">
            {paint && (
              <ZoneLegendBox
                legend={paint.legend}
                value={zi != null && metric === 'probabilidad' && d ? d.p[zi] : undefined}
                footer={
                  <p className="caption" style={{ marginTop: 6 }}>
                    {fc.h} días · M ≥ {fmtNum(fc.thr, 1)} · {d?.modelName}. Estimación experimental, no oficial.
                  </p>
                }
              />
            )}
          </div>
          {!wide && zi == null && (
            <div className="map-ctrl br no-print" style={{ bottom: 12, right: 12 }}>
              <SummaryButton>{body}</SummaryButton>
            </div>
          )}
        </MapView>
        {wide && (
          <aside className="inspector" aria-label={zi != null ? 'Detalle de la zona seleccionada' : 'Resumen del pronóstico'}>
            <div className="inspector-head">
              <h2 style={{ fontSize: 'var(--fs-18)' }}>{zi != null && d ? d.zt.name[zi] : `Próximos ${fc.h} días`}</h2>
              {zi != null && (
                <IconButton label="Cerrar detalle de la zona" size="sm" onClick={() => pick(null)}>
                  <X size={18} aria-hidden />
                </IconButton>
              )}
            </div>
            {body}
          </aside>
        )}
        {!wide && (
          <Sheet open={zi != null} onClose={() => pick(null)} title={zi != null && d ? d.zt.name[zi] : 'Zona'}>
            <div style={{ margin: '0 -20px' }}>{zi != null && body}</div>
          </Sheet>
        )}
        <Sheet open={params} onClose={() => setParams(false)} title="Parámetros del pronóstico" footer={<Button variant="primary" onClick={() => setParams(false)}>Ver el mapa</Button>}>
          {idx && <ForecastParamsForm index={idx} />}
        </Sheet>
      </div>
    </ProvenanceContext.Provider>
  )
}

function SummaryButton({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className="btn glass" data-size="sm" style={{ minHeight: 44 }} onClick={() => setOpen(true)}>
        Resumen y tabla
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title="Resumen del pronóstico">
        <div style={{ margin: '0 -20px' }}>{children}</div>
      </Sheet>
    </>
  )
}
