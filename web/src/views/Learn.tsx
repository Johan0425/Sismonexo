// Centro de aprendizaje: conceptos clave, glosario interactivo, preguntas frecuentes y acceso al modo historia.
import { Presentation, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Page } from '@/components/Shell'
import { Button, Card, EmptyState, Field, Note, ProbabilityScale } from '@/components/ui'
import { fold } from '@/lib/format'
import { GLOSSARY } from '@/lib/glossary'
import { useApp } from '@/lib/store'

const CONCEPTS: { title: string; body: string; terms: string[] }[] = [
  { title: 'Cinco palabras que no significan lo mismo', body: 'Actividad es lo que ya se registró. Amenaza es la probabilidad de que el suelo se mueva con cierta fuerza a largo plazo. Exposición es lo que hay en el lugar. Vulnerabilidad es qué tan frágil es. Riesgo es la pérdida esperada al combinarlas. Esta plataforma solo trabaja con actividad.', terms: ['actividad', 'amenaza', 'exposicion', 'vulnerabilidad', 'riesgo'] },
  { title: 'Pronosticar no es predecir', body: 'Predecir sería decir cuándo, dónde y de qué tamaño será un sismo; nadie puede hacerlo. Pronosticar de forma probabilística es estimar con qué frecuencia ocurre algo en situaciones parecidas, y decirlo con su incertidumbre.', terms: ['probabilidad', 'tasa', 'incertidumbre'] },
  { title: 'Un catálogo nunca está completo', body: 'Los sismos pequeños solo se detectan donde hay estaciones cerca. Cuando la red crece, aparecen más sismos pequeños en el catálogo sin que la Tierra haya cambiado. Por eso conviene mirar siempre la magnitud de completitud.', terms: ['catalogo', 'completitud', 'magnitud'] },
  { title: 'Cómo saber si un modelo sirve', body: 'Se compara contra la línea base, con datos que no vio y respetando el tiempo. Con eventos raros, acertar «no pasa nada» es fácil: por eso se usan PR-AUC, Brier y calibración, no la exactitud.', terms: ['linea-base', 'walk-forward', 'pr-auc', 'brier', 'calibracion', 'fuga'] },
]
const FAQ: [string, string][] = [
  ['¿Esta plataforma puede avisarme antes de un terremoto?', 'No. No emite alertas ni predice sismos individuales. Para información oficial consulte al Servicio Geológico Colombiano y a las autoridades de gestión del riesgo.'],
  ['Mi municipio aparece con probabilidad alta. ¿Debo preocuparme?', 'Una probabilidad alta indica que en esa zona se registran sismos sobre el umbral con frecuencia, como ocurre en el nido de Bucaramanga, donde la actividad es muy profunda y rara vez causa daños. No habla de daños ni de un evento inminente. La preparación ante sismos es recomendable en todo el país, con cualquier valor del mapa.'],
  ['¿Y si la probabilidad es baja?', 'Significa que en el catálogo esa zona ha registrado pocos eventos sobre el umbral. No garantiza ausencia de actividad: el catálogo cubre apenas unas décadas y los grandes sismos tienen periodos de recurrencia mucho más largos.'],
  ['¿Por qué cambian los valores entre modelos?', 'Cada modelo usa la información de forma distinta. Por eso se muestran todos, se comparan con la misma validación y se informa cuál se eligió y por qué.'],
  ['¿De dónde salen los datos?', 'Del catálogo público de la Red Sismológica Nacional de Colombia (SGC). La sección «Calidad de los datos» documenta la descarga, cada regla de limpieza y la licencia.'],
  ['¿Qué es el intervalo de incertidumbre?', 'El rango en el que razonablemente está la frecuencia real para zonas con una estimación parecida. Si es ancho, hay poca información y el valor central debe leerse con más cautela.'],
]

