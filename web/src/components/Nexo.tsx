// Panel del asistente Nexo. Responde solo con cálculos sobre los datos cargados y siempre cita la fuente.
import { CornerDownLeft, Undo2 } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { forecastId, loadEvents, loadForecast, loadIndex, loadZones, MODEL_ORDER } from '@/lib/data'
import { fmtInt, fmtNum, fmtPct, fmtSigned, inPhrase } from '@/lib/format'
import { filterEvents } from '@/lib/geo'
import { findTerm } from '@/lib/glossary'
import { DISTINGUISH_TEXT, EXAMPLES, NO_ALERT_TEXT, parseQuery } from '@/lib/nexo'
import { DAY, mean, median } from '@/lib/stats'
import { isTrained, sanitizeFilters, useApp } from '@/lib/store'
import { loadZoneData } from '@/lib/zonedata'
import { Button, Sheet } from './ui'

interface Msg {
  from: 'usuario' | 'nexo'
  body: ReactNode
  undo?: boolean
}
const SOURCE = (v: string) => <p className="caption" style={{ marginTop: 6 }}>Fuente: catálogo de la Red Sismológica Nacional de Colombia (SGC), versión {v}.</p>

export default function Nexo() {
  const open = useApp((s) => s.nexo)
  const setOpen = useApp((s) => s.setOpen)
  const navigate = useNavigate()
  const [msgs, setMsgs] = useState<Msg[]>([
    {
      from: 'nexo',
      body: (
        <>
          <p>Soy Nexo. Convierto preguntas en filtros y cálculos sobre el catálogo real. No soy un modelo generativo: si no tengo la información, se lo digo.</p>
          <p style={{ marginTop: 6 }}>No emito alertas ni predigo sismos.</p>
        </>
      ),
    },
  ])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const end = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // scrollIntoView devuelve una promesa en navegadores recientes: el efecto no debe devolverla.
    end.current?.scrollIntoView({ block: 'end' })
  }, [msgs])

  const answer = async (q: string): Promise<Msg> => {
    const s = useApp.getState()
    const [index, deps, ev] = await Promise.all([loadIndex(), loadZones('dep'), loadEvents()])
    const depts = deps.id.map((code, i) => ({ code, name: deps.name[i] }))
    const today = index.coverage[1].slice(0, 10)
    const it = parseQuery(q, depts, today)
    const src = SOURCE(index.dataset_version)
    const nexo = (body: ReactNode, undo = false): Msg => ({ from: 'nexo', body, undo })
    switch (it.kind) {
      case 'no-alerta':
        return nexo(<p>{NO_ALERT_TEXT}</p>)
      case 'ayuda':
        return nexo(<p>Puedo filtrar eventos por magnitud, fecha, profundidad y departamento; comparar profundidades entre departamentos; listar dónde hubo más actividad reciente; explicar una estimación; crear un informe; definir términos y decir qué modelo está mejor calibrado. Pruebe con uno de los ejemplos.</p>)
      case 'distinguir':
        return nexo(
          <>
            <p>Son cinco conceptos distintos:</p>
            <ul className="stack tight" style={{ marginTop: 6 }}>
              {DISTINGUISH_TEXT.map((id) => {
                const t = findTerm(id)!
                return <li key={id}><b>{t.term}:</b> {t.short}</li>
              })}
            </ul>
            <p style={{ marginTop: 6 }}>Esta plataforma describe actividad y estima su probabilidad. No calcula amenaza oficial, exposición, vulnerabilidad ni riesgo.</p>
          </>,
        )
      case 'glosario':
        return nexo(
          <>
            <p><b>{it.term.term}.</b> {it.term.short}</p>
            <p style={{ marginTop: 6 }}>{it.term.long}</p>
            <Button size="sm" variant="ghost" onClick={() => (setOpen('nexo', false), navigate('/aprender', { state: { term: it.term.id } }))}>Ver en el glosario</Button>
          </>,
        )
      case 'filtrar': {
        s.setFilters(it.patch, `Nexo: ${it.applied.join('; ')}`)
        const f = useApp.getState().filters
        const idx = filterEvents(ev, f)
        let mx = NaN
        for (let k = 0; k < idx.length; k++) if (!(mx >= ev.mag[idx[k]])) mx = ev.mag[idx[k]]
        navigate('/atlas')
        return nexo(
          <>
            <p>Apliqué estos filtros: {it.applied.join('; ')}.</p>
            <p style={{ marginTop: 6 }}>
              {idx.length ? <>Resultado: <b>{fmtInt(idx.length)} eventos</b>; magnitud máxima {fmtNum(mx, 1)}. El atlas ya los muestra.</> : 'Ningún evento del catálogo cumple esas condiciones.'}
            </p>
            {src}
          </>,
          true,
        )
      }
      case 'comparar-profundidad': {
        const base = sanitizeFilters({ ...s.filters, ...it.patch, dept: '' })
        const rows = it.depts.map((code) => {
          const idx = filterEvents(ev, { ...base, dept: code })
          const d = Array.from(idx, (i) => ev.depth[i]).filter(Number.isFinite)
          return { name: depts.find((x) => x.code === code)!.name, n: idx.length, mean: mean(d), median: median(d) }
        })
        return nexo(
          <>
            <p>Profundidad de los eventos registrados ({base.from} a {base.to}, M ≥ {fmtNum(base.magMin, 1)}{it.applied.length ? `; ${it.applied.join('; ')}` : ''}):</p>
            <table className="table" style={{ marginTop: 6 }}>
              <thead><tr><th scope="col">Departamento</th><th scope="col" className="r">Eventos</th><th scope="col" className="r">Media</th><th scope="col" className="r">Mediana</th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.name}><th scope="row">{r.name}</th><td className="r">{fmtInt(r.n)}</td><td className="r">{fmtNum(r.mean, 0)} km</td><td className="r">{fmtNum(r.median, 0)} km</td></tr>
                ))}
              </tbody>
            </table>
            {rows.every((r) => r.n > 0) && <p style={{ marginTop: 6 }}>La mediana de {rows[0].name} es {fmtSigned(rows[0].median - rows[1].median, 0, ' km')} respecto a la de {rows[1].name}. No modifiqué sus filtros.</p>}
            {src}
          </>,
        )
      }
      case 'mayor-actividad': {
        const t1 = (Math.floor(ev.t[ev.n - 1] / DAY) + 1) * DAY
        const t0 = t1 - it.days * DAY
        const n = new Map<number, number>()
        let outside = 0
        for (let i = ev.n - 1; i >= 0 && ev.t[i] >= t0; i--) ev.dep[i] >= 0 ? n.set(ev.dep[i], (n.get(ev.dep[i]) ?? 0) + 1) : outside++
        const top = [...n.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
        return nexo(
          <>
            <p>Departamentos con más eventos registrados (M ≥ 2,5) en los últimos {it.days} días del catálogo, hasta el {today}:</p>
            <ol className="stack tight" style={{ marginTop: 6, listStyle: 'decimal', paddingLeft: '1.4em' }}>
              {top.map(([d, c]) => (
                <li key={d}>{depts.find((x) => x.code === ev.depCodes[d])?.name ?? ev.depCodes[d]}: <b className="num">{fmtInt(c)}</b></li>
              ))}
            </ol>
            <p style={{ marginTop: 6 }}>Además, {fmtInt(outside)} eventos fuera de los límites departamentales (mar o países vecinos). Más eventos registrados no implica mayor peligro: depende de la profundidad, la magnitud y la cobertura de la red.</p>
            {src}
          </>,
        )
      }
      case 'mejor-calibrado': {
        const p = isTrained(s.fc, { depthMin: 0, depthMax: 700 }) ? s.fc : { ...s.fc, h: 30, thr: 4 }
        const fc = await loadForecast(forecastId(p.unit, p.h, p.thr))
        const rank = MODEL_ORDER.filter((k) => fc.models[k]).map((k) => fc.models[k]!).sort((a, b) => a.walk_forward.ece - b.walk_forward.ece)
        return nexo(
          <>
            <p>Para {fc.config.unit_label.toLowerCase()}, {fc.config.horizon_days} días y M ≥ {fmtNum(fc.config.threshold, 1)}, el modelo con menor error de calibración (ECE) en la validación walk-forward es <b>{rank[0].name}</b>: ECE {fmtNum(rank[0].walk_forward.ece, 4)}, estado «{rank[0].calibration_status}».</p>
            <p style={{ marginTop: 6 }}>Le siguen {rank.slice(1, 3).map((m) => `${inPhrase(m.name)} (${fmtNum(m.walk_forward.ece, 4)})`).join(' y ')}. Estar bien calibrado no basta: también importa cuánto mejora a la línea base.</p>
            <Button size="sm" variant="ghost" onClick={() => (setOpen('nexo', false), navigate('/modelos'))}>Abrir el comparador de modelos</Button>
            <p className="caption" style={{ marginTop: 6 }}>Versión del modelo: {fc.config.model_version}.</p>
          </>,
        )
      }
      case 'explicar-zona':
      case 'informe-zona': {
        const sel = s.selection
        if (sel?.kind !== 'zona') return nexo(<p>Primero necesito saber de qué zona habla. Abra «Pronóstico probabilístico», seleccione una zona en el mapa y vuelva a preguntarme.</p>)
        if (it.kind === 'informe-zona') {
          setOpen('nexo', false)
          navigate('/informes', { state: { tipo: 'zona', zona: sel.id, unidad: sel.unit } })
          return nexo(<p>Abrí el informe de la zona seleccionada. Puede descargarlo en PDF, CSV, JSON, PNG o GeoJSON.</p>)
        }
        const zd = await loadZoneData({ ...s.fc, unit: sel.unit }, s.filters)
        const zi = zd.zt.index.get(sel.id)
        if (zi == null) return nexo(<p>No encontré esa zona en la unidad de análisis actual.</p>)
        const avg = zd.p.reduce((a, b) => a + b, 0) / zd.p.length
        const f = zd.file
        const top = f ? f.forecast.shap[zi].map((v, j) => ({ v, label: index.features.find((x) => x.key === f.features[j])?.label ?? f.features[j] })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 3) : []
        const base = f?.forecast.p.base?.[zi]
        return nexo(
          <>
            <p><b>{zd.zt.name[zi]}</b>: {fmtPct(zd.p[zi])} (intervalo del 90 %: {fmtPct(zd.lo[zi])}–{fmtPct(zd.hi[zi])}), frente a una media de {fmtPct(avg)} en todas las zonas{base != null ? ` y a ${fmtPct(base)} de su propia línea base histórica` : ''}.</p>
            {top.length > 0 ? (
              <p style={{ marginTop: 6 }}>El modelo dio mayor peso a: {top.map((t) => `${t.label.toLowerCase()} (${t.v >= 0 ? 'eleva' : 'reduce'} la estimación)`).join('; ')}. Son asociaciones observadas en el histórico; esto no demuestra causalidad.</p>
            ) : (
              <p style={{ marginTop: 6 }}>Se usa la línea base recalculada, que solo considera la frecuencia histórica de la zona.</p>
            )}
            <p style={{ marginTop: 6 }}>Para el detalle completo use «Explicar esta estimación» en el panel de la zona.</p>
            <p className="caption" style={{ marginTop: 6 }}>Modelo: {zd.modelName} · versión {zd.modelVersion}.</p>
          </>,
        )
      }
      default:
        return nexo(<p>No tengo información para responder eso con los datos de la plataforma, y prefiero no inventar. Puedo ayudarle con filtros de eventos, comparaciones entre departamentos, actividad reciente, definiciones y modelos. Pruebe con uno de los ejemplos.</p>)
    }
  }

  const send = async (q: string) => {
    const clean = q.trim().slice(0, 300)
    if (!clean || busy) return
    setText('')
    setBusy(true)
    setMsgs((m) => [...m, { from: 'usuario', body: clean }])
    try {
      const a = await answer(clean)
      setMsgs((m) => [...m, a])
    } catch {
      setMsgs((m) => [...m, { from: 'nexo', body: <p>No pude consultar los datos en este momento. Revise la conexión e intente de nuevo.</p> }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <Sheet
      open={open}
      onClose={() => setOpen('nexo', false)}
      title="Nexo"
      footer={
        <form className="row" style={{ width: '100%' }} onSubmit={(e) => (e.preventDefault(), void send(text))}>
          <input className="input" data-autofocus aria-label="Pregunta para Nexo" placeholder="Escriba una consulta" maxLength={300} value={text} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" variant="primary" disabled={!text.trim() || busy} aria-label="Enviar consulta" icon={<CornerDownLeft size={18} aria-hidden />}>
            Enviar
          </Button>
        </form>
      }
    >
      <div className="stack" role="log" aria-live="polite" aria-label="Conversación con Nexo">
        {msgs.map((m, i) => (
          <div key={i} style={{ alignSelf: m.from === 'usuario' ? 'flex-end' : 'stretch', maxWidth: m.from === 'usuario' ? '88%' : '100%' }}>
            <div className="small" style={{ padding: '10px 14px', borderRadius: 14, background: m.from === 'usuario' ? 'var(--accent)' : 'var(--surface)', color: m.from === 'usuario' ? 'var(--text-on-accent)' : 'var(--text)', border: m.from === 'usuario' ? 0 : '1px solid var(--border)', overflowX: 'auto' }}>
              <span className="sr-only">{m.from === 'usuario' ? 'Usted: ' : 'Nexo: '}</span>
              {m.body}
            </div>
            {m.undo && i === msgs.length - 1 && (
              <Button
                size="sm"
                variant="ghost"
                icon={<Undo2 size={16} aria-hidden />}
                onClick={() => {
                  useApp.getState().undo()
                  setMsgs((x) => [...x, { from: 'nexo', body: <p>Listo: deshice esos filtros y restauré los anteriores.</p> }])
                }}
              >
                Deshacer estos filtros
              </Button>
            )}
          </div>
        ))}
        {busy && <p className="caption" role="status">Consultando los datos…</p>}
        {msgs.length <= 2 && (
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>Ejemplos</div>
            <div className="stack tight">
              {EXAMPLES.map((e) => (
                <button key={e} type="button" className="chip" style={{ height: 'auto', minHeight: 44, padding: '8px 12px', borderRadius: 12, whiteSpace: 'normal', textAlign: 'left', justifyContent: 'flex-start' }} onClick={() => void send(e)}>
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}
        <div ref={end} />
      </div>
    </Sheet>
  )
}
