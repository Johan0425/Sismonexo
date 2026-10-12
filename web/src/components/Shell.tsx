// Armazón de la aplicación: barra lateral, barra superior, navegación inferior (teléfono) y advertencia permanente.
import { CircleCheck, Ellipsis, MessageCircle, Moon, PanelLeft, Presentation, Search, Sun, TriangleAlert, UserRound, WifiOff } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
import { loadIndex, useAsync } from '@/lib/data'
import { DISCLAIMER } from '@/lib/export'
import { fmtDate } from '@/lib/format'
import { PHONE_PRIMARY, ROUTES } from '@/lib/routes'
import { toQuery, useApp } from '@/lib/store'
import { Logo } from './Logo'
import { IconButton, Pill, Sheet, Tooltip } from './ui'

const GROUPS = ['Explorar', 'Analizar', 'Comprender', 'Proyecto'] as const
const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
export const MOD = isMac ? '⌘' : 'Ctrl'

export function Sidebar() {
  const min = useApp((s) => s.prefs.sidebar === 'min')
  return (
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label="SismoNexo Colombia, ir al inicio">
        <span style={{ color: 'var(--accent-text)', flex: 'none' }}>
          <Logo size={30} />
        </span>
        <span className="brand-text">
          SismoNexo
          <small>COLOMBIA</small>
        </span>
      </NavLink>
      <nav className="nav" aria-label="Navegación principal">
        {GROUPS.map((g) => (
          <div key={g} role="group" aria-label={g} style={{ display: 'contents' }}>
            <div className="nav-group eyebrow" aria-hidden>
              {g}
            </div>
            {ROUTES.filter((r) => r.group === g).map((r) => {
              const link = (
                <NavLink key={r.path} to={r.path} end={r.path === '/'} aria-label={r.label}>
                  <r.icon size={20} aria-hidden />
                  <span className="nav-label">{r.label}</span>
                </NavLink>
              )
              return min ? (
                <Tooltip key={r.path} text={r.label}>
                  {link}
                </Tooltip>
              ) : (
                link
              )
            })}
          </div>
        ))}
      </nav>
      <div className="sidebar-foot nav" role="group" aria-label="Presentación">
        <NavLink to="/historia" aria-label="Modo historia">
          <Presentation size={20} aria-hidden />
          <span className="nav-label">Modo historia</span>
        </NavLink>
      </div>
    </aside>
  )
}

function DataStatus() {
  const idx = useAsync(loadIndex, [])
  const online = useApp((s) => s.online)
  if (!online)
    return (
      <Pill tone="caution" icon={<WifiOff size={14} aria-hidden />}>
        Sin conexión
      </Pill>
    )
  if (idx.status !== 'ready') return null
  const end = idx.data.coverage[1]
  const ageDays = (Date.now() - Date.parse(end)) / 86400000
  const stale = ageDays > 14
  return (
    <Tooltip text={stale ? `El catálogo incluido termina el ${fmtDate(end)}. Ejecute el pipeline para actualizarlo.` : `Catálogo del SGC consultado hasta el ${fmtDate(end)}. Versión ${idx.data.dataset_version}.`}>
      <span tabIndex={0} style={{ borderRadius: 999 }}>
        <Pill tone={stale ? 'caution' : undefined} icon={stale ? <TriangleAlert size={14} aria-hidden /> : <CircleCheck size={14} aria-hidden style={{ color: 'var(--positive)' }} />}>
          <span className="hide-phone">{stale ? 'Datos desactualizados · ' : 'Datos reales · '}</span>
          <span className="num">{fmtDate(end)}</span>
        </Pill>
      </span>
    </Tooltip>
  )
}

