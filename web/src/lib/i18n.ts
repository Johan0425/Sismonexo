// Traducción de la interfaz en tiempo de ejecución.
//
// El español es el idioma de origen: todo el código escribe en español. Para los demás idiomas, este módulo
// observa el documento y sustituye cada texto visible (y los atributos accesibles) por su traducción, tomada de
// un diccionario que se descarga solo cuando se elige ese idioma (public/i18n/<idioma>.json).
//
// Las cifras y fechas se separan del texto antes de buscar en el diccionario («{0} eventos cumplen los filtros.»),
// de modo que una sola entrada sirve para cualquier valor, y se vuelven a escribir con el formato del idioma.
// Lo que no está en el diccionario se deja en español: nunca se inventa una traducción.

export type Lang = 'es' | 'en' | 'pt'
export const LANGS: { code: Lang; short: string; name: string; html: string }[] = [
  { code: 'es', short: 'ES', name: 'Español', html: 'es-CO' },
  { code: 'en', short: 'EN', name: 'English', html: 'en' },
  { code: 'pt', short: 'PT', name: 'Português', html: 'pt-BR' },
]
const ATTRS = ['aria-label', 'placeholder', 'title', 'alt', 'aria-valuetext']
const SKIP = new Set(['SCRIPT', 'STYLE', 'CODE', 'TEXTAREA', 'NOSCRIPT'])

const MONTHS_ES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const MONTHS_LONG = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
const MONTH_OUT: Record<Exclude<Lang, 'es'>, { short: string[]; long: string[] }> = {
  en: { short: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'], long: ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] },
  pt: { short: ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'], long: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'] },
}
// «sept» es la abreviatura que usa es-CO para septiembre.
const M = `(${[...MONTHS_LONG, 'sept', ...MONTHS_ES].join('|')})\\.?`
// Orden: fecha completa, mes y año, número (con separadores del español).
const TOKEN = new RegExp(`(\\d{1,2}) de ${M} de (\\d{4})|\\b${M} (?:de )?(\\d{4})\\b|\\d+(?:[.,]\\d+)*`, 'gi')

type Token = { kind: 'date'; d: number; m: number; long: boolean; y: string } | { kind: 'month'; m: number; long: boolean; y: string } | { kind: 'num'; raw: string }
const monthIndex = (s: string) => {
  const k = s.toLowerCase().replace('.', '').replace(/^sept$/, 'sep')
  const i = MONTHS_LONG.indexOf(k)
  return i >= 0 ? { m: i, long: true } : { m: MONTHS_ES.indexOf(k), long: false }
}

/** Separa cifras y fechas: «10 de oct de 2026 · 66.987 eventos» → «{0} · {1} eventos». */
export function normalize(text: string): { key: string; tokens: Token[] } {
  const tokens: Token[] = []
  const key = text.replace(TOKEN, (raw, d, m1, y1, m2, y2) => {
    if (d && m1) tokens.push({ kind: 'date', d: +d, ...monthIndex(m1), y: y1 })
    else if (m2 && y2) tokens.push({ kind: 'month', ...monthIndex(m2), y: y2 })
    else tokens.push({ kind: 'num', raw })
    return `{${tokens.length - 1}}`
  })
  return { key: key.replace(/\s+/g, ' ').trim(), tokens }
}

function renderToken(t: Token, lang: Exclude<Lang, 'es'>): string {
  const mo = MONTH_OUT[lang]
  if (t.kind === 'date') {
    const name = (t.long ? mo.long : mo.short)[t.m]
    return lang === 'en' ? `${name} ${t.d}, ${t.y}` : `${t.d} de ${name} de ${t.y}`
  }
  if (t.kind === 'month') {
    const name = (t.long ? mo.long : mo.short)[t.m]
    return lang === 'en' ? `${name} ${t.y}` : `${name} de ${t.y}`
  }
  // En inglés se invierten los separadores solo si el número tiene forma de cifra española (1.234,5 · 0,35 · 66.987).
  if (lang === 'en' && /^(\d{1,3}(\.\d{3})+(,\d+)?|\d+,\d+)$/.test(t.raw)) return t.raw.replace(/[.,]/g, (c) => (c === '.' ? ',' : '.'))
  return t.raw
}

export type Dict = Record<string, string>

const compiled = new WeakMap<Dict, [RegExp, string][]>()
/** Patrones del diccionario: clave «~^expresión$» → plantilla con $1, $2… para las partes capturadas. */
function patterns(dict: Dict): [RegExp, string][] {
  let p = compiled.get(dict)
  if (!p) {
    p = Object.entries(dict).filter(([k]) => k.startsWith('~')).map(([k, v]) => [new RegExp(k.slice(1)), v] as [RegExp, string])
    compiled.set(dict, p)
  }
  return p
}

