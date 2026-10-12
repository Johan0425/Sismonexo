import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const ROUTES = ['/', '/atlas', '/pronostico', '/historico', '/laboratorio', '/modelos', '/calidad', '/metodologia', '/aprender', '/informes', '/configuracion', '/acerca', '/sistema']
const DISCLAIMER = 'Esta plataforma presenta estimaciones académicas basadas en patrones históricos. No constituye una alerta oficial, no predice terremotos individuales y no reemplaza la información del Servicio Geológico Colombiano ni de las autoridades de gestión del riesgo.'
const FORBIDDEN = [/habrá un terremoto/i, /a punto de sufrir/i, /evacúe inmediatamente/i, /predicción exacta/i]

function watchConsole(page: Page): string[] {
  const errors: string[] = []
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(String(e)))
  return errors
}
const ready = async (page: Page) => {
  // La página del sistema de diseño muestra un esqueleto de ejemplo a propósito.
  await expect(page.locator('.skeleton:not([data-demo] .skeleton)')).toHaveCount(0, { timeout: 30_000 })
}
const go = async (page: Page, route: string) => {
  await page.goto(`/#${route}`)
  await ready(page)
}

test.describe('recorrido general', () => {
  for (const route of [...ROUTES, '/historia']) {
    test(`${route} carga sin errores de consola y con la advertencia`, async ({ page }) => {
      const errors = watchConsole(page)
      await go(page, route)
      await expect(page.locator('h1, h2').first()).toBeVisible()
      if (route !== '/sistema') await expect(page.locator('.state[role=alert]')).toHaveCount(0) // el sistema de diseño muestra errores de ejemplo
      const text = await page.locator('body').innerText()
      for (const f of FORBIDDEN) expect(text).not.toMatch(f)
      if (route !== '/historia') await expect(page.getByRole('note', { name: 'Advertencia de uso académico' })).toContainText(DISCLAIMER)
      else expect(text).toContain('No es una alerta oficial')
      expect(errors).toEqual([])
    })
  }
})

