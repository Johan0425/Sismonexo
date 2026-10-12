// Portada narrativa: Colombia con puntos sísmicos reales y un recorrido de siete pasos al desplazarse.
import { ArrowRight, BookOpen, CircleCheck } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChartFrame, ProvenanceContext, XYChart } from '@/charts/Chart'
import { useNames } from '@/components/Inspectors'
import { Trace } from '@/components/Logo'
import { Gate, Kpis, Note, ProbabilityScale, Skeleton, Slider, useMotionOk, useWidth } from '@/components/ui'
import { forecastId, loadCsi, loadEvents, loadForecast, loadGeo, loadIndex, useAsync, type CsiData, type Events, type ForecastFile, type GeoFC, type IndexData } from '@/lib/data'
import { DISCLAIMER, provenance } from '@/lib/export'
import { fmtCoord, fmtDate, fmtDateTime, fmtInt, fmtMag, fmtNum, fmtPct } from '@/lib/format'
import { placeName } from '@/lib/geo'
import { depthClass, DEPTH_CLASSES, NO_DATA_COLOR } from '@/lib/scales'
import { useApp } from '@/lib/store'
import { CERTAINTY_NOTE } from './Forecast'

const VB = { x0: -82.5, x1: -66.3, y0: -4.8, y1: 13.8 }
const W = 520
const H = (W * (VB.y1 - VB.y0)) / (VB.x1 - VB.x0)
const px = (lon: number) => ((lon - VB.x0) / (VB.x1 - VB.x0)) * W
const py = (lat: number) => ((VB.y1 - lat) / (VB.y1 - VB.y0)) * H

