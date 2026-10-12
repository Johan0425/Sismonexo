// Comprueba un idioma: recorre las vistas y lista los textos que quedaron sin traducir.
// Uso (con `npm run dev` en marcha):  node scripts/check-i18n.mjs en
import { chromium } from 'playwright'
const lang = process.argv[2] ?? 'en'
const BASE = process.env.BASE ?? 'http://127.0.0.1:5173'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (e) => errors.push(String(e)))
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
const all = new Set()
for (const r of ['/', '/atlas', '/pronostico', '/historico', '/laboratorio', '/modelos', '/calidad', '/metodologia', '/aprender', '/informes', '/configuracion', '/acerca', '/historia']) {
  await page.goto('about:blank')
  await page.goto(`${BASE}/#${r}?idioma=${lang}`)
  await page.waitForFunction(() => !document.querySelector('.skeleton'), null, { timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(r === '/informes' ? 6000 : 2500)
  const miss = await page.evaluate(() => [...window.__i18n.missing])
  const htmlLang = await page.evaluate(() => document.documentElement.lang)
  const h = await page.locator('h1, h2').first().innerText().catch(() => '')
  console.log(`${r} [${htmlLang}] «${h.slice(0, 50)}» · sin traducir: ${miss.length}`)
  miss.forEach((m) => all.add(m))
  if (r === '/pronostico' || r === '/') await page.screenshot({ path: `${process.env.SHOTS ?? '.'}/i18n-${lang}${r === '/' ? '-inicio' : '-pronostico'}.png` })
}
console.log('\nSIN TRADUCIR (' + all.size + '):')
for (const m of [...all].filter((m) => !/^[A-ZÁÉÍÓÚÑ][\wáéíóúñü. ]+, [A-Z]/.test(m)).slice(0, 80)) console.log('  ' + m.slice(0, 150))
console.log('errores:', errors.length, errors.slice(0, 3))
await browser.close()
