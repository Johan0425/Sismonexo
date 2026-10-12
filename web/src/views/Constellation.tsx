// Constelación sísmica (experimental): red de eventos enlazados por cercanía en el espacio y el tiempo.
import { Pause, Play } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { DataTable } from '@/charts/Chart'
import { useNames } from '@/components/Inspectors'
import { Button, Card, EmptyState, Kpis, Note, Segmented, Select, Slider, useMotionOk, useWidth } from '@/components/ui'
import { loadGeo, useAsync, type Events, type IndexData } from '@/lib/data'
import { downloadCsv, provenance } from '@/lib/export'
import { dayEnd, dayStart, fmtDate, fmtInt, fmtMag, fmtNum, isoDay } from '@/lib/format'
import { filterEvents, haversineKm, placeName } from '@/lib/geo'
import { DEPTH_CLASSES, depthClass, NO_DATA_COLOR } from '@/lib/scales'
import { DAY } from '@/lib/stats'
import { describeFilters, useApp } from '@/lib/store'

const MAX_NODES = 350

interface Net {
  nodes: number[] // índices de evento, en orden cronológico
  links: { a: number; b: number; w: number }[] // posiciones en nodes; w = cercanía temporal 0..1
  comp: number[]
  sizes: number[]
  layout: [number, number][]
  truncated: number
}

function buildNet(ev: Events, idx: Uint32Array, minMag: number, km: number, days: number): Net {
  let pick = Array.from(idx).filter((i) => ev.mag[i] >= minMag)
  const truncated = Math.max(0, pick.length - MAX_NODES)
  if (truncated) pick = pick.sort((a, b) => ev.mag[b] - ev.mag[a]).slice(0, MAX_NODES)
  const nodes = pick.sort((a, b) => ev.t[a] - ev.t[b])
  const n = nodes.length
  const links: Net['links'] = []
  const parent = nodes.map((_, i) => i)
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])))
  for (let a = 0; a < n; a++)
    for (let b = a + 1; b < n; b++) {
      const dt = (ev.t[nodes[b]] - ev.t[nodes[a]]) / DAY
      if (dt > days) break
      if (haversineKm(ev.lon[nodes[a]], ev.lat[nodes[a]], ev.lon[nodes[b]], ev.lat[nodes[b]]) > km) continue
      links.push({ a, b, w: 1 - dt / days })
      parent[find(a)] = find(b)
    }
  const comp = nodes.map((_, i) => find(i))
  const sizes = new Array<number>(n).fill(0)
  comp.forEach((c) => sizes[c]++)

  // Disposición por fuerzas (determinista): repulsión entre nodos, resortes en los enlaces y gravedad al centro.
  const pos: [number, number][] = nodes.map((_, i) => {
    const ang = i * 2.39996323
    const r = 12 * Math.sqrt(i + 1)
    return [Math.cos(ang) * r, Math.sin(ang) * r]
  })
  for (let it = 0; it < 140; it++) {
    const f = pos.map(() => [0, 0])
    const temp = 6 * (1 - it / 140) + 0.4
    for (let a = 0; a < n; a++)
      for (let b = a + 1; b < n; b++) {
        const dx = pos[a][0] - pos[b][0]
        const dy = pos[a][1] - pos[b][1]
        const d2 = dx * dx + dy * dy + 0.01
        const k = 420 / d2
        f[a][0] += dx * k
        f[a][1] += dy * k
        f[b][0] -= dx * k
        f[b][1] -= dy * k
      }
    for (const l of links) {
      const dx = pos[l.b][0] - pos[l.a][0]
      const dy = pos[l.b][1] - pos[l.a][1]
      const d = Math.hypot(dx, dy) + 0.01
      const k = (d - 16) * 0.06
      f[l.a][0] += (dx / d) * k * d * 0.2
      f[l.a][1] += (dy / d) * k * d * 0.2
      f[l.b][0] -= (dx / d) * k * d * 0.2
      f[l.b][1] -= (dy / d) * k * d * 0.2
    }
    for (let a = 0; a < n; a++) {
      f[a][0] -= pos[a][0] * 0.012
      f[a][1] -= pos[a][1] * 0.012
      const m = Math.hypot(f[a][0], f[a][1]) + 1e-9
      const step = Math.min(m, temp)
      pos[a][0] += (f[a][0] / m) * step
      pos[a][1] += (f[a][1] / m) * step
    }
  }
  return { nodes, links, comp, sizes, layout: pos, truncated }
}

