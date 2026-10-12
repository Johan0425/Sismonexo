// Componentes base del sistema de diseño. Todos son accesibles por teclado y respetan el movimiento reducido.
import { AlertTriangle, CircleAlert, Info, Inbox, RefreshCw, WifiOff, X } from 'lucide-react'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import type { Async, DataError } from '@/lib/data'
import { fmtInt, fmtPct } from '@/lib/format'
import { P_CLASSES, pClass, pPosition, type PClass } from '@/lib/scales'
import { useApp } from '@/lib/store'

/** ¿Se permite el movimiento? Combina la preferencia del sistema con la de la aplicación. */
export function useMotionOk(): boolean {
  const sys = useReducedMotion()
  const pref = useApp((s) => s.prefs.motion)
  return !sys && pref !== 'reducido'
}
export const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 } as const

// ------------------------------------------------------------------ botones

type Variant = 'primary' | 'default' | 'outline' | 'ghost'
interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'md' | 'sm'
  icon?: ReactNode
}
export function Button({ variant = 'default', size = 'md', icon, children, type = 'button', ...rest }: BtnProps) {
  return (
    <button type={type} className="btn" data-variant={variant} data-size={size} {...rest}>
      {icon}
      {children}
    </button>
  )
}
interface IconBtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  label: string
  variant?: Variant
  size?: 'md' | 'sm'
  tip?: boolean
}
export function IconButton({ label, variant = 'ghost', size = 'md', tip = true, children, type = 'button', ...rest }: IconBtnProps) {
  const b = (
    <button type={type} className="btn" data-variant={variant} data-size={size} data-icon aria-label={label} {...rest}>
      {children}
    </button>
  )
  return tip ? <Tooltip text={label}>{b}</Tooltip> : b
}

// ------------------------------------------------------------------ tooltip

export function Tooltip({ text, children }: { text: string; children: ReactElement<Record<string, unknown>> }) {
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null)
  const id = useId()
  const show = (e: { currentTarget: EventTarget }) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const below = r.top < 56
    setPos({ x: Math.min(window.innerWidth - 150, Math.max(150, r.left + r.width / 2)), y: below ? r.bottom + 8 : r.top - 8, below })
  }
  const hide = () => setPos(null)
  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide()
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [pos])
  const p = children.props as Record<string, ((e: never) => void) | undefined>
  const chain = (name: string, fn: (e: never) => void) => (e: never) => {
    p[name]?.(e)
    fn(e)
  }
  return (
    <>
      {cloneElement(children, {
        onMouseEnter: chain('onMouseEnter', show as never),
        onMouseLeave: chain('onMouseLeave', hide),
        onFocus: chain('onFocus', show as never),
        onBlur: chain('onBlur', hide),
        'aria-describedby': pos ? id : undefined,
      })}
      {pos &&
        createPortal(
          <div role="tooltip" id={id} className="tooltip" style={{ left: pos.x, top: pos.y, transform: `translate(-50%, ${pos.below ? '0' : '-100%'})` }}>
            {text}
          </div>,
          document.body,
        )}
    </>
  )
}

// ------------------------------------------------------------------ campos

