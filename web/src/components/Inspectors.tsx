// Inspectores contextuales: evento, zona y explicación de la estimación («¿Por qué el modelo muestra este valor?»).
import { ExternalLink, FileText, GitCompareArrows, HelpCircle, LocateFixed } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarList, ChartFrame, Sparkline, XYChart } from '@/charts/Chart'
import { mapBus } from '@/lib/bus'
import { eventId, eventSource, eventUrl, loadZones, useAsync, type Events, type FeatureInfo, type IndexData } from '@/lib/data'
import { fmtCoord, fmtDate, fmtDateTime, fmtDuration, fmtInt, fmtKm, fmtMag, fmtNum, fmtPct, fmtShare, fmtSigned, inPhrase } from '@/lib/format'
import { haversineKm, placeName } from '@/lib/geo'
import { sigmoid } from '@/lib/models'
import { depthClass } from '@/lib/scales'
import { DAY, histogram, median, nearby, trend } from '@/lib/stats'
import { useApp } from '@/lib/store'
import type { ZoneData } from '@/lib/zonedata'
import { Button, Modal, Note, Pill, ProbabilityValue } from './ui'

const QUALITY_TEXT: Record<string, string> = { A: 'A · muy buena', B: 'B · buena', C: 'C · aceptable', D: 'D · baja', N: 'Sin métricas reportadas' }

/** Nombres de municipios y departamentos por código, para rotular eventos. */
export function useNames() {
  const dep = useAsync(() => loadZones('dep'), [])
  const mun = useAsync(() => loadZones('mun'), [])
  return useMemo(
    () => ({
      dep: dep.data ? new Map(dep.data.id.map((id, i) => [id, dep.data.name[i]])) : null,
      mun: mun.data ? new Map(mun.data.id.map((id, i) => [id, mun.data.municipality[i]])) : null,
    }),
    [dep.data, mun.data],
  )
}

