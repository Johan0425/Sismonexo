// Gráficos SVG propios (d3-scale + d3-shape). Cada gráfico incluye resumen textual, tabla alternativa y exportación.
import { scaleBand, scaleLinear, scaleLog } from 'd3-scale'
import { area, curveMonotoneX, curveStepAfter, line } from 'd3-shape'
import { Download, Table2 } from 'lucide-react'
import { createContext, useContext, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { IconButton, useWidth } from '@/components/ui'
import { downloadCsv, download, dataUrlToBlob, slug, svgToPng, type Cell, type Provenance } from '@/lib/export'
import { fmtNum } from '@/lib/format'
import { ramp, textOn, type RampName } from '@/lib/scales'
import { useApp } from '@/lib/store'

/** Procedencia que heredan las exportaciones de los gráficos de una vista. */
export const ProvenanceContext = createContext<((title: string) => Provenance) | null>(null)

export interface ChartTable {
  columns: string[]
  rows: Cell[][]
}
interface FrameProps {
  title: string
  /** Resumen textual: es la alternativa accesible al gráfico y debe decir lo que el gráfico muestra. */
  summary: string
  table: ChartTable
  children: (width: number) => ReactNode
  legend?: { label: string; color: string; shape?: 'line' | 'box' | 'dot'; dash?: boolean }[]
  heading?: 'h3' | 'h4'
  note?: ReactNode
}

export function ChartFrame({ title, summary, table, children, legend, heading: H = 'h4', note }: FrameProps) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [showTable, setShowTable] = useState(false)
  const prov = useContext(ProvenanceContext)
  const toast = useApp((s) => s.toast)
  const id = useId()
  const box = useRef<HTMLDivElement>(null)
  const exportPng = async () => {
    const svg = box.current?.querySelector('svg')
    if (!svg) return
    try {
      const p = prov?.(title)
      const { dataUrl } = await svgToPng(svg as SVGSVGElement, 2, p ? `${title} · Fuente: SGC–RSNC · datos ${p.version_datos} · SismoNexo Colombia (uso académico)` : title)
      download(`${slug(title)}.png`, dataUrlToBlob(dataUrl))
      toast('Imagen del gráfico descargada.')
    } catch (e) {
      toast((e as Error).message)
    }
  }
  const exportCsv = () => {
    downloadCsv(`${slug(title)}.csv`, table.columns, table.rows, prov?.(title))
    toast('Datos del gráfico descargados en CSV.')
  }
  return (
    <figure className="chart" aria-labelledby={`${id}-t`}>
      <div className="chart-head">
        <H id={`${id}-t`}>{title}</H>
        <div className="row no-print" style={{ gap: 2 }}>
          <IconButton label={showTable ? 'Ver gráfico' : 'Ver datos en tabla'} size="sm" aria-pressed={showTable} onClick={() => setShowTable((v) => !v)}>
            <Table2 size={16} aria-hidden />
          </IconButton>
          <IconButton label="Descargar imagen (PNG)" size="sm" onClick={exportPng} disabled={showTable}>
            <Download size={16} aria-hidden />
          </IconButton>
          <IconButton label="Descargar datos (CSV)" size="sm" onClick={exportCsv}>
            <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.02em' }} aria-hidden>
              CSV
            </span>
          </IconButton>
        </div>
      </div>
      <figcaption className="chart-summary" id={`${id}-s`}>
        {summary}
      </figcaption>
      <div ref={ref}>
        {showTable ? (
          <DataTable table={table} caption={`Datos de «${title}»`} />
        ) : (
          <div ref={box} role="img" aria-labelledby={`${id}-t`} aria-describedby={`${id}-s`}>
            {children(width)}
          </div>
        )}
      </div>
      {legend && !showTable && (
        <div className="legend" aria-hidden>
          {legend.map((l) => (
            <span key={l.label}>
              <i data-shape={l.shape ?? 'line'} style={l.dash ? { background: `repeating-linear-gradient(90deg, ${l.color} 0 4px, transparent 4px 7px)` } : { background: l.color }} />
              {l.label}
            </span>
          ))}
        </div>
      )}
      {note && <div className="caption" style={{ marginTop: 8 }}>{note}</div>}
    </figure>
  )
}

