// Filtros compartidos por el atlas, el explorador histórico y el pronóstico. Cada cambio queda en el historial.
import { Bookmark, History, Link2, Redo2, RotateCcw, SlidersHorizontal, Undo2, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { loadZones, useAsync } from '@/lib/data'
import { fmtInt, fmtNum, isIsoDay } from '@/lib/format'
import { DEPTH_CLASSES } from '@/lib/scales'
import { COVERAGE, DEFAULT_FILTERS, useApp, type Filters } from '@/lib/store'
import { copyLink } from './Palette'
import { Button, Field, IconButton, Select, Sheet, Switch } from './ui'

/** Campo numérico que confirma el valor al salir o con Enter (evita llenar el historial mientras se escribe). */
function NumberField({ label, value, min, max, step, onCommit, hint }: { label: string; value: number; min: number; max: number; step: number; onCommit: (v: number) => void; hint?: string }) {
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(value)), [value])
  const n = Number(text.replace(',', '.'))
  const bad = text.trim() === '' || !Number.isFinite(n) || n < min || n > max
  const commit = () => (bad ? setText(String(value)) : n !== value && onCommit(n))
  return (
    <Field label={label} hint={hint} error={bad && text !== '' ? `Use un valor entre ${fmtNum(min, 1)} y ${fmtNum(max, 1)}.` : undefined}>
      {(p) => <input {...p} className="input num" type="number" inputMode="decimal" min={min} max={max} step={step} value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />}
    </Field>
  )
}

const DEPTH_PRESETS = [{ value: '0_700', label: 'Todas las profundidades' }, ...DEPTH_CLASSES.map((c) => ({ value: `${c.min}_${Number.isFinite(c.max) ? c.max : 700}`, label: `${c.label} · ${c.name.toLowerCase()}` }))]
const PERIODS: { label: string; days: number | null }[] = [
  { label: '30 días', days: 30 },
  { label: '1 año', days: 365 },
  { label: '5 años', days: 1826 },
  { label: 'Todo', days: null },
]