export function EventInspector({ ev, i, onSelect }: { ev: Events; i: number; onSelect: (i: number) => void }) {
  const tz = useApp((s) => s.prefs.tz)
  const names = useNames()
  const near = useMemo(() => nearby(ev, i, 50, 7, haversineKm).sort((a, b) => ev.mag[b] - ev.mag[a]), [ev, i])
  const url = eventUrl(ev, i)
  const src = eventSource(ev, i)
  const d = ev.depth[i]
  const dc = depthClass(d)
  return (
    <div className="inspector-body">
      <section aria-label="Datos del evento">
        <div className="pvalue" style={{ marginBottom: 12 }}>
          <span className="big">M {fmtMag(ev.mag[i])}</span>
          <Pill>{ev.mtNames[ev.mt[i]]}</Pill>
        </div>
        <dl className="deflist">
          <dt>Fecha y hora</dt>
          <dd>{fmtDateTime(ev.t[i], tz)}</dd>
          <dt>{tz === 'utc' ? 'Hora de Colombia' : 'Hora UTC'}</dt>
          <dd>{fmtDateTime(ev.t[i], tz === 'utc' ? 'colombia' : 'utc')}</dd>
          <dt>Ubicación</dt>
          <dd>{placeName(ev, i, names.mun, names.dep)}</dd>
          <dt>Profundidad</dt>
          <dd>
            {Number.isFinite(d) ? `${fmtNum(d, 1)} km` : 'Sin dato'}
            {dc && <span className="muted"> · {dc.name.toLowerCase()}</span>}
          </dd>
          <dt>Latitud, longitud</dt>
          <dd>{fmtCoord(ev.lat[i], ev.lon[i])}</dd>
          <dt>Calidad de la localización</dt>
          <dd>{QUALITY_TEXT[ev.qNames[ev.q[i]]] ?? ev.qNames[ev.q[i]]}</dd>
          <dt>Error de localización</dt>
          <dd>{Number.isFinite(ev.err[i]) ? `± ${fmtNum(ev.err[i], 1)} km` : 'No reportado'}</dd>
          <dt>Estado</dt>
          <dd>{ev.imported ? 'No informado (archivo importado)' : ev.status[i] ? 'Revisado por analista' : 'Automático (sin revisar)'}</dd>
          <dt>Fuente</dt>
          <dd>{src?.name ?? 'Archivo importado'}</dd>
          <dt>Identificador</dt>
          <dd style={{ fontSize: 12 }}>{eventId(ev, i)}</dd>
        </dl>
        {ev.dflag[i] === 1 && (
          <p className="caption" style={{ marginTop: 8 }}>
            La fuente fijó la profundidad en 0 km: es un valor convencional, no una medición.
          </p>
        )}
        <p className="caption" style={{ marginTop: 8 }}>
          La calidad A–D es un código derivado en este proyecto (gap, error horizontal y RMS); no es un código oficial del SGC.
        </p>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <Button size="sm" icon={<LocateFixed size={16} aria-hidden />} onClick={() => mapBus.send({ type: 'fly', center: [ev.lon[i], ev.lat[i]], zoom: 8.5 })}>
            Centrar
          </Button>
          {url && (
            <a className="btn" data-size="sm" data-variant="outline" href={url.url} target="_blank" rel="noreferrer noopener">
              <ExternalLink size={16} aria-hidden />
              {url.direct ? 'Registro original (SGC)' : 'Consulta oficial (SGC)'}
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </a>
          )}
        </div>
        {url && !url.direct && <p className="caption" style={{ marginTop: 6 }}>El catálogo 1993–2018 no publica una página por evento; el enlace abre el formulario oficial de consulta.</p>}
      </section>
      <section aria-label="Eventos cercanos">
        <h4>Eventos cercanos</h4>
        <p className="caption" style={{ marginBottom: 8 }}>
          A menos de 50 km y dentro de los 7 días anteriores o posteriores. La cercanía no implica relación física entre los eventos.
        </p>
        {near.length === 0 ? (
          <p className="small muted">No hay otros eventos registrados en ese entorno.</p>
        ) : (
          <ul className="stack tight small">
            {near.slice(0, 8).map((j) => (
              <li key={j} className="row between">
                <button type="button" className="rowlink" style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent-text)', cursor: 'pointer', textDecoration: 'underline', textUnderlineOffset: 3, minHeight: 28, textAlign: 'left' }} onClick={() => onSelect(j)}>
                  M {fmtMag(ev.mag[j])} · {fmtDate(ev.t[j])}
                </button>
                <span className="muted num">
                  {fmtKm(haversineKm(ev.lon[i], ev.lat[i], ev.lon[j], ev.lat[j]))} · {ev.t[j] < ev.t[i] ? 'antes' : 'después'}
                </span>
              </li>
            ))}
            {near.length > 8 && <li className="caption">y {fmtInt(near.length - 8)} más.</li>}
          </ul>
        )}
      </section>
    </div>
  )
}

// ------------------------------------------------------------------ zona

