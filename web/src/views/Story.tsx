// Modo historia: presentación del proyecto en diez capítulos, a pantalla completa y con teclado.
import { ChevronLeft, ChevronRight, Captions, FileDown, Maximize, Volume2, VolumeX, X } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarList } from '@/charts/Chart'
import { Logo } from '@/components/Logo'
import { toggleFullscreen } from '@/components/Palette'
import { LanguageSelect } from '@/components/Shell'
import { Gate, IconButton, Kpis, Note, ProbabilityScale, ProbabilityValue, useKey, useMotionOk } from '@/components/ui'
import { forecastId, loadEvents, loadForecast, loadGeo, loadIndex, loadQuality, loadZones, MODEL_ORDER, useAsync, type Events, type ForecastFile, type GeoFC, type IndexData, type QualityData, type ZoneTable } from '@/lib/data'
import { buildPdf, DISCLAIMER, download, provenance } from '@/lib/export'
import { fmtDate, fmtInt, fmtNum, fmtPct, fmtShare, inPhrase } from '@/lib/format'
import { depthClass, NO_DATA_COLOR } from '@/lib/scales'
import { LIMITATIONS } from '@/lib/reports'
import { useApp } from '@/lib/store'
import { CERTAINTY_NOTE } from './Forecast'

interface Chapter {
  title: string
  narration: string
  points: string[]
  visual: ReactNode
}
interface Data {
  index: IndexData
  ev: Events
  geo: GeoFC
  q: QualityData
  fc: ForecastFile
  zt: ZoneTable
}

function MiniMap({ ev, geo, minMag }: { ev: Events; geo: GeoFC; minMag: number }) {
  const W = 420
  const H = 480
  const px = (lon: number) => ((lon + 82.5) / 16.2) * W
  const py = (lat: number) => ((13.8 - lat) / 18.6) * H
  const path = useMemo(() => geo.features.map((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((p) => p[0].filter((_, k) => k % 3 === 0).map(([x, y], k) => `${k ? 'L' : 'M'}${px(x).toFixed(1)} ${py(y).toFixed(1)}`).join('') + 'Z').join('')).join(''), [geo]) // eslint-disable-line react-hooks/exhaustive-deps
  const pts = useMemo(() => {
    const o: number[] = []
    for (let i = 0; i < ev.n; i++) if (ev.mag[i] >= minMag) o.push(i)
    return o
  }, [ev, minMag])
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxHeight: '58dvh' }} role="img" aria-label={`Mapa de Colombia con ${fmtInt(pts.length)} eventos reales de magnitud ${fmtNum(minMag, 1)} o superior, coloreados por profundidad.`}>
      <path d={path} fill="var(--map-land-co)" stroke="var(--map-line-soft)" strokeWidth={0.6} />
      {pts.map((i) => (
        <circle key={i} cx={px(ev.lon[i])} cy={py(ev.lat[i])} r={1.5 + (ev.mag[i] - minMag) ** 1.4 * 2.6} fill={depthClass(ev.depth[i])?.color ?? NO_DATA_COLOR} opacity={0.8} stroke="var(--surface)" strokeWidth={0.4} />
      ))}
    </svg>
  )
}