export function Field({ label, hint, error, children }: { label: string; hint?: string; error?: string; children: (p: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: boolean }) => ReactNode }) {
  const id = useId()
  const desc = error ? `${id}-e` : hint ? `${id}-h` : undefined
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children({ id, 'aria-describedby': desc, 'aria-invalid': error ? true : undefined })}
      {error ? (
        <span className="error" id={`${id}-e`} role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="hint" id={`${id}-h`}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export function Select<T extends string | number>({ label, value, options, onChange, hint }: { label: string; value: T; options: { value: T; label: string; disabled?: boolean }[]; onChange: (v: T) => void; hint?: string }) {
  return (
    <Field label={label} hint={hint}>
      {(p) => (
        <select
          {...p}
          className="select"
          value={String(value)}
          onChange={(e) => {
            const o = options.find((x) => String(x.value) === e.target.value)
            if (o) onChange(o.value)
          }}
        >
          {options.map((o) => (
            <option key={String(o.value)} value={String(o.value)} disabled={o.disabled}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  )
}

export function Segmented<T extends string | number>({ label, value, options, onChange, hideLabel = true }: { label: string; value: T; options: { value: T; label: string; title?: string }[]; onChange: (v: T) => void; hideLabel?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const move = (dir: number) => {
    const i = options.findIndex((o) => o.value === value)
    const next = options[(i + dir + options.length) % options.length]
    onChange(next.value)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus())
  }
  return (
    <div className={hideLabel ? undefined : 'field'}>
      <span className={hideLabel ? 'sr-only' : 'label'} id={`${label}-seg`}>
        {label}
      </span>
      <div
        ref={ref}
        className="segmented"
        role="radiogroup"
        aria-label={label}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') (e.preventDefault(), move(1))
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') (e.preventDefault(), move(-1))
        }}
      >
        {options.map((o) => (
          <button key={String(o.value)} type="button" role="radio" aria-checked={o.value === value} tabIndex={o.value === value ? 0 : -1} title={o.title} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  )
}

export function Switch({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  )
}

export function Slider({ label, value, min, max, step, onChange, format, hint, warn }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; format?: (v: number) => string; hint?: string; warn?: string }) {
  const id = useId()
  return (
    <div className="field">
      <div className="row between wrap" style={{ rowGap: 0 }}>
        <label htmlFor={id}>{label}</label>
        <output htmlFor={id} className="num small" style={{ fontWeight: 600 }}>
          {format ? format(value) : value}
        </output>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(+e.target.value)} aria-valuetext={format ? format(value) : undefined} aria-describedby={warn ? `${id}-w` : hint ? `${id}-h` : undefined} />
      {warn ? (
        <span className="error" id={`${id}-w`} role="status">
          {warn}
        </span>
      ) : hint ? (
        <span className="hint" id={`${id}-h`}>
          {hint}
        </span>
      ) : null}
    </div>
  )
}

export function Tabs<T extends string>({ label, value, tabs, onChange }: { label: string; value: T; tabs: { value: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div
      className="tabs"
      role="tablist"
      aria-label={label}
      onKeyDown={(e) => {
        const i = tabs.findIndex((t) => t.value === value)
        const d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0
        if (!d) return
        e.preventDefault()
        onChange(tabs[(i + d + tabs.length) % tabs.length].value)
        const el = e.currentTarget
        requestAnimationFrame(() => el.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus())
      }}
    >
      {tabs.map((t) => (
        <button key={t.value} type="button" role="tab" id={`tab-${t.value}`} aria-selected={t.value === value} tabIndex={t.value === value ? 0 : -1} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}

// ------------------------------------------------------------------ superficies

export function Card({ title, subtitle, actions, children, flat, as: As = 'section', style }: { title?: string; subtitle?: string; actions?: ReactNode; children: ReactNode; flat?: boolean; as?: 'section' | 'div' | 'article'; style?: CSSProperties }) {
  return (
    <As className={flat ? 'card flat' : 'card'} style={style}>
      {(title || actions) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <p>{subtitle}</p>}
          </div>
          {actions && <div className="row">{actions}</div>}
        </div>
      )}
      {children}
    </As>
  )
}

export function Note({ tone = 'neutral', children, role }: { tone?: 'neutral' | 'caution' | 'critical' | 'accent'; children: ReactNode; role?: 'note' | 'alert' | 'status' }) {
  const Icon = tone === 'caution' ? AlertTriangle : tone === 'critical' ? CircleAlert : Info
  return (
    <div className="note" data-tone={tone} role={role ?? 'note'}>
      <Icon size={18} aria-hidden />
      <div>{children}</div>
    </div>
  )
}

export function Pill({ tone, children, icon }: { tone?: 'caution' | 'critical' | 'positive' | 'accent'; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className="status-pill" data-tone={tone}>
      {icon}
      {children}
    </span>
  )
}

function useFocusTrap(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement as HTMLElement | null
    const el = ref.current
    const focusables = () => Array.from(el?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),input:not([disabled]),select,textarea,[tabindex]:not([tabindex="-1"])') ?? [])
    const t = setTimeout(() => (el?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0] ?? el)?.focus(), 30)
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
      } else if (e.key === 'Tab') {
        const f = focusables()
        if (!f.length) return
        const first = f[0]
        const last = f[f.length - 1]
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus())
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus())
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      clearTimeout(t)
      document.removeEventListener('keydown', onKey, true)
      prev?.focus?.()
    }
  }, [open, onClose])
  return ref
}

interface OverlayProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}
/** Ventana modal centrada (hoja inferior en teléfono). */
export function Modal({ open, onClose, title, children, footer, wide }: OverlayProps) {
  const ok = useMotionOk()
  const ref = useFocusTrap(open, onClose)
  const id = useId()
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.div
            ref={ref}
            className="modal glass"
            data-wide={wide}
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            tabIndex={-1}
            initial={ok ? { opacity: 0, scale: 0.97, y: 12 } : { opacity: 0 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={ok ? { opacity: 0, scale: 0.98, y: 8 } : { opacity: 0 }}
            transition={ok ? SPRING : { duration: 0.12 }}
          >
            <div className="modal-head">
              <h2 id={id}>{title}</h2>
              <IconButton label="Cerrar" onClick={onClose} tip={false}>
                <X size={20} aria-hidden />
              </IconButton>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-foot">{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

/** Hoja lateral (derecha en escritorio, inferior con resorte en teléfono). */
export function Sheet({ open, onClose, title, children, footer }: OverlayProps) {
  const ok = useMotionOk()
  const ref = useFocusTrap(open, onClose)
  const id = useId()
  const phone = typeof window !== 'undefined' && window.matchMedia('(max-width: 767px)').matches
  const hidden = phone ? { y: '100%' } : { x: '100%' }
  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }} onClick={onClose} />
          <motion.div
            ref={ref}
            className="sheet glass"
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            tabIndex={-1}
            initial={ok ? hidden : { opacity: 0 }}
            animate={ok ? { x: 0, y: 0 } : { opacity: 1 }}
            exit={ok ? hidden : { opacity: 0 }}
            transition={ok ? SPRING : { duration: 0.12 }}
            drag={phone && ok ? 'y' : false}
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.6 }}
            onDragEnd={(_, info) => (info.offset.y > 120 || info.velocity.y > 600) && onClose()}
          >
            <div className="modal-head">
              <h2 id={id}>{title}</h2>
              <IconButton label="Cerrar" onClick={onClose} tip={false}>
                <X size={20} aria-hidden />
              </IconButton>
            </div>
            <div className="modal-body">{children}</div>
            {footer && <div className="modal-foot">{footer}</div>}
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  )
}

