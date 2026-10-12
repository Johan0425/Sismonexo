import { BookOpen, ChartNoAxesCombined, Database, FileText, FlaskConical, GraduationCap, History, House, Info, Map, Radar, Settings, type LucideIcon } from 'lucide-react'

export interface RouteDef {
  path: string
  label: string
  short?: string
  icon: LucideIcon
  group: 'Explorar' | 'Analizar' | 'Comprender' | 'Proyecto'
  description: string
  map?: boolean
}

export const ROUTES: RouteDef[] = [
  { path: '/', label: 'Inicio', icon: House, group: 'Explorar', description: 'Portada y recorrido narrativo del proyecto' },
  { path: '/atlas', label: 'Atlas sísmico', short: 'Atlas', icon: Map, group: 'Explorar', description: 'Mapa de eventos reales con filtros y capas', map: true },
  { path: '/pronostico', label: 'Pronóstico probabilístico', short: 'Pronóstico', icon: Radar, group: 'Explorar', description: 'Probabilidad de actividad por zona y periodo', map: true },
  { path: '/historico', label: 'Explorador histórico', short: 'Histórico', icon: History, group: 'Explorar', description: 'Máquina del tiempo, comparación de periodos y constelación', map: true },
  { path: '/laboratorio', label: 'Laboratorio de escenarios', icon: FlaskConical, group: 'Analizar', description: 'Escenarios hipotéticos y sensibilidad del modelo' },
  { path: '/modelos', label: 'Comparador de modelos', icon: ChartNoAxesCombined, group: 'Analizar', description: 'Métricas, calibración y validación cronológica' },
  { path: '/calidad', label: 'Calidad de los datos', icon: Database, group: 'Analizar', description: 'Cobertura, faltantes, auditoría e importación' },
  { path: '/metodologia', label: 'Metodología', icon: BookOpen, group: 'Comprender', description: 'Cómo se producen y validan las estimaciones' },
  { path: '/aprender', label: 'Centro de aprendizaje', icon: GraduationCap, group: 'Comprender', description: 'Conceptos, glosario y modo historia' },
  { path: '/informes', label: 'Informes', icon: FileText, group: 'Proyecto', description: 'Informes académicos y ejecutivos exportables' },
  { path: '/configuracion', label: 'Configuración', icon: Settings, group: 'Proyecto', description: 'Tema, densidad, movimiento y zona horaria' },
  { path: '/acerca', label: 'Acerca del proyecto', icon: Info, group: 'Proyecto', description: 'Autor, fuentes, licencias, privacidad y términos' },
]
export const PHONE_PRIMARY = ['/', '/atlas', '/pronostico', '/historico']