function chapters(d: Data, qr: string | null): Chapter[] {
  const { index, ev, q, fc, zt } = d
  const sel = fc.selected_model
  const best = fc.models[sel]!
  const base = fc.models.base!
  const keys = MODEL_ORDER.filter((k) => fc.models[k])
  const p = fc.forecast.p[sel] ?? []
  const top = p.map((_, i) => i).sort((a, b) => p[b] - p[a]).slice(0, 3)
  const deep = q.by_year.reduce((s, y) => s + y.n, 0)
  return [
    {
      title: '¿Por qué tiembla Colombia?',
      narration: 'Colombia está donde se encuentran tres placas tectónicas: Nazca, Caribe y Suramérica. Esa interacción produce sismos superficiales en la corteza y sismos profundos bajo la cordillera. El mapa muestra los eventos reales de magnitud cinco o superior registrados desde mil novecientos noventa y tres.',
      points: ['Tres placas: Nazca, Caribe y Suramérica.', 'Sismicidad superficial, intermedia y profunda.', `${fmtInt(ev.mag.filter((m) => m >= 5).length)} eventos de magnitud 5,0 o superior desde 1993.`],
      visual: <MiniMap ev={ev} geo={d.geo} minMag={5} />,
    },
    {
      title: '¿Qué información contiene un catálogo sísmico?',
      narration: 'Un catálogo es una lista ordenada de sismos. Cada fila dice cuándo ocurrió, dónde, a qué profundidad, con qué magnitud y con cuánta incertidumbre se localizó. Usamos el catálogo público de la Red Sismológica Nacional del Servicio Geológico Colombiano.',
      points: ['Fecha y hora en UTC, latitud, longitud y profundidad.', 'Magnitud y tipo de magnitud.', 'Medidas de calidad: error, gap, fases.'],
      visual: <Kpis label="El catálogo en cifras" items={[{ label: 'Eventos', value: fmtInt(index.records), sub: `M ≥ ${fmtNum(index.min_magnitude, 1)}` }, { label: 'Cobertura', value: `${index.coverage[0].slice(0, 4)}–${index.coverage[1].slice(0, 4)}`, sub: `hasta ${fmtDate(index.coverage[1])}` }, { label: 'Tipos de magnitud', value: fmtInt(Object.keys(q.magnitude_types.detail).length) }, { label: 'Revisados por analista', value: fmtShare(q.totals.reviewed_share, 1) }]} />,
    },
    {
      title: '¿Cómo se prepara la información?',
      narration: `Antes de modelar, cada registro pasa por ${index.audit.length} reglas de calidad. Se eliminan duplicados, se marcan las profundidades convencionales y no se imputa ningún valor. Cada regla queda en un registro de auditoría.`,
      points: [`${fmtInt(q.totals.records_downloaded)} registros descargados; ${fmtInt(q.totals.records_dropped)} duplicados descartados.`, `${fmtInt(q.totals.depth_fixed_zero)} profundidades fijadas en 0 km, marcadas.`, 'Cambio de sistema en marzo de 2018, documentado.'],
      visual: <BarList items={index.audit.filter((a) => a.rows_affected > 0 && a.rows_affected < a.rows_in).slice(0, 7).map((a) => ({ label: `${a.rule} · ${a.title}`, value: a.rows_affected }))} format={fmtInt} />,
    },
    {
      title: '¿Cómo se construye una zona-periodo?',
      narration: 'No intentamos anticipar un sismo aislado. Dividimos el territorio en zonas y el tiempo en periodos. Cada zona, en cada fecha, se describe solo con su pasado, y se anota si en los treinta días siguientes hubo al menos un evento sobre el umbral.',
      points: ['Cinco unidades: departamento, municipio, hexágono y dos cuadrículas.', 'Las variables solo usan el pasado.', `${fmtInt(fc.config.n_rows)} zonas-periodo en la configuración principal.`],
      visual: <Kpis label="Unidades de análisis" items={Object.values(index.units).map((u) => ({ label: u.label, value: fmtInt(u.n_zones), sub: u.resolution }))} />,
    },
    {
      title: '¿Qué es una probabilidad?',
      narration: 'Una probabilidad del veinte por ciento significa que, de cada cien zonas-periodo parecidas, cerca de veinte registraron un evento. No dice cuáles. Por eso cada valor se muestra con su intervalo de incertidumbre.',
      points: ['Probabilidad = frecuencia esperada en situaciones parecidas.', 'Siempre con intervalo de incertidumbre.', 'Nunca 0 % ni 100 %.'],
      visual: (
        <div className="stack">
          <ProbabilityScale />
          <ProbabilityValue p={0.2} lo={0.13} hi={0.29} />
          <span className="demo-tag" style={{ alignSelf: 'flex-start' }}>Ejemplo ilustrativo</span>
        </div>
      ),
    },
    {
      title: '¿Qué modelos se compararon?',
      narration: `Comparamos ${keys.length} familias de modelos, desde la frecuencia histórica hasta el gradient boosting y un híbrido. Para la cuadrícula de cincuenta kilómetros, treinta días y magnitud cuatro, el mejor resultado fue de ${inPhrase(best.name)}.`,
      points: [`PR-AUC de ${fmtNum(best.walk_forward.pr_auc ?? NaN, 2)} frente a ${fmtNum(base.walk_forward.pr_auc ?? NaN, 2)} de la línea base.`, 'La complejidad solo se acepta si mejora a la línea base.', 'No se elige por exactitud (accuracy).'],
      visual: <BarList items={keys.map((k) => ({ label: fc.models[k]!.name, value: fc.models[k]!.walk_forward.pr_auc ?? 0, color: k === sel ? 'var(--accent)' : 'var(--s6)' }))} format={(v) => fmtNum(v, 3)} />,
    },
    {
      title: '¿Por qué la validación debe respetar el tiempo?',
      narration: 'Si mezcláramos los datos al azar, el modelo vería réplicas de una misma secuencia en el entrenamiento y en la prueba, y parecería mejor de lo que es. Aquí siempre se entrena con el pasado y se prueba con el futuro, en bloques que avanzan año a año.',
      points: [`${fc.folds.length} bloques walk-forward con separación de ${fc.config.horizon_days} días.`, 'Calibración ajustada solo con validación.', `Detector de fugas: ${fc.leakage.filter((l) => l.status === 'ok').length} de ${fc.leakage.length} comprobaciones sin hallazgos.`],
      visual: (
        <ul className="stack tight small">
          {fc.folds.map((f) => (
            <li key={f.fold} className="row between" style={{ borderBottom: '1px solid var(--border)', padding: '6px 0' }}>
              <span>Bloque {f.fold}: entrena hasta {f.train[1].slice(0, 4)}</span>
              <span className="muted num">prueba {f.test[0].slice(0, 7)} → {f.test[1].slice(0, 7)}</span>
            </li>
          ))}
        </ul>
      ),
    },
    {
      title: '¿Cómo se interpreta el mapa?',
      narration: 'Cada zona muestra la probabilidad de registrar al menos un evento sobre el umbral en los próximos treinta días. Una probabilidad alta no es certeza, y una baja no es ausencia de actividad. El mapa habla de actividad, no de daños.',
      points: top.map((z) => `${zt.name[z].replace(/^(Celda|Hexágono)[^·]*· /, '').split(' (')[0]}: ${fmtPct(p[z])}`),
      visual: (
        <div className="stack">
          <div className="caption">Zona con el valor más alto del pronóstico vigente ({fmtDate(fc.forecast.forecast_start)} a {fmtDate(fc.forecast.forecast_end)})</div>
          <ProbabilityValue p={p[top[0]]} lo={fc.forecast.lo[sel]?.[top[0]]} hi={fc.forecast.hi[sel]?.[top[0]]} />
          <Note tone="caution">{CERTAINTY_NOTE}</Note>
        </div>
      ),
    },
    {
      title: '¿Cuáles son las limitaciones?',
      narration: 'No se predicen terremotos individuales. Los eventos grandes son muy escasos, el catálogo cambió de sistema en dos mil dieciocho y no incluimos exposición ni vulnerabilidad. Esta plataforma no reemplaza al Servicio Geológico Colombiano ni a las autoridades de gestión del riesgo.',
      points: LIMITATIONS,
      visual: <Note tone="caution"><b>Advertencia.</b> {DISCLAIMER}</Note>,
    },
    {
      title: '¿Cómo podría evolucionar el proyecto?',
      narration: 'Los siguientes pasos son homogeneizar las magnitudes, ajustar un modelo ETAS completo, evaluar los pronósticos de forma prospectiva y, con datos de exposición, acercarse al riesgo. El código QR abre el atlas.',
      points: ['Magnitudes homogéneas (Mw) y completitud por región.', 'ETAS ajustado por máxima verosimilitud y pruebas tipo CSEP.', 'Evaluación prospectiva mes a mes y actualización automática.'],
      visual: (
        <div className="stack" style={{ alignItems: 'center' }}>
          {qr ? <img src={qr} width={220} height={220} alt="Código QR con la dirección del atlas sísmico de esta plataforma" style={{ borderRadius: 12, background: '#fff', padding: 8 }} /> : null}
          <p className="caption" style={{ textAlign: 'center', overflowWrap: 'anywhere' }}>{location.origin + location.pathname}#/atlas</p>
          <p className="caption">{fmtInt(deep)} eventos reales lo esperan.</p>
        </div>
      ),
    },
  ]
}

