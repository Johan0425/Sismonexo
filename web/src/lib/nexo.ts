// Nexo: intérprete de consultas en lenguaje natural basado en reglas (sin modelo generativo).
// Convierte la consulta en filtros o en un cálculo sobre los datos reales; si no entiende, lo dice.
import { fold } from './format'
import { GLOSSARY, type Term } from './glossary'
import type { Filters } from './store'

export type Intent =
  | { kind: 'filtrar'; patch: Partial<Filters>; applied: string[] }
  | { kind: 'comparar-profundidad'; depts: string[]; patch: Partial<Filters>; applied: string[] }
  | { kind: 'mayor-actividad'; days: number }
  | { kind: 'explicar-zona' }
  | { kind: 'informe-zona' }
  | { kind: 'glosario'; term: Term }
  | { kind: 'distinguir' }
  | { kind: 'mejor-calibrado' }
  | { kind: 'no-alerta' }
  | { kind: 'ayuda' }
  | { kind: 'desconocido' }

export interface Dept {
  code: string
  name: string
}
const num = (s: string) => Number(s.replace(',', '.'))
const iso = (t: number) => new Date(t).toISOString().slice(0, 10)
const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

export function findDepts(q: string, depts: Dept[]): Dept[] {
  const f = ` ${fold(q)} `
  const alias: Record<string, string> = { bogota: '11', 'valle del cauca': '76', valle: '76', 'san andres': '88', guajira: '44', 'norte de santander': '54' }
  const hits = new Map<string, { d: Dept; at: number }>()
  // Los nombres largos primero: «Norte de Santander» no debe contarse también como «Santander».
  let rest = f
  for (const d of [...depts].sort((a, b) => b.name.length - a.name.length)) {
    const n = fold(d.name).replace(/, d\. c\.|archipielago de /g, '').trim()
    const at = rest.indexOf(` ${n}`)
    if (at >= 0 && /[^a-z]/.test(rest[at + n.length + 1] ?? ' ')) {
      hits.set(d.code, { d, at })
      rest = rest.slice(0, at) + ' '.repeat(n.length + 1) + rest.slice(at + n.length + 1)
    }
  }
  for (const [k, code] of Object.entries(alias)) {
    const at = rest.indexOf(` ${k}`)
    const d = depts.find((x) => x.code === code)
    if (at >= 0 && d && !hits.has(code)) hits.set(code, { d, at })
  }
  return [...hits.values()].sort((a, b) => a.at - b.at).map((h) => h.d)
}