export interface ZoneStats {
  idx: number[]
  n: number
  nThr: number
  maxMag: number
  maxMagT: number
  medianDepth: number
  perMonth: number
  recent: number
  recentPrev: number
  good: number
  years: number[]
  byYear: number[]
  byYearThr: number[]
  magHist: number[]
  depthHist: number[]
  trendLabel: string
  lastT: number
}
/** Estadísticas observadas de una zona dentro del periodo y la profundidad consultados. */
export function zoneStats(zd: ZoneData, zi: number, from: number, to: number, thr: number, h: number, depthMin: number, depthMax: number): ZoneStats {
  const { ev, zoneOf } = zd
  const idx: number[] = []
  const allDepth = depthMin <= 0 && depthMax >= 700
  for (let i = 0; i < ev.n; i++) {
    if (zoneOf[i] !== zi || ev.t[i] < from || ev.t[i] > to) continue
    if (!allDepth && !(ev.depth[i] >= depthMin && ev.depth[i] <= depthMax)) continue
    idx.push(i)
  }
  const y0 = new Date(from * 1000).getUTCFullYear()
  const y1 = new Date(to * 1000).getUTCFullYear()
  const years = Array.from({ length: y1 - y0 + 1 }, (_, k) => y0 + k)
  const byYear = years.map(() => 0)
  const byYearThr = years.map(() => 0)
  let maxMag = NaN
  let maxMagT = NaN
  let nThr = 0
  let recent = 0
  let recentPrev = 0
  let good = 0
  const depths: number[] = []
  const qGood = ev.qNames.map((q) => q === 'A' || q === 'B')
  const end = (Math.floor(ev.t[ev.n - 1] / DAY) + 1) * DAY
  for (const i of idx) {
    const y = new Date(ev.t[i] * 1000).getUTCFullYear() - y0
    byYear[y]++
    if (ev.mag[i] >= thr) (byYearThr[y]++, nThr++)
    if (!(maxMag >= ev.mag[i])) (maxMag = ev.mag[i]), (maxMagT = ev.t[i])
    if (Number.isFinite(ev.depth[i])) depths.push(ev.depth[i])
    if (qGood[ev.q[i]]) good++
    if (ev.t[i] >= end - h * DAY) recent++
    else if (ev.t[i] >= end - 2 * h * DAY) recentPrev++
  }
  const months = Math.max((to - from) / DAY / 30.44, 1)
  return {
    idx, n: idx.length, nThr, maxMag, maxMagT, medianDepth: median(depths), perMonth: idx.length / months, recent, recentPrev, good, years, byYear, byYearThr,
    magHist: histogram(idx.map((i) => ev.mag[i]), 2.5, 0.5, 9),
    depthHist: [0, 0, 0, 0, 0].map((_, c) => depths.filter((d) => depthClass(d)?.i === c).length),
    trendLabel: trend(byYear.slice(-10)).label,
    lastT: idx.length ? ev.t[idx[idx.length - 1]] : NaN,
  }
}
export function confidenceLevel(n: number, goodShare: number): { label: 'Alta' | 'Media' | 'Baja'; why: string } {
  if (n >= 200 && goodShare >= 0.5) return { label: 'Alta', why: 'más de 200 registros históricos y al menos la mitad con localización de calidad A o B' }
  if (n >= 30) return { label: 'Media', why: 'entre 30 y 200 registros históricos, o localizaciones de calidad limitada' }
  return { label: 'Baja', why: 'menos de 30 registros históricos: la estimación descansa casi por completo en el promedio de todas las zonas' }
}

interface ZoneProps {
  zd: ZoneData
  zi: number
  index: IndexData
  thr: number
  h: number
  from: number
  to: number
  depthMin: number
  depthMax: number
  compare: number | null
  onCompare: (zi: number | null) => void
}