// ------------------------------------------------------------------ estados

export function Skeleton({ h = 16, w = '100%', r }: { h?: number | string; w?: number | string; r?: number }) {
  return <div className="skeleton" style={{ height: h, width: w, borderRadius: r }} aria-hidden />
}
/** Esqueleto que imita una tarjeta con título, cifra y gráfico. */
export function CardSkeleton({ chart = 180 }: { chart?: number }) {
  return (
    <div className="card" role="status" aria-label="Cargando contenido">
      <div className="stack tight">
        <Skeleton w="38%" h={18} />
        <Skeleton w="62%" h={12} />
        <Skeleton h={chart} r={10} />
      </div>
    </div>
  )
}
export function PageSkeleton({ label = 'Cargando datos reales del catálogo…' }: { label?: string }) {
  return (
    <div className="page" role="status" aria-live="polite">
      <span className="sr-only">{label}</span>
      <div className="stack">
        <Skeleton w={280} h={30} />
        <Skeleton w="50%" h={14} />
        <div className="kpis" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div className="kpi" key={i}>
              <Skeleton w="60%" h={12} />
              <div style={{ height: 8 }} />
              <Skeleton w="40%" h={24} />
            </div>
          ))}
        </div>
        <div className="grid c2">
          <CardSkeleton />
          <CardSkeleton />
        </div>
      </div>
    </div>
  )
}
export function EmptyState({ title, children, action, icon }: { title: string; children?: ReactNode; action?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="state" role="status">
      {icon ?? <Inbox size={32} aria-hidden />}
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action}
    </div>
  )
}
export function ErrorState({ error, retry }: { error: DataError | { message: string; kind?: string }; retry?: () => void }) {
  const offline = error.kind === 'red'
  return (
    <div className="state" role="alert">
      {offline ? <WifiOff size={32} aria-hidden /> : <CircleAlert size={32} aria-hidden />}
      <h3>{offline ? 'Conexión interrumpida' : 'No fue posible cargar los datos'}</h3>
      <p>
        {error.message} {offline ? 'Revise su conexión; los datos ya cargados siguen disponibles.' : 'No se muestran valores de reemplazo: la vista queda vacía hasta que los datos reales estén disponibles.'}
      </p>
      {retry && (
        <Button variant="outline" icon={<RefreshCw size={16} aria-hidden />} onClick={retry}>
          Reintentar
        </Button>
      )}
    </div>
  )
}

