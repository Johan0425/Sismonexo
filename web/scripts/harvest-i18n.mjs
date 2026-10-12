// Recolecta los textos visibles de la aplicación (en español) recorriendo vistas, paneles y diálogos.
// Uso: con `npm run dev` en marcha →  node scripts/harvest-i18n.mjs   (escribe src/i18n/keys.json)
import { chromium } from 'playwright'
import { writeFileSync } from 'node:fs'

const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const keys = new Map()
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: 'es-CO' })

async function grab(where) {
  const found = await page.evaluate(() => {
    const { normalize, ATTRS, SKIP } = window.__i18n
    const out = []
    const skip = (n) => {
      for (let el = n.nodeType === 1 ? n : n.parentElement; el; el = el.parentElement) if (SKIP.includes(el.tagName) || el.hasAttribute('data-no-i18n')) return true
      return false
    }
    const w = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT)
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (skip(n)) continue
      if (n.nodeType === 3) {
        if (/[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(n.nodeValue)) out.push(normalize(n.nodeValue).key)
      } else for (const a of ATTRS) if (n.hasAttribute(a) && /[A-Za-zÁÉÍÓÚÑáéíóúñ]{2}/.test(n.getAttribute(a))) out.push(normalize(n.getAttribute(a)).key)
    }
    return out
  })
  let fresh = 0
  for (const k of found) if (k && !keys.has(k)) (keys.set(k, where), fresh++)
  console.log(`${where}: +${fresh} (total ${keys.size})`)
}
const settle = async (ms = 900) => {
  await page.waitForFunction(() => !document.querySelector('.skeleton:not([data-demo] .skeleton)'), null, { timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(ms)
}
const go = async (route, ms) => {
  await page.goto('about:blank')
  await page.goto(`${BASE}/#${route}`)
  await settle(ms)
}
const step = async (name, fn) => {
  try {
    await fn()
    await page.waitForTimeout(700)
    await grab(name)
  } catch (e) {
    console.log(`  (omitido ${name}: ${String(e.message).split('\n')[0]})`)
  }
}
const esc = () => page.keyboard.press('Escape')
const btn = (name) => page.getByRole('button', { name }).first()

// Inicio y recorrido inicial
await go('/', 2600)
await step('inicio', async () => {})
for (let i = 0; i < 5; i++) await step(`recorrido ${i}`, async () => i && (await btn('Siguiente').click({ timeout: 3000 })))
await esc()

// Atlas
await go('/atlas?tema=claro', 2500)
await step('atlas', async () => {})
await step('atlas filtros', async () => {
  await btn(/^Filtros/).click()
  for (const s of await page.locator('details.disclosure summary').all()) await s.click()
})
await step('atlas filtros error', async () => {
  await page.getByLabel('Magnitud mínima').fill('99')
})
await esc()
for (const viz of ['Pulsos', 'Agrupaciones', 'Mapa de calor', 'Densidad suavizada', 'Columnas 3D', 'Hexágonos H3', 'Celdas cuadradas', 'Puntos'])
  await step(`atlas capa ${viz}`, async () => {
    if (!(await page.getByRole('dialog', { name: 'Capas' }).count())) await btn('Capas').click()
    await page.getByRole('dialog', { name: 'Capas' }).getByRole('button', { name: new RegExp('^' + viz) }).click()
    await page.waitForTimeout(900)
  })
for (const v of ['probabilidad', 'tasa', 'incertidumbre', 'calidad', 'cambio', 'ninguna'])
  await step(`atlas zona ${v}`, async () => {
    if (!(await page.getByRole('dialog', { name: 'Capas' }).count())) await btn('Capas').click()
    await page.getByLabel('Capa de análisis por zona').selectOption(v)
    await page.waitForTimeout(1500)
  })
await step('atlas color', async () => {
  await page.getByRole('dialog', { name: 'Capas' }).getByRole('button', { name: 'Magnitud' }).click()
  await page.getByLabel('Amenaza sísmica oficial').check()
})
await esc()
await step('atlas exportar', async () => await btn('Exportar').click())
await esc()
await step('atlas evento', async () => await page.getByRole('table').getByRole('button').first().click())
await step('atlas tabla gráfico', async () => {
  await btn('Cerrar detalle').click()
  await btn('Ver datos en tabla').click()
})
await go('/atlas?mag=8.9_9', 2000)
await step('atlas vacío', async () => {})

// Pronóstico
await go('/pronostico', 2500)
await step('pronóstico', async () => {})
await step('pronóstico parámetros', async () => await btn(/30 días · M/).click())
await step('pronóstico sin modelo', async () => {
  await page.getByRole('radio', { name: 'Otro' }).click()
  await page.getByLabel('Nivel de suavizado espacial').selectOption('1')
  await page.getByLabel('Periodo histórico utilizado').selectOption('2010')
})
await esc()
await settle(1500)
await step('pronóstico recalculado', async () => {})
await step('pronóstico zona recalculada', async () => await page.getByRole('table').getByRole('button').first().click())
await step('explicación recalculada', async () => await btn('Explicar esta estimación').click())
await esc()
for (const m of ['incertidumbre', 'cambio', 'tasa', 'calidad', 'probabilidad'])
  await step(`pronóstico métrica ${m}`, async () => {
    if (!(await page.getByRole('dialog', { name: 'Capas' }).count())) await btn('Capas').click()
    await page.getByLabel('Variable del mapa').selectOption(m)
    await page.waitForTimeout(900)
  })
await esc()
await go('/pronostico', 2500)
await step('pronóstico zona', async () => await page.getByRole('table').getByRole('button').first().click())
await step('pronóstico comparar', async () => {
  await btn('Comparar zona').click()
  await btn('Cerrar detalle de la zona').click()
  await page.getByRole('table').getByRole('button').nth(1).click()
})
await step('explicación', async () => await btn('Explicar esta estimación').click())
await esc()
await step('pronóstico exportar', async () => await btn('Exportar').click())
await esc()
for (const u of ['dep', 'mun', 'h3', 'g25']) {
  await go(`/pronostico?unidad=${u}`, 2500)
  await step(`pronóstico ${u}`, async () => await page.getByRole('table').getByRole('button').first().click())
}
await go('/pronostico?umbral=5&horizonte=7', 2500)
await step('pronóstico M5', async () => await page.getByRole('table').getByRole('button').first().click())

// Histórico
await go('/historico', 2500)
await step('histórico', async () => {})
for (const b of ['Mes', 'Semana', 'Día', 'Año']) await step(`histórico paso ${b}`, async () => await page.getByRole('radio', { name: b, exact: true }).click())
await step('histórico reproducir', async () => {
  await btn('Reproducir').click()
  await page.waitForTimeout(1500)
  await btn('Pausar').click()
  await btn('Guardar este momento').click()
})
await step('histórico filtros', async () => await btn(/^Filtros y región/).click())
await esc()
await step('comparar periodos', async () => {
  await page.getByRole('radio', { name: 'Comparar periodos' }).click()
  await settle(2500)
})
await step('constelación', async () => {
  await page.getByRole('radio', { name: 'Constelación' }).click()
  await settle(2500)
})
await step('constelación nodo', async () => {
  await page.locator('svg circle[role=button]').first().click()
  await btn('Ver tabla').click()
})
await step('constelación grafo', async () => {
  await btn('Ver red').click()
  await page.getByRole('radio', { name: 'Vista de grafo' }).click()
})

// Laboratorio
await go('/laboratorio', 2500)
await step('laboratorio', async () => {})
await step('laboratorio cambios', async () => {
  for (const name of ['Frecuencia reciente', 'Tiempo desde el último evento', 'Profundidad media', 'Distancia al evento anterior', 'Magnitud acumulada']) {
    await page.getByRole('slider', { name }).focus()
    for (let i = 0; i < 40; i++) await page.keyboard.press('ArrowRight')
  }
  await page.getByLabel('Estacionalidad (mes del pronóstico)').selectOption('2')
  await page.getByLabel('Ventana histórica de la tasa').selectOption('5a')
  await page.getByLabel('Buscar zona por nombre').fill('santa')
})
await step('laboratorio guardar', async () => await btn('Guardar').click())
await step('laboratorio bajar', async () => {
  await page.getByRole('slider', { name: 'Frecuencia reciente' }).focus()
  await page.keyboard.press('Home')
})

// Modelos
for (const q of ['', '?unidad=dep', '?unidad=mun&umbral=5', '?horizonte=7&umbral=3', '?unidad=h3&horizonte=90']) {
  await go(`/modelos${q}`, 2500)
  await step(`modelos ${q}`, async () => {})
  await step(`modelos consejo ${q}`, async () => await btn('¿Qué modelo debería usar?').click())
  await esc()
}
await step('modelos prueba final', async () => {
  await page.getByRole('radio', { name: /Prueba final/ }).click()
  await btn('Ver cómo avanza la ventana').click()
  await page.waitForTimeout(1200)
})

// Calidad
await go('/calidad', 2500)
for (const t of ['Indicadores', 'Cobertura y rupturas', 'Datos faltantes', 'Reglas y auditoría', 'Procedencia', 'Importar datos'])
  await step(`calidad ${t}`, async () => {
    await page.getByRole('tab', { name: t }).click()
    await page.waitForTimeout(900)
  })
await step('importar con errores', async () => {
  const csv = 'fecha_hora_utc,latitud,longitud,profundidad,magnitud\n2024-05-01T10:20:30Z,6.8,-73.1,150,4.1\n2024-05-01T10:20:30Z,6.8,-73.1,150,4.1\n2024-05-02T00:00:00Z,95,-73,10,3\n2024-05-03T00:00:00Z,48,2,20,3.2\nmal,5,-74,10,3\n2024-05-04T00:00:00Z,5,-74,10,\n2024-05-05T00:00:00Z,5,-74,9999,3\n'
  await page.getByLabel('Archivo de catálogo sísmico').setInputFiles({ name: 'muestra.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
})
await step('importar rechazado', async () => {
  await page.getByLabel('Archivo de catálogo sísmico').setInputFiles({ name: 'malo.csv', mimeType: 'text/csv', buffer: Buffer.from('a,b\n1,2\n') })
})
await step('importar tipo', async () => {
  await page.getByLabel('Archivo de catálogo sísmico').setInputFiles({ name: 'x.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ') })
})
await step('importar json malo', async () => {
  await page.getByLabel('Archivo de catálogo sísmico').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{mal') })
})
await step('importar y explorar', async () => {
  const csv = 'fecha_hora_utc,latitud,longitud,profundidad,magnitud\n2024-05-01T10:20:30Z,6.8,-73.1,150,4.1\n2024-05-03T00:00:00Z,4.6,-74.1,20,3.2\n'
  await page.getByLabel('Archivo de catálogo sísmico').setInputFiles({ name: 'muestra.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  await btn('Explorar en el atlas').click()
  await settle(2500)
  await page.getByRole('table').getByRole('button').first().click()
})

// Contenido
for (const r of ['/metodologia', '/acerca', '/configuracion', '/sistema', '/no-existe']) {
  await go(r, 1800)
  await step(r, async () => {})
}
await go('/aprender', 1500)
await step('aprender', async () => {
  for (const s of await page.locator('details.disclosure summary').all()) await s.click()
})
await step('aprender sin resultados', async () => await page.getByLabel('Buscar un término').fill('zzzz'))
await go('/configuracion', 1200)
await step('configuración acciones', async () => {
  await btn('Preparar modo sin conexión').click()
  await page.waitForTimeout(1500)
})

// Informes
await go('/informes', 5000)
for (const t of ['ejecutivo', 'zona', 'periodo', 'historico', 'probabilistico', 'modelos', 'calidad', 'metodologico'])
  await step(`informe ${t}`, async () => {
    await page.getByLabel('Informe', { exact: true }).selectOption(t)
    await page.getByRole('article', { name: 'Vista previa del informe' }).waitFor({ timeout: 40000 })
    await page.waitForTimeout(2500)
  })

// Paleta, atajos, perfil, más
await go('/aprender', 1200)
await step('paleta', async () => await page.keyboard.press('ControlOrMeta+k'))
for (const q of ['santander', 'calibr', '4.6, -74.1', '40, 10', 'zzzz', 'tema'])
  await step(`paleta ${q}`, async () => await page.getByRole('combobox', { name: 'Buscar' }).fill(q))
await esc()
await step('atajos', async () => {
  await page.locator('#contenido').focus()
  await page.keyboard.press('?')
})
await esc()
await step('perfil', async () => await btn('Perfil del proyecto').click())
await esc()

// Nexo
await step('nexo', async () => await btn('Abrir el asistente Nexo').click())
const ask = async (q) => {
  await page.getByLabel('Pregunta para Nexo').fill(q)
  await btn('Enviar consulta').click()
  await page.waitForTimeout(2200)
}
for (const q of ['¿Va a temblar mañana?', '¿Cuál es la diferencia entre amenaza y riesgo?', '¿Qué significa el Brier score?', 'ayuda', '¿Quién ganó el partido?', '¿Cuál modelo está mejor calibrado?', 'Compara la profundidad promedio de Antioquia y Nariño', '¿Qué zonas tuvieron mayor actividad en los últimos 30 días?', 'Explícame por qué esta celda tiene una probabilidad superior a su promedio', 'Crea un informe de esta zona', 'Muéstrame los eventos de magnitud mayor a 9 durante 2024', 'Muéstrame los eventos de magnitud mayor a 4 en Santander durante 2024'])
  await step(`nexo ${q.slice(0, 24)}`, async () => await ask(q))
await step('nexo deshacer', async () => await btn('Deshacer estos filtros').click())
await go('/pronostico?sel=z.g50.g50-21-26', 2500)
await step('nexo zona', async () => {
  await btn('Abrir el asistente Nexo').click()
  await ask('Explícame por qué esta celda tiene una probabilidad superior a su promedio')
})

// Modo historia
await go('/historia', 2500)
for (let i = 0; i < 10; i++) await step(`historia ${i + 1}`, async () => i && (await page.keyboard.press('ArrowRight')))

// Teléfono
await page.setViewportSize({ width: 390, height: 844 })
await go('/atlas', 2500)
await step('teléfono atlas', async () => {
  await page.locator('.map-legend summary').click()
  await btn('Resumen y tabla').click()
})
await esc()
await step('teléfono más', async () => await page.getByRole('button', { name: 'Más' }).click())
await esc()
await go('/historico', 2500)
await step('teléfono histórico', async () => await page.locator('.timeline summary').click())

await browser.close()
const list = [...keys.keys()].sort((a, b) => a.localeCompare(b, 'es'))
writeFileSync(new URL('../src/i18n/keys.json', import.meta.url), JSON.stringify(list, null, 1) + '\n')
console.log(`\n${list.length} textos · ${list.join(' ').length} caracteres`)
