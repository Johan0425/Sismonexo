// Piezas de interfaz que flotan sobre el mapa: leyendas, selector de capas y menú de exportación.
import { ChevronDown, Download, Layers } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ProbabilityScale } from '@/components/ui'
import { loadIndex, useAsync } from '@/lib/data'
import { DEPTH_CLASSES, NO_DATA_COLOR, rampCss } from '@/lib/scales'
import { useApp, type ColorBy, type Viz } from '@/lib/store'
import type { ZoneLegend } from '@/lib/zonedata'

export function useMedia(query: string): boolean {
  const [m, setM] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const on = () => setM(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [query])
  return m
}

/** Botón con panel flotante de vidrio; se cierra con Esc o al hacer clic fuera. */
export function Popover({ label, icon, children, align = 'left', width = 300 }: { label: string; icon: ReactNode; children: ReactNode; align?: 'left' | 'right'; width?: number }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const btn = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return
        btn.current?.focus()
      } else if (ref.current?.contains(e.target as Node)) return
      setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button ref={btn} type="button" className="btn glass" data-size="sm" style={{ minHeight: 44 }} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((v) => !v)}>
        {icon}
        {label}
      </button>
      {open && (
        <div className="popover glass" role="dialog" aria-label={label} style={{ top: 52, [align]: 0, width: `min(${width}px, calc(100vw - 32px))`, maxHeight: 'min(70dvh, 560px)', overflow: 'auto', padding: 16 }}>
          {children}
        </div>
      )}
    </div>
  )
}

const VIZ: { value: Viz; label: string; hint: string }[] = [
  { value: 'puntos', label: 'Puntos', hint: 'Un círculo por evento' },
  { value: 'pulsos', label: 'Pulsos', hint: 'Anillos; deja ver superposiciones' },
  { value: 'grupos', label: 'Agrupaciones', hint: 'Eventos cercanos reunidos' },
  { value: 'calor', label: 'Mapa de calor', hint: 'Ponderado por magnitud' },
  { value: 'densidad', label: 'Densidad suavizada', hint: 'Solo cuenta eventos' },
  { value: 'columnas', label: 'Columnas 3D', hint: 'Altura = profundidad' },
  { value: 'h3', label: 'Hexágonos H3', hint: 'Conteo por celda' },
  { value: 'g50', label: 'Celdas cuadradas', hint: 'Conteo por celda de ≈ 50 km' },
]
const OVERLAYS: { key: string; label: string; hint?: string }[] = [
  { key: 'dep', label: 'Límites departamentales', hint: 'DANE, MGN 2025' },
  { key: 'mun', label: 'Límites municipales', hint: 'Visibles al acercar' },
  { key: 'relieve', label: 'Relieve', hint: 'Requiere conexión' },
  { key: 'osm', label: 'Mapa de referencia', hint: 'OpenStreetMap; requiere conexión' },
]

