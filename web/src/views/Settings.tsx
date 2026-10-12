// Configuración: preferencias de la sesión. Nada se guarda en el dispositivo; el tema y la zona horaria viajan en la URL.
import { Page } from '@/components/Shell'
import { Button, Card, Note, Segmented, Switch } from '@/components/ui'
import { LANGS } from '@/lib/i18n'
import { useApp } from '@/lib/store'

async function prepareOffline(toast: (t: string) => void) {
  if (!('serviceWorker' in navigator)) return toast('Este navegador no admite el modo sin conexión.')
  try {
    const reg = await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`)
    await navigator.serviceWorker.ready
    const assets = [...new Set(performance.getEntriesByType('resource').map((r) => r.name).filter((u) => u.startsWith(location.origin)))]
    ;(reg.active ?? reg.waiting ?? reg.installing)?.postMessage({ type: 'precache', urls: [location.origin + import.meta.env.BASE_URL, ...assets] })
    toast('Modo sin conexión preparado: la aplicación y los datos ya consultados quedan disponibles sin red.')
  } catch {
    toast('No fue posible preparar el modo sin conexión (requiere HTTPS o localhost y el sitio compilado).')
  }
}

export default function Settings() {
  const prefs = useApp((s) => s.prefs)
  const saved = useApp((s) => s.saved)
  const scenarios = useApp((s) => s.scenarios)
  const past = useApp((s) => s.past)
  const { setPrefs, toast, setOpen } = useApp.getState()
  return (
    <Page title="Configuración" lead="Preferencias de esta sesión. La plataforma no usa cuentas ni almacenamiento persistente: al cerrar la pestaña se restablecen, salvo el tema y la zona horaria, que viajan en el enlace.">
      <div className="grid c2">
        <Card title="Apariencia">
          <div className="stack">
            <Segmented label="Tema" hideLabel={false} value={prefs.theme} onChange={(v) => setPrefs({ theme: v })} options={[{ value: 'sistema', label: 'Sistema' }, { value: 'claro', label: 'Claro' }, { value: 'oscuro', label: 'Oscuro' }]} />
            <Segmented label="Densidad de la interfaz" hideLabel={false} value={prefs.density} onChange={(v) => setPrefs({ density: v })} options={[{ value: 'comoda', label: 'Cómoda' }, { value: 'compacta', label: 'Compacta' }]} />
            <Switch label="Barra lateral contraída (solo iconos)" checked={prefs.sidebar === 'min'} onChange={(v) => setPrefs({ sidebar: v ? 'min' : 'full' })} />
          </div>
        </Card>
        <Card title="Movimiento y accesibilidad">
          <div className="stack">
            <Segmented label="Animaciones" hideLabel={false} value={prefs.motion} onChange={(v) => setPrefs({ motion: v })} options={[{ value: 'sistema', label: 'Según el sistema' }, { value: 'reducido', label: 'Reducidas' }]} />
            <p className="small muted">Con movimiento reducido, los desplazamientos del mapa, las ondas y las transiciones se sustituyen por cambios instantáneos o fundidos breves. La información nunca depende de una animación.</p>
            <Switch label="Atajos de una sola tecla (T, F, N, G…)" checked={prefs.keys} onChange={(v) => setPrefs({ keys: v })} />
            <p className="small muted">Desactívelos si usa dictado por voz o si le interfieren. {`Los atajos con Ctrl o ⌘ siguen activos.`}</p>
            <div className="row wrap">
              <Button variant="outline" onClick={() => setOpen('shortcuts', true)}>Ver atajos de teclado</Button>
              <Button variant="outline" onClick={() => setOpen('onboarding', true)}>Repetir el recorrido inicial</Button>
            </div>
          </div>
        </Card>
        <Card title="Idioma, fechas y horas">
          <div className="stack">
            <div data-no-i18n>
              <Segmented label="Idioma · Language" hideLabel={false} value={prefs.lang} onChange={(v) => setPrefs({ lang: v })} options={LANGS.map((l) => ({ value: l.code, label: l.name }))} />
            </div>
            <p className="small muted">El contenido se escribe en español y se traduce en la interfaz. Los nombres de lugares, los identificadores y los archivos exportados (PDF, CSV, JSON) se mantienen en español. Si falta una traducción, el texto aparece en español.</p>
            <Segmented label="Zona horaria para mostrar eventos" hideLabel={false} value={prefs.tz} onChange={(v) => setPrefs({ tz: v })} options={[{ value: 'colombia', label: 'Hora de Colombia (UTC−5)' }, { value: 'utc', label: 'UTC' }]} />
            <p className="small muted">El catálogo registra las horas en UTC. Los filtros de fecha y los periodos del pronóstico usan siempre días UTC completos; esta opción solo cambia cómo se muestra la hora de cada evento.</p>
          </div>
        </Card>
        <Card title="Datos de la sesión">
          <dl className="deflist">
            <dt>Cambios de filtros en el historial</dt><dd>{past.length}</dd>
            <dt>Vistas guardadas</dt><dd>{saved.length}</dd>
            <dt>Escenarios guardados</dt><dd>{scenarios.length}</dd>
          </dl>
          <p className="small muted" style={{ marginTop: 8 }}>Todo vive en la memoria de esta pestaña. Para conservar una vista, copie su enlace.</p>
          <div className="row wrap" style={{ marginTop: 12 }}>
            <Button variant="outline" onClick={() => void prepareOffline(toast)}>Preparar modo sin conexión</Button>
          </div>
          <Note>El modo sin conexión guarda en la caché del navegador los archivos de la aplicación y los datos que ya haya abierto, para presentar sin red. Las capas que dependen de servicios externos (relieve, mapa de referencia y amenaza oficial) no estarán disponibles.</Note>
        </Card>
      </div>
    </Page>
  )
}