export default function Story() {
  const index = useAsync(loadIndex, [])
  const ev = useAsync(loadEvents, [])
  const geo = useAsync(() => loadGeo('dep'), [])
  const q = useAsync(loadQuality, [])
  const fc = useAsync(() => loadForecast(forecastId('g50', 30, 4)), [])
  const zt = useAsync(() => loadZones('g50'), [])
  useEffect(() => {
    document.title = 'Modo historia · SismoNexo Colombia'
  }, [])
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'var(--bg)', overflow: 'auto' }}>
      <Gate of={[index, ev, geo, q, fc, zt] as const}>{(i, e, g, qq, f, z) => <Deck d={{ index: i, ev: e, geo: g, q: qq, fc: f, zt: z }} />}</Gate>
    </div>
  )
}

function Deck({ d }: { d: Data }) {
  const navigate = useNavigate()
  const ok = useMotionOk()
  const toast = useApp((s) => s.toast)
  const [k, setK] = useState(0)
  const [subs, setSubs] = useState(true)
  const [voice, setVoice] = useState(false)
  const [qr, setQr] = useState<string | null>(null)
  const dir = useRef(1)
  const list = useMemo(() => chapters(d, qr), [d, qr])
  const ch = list[k]
  const go = (n: number) => {
    const next = Math.max(0, Math.min(list.length - 1, n))
    dir.current = next >= k ? 1 : -1
    setK(next)
  }
  useEffect(() => {
    void import('qrcode').then((m) => m.toDataURL(`${location.origin}${location.pathname}#/atlas`, { margin: 1, width: 440 })).then(setQr, () => setQr(null))
  }, [])
  // Narración opcional con la voz del navegador; nunca se inicia sola.
  useEffect(() => {
    if (!('speechSynthesis' in window)) return
    window.speechSynthesis.cancel()
    if (!voice) return
    const u = new SpeechSynthesisUtterance(`${ch.title}. ${ch.narration}`)
    u.lang = 'es-CO'
    u.rate = 0.98
    const v = window.speechSynthesis.getVoices().find((x) => x.lang.startsWith('es'))
    if (v) u.voice = v
    window.speechSynthesis.speak(u)
    return () => window.speechSynthesis.cancel()
  }, [voice, ch])
  const exit = () => (document.fullscreenElement && void document.exitFullscreen(), navigate('/aprender'))
  useKey((e) => {
    if (document.querySelector('[role="dialog"]')) return
    if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && (e.target as HTMLElement).tagName !== 'BUTTON')) (e.preventDefault(), go(k + 1))
    else if (e.key === 'ArrowLeft' || e.key === 'PageUp') (e.preventDefault(), go(k - 1))
    else if (e.key === 'Home') go(0)
    else if (e.key === 'End') go(list.length - 1)
    else if (e.key === 'Escape' && !document.fullscreenElement) exit()
  })
  const pdf = async () => {
    try {
      const blob = await buildPdf({ title: 'SismoNexo Colombia — resumen de la presentación', subtitle: d.index.app.subtitle, prov: provenance(d.index, 'Resumen del modo historia', { version_modelo: d.fc.config.model_version, pronostico_generado: d.fc.forecast.generated_at }), sections: list.map((c, i) => ({ heading: `${i + 1}. ${c.title}`, paragraphs: [c.narration], bullets: c.points })) })
      download('sismonexo-resumen-presentacion.pdf', blob)
      toast('Resumen de la presentación descargado en PDF.')
    } catch (e) {
      toast(`No fue posible generar el PDF: ${(e as Error).message}`)
    }
  }
  return (
    <div style={{ minHeight: '100%', display: 'grid', gridTemplateRows: 'auto 1fr auto', maxWidth: 1280, margin: '0 auto', padding: '12px clamp(16px, 4vw, 48px) 16px' }}>
      <header className="row between" style={{ gap: 12 }}>
        <div className="row" style={{ color: 'var(--accent-text)', gap: 10 }}>
          <Logo size={28} />
          <span style={{ color: 'var(--text)', fontWeight: 620 }}>SismoNexo Colombia</span>
          <span className="caption hide-narrow">· Modo historia</span>
        </div>
        <div className="row" role="toolbar" aria-label="Controles de la presentación">
          <LanguageSelect />
          <IconButton label={subs ? 'Ocultar subtítulos' : 'Mostrar subtítulos'} aria-pressed={subs} onClick={() => setSubs(!subs)}><Captions size={20} aria-hidden /></IconButton>
          <IconButton label={voice ? 'Detener la narración' : 'Activar la narración por voz'} aria-pressed={voice} onClick={() => ('speechSynthesis' in window ? setVoice(!voice) : toast('Este navegador no ofrece síntesis de voz.'))}>{voice ? <Volume2 size={20} aria-hidden /> : <VolumeX size={20} aria-hidden />}</IconButton>
          <IconButton label="Exportar resumen en PDF" onClick={() => void pdf()}><FileDown size={20} aria-hidden /></IconButton>
          <IconButton label="Pantalla completa" onClick={toggleFullscreen}><Maximize size={20} aria-hidden /></IconButton>
          <IconButton label="Salir del modo historia" onClick={exit}><X size={20} aria-hidden /></IconButton>
        </div>
      </header>
      <main style={{ display: 'grid', alignItems: 'center', padding: '16px 0', minHeight: 0 }} aria-live="polite">
        <AnimatePresence mode="wait" initial={false}>
          <motion.section key={k} aria-labelledby="cap-t" initial={ok ? { opacity: 0, x: 40 * dir.current } : { opacity: 0 }} animate={{ opacity: 1, x: 0 }} exit={ok ? { opacity: 0, x: -40 * dir.current } : { opacity: 0 }} transition={{ duration: ok ? 0.32 : 0.1, ease: [0.2, 0, 0, 1] }} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 380px), 1fr))', gap: 'clamp(20px, 4vw, 56px)', alignItems: 'center' }}>
            <div>
              <div className="eyebrow num" style={{ color: 'var(--accent-text)' }}>Capítulo {k + 1} de {list.length}</div>
              <h1 id="cap-t" style={{ fontSize: 'clamp(1.75rem, 3.6vw, 2.75rem)', margin: '8px 0 20px', textWrap: 'balance' }}>{ch.title}</h1>
              <ul className="stack" style={{ gap: 12 }}>
                {ch.points.map((p, i) => (
                  <motion.li key={p} initial={ok ? { opacity: 0, y: 10 } : false} animate={{ opacity: 1, y: 0 }} transition={{ delay: ok ? 0.18 + i * 0.12 : 0, duration: 0.28 }} style={{ fontSize: 'var(--fs-18)', paddingLeft: 18, borderLeft: '3px solid var(--accent)' }}>
                    {p}
                  </motion.li>
                ))}
              </ul>
            </div>
            <div className="card" style={{ minWidth: 0 }}>{ch.visual}</div>
          </motion.section>
        </AnimatePresence>
      </main>
      <footer className="stack tight">
        {subs && (
          <p className="glass" style={{ padding: '10px 16px', borderRadius: 14, fontSize: 'var(--fs-16)', boxShadow: 'none' }} lang="es">
            {ch.narration}
          </p>
        )}
        <div className="row between">
          <button type="button" className="btn" data-variant="ghost" onClick={() => go(k - 1)} disabled={k === 0}><ChevronLeft size={18} aria-hidden /> Anterior</button>
          <div className="row" role="tablist" aria-label="Capítulos" style={{ gap: 4 }}>
            {list.map((c, i) => (
              <button key={c.title} type="button" role="tab" aria-selected={i === k} aria-label={`Capítulo ${i + 1}: ${c.title}`} onClick={() => go(i)} style={{ width: 28, height: 44, border: 0, background: 'none', cursor: 'pointer', padding: 0 }}>
                <span style={{ display: 'block', height: 4, borderRadius: 2, background: i === k ? 'var(--accent)' : i < k ? 'var(--text-3)' : 'var(--surface-3)' }} />
              </button>
            ))}
          </div>
          <button type="button" className="btn" data-variant={k === list.length - 1 ? 'ghost' : 'primary'} onClick={() => (k === list.length - 1 ? navigate('/atlas') : go(k + 1))}>{k === list.length - 1 ? 'Abrir el atlas' : 'Siguiente'} <ChevronRight size={18} aria-hidden /></button>
        </div>
        <p className="caption" style={{ textAlign: 'center' }}>Estimaciones académicas. No es una alerta oficial ni reemplaza al SGC. Teclas: ← → para avanzar, Esc para salir.</p>
      </footer>
    </div>
  )
}
