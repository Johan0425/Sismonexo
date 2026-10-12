// Laboratorio de escenarios: modificar variables de una zona y observar cómo responde el modelo.
import { Camera, RotateCcw, Save } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { BarList, ChartFrame, ProvenanceContext, XYChart } from '@/charts/Chart'
import { Page } from '@/components/Shell'
import { Button, Card, Field, Gate, Note, Pill, ProbabilityValue, Select, Slider } from '@/components/ui'
import { forecastId, HORIZONS, loadForecast, loadIndex, loadZones, MODEL_ORDER, THRESHOLDS, UNITS, useAsync, type ForecastFile, type IndexData, type ModelKey, type ZoneTable } from '@/lib/data'
import { dataUrlToBlob, download, provenance, shortCaption, svgToPng } from '@/lib/export'
import { fmtDate, fmtInt, fmtNum, fmtPct, fmtSigned, fold, inPhrase } from '@/lib/format'
import { intervalFor, originDays, predictAll, sensitivity, zoneVector } from '@/lib/models'
import { useApp } from '@/lib/store'

export const HYPOTHETICAL = 'Escenario hipotético. No representa un pronóstico oficial ni modifica los datos reales.'
const MONTHS = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre']
const MID_DOY = [15, 46, 75, 106, 136, 167, 197, 228, 259, 289, 320, 350]

interface Control {
  key: string
  label: string
  primary: string
  linked: string[] // variables que se desplazan con la principal para mantener un escenario coherente
  step: number
  digits: number
  unit: string
  hint: string
}
const CONTROLS: Control[] = [
  { key: 'freq', label: 'Frecuencia reciente', primary: 'n_30', linked: ['n_90', 'n_365'], step: 1, digits: 0, unit: 'eventos en 30 días', hint: 'Todos los eventos registrados (M ≥ 2,5). Ajusta también los conteos de 90 días y 1 año.' },
  { key: 'freqT', label: 'Eventos recientes sobre el umbral', primary: 'nt_30', linked: ['nt_90', 'nt_365', 'nt_1825'], step: 1, digits: 0, unit: 'eventos en 30 días', hint: 'Ajusta también los conteos de 90 días, 1 año y 5 años.' },
  { key: 'acc', label: 'Magnitud acumulada', primary: 'acc_mag_365', linked: [], step: 0.1, digits: 1, unit: 'magnitud equivalente (1 año)', hint: 'Magnitud de un único evento con la misma energía total.' },
  { key: 'depth', label: 'Profundidad media', primary: 'mean_depth_365', linked: ['median_depth_365'], step: 5, digits: 0, unit: 'km', hint: 'Ajusta también la profundidad mediana.' },
  { key: 'since', label: 'Tiempo desde el último evento', primary: 'days_since_last', linked: [], step: 5, digits: 0, unit: 'días', hint: 'Cualquier magnitud registrada en la zona.' },
  { key: 'dist', label: 'Distancia al evento anterior', primary: 'dist_prev_km', linked: [], step: 10, digits: 0, unit: 'km', hint: 'Desde el centro de la zona al evento M ≥ 4,5 más reciente del catálogo.' },
]

export default function Lab() {
  const index = useAsync(loadIndex, [])
  const fcp = useApp((s) => s.fc)
  const h = (HORIZONS as readonly number[]).includes(fcp.h) ? fcp.h : 30
  const thr = (THRESHOLDS as readonly number[]).includes(fcp.thr) ? fcp.thr : 4
  const file = useAsync(() => loadForecast(forecastId(fcp.unit, h, thr)), [fcp.unit, h, thr])
  const zones = useAsync(() => loadZones(fcp.unit), [fcp.unit])
  return (
    <Page title="Laboratorio de escenarios" lead="Parta de los valores reales de una zona, modifique algunas variables y observe cómo cambia la estimación. Sirve para entender el modelo, no para pronosticar.">
      <Note tone="caution" role="note">
        <b>{HYPOTHETICAL}</b>
      </Note>
      <div style={{ height: 16 }} />
      <Gate of={[index, file, zones] as const}>{(idx, f, zt) => <Workbench key={f.id} index={idx} fc={f} zt={zt} />}</Gate>
    </Page>
  )
}

