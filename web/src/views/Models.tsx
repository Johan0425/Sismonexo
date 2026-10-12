// Comparador de modelos: métricas, curvas, calibración, validación walk-forward y detector de fugas.
import { CircleAlert, CircleCheck, HelpCircle, Pause, Play, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { BarList, ChartFrame, HeatGrid, ProvenanceContext, XYChart } from '@/charts/Chart'
import { Page } from '@/components/Shell'
import { Button, Card, Gate, Kpis, Modal, Note, Pill, Segmented, Select, useWidth } from '@/components/ui'
import { forecastId, HORIZONS, loadForecast, loadIndex, MODEL_ORDER, THRESHOLDS, UNITS, useAsync, type ForecastFile, type IndexData, type Metrics, type ModelKey, type ModelResult } from '@/lib/data'
import { provenance } from '@/lib/export'
import { fmtDate, fmtInt, fmtNum, fmtPct, fmtShare, fmtSigned, inPhrase } from '@/lib/format'
import { useApp } from '@/lib/store'

const COLORS: Record<ModelKey, string> = { base: 'var(--s6)', logit: 'var(--s3)', pois: 'var(--s1)', rf: 'var(--s4)', hgb: 'var(--s2)', etas: 'var(--s7)', hyb: 'var(--s5)' }
const SHORT: Record<ModelKey, string> = { base: 'Línea base', logit: 'Logística', pois: 'Poisson / BN', rf: 'Random Forest', hgb: 'Gradient boosting', etas: 'Tipo ETAS', hyb: 'Híbrido' }
const day = (iso: string) => Date.parse(`${iso}T00:00:00Z`) / 1000

export interface Recommendation {
  key: ModelKey
  scores: { key: ModelKey; total: number; parts: Record<string, number> }[]
  text: string[]
}
/** Recomendación que pondera discriminación, calibración, interpretabilidad, costo y estabilidad. */
export function recommend(fc: ForecastFile): Recommendation {
  const keys = MODEL_ORDER.filter((k) => fc.models[k])
  const m = (k: ModelKey) => fc.models[k] as ModelResult
  const norm = (vals: number[], higherBetter: boolean) => {
    const lo = Math.min(...vals)
    const hi = Math.max(...vals)
    return vals.map((v) => (hi === lo ? 1 : higherBetter ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)))
  }
  const pr = norm(keys.map((k) => m(k).walk_forward.pr_auc ?? 0), true)
  const ll = norm(keys.map((k) => m(k).walk_forward.log_loss), false)
  const ece = norm(keys.map((k) => m(k).walk_forward.ece), false)
  const interp = keys.map((k) => m(k).interpretability / 5)
  const cost = norm(keys.map((k) => Math.log10((m(k).fit_seconds ?? 0.5) + 0.01)), false)
  const stab = norm(keys.map((k) => m(k).stability.pr_auc_std ?? 0), false)
  const scores = keys.map((key, i) => {
    const parts = { 'Capacidad de ordenar (PR-AUC)': pr[i], 'Probabilidades fiables (log-loss)': ll[i], 'Calibración (ECE)': ece[i], Interpretabilidad: interp[i], 'Costo de cómputo': cost[i], 'Estabilidad entre bloques': stab[i] }
    return { key, parts, total: 0.25 * pr[i] + 0.2 * ll[i] + 0.2 * ece[i] + 0.15 * interp[i] + 0.05 * cost[i] + 0.15 * stab[i] }
  })
  scores.sort((a, b) => b.total - a.total)
  const best = scores[0].key
  const b = m(best)
  const base = m('base')
  const gain = (b.walk_forward.pr_auc ?? 0) - (base.walk_forward.pr_auc ?? 0)
  const text = [
    `Para ${fc.config.unit_label.toLowerCase()}, ${fc.config.horizon_days} días y M ≥ ${fmtNum(fc.config.threshold, 1)}, el mejor equilibrio lo ofrece ${inPhrase(b.name)}.`,
    best === 'base'
      ? 'Ningún modelo más complejo supera con claridad a la frecuencia histórica en esta configuración. Usar la línea base es la decisión más honesta: es transparente, estable y no añade complejidad sin beneficio demostrado.'
      : `Frente a la línea base, su PR-AUC es ${fmtNum(b.walk_forward.pr_auc ?? NaN, 3)} (${fmtSigned(gain, 3)}) y su Brier mejora ${fmtSigned((b.walk_forward.brier_skill ?? 0) * 100, 1, ' %')}. Estado de calibración: ${b.calibration_status}.`,
    `Interpretabilidad ${b.interpretability} de 5; entrenamiento de ${fmtNum(b.fit_seconds ?? 0, 2)} s por bloque; PR-AUC entre ${fmtNum(b.stability.pr_auc_min ?? NaN, 3)} y ${fmtNum(b.stability.pr_auc_max ?? NaN, 3)} según el bloque temporal.`,
    fc.selected_model !== best ? `El criterio automático del pipeline (menor log-loss antes de la prueba final) elige ${inPhrase(m(fc.selected_model).name)}; la diferencia se debe a que aquí también pesan interpretabilidad, costo y estabilidad.` : 'Coincide con el criterio automático del pipeline (menor log-loss antes de la prueba final).',
    fc.config.positives < 300 ? `Atención: solo hay ${fmtInt(fc.config.positives)} zonas-periodo con evento en toda la historia. Con tan pocos casos, las diferencias entre modelos son poco fiables.` : '',
  ].filter(Boolean)
  return { key: best, scores, text }
}