export function ZoneInspector({ zd, zi, index, thr, h, from, to, depthMin, depthMax, compare, onCompare }: ZoneProps) {
  const navigate = useNavigate()
  const [explain, setExplain] = useState(false)
  const st = useMemo(() => zoneStats(zd, zi, from, to, thr, h, depthMin, depthMax), [zd, zi, from, to, thr, h, depthMin, depthMax])
  const cmp = useMemo(() => (compare != null && compare !== zi ? zoneStats(zd, compare, from, to, thr, h, depthMin, depthMax) : null), [zd, compare, zi, from, to, thr, h, depthMin, depthMax])
  const p = zd.p[zi]
  const national = useMemo(() => zd.p.reduce((a, b) => a + b, 0) / zd.p.length, [zd])
  const baseP = zd.file?.forecast.p.base?.[zi]
  const conf = confidenceLevel(st.n, st.n ? st.good / st.n : 0)
  const change = p - zd.pPrev[zi]
  const top = useMemo(() => topContributions(zd, zi, index.features, 5), [zd, zi, index.features])
  const row = (label: string, a: string, b: string) => (
    <tr key={label}>
      <th scope="row">{label}</th>
      <td className="r">{a}</td>
      <td className="r">{b}</td>
    </tr>
  )
  return (
    <div className="inspector-body">
      <section aria-label="Estimación">
        <div className="caption" style={{ marginBottom: 6 }}>
          Probabilidad de al menos un evento M ≥ {fmtNum(thr, 1)} entre el {fmtDate(zd.start)} y el {fmtDate(zd.end)}
        </div>
        <ProbabilityValue p={p} lo={zd.lo[zi]} hi={zd.hi[zi]} />
        <dl className="deflist" style={{ marginTop: 12 }}>
          {zd.expected && (
            <>
              <dt>Tasa esperada</dt>
              <dd>
                {fmtNum(zd.expected[zi], zd.expected[zi] < 1 ? 2 : 1)} eventos en {h} días
              </dd>
            </>
          )}
          <dt>Variación frente al periodo anterior</dt>
          <dd>{fmtSigned(change * 100, 1, ' puntos')}</dd>
          <dt>Media de todas las zonas</dt>
          <dd>{fmtPct(national)}</dd>
          {baseP != null && zd.model !== 'base' && (
            <>
              <dt>Línea base de esta zona</dt>
              <dd>{fmtPct(baseP)}</dd>
            </>
          )}
          <dt>Nivel de confianza del dato</dt>
          <dd>{conf.label}</dd>
          <dt>Modelo</dt>
          <dd>{zd.modelName}</dd>
          <dt>Estado de calibración</dt>
          <dd>{zd.calibration}</dd>
          <dt>Versión del modelo</dt>
          <dd style={{ fontSize: 12 }}>{zd.modelVersion}</dd>
          <dt>Generado</dt>
          <dd>{fmtDate(zd.generatedAt)}</dd>
        </dl>
        <p className="caption" style={{ marginTop: 8 }}>
          Confianza {conf.label.toLowerCase()}: {conf.why}.
        </p>
        <div className="row wrap" style={{ marginTop: 12 }}>
          <Button size="sm" variant="primary" icon={<HelpCircle size={16} aria-hidden />} onClick={() => setExplain(true)}>
            Explicar esta estimación
          </Button>
          <Button size="sm" icon={<FileText size={16} aria-hidden />} onClick={() => navigate('/informes', { state: { tipo: 'zona', zona: zd.zt.id[zi], unidad: zd.zt.unit } })}>
            Crear informe
          </Button>
          <Button size="sm" icon={<GitCompareArrows size={16} aria-hidden />} aria-pressed={compare === zi} onClick={() => onCompare(compare === zi ? null : zi)}>
            {compare === zi ? 'Zona fijada para comparar' : 'Comparar zona'}
          </Button>
        </div>
        {compare === zi && <p className="caption" style={{ marginTop: 6 }}>Seleccione otra zona en el mapa para verlas lado a lado.</p>}
      </section>

      {cmp && compare != null && (
        <section aria-label="Comparación de zonas">
          <h4>Comparación lado a lado</h4>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ marginTop: 8 }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Indicador</th>
                  <th scope="col" className="r" style={{ whiteSpace: 'normal' }}>Esta zona</th>
                  <th scope="col" className="r" style={{ whiteSpace: 'normal' }}>{zd.zt.name[compare].split(' (')[0].replace(/^.*· /, '')}</th>
                </tr>
              </thead>
              <tbody>
                {row('Probabilidad', fmtPct(p), fmtPct(zd.p[compare]))}
                {row('Intervalo (90 %)', `${fmtPct(zd.lo[zi])}–${fmtPct(zd.hi[zi])}`, `${fmtPct(zd.lo[compare])}–${fmtPct(zd.hi[compare])}`)}
                {row('Eventos registrados', fmtInt(st.n), fmtInt(cmp.n))}
                {row(`Eventos M ≥ ${fmtNum(thr, 1)}`, fmtInt(st.nThr), fmtInt(cmp.nThr))}
                {row('Magnitud máxima', fmtMag(st.maxMag), fmtMag(cmp.maxMag))}
                {row('Profundidad mediana', fmtKm(st.medianDepth), fmtKm(cmp.medianDepth))}
                {row('Eventos por mes', fmtNum(st.perMonth, 2), fmtNum(cmp.perMonth, 2))}
              </tbody>
            </table>
          </div>
          <Button size="sm" variant="ghost" onClick={() => onCompare(null)}>
            Quitar comparación
          </Button>
        </section>
      )}

      <section aria-label="Actividad observada">
        <h4>Actividad observada</h4>
        <p className="caption">
          Periodo consultado: {fmtDate(from)} a {fmtDate(to)}
          {depthMin > 0 || depthMax < 700 ? ` · profundidad ${depthMin}–${depthMax} km` : ''}
        </p>
        <dl className="deflist" style={{ marginTop: 8 }}>
          <dt>Registros históricos</dt>
          <dd>{fmtInt(st.n)}</dd>
          <dt>Eventos M ≥ {fmtNum(thr, 1)}</dt>
          <dd>{fmtInt(st.nThr)}</dd>
          <dt>Frecuencia reciente ({h} días)</dt>
          <dd>
            {fmtInt(st.recent)} <span className="muted">(antes: {fmtInt(st.recentPrev)})</span>
          </dd>
          <dt>Frecuencia mensual media</dt>
          <dd>{fmtNum(st.perMonth, 2)} eventos</dd>
          <dt>Magnitud máxima</dt>
          <dd>{Number.isFinite(st.maxMag) ? `${fmtMag(st.maxMag)} (${fmtDate(st.maxMagT)})` : '—'}</dd>
          <dt>Profundidad mediana</dt>
          <dd>{fmtKm(st.medianDepth)}</dd>
          <dt>Tendencia (10 años)</dt>
          <dd>{st.trendLabel}</dd>
          <dt>Calidad de datos (A o B)</dt>
          <dd>{st.n ? fmtShare(st.good / st.n, 0) : '—'}</dd>
          <dt>Último evento</dt>
          <dd>{Number.isFinite(st.lastT) ? fmtDate(st.lastT) : '—'}</dd>
        </dl>
        {st.n > 0 && (
          <div className="stack" style={{ marginTop: 16 }}>
            <div>
              <div className="caption" style={{ marginBottom: 4 }}>
                Eventos por año ({st.years[0]}–{st.years[st.years.length - 1]})
              </div>
              <Sparkline values={st.byYear} width={320} height={44} label={`Eventos por año en la zona, de ${st.years[0]} a ${st.years[st.years.length - 1]}. Máximo anual: ${fmtInt(Math.max(...st.byYear))}.`} />
            </div>
            <div>
              <div className="caption" style={{ marginBottom: 6 }}>Distribución de magnitudes</div>
              <BarList items={st.magHist.map((v, k) => ({ label: k === 8 ? 'M ≥ 6,5' : `M ${fmtNum(2.5 + k * 0.5, 1)}–${fmtNum(3 + k * 0.5, 1)}`, value: v })).filter((x, k) => x.value > 0 || k < 4)} />
            </div>
            <div>
              <div className="caption" style={{ marginBottom: 6 }}>Distribución de profundidades</div>
              <BarList items={index.depth_classes.map((c, k) => ({ label: c[2], value: st.depthHist[k] }))} />
            </div>
          </div>
        )}
      </section>

      {top.length > 0 && (
        <section aria-label="Variables más influyentes">
          <h4>Variables más influyentes</h4>
          <p className="caption" style={{ marginBottom: 8 }}>
            Contribución SHAP en el modelo de gradient boosting. A la derecha, la variable elevó la estimación; a la izquierda, la redujo. Esto no demuestra causalidad.
          </p>
          <BarList signed items={top.map((t) => ({ label: t.label, value: t.shap, color: t.shap >= 0 ? 'var(--s2)' : 'var(--s7)', note: '' }))} format={(v) => fmtSigned(v, 2)} />
        </section>
      )}

      <section aria-label="Fuente">
        <p className="caption">
          Datos: catálogo de la Red Sismológica Nacional de Colombia, versión {index.dataset_version}.{' '}
          <a href={index.sources[1]?.landing} target="_blank" rel="noreferrer noopener">
            Fuente oficial (SGC)<span className="sr-only"> (se abre en una pestaña nueva)</span>
          </a>
        </p>
      </section>
      <ExplainDialog open={explain} onClose={() => setExplain(false)} zd={zd} zi={zi} index={index} st={st} thr={thr} h={h} />
    </div>
  )
}