export function FilterForm({ showQuality = true }: { showQuality?: boolean }) {
  const f = useApp((s) => s.filters)
  const set = useApp((s) => s.setFilters)
  const deps = useAsync(() => loadZones('dep'), [])
  const depthKey = `${f.depthMin}_${f.depthMax}`
  const depName = (code: string) => (deps.data ? deps.data.name[deps.data.index.get(code) ?? -1] : code)
  const dateErr = f.from > f.to ? 'La fecha inicial debe ser anterior a la final.' : undefined
  return (
    <div className="stack">
      <div className="range-pair">
        <Field label="Desde (UTC)" error={dateErr}>
          {(p) => <input {...p} className="input num" type="date" min={COVERAGE.from} max={COVERAGE.to} value={f.from} onChange={(e) => isIsoDay(e.target.value) && set({ from: e.target.value }, `Desde ${e.target.value}`)} />}
        </Field>
        <Field label="Hasta (UTC)">
          {(p) => <input {...p} className="input num" type="date" min={COVERAGE.from} max={COVERAGE.to} value={f.to} onChange={(e) => isIsoDay(e.target.value) && set({ to: e.target.value }, `Hasta ${e.target.value}`)} />}
        </Field>
      </div>
      <div className="chips" role="group" aria-label="Periodos rápidos">
        {PERIODS.map((p) => {
          const from = p.days == null ? COVERAGE.from : new Date(Date.parse(`${COVERAGE.to}T00:00:00Z`) - p.days * 86400000).toISOString().slice(0, 10)
          const on = f.from === from && f.to === COVERAGE.to
          return (
            <button key={p.label} type="button" className="chip" aria-pressed={on} onClick={() => set({ from, to: COVERAGE.to }, p.days == null ? 'Todo el catálogo' : `Últimos ${p.label}`)}>
              {p.days == null ? 'Todo el catálogo' : `Últimos ${p.label}`}
            </button>
          )
        })}
      </div>
      <div className="range-pair">
        <NumberField label="Magnitud mínima" value={f.magMin} min={2.5} max={9} step={0.1} onCommit={(v) => set({ magMin: v, magMax: Math.max(v, f.magMax) }, `Magnitud ≥ ${fmtNum(v, 1)}`)} hint="El catálogo incluido empieza en 2,5." />
        <NumberField label="Magnitud máxima" value={f.magMax} min={2.5} max={9} step={0.1} onCommit={(v) => set({ magMax: v, magMin: Math.min(v, f.magMin) }, `Magnitud ≤ ${fmtNum(v, 1)}`)} />
      </div>
      <Select
        label="Profundidad"
        value={DEPTH_PRESETS.some((o) => o.value === depthKey) ? depthKey : 'custom'}
        options={[...DEPTH_PRESETS, ...(DEPTH_PRESETS.some((o) => o.value === depthKey) ? [] : [{ value: 'custom', label: `Personalizada: ${f.depthMin}–${f.depthMax} km` }])]}
        onChange={(v) => {
          if (v === 'custom') return
          const [a, b] = v.split('_').map(Number)
          set({ depthMin: a, depthMax: b }, `Profundidad: ${DEPTH_PRESETS.find((o) => o.value === v)?.label}`)
        }}
      />
      <div className="range-pair">
        <NumberField label="Profundidad mínima (km)" value={f.depthMin} min={0} max={700} step={5} onCommit={(v) => set({ depthMin: v, depthMax: Math.max(v, f.depthMax) }, `Profundidad ≥ ${v} km`)} />
        <NumberField label="Profundidad máxima (km)" value={f.depthMax} min={0} max={700} step={5} onCommit={(v) => set({ depthMax: v, depthMin: Math.min(v, f.depthMin) }, `Profundidad ≤ ${v} km`)} />
      </div>
      <Select
        label="Ubicación"
        value={f.dept}
        options={[{ value: '', label: 'Toda la ventana de estudio' }, ...(deps.data ? deps.data.id.map((id, i) => ({ value: id, label: deps.data.name[i] })).sort((a, b) => a.label.localeCompare(b.label, 'es')) : [])]}
        onChange={(v) => set({ dept: v }, v ? `Departamento: ${depName(v)}` : 'Toda la ventana de estudio')}
        hint="Para buscar un municipio o unas coordenadas use la búsqueda global."
      />
      {showQuality && <Switch label="Solo localizaciones de calidad A y B" checked={f.quality === 'AB'} onChange={(v) => set({ quality: v ? 'AB' : '' }, v ? 'Solo calidad A y B' : 'Todas las calidades')} />}
    </div>
  )
}

export function HistoryControls({ compact }: { compact?: boolean }) {
  const past = useApp((s) => s.past)
  const future = useApp((s) => s.future)
  const { undo, redo, resetFilters } = useApp.getState()
  const size = compact ? 'sm' : 'md'
  return (
    <div className="row" role="group" aria-label="Historial de filtros">
      <IconButton label={past.length ? `Deshacer: ${past[past.length - 1].label}` : 'Nada que deshacer'} size={size} disabled={!past.length} onClick={undo}>
        <Undo2 size={18} aria-hidden />
      </IconButton>
      <IconButton label={future.length ? `Rehacer: ${future[0].label}` : 'Nada que rehacer'} size={size} disabled={!future.length} onClick={redo}>
        <Redo2 size={18} aria-hidden />
      </IconButton>
      <IconButton label="Restablecer filtros" size={size} onClick={resetFilters}>
        <RotateCcw size={18} aria-hidden />
      </IconButton>
    </div>
  )
}