export default function Constellation({ ev, index }: { ev: Events; index: IndexData }) {
  const filters = useApp((s) => s.filters)
  const { setFilters, toast } = useApp.getState()
  const names = useNames()
  const motionOk = useMotionOk()
  const dep = useAsync(() => loadGeo('dep'), [])
  const [ref, width] = useWidth<HTMLDivElement>(800)
  const [mode, setMode] = useState<'mapa' | 'grafo'>('mapa')
  const [minMag, setMinMag] = useState(4.5)
  const [km, setKm] = useState(60)
  const [days, setDays] = useState(10)
  const [reveal, setReveal] = useState(1)
  const [playing, setPlaying] = useState(false)
  const [sel, setSel] = useState<number | null>(null)
  const [table, setTable] = useState(false)

  const idx = useMemo(() => filterEvents(ev, filters), [ev, filters])
  const net = useMemo(() => buildNet(ev, idx, minMag, km, days), [ev, idx, minMag, km, days])
  const n = net.nodes.length
  useEffect(() => (setSel(null), setReveal(1)), [net])
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setReveal((r) => (r >= 1 ? (setPlaying(false), 1) : Math.min(1, r + 1 / 40))), 340)
    return () => clearInterval(id)
  }, [playing])
  const shown = Math.max(1, Math.round(reveal * n))

  const height = Math.min(620, Math.max(360, Math.round(width * 0.62)))
  const pts = useMemo(() => {
    if (!n) return []
    const raw: [number, number][] = mode === 'grafo' ? net.layout : net.nodes.map((i) => [ev.lon[i], -ev.lat[i]])
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    for (const [x, y] of raw) (x0 = Math.min(x0, x)), (x1 = Math.max(x1, x)), (y0 = Math.min(y0, y)), (y1 = Math.max(y1, y))
    const pad = 36
    const sx = (width - 2 * pad) / (x1 - x0 || 1)
    const sy = (height - 2 * pad) / (y1 - y0 || 1)
    const s = mode === 'grafo' ? Math.min(sx, sy) : Math.min(sx, sy)
    const ox = (width - (x1 - x0) * s) / 2
    const oy = (height - (y1 - y0) * s) / 2
    return { p: raw.map(([x, y]) => [ox + (x - x0) * s, oy + (y - y0) * s] as [number, number]), proj: (lon: number, lat: number) => [ox + (lon - x0) * s, oy + (-lat - y0) * s] }
  }, [net, mode, width, height, ev, n]) as { p: [number, number][]; proj: (lon: number, lat: number) => number[] } | never[]
  const P = Array.isArray(pts) ? null : pts
  const outlines = useMemo(() => {
    if (mode !== 'mapa' || !P || dep.status !== 'ready') return ''
    return dep.data.features
      .map((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((poly) => poly[0].filter((_, k) => k % 3 === 0).map(([x, y], k) => `${k ? 'L' : 'M'}${P.proj(x, y).map((v) => v.toFixed(1)).join(' ')}`).join('') + 'Z').join(''))
      .join('')
  }, [mode, P, dep])

  const selComp = sel != null ? net.comp[sel] : -1
  const seq = sel != null ? net.nodes.map((i, k) => ({ i, k })).filter((x) => net.comp[x.k] === selComp) : []
  const clusters = useMemo(() => {
    const m = new Map<number, number[]>()
    net.comp.forEach((c, k) => m.set(c, [...(m.get(c) ?? []), k]))
    return [...m.values()].filter((g) => g.length >= 2).sort((a, b) => b.length - a.length)
  }, [net])
  const byRegion = useMemo(() => {
    const m = new Map<string, { seq: number; events: number; largest: number }>()
    for (const g of clusters) {
      const main = g.reduce((a, b) => (ev.mag[net.nodes[b]] > ev.mag[net.nodes[a]] ? b : a))
      const i = net.nodes[main]
      const region = ev.dep[i] >= 0 ? (names.dep?.get(ev.depCodes[ev.dep[i]]) ?? ev.depCodes[ev.dep[i]]) : ev.locNames[ev.loc[i]] || 'Fuera de los departamentos'
      const r = m.get(region) ?? { seq: 0, events: 0, largest: 0 }
      m.set(region, { seq: r.seq + 1, events: r.events + g.length, largest: Math.max(r.largest, g.length) })
    }
    return [...m.entries()].sort((a, b) => b[1].events - a[1].events)
  }, [clusters, ev, net, names.dep])
  const r = (m: number) => 2.5 + (m - 2.5) ** 1.5 * 1.5
  const color = (i: number) => depthClass(ev.depth[i])?.color ?? NO_DATA_COLOR

  return (
    <div className="stack">
      <Note tone="caution">La conexión visual entre dos eventos indica solo que ocurrieron cerca en el espacio y en el tiempo. No implica causalidad física ni que uno haya desencadenado al otro.</Note>
      <div className="grid main-aside">
        <Card>
          <div className="row wrap between" style={{ marginBottom: 12 }}>
            <Segmented label="Vista" value={mode} onChange={setMode} options={[{ value: 'mapa', label: 'Vista geográfica' }, { value: 'grafo', label: 'Vista de grafo' }]} />
            <div className="row">
              <Button size="sm" icon={playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />} onClick={() => (reveal >= 1 && !playing ? (setReveal(0), setPlaying(true)) : setPlaying(!playing))}>
                {playing ? 'Pausar' : 'Reproducir la construcción'}
              </Button>
              <Button size="sm" variant="ghost" aria-pressed={table} onClick={() => setTable((v) => !v)}>
                {table ? 'Ver red' : 'Ver tabla'}
              </Button>
            </div>
          </div>
          <div ref={ref}>
            {n === 0 ? (
              <EmptyState title="No hay eventos para formar la red">Reduzca la magnitud mínima de la red o amplíe el periodo en los filtros.</EmptyState>
            ) : table ? (
              <DataTable
                caption="Eventos de la constelación (nodos), con su secuencia"
                maxHeight={height}
                table={{ columns: ['Fecha (UTC)', 'Magnitud', 'Profundidad (km)', 'Lugar', 'Eventos en su secuencia'], rows: net.nodes.map((i, k) => [isoDay(ev.t[i]), +ev.mag[i].toFixed(1), Number.isFinite(ev.depth[i]) ? Math.round(ev.depth[i]) : null, placeName(ev, i, names.mun, names.dep), net.sizes[net.comp[k]]]) }}
              />
            ) : (
              <svg width={width} height={height} role="img" aria-label={`Red de ${fmtInt(n)} eventos de magnitud ${fmtNum(minMag, 1)} o superior con ${fmtInt(net.links.length)} enlaces de cercanía. ${fmtInt(clusters.length)} secuencias de dos o más eventos; la mayor reúne ${fmtInt(clusters[0]?.length ?? 0)}.`} style={{ background: 'var(--surface-2)', borderRadius: 12 }}>
                {outlines && <path d={outlines} fill="var(--map-land-co)" stroke="var(--map-line-soft)" strokeWidth={0.7} />}
                {P &&
                  net.links.map((l, k) =>
                    l.b < shown ? (
                      <line key={k} x1={P.p[l.a][0]} y1={P.p[l.a][1]} x2={P.p[l.b][0]} y2={P.p[l.b][1]} stroke={selComp >= 0 && net.comp[l.a] === selComp ? 'var(--text)' : 'var(--text-2)'} strokeWidth={selComp >= 0 && net.comp[l.a] === selComp ? 1.6 : 0.9} opacity={(selComp >= 0 && net.comp[l.a] !== selComp ? 0.12 : 0.2) + l.w * 0.6} style={motionOk ? { transition: 'opacity 300ms' } : undefined} />
                    ) : null,
                  )}
                {P &&
                  net.nodes.map((i, k) =>
                    k < shown ? (
                      <circle
                        key={i}
                        cx={P.p[k][0]}
                        cy={P.p[k][1]}
                        r={r(ev.mag[i])}
                        fill={color(i)}
                        stroke={sel === k ? 'var(--text)' : 'var(--surface)'}
                        strokeWidth={sel === k ? 2.5 : 1}
                        opacity={selComp >= 0 && net.comp[k] !== selComp ? 0.3 : 0.95}
                        tabIndex={net.sizes[net.comp[k]] >= 2 || ev.mag[i] >= 5.5 ? 0 : -1}
                        role="button"
                        aria-label={`Evento de magnitud ${fmtMag(ev.mag[i])} del ${fmtDate(ev.t[i])} en ${placeName(ev, i, names.mun, names.dep)}; secuencia de ${net.sizes[net.comp[k]]} eventos`}
                        onClick={() => setSel(sel === k ? null : k)}
                        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), setSel(sel === k ? null : k))}
                        style={{ cursor: 'pointer', transition: motionOk ? 'cx 420ms var(--ease), cy 420ms var(--ease), opacity 200ms' : undefined }}
                      />
                    ) : null,
                  )}
              </svg>
            )}
          </div>
          <Slider label="Construcción de la red (orden cronológico)" value={Math.round(reveal * 100)} min={0} max={100} step={1} onChange={(v) => (setPlaying(false), setReveal(v / 100))} format={() => (n ? `${fmtInt(shown)} de ${fmtInt(n)} eventos · hasta ${fmtDate(ev.t[net.nodes[shown - 1]])}` : '—')} />
          <div className="legend">
            {DEPTH_CLASSES.map((c) => (
              <span key={c.i}>
                <i data-shape="dot" style={{ background: c.color }} />
                {c.label}
              </span>
            ))}
            <span>Tamaño = magnitud · Línea más intensa = eventos más próximos en el tiempo</span>
          </div>
        </Card>
        <div className="stack">
          <Card title="Parámetros de la red">
            <div className="stack">
              <Slider label="Magnitud mínima de los nodos" value={minMag} min={3} max={6} step={0.1} onChange={setMinMag} format={(v) => `M ≥ ${fmtNum(v, 1)}`} />
              <Slider label="Cercanía espacial" value={km} min={10} max={200} step={5} onChange={setKm} format={(v) => `${v} km`} />
              <Slider label="Cercanía temporal" value={days} min={1} max={60} step={1} onChange={setDays} format={(v) => `${v} ${v === 1 ? 'día' : 'días'}`} />
              <Select
                label="Periodo"
                value={`${filters.from}_${filters.to}`}
                onChange={(v) => {
                  const [a, b] = v.split('_')
                  setFilters({ from: a, to: b }, `Periodo ${a} a ${b}`)
                }}
                options={[
                  { value: `${filters.from}_${filters.to}`, label: `Actual: ${filters.from} a ${filters.to}` },
                  ...[2, 5, 10].map((y) => ({ value: `${isoDay(dayEnd(index.coverage[1].slice(0, 10)) - y * 365.25 * DAY)}_${index.coverage[1].slice(0, 10)}`, label: `Últimos ${y} años` })),
                  { value: `${index.coverage[0].slice(0, 10)}_${index.coverage[1].slice(0, 10)}`, label: 'Todo el catálogo' },
                ].filter((o, k, a) => a.findIndex((x) => x.value === o.value) === k)}
                hint="Usa los mismos filtros de fecha, profundidad y ubicación que el resto de la aplicación."
              />
              {net.truncated > 0 && <Note>Para mantener la red legible se muestran los {MAX_NODES} eventos de mayor magnitud; quedan fuera {fmtInt(net.truncated)}. Suba la magnitud mínima o acorte el periodo.</Note>}
            </div>
          </Card>
          <Kpis
            label="Indicadores de la red"
            items={[
              { label: 'Eventos (nodos)', value: fmtInt(n) },
              { label: 'Enlaces', value: fmtInt(net.links.length) },
              { label: 'Secuencias', value: fmtInt(clusters.length), sub: 'con 2 eventos o más' },
              { label: 'Mayor secuencia', value: fmtInt(clusters[0]?.length ?? 0), sub: 'eventos' },
            ]}
          />
        </div>
      </div>
      <div className="grid c2">
        <Card title={sel != null ? 'Secuencia seleccionada' : 'Seleccione una secuencia'} subtitle={sel != null ? `${seq.length} ${seq.length === 1 ? 'evento sin vecinos cercanos' : 'eventos enlazados'}; el seleccionado está resaltado.` : 'Haga clic en un nodo (o use Tab y Enter) para ver los eventos anteriores y posteriores de su grupo.'}>
          {sel != null && (
            <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable">
              <table className="table">
                <thead>
                  <tr>
                    <th scope="col">Fecha (UTC)</th>
                    <th scope="col" className="r">M</th>
                    <th scope="col" className="r">Prof.</th>
                    <th scope="col">Relación</th>
                    <th scope="col">Lugar</th>
                  </tr>
                </thead>
                <tbody>
                  {seq.map(({ i, k }) => (
                    <tr key={i} data-highlight={k === sel}>
                      <th scope="row">
                        <button type="button" className="rowlink" onClick={() => setSel(k)}>
                          {isoDay(ev.t[i])}
                        </button>
                      </th>
                      <td className="r">{fmtMag(ev.mag[i])}</td>
                      <td className="r">{Number.isFinite(ev.depth[i]) ? fmtInt(ev.depth[i]) : '—'}</td>
                      <td>{k === sel ? 'Seleccionado' : k < sel ? 'Anterior' : 'Posterior'}</td>
                      <td>{placeName(ev, i, names.mun, names.dep)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card
          title="Comparación por región"
          subtitle="Secuencias agrupadas según el lugar de su evento de mayor magnitud."
          actions={
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                downloadCsv('sismonexo-constelacion-regiones.csv', ['Región', 'Secuencias', 'Eventos enlazados', 'Mayor secuencia'], byRegion.map(([k, v]) => [k, v.seq, v.events, v.largest]), provenance(index, 'Constelación sísmica: secuencias por región', { filtros: [...describeFilters(filters, names.dep?.get(filters.dept)), `Red: M ≥ ${minMag}, ${km} km, ${days} días`] }))
                toast('Tabla exportada en CSV.')
              }}
            >
              CSV
            </Button>
          }
        >
          {byRegion.length === 0 ? (
            <p className="small muted">Con estos parámetros no hay grupos de dos o más eventos.</p>
          ) : (
            <DataTable caption="Secuencias por región" maxHeight={320} table={{ columns: ['Región', 'Secuencias', 'Eventos enlazados', 'Mayor secuencia'], rows: byRegion.map(([k, v]) => [k, v.seq, v.events, v.largest]) }} />
          )}
        </Card>
      </div>
      <p className="caption">Periodo: {fmtDate(dayStart(filters.from))} a {fmtDate(dayEnd(filters.to))}. Fuente: SGC–RSNC, versión {index.dataset_version}. Las «secuencias» son componentes conexos de la red de cercanía; no equivalen a una clasificación sismológica de premonitores y réplicas.</p>
    </div>
  )
}