export default function Learn() {
  const loc = useLocation()
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>((loc.state as { term?: string } | null)?.term ?? null)
  const setPalette = useApp((s) => s.setOpen)
  useEffect(() => {
    const t = (loc.state as { term?: string } | null)?.term
    if (t) {
      setOpen(t)
      setTimeout(() => document.getElementById(`g-${t}`)?.scrollIntoView({ block: 'center' }), 80)
    }
  }, [loc.state])
  const terms = useMemo(() => {
    const f = fold(q.trim())
    return GLOSSARY.filter((t) => !f || fold(`${t.term} ${t.short} ${(t.aliases ?? []).join(' ')}`).includes(f)).sort((a, b) => a.term.localeCompare(b.term, 'es'))
  }, [q])
  const jump = (id: string) => {
    setQ('')
    setOpen(id)
    setTimeout(() => document.getElementById(`g-${id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 60)
  }
  return (
    <Page
      title="Centro de aprendizaje"
      lead="Los conceptos necesarios para leer el atlas y el pronóstico sin malinterpretarlos."
      actions={
        <>
          <Link className="btn" data-variant="primary" to="/historia">
            <Presentation size={18} aria-hidden /> Abrir el modo historia
          </Link>
          <Button variant="outline" onClick={() => setPalette('onboarding', true)}>Repetir el recorrido inicial</Button>
        </>
      }
    >
      <div className="stack loose">
        <div className="grid c2">
          {CONCEPTS.map((c) => (
            <Card key={c.title} title={c.title} as="article">
              <p>{c.body}</p>
              <div className="chips" style={{ marginTop: 12 }}>
                {c.terms.map((t) => (
                  <button key={t} type="button" className="chip" onClick={() => jump(t)}>
                    {GLOSSARY.find((g) => g.id === t)?.term}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <Card title="Cómo leer la escala de probabilidad" subtitle="Seis clases. Cada una tiene color, patrón, etiqueta y rango.">
          <ProbabilityScale />
          <Note tone="caution">Una probabilidad alta no significa que un terremoto ocurrirá con certeza. Una probabilidad baja tampoco significa ausencia total de actividad.</Note>
        </Card>
        <section aria-labelledby="glosario">
          <div className="row wrap between" style={{ marginBottom: 12 }}>
            <h2 id="glosario">Glosario interactivo</h2>
            <div style={{ flex: '0 1 320px' }}>
              <Field label="Buscar un término">
                {(p) => (
                  <div style={{ position: 'relative' }}>
                    <Search size={18} aria-hidden style={{ position: 'absolute', left: 12, top: 13, color: 'var(--text-3)' }} />
                    <input {...p} className="input" style={{ paddingLeft: 38 }} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Por ejemplo: calibración" />
                  </div>
                )}
              </Field>
            </div>
          </div>
          <div className="card" style={{ padding: '0 var(--sp-5)' }}>
            {terms.length === 0 ? (
              <EmptyState title="Sin coincidencias">Ningún término contiene «{q}». Pruebe con otra palabra.</EmptyState>
            ) : (
              terms.map((t, i) => (
                <details key={t.id} id={`g-${t.id}`} className="disclosure" style={i === 0 ? { borderTop: 0 } : undefined} open={open === t.id} onToggle={(e) => (e.currentTarget.open ? setOpen(t.id) : open === t.id && setOpen(null))}>
                  <summary>
                    <span>
                      <span style={{ display: 'block' }}>{t.term}</span>
                      <span className="small muted" style={{ fontWeight: 400 }}>{t.short}</span>
                    </span>
                  </summary>
                  <div className="prose small">
                    <p>{t.long}</p>
                  </div>
                </details>
              ))
            )}
          </div>
          <p className="caption" style={{ marginTop: 8 }} aria-live="polite">{terms.length} de {GLOSSARY.length} términos.</p>
        </section>
        <section aria-labelledby="faq">
          <h2 id="faq" style={{ marginBottom: 12 }}>Preguntas frecuentes</h2>
          <div className="card" style={{ padding: '0 var(--sp-5)' }}>
            {FAQ.map(([qq, a], i) => (
              <details key={qq} className="disclosure" style={i === 0 ? { borderTop: 0 } : undefined}>
                <summary>{qq}</summary>
                <div className="prose small">
                  <p>{a}</p>
                </div>
              </details>
            ))}
          </div>
        </section>
      </div>
    </Page>
  )
}
