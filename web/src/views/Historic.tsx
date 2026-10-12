// Explorador histórico: máquina del tiempo sísmica, comparación de periodos y constelación.
import type { Map as MLMap } from 'maplibre-gl'
import { Bookmark, Pause, Play, SkipBack, SkipForward, X } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { ChartFrame, ProvenanceContext, XYChart } from '@/charts/Chart'
import { ActiveFilters, FilterSheet } from '@/components/Filters'
import { useNames } from '@/components/Inspectors'
import { Page, useTheme } from '@/components/Shell'
import { Button, Card, Counter, Field, Gate, IconButton, Kpis, Note, PageSkeleton, Segmented, Switch, useKey, useMotionOk } from '@/components/ui'
import { loadActiveEvents, loadGeo, loadIndex, loadZones, useAsync, type Events, type IndexData } from '@/lib/data'
import { provenance } from '@/lib/export'
import { dayEnd, dayStart, fmtDate, fmtInt, fmtKm, fmtMag, fmtMonth, fmtNum, fmtSigned, isIsoDay, isoDay } from '@/lib/format'
import { assignZones, filterEvents, zonePolygons } from '@/lib/geo'
import { DEPTH_CLASSES, ramp, rampCss } from '@/lib/scales'
import { autoBin, BIN_LABEL, binNext, DAY, histogram, summarize, timeSeries, type Bin } from '@/lib/stats'
import { COVERAGE, describeFilters, useApp } from '@/lib/store'
import { eventsGeoJson, useEventLayers, useZoneLayer } from '@/map/layers'
import { dropLayers, EMPTY_FC, MapView, setSource } from '@/map/MapView'
import { EventLegend, useMedia, ZoneLegendBox } from '@/map/MapUi'

const Constellation = lazy(() => import('./Constellation'))
type Tab = 'tiempo' | 'comparar' | 'constelacion'

export default function Historic() {
  const imported = useApp((s) => s.imported)
  const ev = useAsync(loadActiveEvents, [imported])
  const index = useAsync(loadIndex, [])
  const [tab, setTab] = useState<Tab>('tiempo')
  useEffect(() => {
    document.title = 'Explorador histórico · SismoNexo Colombia'
  }, [])
  const tabs = (
    <Segmented
      label="Sección del explorador histórico"
      value={tab}
      onChange={setTab}
      options={[
        { value: 'tiempo', label: 'Máquina del tiempo' },
        { value: 'comparar', label: 'Comparar periodos' },
        { value: 'constelacion', label: 'Constelación' },
      ]}
    />
  )
  return (
    <Gate of={[ev, index] as const}>
      {(e, i) =>
        tab === 'tiempo' ? (
          <TimeMachine ev={e} index={i} tabs={tabs} />
        ) : (
          <div style={{ position: 'absolute', inset: 0, overflow: 'auto' }}>
            <Page title={tab === 'comparar' ? 'Comparar periodos' : 'Constelación sísmica'} lead={tab === 'comparar' ? 'Dos periodos del catálogo lado a lado: cuánto cambió la actividad registrada y dónde.' : 'Función experimental: los eventos como una red de cercanía en el espacio y el tiempo.'} actions={tabs} eyebrow="Explorador histórico">
              {tab === 'comparar' ? (
                <Compare ev={e} index={i} />
              ) : (
                <Suspense fallback={<PageSkeleton />}>
                  <Constellation ev={e} index={i} />
                </Suspense>
              )}
            </Page>
          </div>
        )
      }
    </Gate>
  )
}

// ------------------------------------------------------------------ máquina del tiempo

const SPEEDS = [
  { value: 1000, label: '1×' },
  { value: 500, label: '2×' },
  { value: 340, label: '3×' }, // nunca más de tres cambios por segundo
]
const BINS: Bin[] = ['dia', 'semana', 'mes', 'anio']