export function DataTable({ table, caption, maxRows = 400, maxHeight }: { table: ChartTable; caption: string; maxRows?: number; maxHeight?: number }) {
  const rows = table.rows.slice(0, maxRows)
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label={caption} style={maxHeight ? { maxHeight } : undefined}>
      <table className="table">
        <caption>
          {caption}
          {table.rows.length > maxRows ? ` (primeras ${maxRows} filas de ${table.rows.length}; la descarga CSV incluye todas)` : ''}
        </caption>
        <thead>
          <tr>
            {table.columns.map((c, i) => (
              <th key={c} scope="col" className={i ? 'r' : undefined}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {r.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c ?? '—'}
                  </th>
                ) : (
                  <td key={j} className="r">
                    {c == null || (typeof c === 'number' && !Number.isFinite(c)) ? '—' : typeof c === 'number' ? fmtNum(c, Number.isInteger(c) ? 0 : Math.abs(c) < 1 ? 3 : 2) : c}
                  </td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ------------------------------------------------------------------ gráfico XY

export interface Series {
  key: string
  label: string
  color: string
  type: 'line' | 'area' | 'bar' | 'points' | 'step'
  data: [number, number | null][]
  band?: [number, number, number][] // x, inferior, superior
  dash?: boolean
  r?: number
  width?: number
}
interface Axis {
  label?: string
  format?: (v: number) => string
  domain?: [number, number]
  ticks?: number[]
  log?: boolean
}
interface XYProps {
  series: Series[]
  x: Axis & { type?: 'linear' | 'time' | 'band'; categories?: string[] }
  y: Axis
  height?: number
  width: number
  diagonal?: boolean
  marks?: { x: number; label: string }[]
  hline?: { y: number; label: string }
  cursor?: number | null
  onPick?: (x: number) => void
  stacked?: boolean
}
const timeTick = (t: number, span: number) => {
  const d = new Date(t * 1000)
  if (span > 86400 * 365 * 3) return String(d.getUTCFullYear())
  if (span > 86400 * 90) return d.toLocaleDateString('es-CO', { month: 'short', year: '2-digit', timeZone: 'UTC' })
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', timeZone: 'UTC' })
}
function timeTicks(a: number, b: number, n: number): number[] {
  const span = b - a
  const Y = 86400 * 365.25
  const out: number[] = []
  if (span > Y * 2.5) {
    const stepY = [1, 2, 5, 10, 20, 50, 100].find((s) => span / Y / s <= n) ?? 100
    const y0 = Math.ceil(new Date(a * 1000).getUTCFullYear() / stepY) * stepY
    for (let y = y0; Date.UTC(y, 0, 1) / 1000 <= b; y += stepY) if (Date.UTC(y, 0, 1) / 1000 >= a) out.push(Date.UTC(y, 0, 1) / 1000)
    return out
  }
  const stepM = span > Y * 1.2 ? 6 : span > Y * 0.6 ? 3 : span > 86400 * 100 ? 1 : 0
  if (stepM) {
    const d = new Date(a * 1000)
    let y = d.getUTCFullYear()
    let m = Math.ceil(d.getUTCMonth() / stepM) * stepM
    for (;;) {
      const t = Date.UTC(y, m, 1) / 1000
      if (t > b) break
      if (t >= a) out.push(t)
      m += stepM
      if (m >= 12) (y++, (m -= 12))
    }
    return out
  }
  const stepD = Math.max(1, Math.ceil(span / 86400 / n))
  for (let t = Math.ceil(a / 86400) * 86400; t <= b; t += stepD * 86400) out.push(t)
  return out
}

export function XYChart({ series, x, y, height = 240, width, diagonal, marks, hline, cursor, onPick, stacked }: XYProps) {
  const [hover, setHover] = useState<number | null>(null)
  const m = { t: 12, r: 14, b: x.label ? 46 : 30, l: y.label ? 58 : 46 }
  const iw = Math.max(40, width - m.l - m.r)
  const ih = Math.max(40, height - m.t - m.b)
  const isBand = x.type === 'band'
  const cats = x.categories ?? []

  const { xs, ys, xDomain, stackBase } = useMemo(() => {
    let x0 = Infinity
    let x1 = -Infinity
    let y0 = Infinity
    let y1 = -Infinity
    const totals = new Map<number, number>()
    const base = new Map<string, number>()
    for (const s of series) {
      for (const [xv, yv] of s.data) {
        if (xv < x0) x0 = xv
        if (xv > x1) x1 = xv
        if (yv == null || !Number.isFinite(yv)) continue
        let top = yv
        if (stacked && s.type === 'bar') {
          const b = totals.get(xv) ?? 0
          base.set(`${s.key}|${xv}`, b)
          top = b + yv
          totals.set(xv, top)
        }
        if (yv < y0) y0 = yv
        if (top > y1) y1 = top
      }
      for (const [, lo, hi] of s.band ?? []) {
        if (lo < y0) y0 = lo
        if (hi > y1) y1 = hi
      }
    }
    if (hline) y1 = Math.max(y1, hline.y)
    if (!Number.isFinite(x0)) [x0, x1] = [0, 1]
    if (!Number.isFinite(y0)) [y0, y1] = [0, 1]
    const hasBars = series.some((s) => s.type === 'bar' || s.type === 'area')
    const yd: [number, number] = y.domain ?? (y.log ? [Math.max(y0, 1e-4), y1] : [hasBars || y0 >= 0 ? Math.min(0, y0) : y0, y1 === y0 ? y0 + 1 : y1])
    const xd: [number, number] = x.domain ?? [x0, x1 === x0 ? x0 + 1 : x1]
    const ysc = (y.log ? scaleLog() : scaleLinear()).domain(yd).range([ih, 0])
    if (!y.domain && !y.log) (ysc as ReturnType<typeof scaleLinear>).nice(5)
    const xsc = scaleLinear().domain(xd).range([0, iw])
    return { xs: xsc, ys: ysc, xDomain: xd, stackBase: base }
  }, [series, x.domain, y.domain, y.log, iw, ih, hline, stacked])

  const band = useMemo(() => scaleBand<number>().domain(cats.map((_, i) => i)).range([0, iw]).paddingInner(0.22).paddingOuter(0.1), [cats, iw])
  const px = (v: number) => (isBand ? (band(v) ?? 0) + band.bandwidth() / 2 : xs(v))
  const span = xDomain[1] - xDomain[0]
  const xTicks = isBand ? cats.map((_, i) => i) : (x.ticks ?? (x.type === 'time' ? timeTicks(xDomain[0], xDomain[1], Math.max(3, Math.floor(iw / 80))) : xs.ticks(Math.max(3, Math.floor(iw / 70)))))
  const yTicks = y.ticks ?? (y.log ? ys.ticks(4) : ys.ticks(5))
  const fx = (v: number) => (isBand ? cats[v] : x.type === 'time' ? timeTick(v, span) : (x.format ?? ((n: number) => fmtNum(n, 1)))(v))
  const fy = y.format ?? ((n: number) => fmtNum(n, Math.abs(n) < 10 && !Number.isInteger(n) ? 1 : 0))
  const everyTick = isBand ? Math.max(1, Math.ceil((cats.length * 46) / iw)) : 1

  const barSeries = series.filter((s) => s.type === 'bar')
  const nBarGroups = stacked ? 1 : Math.max(1, barSeries.length)
  const barStep = useMemo(() => {
    if (isBand) return band.bandwidth()
    const s = barSeries[0]
    if (!s || s.data.length < 2) return iw * 0.5
    let min = Infinity
    for (let i = 1; i < s.data.length; i++) min = Math.min(min, Math.abs(xs(s.data[i][0]) - xs(s.data[i - 1][0])))
    return Math.max(1, min * 0.86)
  }, [barSeries, isBand, band, xs, iw])

  const hoverX = hover ?? cursor ?? null
  const hoverRows = useMemo(() => {
    if (hoverX == null) return null
    const rows: { label: string; color: string; v: number }[] = []
    let at = hoverX
    let best = Infinity
    for (const s of series)
      for (const [xv] of s.data) {
        const d = Math.abs(xv - hoverX)
        if (d < best) (best = d), (at = xv)
      }
    for (const s of series) {
      const pt = s.data.find(([xv]) => xv === at)
      if (pt && pt[1] != null && Number.isFinite(pt[1])) rows.push({ label: s.label, color: s.color, v: pt[1] })
    }
    return { at, rows }
  }, [hoverX, series])

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const k = ((e.clientX - r.left) / r.width) * iw
    setHover(isBand ? Math.min(cats.length - 1, Math.max(0, Math.floor((k / iw) * cats.length))) : xs.invert(k))
  }

  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <g transform={`translate(${m.l},${m.t})`}>
          {yTicks.map((t) => (
            <g key={t} transform={`translate(0,${ys(t)})`}>
              <line className="gridline" x2={iw} />
              <text x={-8} dy="0.32em" textAnchor="end">
                {fy(t)}
              </text>
            </g>
          ))}
          {xTicks.map((t, i) =>
            i % everyTick ? null : (
              <text key={t} x={px(t)} y={ih + 18} textAnchor="middle">
                {fx(t)}
              </text>
            ),
          )}
          <line className="axis-line" y1={ih} y2={ih} x2={iw} />
          {x.label && (
            <text className="axis-title" x={iw / 2} y={ih + 38} textAnchor="middle">
              {x.label}
            </text>
          )}
          {y.label && (
            <text className="axis-title" transform={`translate(${-m.l + 14},${ih / 2}) rotate(-90)`} textAnchor="middle">
              {y.label}
            </text>
          )}
          {diagonal && <line x1={xs(xDomain[0])} y1={ys(xDomain[0])} x2={xs(xDomain[1])} y2={ys(xDomain[1])} stroke="var(--text-3)" strokeDasharray="4 4" />}
          {hline && (
            <g transform={`translate(0,${ys(hline.y)})`}>
              <line x2={iw} stroke="var(--text-3)" strokeDasharray="4 4" />
              <text x={iw} dy={-5} textAnchor="end">
                {hline.label}
              </text>
            </g>
          )}
          {marks?.map((mk) => (
            <g key={mk.label} transform={`translate(${px(mk.x)},0)`}>
              <line y2={ih} stroke="var(--text-3)" strokeDasharray="2 4" />
              <text y={10} x={5} style={{ fontSize: 12 }}>
                {mk.label}
              </text>
            </g>
          ))}
          {series.map((s, si) => {
            const pts = s.data.filter((d): d is [number, number] => d[1] != null && Number.isFinite(d[1]) && (!y.log || d[1] > 0))
            if (s.type === 'bar') {
              const gi = stacked ? 0 : barSeries.indexOf(s)
              const w = Math.max(1, barStep / nBarGroups)
              return (
                <g key={s.key} fill={s.color}>
                  {pts.map(([xv, yv]) => {
                    const b = stacked ? (stackBase.get(`${s.key}|${xv}`) ?? 0) : 0
                    const y1 = ys(b + yv)
                    const y0 = ys(Math.max(b, y.log ? ys.domain()[0] : b))
                    return <rect key={xv} x={px(xv) - barStep / 2 + gi * w} y={Math.min(y0, y1)} width={Math.max(0.6, w - (w > 4 ? 1 : 0))} height={Math.max(0, Math.abs(y0 - y1))} rx={w > 6 ? 2 : 0} style={{ transition: 'y 300ms var(--ease), height 300ms var(--ease)' }} />
                  })}
                </g>
              )
            }
            if (s.type === 'points')
              return (
                <g key={s.key} fill={s.color} stroke="var(--surface)" strokeWidth={1}>
                  {pts.map(([xv, yv], i) => (
                    <circle key={i} cx={px(xv)} cy={ys(yv)} r={s.r ?? 3.5} />
                  ))}
                </g>
              )
            const curve = s.type === 'step' ? curveStepAfter : curveMonotoneX
            const ln = line<[number, number]>().x((d) => px(d[0])).y((d) => ys(d[1])).curve(pts.length > 400 ? curveStepAfter : curve)
            return (
              <g key={s.key}>
                {s.band && (
                  <path
                    d={area<[number, number, number]>().x((d) => px(d[0])).y0((d) => ys(d[1])).y1((d) => ys(d[2])).curve(curveMonotoneX)(s.band) ?? ''}
                    fill={s.color}
                    opacity={0.16}
                  />
                )}
                {s.type === 'area' && <path d={area<[number, number]>().x((d) => px(d[0])).y0(ih).y1((d) => ys(d[1])).curve(curve)(pts) ?? ''} fill={s.color} opacity={0.14} />}
                <path d={ln(pts) ?? ''} fill="none" stroke={s.color} strokeWidth={s.width ?? 2} strokeDasharray={s.dash ? '5 4' : undefined} strokeLinejoin="round" strokeLinecap="round" style={{ transition: 'd 320ms var(--ease)' }} />
                {pts.length <= 24 && s.type !== 'step' && (
                  <g fill={s.color} stroke="var(--surface)" strokeWidth={1.5}>
                    {pts.map(([xv, yv], i) => (
                      <circle key={i} cx={px(xv)} cy={ys(yv)} r={si === 0 ? 3.5 : 3} />
                    ))}
                  </g>
                )}
              </g>
            )
          })}
          {hoverRows && hoverRows.rows.length > 0 && <line x1={px(hoverRows.at)} x2={px(hoverRows.at)} y2={ih} stroke="var(--text-2)" strokeWidth={1} />}
          <rect width={iw} height={ih} fill="transparent" onPointerMove={onMove} onPointerLeave={() => setHover(null)} onClick={() => hoverRows && onPick?.(hoverRows.at)} style={{ cursor: onPick ? 'pointer' : 'crosshair' }} />
        </g>
      </svg>
      {hover != null && hoverRows && hoverRows.rows.length > 0 && (
        <div className="tooltip" style={{ position: 'absolute', left: Math.min(width - 150, Math.max(4, m.l + px(hoverRows.at) + 10)), top: m.t + 4, maxWidth: 220 }} aria-hidden>
          <div style={{ fontWeight: 700 }}>{fx(hoverRows.at)}</div>
          {hoverRows.rows.map((r) => (
            <div key={r.label} className="num">
              {hoverRows.rows.length > 1 ? `${r.label}: ` : ''}
              {fy(r.v)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ matriz de calor

interface HeatProps {
  rows: string[]
  cols: string[]
  values: (number | null)[][]
  width: number
  ramp?: RampName
  domain?: [number, number]
  format?: (v: number) => string
  showValues?: boolean
  cellH?: number
  rowLabelW?: number
  colEvery?: number
  onCell?: (r: number, c: number) => void
}
export function HeatGrid({ rows, cols, values, width, ramp: rampName = 'viridis', domain, format = (v) => fmtNum(v, 0), showValues, cellH = 22, rowLabelW = 96, colEvery, onCell }: HeatProps) {
  const [tip, setTip] = useState<{ r: number; c: number } | null>(null)
  const top = 22
  const iw = Math.max(60, width - rowLabelW - 4)
  const cw = iw / cols.length
  const [lo, hi] = useMemo(() => {
    if (domain) return domain
    let a = Infinity
    let b = -Infinity
    for (const r of values) for (const v of r) if (v != null && Number.isFinite(v)) (a = Math.min(a, v)), (b = Math.max(b, v))
    return [Number.isFinite(a) ? a : 0, Number.isFinite(b) && b > a ? b : a + 1]
  }, [values, domain])
  const every = colEvery ?? Math.max(1, Math.ceil(34 / cw))
  const h = top + rows.length * cellH + 4
  return (
    <div style={{ position: 'relative' }}>
      <svg width={width} height={h} viewBox={`0 0 ${width} ${h}`}>
        {cols.map((c, j) =>
          j % every ? null : (
            <text key={j} x={rowLabelW + j * cw + cw / 2} y={14} textAnchor="middle">
              {c}
            </text>
          ),
        )}
        {rows.map((r, i) => (
          <g key={i} transform={`translate(0,${top + i * cellH})`}>
            <text x={rowLabelW - 8} y={cellH / 2} dy="0.32em" textAnchor="end">
              {r.length > 16 ? r.slice(0, 15) + '…' : r}
            </text>
            {cols.map((_, j) => {
              const v = values[i]?.[j]
              const ok = v != null && Number.isFinite(v)
              const color = ok ? ramp(rampName, (v - lo) / (hi - lo || 1)) : 'var(--surface-2)'
              return (
                <g key={j}>
                  <rect x={rowLabelW + j * cw + 0.5} y={0.5} width={Math.max(1, cw - 1)} height={cellH - 1} rx={cw > 8 ? 2 : 0} fill={color} onPointerEnter={() => setTip({ r: i, c: j })} onPointerLeave={() => setTip(null)} onClick={() => onCell?.(i, j)} style={onCell ? { cursor: 'pointer' } : undefined} />
                  {showValues && ok && cw > 30 && (
                    <text x={rowLabelW + j * cw + cw / 2} y={cellH / 2} dy="0.32em" textAnchor="middle" style={{ fill: textOn(color), pointerEvents: 'none', fontWeight: 600 }}>
                      {format(v)}
                    </text>
                  )}
                </g>
              )
            })}
          </g>
        ))}
      </svg>
      {tip && (
        <div className="tooltip" style={{ position: 'absolute', left: Math.min(width - 170, rowLabelW + tip.c * cw + cw), top: top + tip.r * cellH - 30 }} aria-hidden>
          {rows[tip.r]} · {cols[tip.c]}: <b className="num">{values[tip.r]?.[tip.c] == null ? 'sin dato' : format(values[tip.r][tip.c] as number)}</b>
        </div>
      )}
      <div className="row caption num" style={{ marginTop: 6, gap: 8 }} aria-hidden>
        <span>{format(lo)}</span>
        <span style={{ flex: '0 0 140px', height: 8, borderRadius: 3, background: `linear-gradient(90deg, ${[0, 0.25, 0.5, 0.75, 1].map((t) => ramp(rampName, t)).join(',')})` }} />
        <span>{format(hi)}</span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ barras horizontales y minigráfico

export function BarList({ items, format = (v) => fmtNum(v, 0), max, signed }: { items: { label: string; value: number; color?: string; note?: string; onClick?: () => void }[]; format?: (v: number) => string; max?: number; signed?: boolean }) {
  const top = max ?? Math.max(...items.map((i) => Math.abs(i.value)), 1e-12)
  return (
    <ul className="stack tight" style={{ gap: 6 }}>
      {items.map((it) => {
        const frac = Math.min(1, Math.abs(it.value) / top)
        const label = it.onClick ? (
          <button type="button" className="rowlink" style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent-text)', textAlign: 'left', cursor: 'pointer', font: 'inherit', textDecoration: 'underline', textUnderlineOffset: 3 }} onClick={it.onClick}>
            {it.label}
          </button>
        ) : (
          it.label
        )
        return (
          <li key={it.label} className="small" style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(60px,1fr) auto', gap: 10, alignItems: 'center' }}>
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.label}>
              {label}
            </span>
            {signed ? (
              <span style={{ position: 'relative', height: 10 }} aria-hidden>
                <span style={{ position: 'absolute', left: '50%', top: -2, bottom: -2, width: 1, background: 'var(--border-strong)' }} />
                <span style={{ position: 'absolute', top: 0, height: 10, borderRadius: 2, background: it.color ?? 'var(--accent)', left: it.value >= 0 ? '50%' : `${50 - frac * 50}%`, width: `${frac * 50}%` }} />
              </span>
            ) : (
              <span className="bar-inline" aria-hidden>
                <span className="trk">
                  <i style={{ width: `${frac * 100}%`, background: it.color }} />
                </span>
              </span>
            )}
            <span className="num" style={{ fontWeight: 600, textAlign: 'right' }}>
              {format(it.value)}
              {it.note && <span className="muted" style={{ fontWeight: 400 }}> {it.note}</span>}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

export function Sparkline({ values, width = 120, height = 32, color = 'var(--accent)', label }: { values: number[]; width?: number; height?: number; color?: string; label: string }) {
  if (!values.length) return null
  const max = Math.max(...values, 1e-9)
  const step = width / values.length
  return (
    <svg width={width} height={height} role="img" aria-label={label}>
      {values.map((v, i) => {
        const h = Math.max(v > 0 ? 1.5 : 0, (v / max) * (height - 2))
        return <rect key={i} x={i * step + 0.5} y={height - h} width={Math.max(1, step - 1)} height={h} fill={color} rx={step > 5 ? 1 : 0} />
      })}
    </svg>
  )
}