function topContributions(zd: ZoneData, zi: number, features: FeatureInfo[], n: number) {
  const f = zd.file
  if (!f) return []
  return f.forecast.shap[zi]
    .map((shap, j) => ({ key: f.features[j], label: features.find((x) => x.key === f.features[j])?.label ?? f.features[j], shap, value: f.forecast.features[zi][j] }))
    .sort((a, b) => Math.abs(b.shap) - Math.abs(a.shap))
    .slice(0, n)
}

// ------------------------------------------------------------------ explicación

interface ExplainProps {
  open: boolean
  onClose: () => void
  zd: ZoneData
  zi: number
  index: IndexData
  st: ZoneStats
  thr: number
  h: number
}
export function ExplainDialog({ open, onClose, zd, zi, index, st, thr, h }: ExplainProps) {
  const f = zd.file
  const info = (k: string) => index.features.find((x) => x.key === k)
  const p = zd.p[zi]
  const width = zd.hi[zi] - zd.lo[zi]
  const content = useMemo(() => {
    if (!open) return null
    const monthlyAvg = st.n ? st.perMonth * (h / 30.44) : 0
    const recentTxt =
      st.recent > monthlyAvg * 1.5 && st.recent >= 3
        ? `La actividad reciente aumentó: ${fmtInt(st.recent)} eventos en los últimos ${h} días, frente a un promedio histórico de ${fmtNum(monthlyAvg, 1)} para un periodo igual.`
        : st.recent < monthlyAvg * 0.5 && monthlyAvg >= 2
          ? `La actividad reciente disminuyó: ${fmtInt(st.recent)} eventos en los últimos ${h} días, frente a un promedio histórico de ${fmtNum(monthlyAvg, 1)}.`
          : `La actividad reciente es similar a la habitual: ${fmtInt(st.recent)} eventos en los últimos ${h} días (promedio histórico: ${fmtNum(monthlyAvg, 1)}).`
    const uncTxt = width > 0.3 ? 'alta' : width > 0.1 ? 'moderada' : 'baja'
    if (!f) return { recentTxt, uncTxt, top: [], missing: [], sim: null, base: null, stab: null, pdp: [], perm: [] }
    const top = topContributions(zd, zi, index.features, 6)
    const missing = f.features.filter((_, j) => f.forecast.features[zi][j] == null).map((k) => info(k)?.label ?? k)
    const sim = { list: f.forecast.similar[zi], k: f.forecast.similar_k, pos: f.forecast.similar_positive[zi] }
    const base = f.forecast.p.base?.[zi] ?? null
    const m = f.models[zd.model]
    const stab = m ? { std: m.stability.pr_auc_std, min: m.stability.pr_auc_min, max: m.stability.pr_auc_max, pr: m.walk_forward.pr_auc, prev: f.config.prevalence } : null
    return { recentTxt, uncTxt, top, missing, sim, base, stab, pdp: f.explain.pdp.slice(0, 2), perm: f.explain.permutation.slice(0, 8) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, zd, zi, st, h])
  if (!content) return <Modal open={false} onClose={onClose} title="">{null}</Modal>
  const { top, sim, base, stab } = content
  const up = top.filter((t) => t.shap > 0).slice(0, 3)
  const down = top.filter((t) => t.shap < 0).slice(0, 2)
  const val = (t: (typeof top)[number]) => (t.value == null ? 'sin dato' : `${fmtNum(t.value, Math.abs(t.value) < 10 ? 2 : 0)} ${info(t.key)?.unit ?? ''}`.trim())
  return (
    <Modal open={open} onClose={onClose} wide title="¿Por qué el modelo muestra este valor?" footer={<Button variant="primary" onClick={onClose}>Entendido</Button>}>
      <div className="stack">
        <p>
          <b>{zd.zt.name[zi]}</b>: probabilidad estimada de <b className="num">{fmtPct(p)}</b> de registrar al menos un evento de magnitud {fmtNum(thr, 1)} o superior en {h} días, con un intervalo de incertidumbre del 90 % entre {fmtPct(zd.lo[zi])} y {fmtPct(zd.hi[zi])}.
        </p>
        <div className="grid c2">
          <div className="stack tight">
            <h4>Qué influyó</h4>
            {f ? (
              <div className="prose small">
                {up.length > 0 && (
                  <p>
                    El modelo dio mayor peso a: {up.map((t) => `${t.label.toLowerCase()} (${val(t)})`).join('; ')}. En el histórico analizado, valores así se relacionaron con más zonas-periodo con evento.
                  </p>
                )}
                {down.length > 0 && (
                  <p>
                    Redujeron la estimación: {down.map((t) => `${t.label.toLowerCase()} (${val(t)})`).join('; ')}.
                  </p>
                )}
                <p>Estas contribuciones describen cómo responde el modelo de gradient boosting; son asociaciones estadísticas. Esto no demuestra causalidad ni indica que una variable provoque sismos.</p>
              </div>
            ) : (
              <p className="small">
                Se usa la línea base recalculada porque se eligió: {zd.why}. Su única información es la frecuencia histórica de la zona ({fmtInt(st.nThr)} eventos sobre el umbral en el periodo) combinada con el promedio de todas las zonas. No hay variables adicionales que explicar.
              </p>
            )}
            <h4 style={{ marginTop: 8 }}>Actividad reciente</h4>
            <p className="small">{content.recentTxt}</p>
            <h4 style={{ marginTop: 8 }}>Línea base</h4>
            <p className="small">
              {base == null || zd.model === 'base'
                ? 'El valor mostrado es la propia línea base de frecuencia histórica.'
                : `La línea base de frecuencia histórica da ${fmtPct(base)} para esta zona. El modelo elegido la ${p > base * 1.15 ? 'eleva' : p < base * 0.85 ? 'reduce' : 'deja casi igual'} (${fmtSigned((p - base) * 100, 1, ' puntos')}).`}
            </p>
          </div>
          <div className="stack tight">
            <h4>Periodos históricos parecidos</h4>
            {sim ? (
              <div className="small">
                <p>
                  De los {sim.k} periodos pasados de esta misma zona más parecidos al actual, en {sim.pos} se registró al menos un evento sobre el umbral ({fmtShare(sim.pos / sim.k, 0)}).
                </p>
                <ul className="stack tight" style={{ marginTop: 6 }}>
                  {sim.list.map(([date, count, dist]) => (
                    <li key={date} className="row between">
                      <span>Periodo iniciado el {fmtDate(date)}</span>
                      <span className="muted num">
                        {count} {count === 1 ? 'evento' : 'eventos'} · distancia {fmtNum(dist, 2)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="small muted">La búsqueda de periodos parecidos solo está disponible en las configuraciones entrenadas.</p>
            )}
            <h4 style={{ marginTop: 8 }}>Incertidumbre</h4>
            <p className="small">
              Incertidumbre {content.uncTxt}: el intervalo abarca {fmtNum(width * 100, 1)} puntos porcentuales. {zd.trained ? 'Proviene de la frecuencia observada en la validación para zonas-periodo con probabilidades parecidas.' : 'Es un intervalo creíble aproximado de la tasa histórica.'}
            </p>
            <h4 style={{ marginTop: 8 }}>Datos que faltan</h4>
            <p className="small">{content.missing.length ? `Sin dato en esta zona: ${content.missing.join('; ').toLowerCase()}. Suele deberse a que no hubo eventos en la ventana correspondiente.` : 'Todas las variables de entrada tienen dato para esta zona.'}</p>
            {stab && (
              <>
                <h4 style={{ marginTop: 8 }}>Estabilidad del modelo</h4>
                <p className="small">
                  En la validación walk-forward, el PR-AUC de {inPhrase(zd.modelName)} fue {fmtNum(stab.pr ?? NaN, 3)} (referencia sin información: {fmtNum(stab.prev, 3)}), con variación entre bloques de {fmtNum(stab.min ?? NaN, 3)} a {fmtNum(stab.max ?? NaN, 3)}. Estado de calibración: {zd.calibration}.
                </p>
              </>
            )}
          </div>
        </div>
        {f && (
          <div className="grid c2">
            <ChartFrame
              title="Importancia por permutación"
              summary={`Caída del PR-AUC del gradient boosting al desordenar cada variable en el último bloque de prueba. La mayor caída corresponde a ${info(content.perm[0]?.feature)?.label.toLowerCase() ?? '—'}.`}
              table={{ columns: ['Variable', 'Caída de PR-AUC', 'Desviación'], rows: content.perm.map((r) => [info(r.feature)?.label ?? r.feature, r.drop_pr_auc, r.std]) }}
            >
              {() => <BarList items={content.perm.map((r) => ({ label: info(r.feature)?.label ?? r.feature, value: Math.max(0, r.drop_pr_auc) }))} format={(v) => fmtNum(v, 3)} />}
            </ChartFrame>
            {content.pdp.map((d) => (
              <ChartFrame
                key={d.feature}
                title={`Dependencia parcial: ${info(d.feature)?.label ?? d.feature}`}
                summary={`Probabilidad media que asigna el modelo al variar solo esta variable, de ${fmtPct(d.curve[0][1])} a ${fmtPct(d.curve[d.curve.length - 1][1])}. Es una relación promedio en el modelo, no una ley física.`}
                table={{ columns: [info(d.feature)?.label ?? d.feature, 'Probabilidad media'], rows: d.curve.map(([x, y]) => [x, y]) }}
              >
                {(w) => <XYChart width={w} height={190} x={{ label: info(d.feature)?.unit }} y={{ format: (v) => fmtPct(v), label: 'Probabilidad media' }} series={[{ key: 'pdp', label: 'Probabilidad media', color: 'var(--s1)', type: 'line', data: d.curve }]} />}
              </ChartFrame>
            ))}
          </div>
        )}
        {f && (
          <p className="caption">
            {f.explain.note} Valor base del modelo en log-odds: {fmtNum(f.forecast.shap_base, 2)} (equivale a {fmtPct(sigmoid(f.forecast.shap_base))} antes de calibrar). Periodo de validación: {f.folds[0].test[0]} a {f.folds[f.folds.length - 1].test[1]}. Duración del catálogo usado: {fmtDuration((Date.parse(f.config.last_labelled_origin) - Date.parse(f.config.first_origin)) / 86400000)}.
          </p>
        )}
        <Note tone="caution">Una probabilidad alta no significa que un terremoto ocurrirá con certeza. Una probabilidad baja tampoco significa ausencia total de actividad.</Note>
      </div>
    </Modal>
  )
}