export function TopBar() {
  const prefs = useApp((s) => s.prefs)
  const setPrefs = useApp((s) => s.setPrefs)
  const setOpen = useApp((s) => s.setOpen)
  const [profile, setProfile] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const idx = useAsync(loadIndex, [])
  const dark = document.documentElement.dataset.theme === 'oscuro'
  useEffect(() => {
    if (!profile) return
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setProfile(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', close)
    }
  }, [profile])
  return (
    <header className="topbar">
      <span className="sidebar-toggle hide-phone contents">
        <IconButton label={prefs.sidebar === 'min' ? 'Expandir barra lateral' : 'Contraer barra lateral'} onClick={() => setPrefs({ sidebar: prefs.sidebar === 'min' ? 'full' : 'min' })} aria-expanded={prefs.sidebar !== 'min'}>
          <PanelLeft size={20} aria-hidden />
        </IconButton>
      </span>
      <span className="only-phone" style={{ color: 'var(--accent-text)' }}>
        <Logo size={28} />
      </span>
      <button type="button" className="search-trigger" onClick={() => setOpen('palette', true)} aria-label="Buscar departamentos, municipios, coordenadas, vistas y acciones" aria-keyshortcuts={isMac ? 'Meta+K' : 'Control+K'}>
        <Search size={18} aria-hidden />
        <span className="grow hide-phone">Buscar lugar, vista o acción</span>
        <span className="kbd hide-phone" aria-hidden>
          {MOD} K
        </span>
      </button>
      <span className="grow" />
      <DataStatus />
      <IconButton label="Abrir el asistente Nexo" onClick={() => setOpen('nexo', true)}>
        <MessageCircle size={20} aria-hidden />
      </IconButton>
      <span className="hide-phone contents">
        <IconButton label={dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'} onClick={() => setPrefs({ theme: dark ? 'claro' : 'oscuro' })}>
          {dark ? <Sun size={20} aria-hidden /> : <Moon size={20} aria-hidden />}
        </IconButton>
      </span>
      <div ref={ref} style={{ position: 'relative' }}>
        <IconButton label="Perfil del proyecto" aria-haspopup="menu" aria-expanded={profile} onClick={() => setProfile((v) => !v)} tip={!profile}>
          <UserRound size={20} aria-hidden />
        </IconButton>
        {profile && (
          <div className="popover glass" role="menu" style={{ right: 0, top: 48, width: 280 }}>
            <div style={{ padding: '8px 12px 12px' }}>
              <div style={{ fontWeight: 620 }}>{idx.data?.app.author ?? 'Johan Antonio Peña López'}</div>
              <div className="caption">{idx.data?.app.institution ?? 'Institución Universitaria EAM'}</div>
              <div className="caption">{idx.data?.app.program}</div>
              <div className="caption" style={{ marginTop: 6 }}>
                Sesión local sin cuenta: nada de lo que haga aquí se envía a un servidor.
              </div>
            </div>
            <NavLink role="menuitem" className="menu-item" to="/acerca" onClick={() => setProfile(false)}>
              Acerca del proyecto
            </NavLink>
            <NavLink role="menuitem" className="menu-item" to="/configuracion" onClick={() => setProfile(false)}>
              Configuración
            </NavLink>
            <button
              role="menuitem"
              type="button"
              className="menu-item"
              onClick={() => {
                setProfile(false)
                setOpen('shortcuts', true)
              }}
            >
              Atajos de teclado <span className="meta kbd">?</span>
            </button>
          </div>
        )}
      </div>
    </header>
  )
}

export function BottomNav() {
  const [more, setMore] = useState(false)
  const loc = useLocation()
  const setPrefs = useApp((s) => s.setPrefs)
  const dark = document.documentElement.dataset.theme === 'oscuro'
  useEffect(() => setMore(false), [loc.pathname])
  const rest = ROUTES.filter((r) => !PHONE_PRIMARY.includes(r.path))
  return (
    <>
      <nav className="bottomnav" aria-label="Navegación principal">
        {ROUTES.filter((r) => PHONE_PRIMARY.includes(r.path)).map((r) => (
          <NavLink key={r.path} to={r.path} end={r.path === '/'}>
            <r.icon size={22} aria-hidden />
            {r.short ?? r.label}
          </NavLink>
        ))}
        <button type="button" onClick={() => setMore(true)} aria-haspopup="dialog" aria-expanded={more} style={rest.some((r) => r.path === loc.pathname) ? { color: 'var(--accent-text)' } : undefined}>
          <Ellipsis size={22} aria-hidden />
          Más
        </button>
      </nav>
      <Sheet open={more} onClose={() => setMore(false)} title="Más">
        <nav className="nav" aria-label="Funciones secundarias" style={{ padding: 0 }}>
          {rest.map((r) => (
            <NavLink key={r.path} to={r.path}>
              <r.icon size={20} aria-hidden />
              {r.label}
            </NavLink>
          ))}
          <NavLink to="/historia">
            <Presentation size={20} aria-hidden />
            Modo historia
          </NavLink>
          <button type="button" onClick={() => setPrefs({ theme: dark ? 'claro' : 'oscuro' })}>
            {dark ? <Sun size={20} aria-hidden /> : <Moon size={20} aria-hidden />}
            {dark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
          </button>
        </nav>
      </Sheet>
    </>
  )
}

export function Disclaimer() {
  return (
    <footer className="disclaimer" role="note" aria-label="Advertencia de uso académico">
      <TriangleAlert size={14} aria-hidden />
      <span>
        <span className="long">{DISCLAIMER}</span>
        <span className="short">Estimaciones académicas basadas en patrones históricos. No es una alerta oficial ni predice terremotos individuales; consulte al SGC y a las autoridades de gestión del riesgo.</span>
      </span>
    </footer>
  )
}

/** Aplica tema, densidad y movimiento al documento. */
export function PrefsEffect() {
  const prefs = useApp((s) => s.prefs)
  const [, force] = useState(0)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const apply = () => {
      const t = prefs.theme === 'sistema' ? (mq.matches ? 'oscuro' : 'claro') : prefs.theme
      const root = document.documentElement
      if (root.dataset.theme !== t) {
        root.dataset.theme = t
        force((n) => n + 1)
      }
      root.dataset.density = prefs.density
      root.dataset.motion = prefs.motion
    }
    apply()
    mq.addEventListener('change', apply)
    return () => mq.removeEventListener('change', apply)
  }, [prefs])
  return null
}