export default function Models() {
  const index = useAsync(loadIndex, [])
  const fcp = useApp((s) => s.fc)
  const { setFc } = useApp.getState()
  const h = (HORIZONS as readonly number[]).includes(fcp.h) ? fcp.h : 30
  const thr = (THRESHOLDS as readonly number[]).includes(fcp.thr) ? fcp.thr : 4
  const file = useAsync(() => loadForecast(forecastId(fcp.unit, h, thr)), [fcp.unit, h, thr])
  return (
    <Page
      title="Comparador de modelos"
      lead="Siete familias de modelos evaluadas con la misma validación cronológica. Ningún modelo se elige por exactitud (accuracy): con eventos raros, acertar «no pasa nada» casi siempre no demuestra utilidad."
    >
      <Gate of={[index] as const}>
        {(idx) => (
          <div className="stack loose">
            <Card>
              <div className="filterbar">
                <Select label="Unidad de análisis" value={fcp.unit} onChange={(v) => setFc({ unit: v }, `Unidad: ${idx.units[v].label}`)} options={UNITS.map((u) => ({ value: u, label: idx.units[u].label }))} />
                <Select label="Horizonte" value={h} onChange={(v) => setFc({ h: v }, `Horizonte de ${v} días`)} options={HORIZONS.map((v) => ({ value: v as number, label: `${v} días${v === 30 ? ' (principal)' : ''}` }))} />
                <Select label="Umbral de magnitud" value={thr} onChange={(v) => setFc({ thr: v }, `Umbral M ≥ ${v}`)} options={THRESHOLDS.map((v) => ({ value: v as number, label: `M ≥ ${fmtNum(v, 1)}` }))} />
              </div>
              {(h !== fcp.h || thr !== fcp.thr) && <p className="caption" style={{ marginTop: 8 }}>El pronóstico activo usa parámetros sin modelo entrenado; aquí se muestra la configuración entrenada más cercana.</p>}
            </Card>
            <Gate of={[file] as const}>{(f) => <Comparison fc={f} index={idx} />}</Gate>
          </div>
        )}
      </Gate>
    </Page>
  )
}