/** Extrae filtros de fecha, magnitud, profundidad y ubicación. ``today`` es el último día del catálogo. */
export function extractFilters(q: string, depts: Dept[], today: string): { patch: Partial<Filters>; applied: string[]; depts: Dept[] } {
  const f = fold(q)
  const patch: Partial<Filters> = {}
  const applied: string[] = []
  const end = Date.parse(`${today}T00:00:00Z`)

  let m = /magnitud(?:es)?\s+(?:entre|de)\s+(\d+(?:[.,]\d+)?)\s+(?:y|a)\s+(\d+(?:[.,]\d+)?)/.exec(f)
  if (m) {
    patch.magMin = num(m[1])
    patch.magMax = num(m[2])
    applied.push(`magnitud entre ${m[1]} y ${m[2]}`)
  } else if ((m = /(?:magnitud(?:es)?|m)\s*(?:mayor(?:es)?|superior(?:es)?|por encima|mas de|>=?|≥)\s*(?:o igual\s*)?(?:a|de|que)?\s*(\d+(?:[.,]\d+)?)/.exec(f) ?? /(?:mayor(?:es)?|superior(?:es)?)\s+(?:a|de|que)\s+(\d+(?:[.,]\d+)?)\s*(?:de magnitud|grados)?/.exec(f) ?? /m\s*(?:>=?|≥)\s*(\d+(?:[.,]\d+)?)/.exec(f))) {
    patch.magMin = num(m[1])
    patch.magMax = 9
    applied.push(`magnitud ≥ ${m[1].replace('.', ',')}`)
  } else if ((m = /(?:magnitud(?:es)?)\s*(?:menor(?:es)?|inferior(?:es)?|<=?|≤)\s*(?:o igual\s*)?(?:a|de|que)?\s*(\d+(?:[.,]\d+)?)/.exec(f))) {
    patch.magMax = num(m[1])
    applied.push(`magnitud ≤ ${m[1].replace('.', ',')}`)
  }

  if ((m = /ultim[oa]s?\s+(\d+)?\s*(dia|dias|semana|semanas|mes|meses|ano|anos)/.exec(f))) {
    const n = m[1] ? +m[1] : 1
    const unit = m[2].startsWith('dia') ? 1 : m[2].startsWith('semana') ? 7 : m[2].startsWith('mes') ? 30.44 : 365.25
    patch.from = iso(end - Math.round(n * unit) * 86400000)
    patch.to = today
    applied.push(`últimos ${n} ${m[2]} del catálogo (${patch.from} a ${today})`)
  } else if ((m = /(?:entre|de|desde)\s+((?:19|20)\d{2})\s+(?:y|a|hasta)\s+((?:19|20)\d{2})/.exec(f))) {
    patch.from = `${m[1]}-01-01`
    patch.to = `${m[2]}-12-31` > today ? today : `${m[2]}-12-31`
    applied.push(`años ${m[1]} a ${m[2]}`)
  } else if ((m = new RegExp(`(${MONTHS.join('|')})\\s+(?:de\\s+|del\\s+)?((?:19|20)\\d{2})`).exec(f))) {
    const mo = MONTHS.indexOf(m[1])
    patch.from = iso(Date.UTC(+m[2], mo, 1))
    patch.to = iso(Date.UTC(+m[2], mo + 1, 0))
    applied.push(`${m[1]} de ${m[2]}`)
  } else if ((m = /(?:desde|a partir de)\s+((?:19|20)\d{2})/.exec(f))) {
    patch.from = `${m[1]}-01-01`
    patch.to = today
    applied.push(`desde ${m[1]}`)
  } else if ((m = /(?:durante|en|del|de|ano)\s+((?:19|20)\d{2})\b/.exec(f))) {
    patch.from = `${m[1]}-01-01`
    patch.to = `${m[1]}-12-31` > today ? today : `${m[1]}-12-31`
    applied.push(`año ${m[1]}`)
  }

  if ((m = /profundidad(?:es)?\s+(?:entre|de)\s+(\d+)\s+(?:y|a)\s+(\d+)/.exec(f))) {
    patch.depthMin = +m[1]
    patch.depthMax = +m[2]
    applied.push(`profundidad entre ${m[1]} y ${m[2]} km`)
  } else if (/superficial/.test(f)) {
    patch.depthMin = 0
    patch.depthMax = 30
    applied.push('profundidad superficial (0–30 km)')
  } else if (/intermedi/.test(f)) {
    patch.depthMin = 60
    patch.depthMax = 300
    applied.push('profundidad intermedia (60–300 km)')
  } else if ((m = /(?:mas de|mayor(?:es)? (?:a|de)|profund[oa]s? (?:a|de) mas de)\s+(\d+)\s*km/.exec(f))) {
    patch.depthMin = +m[1]
    patch.depthMax = 700
    applied.push(`profundidad mayor de ${m[1]} km`)
  }

  const found = findDepts(q, depts)
  if (found.length === 1) {
    patch.dept = found[0].code
    applied.push(`departamento: ${found[0].name}`)
  }
  return { patch, applied, depts: found }
}

const ALARM = /(va a temblar|habra (un )?(terremoto|sismo|temblor)|cuando (va a |sera |es )?(temblar|el proximo|ocurrir)|debo evacuar|evacu|es seguro|estoy (a salvo|en peligro)|alerta|predic|a punto de|inminente)/
const DISTINGUISH = /(diferencia|distingu|no es lo mismo).*(amenaza|riesgo|vulnerabilidad|exposicion)|(amenaza|riesgo).*(diferencia|versus| vs )/