function Workbench({ index, fc, zt }: { index: IndexData; fc: ForecastFile; zt: ZoneTable }) {
  const selection = useApp((s) => s.selection)
  const scenarios = useApp((s) => s.scenarios)
  const { setFc, saveScenario, toast } = useApp.getState()
  const od = originDays(fc)
  const h = fc.config.horizon_days
  const F = fc.features
  const j = (name: string) => F.indexOf(name)
  const order = useMemo(() => {
    const p = fc.forecast.p[fc.selected_model] ?? []
    return p.map((_, i) => i).sort((a, b) => p[b] - p[a])
  }, [fc])
  const initial = selection?.kind === 'zona' && selection.unit === zt.unit ? (zt.index.get(selection.id) ?? order[0]) : order[0]
  const [zi, setZi] = useState(initial)
  const [search, setSearch] = useState('')
  const [model, setModel] = useState<ModelKey>(fc.selected_model === 'rf' ? 'hgb' : fc.selected_model)
  const real = useMemo(() => zoneVector(fc, zi), [fc, zi])
  const [x, setX] = useState<number[]>(real)
  const [month, setMonth] = useState<number | null>(null)
  const [window, setWindow] = useState<'todo' | '5a' | '1a'>('todo')
  const [name, setName] = useState('')
  const chartBox = useRef<HTMLDivElement>(null)
  const reset = () => (setX(real), setMonth(null), setWindow('todo'))
  useEffect(reset, [real]) // eslint-disable-line react-hooks/exhaustive-deps

  const models = MODEL_ORDER.filter((k) => k !== 'rf' && fc.forecast.p[k])
  const pReal = useMemo(() => predictAll(fc.lab.models, F, real, h, od), [fc, F, real, h, od])
  const pHyp = useMemo(() => predictAll(fc.lab.models, F, x, h, od), [fc, F, x, h, od])
  const a = pReal.p[model] as number
  const b = pHyp.p[model] as number
  const [aLo, aHi] = intervalFor(fc, model, a)
  const [bLo, bHi] = intervalFor(fc, model, b)
  const changed = x.some((v, i) => !(v === real[i] || (Number.isNaN(v) && Number.isNaN(real[i]))))
  const R = fc.lab.ranges
  const info = (k: string) => index.features.find((f) => f.key === k)

  const setControl = (c: Control, v: number) => {
    const cur = x[j(c.primary)]
    const delta = v - (Number.isFinite(cur) ? cur : R[c.primary].q005)
    setX((prev) => {
      const y = [...prev]
      y[j(c.primary)] = v
      for (const l of c.linked) {
        const base = Number.isFinite(y[j(l)]) ? y[j(l)] : R[l].q005
        y[j(l)] = Math.max(l.startsWith('n') ? Math.max(0, y[j(c.primary)]) : R[l].min, base + delta)
      }
      if (c.primary === 'days_since_last') y[j('days_since_last_t')] = Math.max(y[j('days_since_last_t')], v)
      return y
    })
  }
  const applyMonth = (m: number | null) => {
    setMonth(m)
    setX((prev) => {
      const y = [...prev]
      const doy = m == null ? null : MID_DOY[m]
      y[j('doy_sin')] = doy == null ? real[j('doy_sin')] : Math.sin((2 * Math.PI * doy) / 365.25)
      y[j('doy_cos')] = doy == null ? real[j('doy_cos')] : Math.cos((2 * Math.PI * doy) / 365.25)
      return y
    })
  }
  const applyWindow = (w: 'todo' | '5a' | '1a') => {
    setWindow(w)
    setX((prev) => {
      const y = [...prev]
      y[j('rate_hist')] = w === 'todo' ? real[j('rate_hist')] : w === '5a' ? prev[j('nt_1825')] / (1825 / 30) : prev[j('nt_365')] / (365 / 30)
      return y
    })
  }

  const out = CONTROLS.map((c) => ({ c, v: x[j(c.primary)], r: R[c.primary] })).filter(({ c, v, r }) => Number.isFinite(v) && v !== real[j(c.primary)] && (v < r.q005 || v > r.q995))
  const sens = useMemo(() => sensitivity(fc, x, model, Object.fromEntries(CONTROLS.map((c) => [c.primary, (R[c.primary].q995 - R[c.primary].q005) * 0.1]))), [fc, x, model, R])
  const sweep = useMemo(() => {
    const c = CONTROLS[0]
    const r = R[c.primary]
    const pts: [number, number][] = []
    for (let k = 0; k <= 24; k++) {
      const v = r.q005 + ((r.q995 - r.q005) * k) / 24
      const y = [...x]
      const delta = v - (Number.isFinite(x[j(c.primary)]) ? x[j(c.primary)] : 0)
      y[j(c.primary)] = v
      for (const l of c.linked) y[j(l)] = Math.max(v, (Number.isFinite(y[j(l)]) ? y[j(l)] : 0) + delta)
      pts.push([v, predictAll(fc.lab.models, F, y, h, od).p[model] as number])
    }
    return pts
  }, [fc, x, model, R, F, h, od]) // eslint-disable-line react-hooks/exhaustive-deps

  const explanation = useMemo(() => {
    if (!changed) return ['El escenario es idéntico a los valores reales de la zona. Mueva algún control para ver cómo responde el modelo.']
    const diffs = F.map((k, i) => ({ k, a: real[i], b: x[i] })).filter((d) => !(d.a === d.b || (Number.isNaN(d.a) && Number.isNaN(d.b))))
    const t = [
      `Con ${inPhrase(fc.models[model]?.name)}, la estimación pasa de ${fmtPct(a)} a ${fmtPct(b)} (${fmtSigned((b - a) * 100, 1, ' puntos')}).`,
      `Variables modificadas: ${diffs.slice(0, 8).map((d) => `${(info(d.k)?.label ?? d.k).toLowerCase()} (${Number.isFinite(d.a) ? fmtNum(d.a, 2) : 'sin dato'} → ${fmtNum(d.b, 2)})`).join('; ')}.`,
      Math.abs(b - a) < 0.005 ? 'El modelo apenas reacciona a estos cambios: con las demás variables fijas, pesan poco en esta zona.' : b > a ? 'En el histórico analizado, valores como los del escenario se relacionaron con más zonas-periodo con evento.' : 'En el histórico analizado, valores como los del escenario se relacionaron con menos zonas-periodo con evento.',
      'Es una respuesta del modelo a una combinación supuesta de variables. Esto no demuestra causalidad ni describe lo que ocurrirá.',
    ]
    if (out.length) t.push(`Atención: ${out.map((o) => o.c.label.toLowerCase()).join(', ')} está fuera del rango histórico habitual; el modelo extrapola y su respuesta es poco fiable.`)
    return t
  }, [changed, F, real, x, a, b, model, fc, out]) // eslint-disable-line react-hooks/exhaustive-deps

  const prov = (title: string) => provenance(index, title, { version_modelo: fc.config.model_version, pronostico_generado: fc.forecast.generated_at, filtros: [`ESCENARIO HIPOTÉTICO`, `Zona: ${zt.name[zi]}`, `Horizonte: ${h} días`, `Umbral: M ≥ ${fc.config.threshold}`] })
  const matches = search.trim().length >= 2 ? zt.name.map((n, i) => ({ n, i })).filter(({ n }) => fold(n).includes(fold(search.trim()))).slice(0, 8) : []
  const capture = async () => {
    const svg = chartBox.current?.querySelector('svg')
    if (!svg) return
    const { dataUrl } = await svgToPng(svg as SVGSVGElement, 2, `ESCENARIO HIPOTÉTICO · ${zt.name[zi].slice(0, 60)} · ${shortCaption(index, fc.config.model_version)}`)
    download('sismonexo-escenario-hipotetico.png', dataUrlToBlob(dataUrl))
    toast('Captura descargada con el rótulo de escenario hipotético.')
  }

  return (
    <ProvenanceContext.Provider value={prov}>
      <div className="grid main-aside" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(320px, 420px)' }}>
        <div className="stack">
          <Card title="Zona y modelo">
            <div className="grid c2">
              <div className="stack tight">
                <Select label="Zona geográfica" value={zi} onChange={setZi} options={[...new Set([zi, ...order.slice(0, 60)])].map((i) => ({ value: i, label: `${zt.name[i].replace(/^(Celda|Hexágono)[^·]*· /, '').slice(0, 54)} · ${fmtPct(fc.forecast.p[fc.selected_model]?.[i])}` }))} hint="Las 60 zonas con mayor probabilidad. Para otra, búsquela por nombre." />
                <Field label="Buscar zona por nombre">{(p) => <input {...p} className="input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Por ejemplo: Los Santos" autoComplete="off" />}</Field>
                {matches.length > 0 && (
                  <div className="chips">
                    {matches.map((m) => (
                      <button key={m.i} type="button" className="chip" onClick={() => (setZi(m.i), setSearch(''))}>
                        {m.n.replace(/^(Celda|Hexágono)[^·]*· /, '').slice(0, 44)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="stack tight">
                <Select label="Modelo" value={model} onChange={setModel} options={models.map((k) => ({ value: k, label: fc.models[k]?.name ?? k }))} hint="Random Forest no se evalúa en el navegador por su tamaño." />
                <div className="range-pair">
                  <Select label="Unidad" value={fc.config.unit} onChange={(v) => setFc({ unit: v }, `Unidad: ${index.units[v].label}`)} options={UNITS.map((u) => ({ value: u, label: index.units[u].label }))} />
                  <Select label="Umbral de magnitud" value={fc.config.threshold} onChange={(v) => setFc({ thr: v }, `Umbral M ≥ ${v}`)} options={THRESHOLDS.map((v) => ({ value: v as number, label: `M ≥ ${fmtNum(v, 1)}` }))} />
                </div>
              </div>
            </div>
          </Card>
          <Card title="Variables del escenario" subtitle="Los valores iniciales son los reales de la zona en la fecha del pronóstico vigente." actions={<Button size="sm" icon={<RotateCcw size={16} aria-hidden />} onClick={reset} disabled={!changed}>Restablecer valores</Button>}>
            <div className="grid c2" style={{ gap: 20 }}>
              {CONTROLS.map((c) => {
                const r = R[c.primary]
                const v = x[j(c.primary)]
                const rv = real[j(c.primary)]
                const shown = Number.isFinite(v) ? v : r.min
                const outside = Number.isFinite(v) && (v < r.q005 || v > r.q995)
                const realOutside = Number.isFinite(rv) && (rv < r.q005 || rv > r.q995)
                const moved = Number.isFinite(v) && v !== rv
                const top = Math.ceil(Math.max(Math.min(r.max, r.q995 * 1.6 + c.step * 4), Number.isFinite(rv) ? rv : 0, Number.isFinite(v) ? v : 0))
                return (
                  <Slider
                    key={c.key}
                    label={c.label}
                    value={shown}
                    min={Math.floor(r.min)}
                    max={top}
                    step={c.step}
                    onChange={(nv) => setControl(c, nv)}
                    format={(n) => `${Number.isFinite(v) ? fmtNum(n, c.digits) : 'sin dato'} ${Number.isFinite(v) ? c.unit : ''}`}
                    hint={`${c.hint} Valor real: ${Number.isFinite(rv) ? fmtNum(rv, c.digits) : 'sin dato'}${realOutside ? ' (inusualmente alto o bajo frente a las demás zonas)' : ''}. Rango habitual: ${fmtNum(r.q005, c.digits)}–${fmtNum(r.q995, c.digits)}.`}
                    warn={outside && moved ? `Fuera del rango histórico habitual (${fmtNum(r.q005, c.digits)}–${fmtNum(r.q995, c.digits)}): el modelo extrapola.` : undefined}
                  />
                )
              })}
              <Select label="Estacionalidad (mes del pronóstico)" value={month ?? -1} onChange={(v) => applyMonth(v === -1 ? null : v)} options={[{ value: -1, label: `Real (${fmtDate(fc.forecast.forecast_start)})` }, ...MONTHS.map((m, i) => ({ value: i, label: m }))]} hint="No hay evidencia física de estacionalidad sísmica; la variable existe para que el modelo pueda descartarla." />
              <Select label="Ventana histórica de la tasa" value={window} onChange={applyWindow} options={[{ value: 'todo', label: 'Todo el catálogo (real)' }, { value: '5a', label: 'Solo los últimos 5 años' }, { value: '1a', label: 'Solo el último año' }]} hint={`Tasa usada: ${fmtNum(x[j('rate_hist')], 3)} eventos por 30 días.`} />
            </div>
          </Card>
          <Card>
            <ChartFrame heading="h3" title="Sensibilidad del modelo" summary="Cambio de la probabilidad, en puntos porcentuales, al subir o bajar cada variable un 10 % de su rango habitual, con las demás fijas en el escenario actual." table={{ columns: ['Variable', 'Al bajar (puntos)', 'Al subir (puntos)'], rows: sens.map((s) => [info(s.feature)?.label ?? s.feature, +(s.down * 100).toFixed(2), +(s.up * 100).toFixed(2)]) }}>
              {() => <BarList signed items={sens.flatMap((s) => [{ label: `${info(s.feature)?.label ?? s.feature} ↑`, value: s.up * 100, color: s.up >= 0 ? 'var(--s2)' : 'var(--s7)' }, { label: `${info(s.feature)?.label ?? s.feature} ↓`, value: s.down * 100, color: s.down >= 0 ? 'var(--s2)' : 'var(--s7)' }])} format={(v) => fmtSigned(v, 2, ' pts')} />}
            </ChartFrame>
          </Card>
          <Card>
            <ChartFrame heading="h3" title="Respuesta a la frecuencia reciente" summary={`Probabilidad que asigna el modelo al variar solo la frecuencia reciente dentro de su rango habitual, con el resto del escenario fijo. Va de ${fmtPct(sweep[0][1])} a ${fmtPct(sweep[sweep.length - 1][1])}.`} table={{ columns: ['Eventos en 30 días', 'Probabilidad'], rows: sweep.map(([a2, b2]) => [+a2.toFixed(1), +b2.toFixed(4)]) }}>
              {(w) => <XYChart width={w} height={220} x={{ label: 'Eventos en 30 días' }} y={{ label: 'Probabilidad', format: (v) => fmtPct(v) }} marks={Number.isFinite(x[j('n_30')]) ? [{ x: x[j('n_30')], label: 'escenario' }] : undefined} series={[{ key: 's', label: 'Probabilidad', color: 'var(--s1)', type: 'line', data: sweep }]} />}
            </ChartFrame>
          </Card>
        </div>
        <div className="stack" style={{ position: 'sticky', top: 16 }}>
          <Card>
            <div className="row between" style={{ marginBottom: 8 }}>
              <h3>Real frente a hipotético</h3>
              <span className="demo-tag">Hipotético</span>
            </div>
            <p className="caption" style={{ marginBottom: 12 }}>{zt.name[zi]} · {h} días · M ≥ {fmtNum(fc.config.threshold, 1)}</p>
            <div className="stack">
              <div>
                <div className="eyebrow" style={{ marginBottom: 4 }}>Valores reales</div>
                <ProbabilityValue p={a} lo={aLo} hi={aHi} />
              </div>
              <div style={{ borderTop: '1px dashed var(--border-strong)', paddingTop: 12 }}>
                <div className="row between">
                  <div className="eyebrow" style={{ marginBottom: 4 }}>Escenario hipotético</div>
                  <Pill tone={Math.abs(b - a) < 0.0005 ? undefined : 'accent'}>{fmtSigned((b - a) * 100, 1, ' puntos')}</Pill>
                </div>
                <ProbabilityValue p={b} lo={bLo} hi={bHi} />
              </div>
            </div>
            <div ref={chartBox} style={{ marginTop: 16 }}>
              <ChartFrame title="Todos los modelos" summary={`Probabilidad con valores reales y con el escenario para cada modelo evaluable en el navegador.`} table={{ columns: ['Modelo', 'Real', 'Hipotético'], rows: models.map((k) => [fc.models[k]?.name ?? k, +(pReal.p[k] as number).toFixed(4), +(pHyp.p[k] as number).toFixed(4)]) }} legend={[{ label: 'Real', color: 'var(--s6)', shape: 'box' }, { label: 'Hipotético', color: 'var(--s1)', shape: 'box' }]}>
                {(w) => <XYChart width={w} height={200} x={{ type: 'band', categories: models.map((k) => ({ base: 'Base', logit: 'Logíst.', pois: 'Poisson', hgb: 'Boosting', etas: 'ETAS', hyb: 'Híbrido', rf: 'RF' })[k]) }} y={{ format: (v) => fmtPct(v) }} series={[{ key: 'r', label: 'Real', color: 'var(--s6)', type: 'bar', data: models.map((k, i) => [i, pReal.p[k] as number]) }, { key: 'h', label: 'Hipotético', color: 'var(--s1)', type: 'bar', data: models.map((k, i) => [i, pHyp.p[k] as number]) }]} />}
              </ChartFrame>
            </div>
            {out.length > 0 && <Note tone="caution" role="status">Hay {out.length === 1 ? 'una variable' : `${out.length} variables`} fuera del rango histórico habitual. El resultado es una extrapolación.</Note>}
          </Card>
          <Card title="Explicación del escenario">
            <div className="prose small" aria-live="polite">
              {explanation.map((t) => (
                <p key={t}>{t}</p>
              ))}
            </div>
          </Card>
          <Card title="Guardar y exportar">
            <form
              className="row"
              onSubmit={(e) => {
                e.preventDefault()
                const n = name.trim().slice(0, 40) || `Escenario ${scenarios.length + 1}`
                saveScenario(n, { fc: fc.id, zi, model, x, month, window, a, b })
                setName('')
                toast(`«${n}» guardado en memoria durante esta sesión.`)
              }}
            >
              <input className="input" aria-label="Nombre del escenario" placeholder="Nombre del escenario" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
              <Button type="submit" icon={<Save size={16} aria-hidden />}>Guardar</Button>
            </form>
            {scenarios.length > 0 && (
              <ul className="stack tight small" style={{ marginTop: 12 }}>
                {scenarios.map((s) => {
                  const d = s.data as { fc: string; zi: number; model: ModelKey; x: number[]; month: number | null; window: 'todo' | '5a' | '1a'; a: number; b: number }
                  const same = d.fc === fc.id
                  return (
                    <li key={s.at} className="row between">
                      <button type="button" className="rowlink" style={{ border: 0, background: 'none', padding: 0, color: same ? 'var(--accent-text)' : 'var(--text-3)', textDecoration: same ? 'underline' : 'none', cursor: same ? 'pointer' : 'default', minHeight: 28 }} disabled={!same} onClick={() => (setZi(d.zi), setModel(d.model), setTimeout(() => (setX(d.x), setMonth(d.month), setWindow(d.window)), 0))}>
                        {s.name}
                      </button>
                      <span className="muted num">{fmtPct(d.a)} → {fmtPct(d.b)}{same ? '' : ' · otra configuración'}</span>
                    </li>
                  )
                })}
              </ul>
            )}
            <div className="row wrap" style={{ marginTop: 12 }}>
              <Button variant="outline" icon={<Camera size={16} aria-hidden />} onClick={() => void capture()}>Exportar captura</Button>
            </div>
            <p className="caption" style={{ marginTop: 8 }}>Los escenarios viven solo en la memoria de esta pestaña ({fmtInt(scenarios.length)} guardados). La captura incluye el rótulo «Escenario hipotético», la fuente y la versión del modelo.</p>
          </Card>
        </div>
      </div>
    </ProvenanceContext.Provider>
  )
}
