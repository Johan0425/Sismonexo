// Informes: vista previa en pantalla y exportación a PDF, CSV, PNG, GeoJSON, JSON y enlace compartible.
import { FileDown, Link2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { DataTable } from '@/charts/Chart'
import { useNames } from '@/components/Inspectors'
import { copyLink } from '@/components/Palette'
import { Page } from '@/components/Shell'
import { Button, Card, CardSkeleton, ErrorState, Gate, Note, Select } from '@/components/ui'
import { loadIndex, useAsync, type IndexData } from '@/lib/data'
import { buildPdf, dataUrlToBlob, download, downloadCsv, downloadGeoJson, downloadJson, slug } from '@/lib/export'
import { fmtDateLong } from '@/lib/format'
import { buildReport, REPORT_TYPES, type BuiltReport, type ReportType } from '@/lib/reports'
import { useApp } from '@/lib/store'

export default function Reports() {
  const index = useAsync(loadIndex, [])
  return (
    <Page title="Informes" lead="Informes académicos y ejecutivos construidos con los datos y filtros activos. Toda exportación incluye autor, fuente, versión de los datos y del modelo, y la advertencia de uso académico.">
      <Gate of={[index] as const}>{(i) => <Builder index={i} />}</Gate>
    </Page>
  )
}

function Builder({ index }: { index: IndexData }) {
  const loc = useLocation()
  const st = loc.state as { tipo?: ReportType; zona?: string; unidad?: string } | null
  const selection = useApp((s) => s.selection)
  const filters = useApp((s) => s.filters)
  const fc = useApp((s) => s.fc)
  const toast = useApp((s) => s.toast)
  const names = useNames()
  const [type, setType] = useState<ReportType>(st?.tipo ?? 'ejecutivo')
  const [busy, setBusy] = useState(false)
  const zone = st?.zona && st.unidad ? { unit: st.unidad, id: st.zona } : selection?.kind === 'zona' ? { unit: selection.unit, id: selection.id } : null
  const ready = !!names.dep && !!names.mun
  const report = useAsync<BuiltReport>(() => (ready ? buildReport(type, { index, filters, fc, zone, names }) : new Promise<never>(() => undefined)), [type, ready, filters, fc, zone?.id, zone?.unit])
  useEffect(() => {
    if (st?.tipo) setType(st.tipo)
  }, [st?.tipo])
  const r = report.data
  const name = r ? `sismonexo-${slug(r.doc.title)}` : 'sismonexo-informe'
  const pdf = async () => {
    if (!r) return
    setBusy(true)
    try {
      download(`${name}.pdf`, await buildPdf(r.doc))
      toast('Informe en PDF descargado.')
    } catch (e) {
      toast(`No fue posible generar el PDF: ${(e as Error).message}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="grid main-aside">
      <div className="stack" style={{ order: 2 }}>
        <Card title="Tipo de informe">
          <div className="stack">
            <Select label="Informe" value={type} onChange={setType} options={REPORT_TYPES.map((t) => ({ value: t.value, label: t.label }))} hint={REPORT_TYPES.find((t) => t.value === type)?.description} />
            {type === 'zona' && <Note>{zone ? 'Se usa la zona seleccionada en el pronóstico.' : 'No hay una zona seleccionada: se usa la de mayor probabilidad. Para elegir otra, selecciónela en «Pronóstico probabilístico» y pulse «Crear informe».'}</Note>}
            {type === 'periodo' && <Note>Usa los filtros activos de fecha, magnitud, profundidad y ubicación. Cámbielos en el atlas.</Note>}
          </div>
        </Card>
        <Card title="Exportar">
          <div className="stack tight">
            <Button variant="primary" icon={<FileDown size={18} aria-hidden />} disabled={!r || busy} onClick={() => void pdf()}>
              {busy ? 'Generando PDF…' : 'Descargar PDF'}
            </Button>
            <Button disabled={!r} onClick={() => r && (downloadCsv(`${name}.csv`, r.table.columns, r.table.rows, r.doc.prov), toast('Tabla principal descargada en CSV.'))}>Tabla principal (CSV)</Button>
            <Button disabled={!r} onClick={() => r && (downloadJson(`${name}.json`, { titulo: r.doc.title, subtitulo: r.doc.subtitle, secciones: r.doc.sections.map((s) => ({ titulo: s.heading, parrafos: s.paragraphs, puntos: s.bullets, tabla: s.table })) }, r.doc.prov), toast('Informe descargado en JSON.'))}>Informe completo (JSON)</Button>
            <Button disabled={!r?.mapPng} onClick={() => r?.mapPng && (download(`${name}-mapa.png`, dataUrlToBlob(r.mapPng.dataUrl)), toast('Mapa del informe descargado en PNG.'))}>Mapa (PNG)</Button>
            <Button disabled={!r?.features} onClick={() => r?.features && (downloadGeoJson(`${name}.geojson`, r.features, r.doc.prov), toast('Datos geográficos descargados en GeoJSON.'))}>
              Datos geográficos (GeoJSON){r && !r.features ? ' · no aplica' : ''}
            </Button>
            <Button variant="outline" icon={<Link2 size={18} aria-hidden />} onClick={() => void copyLink().then((ok) => toast(ok ? 'Enlace copiado: conserva los filtros y parámetros de este informe.' : 'No fue posible copiar; copie la dirección del navegador.'))}>
              Copiar enlace compartible
            </Button>
          </div>
        </Card>
      </div>
      <div style={{ order: 1, minWidth: 0 }}>
        {report.status === 'error' ? (
          <Card><ErrorState error={report.error} retry={report.retry} /></Card>
        ) : !r ? (
          <CardSkeleton chart={420} />
        ) : (
          <article className="card" aria-label="Vista previa del informe" style={{ padding: 'var(--sp-8)' }}>
            <div className="eyebrow" style={{ color: 'var(--accent-text)' }}>SismoNexo Colombia</div>
            <h2 style={{ fontSize: 'var(--fs-28)', marginTop: 4 }}>{r.doc.title}</h2>
            {r.doc.subtitle && <p className="muted">{r.doc.subtitle}</p>}
            <dl className="deflist stackable" style={{ gridTemplateColumns: 'minmax(120px, 200px) 1fr', margin: '16px 0', padding: '12px 0', borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)' }}>
              <dt>Autor</dt><dd style={{ textAlign: 'left' }}>{r.doc.prov.autor}</dd>
              <dt>Institución</dt><dd style={{ textAlign: 'left' }}>{r.doc.prov.institucion}</dd>
              <dt>Fecha</dt><dd style={{ textAlign: 'left' }}>{fmtDateLong(r.doc.prov.generado, 'colombia')}</dd>
              <dt>Fuente</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{r.doc.prov.fuente}</dd>
              <dt>Versión de los datos</dt><dd style={{ textAlign: 'left' }}><code>{r.doc.prov.version_datos}</code></dd>
              {r.doc.prov.version_modelo && (<><dt>Versión del modelo</dt><dd style={{ textAlign: 'left' }}><code>{r.doc.prov.version_modelo}</code></dd></>)}
              {r.doc.prov.pronostico_generado && (<><dt>Pronóstico generado</dt><dd style={{ textAlign: 'left' }}>{fmtDateLong(r.doc.prov.pronostico_generado)}</dd></>)}
              {r.doc.prov.filtros && (<><dt>Filtros aplicados</dt><dd style={{ textAlign: 'left', fontWeight: 400 }}>{r.doc.prov.filtros.join(' · ')}</dd></>)}
            </dl>
            <div className="stack loose">
              {r.doc.sections.map((s) => (
                <section key={s.heading}>
                  <h3 style={{ marginBottom: 8 }}>{s.heading}</h3>
                  <div className="prose">
                    {s.paragraphs?.map((p) => <p key={p}>{p}</p>)}
                    {s.bullets && <ul>{s.bullets.map((b) => <li key={b}>{b}</li>)}</ul>}
                  </div>
                  {s.image && (
                    <figure style={{ marginTop: 8 }}>
                      <img src={s.image.dataUrl} width={s.image.width} height={s.image.height} alt={s.image.caption ?? s.heading} style={{ maxWidth: '100%', height: 'auto', borderRadius: 8, border: '1px solid var(--border)' }} />
                      {s.image.caption && <figcaption className="caption" style={{ marginTop: 4 }}>{s.image.caption}</figcaption>}
                    </figure>
                  )}
                  {s.table && (
                    <div style={{ marginTop: 8 }}>
                      <DataTable caption={s.heading} table={s.table} maxRows={40} />
                      {s.table.note && <p className="caption" style={{ marginTop: 4 }}>{s.table.note}</p>}
                    </div>
                  )}
                </section>
              ))}
              <Note tone="caution"><b>Advertencia de uso académico.</b> {r.doc.prov.advertencia}</Note>
            </div>
          </article>
        )}
      </div>
    </div>
  )
}