test.describe('atlas y filtros', () => {
  test('los filtros actualizan el resumen, los gráficos y la URL; se pueden deshacer', async ({ page }) => {
    await go(page, '/atlas')
    const summary = page.getByRole('complementary', { name: /Resumen de los eventos filtrados/ })
    await expect(summary).toContainText('66.987')
    await page.getByRole('button', { name: /^Filtros/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Filtros' })
    await sheet.getByLabel('Magnitud mínima').fill('5')
    await sheet.getByLabel('Magnitud mínima').press('Enter')
    await sheet.getByLabel('Ubicación').selectOption({ label: 'Santander' })
    await expect(page).toHaveURL(/mag=5_9/)
    await expect(page).toHaveURL(/dpto=68/)
    await sheet.getByRole('button', { name: 'Ver resultados' }).click()
    await expect(summary).not.toContainText('66.987')
    await expect(summary.getByRole('figure', { name: /Eventos por/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Quitar filtro: Santander' })).toBeVisible()
    await page.keyboard.press('ControlOrMeta+z')
    await expect(page).not.toHaveURL(/dpto=68/)
    await page.keyboard.press('ControlOrMeta+z')
    await expect(summary).toContainText('66.987')
  })

  test('un enlace compartido restaura filtros, capas y selección', async ({ page }) => {
    await go(page, '/atlas?fecha=2024-01-01_2024-12-31&mag=4_9&vista=calor&tema=oscuro')
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'oscuro')
    await expect(page.getByRole('region', { name: 'Leyenda del mapa' })).toContainText('Concentración ponderada por magnitud')
    await expect(page.getByRole('button', { name: /Quitar filtro: 2024-01-01/ })).toBeVisible()
  })

  test('seleccionar un evento desde la tabla muestra su ficha y el enlace a la fuente', async ({ page }) => {
    await go(page, '/atlas')
    await page.getByRole('table').getByRole('button').first().click()
    const panel = page.getByRole('complementary', { name: 'Detalle del evento seleccionado' })
    for (const label of ['Fecha y hora', 'Profundidad', 'Latitud, longitud', 'Calidad de la localización', 'Fuente', 'Eventos cercanos']) await expect(panel).toContainText(label)
    await expect(panel.getByRole('link', { name: /SGC/ })).toHaveAttribute('href', /bdrsnc\.sgc\.gov\.co/)
    await expect(page).toHaveURL(/sel=e\./)
  })

  test('exporta los registros visibles con fuente y versión', async ({ page }) => {
    await go(page, '/atlas?mag=5.5_9')
    await page.getByRole('button', { name: 'Exportar' }).click()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('menuitem', { name: /Registros visibles \(CSV\)/ }).click()])
    const csv = (await (await download.createReadStream()).toArray()).map(String).join('')
    expect(csv).toContain('# Fuente: Servicio Geológico Colombiano')
    expect(csv).toMatch(/# Versión del conjunto de datos: rsnc-/)
    expect(csv).toContain('# Advertencia: Esta plataforma presenta estimaciones académicas')
    expect(csv).toContain('event_id,event_datetime_utc,latitude,longitude')
    expect(csv.split('\n').filter((l) => l && !l.startsWith('#') && !l.startsWith('﻿#')).length).toBeGreaterThan(10)
  })
})

test.describe('pronóstico', () => {
  test('el horizonte principal es de 30 días y muestra incertidumbre, línea base y explicación', async ({ page }) => {
    await go(page, '/pronostico')
    const panel = page.getByRole('complementary', { name: 'Resumen del pronóstico' })
    await expect(panel.getByRole('heading', { name: 'Próximos 30 días' })).toBeVisible()
    await expect(panel).toContainText('Una probabilidad alta no significa que un terremoto ocurrirá con certeza. Una probabilidad baja tampoco significa ausencia total de actividad.')
    await expect(panel).toContainText('Intervalo 90 %')
    await expect(panel).toContainText('línea base')
    await panel.getByRole('table').getByRole('button').first().click()
    const zone = page.getByRole('complementary', { name: 'Detalle de la zona seleccionada' })
    await expect(zone.getByRole('img', { name: /Intervalo de incertidumbre del 90 %/ })).toBeVisible()
    await expect(zone).toContainText('Versión del modelo')
    await expect(zone).toContainText('Estado de calibración')
    await zone.getByRole('button', { name: 'Explicar esta estimación' }).click()
    const dialog = page.getByRole('dialog', { name: '¿Por qué el modelo muestra este valor?' })
    await expect(dialog).toContainText('Esto no demuestra causalidad')
    await expect(dialog).toContainText('Periodos históricos parecidos')
    await expect(dialog).toContainText('Línea base')
    await page.keyboard.press('Escape')
    await expect(dialog).toBeHidden()
  })

  test('cambiar parámetros actualiza texto, leyenda y URL, y avisa cuando no hay modelo entrenado', async ({ page }) => {
    await go(page, '/pronostico')
    await page.getByRole('button', { name: /30 días · M ≥ 4,0/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Parámetros del pronóstico' })
    await sheet.getByRole('radio', { name: '90 días' }).click()
    await expect(page).toHaveURL(/horizonte=90/)
    await sheet.getByLabel('Resolución geográfica').selectOption('dep')
    await expect(page).toHaveURL(/unidad=dep/)
    await sheet.getByLabel('Nivel de suavizado espacial').selectOption('1')
    await expect(sheet).toContainText('no hay un modelo entrenado')
    await sheet.getByRole('button', { name: 'Ver el mapa' }).click()
    const panel = page.getByRole('complementary', { name: 'Resumen del pronóstico' })
    await expect(panel.getByRole('heading', { name: 'Próximos 90 días' })).toBeVisible()
    await expect(panel).toContainText('Línea base recalculada')
    await expect(page.getByRole('region', { name: 'Leyenda del mapa' })).toContainText('90 días')
  })
})

test.describe('modelos y calidad', () => {
  test('el comparador muestra validación cronológica, fugas y recomendación', async ({ page }) => {
    await go(page, '/modelos')
    await expect(page.getByText('Línea base de frecuencia histórica').first()).toBeVisible()
    for (const t of ['Curva precisión-recall', 'Curva ROC', 'Matriz de confusión', 'Validación que respeta el tiempo', 'Detector de fugas de información', 'Rendimiento por departamento']) await expect(page.getByText(t).first()).toBeVisible()
    await expect(page.getByText('Falla', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '¿Qué modelo debería usar?' }).click()
    await expect(page.getByRole('dialog')).toContainText('Interpretabilidad')
  })

  test('el centro de calidad documenta auditoría y procedencia', async ({ page }) => {
    await go(page, '/calidad')
    await page.getByRole('tab', { name: 'Reglas y auditoría' }).click()
    await expect(page.getByRole('table')).toContainText('R01')
    await page.getByRole('tab', { name: 'Procedencia' }).click()
    for (const t of ['Fecha de consulta', 'Cobertura temporal', 'Licencia', 'Procesamiento aplicado', 'Variables eliminadas', 'Registros descartados', 'Versión del dataset']) await expect(page.getByText(t).first()).toBeVisible()
  })

  test('la importación valida un CSV y lo rotula como archivo importado', async ({ page }) => {
    await go(page, '/calidad')
    await page.getByRole('tab', { name: 'Importar datos' }).click()
    const csv = 'fecha_hora_utc,latitud,longitud,profundidad,magnitud\n2024-05-01T10:20:30Z,6.8,-73.1,150,4.1\n2024-05-02T00:00:00Z,95,-73,10,3\n2024-05-03T00:00:00Z,4.6,-74.1,20,3.2\n'
    await page.getByLabel('Archivo de catálogo sísmico').setInputFiles({ name: 'muestra.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
    await expect(page.getByText('Validación de «muestra.csv»')).toBeVisible()
    await expect(page.getByText('Coordenadas inválidas')).toBeVisible()
    await page.getByRole('button', { name: 'Explorar en el atlas' }).click()
    await expect(page).toHaveURL(/#\/atlas/)
    await expect(page.getByRole('button', { name: /Archivo importado muestra\.csv/ })).toBeVisible()
  })
})

test.describe('teclado', () => {
  test('enlace para saltar al contenido, paleta de comandos y atajos', async ({ page }) => {
    await go(page, '/aprender')
    await page.keyboard.press('Tab')
    await expect(page.getByRole('link', { name: 'Saltar al contenido' })).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(page.locator('#contenido')).toBeFocused()
    await page.keyboard.press('ControlOrMeta+k')
    const palette = page.getByRole('dialog', { name: 'Búsqueda global y comandos' })
    await palette.getByRole('combobox').fill('santander')
    await expect(palette.getByRole('option').first()).toContainText('Santander')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/#\/atlas\?.*dpto=(68|54)/)
    await ready(page)
    await page.locator('#contenido').focus()
    await page.keyboard.press('?')
    await expect(page.getByRole('dialog', { name: 'Atajos de teclado' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.keyboard.press('g')
    await page.keyboard.press('m')
    await expect(page).toHaveURL(/#\/modelos/)
  })

  test('el modo historia avanza con las flechas', async ({ page }) => {
    await go(page, '/historia')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('¿Por qué tiembla Colombia?')
    await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('¿Qué información contiene un catálogo sísmico?')
    await page.keyboard.press('End')
    await expect(page.getByRole('img', { name: /Código QR/ })).toBeVisible()
    await page.keyboard.press('ArrowLeft')
    await expect(page.getByText('Capítulo 9 de 10')).toBeVisible()
  })
})

test.describe('accesibilidad (axe, WCAG 2.2 AA)', () => {
  for (const theme of ['claro', 'oscuro'] as const)
    for (const route of ['/', '/pronostico', '/modelos', '/calidad', '/laboratorio', '/aprender', '/informes', '/configuracion', '/sistema']) {
      test(`${route} sin infracciones en tema ${theme}`, async ({ page }) => {
        await go(page, `${route}?tema=${theme}`)
        await expect(page.locator('html')).toHaveAttribute('data-theme', theme)
        if (route === '/informes') await expect(page.getByRole('article', { name: 'Vista previa del informe' })).toBeVisible({ timeout: 30_000 })
        await page.waitForTimeout(700) // terminan las animaciones de entrada
        const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).exclude('.maplibregl-canvas').analyze()
        expect(r.violations.map((v) => `${v.id}: ${v.nodes.length} · ${v.nodes[0]?.target.join(' ')}`)).toEqual([])
      })
    }
})

test.describe('responsive', () => {
  for (const width of [375, 390, 768, 1024, 1280, 1440, 2560]) {
    test(`sin desbordamiento horizontal a ${width} px`, async ({ page }) => {
      await page.setViewportSize({ width, height: width < 600 ? 812 : 900 })
      for (const route of ['/', '/atlas', '/pronostico', '/modelos', '/calidad', '/laboratorio']) {
        await go(page, route)
        expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${route} a ${width}px`).toBeLessThanOrEqual(1)
      }
      await expect(page.getByRole('navigation', { name: 'Navegación principal' }).filter({ visible: true })).toHaveCount(1)
      if (width < 768) {
        await expect(page.locator('.bottomnav a, .bottomnav button')).toHaveCount(5)
        for (const b of await page.locator('.bottomnav a, .bottomnav button, .topbar button').all()) {
          const box = await b.boundingBox()
          if (box) expect(Math.min(box.width, box.height), 'área táctil mínima de 44 px').toBeGreaterThanOrEqual(44)
        }
      } else await expect(page.locator('.sidebar')).toBeVisible()
    })
  }

  test('en teléfono el inspector es una hoja inferior', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 })
    await go(page, '/pronostico')
    await page.getByRole('button', { name: 'Resumen y tabla' }).click()
    const sheet = page.getByRole('dialog', { name: 'Resumen del pronóstico' })
    await sheet.getByRole('table').getByRole('button').first().click()
    await expect(page.getByRole('dialog').filter({ hasText: 'Explicar esta estimación' })).toBeVisible()
  })
})

test.describe('tema y movimiento', () => {
  test('el tema oscuro se aplica, cambia los colores y viaja en la URL', async ({ page }) => {
    await go(page, '/configuracion')
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await page.getByRole('radio', { name: 'Claro' }).click()
    const light = await bg()
    await page.getByRole('radio', { name: 'Oscuro' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'oscuro')
    await expect(page).toHaveURL(/tema=oscuro/)
    await expect.poll(bg).not.toBe(light)
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'oscuro')
  })

  test('con movimiento reducido no hay animaciones ni transiciones largas', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await go(page, '/')
    const durations = await page.evaluate(() => Array.from(document.querySelectorAll<SVGElement>('.home svg circle')).slice(0, 40).map((c) => parseFloat(getComputedStyle(c).animationDuration) || 0))
    expect(Math.max(0, ...durations)).toBeLessThan(0.01)
    expect(await page.evaluate(() => parseFloat(getComputedStyle(document.querySelector('.btn')!).transitionDuration))).toBeLessThan(0.01)
    await expect(page.getByRole('img', { name: /Mapa esquemático de Colombia/ })).toBeVisible()
  })

  test('la zona horaria cambia cómo se muestra la hora de los eventos', async ({ page }) => {
    await go(page, '/atlas')
    await page.getByRole('table').getByRole('button').first().click()
    const panel = page.getByRole('complementary', { name: 'Detalle del evento seleccionado' })
    await expect(panel).toContainText('(hora de Colombia)')
    await go(page, '/atlas?hora=utc')
    await page.getByRole('table').getByRole('button').first().click()
    await expect(page.getByRole('complementary', { name: 'Detalle del evento seleccionado' }).locator('dd').first()).toContainText('(UTC)')
  })
})

test.describe('laboratorio, informes y asistente', () => {
  test('el laboratorio rotula el escenario como hipotético y permite restablecer', async ({ page }) => {
    await go(page, '/laboratorio')
    await expect(page.getByText('Escenario hipotético. No representa un pronóstico oficial ni modifica los datos reales.')).toBeVisible()
    const reset = page.getByRole('button', { name: 'Restablecer valores' })
    await expect(reset).toBeDisabled()
    const slider = page.getByRole('slider', { name: 'Tiempo desde el último evento' })
    await slider.focus()
    for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
    await expect(reset).toBeEnabled()
    await expect(page.getByText(/Variables modificadas: tiempo desde el último evento/)).toBeVisible()
    await reset.click()
    await expect(reset).toBeDisabled()
  })

  test('los informes incluyen autor, institución, fuente, versión y advertencia; el PDF se descarga', async ({ page }) => {
    await go(page, '/informes')
    const report = page.getByRole('article', { name: 'Vista previa del informe' })
    await expect(report).toBeVisible({ timeout: 30_000 })
    for (const t of ['Johan Antonio Peña López', 'Institución Universitaria EAM', 'Servicio Geológico Colombiano', 'Versión de los datos', 'Versión del modelo', 'Limitaciones', 'Interpretación', 'Advertencia de uso académico']) await expect(report).toContainText(t)
    await expect(report.getByRole('img').first()).toBeVisible()
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Descargar PDF' }).click()])
    expect(download.suggestedFilename()).toMatch(/^sismonexo-.*\.pdf$/)
    const bytes = Buffer.concat(await (await download.createReadStream()).toArray())
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-')
    expect(bytes.length).toBeGreaterThan(20_000)
  })

  test('Nexo aplica filtros, los explica, cita la fuente, permite deshacer y no emite alertas', async ({ page }) => {
    await go(page, '/aprender')
    await page.getByRole('button', { name: 'Abrir el asistente Nexo' }).click()
    const nexo = page.getByRole('dialog', { name: 'Nexo' })
    const ask = async (q: string) => {
      await nexo.getByLabel('Pregunta para Nexo').fill(q)
      await nexo.getByRole('button', { name: 'Enviar consulta' }).click()
    }
    await ask('Muéstrame los eventos de magnitud mayor a 4 en Santander durante 2024')
    await expect(nexo).toContainText('Apliqué estos filtros: magnitud ≥ 4; año 2024; departamento: Santander.')
    await expect(nexo).toContainText('Fuente: catálogo de la Red Sismológica Nacional de Colombia')
    await expect(page).toHaveURL(/#\/atlas\?.*dpto=68/)
    await nexo.getByRole('button', { name: 'Deshacer estos filtros' }).click()
    await expect(page).not.toHaveURL(/dpto=68/)
    await ask('¿Va a temblar mañana en Bogotá?')
    await expect(nexo).toContainText('nadie puede predecir cuándo ni dónde ocurrirá un sismo')
    await ask('¿Quién ganó el partido de ayer?')
    await expect(nexo).toContainText('No tengo información para responder eso')
  })
})
