// Exportaciones. Toda exportación lleva fuente, versión del conjunto de datos y advertencia de uso académico.
import type { IndexData } from './data'

export const DISCLAIMER =
  'Esta plataforma presenta estimaciones académicas basadas en patrones históricos. No constituye una alerta oficial, no predice terremotos individuales y no reemplaza la información del Servicio Geológico Colombiano ni de las autoridades de gestión del riesgo.'

export interface Provenance {
  titulo: string
  fuente: string
  url: string
  version_datos: string
  version_modelo?: string
  pronostico_generado?: string
  filtros?: string[]
  generado: string
  autor: string
  institucion: string
  advertencia: string
}

export function provenance(index: IndexData, titulo: string, extra: Partial<Provenance> = {}): Provenance {
  return {
    titulo,
    fuente: 'Servicio Geológico Colombiano (SGC) — Red Sismológica Nacional de Colombia, catálogo de sismicidad',
    url: 'https://bdrsnc.sgc.gov.co/paginas1/catalogo/index.php',
    version_datos: index.dataset_version,
    generado: new Date().toISOString(),
    autor: index.app.author,
    institucion: index.app.institution,
    advertencia: DISCLAIMER,
    ...extra,
  }
}
const provLines = (p: Provenance): string[] =>
  [
    `Título: ${p.titulo}`,
    `Fuente: ${p.fuente}`,
    `URL de la fuente: ${p.url}`,
    `Versión del conjunto de datos: ${p.version_datos}`,
    p.version_modelo ? `Versión del modelo: ${p.version_modelo}` : '',
    p.pronostico_generado ? `Pronóstico generado: ${p.pronostico_generado}` : '',
    ...(p.filtros?.length ? [`Filtros: ${p.filtros.join(' | ')}`] : []),
    `Exportado: ${p.generado}`,
    `Autor: ${p.autor} — ${p.institucion}`,
    `Advertencia: ${p.advertencia}`,
  ].filter(Boolean)

export function download(name: string, data: Blob | string, type = 'text/plain;charset=utf-8'): void {
  const blob = typeof data === 'string' ? new Blob([data], { type }) : data
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export type Cell = string | number | null | undefined
const csvCell = (v: Cell): string => {
  if (v == null || (typeof v === 'number' && !Number.isFinite(v))) return ''
  let s = String(v)
  // Evita la inyección de fórmulas al abrir el archivo en una hoja de cálculo.
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n;]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s
}
/** CSV (UTF-8 con BOM, separador coma). Los metadatos van como líneas de comentario iniciales con «#». */
export function toCsv(header: string[], rows: Cell[][], prov?: Provenance): string {
  const meta = prov ? provLines(prov).map((l) => `# ${l}`) : []
  return '﻿' + [...meta, header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\n') + '\n'
}
export const downloadCsv = (name: string, header: string[], rows: Cell[][], prov?: Provenance) => download(name, toCsv(header, rows, prov), 'text/csv;charset=utf-8')
export const downloadJson = (name: string, data: unknown, prov?: Provenance) => download(name, JSON.stringify(prov ? { metadatos: prov, datos: data } : data, null, 1), 'application/json')
export function downloadGeoJson(name: string, features: GeoJSON.Feature[], prov: Provenance) {
  download(name, JSON.stringify({ type: 'FeatureCollection', metadatos: prov, crs_nota: 'Coordenadas WGS84 (EPSG:4326), orden longitud, latitud', features }), 'application/geo+json')
}

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)

// ------------------------------------------------------------------ imágenes

const STYLE_PROPS = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'stroke-linecap', 'stroke-linejoin', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-family', 'font-size', 'font-weight', 'text-anchor', 'dominant-baseline']