function TimeMachine({ ev, index, tabs }: { ev: Events; index: IndexData; tabs: React.ReactNode }) {
  const filters = useApp((s) => s.filters)
  const theme = useTheme()
  const motionOk = useMotionOk()
  const wide = useMedia('(min-width: 1100px)')
  const names = useNames()
  const { toast } = useApp.getState()
  const [map, setMap] = useState<MLMap | null>(null)
  const from = dayStart(filters.from)
  const to = dayEnd(filters.to)
  const [bin, setBin] = useState<Bin>(() => autoBin(to - from))
  const [k, setK] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1000)
  const [trail, setTrail] = useState(true)
  const [cumulative, setCumulative] = useState(false)
  const [heat, setHeat] = useState(false)
  const [moments, setMoments] = useState<{ t: number; bin: Bin; label: string }[]>([])

  const idx = useMemo(() => filterEvents(ev, filters), [ev, filters])
  // Un día a día sobre décadas produciría miles de pasos: se limita para mantener la reproducción fluida.
  const safeBin: Bin = useMemo(() => {
    const days = (to - from) / DAY
    if (bin === 'dia' && days > 800) return 'semana'
    if (bin === 'semana' && days > 6000) return 'mes'
    return bin
  }, [bin, from, to])
  const ts = useMemo(() => timeSeries(ev, idx, safeBin, from, to), [ev, idx, safeBin, from, to])
  const n = ts.t.length
  const kk = Math.min(k, Math.max(0, n - 1))
  useEffect(() => setK(0), [safeBin, from, to])
  const cum = useMemo(() => {
    let s = 0
    return ts.count.map((c) => (s += c))
  }, [ts])

  const tEnd = n ? binNext(ts.t[kk], safeBin) : to
  const trailN = safeBin === 'anio' ? 1 : safeBin === 'mes' ? 6 : safeBin === 'semana' ? 8 : 14
  const tStart = cumulative ? from : trail ? ts.t[Math.max(0, kk - trailN + 1)] : ts.t[kk]
  const win = useMemo<[number, number]>(() => [tStart ?? from, tEnd], [tStart, tEnd, from])
  useEventLayers({ map, ev, idx, viz: heat ? 'calor' : 'puntos', colorBy: 'profundidad', theme, selected: null, window: win, opacity: 0.78 })

  // Reproducción
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setK((v) => (v + 1 >= n ? (setPlaying(false), v) : v + 1)), speed)
    return () => clearInterval(id)
  }, [playing, speed, n])

  // Ondas: anillos que se expanden una vez sobre los eventos nuevos de mayor magnitud del paso actual.
  useEffect(() => {
    if (!map || !n) return
    const a = ts.t[kk]
    const fresh: number[] = []
    for (let j = 0; j < idx.length; j++) {
      const t = ev.t[idx[j]]
      if (t >= a && t < tEnd && ev.mag[idx[j]] >= 4) fresh.push(idx[j])
    }
    fresh.sort((x, y) => ev.mag[y] - ev.mag[x])
    setSource(map, 'ripples', eventsGeoJson(ev, fresh.slice(0, 12)))
    if (!map.getLayer('ripples')) map.addLayer({ id: 'ripples', type: 'circle', source: 'ripples', paint: { 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': theme === 'oscuro' ? '#f3f1ec' : '#1b1f23', 'circle-stroke-width': 1.5, 'circle-radius': 0, 'circle-stroke-opacity': 0 } }, 'anchor-top')
    if (!motionOk || !fresh.length) {
      map.setPaintProperty('ripples', 'circle-stroke-opacity', 0)
      return
    }
    let raf = 0
    const t0 = performance.now()
    const dur = Math.min(900, speed * 0.9)
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / dur)
      if (!map.getLayer('ripples')) return
      map.setPaintProperty('ripples', 'circle-radius', ['*', ['-', ['get', 'm'], 2], 4 + p * 14])
      map.setPaintProperty('ripples', 'circle-stroke-opacity', 0.8 * (1 - p))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [map, kk, ts, idx, ev, tEnd, motionOk, speed, theme, n])
  useEffect(() => () => void (map && dropLayers(map, ['ripples'], ['ripples'])), [map])
  useEffect(() => {
    if (map && !n) setSource(map, 'ripples', EMPTY_FC)
  }, [map, n])

  useKey((e) => {
    const el = e.target as HTMLElement
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(el.tagName) || document.querySelector('[role="dialog"]')) return
    if (e.key === ' ') (e.preventDefault(), setPlaying((p) => !p))
    else if (e.key === 'ArrowRight' && !el.classList.contains('maplibregl-canvas')) setK((v) => Math.min(n - 1, v + 1))
    else if (e.key === 'ArrowLeft' && !el.classList.contains('maplibregl-canvas')) setK((v) => Math.max(0, v - 1))
  })

  const label = (t: number) => (safeBin === 'anio' ? String(new Date(t * 1000).getUTCFullYear()) : safeBin === 'mes' ? fmtMonth(t) : fmtDate(t))
  const inWin = useMemo(() => {
    let c = 0
    let mx = NaN
    for (let j = 0; j < n; j++) if (ts.t[j] >= (tStart ?? 0) && ts.t[j] < tEnd) (c += ts.count[j]), (mx = !(mx >= ts.maxMag[j]) && Number.isFinite(ts.maxMag[j]) ? ts.maxMag[j] : mx)
    return { c, mx }
  }, [ts, tStart, tEnd, n])
  const prov = (title: string) => provenance(index, title, { filtros: describeFilters(filters, names.dep?.get(filters.dept)) })
  const maxCount = Math.max(1, ...ts.count)

  const narrow = useMedia('(max-width: 767px)')
  const options = (
    <>
      <div className="row wrap">
        <Segmented label="Paso de tiempo" value={safeBin} onChange={setBin} options={BINS.map((b) => ({ value: b, label: BIN_LABEL[b] }))} />
        <Segmented label="Velocidad" value={speed} onChange={setSpeed} options={SPEEDS} />
      </div>
      <div className="row wrap small" style={{ gap: 16 }}>
        <Switch label="Estela temporal" checked={trail && !cumulative} onChange={(v) => (setTrail(v), v && setCumulative(false))} />
        <Switch label="Acumulado" checked={cumulative} onChange={setCumulative} />
        <Switch label="Mapa de calor" checked={heat} onChange={setHeat} />
      </div>
    </>
  )
  const side = (
    <div className="inspector-body">
      <section>
        <Kpis
          label="Contadores de la reproducción"
          items={[
            { label: `Eventos en ${label(ts.t[kk] ?? from)}`, value: <Counter value={ts.count[kk] ?? 0} /> },
            { label: 'Acumulado', value: <Counter value={cum[kk] ?? 0} />, sub: `de ${fmtInt(idx.length)}` },
            { label: 'Magnitud máxima del paso', value: fmtMag(ts.maxMag[kk]) },
            { label: 'Profundidad mediana', value: fmtKm(ts.medianDepth[kk]) },
          ]}
        />
      </section>
      <section>
        <ChartFrame
          title={`Curva de frecuencia por ${BIN_LABEL[safeBin].toLowerCase()}`}
          summary={`Eventos por ${BIN_LABEL[safeBin].toLowerCase()} entre el ${fmtDate(from)} y el ${fmtDate(to)}. La línea vertical marca el momento de la reproducción (${label(ts.t[kk] ?? from)}). Haga clic en el gráfico para saltar a ese momento.`}
          table={{ columns: ['Inicio (UTC)', 'Eventos', 'Acumulado', 'Magnitud máxima', 'Profundidad mediana (km)'], rows: ts.t.map((t, j) => [isoDay(t), ts.count[j], cum[j], Number.isFinite(ts.maxMag[j]) ? +ts.maxMag[j].toFixed(1) : null, Number.isFinite(ts.medianDepth[j]) ? +ts.medianDepth[j].toFixed(0) : null]) }}
        >
          {(w) => <XYChart width={w} height={170} x={{ type: 'time' }} y={{}} cursor={ts.t[kk]} onPick={(x) => setK(Math.max(0, ts.t.indexOf(x)))} series={[{ key: 'n', label: 'Eventos', color: 'var(--s1)', type: 'area', data: ts.t.map((t, j) => [t, ts.count[j]]) }]} />}
        </ChartFrame>
      </section>
      <section>
        <ChartFrame
          title="Variación de la profundidad"
          summary="Profundidad mediana de los eventos de cada paso. Los cambios bruscos suelen reflejar secuencias locales o cambios en la red de estaciones, no necesariamente un cambio físico regional."
          table={{ columns: ['Inicio (UTC)', 'Profundidad mediana (km)'], rows: ts.t.map((t, j) => [isoDay(t), Number.isFinite(ts.medianDepth[j]) ? +ts.medianDepth[j].toFixed(0) : null]) }}
        >
          {(w) => <XYChart width={w} height={150} x={{ type: 'time' }} y={{ label: 'km' }} cursor={ts.t[kk]} series={[{ key: 'd', label: 'Profundidad mediana', color: 'var(--s3)', type: 'line', data: ts.t.map((t, j) => [t, Number.isFinite(ts.medianDepth[j]) ? ts.medianDepth[j] : null]) }]} />}
        </ChartFrame>
      </section>
      <section aria-label="Momentos guardados">
        <div className="row between">
          <h4>Momentos guardados</h4>
          <Button
            size="sm"
            icon={<Bookmark size={16} aria-hidden />}
            onClick={() => {
              setMoments((m) => [{ t: ts.t[kk], bin: safeBin, label: label(ts.t[kk]) }, ...m.filter((x) => x.t !== ts.t[kk])].slice(0, 12))
              toast(`Momento guardado: ${label(ts.t[kk])}.`)
            }}
          >
            Guardar este momento
          </Button>
        </div>
        {moments.length === 0 ? (
          <p className="small muted" style={{ marginTop: 8 }}>Guarde momentos importantes para volver a ellos durante la sesión.</p>
        ) : (
          <ul className="chips" style={{ marginTop: 8 }}>
            {moments.map((m) => (
              <li key={m.t} className="row" style={{ gap: 2 }}>
                <button type="button" className="chip" onClick={() => (setBin(m.bin), setTimeout(() => setK(Math.max(0, timeSeries(ev, idx, m.bin, from, to).t.indexOf(m.t))), 0))}>
                  {m.label}
                </button>
                <IconButton label={`Quitar ${m.label}`} size="sm" onClick={() => setMoments((x) => x.filter((y) => y.t !== m.t))}>
                  <X size={14} aria-hidden />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </section>
      <Note>Las ondas son una representación visual del evento y no una simulación física exacta.</Note>
    </div>
  )

  return (
    <ProvenanceContext.Provider value={prov}>
      <div className="map-layout">
        <MapView label="Mapa de la máquina del tiempo sísmica" onMap={setMap}>
          <div className="map-ctrl tl no-print" style={{ right: 64 }}>
            <div className="glass" style={{ borderRadius: 12 }}>{tabs}</div>
            <FilterSheet count={idx.length} title="Filtros y región">
              <p className="small muted">Para fijar una región, elija un departamento en «Ubicación». La reproducción respeta todos los filtros.</p>
            </FilterSheet>
            <ActiveFilters />
          </div>
          <div className="map-ctrl bl hide-narrow" style={{ bottom: 'auto', top: 68 }}>
            <EventLegend viz={heat ? 'calor' : 'puntos'} colorBy="profundidad" />
          </div>
          <div className="timeline glass no-print" role="group" aria-label="Controles de reproducción">
            <div className="row wrap between" style={{ gap: 12 }}>
              <div className="row">
                <IconButton label="Retroceder un paso" onClick={() => setK(Math.max(0, kk - 1))} disabled={kk === 0}>
                  <SkipBack size={20} aria-hidden />
                </IconButton>
                <IconButton label={playing ? 'Pausar' : 'Reproducir'} variant="primary" onClick={() => (kk >= n - 1 && !playing ? (setK(0), setPlaying(true)) : setPlaying(!playing))}>
                  {playing ? <Pause size={20} aria-hidden /> : <Play size={20} aria-hidden />}
                </IconButton>
                <IconButton label="Adelantar un paso" onClick={() => setK(Math.min(n - 1, kk + 1))} disabled={kk >= n - 1}>
                  <SkipForward size={20} aria-hidden />
                </IconButton>
                <div style={{ marginLeft: 8 }} aria-live="off">
                  <div className="num" style={{ fontWeight: 650, fontSize: 'var(--fs-18)', lineHeight: 1.1 }}>{n ? label(ts.t[kk]) : 'Sin datos'}</div>
                  <div className="caption num">
                    {fmtInt(inWin.c)} eventos visibles{Number.isFinite(inWin.mx) ? ` · M máx. ${fmtMag(inWin.mx)}` : ''}
                  </div>
                </div>
              </div>
            </div>
            <div style={{ position: 'relative', marginTop: 6 }}>
              <svg width="100%" height={34} viewBox={`0 0 ${Math.max(n, 1)} 34`} preserveAspectRatio="none" aria-hidden style={{ display: 'block' }}>
                {ts.count.map((c, j) => (
                  <rect key={j} x={j + 0.08} width={0.84} y={34 - (c / maxCount) * 32} height={(c / maxCount) * 32} fill={j <= kk ? 'var(--accent)' : 'var(--border-strong)'} />
                ))}
              </svg>
              <input type="range" min={0} max={Math.max(0, n - 1)} step={1} value={kk} onChange={(e) => (setPlaying(false), setK(+e.target.value))} aria-label="Momento de la reproducción" aria-valuetext={n ? `${label(ts.t[kk])}, ${fmtInt(ts.count[kk])} eventos` : 'Sin datos'} style={{ position: 'absolute', inset: 0, height: 34, opacity: 0.001 }} />
              <div style={{ position: 'absolute', top: 0, bottom: 0, left: `${((kk + 0.5) / Math.max(n, 1)) * 100}%`, width: 2, marginLeft: -1, background: 'var(--text)', pointerEvents: 'none' }} />
            </div>
            <div className="row between caption num" style={{ marginTop: 4 }}>
              <span>{fmtDate(from)}</span>
              <span>{fmtDate(to)}</span>
            </div>
            {narrow ? (
              <details className="disclosure" style={{ marginTop: 4 }}>
                <summary>Opciones de reproducción</summary>
                <div className="stack tight">{options}</div>
              </details>
            ) : (
              <div className="row wrap between" style={{ marginTop: 4 }}>{options}</div>
            )}
            {safeBin !== bin && <p className="caption">El periodo es demasiado largo para avanzar por {BIN_LABEL[bin].toLowerCase()}; se usa {BIN_LABEL[safeBin].toLowerCase()}. Reduzca el rango de fechas para un paso más fino.</p>}
            {!wide && <p className="caption" style={{ marginTop: 4 }}>Las ondas son una representación visual del evento y no una simulación física exacta.</p>}
          </div>
        </MapView>
        {wide && (
          <aside className="inspector" aria-label="Indicadores de la reproducción">
            <div className="inspector-head">
              <h2 style={{ fontSize: 'var(--fs-18)' }}>Máquina del tiempo</h2>
            </div>
            {side}
          </aside>
        )}
      </div>
    </ProvenanceContext.Provider>
  )
}

// ------------------------------------------------------------------ comparación de periodos

function PeriodFields({ label, value, onChange }: { label: string; value: [string, string]; onChange: (v: [string, string]) => void }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
      <legend style={{ fontWeight: 620, marginBottom: 6 }}>{label}</legend>
      <div className="range-pair">
        <Field label="Desde">{(p) => <input {...p} type="date" className="input num" min={COVERAGE.from} max={COVERAGE.to} value={value[0]} onChange={(e) => isIsoDay(e.target.value) && onChange([e.target.value, value[1]])} />}</Field>
        <Field label="Hasta" error={value[0] > value[1] ? 'Debe ser posterior al inicio.' : undefined}>
          {(p) => <input {...p} type="date" className="input num" min={COVERAGE.from} max={COVERAGE.to} value={value[1]} onChange={(e) => isIsoDay(e.target.value) && onChange([value[0], e.target.value])} />}
        </Field>
      </div>
    </fieldset>
  )
}

function Compare({ ev, index }: { ev: Events; index: IndexData }) {
  const filters = useApp((s) => s.filters)
  const theme = useTheme()
  const names = useNames()
  const end = COVERAGE.to
  const y = +end.slice(0, 4)
  const [a, setA] = useState<[string, string]>([`${y - 10}${end.slice(4)}`, `${y - 5}${end.slice(4)}`])
  const [b, setB] = useState<[string, string]>([`${y - 5}${end.slice(4)}`, end])
  const [map, setMap] = useState<MLMap | null>(null)
  const part = (p: [string, string]) => {
    const idx = filterEvents(ev, { ...filters, from: p[0] <= p[1] ? p[0] : p[1], to: p[1] })
    const s = summarize(ev, idx)
    const months = Math.max((dayEnd(p[1]) - dayStart(p[0])) / DAY / 30.44, 0.03)
    let m4 = 0
    for (let k = 0; k < idx.length; k++) if (ev.mag[idx[k]] >= 4) m4++
    return { idx: Uint32Array.from(idx), s, months, m4, magH: histogram(Array.from(idx, (i) => ev.mag[i]), 2.5, 0.5, 9) }
  }
  // filterEvents guarda en caché un solo resultado por catálogo: se copian los índices de cada periodo.
  const A = useMemo(() => part(a), [ev, filters, a]) // eslint-disable-line react-hooks/exhaustive-deps
  const B = useMemo(() => part(b), [ev, filters, b]) // eslint-disable-line react-hooks/exhaustive-deps

  const grid = useAsync(async () => {
    const zt = await loadZones('g50')
    const [zoneOf, polygons] = await Promise.all([assignZones(ev, zt), zonePolygons(zt, () => loadGeo('dep'))])
    return { zt, zoneOf, polygons }
  }, [ev])
  const diff = useMemo(() => {
    if (grid.status !== 'ready') return null
    const { zt, zoneOf, polygons } = grid.data
    const ra = new Float64Array(zt.id.length)
    const rb = new Float64Array(zt.id.length)
    for (const i of A.idx) if (zoneOf[i] >= 0) ra[zoneOf[i]] += 1 / A.months
    for (const i of B.idx) if (zoneOf[i] >= 0) rb[zoneOf[i]] += 1 / B.months
    const d = Float64Array.from(ra, (v, i) => rb[i] - v)
    const m = Math.max(0.05, ...Array.from(d, Math.abs).sort((x, y2) => x - y2).slice(0, Math.ceil(d.length * 0.98)))
    return { polygons, m, colors: Array.from(d, (v, i) => (ra[i] === 0 && rb[i] === 0 ? null : ramp('diverging', 0.5 + Math.max(-1, Math.min(1, v / m)) / 2))) }
  }, [grid, A, B])
  useZoneLayer({ map, polygons: diff?.polygons ?? null, colors: diff?.colors ?? null, selected: null, theme, opacity: 0.85 })

  const rows: [string, string, string, string][] = [
    ['Eventos registrados', fmtInt(A.s.n), fmtInt(B.s.n), fmtSigned(B.s.n - A.s.n, 0)],
    ['Eventos por mes', fmtNum(A.s.n / A.months, 1), fmtNum(B.s.n / B.months, 1), fmtSigned(B.s.n / B.months - A.s.n / A.months, 1)],
    ['Eventos M ≥ 4,0', fmtInt(A.m4), fmtInt(B.m4), fmtSigned(B.m4 - A.m4, 0)],
    ['Magnitud máxima', fmtMag(A.s.maxMag), fmtMag(B.s.maxMag), fmtSigned(B.s.maxMag - A.s.maxMag, 1)],
    ['Profundidad mediana (km)', fmtNum(A.s.medianDepth, 0), fmtNum(B.s.medianDepth, 0), fmtSigned(B.s.medianDepth - A.s.medianDepth, 0)],
    ['Localizaciones A o B', A.s.n ? `${fmtNum((A.s.good / A.s.n) * 100, 0)} %` : '—', B.s.n ? `${fmtNum((B.s.good / B.s.n) * 100, 0)} %` : '—', A.s.n && B.s.n ? fmtSigned((B.s.good / B.s.n - A.s.good / A.s.n) * 100, 0, ' pts') : '—'],
  ]
  const prov = (title: string) => provenance(index, title, { filtros: [`Periodo A: ${a[0]} a ${a[1]}`, `Periodo B: ${b[0]} a ${b[1]}`, ...describeFilters(filters, names.dep?.get(filters.dept)).slice(1)] })
  const cats = A.magH.map((_, k) => (k === 8 ? '6,5+' : fmtNum(2.5 + k * 0.5, 1)))
  const crosses = a[0] < '2018-03-01' !== b[0] < '2018-03-01'
  return (
    <ProvenanceContext.Provider value={prov}>
      <div className="stack">
        <Card>
          <div className="grid c2">
            <PeriodFields label="Periodo A (referencia)" value={a} onChange={setA} />
            <PeriodFields label="Periodo B (comparado)" value={b} onChange={setB} />
          </div>
          <p className="caption" style={{ marginTop: 10 }}>Los filtros de magnitud, profundidad y ubicación activos se aplican a ambos periodos. Las fechas son días UTC.</p>
        </Card>
        {crosses && <Note tone="caution">Los periodos quedan a lados distintos de marzo de 2018, cuando el SGC cambió el sistema de procesamiento y los tipos de magnitud. Parte de la diferencia puede deberse a ese cambio y no a la actividad sísmica.</Note>}
        <div className="grid c2">
          <Card title="Indicadores lado a lado">
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ maxHeight: 'none' }}>
              <table className="table">
                <caption className="sr-only">Comparación de indicadores entre el periodo A y el periodo B</caption>
                <thead>
                  <tr>
                    <th scope="col">Indicador</th>
                    <th scope="col" className="r">A</th>
                    <th scope="col" className="r">B</th>
                    <th scope="col" className="r">B − A</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r[0]}>
                      <th scope="row">{r[0]}</th>
                      <td className="r">{r[1]}</td>
                      <td className="r">{r[2]}</td>
                      <td className="r">{r[3]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
          <Card>
            <ChartFrame
              heading="h3"
              title="Magnitudes: eventos por mes en cada periodo"
              summary={`Tasa mensual por intervalo de magnitud. El periodo A registró ${fmtNum(A.s.n / A.months, 1)} eventos por mes y el B ${fmtNum(B.s.n / B.months, 1)}.`}
              table={{ columns: ['Magnitud', 'A (eventos/mes)', 'B (eventos/mes)'], rows: cats.map((c, k) => [c, +(A.magH[k] / A.months).toFixed(3), +(B.magH[k] / B.months).toFixed(3)]) }}
              legend={[{ label: 'Periodo A', color: 'var(--s6)', shape: 'box' }, { label: 'Periodo B', color: 'var(--s1)', shape: 'box' }]}
            >
              {(w) => (
                <XYChart
                  width={w}
                  height={230}
                  x={{ type: 'band', categories: cats, label: 'Magnitud' }}
                  y={{ label: 'Eventos por mes', format: (v) => fmtNum(v, v < 10 ? 1 : 0) }}
                  series={[
                    { key: 'a', label: 'Periodo A', color: 'var(--s6)', type: 'bar', data: A.magH.map((v, k) => [k, v / A.months]) },
                    { key: 'b', label: 'Periodo B', color: 'var(--s1)', type: 'bar', data: B.magH.map((v, k) => [k, v / B.months]) },
                  ]}
                />
              )}
            </ChartFrame>
          </Card>
        </div>
        <div className="grid c2">
          <Card title="Dónde cambió la actividad registrada" subtitle="Diferencia de eventos por mes (B − A) en celdas de unos 50 km.">
            <div style={{ position: 'relative', height: 440, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)' }}>
              <MapView label="Mapa de diferencia de actividad entre periodos" onMap={setMap} syncView={false} labels={false}>
                <div className="map-ctrl bl">
                  {diff && <ZoneLegendBox legend={{ title: 'Eventos por mes: B − A', kind: 'rampa', ramp: rampCss('diverging'), min: `−${fmtNum(diff.m, 1)}`, mid: '0', max: `+${fmtNum(diff.m, 1)}`, note: 'Azul: menos en B. Ocre: más en B.' }} />}
                </div>
              </MapView>
            </div>
          </Card>
          <Card>
            <ChartFrame
              heading="h3"
              title="Profundidad: proporción por clase"
              summary="Porcentaje de eventos de cada periodo en las cinco clases de profundidad del proyecto."
              table={{ columns: ['Clase', 'A (%)', 'B (%)'], rows: DEPTH_CLASSES.map((c) => [c.label, A.s.n ? +((A.s.byDepthClass[c.i] / A.s.n) * 100).toFixed(1) : null, B.s.n ? +((B.s.byDepthClass[c.i] / B.s.n) * 100).toFixed(1) : null]) }}
              legend={[{ label: 'Periodo A', color: 'var(--s6)', shape: 'box' }, { label: 'Periodo B', color: 'var(--s1)', shape: 'box' }]}
            >
              {(w) => (
                <XYChart
                  width={w}
                  height={230}
                  x={{ type: 'band', categories: DEPTH_CLASSES.map((c) => c.label.replace(' km', '').replace('Más de ', '>')), label: 'Profundidad (km)' }}
                  y={{ format: (v) => `${fmtNum(v, 0)} %` }}
                  series={[
                    { key: 'a', label: 'Periodo A', color: 'var(--s6)', type: 'bar', data: DEPTH_CLASSES.map((c) => [c.i, A.s.n ? (A.s.byDepthClass[c.i] / A.s.n) * 100 : 0]) },
                    { key: 'b', label: 'Periodo B', color: 'var(--s1)', type: 'bar', data: DEPTH_CLASSES.map((c) => [c.i, B.s.n ? (B.s.byDepthClass[c.i] / B.s.n) * 100 : 0]) },
                  ]}
                />
              )}
            </ChartFrame>
          </Card>
        </div>
      </div>
    </ProvenanceContext.Provider>
  )
}