/** Chips con los filtros distintos del valor por defecto; cada uno se puede quitar. */
export function ActiveFilters() {
  const f = useApp((s) => s.filters)
  const set = useApp((s) => s.setFilters)
  const deps = useAsync(() => loadZones('dep'), [])
  const D = DEFAULT_FILTERS
  const chips: { label: string; clear: Partial<Filters> }[] = []
  if (f.from !== D.from || f.to !== D.to) chips.push({ label: `${f.from} → ${f.to}`, clear: { from: D.from, to: D.to } })
  if (f.magMin !== D.magMin || f.magMax !== D.magMax) chips.push({ label: f.magMax >= 9 ? `M ≥ ${fmtNum(f.magMin, 1)}` : `M ${fmtNum(f.magMin, 1)}–${fmtNum(f.magMax, 1)}`, clear: { magMin: D.magMin, magMax: D.magMax } })
  if (f.depthMin !== D.depthMin || f.depthMax !== D.depthMax) chips.push({ label: `${f.depthMin}–${f.depthMax} km`, clear: { depthMin: D.depthMin, depthMax: D.depthMax } })
  if (f.dept) chips.push({ label: deps.data?.name[deps.data.index.get(f.dept) ?? -1] ?? `Dpto. ${f.dept}`, clear: { dept: '' } })
  if (f.quality) chips.push({ label: 'Calidad A y B', clear: { quality: '' } })
  if (!chips.length) return null
  return (
    <>
      {chips.map((c) => (
        <button key={c.label} type="button" className="chip glass num" onClick={() => set(c.clear, `Quitar filtro ${c.label}`)} aria-label={`Quitar filtro: ${c.label}`}>
          {c.label}
          <X size={14} aria-hidden />
        </button>
      ))}
    </>
  )
}

/** Botón «Filtros» + hoja con el formulario, historial y vistas guardadas. */
export function FilterSheet({ count, children, title = 'Filtros' }: { count?: number; children?: React.ReactNode; title?: string }) {
  const [open, setOpen] = useState(false)
  const past = useApp((s) => s.past)
  const saved = useApp((s) => s.saved)
  const { saveView, removeView, toast } = useApp.getState()
  const [name, setName] = useState('')
  return (
    <>
      <button type="button" className="btn glass" data-size="sm" style={{ minHeight: 44 }} onClick={() => setOpen(true)} aria-haspopup="dialog">
        <SlidersHorizontal size={18} aria-hidden />
        {title}
        {count != null && <span className="num muted" style={{ fontWeight: 500 }}>· {fmtInt(count)}</span>}
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={title}
        footer={
          <>
            <span className="grow">
              <HistoryControls />
            </span>
            <Button variant="primary" onClick={() => setOpen(false)}>
              Ver resultados
            </Button>
          </>
        }
      >
        <div className="stack loose">
          {children}
          <FilterForm />
          <details className="disclosure">
            <summary>
              <span className="row">
                <History size={18} aria-hidden /> Historial de la sesión ({past.length})
              </span>
            </summary>
            <div>
              {past.length === 0 ? (
                <p className="small muted">Aún no ha cambiado ningún filtro.</p>
              ) : (
                <ol className="stack tight small">
                  {[...past].reverse().slice(0, 15).map((p, i) => (
                    <li key={p.at + i} className="row between">
                      <span>{p.label}</span>
                      <span className="caption num">{new Date(p.at).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' })}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          </details>
          <details className="disclosure">
            <summary>
              <span className="row">
                <Bookmark size={18} aria-hidden /> Vistas guardadas ({saved.length})
              </span>
            </summary>
            <div className="stack tight">
              <form
                className="row"
                onSubmit={(e) => {
                  e.preventDefault()
                  const n = name.trim().slice(0, 40)
                  if (!n) return
                  saveView(n, window.location.hash)
                  setName('')
                  toast(`Vista «${n}» guardada durante esta sesión.`)
                }}
              >
                <input className="input" aria-label="Nombre de la vista" placeholder="Nombre de la vista" maxLength={40} value={name} onChange={(e) => setName(e.target.value)} />
                <Button type="submit" disabled={!name.trim()}>
                  Guardar
                </Button>
              </form>
              <p className="caption">Las vistas se conservan mientras esta pestaña esté abierta. Para conservarlas más tiempo, copie el enlace.</p>
              {saved.map((v) => (
                <div key={v.at} className="row between">
                  <a href={v.href} onClick={() => setOpen(false)}>
                    {v.name}
                  </a>
                  <IconButton label={`Eliminar la vista ${v.name}`} size="sm" onClick={() => removeView(v.at)}>
                    <X size={16} aria-hidden />
                  </IconButton>
                </div>
              ))}
              <Button variant="outline" icon={<Link2 size={16} aria-hidden />} onClick={() => void copyLink().then((ok) => toast(ok ? 'Enlace copiado. Incluye los filtros y la vista del mapa.' : 'No fue posible copiar; copie la dirección del navegador.'))}>
                Copiar enlace a esta vista
              </Button>
            </div>
          </details>
        </div>
      </Sheet>
    </>
  )
}
