// Prueba del sistema de diseño: todos los componentes base en un solo lugar para validarlos en claro y oscuro.
import { Compass, Download, Layers, LocateFixed, Minus, Mountain, Pause, Play, Plus, Search, SkipBack, SkipForward } from 'lucide-react'
import { useState } from 'react'
import { ChartFrame, XYChart } from '@/charts/Chart'
import { Logo, Trace } from '@/components/Logo'
import { Page, useTheme } from '@/components/Shell'
import { Button, Card, CardSkeleton, EmptyState, ErrorState, Field, Gate, IconButton, Kpis, Modal, Note, Pill, ProbabilityScale, ProbabilityValue, Segmented, Select, Sheet, Slider, Switch, Tabs, Tooltip } from '@/components/ui'
import { DataError, loadQuality, useAsync } from '@/lib/data'
import { fmtInt, fmtNum } from '@/lib/format'
import { contrast, DEPTH_CLASSES, rampCss, type RampName } from '@/lib/scales'
import { useApp } from '@/lib/store'

const SURFACES: [string, string][] = [
  ['--bg', 'Fondo general'],
  ['--surface', 'Superficie principal'],
  ['--surface-2', 'Superficie secundaria'],
  ['--surface-3', 'Superficie terciaria'],
  ['--text', 'Texto principal'],
  ['--text-2', 'Texto secundario'],
  ['--accent', 'Acento'],
  ['--caution', 'Precaución'],
  ['--critical', 'Crítico'],
  ['--positive', 'Positivo'],
]
const PAIRS: [string, string, string][] = [
  ['--text', '--bg', 'Texto principal sobre fondo'],
  ['--text', '--surface', 'Texto principal sobre superficie'],
  ['--text-2', '--surface', 'Texto secundario sobre superficie'],
  ['--text-2', '--surface-2', 'Texto secundario sobre superficie secundaria'],
  ['--text-3', '--surface', 'Texto terciario sobre superficie'],
  ['--accent-text', '--surface', 'Acento (texto) sobre superficie'],
  ['--text-on-accent', '--accent', 'Texto sobre acento'],
  ['--caution', '--surface', 'Precaución sobre superficie'],
  ['--critical', '--surface', 'Crítico sobre superficie'],
]

