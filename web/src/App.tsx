import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { CommandPalette, GlobalKeys, Onboarding, ShortcutsDialog } from './components/Palette'
import { BottomNav, ConnectionEffect, Disclaimer, PrefsEffect, Sidebar, TopBar, UrlSync } from './components/Shell'
import { EmptyState, LiveRegion, PageSkeleton, Toasts } from './components/ui'
import { loadIndex } from './lib/data'
import { ROUTES } from './lib/routes'
import { useApp } from './lib/store'

const Home = lazy(() => import('./views/Home'))
const Atlas = lazy(() => import('./views/Atlas'))
const Forecast = lazy(() => import('./views/Forecast'))
const Historic = lazy(() => import('./views/Historic'))
const Lab = lazy(() => import('./views/Lab'))
const Models = lazy(() => import('./views/Models'))
const Quality = lazy(() => import('./views/Quality'))
const Methodology = lazy(() => import('./views/Methodology'))
const Learn = lazy(() => import('./views/Learn'))
const Reports = lazy(() => import('./views/Reports'))
const Settings = lazy(() => import('./views/Settings'))
const About = lazy(() => import('./views/About'))
const DesignTest = lazy(() => import('./views/DesignTest'))
const Story = lazy(() => import('./views/Story'))
const Nexo = lazy(() => import('./components/Nexo'))

function Shell() {
  const loc = useLocation()
  const sidebar = useApp((s) => s.prefs.sidebar)
  const nexo = useApp((s) => s.nexo)
  // Nexo se monta al abrirlo por primera vez y luego permanece, para conservar la conversación.
  const [nexoUsed, setNexoUsed] = useState(false)
  useEffect(() => {
    if (nexo) setNexoUsed(true)
  }, [nexo])
  const main = useRef<HTMLElement>(null)
  const isMap = ROUTES.some((r) => r.map && r.path === loc.pathname)
  // Al cambiar de vista, el foco y el desplazamiento vuelven al inicio del contenido.
  useEffect(() => {
    main.current?.scrollTo({ top: 0 })
  }, [loc.pathname])
  return (
    <div className="app" data-sidebar={sidebar}>
      <a className="skip-link" href="#contenido" onClick={(e) => (e.preventDefault(), main.current?.focus())}>
        Saltar al contenido
      </a>
      <Sidebar />
      <TopBar />
      <main className="main" id="contenido" ref={main} tabIndex={-1} style={isMap ? { overflow: 'hidden' } : undefined}>
        <ErrorBoundary resetKey={loc.pathname}>
        <Suspense fallback={<PageSkeleton />}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/atlas" element={<Atlas />} />
            <Route path="/pronostico" element={<Forecast />} />
            <Route path="/historico" element={<Historic />} />
            <Route path="/laboratorio" element={<Lab />} />
            <Route path="/modelos" element={<Models />} />
            <Route path="/calidad" element={<Quality />} />
            <Route path="/metodologia" element={<Methodology />} />
            <Route path="/aprender" element={<Learn />} />
            <Route path="/informes" element={<Reports />} />
            <Route path="/configuracion" element={<Settings />} />
            <Route path="/acerca" element={<About />} />
            <Route path="/sistema" element={<DesignTest />} />
            <Route
              path="*"
              element={
                <div className="page">
                  <EmptyState title="Esta página no existe">Revise la dirección o use la búsqueda para encontrar una vista.</EmptyState>
                </div>
              }
            />
          </Routes>
        </Suspense>
        </ErrorBoundary>
      </main>
      <Disclaimer />
      <BottomNav />
      <ErrorBoundary resetKey="nexo">
        <Suspense fallback={null}>{nexoUsed && <Nexo />}</Suspense>
      </ErrorBoundary>
    </div>
  )
}

export default function App() {
  const loc = useLocation()
  const setCoverage = useApp((s) => s.setCoverage)
  useEffect(() => {
    loadIndex().then(
      (i) => setCoverage(i.coverage[0].slice(0, 10), i.coverage[1].slice(0, 10)),
      () => undefined,
    )
  }, [setCoverage])
  return (
    <>
      <UrlSync />
      <PrefsEffect />
      <ConnectionEffect />
      <GlobalKeys />
      {loc.pathname === '/historia' ? (
        <ErrorBoundary resetKey="historia">
          <Suspense fallback={<PageSkeleton />}>
            <Story />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <Shell />
      )}
      <CommandPalette />
      <ShortcutsDialog />
      <Onboarding />
      <Toasts />
      <LiveRegion />
    </>
  )
}