export function LayerPanel({ showViz = true, children }: { showViz?: boolean; children?: ReactNode }) {
  const atlas = useApp((s) => s.atlas)
  const { setAtlas, toggleOverlay } = useApp.getState()
  const idx = useAsync(loadIndex, [])
  const official = idx.data?.official_layers
  return (
    <Popover label="Capas" icon={<Layers size={18} aria-hidden />} width={340}>
      <div className="stack">
        {showViz && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow" style={{ marginBottom: 6 }}>
              Representación de eventos
            </legend>
            <div className="grid c2" style={{ gap: 6 }}>
              {VIZ.map((v) => (
                <button key={v.value} type="button" className="chip" style={{ height: 'auto', minHeight: 44, padding: '6px 10px', borderRadius: 10, flexDirection: 'column', alignItems: 'flex-start', gap: 0, whiteSpace: 'normal', textAlign: 'left' }} aria-pressed={atlas.viz === v.value} onClick={() => setAtlas({ viz: v.value })}>
                  <span>{v.label}</span>
                  <span className="caption" style={{ fontWeight: 400 }}>
                    {v.hint}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {showViz && !['calor', 'densidad', 'h3', 'g50'].includes(atlas.viz) && (
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="eyebrow" style={{ marginBottom: 6 }}>
              Color de los eventos
            </legend>
            <div className="chips">
              {(['profundidad', 'magnitud', 'ninguno'] as ColorBy[]).map((c) => (
                <button key={c} type="button" className="chip" aria-pressed={atlas.colorBy === c} onClick={() => setAtlas({ colorBy: c })}>
                  {c === 'ninguno' ? 'Un solo color' : c[0].toUpperCase() + c.slice(1)}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {children}
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="eyebrow" style={{ marginBottom: 2 }}>
            Referencia
          </legend>
          {OVERLAYS.map((o) => (
            <label key={o.key} className="check">
              <input type="checkbox" checked={atlas.overlays.includes(o.key)} onChange={() => toggleOverlay(o.key)} />
              <span>
                {o.label}
                {o.hint && <span className="caption" style={{ display: 'block' }}>{o.hint}</span>}
              </span>
            </label>
          ))}
        </fieldset>
        <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="eyebrow" style={{ marginBottom: 2 }}>
            Productos oficiales (SGC)
          </legend>
          <label className="check">
            <input type="checkbox" checked={atlas.overlays.includes('amenaza')} disabled={!official?.hazard.available} onChange={() => toggleOverlay('amenaza')} />
            <span>
              Amenaza sísmica oficial
              <span className="caption" style={{ display: 'block' }}>PGA, periodo de retorno de 475 años. Requiere conexión.</span>
            </span>
          </label>
          <label className="check" style={{ opacity: 0.6 }}>
            <input type="checkbox" disabled checked={false} readOnly />
            <span>
              Fallas geológicas
              <span className="caption" style={{ display: 'block' }}>No disponible: {official?.faults.reason ?? 'sin fuente oficial confirmada.'}</span>
            </span>
          </label>
          <p className="caption" style={{ marginTop: 4 }}>
            La amenaza oficial es un producto del SGC para periodos de cientos de años. No debe confundirse con el pronóstico experimental de esta plataforma.
          </p>
        </fieldset>
      </div>
    </Popover>
  )
}

export function ExportMenu({ items }: { items: { label: string; hint?: string; run: () => void }[] }) {
  return (
    <Popover label="Exportar" icon={<Download size={18} aria-hidden />} width={300}>
      <div role="menu" aria-label="Exportar" style={{ margin: -8 }}>
        {items.map((i) => (
          <button key={i.label} type="button" role="menuitem" className="menu-item" style={{ height: 'auto', padding: '8px 12px' }} onClick={i.run}>
            <span>
              {i.label}
              {i.hint && <span className="caption" style={{ display: 'block' }}>{i.hint}</span>}
            </span>
          </button>
        ))}
      </div>
    </Popover>
  )
}

/** En teléfono la leyenda se pliega para no tapar el mapa; en pantallas amplias está siempre visible. */
function LegendShell({ children, minWidth }: { children: ReactNode; minWidth?: number }) {
  const narrow = useMedia('(max-width: 767px)')
  return (
    <div className="map-legend glass" role="region" aria-label="Leyenda del mapa" style={minWidth && !narrow ? { minWidth } : undefined}>
      {narrow ? (
        <details>
          <summary>
            Leyenda <ChevronDown size={16} aria-hidden />
          </summary>
          {children}
        </details>
      ) : (
        children
      )}
    </div>
  )
}

export function EventLegend({ viz, colorBy, extra }: { viz: Viz; colorBy: ColorBy; extra?: ReactNode }) {
  const heat = viz === 'calor' || viz === 'densidad'
  const official = useApp((s) => s.atlas.overlays.includes('amenaza'))
  return (
    <LegendShell>
      {heat ? (
        <>
          <h4>{viz === 'calor' ? 'Concentración ponderada por magnitud' : 'Densidad de eventos'}</h4>
          <div className="ramp" style={{ background: rampCss(viz === 'calor' ? 'inferno' : 'cividis') }} />
          <div className="ticks">
            <span>Menor</span>
            <span>Mayor</span>
          </div>
          <p className="caption" style={{ marginTop: 4 }}>Escala relativa a la vista actual.</p>
        </>
      ) : viz === 'h3' || viz === 'g50' ? (
        extra
      ) : (
        <>
          {colorBy === 'profundidad' && (
            <>
              <h4>Color: profundidad</h4>
              <div className="items">
                {DEPTH_CLASSES.map((c) => (
                  <span key={c.i}>
                    <i style={{ background: c.color }} />
                    {c.label}
                  </span>
                ))}
                <span>
                  <i style={{ background: NO_DATA_COLOR }} />
                  Sin dato
                </span>
              </div>
            </>
          )}
          {colorBy === 'magnitud' && (
            <>
              <h4>Color: magnitud</h4>
              <div className="ramp" style={{ background: rampCss('inferno') }} />
              <div className="ticks">
                <span>2,5</span>
                <span>4,5</span>
                <span>7,0</span>
              </div>
            </>
          )}
          {viz === 'columnas' ? (
            <p className="caption" style={{ marginTop: 6 }}>Altura de la columna = profundidad del evento (representación esquemática, hacia arriba). Ancho = magnitud.</p>
          ) : viz === 'grupos' ? (
            <p className="caption" style={{ marginTop: 6 }}>Círculos grandes de un solo color: grupos de eventos; su tamaño indica cuántos reúnen. Acerque el mapa para separarlos.</p>
          ) : (
            <div style={{ marginTop: 8 }}>
              <h4>Tamaño: magnitud</h4>
              <div className="row" style={{ alignItems: 'flex-end', gap: 10 }} aria-hidden>
                {[3, 4, 5, 6].map((m) => (
                  <span key={m} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <span style={{ width: 4 + (m - 2.5) ** 1.6 * 2.6, height: 4 + (m - 2.5) ** 1.6 * 2.6, borderRadius: '50%', border: '1.5px solid var(--text-2)' }} />
                    <span className="num">{m}</span>
                  </span>
                ))}
              </div>
            </div>
          )}
        </>
      )}
      {official && <p className="caption" style={{ marginTop: 8, borderTop: '1px solid var(--glass-border)', paddingTop: 6 }}>Fondo de color: amenaza sísmica oficial del SGC (PGA 475 años, de menor a mayor: verde a rojo). Producto oficial, distinto del pronóstico propio.</p>}
    </LegendShell>
  )
}

export function ZoneLegendBox({ legend, value, footer }: { legend: ZoneLegend; value?: number; footer?: ReactNode }) {
  return (
    <LegendShell minWidth={400}>
      <h4>{legend.title}</h4>
      {legend.kind === 'clases' ? (
        <ProbabilityScale value={value} />
      ) : (
        <>
          <div className="ramp" style={{ background: legend.ramp }} />
          <div className="ticks">
            <span>{legend.min}</span>
            {legend.mid && <span>{legend.mid}</span>}
            <span>{legend.max}</span>
          </div>
        </>
      )}
      {legend.note && <p className="caption" style={{ marginTop: 4 }}>{legend.note}</p>}
      {footer}
    </LegendShell>
  )
}