/** Resuelve varios recursos asíncronos y muestra carga o error de forma uniforme. */
export function Gate<T extends readonly Async<unknown>[]>({ of, children, fallback }: { of: T; children: (...data: { [K in keyof T]: T[K] extends Async<infer D> ? D : never }) => ReactNode; fallback?: ReactNode }) {
  const err = of.find((a) => a.status === 'error')
  if (err && err.status === 'error') return <ErrorState error={err.error} retry={err.retry} />
  if (of.some((a) => a.status === 'loading')) return <>{fallback ?? <PageSkeleton />}</>
  return <>{children(...(of.map((a) => a.data) as never))}</>
}

// ------------------------------------------------------------------ cifras y probabilidad

/** Contador que anima el cambio de valor (se omite con movimiento reducido). */
export function Counter({ value, format = fmtInt }: { value: number; format?: (n: number) => string }) {
  const ok = useMotionOk()
  const [shown, setShown] = useState(value)
  const from = useRef(value)
  useEffect(() => {
    if (!ok || !Number.isFinite(value) || !Number.isFinite(from.current)) {
      from.current = value
      setShown(value)
      return
    }
    const a = from.current
    const t0 = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 420)
      const e = 1 - (1 - k) ** 3
      setShown(a + (value - a) * e)
      if (k < 1) raf = requestAnimationFrame(tick)
      else from.current = value
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      from.current = value
    }
  }, [value, ok])
  return <span className="num">{format(shown)}</span>
}

export interface Kpi {
  label: string
  value: ReactNode
  sub?: ReactNode
}
export function Kpis({ items, label }: { items: Kpi[]; label: string }) {
  const ok = useMotionOk()
  return (
    <dl className="kpis" aria-label={label}>
      {items.map((k, i) => (
        <motion.div className="kpi" key={k.label} initial={ok ? { opacity: 0, y: 6 } : false} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, delay: ok ? i * 0.04 : 0 }}>
          <dt>{k.label}</dt>
          <dd>
            {k.value}
            {k.sub && <div className="sub">{k.sub}</div>}
          </dd>
        </motion.div>
      ))}
    </dl>
  )
}

const PATTERN_CSS: Record<PClass['pattern'], (ink: string) => string | undefined> = {
  none: () => undefined,
  dots: (ink) => `radial-gradient(${ink} 1px, transparent 1.3px) 0 0 / 6px 6px`,
  lines: (ink) => `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px 6px)`,
  dense: (ink) => `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px 3.5px)`,
  cross: (ink) => `repeating-linear-gradient(45deg, ${ink} 0 1px, transparent 1px 5px), repeating-linear-gradient(-45deg, ${ink} 0 1px, transparent 1px 5px)`,
  solid: () => undefined,
}
export function swatchStyle(c: PClass): CSSProperties {
  const ink = c.i >= 4 ? 'rgba(0,0,0,.45)' : 'rgba(255,255,255,.6)'
  const pat = PATTERN_CSS[c.pattern](ink)
  return { background: pat ? `${pat}, ${c.color}` : c.color }
}