/** Traduce un texto completo conservando los espacios de los extremos. Devuelve null si no hay traducción. */
export function translate(text: string, dict: Dict, lang: Exclude<Lang, 'es'>): string | null {
  const { key, tokens } = normalize(text)
  if (!/[A-Za-zÁÉÍÓÚÑáéíóúñ]/.test(key.replace(/\{\d+\}/g, ''))) {
    // Solo cifras, fechas y signos: se reescriben con el formato del idioma.
    if (!tokens.length) return null
    const out = key.replace(/\{(\d+)\}/g, (_, i) => renderToken(tokens[+i], lang))
    return out === text.trim() ? null : text.replace(text.trim(), out)
  }
  let hit: string | undefined = dict[key]
  if (hit == null) {
    // Familias de textos que incluyen un nombre propio (lugar, modelo…): se resuelven con patrones.
    for (const [re, tpl] of patterns(dict)) {
      const m = re.exec(key)
      if (!m) continue
      hit = tpl.replace(/\$(\d)/g, (_, g) => {
        const part = m[+g] ?? ''
        return dict[part] ?? part
      })
      break
    }
  }
  if (hit == null) return null
  const out = hit.replace(/\{(\d+)\}/g, (m0, i) => (tokens[+i] ? renderToken(tokens[+i], lang) : m0))
  const lead = /^\s*/.exec(text)?.[0] ?? ''
  const trail = /\s*$/.exec(text)?.[0] ?? ''
  return lead + out + trail
}

// ------------------------------------------------------------------ aplicación sobre el documento

let lang: Lang = 'es'
let dict: Dict = {}
let observer: MutationObserver | null = null
/** Texto original en español de cada nodo y lo último que este módulo escribió en él. */
const original = new WeakMap<Node, string>()
const written = new WeakMap<Node, string>()
const attrOriginal = new WeakMap<Element, Record<string, string>>()
/** Claves vistas sin traducción (para completar los diccionarios). */
export const missing = new Set<string>()
const cache = new Map<Lang, Promise<Dict>>()

function skip(node: Node): boolean {
  for (let el = node.nodeType === 1 ? (node as Element) : node.parentElement; el; el = el.parentElement) {
    if (SKIP.has(el.tagName) || el.hasAttribute('data-no-i18n') || (el as HTMLElement).isContentEditable) return true
  }
  return false
}
function textNode(n: Text) {
  const cur = n.nodeValue ?? ''
  // Si el valor no es el que escribimos, React puso un texto nuevo en español: pasa a ser el original.
  if (written.get(n) !== cur) original.set(n, cur)
  const src = original.get(n) ?? cur
  if (lang === 'es') {
    if (cur !== src) n.nodeValue = src
    written.delete(n)
    return
  }
  if (!src.trim() || skip(n)) return
  const out = translate(src, dict, lang)
  if (out == null) {
    if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(src)) missing.add(normalize(src).key)
    return
  }
  if (cur !== out) {
    written.set(n, out)
    n.nodeValue = out
  }
}
function element(el: Element) {
  if (skip(el)) return
  let store = attrOriginal.get(el)
  for (const a of ATTRS) {
    const cur = el.getAttribute(a)
    if (cur == null) continue
    if (!store) attrOriginal.set(el, (store = {}))
    const mark = `\u0001${a}`
    if (store[mark] !== cur) store[a] = cur
    const src = store[a]
    if (lang === 'es') {
      if (cur !== src) el.setAttribute(a, src)
      delete store[mark]
      continue
    }
    const out = translate(src, dict, lang)
    if (out == null) {
      if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(src)) missing.add(normalize(src).key)
      continue
    }
    if (cur !== out) {
      store[mark] = out
      el.setAttribute(a, out)
    }
  }
}
function walk(root: Node) {
  if (root.nodeType === 3) return textNode(root as Text)
  if (root.nodeType !== 1) return
  element(root as Element)
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
  for (let n = w.nextNode(); n; n = w.nextNode()) (n.nodeType === 3 ? textNode(n as Text) : element(n as Element))
}
function title() {
  const t = document.querySelector('title')
  if (t?.firstChild) textNode(t.firstChild as Text)
}

function start() {
  if (observer) return
  observer = new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === 'characterData') textNode(m.target as Text)
      else if (m.type === 'attributes') element(m.target as Element)
      else m.addedNodes.forEach(walk)
    }
  })
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS })
}

export function loadDict(l: Lang): Promise<Dict> {
  if (l === 'es') return Promise.resolve({})
  let p = cache.get(l)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}i18n/${l}.json`)
      .then((r) => (r.ok ? (r.json() as Promise<Dict>) : Promise.reject(new Error(String(r.status)))))
      .catch((e) => {
        cache.delete(l)
        throw e
      })
    cache.set(l, p)
  }
  return p
}

/** Cambia el idioma de la interfaz. Devuelve false si no fue posible cargar el diccionario. */
export async function setLanguage(next: Lang): Promise<boolean> {
  let d: Dict = {}
  if (next !== 'es') {
    try {
      d = await loadDict(next)
    } catch {
      return false
    }
  }
  lang = next
  dict = d
  document.documentElement.lang = LANGS.find((x) => x.code === next)?.html ?? 'es-CO'
  if (next !== 'es') start()
  if (observer) {
    walk(document.body)
    title()
  }
  return true
}
export const currentLanguage = () => lang

// Solo en desarrollo: permite al script de recolección (scripts/harvest-i18n.mjs) usar la misma normalización.
if (import.meta.env.DEV && typeof window !== 'undefined') (window as unknown as { __i18n: unknown }).__i18n = { normalize, ATTRS, SKIP: [...SKIP], missing }