function outline(fc: GeoFC): string {
  return fc.features
    .map((f) =>
      (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates)
        .map((poly) => poly[0].filter((_, k) => k % 2 === 0).map(([x, y], k) => `${k ? 'L' : 'M'}${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join('') + 'Z')
        .join(''),
    )
    .join('')
}

function HeroMap({ ev, geo }: { ev: Events; geo: GeoFC }) {
  const ok = useMotionOk()
  const path = useMemo(() => outline(geo), [geo])
  // Eventos reales de magnitud 4,0 o superior; aparecen en orden cronológico una sola vez.
  const pts = useMemo(() => {
    const out: { x: number; y: number; r: number; c: string; d: number }[] = []
    const idx: number[] = []
    for (let i = 0; i < ev.n; i++) if (ev.mag[i] >= 4) idx.push(i)
    idx.forEach((i, k) => out.push({ x: px(ev.lon[i]), y: py(ev.lat[i]), r: 1.2 + (ev.mag[i] - 4) ** 1.5 * 2.4, c: depthClass(ev.depth[i])?.color ?? NO_DATA_COLOR, d: (k / idx.length) * 2.4 }))
    return out
  }, [ev])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" style={{ maxHeight: 'min(72dvh, 640px)' }} role="img" aria-label={`Mapa esquemático de Colombia con ${fmtInt(pts.length)} eventos reales de magnitud 4,0 o superior registrados entre 1993 y 2026. El color indica la profundidad.`}>
      <g stroke="var(--map-graticule)" strokeWidth={1}>
        {[-80, -76, -72, -68].map((l) => <line key={l} x1={px(l)} x2={px(l)} y1={0} y2={H} />)}
        {[-4, 0, 4, 8, 12].map((l) => <line key={l} x1={0} x2={W} y1={py(l)} y2={py(l)} />)}
      </g>
      <path d={path} fill="var(--map-land-co)" stroke="var(--map-line-soft)" strokeWidth={0.6} />
      <g>
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r={p.r} fill={p.c} stroke="var(--surface)" strokeWidth={0.4} opacity={0.82} style={ok ? { animation: `home-pop 500ms var(--ease-out) ${p.d.toFixed(2)}s both` } : undefined} />
        ))}
      </g>
    </svg>
  )
}

function Step({ n, title, children, visual }: { n: number; title: string; children: ReactNode; visual: ReactNode }) {
  const ok = useMotionOk()
  return (
    <motion.section className="home-step" aria-labelledby={`paso-${n}`} initial={ok ? { opacity: 0, y: 28 } : false} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-12% 0px' }} transition={{ duration: 0.42, ease: [0.2, 0, 0, 1] }}>
      <div>
        <div className="eyebrow num" style={{ color: 'var(--accent-text)' }}>Paso {n} de 7</div>
        <h2 id={`paso-${n}`} style={{ margin: '6px 0 12px' }}>{title}</h2>
        <div className="prose">{children}</div>
      </div>
      <div className="card" style={{ minWidth: 0 }}>{visual}</div>
    </motion.section>
  )
}

export default function Home() {
  const index = useAsync(loadIndex, [])
  const ev = useAsync(loadEvents, [])
  const geo = useAsync(() => loadGeo('dep'), [])
  const csi = useAsync(loadCsi, [])
  const fc = useAsync(() => loadForecast(forecastId('g50', 30, 4)), [])
  const setOpen = useApp((s) => s.setOpen)
  useEffect(() => {
    document.title = 'SismoNexo Colombia · Atlas de actividad sísmica y pronóstico probabilístico'
    // El recorrido inicial se ofrece una vez por sesión, solo al entrar por la portada sin parámetros.
    const w = window as unknown as { __sn_intro?: boolean }
    if (!w.__sn_intro && !window.location.hash.includes('?') && !navigator.webdriver) {
      w.__sn_intro = true
      const t = setTimeout(() => setOpen('onboarding', true), 1400)
      return () => clearTimeout(t)
    }
  }, [setOpen])
  return (
    <div className="home">
      <style>{`
        .home { max-width: 1240px; margin: 0 auto; padding: 0 var(--pad) var(--sp-16); }
        .home-hero { display: grid; grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr); gap: var(--sp-8); align-items: center; min-height: min(86dvh, 760px); padding: var(--sp-8) 0; }
        .home-hero h1 { font-size: clamp(2rem, 4.6vw, 3.4rem); line-height: 1.04; letter-spacing: -0.035em; font-weight: 680; text-wrap: balance; }
        .home-hero .lead { font-size: var(--fs-18); color: var(--text-2); max-width: 46ch; margin: var(--sp-5) 0 var(--sp-6); }
        .home-step { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: var(--sp-8); align-items: center; padding: var(--sp-12) 0; border-top: 1px solid var(--border); }
        .home-step:nth-of-type(even) > :first-child { order: 2; }
        @keyframes home-pop { from { opacity: 0; transform: scale(0.2); } to { opacity: 0.82; transform: scale(1); } }
        .home svg circle { transform-box: fill-box; transform-origin: center; }
        @keyframes home-draw { from { stroke-dashoffset: 900; } to { stroke-dashoffset: 0; } }
        .home-trace path { stroke-dasharray: 900; animation: home-draw 1.8s var(--ease-out) 0.3s both; }
        @media (max-width: 900px) { .home-hero, .home-step { grid-template-columns: minmax(0, 1fr); } .home-step:nth-of-type(even) > :first-child { order: 0; } .home-hero { min-height: 0; } .home-step { padding: var(--sp-8) 0; } }
      `}</style>
      <header className="home-hero">
        <div>
          <div className="home-trace" style={{ color: 'var(--accent-text)', marginBottom: 16 }}>
            <Trace width={200} height={36} opacity={0.9} />
          </div>
          <h1>Colombia se mueve. Los datos nos ayudan a comprender cómo.</h1>
          <p className="lead">
            Un atlas de la actividad sísmica registrada desde 1993 y un pronóstico <b>probabilístico</b>: para cada zona, qué tan probable es registrar al menos un sismo sobre cierta magnitud en los próximos 30 días, con su incertidumbre. No predice sismos individuales.
          </p>
          <div className="row wrap">
            <Link className="btn" data-variant="primary" to="/atlas">
              Explorar el atlas <ArrowRight size={18} aria-hidden />
            </Link>
            <Link className="btn" data-variant="outline" to="/metodologia">
              <BookOpen size={18} aria-hidden /> Conocer la metodología
            </Link>
          </div>
          <p className="caption row" style={{ marginTop: 20 }}>
            <CircleCheck size={14} aria-hidden style={{ color: 'var(--positive)' }} />
            {index.data ? `Última actualización del catálogo: ${fmtDate(index.data.coverage[1])} · ${fmtInt(index.data.records)} eventos reales del Servicio Geológico Colombiano` : 'Cargando la fecha de actualización…'}
          </p>
        </div>
        <div>
          <Gate of={[ev, geo] as const} fallback={<Skeleton h={480} r={16} />}>
            {(e, g) => <HeroMap ev={e} geo={g} />}
          </Gate>
          <div className="legend" style={{ justifyContent: 'center' }}>
            {DEPTH_CLASSES.map((c) => (
              <span key={c.i}><i data-shape="dot" style={{ background: c.color }} />{c.label}</span>
            ))}
          </div>
          <p className="caption" style={{ textAlign: 'center', marginTop: 4 }}>Eventos reales de magnitud 4,0 o superior, 1993–2026. Tamaño según magnitud. Fuente: SGC–RSNC.</p>
        </div>
      </header>

      <Gate of={[index, ev, csi, fc] as const}>{(i, e, c, f) => <Story index={i} ev={e} csi={c} fc={f} />}</Gate>
    </div>
  )
}

function Story({ index, ev, csi, fc }: { index: IndexData; ev: Events; csi: CsiData; fc: ForecastFile }) {
  const names = useNames()
  const tz = useApp((s) => s.prefs.tz)
  const [rate, setRate] = useState(0.3)
  const big = useMemo(() => csi.year.map((y, i) => ({ y, m: csi.mag[i] })).filter((d) => d.m >= 6), [csi])
  const sample = useMemo(() => {
    let best = -1
    const cut = ev.t[ev.n - 1] - 3 * 365.25 * 86400
    for (let i = ev.n - 1; i >= 0 && ev.t[i] >= cut; i--) if (ev.dep[i] >= 0 && (best < 0 || ev.mag[i] > ev.mag[best])) best = i
    return best
  }, [ev])
  const best = fc.models[fc.selected_model]
  const base = fc.models.base
  const [ref, w] = useWidth<HTMLDivElement>(480)
  const fold = fc.folds[fc.folds.length - 1]
  const t0 = Date.parse(fc.folds[0].train[0])
  const t1 = Date.parse(fold.test[1])
  const fx = (iso: string) => ((Date.parse(iso) - t0) / (t1 - t0)) * (w - 8)
  return (
    <ProvenanceContext.Provider value={(t) => provenance(index, t)}>
      <Step
        n={1}
        title="Historia sísmica de Colombia"
        visual={
          <ChartFrame title="Sismos de magnitud 6,0 o superior, 1610–2020" summary={`${fmtInt(big.length)} eventos de magnitud Mw 6,0 o superior en el Catálogo Sísmico Integrado del SGC. Antes del siglo XX solo se conocen los grandes sismos documentados en fuentes históricas; la mayor densidad reciente refleja mejor registro, no necesariamente más sismos.`} table={{ columns: ['Año', 'Magnitud Mw'], rows: big.map((d) => [d.y, d.m]) }} note="Fuente: Catálogo Sísmico Integrado (SGC). Contexto histórico; no alimenta los modelos.">
            {(cw) => <XYChart width={cw} height={250} x={{ format: String, label: 'Año' }} y={{ label: 'Magnitud Mw', domain: [5.8, 9], format: (v) => fmtNum(v, 1) }} series={[{ key: 'm', label: 'Magnitud', color: 'var(--s1)', type: 'points', r: 3.2, data: big.map((d) => [d.y, d.m]) }]} />}
          </ChartFrame>
        }
      >
        <p>Colombia está en el encuentro de las placas de Nazca, Caribe y Suramérica. Por eso tiembla con frecuencia, a profundidades muy distintas: desde la corteza hasta más de 150 km bajo Santander.</p>
        <p>Los registros históricos se remontan a 1610. El catálogo instrumental moderno, con el que trabaja esta plataforma, comienza en junio de 1993 con la Red Sismológica Nacional.</p>
      </Step>

      <Step
        n={2}
        title="Cómo se convierten los eventos en datos"
        visual={
          sample >= 0 ? (
            <div>
              <div className="eyebrow">Un registro real del catálogo</div>
              <div className="pvalue" style={{ margin: '8px 0 12px' }}>
                <span className="big">M {fmtMag(ev.mag[sample])}</span>
                <span className="muted">{placeName(ev, sample, names.mun, names.dep)}</span>
              </div>
              <dl className="deflist">
                <dt>Fecha y hora</dt><dd>{fmtDateTime(ev.t[sample], tz)}</dd>
                <dt>Coordenadas</dt><dd>{fmtCoord(ev.lat[sample], ev.lon[sample])}</dd>
                <dt>Profundidad</dt><dd>{fmtNum(ev.depth[sample], 1)} km</dd>
                <dt>Tipo de magnitud</dt><dd>{ev.mtNames[ev.mt[sample]]}</dd>
                <dt>Error de localización</dt><dd>± {fmtNum(ev.err[sample], 1)} km</dd>
                <dt>Calidad derivada</dt><dd>{ev.qNames[ev.q[sample]]}</dd>
              </dl>
              <p className="caption" style={{ marginTop: 10 }}>El evento de mayor magnitud dentro de un departamento en los últimos tres años del catálogo.</p>
            </div>
          ) : null
        }
      >
        <p>Cada sismo detectado se convierte en una fila: cuándo ocurrió, dónde, a qué profundidad, con qué magnitud y con cuánta incertidumbre se localizó.</p>
        <p>Antes de usarlas, las {fmtInt(index.records)} filas pasan por {index.audit.length} reglas de calidad documentadas: se eliminan duplicados, se marcan profundidades convencionales y nada se imputa en silencio.</p>
        <p><Link to="/calidad">Ver el centro de calidad del catálogo</Link></p>
      </Step>

      <Step
        n={3}
        title="Cómo se agrupan por zona y periodo"
        visual={
          <div>
            <Kpis label="Unidades de análisis" items={Object.entries(index.units).map(([, u]) => ({ label: u.label, value: fmtInt(u.n_zones), sub: u.resolution }))} />
            <p className="caption" style={{ marginTop: 10 }}>Cinco formas de dividir el territorio. Para la cuadrícula de 50 km y periodos de 30 días, la tabla de modelado tiene {fmtInt(fc.config.n_rows)} filas zona-periodo; solo {fmtPct(fc.config.prevalence)} registró un evento de magnitud 4,0 o superior.</p>
          </div>
        }
      >
        <p>Un sismo aislado no se puede anticipar. Lo que sí se puede medir es con qué frecuencia una <b>zona</b> registra actividad en un <b>periodo</b>.</p>
        <p>Por eso el catálogo se reorganiza en zonas-periodo: cada zona, en cada fecha, descrita solo con lo que ya había ocurrido (cuántos eventos recientes, de qué tamaño, hace cuánto), y con una etiqueta: ¿hubo al menos un evento sobre el umbral en los 30 días siguientes?</p>
      </Step>

      <Step
        n={4}
        title="Cómo se calcula una probabilidad"
        visual={
          <div className="stack">
            <span className="demo-tag" style={{ alignSelf: 'flex-start' }}>Ilustración interactiva</span>
            <Slider label="Tasa esperada de eventos en 30 días (λ)" value={rate} min={0.01} max={3} step={0.01} onChange={setRate} format={(v) => fmtNum(v, 2)} hint="Mueva la tasa: no es un dato de ninguna zona, solo ilustra la fórmula." />
            <div className="pvalue">
              <span className="big num">{fmtPct(1 - Math.exp(-rate))}</span>
              <span className="muted">= 1 − e<sup>−λ</sup></span>
            </div>
            <ProbabilityScale value={1 - Math.exp(-rate)} />
            <p className="caption">Con una tasa de {fmtNum(rate, 2)} eventos por periodo, la probabilidad de registrar al menos uno es {fmtPct(1 - Math.exp(-rate))}. Aunque la tasa crezca, la probabilidad se acerca a 100 % sin alcanzarlo.</p>
          </div>
        }
      >
        <p>El punto de partida es simple: si una zona ha tenido, en promedio, cierta tasa de eventos por periodo, la probabilidad de ver al menos uno se obtiene de esa tasa. Esa es la <b>línea base</b>.</p>
        <p>Los demás modelos intentan mejorar la tasa usando la actividad reciente, el entorno y la profundidad. Todos se comparan contra la línea base; si no la superan con claridad, no se usan.</p>
      </Step>

      <Step
        n={5}
        title="Cómo se valida un modelo sin mirar el futuro"
        visual={
          <div ref={ref}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Partición real del último bloque de validación</div>
            <svg width={w} height={74} role="img" aria-label={`Entrenamiento del ${fmtDate(fold.train[0])} al ${fmtDate(fold.train[1])}, validación del ${fmtDate(fold.val[0])} al ${fmtDate(fold.val[1])} y prueba del ${fmtDate(fold.test[0])} al ${fmtDate(fold.test[1])}.`}>
              <rect x={fx(fold.train[0])} width={fx(fold.train[1]) - fx(fold.train[0])} y={8} height={26} rx={5} fill="var(--s6)" />
              <rect x={fx(fold.val[0])} width={fx(fold.val[1]) - fx(fold.val[0])} y={8} height={26} rx={5} fill="var(--s2)" />
              <rect x={fx(fold.test[0])} width={Math.max(6, fx(fold.test[1]) - fx(fold.test[0]))} y={8} height={26} rx={5} fill="var(--s1)" />
              <text x={0} y={54} style={{ fontSize: 12, fill: 'var(--text-2)' }}>{fold.train[0].slice(0, 4)}</text>
              <text x={w - 8} y={54} textAnchor="end" style={{ fontSize: 12, fill: 'var(--text-2)' }}>{fold.test[1].slice(0, 4)}</text>
              <text x={fx(fold.train[0]) + 8} y={26} style={{ fontSize: 12, fill: '#fff', fontWeight: 600 }}>Entrenamiento</text>
            </svg>
            <div className="legend">
              <span><i data-shape="box" style={{ background: 'var(--s6)' }} />Entrenamiento (pasado)</span>
              <span><i data-shape="box" style={{ background: 'var(--s2)' }} />Validación</span>
              <span><i data-shape="box" style={{ background: 'var(--s1)' }} />Prueba (lo más reciente)</span>
            </div>
            <p className="caption" style={{ marginTop: 10 }}>Así se repite en {fc.folds.length} bloques que avanzan año a año, con una separación de {fold.gap_days} días entre conjuntos. Resultado en la cuadrícula de 50 km: PR-AUC de {fmtNum(best?.walk_forward.pr_auc ?? NaN, 2)} con {best?.name.toLowerCase()}, frente a {fmtNum(base?.walk_forward.pr_auc ?? NaN, 2)} de la línea base.</p>
          </div>
        }
      >
        <p>Evaluar un pronóstico con datos mezclados al azar sería hacer trampa: el modelo vería réplicas de la misma secuencia en el entrenamiento y en la prueba.</p>
        <p>Aquí el tiempo se respeta siempre. Se entrena con el pasado, se calibra con los años siguientes y se prueba con un periodo posterior que el modelo nunca vio. Un detector automático busca fugas de información.</p>
        <p><Link to="/modelos">Ver la comparación de modelos</Link></p>
      </Step>

      <Step
        n={6}
        title="Cómo debe interpretarse el resultado"
        visual={
          <div className="stack">
            <ProbabilityScale />
            <Note tone="caution">{CERTAINTY_NOTE}</Note>
            <p className="small">Cada valor del mapa se comunica de cinco maneras a la vez: color, patrón, etiqueta, porcentaje e intervalo de incertidumbre. Así no depende solo del color.</p>
          </div>
        }
      >
        <p>Una probabilidad de 20 % significa que, de cada 100 zonas-periodo parecidas en el pasado, cerca de 20 registraron un evento. No dice cuáles ni cuándo.</p>
        <p>La estimación habla de <b>actividad</b>. No habla de daños: el riesgo depende además de quién y qué está expuesto y de cómo está construido.</p>
        <p><Link to="/pronostico">Abrir el pronóstico probabilístico</Link></p>
      </Step>

      <Step
        n={7}
        title="Limitaciones y uso responsable"
        visual={
          <div className="stack">
            <Note tone="caution"><b>Advertencia.</b> {DISCLAIMER}</Note>
            <p className="small">
              Fuente oficial de información sísmica: <a href="https://www2.sgc.gov.co/Paginas/aplicaciones-sismos.aspx" target="_blank" rel="noreferrer noopener">Servicio Geológico Colombiano<span className="sr-only"> (se abre en una pestaña nueva)</span></a>. Gestión del riesgo: <a href="https://portal.gestiondelriesgo.gov.co/" target="_blank" rel="noreferrer noopener">UNGRD<span className="sr-only"> (se abre en una pestaña nueva)</span></a>.
            </p>
          </div>
        }
      >
        <ul>
          <li>Ningún método conocido predice la fecha, el lugar y la magnitud de un terremoto.</li>
          <li>Los eventos grandes son muy escasos: para magnitud 5,0 o superior los modelos apenas mejoran la frecuencia histórica.</li>
          <li>El catálogo cambió de sistema en 2018 y su cobertura no es uniforme en el territorio.</li>
          <li>Es un prototipo académico de {index.app.author}, {index.app.institution}. No debe usarse para tomar decisiones de protección civil.</li>
        </ul>
        <p><Link to="/metodologia">Leer la metodología completa</Link> · <Link to="/historia">Ver el modo historia</Link></p>
      </Step>
    </ProvenanceContext.Provider>
  )
}
