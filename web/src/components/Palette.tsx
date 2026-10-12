// Paleta de comandos (búsqueda global), atajos de teclado y recorrido inicial.
import { BookOpen, CornerDownLeft, Link2, LocateFixed, MapPin, Maximize, MessageCircle, Moon, Presentation, Redo2, RotateCcw, Search, SwatchBook, Undo2 } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { mapBus } from '@/lib/bus'
import { loadGeo, loadZones, useAsync } from '@/lib/data'
import { fmtCoord, fold } from '@/lib/format'
import { BBOX, featureBounds } from '@/lib/geo'
import { GLOSSARY } from '@/lib/glossary'
import { ROUTES } from '@/lib/routes'
import { useApp } from '@/lib/store'
import { MOD } from './Shell'
import { Button, Modal, SPRING, useKey, useMotionOk } from './ui'

interface Item {
  id: string
  group: string
  label: string
  meta?: string
  icon: ReactNode
  run: () => void
  keys: string
}

export function toggleFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen()
  else void document.documentElement.requestFullscreen?.().catch(() => undefined)
}
export async function copyLink(): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(window.location.href)
    return true
  } catch {
    return false
  }
}

export function CommandPalette() {
  const open = useApp((s) => s.palette)
  const setOpen = useApp((s) => s.setOpen)
  const navigate = useNavigate()
  const ok = useMotionOk()
  const [q, setQ] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const deps = useAsync(() => (open ? loadZones('dep') : new Promise<never>(() => undefined)), [open])
  const muns = useAsync(() => (open ? loadZones('mun') : new Promise<never>(() => undefined)), [open])
  const close = () => setOpen('palette', false)

  useEffect(() => {
    if (!open) return
    setQ('')
    setActive(0)
    const prev = document.activeElement as HTMLElement | null
    const t = setTimeout(() => input.current?.focus(), 20)
    return () => {
      clearTimeout(t)
      prev?.focus?.()
    }
  }, [open])

  const base = useMemo<Item[]>(() => {
    const s = useApp.getState
    const go = (path: string) => () => navigate(path)
    const views: Item[] = ROUTES.map((r) => ({ id: `v${r.path}`, group: 'Vistas', label: r.label, meta: r.description, icon: <r.icon size={18} aria-hidden />, run: go(r.path), keys: fold(`${r.label} ${r.description}`) }))
    views.push({ id: 'v/historia', group: 'Vistas', label: 'Modo historia', meta: 'Presentación del proyecto en diez capítulos', icon: <Presentation size={18} aria-hidden />, run: go('/historia'), keys: 'modo historia presentacion clase' })
    views.push({ id: 'v/sistema', group: 'Vistas', label: 'Sistema de diseño', meta: 'Prueba de componentes, paleta y estados', icon: <SwatchBook size={18} aria-hidden />, run: go('/sistema'), keys: 'sistema de diseno componentes design test' })
    const actions: Item[] = [
      { id: 'a-theme', group: 'Acciones', label: 'Cambiar entre modo claro y oscuro', meta: 'T', icon: <Moon size={18} aria-hidden />, run: () => s().setPrefs({ theme: document.documentElement.dataset.theme === 'oscuro' ? 'claro' : 'oscuro' }), keys: 'tema claro oscuro modo' },
      { id: 'a-undo', group: 'Acciones', label: 'Deshacer el último cambio de filtros', meta: `${MOD} Z`, icon: <Undo2 size={18} aria-hidden />, run: () => s().undo(), keys: 'deshacer filtros' },
      { id: 'a-redo', group: 'Acciones', label: 'Rehacer', meta: `⇧ ${MOD} Z`, icon: <Redo2 size={18} aria-hidden />, run: () => s().redo(), keys: 'rehacer filtros' },
      { id: 'a-reset', group: 'Acciones', label: 'Restablecer todos los filtros', icon: <RotateCcw size={18} aria-hidden />, run: () => s().resetFilters(), keys: 'restablecer limpiar filtros' },
      {
        id: 'a-link',
        group: 'Acciones',
        label: 'Copiar enlace a esta vista',
        icon: <Link2 size={18} aria-hidden />,
        run: () => void copyLink().then((okc) => s().toast(okc ? 'Enlace copiado. Incluye los filtros y la vista del mapa.' : 'No fue posible copiar; copie la dirección del navegador.')),
        keys: 'copiar enlace compartir url',
      },
      { id: 'a-full', group: 'Acciones', label: 'Pantalla completa', meta: 'F', icon: <Maximize size={18} aria-hidden />, run: toggleFullscreen, keys: 'pantalla completa' },
      { id: 'a-nexo', group: 'Acciones', label: 'Preguntar al asistente Nexo', meta: 'N', icon: <MessageCircle size={18} aria-hidden />, run: () => s().setOpen('nexo', true), keys: 'nexo asistente preguntar consulta' },
      { id: 'a-keys', group: 'Acciones', label: 'Ver atajos de teclado', meta: '?', icon: <Search size={18} aria-hidden />, run: () => s().setOpen('shortcuts', true), keys: 'atajos teclado ayuda' },
      { id: 'a-tour', group: 'Acciones', label: 'Repetir el recorrido inicial', icon: <BookOpen size={18} aria-hidden />, run: () => s().setOpen('onboarding', true), keys: 'recorrido tour introduccion onboarding ayuda' },
    ]
    const terms: Item[] = GLOSSARY.map((t) => ({ id: `g${t.id}`, group: 'Glosario', label: t.term, meta: t.short, icon: <BookOpen size={18} aria-hidden />, run: () => navigate('/aprender', { state: { term: t.id } }), keys: fold(`${t.term} ${(t.aliases ?? []).join(' ')}`) }))
    return [...views, ...actions, ...terms]
  }, [navigate])

  const places = useMemo<Item[]>(() => {
    const out: Item[] = []
    const s = useApp.getState
    if (deps.status === 'ready')
      deps.data.id.forEach((id, i) =>
        out.push({
          id: `d${id}`,
          group: 'Departamentos',
          label: deps.data.name[i],
          meta: 'Filtrar y acercar el atlas',
          icon: <MapPin size={18} aria-hidden />,
          keys: fold(deps.data.name[i]),
          run: () => {
            s().setFilters({ dept: id }, `Departamento: ${deps.data.name[i]}`)
            navigate('/atlas')
            void loadGeo('dep').then((fc) => {
              const f = fc.features.find((x) => x.properties.id === id)
              if (f) mapBus.send({ type: 'fit', bounds: featureBounds(f.geometry) })
            })
          },
        }),
      )
    if (muns.status === 'ready')
      muns.data.id.forEach((id, i) =>
        out.push({
          id: `m${id}`,
          group: 'Municipios',
          label: muns.data.name[i],
          meta: 'Acercar el atlas',
          icon: <MapPin size={18} aria-hidden />,
          keys: fold(muns.data.name[i]),
          run: () => {
            navigate('/atlas')
            mapBus.send({ type: 'fly', center: [muns.data.lon[i], muns.data.lat[i]], zoom: 9.2 })
          },
        }),
      )
    return out
  }, [deps, muns, navigate])

  const results = useMemo<Item[]>(() => {
    const f = fold(q.trim())
    const coord = /^\s*(-?\d+(?:[.,]\d+)?)\s*[,; ]\s*(-?\d+(?:[.,]\d+)?)\s*$/.exec(q)
    const out: Item[] = []
    if (coord) {
      const lat = +coord[1].replace(',', '.')
      const lon = +coord[2].replace(',', '.')
      const inside = lat >= BBOX.lat_min && lat <= BBOX.lat_max && lon >= BBOX.lon_min && lon <= BBOX.lon_max
      out.push({
        id: 'coord',
        group: 'Coordenadas',
        label: inside ? `Ir a ${fmtCoord(lat, lon)}` : 'Coordenadas fuera de la ventana de estudio',
        meta: inside ? 'Latitud, longitud (WGS84)' : 'Use latitud entre −5 y 14 y longitud entre −83 y −66',
        icon: <LocateFixed size={18} aria-hidden />,
        keys: '',
        run: () => {
          if (!inside) return
          navigate('/atlas')
          mapBus.send({ type: 'fly', center: [lon, lat], zoom: 9 })
        },
      })
    }
    if (!f) return [...out, ...base.filter((i) => i.group !== 'Glosario').slice(0, 14)]
    const words = f.split(/\s+/)
    const match = (i: Item) => words.every((w) => i.keys.includes(w))
    const groups = new Map<string, Item[]>()
    for (const i of [...base, ...places]) {
      if (!match(i)) continue
      const g = groups.get(i.group) ?? []
      if (g.length < 6) g.push(i)
      groups.set(i.group, g)
    }
    // Las coincidencias que empiezan por el texto buscado van primero dentro de cada grupo.
    for (const g of groups.values()) g.sort((a, b) => Number(b.keys.startsWith(f)) - Number(a.keys.startsWith(f)))
    return [...out, ...['Departamentos', 'Municipios', 'Vistas', 'Acciones', 'Glosario'].flatMap((g) => groups.get(g) ?? [])]
  }, [q, base, places])

  useEffect(() => setActive(0), [q])
  useEffect(() => {
    list.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const run = (i: Item | undefined) => {
    if (!i) return
    close()
    i.run()
  }
  let lastGroup = ''
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }} onClick={close} />
          <motion.div
            className="modal glass"
            style={{ top: 'min(18dvh, 140px)', translate: '-50% 0', width: 'min(640px, calc(100vw - 24px))', maxHeight: '70dvh' }}
            role="dialog"
            aria-modal="true"
            aria-label="Búsqueda global y comandos"
            initial={ok ? { opacity: 0, scale: 0.97, y: -8 } : { opacity: 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={ok ? SPRING : { duration: 0.1 }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') (e.stopPropagation(), close())
              else if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(results.length - 1, a + 1)))
              else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)))
              else if (e.key === 'Enter') (e.preventDefault(), run(results[active]))
              else if (e.key === 'Tab') e.preventDefault()
            }}
          >
            <div className="row" style={{ padding: '12px 16px', borderBottom: '1px solid var(--glass-border)', gap: 12 }}>
              <Search size={20} aria-hidden style={{ color: 'var(--text-2)', flex: 'none' }} />
              <input
                ref={input}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Departamento, municipio, «4.6, -74.1», vista o acción"
                aria-label="Buscar"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={results[active] ? `pal-${results[active].id}` : undefined}
                autoComplete="off"
                spellCheck={false}
                style={{ flex: 1, minWidth: 0, height: 36, border: 0, outline: 0, background: 'transparent', fontSize: '1.0625rem' }}
              />
              <span className="kbd" aria-hidden>
                Esc
              </span>
            </div>
            <div ref={list} id="palette-list" role="listbox" aria-label="Resultados" style={{ overflow: 'auto', padding: 8 }}>
              {results.length === 0 && (
                <div className="state" style={{ minHeight: 120, padding: 24 }}>
                  <p>Sin resultados para «{q}». Pruebe con el nombre de un departamento, un municipio o un par de coordenadas (latitud, longitud).</p>
                </div>
              )}
              {results.map((i, k) => {
                const head = i.group !== lastGroup
                lastGroup = i.group
                return (
                  <div key={i.id}>
                    {head && (
                      <div className="eyebrow" style={{ padding: '10px 12px 4px' }} aria-hidden>
                        {i.group}
                      </div>
                    )}
                    <button type="button" id={`pal-${i.id}`} role="option" aria-selected={k === active} data-active={k === active} className="menu-item" tabIndex={-1} onPointerMove={() => setActive(k)} onClick={() => run(i)}>
                      <span style={{ color: 'var(--text-2)', flex: 'none' }}>{i.icon}</span>
                      <span style={{ minWidth: 0 }}>
                        <span style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{i.label}</span>
                        {i.meta && i.meta.length > 6 && (
                          <span className="caption" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {i.meta}
                          </span>
                        )}
                      </span>
                      {i.meta && i.meta.length <= 6 ? <span className="meta kbd">{i.meta}</span> : k === active ? <CornerDownLeft size={16} aria-hidden className="meta" /> : null}
                    </button>
                  </div>
                )
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

const SHORTCUTS: [string, string][] = [
  [`${MOD} K  o  /`, 'Abrir la búsqueda global y la paleta de comandos'],
  ['?', 'Mostrar esta lista de atajos'],
  ['G luego I, A, P, H', 'Ir a Inicio, Atlas, Pronóstico o Histórico'],
  ['G luego L, M, C, E', 'Ir a Laboratorio, Modelos, Calidad o Metodología'],
  [`${MOD} Z`, 'Deshacer el último cambio de filtros'],
  [`⇧ ${MOD} Z`, 'Rehacer'],
  ['T', 'Cambiar entre modo claro y oscuro'],
  ['F', 'Pantalla completa'],
  ['N', 'Abrir el asistente Nexo'],
  ['Esc', 'Cerrar paneles, hojas y ventanas'],
  ['Mapa: flechas', 'Desplazar el mapa (con el mapa enfocado)'],
  ['Mapa: + y −', 'Acercar y alejar'],
  ['Mapa: ⇧ + flechas', 'Rotar e inclinar'],
  ['Mapa: 0', 'Volver a la extensión nacional'],
  ['Línea de tiempo: Espacio', 'Reproducir o pausar'],
  ['Línea de tiempo: ← →', 'Retroceder o adelantar un paso'],
  ['Modo historia: ← → Espacio', 'Capítulo anterior o siguiente'],
]

export function ShortcutsDialog() {
  const open = useApp((s) => s.shortcuts)
  const setOpen = useApp((s) => s.setOpen)
  return (
    <Modal open={open} onClose={() => setOpen('shortcuts', false)} title="Atajos de teclado">
      <table className="table">
        <caption className="sr-only">Atajos de teclado disponibles</caption>
        <thead>
          <tr>
            <th scope="col">Teclas</th>
            <th scope="col">Acción</th>
          </tr>
        </thead>
        <tbody>
          {SHORTCUTS.map(([k, d]) => (
            <tr key={k}>
              <th scope="row" style={{ whiteSpace: 'nowrap' }}>
                <span className="kbd">{k}</span>
              </th>
              <td style={{ whiteSpace: 'normal' }}>{d}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Modal>
  )
}

const STEPS: { title: string; body: string }[] = [
  {
    title: 'Bienvenida a SismoNexo Colombia',
    body: 'Este es un atlas académico de la actividad sísmica de Colombia. Trabaja con registros reales del Servicio Geológico Colombiano y estima probabilidades de actividad por zona y periodo. No predice sismos individuales ni emite alertas.',
  },
  {
    title: '1. Explore el atlas',
    body: 'En «Atlas sísmico» verá cada evento del catálogo. Filtre por fecha, magnitud, profundidad y departamento; cada cambio actualiza el mapa, los gráficos y la dirección del navegador, que puede compartir.',
  },
  {
    title: '2. Lea el pronóstico como probabilidad',
    body: 'En «Pronóstico probabilístico» cada zona muestra la probabilidad de registrar al menos un evento sobre el umbral en los próximos 7, 30 o 90 días, siempre con su intervalo de incertidumbre. Una probabilidad alta no es certeza; una baja no es ausencia de actividad.',
  },
  {
    title: '3. Pregunte por qué',
    body: 'Seleccione una zona y use «¿Por qué el modelo muestra este valor?». Verá qué variables pesaron, cómo se compara con la línea base y con periodos parecidos del pasado. Son asociaciones del modelo, no causas.',
  },
  {
    title: '4. Revise la evidencia',
    body: 'El «Comparador de modelos» muestra la validación cronológica y el detector de fugas; «Calidad de los datos» documenta cada regla de limpieza. Presione ? para ver los atajos y ' + MOD + ' K para buscar cualquier cosa.',
  },
]

export function Onboarding() {
  const open = useApp((s) => s.onboarding)
  const setOpen = useApp((s) => s.setOpen)
  const navigate = useNavigate()
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (open) setStep(0)
  }, [open])
  const last = step === STEPS.length - 1
  const close = () => setOpen('onboarding', false)
  return (
    <Modal
      open={open}
      onClose={close}
      title={STEPS[step].title}
      footer={
        <>
          <span className="caption grow" aria-live="polite">
            Paso {step + 1} de {STEPS.length}
          </span>
          <Button variant="ghost" onClick={close}>
            Omitir
          </Button>
          {step > 0 && <Button onClick={() => setStep(step - 1)}>Anterior</Button>}
          <Button
            variant="primary"
            data-autofocus
            onClick={() => {
              if (!last) return setStep(step + 1)
              close()
              navigate('/atlas')
            }}
          >
            {last ? 'Abrir el atlas' : 'Siguiente'}
          </Button>
        </>
      }
    >
      <p style={{ maxWidth: '56ch' }}>{STEPS[step].body}</p>
      <div className="progress" style={{ marginTop: 20 }} aria-hidden>
        <i style={{ width: `${((step + 1) / STEPS.length) * 100}%` }} />
      </div>
    </Modal>
  )
}

const GO: Record<string, string> = { i: '/', a: '/atlas', p: '/pronostico', h: '/historico', l: '/laboratorio', m: '/modelos', c: '/calidad', e: '/metodologia' }

/** Atajos globales. Se ignoran mientras se escribe en un campo. */
export function GlobalKeys() {
  const navigate = useNavigate()
  const gAt = useRef(0)
  useKey((e) => {
    const s = useApp.getState()
    const mod = e.metaKey || e.ctrlKey
    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault()
      s.setOpen('palette', !s.palette)
      return
    }
    const el = e.target as HTMLElement | null
    const typing = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    // Con el foco dentro de un diálogo, las teclas pertenecen al diálogo.
    if (typing || s.palette || el?.closest('[role="dialog"]')) return
    if (mod && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) s.redo()
      else s.undo()
      return
    }
    if (mod || e.altKey || !s.prefs.keys) return
    const k = e.key.toLowerCase()
    if (Date.now() - gAt.current < 1200 && GO[k]) {
      gAt.current = 0
      e.preventDefault()
      navigate(GO[k])
      return
    }
    if (k === 'g') gAt.current = Date.now()
    else if (e.key === '?') (e.preventDefault(), s.setOpen('shortcuts', true))
    else if (e.key === '/') (e.preventDefault(), s.setOpen('palette', true))
    else if (k === 't') s.setPrefs({ theme: document.documentElement.dataset.theme === 'oscuro' ? 'claro' : 'oscuro' })
    else if (k === 'f') toggleFullscreen()
    else if (k === 'n') s.setOpen('nexo', true)
  })
  return null
}