/** Serializa un SVG con los estilos calculados en línea (las variables CSS no viajan fuera del documento). */
export function serializeSvg(svg: SVGSVGElement, background: string): { xml: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = svg.querySelectorAll<SVGElement>('*')
  const dst = clone.querySelectorAll<SVGElement>('*')
  src.forEach((el, i) => {
    const cs = getComputedStyle(el)
    const s = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';')
    dst[i].setAttribute('style', s)
  })
  const { width, height } = svg.getBoundingClientRect()
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('width', '100%')
  bg.setAttribute('height', '100%')
  bg.setAttribute('fill', background)
  clone.insertBefore(bg, clone.firstChild)
  return { xml: new XMLSerializer().serializeToString(clone), width, height }
}

export async function svgToPng(svg: SVGSVGElement, scale = 2, caption?: string): Promise<{ dataUrl: string; width: number; height: number }> {
  const background = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#ffffff'
  const ink = getComputedStyle(document.documentElement).getPropertyValue('--text-2').trim() || '#555'
  const { xml, width, height } = serializeSvg(svg, background)
  const img = new Image()
  img.decoding = 'async'
  const loaded = new Promise<void>((res, rej) => {
    img.onload = () => res()
    img.onerror = () => rej(new Error('No fue posible convertir el gráfico en imagen.'))
  })
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`
  await loaded
  const extra = caption ? 22 : 0
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round((height + extra) * scale)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('El navegador no permite generar la imagen.')
  ctx.scale(scale, scale)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height + extra)
  ctx.drawImage(img, 0, 0, width, height)
  if (caption) {
    ctx.fillStyle = ink
    ctx.font = '11px -apple-system, "Segoe UI", sans-serif'
    ctx.fillText(caption, 8, height + 14, width - 16)
  }
  return { dataUrl: canvas.toDataURL('image/png'), width, height: height + extra }
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, b64] = dataUrl.split(',')
  const mime = /:(.*?);/.exec(head)?.[1] ?? 'image/png'
  const bin = atob(b64)
  const arr = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
  return new Blob([arr], { type: mime })
}
export const shortCaption = (index: IndexData, modelVersion?: string) =>
  `Fuente: SGC–RSNC · datos ${index.dataset_version}${modelVersion ? ` · modelo ${modelVersion}` : ''} · SismoNexo Colombia (uso académico, no es alerta oficial)`

// ------------------------------------------------------------------ PDF

export interface ReportSection {
  heading: string
  paragraphs?: string[]
  bullets?: string[]
  table?: { columns: string[]; rows: Cell[][]; note?: string }
  image?: { dataUrl: string; width: number; height: number; caption?: string }
}
export interface ReportDoc {
  title: string
  subtitle?: string
  prov: Provenance
  sections: ReportSection[]
}

/** Las fuentes estándar de PDF usan WinAnsi: se sustituyen los símbolos que no existen en esa codificación. */
export const pdfText = (s: string) =>
  s
    .replaceAll('≥', '>=')
    .replaceAll('≤', '<=')
    .replaceAll('−', '-')
    .replaceAll('→', '->')
    .replaceAll('≈', '~')
    .replaceAll('₁₀', '10')
    .replaceAll(' ', ' ')
    .replaceAll(' ', ' ')
    .replace(/[^ -ÿ–—‘’“”•…\n]/g, '')

export async function buildPdf(doc: ReportDoc): Promise<Blob> {
  const { jsPDF } = await import('jspdf')
  const pdf = new jsPDF({ unit: 'pt', format: 'letter' })
  const W = pdf.internal.pageSize.getWidth()
  const H = pdf.internal.pageSize.getHeight()
  const M = 54
  const CW = W - 2 * M
  let y = M
  const ensure = (h: number) => {
    if (y + h > H - 72) {
      pdf.addPage()
      y = M
    }
  }
  const text = (s: string, size: number, style: 'normal' | 'bold' = 'normal', color: [number, number, number] = [27, 31, 35], gap = 4) => {
    pdf.setFont('helvetica', style)
    pdf.setFontSize(size)
    pdf.setTextColor(...color)
    const lines = pdf.splitTextToSize(pdfText(s), CW) as string[]
    for (const line of lines) {
      ensure(size * 1.35)
      pdf.text(line, M, y + size)
      y += size * 1.35
    }
    y += gap
  }
  pdf.setProperties({ title: pdfText(doc.title), author: doc.prov.autor, subject: 'SismoNexo Colombia — informe académico', creator: 'SismoNexo Colombia' })
  text('SISMONEXO COLOMBIA', 9, 'bold', [11, 95, 107], 6)
  text(doc.title, 20, 'bold', [27, 31, 35], 4)
  if (doc.subtitle) text(doc.subtitle, 11, 'normal', [85, 96, 106], 8)
  text(`Autor: ${doc.prov.autor} · ${doc.prov.institucion}`, 10)
  text(`Fecha del informe: ${new Date(doc.prov.generado).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' })}`, 10)
  text(`Fuente: ${doc.prov.fuente}. ${doc.prov.url}`, 10)
  text(`Versión del conjunto de datos: ${doc.prov.version_datos}${doc.prov.version_modelo ? ` · Versión del modelo: ${doc.prov.version_modelo}` : ''}`, 10)
  if (doc.prov.pronostico_generado) text(`Fecha de generación del pronóstico: ${doc.prov.pronostico_generado}`, 10)
  if (doc.prov.filtros?.length) text(`Filtros aplicados: ${doc.prov.filtros.join('; ')}.`, 10)
  y += 4
  pdf.setDrawColor(200, 204, 206)
  pdf.line(M, y, W - M, y)
  y += 14

  for (const s of doc.sections) {
    ensure(60)
    text(s.heading, 13, 'bold', [27, 31, 35], 6)
    for (const p of s.paragraphs ?? []) text(p, 10.5, 'normal', [27, 31, 35], 6)
    for (const b of s.bullets ?? []) text(`•  ${b}`, 10.5, 'normal', [27, 31, 35], 3)
    if (s.image) {
      const w = Math.min(CW, s.image.width)
      const h = (s.image.height * w) / s.image.width
      ensure(h + 24)
      pdf.addImage(s.image.dataUrl, 'PNG', M, y, w, h)
      y += h + 6
      if (s.image.caption) text(s.image.caption, 8.5, 'normal', [85, 96, 106], 8)
    }
    if (s.table) {
      const cols = s.table.columns.length
      const colW = CW / cols
      const size = cols > 6 ? 7.5 : 8.5
      const row = (cells: Cell[], bold: boolean) => {
        pdf.setFont('helvetica', bold ? 'bold' : 'normal')
        pdf.setFontSize(size)
        const wrapped = cells.map((c) => pdf.splitTextToSize(pdfText(c == null ? '—' : String(c)), colW - 6) as string[])
        const h = Math.max(...wrapped.map((w) => w.length)) * size * 1.25 + 6
        ensure(h)
        if (bold) {
          pdf.setFillColor(236, 238, 237)
          pdf.rect(M, y, CW, h, 'F')
        }
        pdf.setTextColor(27, 31, 35)
        wrapped.forEach((w, i) => pdf.text(w, M + i * colW + 3, y + size + 2))
        pdf.setDrawColor(220, 224, 226)
        pdf.line(M, y + h, W - M, y + h)
        y += h
      }
      row(s.table.columns, true)
      s.table.rows.forEach((r) => row(r, false))
      y += 6
      if (s.table.note) text(s.table.note, 8.5, 'normal', [85, 96, 106], 6)
    }
    y += 6
  }
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7.5)
    pdf.setTextColor(85, 96, 106)
    const foot = pdf.splitTextToSize(pdfText(`Advertencia de uso académico: ${doc.prov.advertencia}`), CW - 60) as string[]
    pdf.text(foot, M, H - 50)
    pdf.text(`${i} / ${pages}`, W - M, H - 50, { align: 'right' })
  }
  return pdf.output('blob')
}