function Comparison({ fc, index }: { fc: ForecastFile; index: IndexData }) {
  const keys = MODEL_ORDER.filter((k) => fc.models[k])
  const [scope, setScope] = useState<'walk_forward' | 'final_test'>('walk_forward')
  const [focus, setFocus] = useState<ModelKey>(fc.selected_model)
  const [advice, setAdvice] = useState(false)
  useEffect(() => setFocus(fc.selected_model), [fc])
  const M = (k: ModelKey) => fc.models[k] as ModelResult
  const met = (k: ModelKey): Metrics => M(k)[scope]
  const rec = useMemo(() => recommend(fc), [fc])
  const prov = (title: string) => provenance(index, title, { version_modelo: fc.config.model_version, pronostico_generado: fc.forecast.generated_at, filtros: [`Unidad: ${fc.config.unit_label}`, `Horizonte: ${fc.config.horizon_days} días`, `Umbral: M ≥ ${fc.config.threshold}`] })
  const legend = keys.map((k) => ({ label: SHORT[k], color: COLORS[k] }))
  const f = met(focus)
  const prevalence = met('base').prevalence
  const cols: { label: string; get: (k: ModelKey) => number | null | undefined; d: number; best?: 'max' | 'min'; pct?: boolean }[] = [
    { label: 'PR-AUC', get: (k) => met(k).pr_auc, d: 3, best: 'max' },
    { label: 'ROC-AUC', get: (k) => met(k).roc_auc, d: 3, best: 'max' },
    { label: 'Brier', get: (k) => met(k).brier, d: 4, best: 'min' },
    { label: 'Mejora Brier', get: (k) => met(k).brier_skill, d: 1, best: 'max', pct: true },
    { label: 'Log-loss', get: (k) => met(k).log_loss, d: 4, best: 'min' },
    { label: 'ECE', get: (k) => met(k).ece, d: 4, best: 'min' },
    { label: 'Precisión', get: (k) => met(k).precision, d: 2, best: 'max' },
    { label: 'Recall', get: (k) => met(k).recall, d: 2, best: 'max' },
    { label: 'F1', get: (k) => met(k).f1, d: 2, best: 'max' },
    { label: 'Ganancia inf. (bits)', get: (k) => met(k).info_gain_bits, d: 2, best: 'max' },
    { label: 'MAE conteos', get: (k) => (M(k).counts ? met(k).mae_count : null), d: 3, best: 'min' },
    { label: 'Entrenar (s)', get: (k) => M(k).fit_seconds, d: 2 },
    { label: 'Inferir (µs/fila)', get: (k) => M(k).inference_us_per_row, d: 1 },
    { label: 'σ PR-AUC', get: (k) => M(k).stability.pr_auc_std, d: 3, best: 'min' },
  ]
  const bestOf = (c: (typeof cols)[number]) => {
    if (!c.best) return null
    const vals = keys.map((k) => c.get(k)).filter((v): v is number => v != null && Number.isFinite(v))
    return vals.length ? (c.best === 'max' ? Math.max(...vals) : Math.min(...vals)) : null
  }
  return (
    <ProvenanceContext.Provider value={prov}>
      <div className="stack loose">
        <Kpis
          label="Resumen del experimento"
          items={[
            { label: 'Zonas-periodo evaluadas', value: fmtInt(met('base').n), sub: scope === 'walk_forward' ? `${fc.folds.length} bloques walk-forward` : `prueba final (${fc.final_test_folds} bloques más recientes)` },
            { label: 'Con evento (positivos)', value: fmtInt(met('base').positives), sub: `prevalencia ${fmtShare(prevalence, 2)}` },
            { label: 'Modelo por defecto', value: <span style={{ fontSize: 'var(--fs-18)' }}>{SHORT[fc.selected_model]}</span>, sub: 'menor log-loss previo a la prueba final' },
            { label: 'Mejor PR-AUC', value: fmtNum(Math.max(...keys.map((k) => met(k).pr_auc ?? 0)), 3), sub: `sin información: ${fmtNum(prevalence, 3)}` },
          ]}
        />
        <div className="row wrap between">
          <Segmented label="Conjunto de evaluación" value={scope} onChange={setScope} options={[{ value: 'walk_forward', label: 'Todos los bloques walk-forward' }, { value: 'final_test', label: 'Prueba final (más reciente)' }]} />
          <Button variant="primary" icon={<HelpCircle size={18} aria-hidden />} onClick={() => setAdvice(true)}>
            ¿Qué modelo debería usar?
          </Button>
        </div>

        <Card title="Métricas por modelo" subtitle="En negrita, el mejor valor de cada columna. PR-AUC y Brier son las métricas principales; la exactitud (accuracy) no se usa para decidir.">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ maxHeight: 'none' }}>
            <table className="table">
              <caption className="sr-only">Métricas de cada modelo en {scope === 'walk_forward' ? 'la validación walk-forward' : 'la prueba final'}</caption>
              <thead>
                <tr>
                  <th scope="col">Modelo</th>
                  <th scope="col">Calibración</th>
                  {cols.map((c) => (
                    <th key={c.label} scope="col" className="r">{c.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k} data-highlight={k === focus}>
                    <th scope="row">
                      <button type="button" className="rowlink" onClick={() => setFocus(k)} aria-pressed={k === focus}>
                        {M(k).name}
                      </button>
                      {k === fc.selected_model && <span className="caption"> · por defecto</span>}
                    </th>
                    <td>{M(k).calibration_status}</td>
                    {cols.map((c) => {
                      const v = c.get(k)
                      const isBest = v != null && v === bestOf(c)
                      return (
                        <td key={c.label} className="r" style={isBest ? { fontWeight: 700 } : undefined}>
                          {v == null || !Number.isFinite(v) ? '—' : c.pct ? fmtSigned(v * 100, c.d, ' %') : fmtNum(v, c.d)}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption" style={{ marginTop: 8 }}>
            Mejora Brier = 1 − Brier del modelo / Brier de la línea base. ECE = error de calibración esperado. σ PR-AUC = desviación estándar entre bloques temporales. {fc.config.full_comparison ? '' : 'Random Forest solo se entrena en la configuración principal (30 días, M ≥ 4,0).'}
          </p>
        </Card>

        <div className="grid c2">
          <Card>
            <ChartFrame heading="h3" title="Curva precisión-recall" summary={`Precisión frente a recall al variar el umbral de decisión. La línea punteada es la prevalencia (${fmtNum(prevalence, 3)}), que equivale a un modelo sin información. Mayor área: ${SHORT[keys.reduce((a, b) => ((M(b).walk_forward.pr_auc ?? 0) > (M(a).walk_forward.pr_auc ?? 0) ? b : a))]}.`} table={{ columns: ['Modelo', 'Recall', 'Precisión'], rows: keys.flatMap((k) => (M(k).curves.pr ?? []).map(([x, y]) => [SHORT[k], x, y])) }} legend={legend} note="Curvas calculadas sobre todos los bloques walk-forward.">
              {(w) => <XYChart width={w} height={280} x={{ label: 'Recall', domain: [0, 1], format: (v) => fmtNum(v, 1) }} y={{ label: 'Precisión', domain: [0, 1], format: (v) => fmtNum(v, 1) }} hline={{ y: prevalence, label: 'sin información' }} series={keys.map((k) => ({ key: k, label: SHORT[k], color: COLORS[k], type: 'step' as const, width: k === focus ? 3 : 1.5, data: M(k).curves.pr ?? [] }))} />}
            </ChartFrame>
          </Card>
          <Card>
            <ChartFrame heading="h3" title="Curva ROC" summary="Tasa de verdaderos positivos frente a falsos positivos. La diagonal corresponde a un modelo sin información. Con clases muy desbalanceadas, esta curva tiende a verse mejor de lo que el modelo sirve en la práctica." table={{ columns: ['Modelo', 'Falsos positivos', 'Verdaderos positivos'], rows: keys.flatMap((k) => (M(k).curves.roc ?? []).map(([x, y]) => [SHORT[k], x, y])) }} legend={legend}>
              {(w) => <XYChart width={w} height={280} diagonal x={{ label: 'Tasa de falsos positivos', domain: [0, 1], format: (v) => fmtNum(v, 1) }} y={{ label: 'Tasa de verdaderos positivos', domain: [0, 1], format: (v) => fmtNum(v, 1) }} series={keys.map((k) => ({ key: k, label: SHORT[k], color: COLORS[k], type: 'line' as const, width: k === focus ? 3 : 1.5, data: M(k).curves.roc ?? [] }))} />}
            </ChartFrame>
          </Card>
          <Card>
            <Calibration m={M(focus)} />
          </Card>
          <Card>
            <ChartFrame
              heading="h3"
              title={`Matriz de confusión: ${SHORT[focus]}`}
              summary={`Con el umbral de decisión ${fmtPct(f.decision_threshold)} (el que maximiza F1 en validación): ${fmtInt(f.confusion.tp)} aciertos con evento, ${fmtInt(f.confusion.fn)} eventos no señalados, ${fmtInt(f.confusion.fp)} señalamientos sin evento y ${fmtInt(f.confusion.tn)} aciertos sin evento.`}
              table={{ columns: ['Lo que ocurrió', 'Modelo señaló evento', 'Modelo no señaló'], rows: [['Hubo evento', f.confusion.tp, f.confusion.fn], ['No hubo evento', f.confusion.fp, f.confusion.tn]] }}
              note="Los colores usan escala logarítmica porque los casos sin evento dominan."
            >
              {(w) => <HeatGrid width={Math.min(w, 460)} rows={['Hubo evento', 'No hubo evento']} cols={['Señaló evento', 'No señaló']} values={[[Math.log10(f.confusion.tp + 1), Math.log10(f.confusion.fn + 1)], [Math.log10(f.confusion.fp + 1), Math.log10(f.confusion.tn + 1)]]} format={(v) => fmtInt(Math.round(10 ** v - 1))} showValues cellH={64} rowLabelW={118} ramp="cividis" />}
            </ChartFrame>
          </Card>
        </div>

        <Card title="Validación que respeta el tiempo" subtitle="Cada bloque entrena con el pasado, calibra con los dos años siguientes y se prueba con el año posterior. Entre bloques se deja una separación igual al horizonte.">
          <WalkForward fc={fc} />
        </Card>

        <div className="grid c2">
          <Card>
            <ChartFrame heading="h3" title="Historial del Brier score por bloque temporal" summary="Brier score de cada modelo en el año de prueba de cada bloque. Valores más bajos son mejores; las subidas simultáneas de todos los modelos indican años con actividad inusual." table={{ columns: ['Bloque (inicio de prueba)', ...keys.map((k) => SHORT[k])], rows: fc.folds.map((r) => [r.test[0], ...keys.map((k) => r.models[k]?.brier ?? null)]) }} legend={legend}>
              {(w) => <XYChart width={w} height={250} x={{ type: 'time' }} y={{ label: 'Brier', format: (v) => fmtNum(v, 3) }} series={keys.map((k) => ({ key: k, label: SHORT[k], color: COLORS[k], type: 'line' as const, width: k === focus ? 3 : 1.5, data: fc.folds.map((r) => [day(r.test[0]), r.models[k]?.brier ?? null] as [number, number | null]) }))} />}
            </ChartFrame>
          </Card>
          <Card>
            <ChartFrame heading="h3" title="PR-AUC por bloque temporal" summary="Capacidad de ordenar zonas en cada año de prueba. La dispersión entre bloques es la medida de estabilidad." table={{ columns: ['Bloque (inicio de prueba)', 'Positivos', ...keys.map((k) => SHORT[k])], rows: fc.folds.map((r) => [r.test[0], r.test_positives, ...keys.map((k) => r.models[k]?.pr_auc ?? null)]) }} legend={legend}>
              {(w) => <XYChart width={w} height={250} x={{ type: 'time' }} y={{ label: 'PR-AUC', format: (v) => fmtNum(v, 2) }} series={keys.map((k) => ({ key: k, label: SHORT[k], color: COLORS[k], type: 'line' as const, width: k === focus ? 3 : 1.5, data: fc.folds.map((r) => [day(r.test[0]), r.models[k]?.pr_auc ?? null] as [number, number | null]) }))} />}
            </ChartFrame>
          </Card>
          <Card>
            <ChartFrame heading="h3" title="Modelo frente a línea base" summary="Mejora relativa del Brier score respecto a la frecuencia histórica. A la derecha, mejor que la base; a la izquierda, peor. Un valor cercano a cero significa que la complejidad adicional no aporta." table={{ columns: ['Modelo', 'Mejora de Brier (%)', 'Ganancia de información (bits por evento)'], rows: keys.filter((k) => k !== 'base').map((k) => [M(k).name, +(100 * (met(k).brier_skill ?? 0)).toFixed(2), met(k).info_gain_bits ?? null]) }}>
              {() => <BarList signed items={keys.filter((k) => k !== 'base').map((k) => ({ label: M(k).name, value: (met(k).brier_skill ?? 0) * 100, color: (met(k).brier_skill ?? 0) >= 0 ? 'var(--s1)' : 'var(--s2)' }))} format={(v) => fmtSigned(v, 1, ' %')} />}
            </ChartFrame>
          </Card>
          <Card>
            <ChartFrame heading="h3" title="Intervalos de variación del PR-AUC" summary="Para cada modelo: mínimo, máximo y valor global del PR-AUC entre los bloques temporales. Intervalos anchos indican resultados poco estables." table={{ columns: ['Modelo', 'Mínimo', 'Global', 'Máximo', 'Desviación'], rows: keys.map((k) => [M(k).name, M(k).stability.pr_auc_min, M(k).walk_forward.pr_auc, M(k).stability.pr_auc_max, M(k).stability.pr_auc_std]) }}>
              {(w) => <Ranges width={w} rows={keys.map((k) => ({ label: SHORT[k], color: COLORS[k], lo: M(k).stability.pr_auc_min ?? 0, hi: M(k).stability.pr_auc_max ?? 0, mid: M(k).walk_forward.pr_auc ?? 0 }))} />}
            </ChartFrame>
          </Card>
        </div>

        <Card>
          <ChartFrame
            heading="h3"
            title="Rendimiento por departamento (Brier score)"
            summary={`Brier score de cada modelo en las zonas de cada departamento con al menos 50 zonas-periodo evaluadas. Más oscuro es mejor. ${fc.by_department.length} departamentos.`}
            table={{ columns: ['Departamento', 'Zonas-periodo', 'Con evento', ...keys.map((k) => `Brier ${SHORT[k]}`)], rows: fc.by_department.map((d) => [d.department, d.n, d.positives, ...keys.map((k) => d.models[k]?.brier ?? null)]) }}
          >
            {(w) => <HeatGrid width={w} rows={keys.map((k) => SHORT[k])} cols={fc.by_department.map((d) => d.department)} values={keys.map((k) => fc.by_department.map((d) => d.models[k]?.brier ?? null))} format={(v) => fmtNum(v, 4)} ramp="cividis" rowLabelW={118} cellH={24} colEvery={Math.max(1, Math.ceil((fc.by_department.length * 70) / w))} />}
          </ChartFrame>
        </Card>

        <div className="grid c2">
          <Card title="Rendimiento por magnitud" subtitle="De las zonas-periodo cuyo mayor evento cayó en cada rango, proporción señalada por el modelo (recall).">
            <BreakdownTable rows={fc.by_magnitude} keys={keys} />
          </Card>
          <Card title="Rendimiento por profundidad" subtitle="Recall según la profundidad mediana de los eventos de la zona-periodo.">
            <BreakdownTable rows={fc.by_depth} keys={keys} />
          </Card>
        </div>

        <Card title="Detector de fugas de información" subtitle="Seis comprobaciones automáticas sobre la tabla y las particiones reales de este experimento.">
          <ul className="stack tight">
            {fc.leakage.map((l) => (
              <li key={l.id} className="note" data-tone={l.status === 'ok' ? undefined : l.status === 'falla' ? 'critical' : 'caution'}>
                {l.status === 'ok' ? <CircleCheck size={18} aria-hidden style={{ color: 'var(--positive)' }} /> : l.status === 'falla' ? <CircleAlert size={18} aria-hidden /> : <TriangleAlert size={18} aria-hidden />}
                <div>
                  <div className="row wrap">
                    <b>{l.title}</b>
                    <Pill tone={l.status === 'ok' ? 'positive' : l.status === 'falla' ? 'critical' : 'caution'}>{l.status === 'ok' ? 'Sin hallazgos' : l.status === 'falla' ? 'Falla' : 'Advertencia'}</Pill>
                  </div>
                  <div>{l.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </Card>
        <Note>
          Modelo secuencial (redes recurrentes): no se entrenó. Con {fmtInt(fc.config.positives)} zonas-periodo positivas, el volumen de datos no justifica un modelo de esa capacidad y el riesgo de sobreajuste sería alto. La «tasa inspirada en ETAS» usa parámetros fijos tomados de la literatura; no es un ajuste ETAS completo por máxima verosimilitud.
        </Note>
      </div>
      <Modal open={advice} onClose={() => setAdvice(false)} wide title="¿Qué modelo debería usar?" footer={<Button variant="primary" onClick={() => setAdvice(false)}>Entendido</Button>}>
        <div className="stack">
          <div className="prose">
            {rec.text.map((t) => (
              <p key={t}>{t}</p>
            ))}
          </div>
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ maxHeight: 'none' }}>
            <table className="table">
              <caption>Puntaje de 0 a 1 por criterio (1 = el mejor entre los modelos comparados). Pesos: PR-AUC 25 %, log-loss 20 %, calibración 20 %, interpretabilidad 15 %, estabilidad 15 %, costo 5 %.</caption>
              <thead>
                <tr>
                  <th scope="col">Modelo</th>
                  {Object.keys(rec.scores[0].parts).map((p) => (
                    <th key={p} scope="col" className="r" style={{ whiteSpace: 'normal', minWidth: 90 }}>{p}</th>
                  ))}
                  <th scope="col" className="r">Total</th>
                </tr>
              </thead>
              <tbody>
                {rec.scores.map((s) => (
                  <tr key={s.key} data-highlight={s.key === rec.key}>
                    <th scope="row">{M(s.key).name}</th>
                    {Object.values(s.parts).map((v, i) => (
                      <td key={i} className="r">{fmtNum(v, 2)}</td>
                    ))}
                    <td className="r" style={{ fontWeight: 700 }}>{fmtNum(s.total, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Note>Los pesos son una decisión de diseño del proyecto y pueden discutirse. Cambiarlos puede cambiar la recomendación cuando los modelos están muy cerca entre sí.</Note>
        </div>
      </Modal>
    </ProvenanceContext.Provider>
  )
}

function Calibration({ m }: { m: ModelResult }) {
  const bins = m.curves.calibration
  const top = Math.max(0.02, ...bins.map((b) => Math.max(b.p_mean, b.hi)))
  return (
    <ChartFrame
      heading="h3"
      title={`Curva de calibración: ${SHORT[m.key]}`}
      summary={`Probabilidad pronosticada frente a frecuencia observada, en ${bins.length} tramos. Sobre la diagonal el modelo está calibrado. Error de calibración esperado: ${fmtNum(m.walk_forward.ece, 4)}; pendiente ${fmtNum(m.walk_forward.calibration_slope ?? NaN, 2)}. Estado: ${m.calibration_status}.`}
      table={{ columns: ['Probabilidad media', 'Frecuencia observada', 'Inferior 90 %', 'Superior 90 %', 'Casos'], rows: bins.map((b) => [b.p_mean, b.observed, b.lo, b.hi, b.n]) }}
      legend={[{ label: 'Frecuencia observada (banda: intervalo del 90 %)', color: COLORS[m.key] }, { label: 'Calibración perfecta', color: 'var(--text-3)', dash: true }]}
      note="Seleccione otro modelo en la tabla de métricas para ver su curva."
    >
      {(w) => <XYChart width={w} height={280} diagonal x={{ label: 'Probabilidad pronosticada', domain: [0, top], format: (v) => fmtPct(v) }} y={{ label: 'Frecuencia observada', domain: [0, top], format: (v) => fmtPct(v) }} series={[{ key: 'cal', label: 'Frecuencia observada', color: COLORS[m.key], type: 'line', data: bins.map((b) => [b.p_mean, b.observed]), band: bins.map((b) => [b.p_mean, b.lo, b.hi]) }]} />}
    </ChartFrame>
  )
}

function Ranges({ rows, width }: { rows: { label: string; color: string; lo: number; hi: number; mid: number }[]; width: number }) {
  const max = Math.max(...rows.map((r) => r.hi), 0.01) * 1.08
  const lw = 118
  const iw = width - lw - 50
  const x = (v: number) => lw + (v / max) * iw
  return (
    <svg width={width} height={rows.length * 30 + 26}>
      {[0, 0.25, 0.5, 0.75, 1].map((t) => (
        <g key={t}>
          <line className="gridline" x1={x(max * t)} x2={x(max * t)} y1={0} y2={rows.length * 30} />
          <text x={x(max * t)} y={rows.length * 30 + 16} textAnchor="middle">{fmtNum(max * t, 2)}</text>
        </g>
      ))}
      {rows.map((r, i) => (
        <g key={r.label} transform={`translate(0,${i * 30 + 15})`}>
          <text x={lw - 8} dy="0.32em" textAnchor="end">{r.label}</text>
          <line x1={x(r.lo)} x2={x(r.hi)} stroke={r.color} strokeWidth={6} strokeLinecap="round" opacity={0.35} />
          <circle cx={x(r.mid)} r={5} fill={r.color} stroke="var(--surface)" strokeWidth={1.5} />
        </g>
      ))}
    </svg>
  )
}

function BreakdownTable({ rows, keys }: { rows: ForecastFile['by_depth']; keys: ModelKey[] }) {
  return (
    <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ maxHeight: 'none' }}>
      <table className="table">
        <thead>
          <tr>
            <th scope="col">Clase</th>
            <th scope="col" className="r">Casos</th>
            {keys.map((k) => (
              <th key={k} scope="col" className="r">{SHORT[k]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.class}>
              <th scope="row">{r.class}</th>
              <td className="r">{fmtInt(r.positives)}</td>
              {keys.map((k) => (
                <td key={k} className="r">{r.models[k]?.recall == null ? '—' : fmtShare(r.models[k]?.recall, 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="caption" style={{ padding: '8px 12px' }}>«—»: menos de 5 casos; no se calcula.</p>
    </div>
  )
}

/** Visualización interactiva de la partición walk-forward. */
function WalkForward({ fc }: { fc: ForecastFile }) {
  const [ref, width] = useWidth<HTMLDivElement>(800)
  const [k, setK] = useState(fc.folds.length - 1)
  const [playing, setPlaying] = useState(false)
  useEffect(() => setK(fc.folds.length - 1), [fc])
  useEffect(() => {
    if (!playing) return
    const id = setInterval(() => setK((v) => (v + 1 >= fc.folds.length ? (setPlaying(false), v) : v + 1)), 900)
    return () => clearInterval(id)
  }, [playing, fc])
  const t0 = day(fc.folds[0].train[0])
  const t1 = day(fc.folds[fc.folds.length - 1].test[1]) + fc.config.horizon_days * 86400
  const lw = 74
  const x = (t: number) => lw + ((t - t0) / (t1 - t0)) * (width - lw - 8)
  const rowH = 22
  const fold = fc.folds[k]
  const years: number[] = []
  for (let y = new Date(t0 * 1000).getUTCFullYear() + 1; y <= new Date(t1 * 1000).getUTCFullYear(); y += width < 520 ? 10 : 5) years.push(Math.ceil(y / 5) * 5)
  const seg = (a: string, b: string, color: string, i: number, opacity: number, hatch?: boolean) => <rect x={x(day(a))} width={Math.max(2, x(day(b) + fc.config.origin_step_days * 86400) - x(day(a)))} y={i * rowH + 4} height={rowH - 8} rx={3} fill={hatch ? 'url(#wf-hatch)' : color} opacity={opacity} />
  return (
    <div className="stack">
      <div className="row wrap between">
        <div className="row">
          <Button size="sm" icon={playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />} onClick={() => (k >= fc.folds.length - 1 && !playing ? (setK(0), setPlaying(true)) : setPlaying(!playing))}>
            {playing ? 'Pausar' : 'Ver cómo avanza la ventana'}
          </Button>
          <Select label="Bloque" value={k} onChange={(v) => (setPlaying(false), setK(v))} options={fc.folds.map((f, i) => ({ value: i, label: `Bloque ${f.fold}: prueba ${f.test[0].slice(0, 4)}–${f.test[1].slice(0, 4)}` }))} />
        </div>
        <div className="legend" style={{ marginTop: 0 }}>
          <span><i data-shape="box" style={{ background: 'var(--s6)' }} />Entrenamiento</span>
          <span><i data-shape="box" style={{ background: 'var(--s2)' }} />Validación (calibración y umbral)</span>
          <span><i data-shape="box" style={{ background: 'var(--s1)' }} />Prueba</span>
        </div>
      </div>
      <div ref={ref}>
        <svg width={width} height={fc.folds.length * rowH + 24} role="img" aria-label={`Esquema de ${fc.folds.length} bloques walk-forward. El bloque ${fold.fold} entrena del ${fmtDate(fold.train[0])} al ${fmtDate(fold.train[1])}, valida del ${fmtDate(fold.val[0])} al ${fmtDate(fold.val[1])} y se prueba del ${fmtDate(fold.test[0])} al ${fmtDate(fold.test[1])}.`}>
          <defs>
            <pattern id="wf-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="6" height="6" fill="var(--s2)" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--surface)" strokeWidth="2" />
            </pattern>
          </defs>
          {years.map((y) => (
            <g key={y}>
              <line className="gridline" x1={x(Date.UTC(y, 0, 1) / 1000)} x2={x(Date.UTC(y, 0, 1) / 1000)} y1={0} y2={fc.folds.length * rowH} />
              <text x={x(Date.UTC(y, 0, 1) / 1000)} y={fc.folds.length * rowH + 16} textAnchor="middle">{y}</text>
            </g>
          ))}
          {fc.folds.map((f, i) => {
            const o = i === k ? 1 : 0.32
            return (
              <g key={f.fold} onClick={() => (setPlaying(false), setK(i))} style={{ cursor: 'pointer' }}>
                <rect x={0} y={i * rowH} width={width} height={rowH} fill={i === k ? 'var(--accent-soft)' : 'transparent'} rx={4} />
                <text x={4} y={i * rowH + rowH / 2} dy="0.32em" style={{ fontWeight: i === k ? 700 : 400 }}>Bloque {f.fold}</text>
                {seg(f.train[0], f.train[1], 'var(--s6)', i, o)}
                {seg(f.val[0], f.val[1], 'var(--s2)', i, o, true)}
                {seg(f.test[0], f.test[1], 'var(--s1)', i, o)}
              </g>
            )
          })}
        </svg>
      </div>
      <dl className="kpis" aria-live="polite">
        <div className="kpi">
          <dt>Entrenamiento · bloque {fold.fold}</dt>
          <dd style={{ fontSize: 'var(--fs-16)' }}>{fmtDate(fold.train[0])} – {fmtDate(fold.train[1])}<div className="sub">{fmtInt(fold.n_train)} zonas-periodo</div></dd>
        </div>
        <div className="kpi">
          <dt>Validación</dt>
          <dd style={{ fontSize: 'var(--fs-16)' }}>{fmtDate(fold.val[0])} – {fmtDate(fold.val[1])}<div className="sub">{fmtInt(fold.n_val)} zonas-periodo</div></dd>
        </div>
        <div className="kpi">
          <dt>Prueba</dt>
          <dd style={{ fontSize: 'var(--fs-16)' }}>{fmtDate(fold.test[0])} – {fmtDate(fold.test[1])}<div className="sub">{fmtInt(fold.n_test)} zonas-periodo · {fmtInt(fold.test_positives)} con evento</div></dd>
        </div>
        <div className="kpi">
          <dt>Separación entre conjuntos</dt>
          <dd style={{ fontSize: 'var(--fs-16)' }}>{fold.gap_days} días<div className="sub">igual al horizonte: ninguna etiqueta se solapa</div></dd>
        </div>
      </dl>
      <p className="caption">
        Los dos bloques más recientes forman la prueba final y no intervienen en la elección del modelo por defecto. El modelo vigente se reentrena con todo lo anterior a {fmtDate(fc.final_fit.val[0])} y se calibra con el periodo {fmtDate(fc.final_fit.val[0])} – {fmtDate(fc.final_fit.val[1])}. No se usa ninguna división aleatoria.
      </p>
    </div>
  )
}