function toHex(css: string): string {
  const c = document.createElement('canvas').getContext('2d')
  if (!c) return '#000000'
  c.fillStyle = css
  return c.fillStyle as string
}
function Tokens() {
  useTheme() // vuelve a leer los valores al cambiar de tema
  const cs = getComputedStyle(document.documentElement)
  const val = (v: string) => cs.getPropertyValue(v).trim()
  return (
    <div className="grid c2">
      <div>
        <ul className="grid" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 10 }}>
          {SURFACES.map(([v, name]) => (
            <li key={v} className="small">
              <div style={{ height: 44, borderRadius: 10, background: `var(${v})`, border: '1px solid var(--border-strong)' }} />
              <div style={{ fontWeight: 600, marginTop: 4 }}>{name}</div>
              <code className="caption">{val(v)}</code>
            </li>
          ))}
        </ul>
      </div>
      <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ maxHeight: 'none' }}>
        <table className="table">
          <caption>Contraste medido en el tema actual (WCAG 2.2 AA exige 4,5:1 en texto normal)</caption>
          <thead>
            <tr>
              <th scope="col">Combinación</th>
              <th scope="col" className="r">
                Contraste
              </th>
              <th scope="col">Resultado</th>
            </tr>
          </thead>
          <tbody>
            {PAIRS.map(([fg, bg, name]) => {
              const r = contrast(toHex(val(fg)), toHex(val(bg)))
              return (
                <tr key={name}>
                  <th scope="row" style={{ whiteSpace: 'normal' }}>
                    {name}
                  </th>
                  <td className="r">{fmtNum(r, 2)}:1</td>
                  <td>{r >= 4.5 ? 'Cumple AA' : r >= 3 ? 'Solo texto grande' : 'No cumple'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default function DesignTest() {
  const [seg, setSeg] = useState(30)
  const [tab, setTab] = useState('a')
  const [sw, setSw] = useState(true)
  const [sl, setSl] = useState(4)
  const [sel, setSel] = useState('g50')
  const [modal, setModal] = useState(false)
  const [sheet, setSheet] = useState(false)
  const [name, setName] = useState('')
  const [playing, setPlaying] = useState(false)
  const toast = useApp((s) => s.toast)
  const quality = useAsync(loadQuality, [])
  const theme = useTheme()
  const setPrefs = useApp((s) => s.setPrefs)

  return (
    <Page
      eyebrow="Fase 2"
      title="Sistema de diseño"
      lead="Prueba de todos los componentes base. Sirve para validar jerarquía, contraste y estados en modo claro y oscuro antes de construir las vistas."
      actions={<Segmented label="Tema" value={theme} onChange={(v) => setPrefs({ theme: v })} options={[{ value: 'claro', label: 'Claro' }, { value: 'oscuro', label: 'Oscuro' }]} />}
    >
      <div className="stack loose">
        <Card title="Identidad" subtitle="Logotipo original en 24, 48 y 200 px; en dos tonos y en una sola tinta.">
          <div className="row wrap" style={{ gap: 32, alignItems: 'flex-end' }}>
            {[24, 48, 200].map((s) => (
              <div key={s} className="stack tight" style={{ alignItems: 'center', color: 'var(--text)', ['--logo-wave' as string]: 'var(--accent)' }}>
                <Logo size={s} />
                <span className="caption">{s} px</span>
              </div>
            ))}
            <div className="stack tight" style={{ alignItems: 'center' }}>
              <Logo size={96} />
              <span className="caption">Una tinta</span>
            </div>
            <div className="stack tight" style={{ alignItems: 'center', background: theme === 'oscuro' ? '#f4f5f3' : '#0e1113', color: theme === 'oscuro' ? '#1b1f23' : '#f3f1ec', padding: 16, borderRadius: 14 }}>
              <Logo size={96} />
              <span style={{ fontSize: 12 }}>Fondo inverso</span>
            </div>
            <div className="stack tight" style={{ color: 'var(--accent-text)' }}>
              <Trace width={220} height={40} opacity={0.9} />
              <span className="caption">Traza sísmica: firma visual (estática)</span>
            </div>
          </div>
        </Card>

        <Card title="Paleta y contraste" subtitle="Pocos colores de interfaz; el color se reserva para los datos.">
          <Tokens />
        </Card>

        <Card title="Tipografía" subtitle="Fuente del sistema. Cuerpo de 16 px, mínimo de 12 px, cifras tabulares.">
          <div className="stack tight">
            <div style={{ fontSize: 'var(--fs-36)', fontWeight: 660, letterSpacing: '-0.03em', lineHeight: 1.1 }}>Colombia se mueve · 36</div>
            <h1>Título de página · 28</h1>
            <h2>Título de sección · 22</h2>
            <h3>Título de tarjeta · 18</h3>
            <p>Cuerpo · 16. La probabilidad de registrar al menos un evento de magnitud 4,0 o superior en los próximos 30 días.</p>
            <p className="small muted">Secundario · 14. Catálogo instrumental de la Red Sismológica Nacional de Colombia.</p>
            <p className="caption">Leyenda · 12. Fuente: Servicio Geológico Colombiano.</p>
            <p className="num">Cifras tabulares: 1.234.567 · 0,0457 · 12,5 % · 2026-10-10</p>
          </div>
        </Card>

        <div className="grid c2">
          <Card title="Botones">
            <div className="stack">
              <div className="row wrap">
                <Button variant="primary">Explorar el atlas</Button>
                <Button>Secundario</Button>
                <Button variant="outline">Contorno</Button>
                <Button variant="ghost">Discreto</Button>
                <Button disabled>Deshabilitado</Button>
              </div>
              <div className="row wrap">
                <Button size="sm" icon={<Download size={16} aria-hidden />}>
                  Exportar
                </Button>
                <IconButton label="Buscar">
                  <Search size={20} aria-hidden />
                </IconButton>
                <IconButton label="Capas" variant="default" aria-pressed>
                  <Layers size={20} aria-hidden />
                </IconButton>
                <Tooltip text="Los tooltips aparecen al pasar el cursor y al enfocar con el teclado; Esc los cierra.">
                  <Button variant="outline">Con tooltip</Button>
                </Tooltip>
                <Button onClick={() => toast('Filtro aplicado: magnitud ≥ 4,0.', { label: 'Deshacer', run: () => undefined })}>Mostrar aviso</Button>
              </div>
            </div>
          </Card>
          <Card title="Campos">
            <div className="grid c2">
              <Field label="Nombre de la vista" hint="Se guarda solo durante esta sesión." error={name.length > 40 ? 'Use 40 caracteres o menos.' : undefined}>
                {(p) => <input {...p} className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Nido de Bucaramanga" />}
              </Field>
              <Select label="Unidad de análisis" value={sel} onChange={setSel} options={[{ value: 'dep', label: 'Departamento' }, { value: 'g50', label: 'Cuadrícula ≈ 50 km' }, { value: 'h3', label: 'Celda H3' }]} />
              <Slider label="Umbral de magnitud" value={sl} min={2.5} max={6} step={0.1} onChange={setSl} format={(v) => `M ≥ ${fmtNum(v, 1)}`} warn={sl > 5.5 ? 'Muy pocos eventos superan este umbral: el intervalo será muy ancho.' : undefined} />
              <div className="stack tight">
                <Segmented label="Horizonte" hideLabel={false} value={seg} onChange={setSeg} options={[{ value: 7, label: '7 días' }, { value: 30, label: '30 días' }, { value: 90, label: '90 días' }]} />
                <Switch label="Solo localizaciones de calidad A y B" checked={sw} onChange={setSw} />
              </div>
            </div>
          </Card>
        </div>

        <Card title="Escala probabilística" subtitle="La probabilidad se comunica a la vez con color, patrón, etiqueta, porcentaje e intervalo de incertidumbre.">
          <div className="grid c2">
            <div className="stack">
              <ProbabilityScale value={0.22} />
              <ProbabilityValue p={0.22} lo={0.14} hi={0.31} />
            </div>
            <div className="stack tight">
              {(['viridis', 'cividis', 'inferno', 'diverging'] as RampName[]).map((r) => (
                <div key={r} className="row small">
                  <span style={{ width: 150 }}>{r === 'diverging' ? 'Divergente (solo diferencias)' : r[0].toUpperCase() + r.slice(1)}</span>
                  <span className="grow" style={{ height: 14, borderRadius: 4, background: rampCss(r), border: '1px solid var(--border)' }} />
                </div>
              ))}
              <div className="row wrap small" style={{ marginTop: 8 }}>
                {DEPTH_CLASSES.map((c) => (
                  <span key={c.i} className="chip">
                    <i style={{ width: 12, height: 12, borderRadius: '50%', background: c.color, border: '1px solid var(--border-strong)' }} />
                    {c.label}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </Card>

        <div className="grid c2">
          <Card title="Tarjetas e indicadores">
            <div className="stack">
              <Gate of={[quality] as const} fallback={<CardSkeleton chart={60} />}>
                {(q) => (
                  <Kpis
                    label="Indicadores del catálogo"
                    items={[
                      { label: 'Registros', value: fmtInt(q.totals.records), sub: 'catálogo limpio' },
                      { label: 'Descartados', value: fmtInt(q.totals.records_dropped), sub: 'duplicados' },
                      { label: 'Revisados', value: `${fmtNum(q.totals.reviewed_share * 100, 1)} %`, sub: 'por analista del SGC' },
                    ]}
                  />
                )}
              </Gate>
              <div className="row wrap">
                <Pill>Neutro</Pill>
                <Pill tone="accent">Calibrado</Pill>
                <Pill tone="caution">Calibración parcial</Pill>
                <Pill tone="critical">Falla</Pill>
                <span className="demo-tag">Modo demostración</span>
              </div>
              <Note tone="caution">Una probabilidad alta no significa que un terremoto ocurrirá con certeza. Una probabilidad baja tampoco significa ausencia total de actividad.</Note>
              <Note tone="accent">Nota informativa con el color de acento.</Note>
            </div>
          </Card>
          <Card title="Gráficos" subtitle="Con resumen textual, tabla alternativa y exportación.">
            <Gate of={[quality] as const} fallback={<CardSkeleton />}>
              {(q) => (
                <ChartFrame
                  title="Eventos registrados por año"
                  summary={`Conteo anual de eventos con magnitud 2,5 o superior entre ${q.by_year[0].year} y ${q.by_year[q.by_year.length - 1].year}. El máximo fue ${fmtInt(Math.max(...q.by_year.map((y) => y.n)))} eventos en un año.`}
                  table={{ columns: ['Año', 'Eventos', 'Eventos M ≥ 4'], rows: q.by_year.map((y) => [y.year, y.n, y.m4]) }}
                  legend={[{ label: 'Todos (M ≥ 2,5)', color: 'var(--s1)', shape: 'box' }, { label: 'M ≥ 4,0', color: 'var(--s2)' }]}
                >
                  {(w) => (
                    <XYChart
                      width={w}
                      height={220}
                      x={{ format: (v) => String(v) }}
                      y={{ label: 'Eventos' }}
                      series={[
                        { key: 'n', label: 'Todos', color: 'var(--s1)', type: 'bar', data: q.by_year.map((y) => [y.year, y.n]) },
                        { key: 'm4', label: 'M ≥ 4,0', color: 'var(--s2)', type: 'line', data: q.by_year.map((y) => [y.year, y.m4]) },
                      ]}
                    />
                  )}
                </ChartFrame>
              )}
            </Gate>
          </Card>
        </div>

        <Card title="Navegación y pestañas">
          <Tabs label="Ejemplo de pestañas" value={tab} onChange={setTab} tabs={[{ value: 'a', label: 'Resumen' }, { value: 'b', label: 'Calibración' }, { value: 'c', label: 'Validación' }]} />
          <p className="small muted">La barra lateral, la barra superior de vidrio y la navegación inferior del teléfono son las de esta misma página.</p>
        </Card>

        <Card title="Paneles flotantes y controles del mapa" subtitle="El vidrio se usa solo sobre el mapa, en la barra superior y en hojas y ventanas.">
          <div style={{ position: 'relative', height: 300, borderRadius: 14, overflow: 'hidden', background: 'var(--map-water)', border: '1px solid var(--border)' }}>
            <svg width="100%" height="100%" viewBox="0 0 600 300" preserveAspectRatio="xMidYMid slice" aria-hidden>
              <path d="M250 20 290 34 268 70 290 110 370 116 396 146 386 196 348 204 356 240 340 300 240 300 214 250 170 238 110 220 86 190 118 152 104 100 120 72 170 50Z" fill="var(--map-land-co)" stroke="var(--map-line)" />
              {[[200, 150, 9], [240, 120, 5], [300, 170, 14], [180, 200, 6], [330, 140, 4], [260, 210, 7]].map(([x, y, r], i) => (
                <circle key={i} cx={x} cy={y} r={r} fill={DEPTH_CLASSES[i % 5].color} stroke="var(--surface)" strokeWidth={1} opacity={0.9} />
              ))}
            </svg>
            <div className="map-ctrl tr">
              <div className="ctrl-group glass">
                <button type="button" aria-label="Acercar">
                  <Plus size={20} aria-hidden />
                </button>
                <button type="button" aria-label="Alejar">
                  <Minus size={20} aria-hidden />
                </button>
              </div>
              <div className="ctrl-group glass">
                <button type="button" aria-label="Extensión nacional">
                  <LocateFixed size={20} aria-hidden />
                </button>
                <button type="button" aria-label="Orientar al norte">
                  <Compass size={20} aria-hidden />
                </button>
                <button type="button" aria-label="Vista inclinada" aria-pressed>
                  <Mountain size={20} aria-hidden />
                </button>
              </div>
            </div>
            <div className="map-ctrl bl">
              <div className="map-legend glass">
                <h4>Profundidad</h4>
                <div className="items">
                  {DEPTH_CLASSES.slice(0, 3).map((c) => (
                    <span key={c.i}>
                      <i style={{ background: c.color }} />
                      {c.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
            <div className="glass" style={{ position: 'absolute', left: 12, right: 76, top: 12, maxWidth: 340, borderRadius: 16, padding: '10px 14px' }}>
              <div className="row between">
                <div className="row">
                  <IconButton label="Retroceder" size="sm">
                    <SkipBack size={16} aria-hidden />
                  </IconButton>
                  <IconButton label={playing ? 'Pausar' : 'Reproducir'} size="sm" variant="primary" onClick={() => setPlaying((v) => !v)}>
                    {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
                  </IconButton>
                  <IconButton label="Adelantar" size="sm">
                    <SkipForward size={16} aria-hidden />
                  </IconButton>
                </div>
                <span className="small num" style={{ fontWeight: 600 }}>
                  mar 2023
                </span>
              </div>
            </div>
          </div>
          <div className="row wrap" style={{ marginTop: 16 }}>
            <Button onClick={() => setModal(true)}>Abrir ventana modal</Button>
            <Button onClick={() => setSheet(true)}>Abrir hoja lateral</Button>
          </div>
        </Card>

        <Card title="Estados" subtitle="Carga, error, ausencia de datos y conexión interrumpida.">
          <div className="grid c2">
            <div>
              <div className="eyebrow">Carga (esqueleto que imita el contenido)</div>
              <div data-demo>
                <CardSkeleton chart={120} />
              </div>
            </div>
            <div className="card flat">
              <EmptyState title="Ningún evento cumple los filtros">Amplíe el rango de fechas o reduzca la magnitud mínima.</EmptyState>
            </div>
            <div className="card flat">
              <ErrorState error={new DataError('El archivo de datos «fc/g50-30-40.json» no está disponible (HTTP 404).', 'no-encontrado')} retry={() => toast('Reintentando…')} />
            </div>
            <div className="card flat">
              <ErrorState error={new DataError('No hay conexión con el servidor de datos.', 'red')} retry={() => toast('Reintentando…')} />
            </div>
          </div>
        </Card>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="¿Por qué el modelo muestra este valor?" footer={<Button variant="primary" onClick={() => setModal(false)}>Entendido</Button>}>
        <p>Las ventanas modales usan vidrio, atrapan el foco, se cierran con Esc y devuelven el foco al control que las abrió. En teléfono se presentan como hoja inferior.</p>
      </Modal>
      <Sheet open={sheet} onClose={() => setSheet(false)} title="Hoja lateral">
        <p>En escritorio entra desde la derecha; en teléfono sube desde abajo con física de resorte y puede arrastrarse para cerrarla.</p>
      </Sheet>
    </Page>
  )
}