/** Tema efectivo; se vuelve a evaluar cuando cambia el atributo del documento. */
export function useTheme(): 'claro' | 'oscuro' {
  const [t, setT] = useState<'claro' | 'oscuro'>(() => (document.documentElement.dataset.theme === 'oscuro' ? 'oscuro' : 'claro'))
  useEffect(() => {
    const mo = new MutationObserver(() => setT(document.documentElement.dataset.theme === 'oscuro' ? 'oscuro' : 'claro'))
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => mo.disconnect()
  }, [])
  return t
}

/** Sincroniza el estado con la URL (lectura inicial y escritura con replaceState). */
export function UrlSync() {
  const loc = useLocation()
  const navigate = useNavigate()
  const hydrated = useRef(false)
  const query = useApp((s) => toQuery(s))
  if (!hydrated.current) {
    hydrated.current = true
    useApp.getState().hydrate(new URLSearchParams(loc.search))
  }
  const written = useRef<string | null>(null)
  useEffect(() => {
    // Se compara contra la URL real del navegador (no la del render, que puede ir un paso atrás).
    const live = window.location.hash.slice(1)
    const path = live.split('?')[0] || '/'
    const cur = live.split('?')[1] ?? ''
    // Navegación externa con parámetros (vista guardada, botón atrás, enlace pegado): se adopta ese estado.
    if (written.current !== null && cur && cur !== written.current && cur !== query) {
      written.current = cur
      useApp.getState().hydrate(new URLSearchParams(cur))
      return
    }
    written.current = query
    if (cur !== query) navigate({ pathname: path, search: query ? `?${query}` : '' }, { replace: true })
  }, [query, loc.pathname, loc.search, loc.hash, navigate])
  return null
}

export function ConnectionEffect() {
  const setOnline = useApp((s) => s.setOnline)
  const toast = useApp((s) => s.toast)
  useEffect(() => {
    const on = () => {
      setOnline(true)
      toast('Conexión restablecida.')
    }
    const off = () => {
      setOnline(false)
      toast('Conexión interrumpida. Los datos ya cargados siguen disponibles.')
    }
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [setOnline, toast])
  return null
}

export function Page({ title, lead, actions, children, eyebrow }: { title: string; lead?: ReactNode; actions?: ReactNode; children: ReactNode; eyebrow?: string }) {
  useEffect(() => {
    document.title = `${title} · SismoNexo Colombia`
  }, [title])
  return (
    <div className="page">
      <div className="page-head">
        <div>
          {eyebrow && <div className="eyebrow" style={{ marginBottom: 6 }}>{eyebrow}</div>}
          <h1>{title}</h1>
          {lead && <p>{lead}</p>}
        </div>
        {actions && <div className="row wrap no-print">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
