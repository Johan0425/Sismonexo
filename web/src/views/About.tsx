// Acerca del proyecto: autoría, fuentes, licencias, privacidad, términos de uso académico y registro de cambios.
import { Link } from 'react-router-dom'
import { Logo } from '@/components/Logo'
import { Page } from '@/components/Shell'
import { Card, Gate, Note } from '@/components/ui'
import { loadIndex, useAsync } from '@/lib/data'
import { DISCLAIMER } from '@/lib/export'
import { fmtDate, fmtInt } from '@/lib/format'

const LIBS: [string, string, string][] = [
  ['MapLibre GL JS', 'BSD-3-Clause', 'https://maplibre.org/maplibre-gl-js/docs/'],
  ['React', 'MIT', 'https://react.dev/'],
  ['Motion', 'MIT', 'https://motion.dev/'],
  ['D3 (scale, shape, array)', 'ISC', 'https://d3js.org/'],
  ['H3', 'Apache-2.0', 'https://h3geo.org/'],
  ['Lucide', 'ISC', 'https://lucide.dev/'],
  ['jsPDF', 'MIT', 'https://github.com/parallax/jsPDF'],
  ['scikit-learn', 'BSD-3-Clause', 'https://scikit-learn.org/'],
  ['SHAP', 'MIT', 'https://shap.readthedocs.io/'],
  ['FastAPI', 'MIT', 'https://fastapi.tiangolo.com/'],
]
const Ext = ({ href, children }: { href: string; children: React.ReactNode }) => (
  <a href={href} target="_blank" rel="noreferrer noopener">
    {children}
    <span className="sr-only"> (se abre en una pestaña nueva)</span>
  </a>
)

export default function About() {
  const index = useAsync(loadIndex, [])
  return (
    <Page title="Acerca del proyecto" lead="La información sísmica convertida en conocimiento comprensible.">
      <Gate of={[index] as const}>
        {(idx) => (
          <div className="stack loose">
            <Card>
              <div className="row wrap" style={{ gap: 24, alignItems: 'flex-start' }}>
                <span style={{ color: 'var(--text)', ['--logo-wave' as string]: 'var(--accent)' }}><Logo size={96} /></span>
                <div className="prose grow">
                  <h2>{idx.app.name}</h2>
                  <p className="muted">{idx.app.subtitle}</p>
                  <p><b>Autor académico:</b> {idx.app.author}<br /><b>Institución:</b> {idx.app.institution}<br /><b>Programa:</b> {idx.app.program}</p>
                  <p>Prototipo funcional del anteproyecto de grado. Su propósito es mostrar, con datos públicos y métodos reproducibles, hasta dónde puede llegar un pronóstico probabilístico de actividad sísmica por zona y periodo, y dónde están sus límites.</p>
                </div>
              </div>
            </Card>
            <Note tone="caution"><b>Advertencia.</b> {DISCLAIMER}</Note>
            <div className="grid c2">
              <Card title="Fuentes de datos">
                <ul className="stack tight small">
                  {idx.sources.map((s) => (
                    <li key={s.key}>
                      <b>{s.name}</b> — {s.publisher}. {fmtInt(s.records)} registros; consultado el {fmtDate(s.consulted_at)}. <Ext href={s.landing}>Fuente</Ext>
                    </li>
                  ))}
                  <li><b>{idx.official_layers.hazard.name}</b> — {idx.official_layers.hazard.publisher}; capa oficial opcional. <Ext href={idx.official_layers.hazard.landing}>Fuente</Ext></li>
                  <li><b>Relieve</b> (capa opcional) — Mapzen Terrain Tiles en AWS Open Data. <Ext href="https://registry.opendata.aws/terrain-tiles/">Fuente</Ext></li>
                  <li><b>Mapa de referencia</b> (capa opcional) — © Colaboradores de OpenStreetMap, licencia ODbL. <Ext href="https://www.openstreetmap.org/copyright">Fuente</Ext></li>
                </ul>
                <p className="small" style={{ marginTop: 10 }}><Link to="/calidad">Ver procedencia completa y licencias</Link></p>
              </Card>
              <Card title="Avisos de licencia del software">
                <ul className="stack tight small">
                  {LIBS.map(([n, l, u]) => (
                    <li key={n} className="row between"><Ext href={u}>{n}</Ext><span className="muted">{l}</span></li>
                  ))}
                </ul>
                <p className="caption" style={{ marginTop: 10 }}>Tipografía: fuente del sistema de cada dispositivo. Iconos: Lucide. El logotipo y el diseño de la interfaz son originales de este proyecto.</p>
              </Card>
              <Card title="Política de privacidad">
                <div className="prose small">
                  <p>La plataforma no tiene cuentas, no usa cookies, no incluye analítica ni rastreadores y no envía a ningún servidor lo que usted hace en ella.</p>
                  <p>Los filtros, vistas y escenarios viven en la memoria de la pestaña y en la dirección del navegador. Los archivos que importe se procesan en su equipo y se descartan al cerrar la pestaña.</p>
                  <p>Las capas opcionales de relieve, mapa de referencia y amenaza oficial solicitan imágenes a servidores de terceros (AWS, OpenStreetMap y SGC), que reciben su dirección IP como en cualquier visita web. Están desactivadas por defecto.</p>
                </div>
              </Card>
              <Card title="Términos de uso académico">
                <div className="prose small">
                  <ul>
                    <li>Uso permitido: docencia, investigación, divulgación y evaluación académica, citando el proyecto y la fuente de los datos (SGC).</li>
                    <li>No use los resultados como alerta, aviso oficial ni base para decisiones de evacuación, protección civil, seguros o inversión.</li>
                    <li>No presente escenarios hipotéticos como hechos ni oculte la incertidumbre al compartir resultados.</li>
                    <li>No mezcle la amenaza sísmica oficial con la probabilidad experimental de esta plataforma.</li>
                    <li>Conserve en toda exportación la fuente, la versión de los datos y la del modelo.</li>
                    <li>El software se entrega «tal cual», sin garantía de exactitud ni de disponibilidad.</li>
                  </ul>
                </div>
              </Card>
            </div>
            <Card title="Versiones y registro de cambios">
              <dl className="deflist stackable" style={{ gridTemplateColumns: 'minmax(140px, 240px) 1fr' }}>
                <dt>Aplicación</dt><dd style={{ textAlign: 'left' }}>0.1.0 — primera versión del prototipo</dd>
                <dt>Conjunto de datos</dt><dd style={{ textAlign: 'left' }}><code>{idx.dataset_version}</code> · generado el {fmtDate(idx.generated_at)}</dd>
                <dt>Experimentos</dt><dd style={{ textAlign: 'left' }}>{idx.experiments.length} configuraciones entrenadas</dd>
              </dl>
              <p className="small" style={{ marginTop: 10 }}>El historial detallado está en el archivo <code>CHANGELOG.md</code> del repositorio. La documentación técnica, los manuales y el guion de presentación están en la carpeta <code>docs/</code>.</p>
              <p className="small" style={{ marginTop: 6 }}><Link to="/sistema">Ver el sistema de diseño</Link> · <Link to="/metodologia">Metodología</Link></p>
            </Card>
          </div>
        )}
      </Gate>
    </Page>
  )
}