export function parseQuery(q: string, depts: Dept[], today: string): Intent {
  const f = fold(q).replace(/[¿?¡!]/g, ' ').trim()
  if (!f) return { kind: 'ayuda' }
  if (ALARM.test(f)) return { kind: 'no-alerta' }
  if (DISTINGUISH.test(f)) return { kind: 'distinguir' }
  if (/(mejor|mas) calibrad|calibracion.*mejor|cual modelo.*calibr/.test(f)) return { kind: 'mejor-calibrado' }
  if (/(crea|genera|haz|hacer|quiero).*(informe|reporte)/.test(f)) return { kind: 'informe-zona' }
  if (/(explica|por que).*(celda|zona|probabilidad|valor|estimacion)/.test(f) && !/\bque (significa|es)\b/.test(f)) return { kind: 'explicar-zona' }
  const def = /(?:que significa|\bque es\b|\bque son\b|define|definicion de|explica(?:me)? (?:que es )?)\s+(?:el |la |los |las |un |una )?(.+)/.exec(f)
  if (def) {
    const key = def[1].trim()
    const term = GLOSSARY.map((t) => ({ t, keys: [fold(t.term), ...(t.aliases ?? []).map(fold)] })).find(({ keys }) => keys.some((k) => key.includes(k) || (key.length > 3 && k.includes(key))))
    if (term) return { kind: 'glosario', term: term.t }
  }
  const { patch, applied, depts: found } = extractFilters(q, depts, today)
  if (/compar/.test(f) && /profundidad/.test(f) && found.length >= 2) {
    const rest = { ...patch }
    delete rest.dept
    return { kind: 'comparar-profundidad', depts: found.slice(0, 2).map((d) => d.code), patch: rest, applied: applied.filter((a) => !a.startsWith('departamento')) }
  }
  if (/(zonas?|departamentos?|donde|regiones?).*(mayor|mas) actividad|mas (sismos|eventos|temblores)/.test(f)) {
    const m = /ultim[oa]s?\s+(\d+)\s*(dia|dias|mes|meses|ano|anos)/.exec(f)
    const days = m ? Math.round(+m[1] * (m[2].startsWith('dia') ? 1 : m[2].startsWith('mes') ? 30.44 : 365.25)) : 30
    return { kind: 'mayor-actividad', days }
  }
  if (applied.length) return { kind: 'filtrar', patch, applied }
  if (/(ayuda|que puedes|como funciona|ejemplos?)/.test(f)) return { kind: 'ayuda' }
  const loose = GLOSSARY.find((t) => [fold(t.term), ...(t.aliases ?? []).map(fold)].some((k) => f === k || (f.length > 4 && f.includes(k) && f.length < k.length + 12)))
  if (loose) return { kind: 'glosario', term: loose }
  return { kind: 'desconocido' }
}

export const EXAMPLES = [
  'Muéstrame los eventos de magnitud mayor a 4 en Santander durante 2024',
  'Compara la profundidad promedio de Antioquia y Nariño',
  '¿Qué zonas tuvieron mayor actividad en los últimos 30 días?',
  'Explícame por qué esta celda tiene una probabilidad superior a su promedio',
  'Crea un informe de esta zona',
  '¿Qué significa el Brier score?',
  '¿Cuál modelo está mejor calibrado?',
]
export const NO_ALERT_TEXT =
  'No puedo responder eso: nadie puede predecir cuándo ni dónde ocurrirá un sismo, y esta plataforma no emite alertas. Lo que sí puedo mostrarle es la actividad registrada y la probabilidad estimada por zona, con su incertidumbre. Para información oficial y recomendaciones de preparación, consulte al Servicio Geológico Colombiano y a la Unidad Nacional para la Gestión del Riesgo de Desastres.'
export const DISTINGUISH_TEXT = ['actividad', 'amenaza', 'exposicion', 'vulnerabilidad', 'riesgo']