/** Escala probabilística: color + patrón + etiqueta + rango. ``value`` marca la clase vigente. */
export function ProbabilityScale({ value, compact }: { value?: number; compact?: boolean }) {
  const cur = value != null ? pClass(value).i : -1
  return (
    <div className="pscale" role="img" aria-label={`Escala de probabilidad en seis clases, de muy baja (menos de 1 %) a muy alta (más de 65 %).${value != null ? ` Valor actual: ${fmtPct(value)}, clase ${pClass(value).label}.` : ''}`}>
      {P_CLASSES.map((c) => (
        <div key={c.i}>
          <div className="sw" style={{ ...swatchStyle(c), outline: cur === c.i ? '2px solid var(--text)' : undefined, outlineOffset: 1, opacity: cur >= 0 && cur !== c.i ? 0.45 : 1 }} />
          {!compact && <div className="lb" style={cur === c.i ? { fontWeight: 720 } : undefined}>{c.label}</div>}
          <div className="rg">{c.range}</div>
        </div>
      ))}
    </div>
  )
}
export function ProbabilityBadge({ p }: { p: number }) {
  const c = pClass(p)
  return (
    <span className="pclass">
      <i style={swatchStyle(c)} aria-hidden />
      {c.label}
    </span>
  )
}
/** Probabilidad con sus cinco señales: valor, clase, color, patrón e intervalo de incertidumbre. */
export function ProbabilityValue({ p, lo, hi, level = 90 }: { p: number; lo?: number; hi?: number; level?: number }) {
  return (
    <div className="stack tight">
      <div className="pvalue">
        <span className="big">{fmtPct(p)}</span>
        <ProbabilityBadge p={p} />
      </div>
      {lo != null && hi != null && (
        <div>
          <div className="interval" role="img" aria-label={`Intervalo de incertidumbre del ${level} %: de ${fmtPct(lo)} a ${fmtPct(hi)}.`}>
            <div className="track" />
            <div className="band" style={{ left: `${pPosition(lo) * 100}%`, width: `${Math.max(1, (pPosition(hi) - pPosition(lo)) * 100)}%` }} />
            <div className="dot" style={{ left: `${pPosition(p) * 100}%` }} />
          </div>
          <div className="caption num">
            Intervalo de incertidumbre ({level} %): {fmtPct(lo)} – {fmtPct(hi)}
          </div>
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ avisos

export function Toasts() {
  const toasts = useApp((s) => s.toasts)
  const dismiss = useApp((s) => s.dismissToast)
  const ok = useMotionOk()
  return (
    <div className="toasts">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.div key={t.id} className="toast" initial={ok ? { opacity: 0, y: 16 } : { opacity: 0 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                onClick={() => {
                  t.action?.run()
                  dismiss(t.id)
                }}
              >
                {t.action.label}
              </button>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}
/** Región viva para anunciar cambios de filtros a lectores de pantalla. */
export function LiveRegion() {
  const live = useApp((s) => s.live)
  return (
    <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
      {live}
    </div>
  )
}

/** Mide el ancho disponible de un contenedor (para gráficos adaptables). */
export function useWidth<T extends HTMLElement>(initial = 600): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(initial)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const set = () => setW(Math.max(240, Math.round(el.getBoundingClientRect().width)))
    set()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(set)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

export function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms)
    return () => clearTimeout(t)
  }, [value, ms])
  return v
}

export function useKey(handler: (e: KeyboardEvent) => void) {
  const h = useRef(handler)
  h.current = handler
  const stable = useCallback((e: KeyboardEvent) => h.current(e), [])
  useEffect(() => {
    window.addEventListener('keydown', stable)
    return () => window.removeEventListener('keydown', stable)
  }, [stable])
}
