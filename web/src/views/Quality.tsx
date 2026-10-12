// Centro de calidad del catálogo: indicadores, cobertura, faltantes, rupturas, auditoría, procedencia e importación.
import { FileUp, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarList, ChartFrame, DataTable, HeatGrid, ProvenanceContext, XYChart } from '@/charts/Chart'
import { Page } from '@/components/Shell'
import { Button, Card, Gate, Kpis, Note, Pill, Tabs } from '@/components/ui'
import { loadGeo, loadIndex, loadQuality, setSessionEvents, useAsync, type IndexData, type QualityData } from '@/lib/data'
import { downloadJson, provenance } from '@/lib/export'
import { fmtBytes, fmtDate, fmtInt, fmtNum, fmtShare } from '@/lib/format'
import { bboxInfo } from '@/lib/geo'
import { importFile, MAX_BYTES, MAX_ROWS, type ImportResult } from '@/lib/importer'
import { useApp } from '@/lib/store'

type Tab = 'indicadores' | 'cobertura' | 'faltantes' | 'auditoria' | 'procedencia' | 'importar'
const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']
const FAMILY_COLOR = ['var(--s1)', 'var(--s2)', 'var(--s3)', 'var(--s4)', 'var(--s5)', 'var(--s7)', 'var(--s6)']

export default function Quality() {
  const index = useAsync(loadIndex, [])
  const quality = useAsync(loadQuality, [])
  const [tab, setTab] = useState<Tab>('indicadores')
  return (
    <Page title="Centro de calidad del catálogo" lead="Qué tan completo y fiable es el catálogo con el que trabaja la plataforma, y qué se le hizo a cada registro antes de usarlo.">
      <Tabs
        label="Secciones de calidad"
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'indicadores', label: 'Indicadores' },
          { value: 'cobertura', label: 'Cobertura y rupturas' },
          { value: 'faltantes', label: 'Datos faltantes' },
          { value: 'auditoria', label: 'Reglas y auditoría' },
          { value: 'procedencia', label: 'Procedencia' },
          { value: 'importar', label: 'Importar datos' },
        ]}
      />
      <Gate of={[index, quality] as const}>
        {(idx, q) => (
          <ProvenanceContext.Provider value={(t) => provenance(idx, t)}>
            <div role="tabpanel" aria-labelledby={`tab-${tab}`}>
              {tab === 'indicadores' && <Indicators q={q} idx={idx} />}
              {tab === 'cobertura' && <Coverage q={q} />}
              {tab === 'faltantes' && <Missing q={q} />}
              {tab === 'auditoria' && <Audit idx={idx} q={q} />}
              {tab === 'procedencia' && <Sources idx={idx} />}
              {tab === 'importar' && <Importer idx={idx} />}
            </div>
          </ProvenanceContext.Provider>
        )}
      </Gate>
    </Page>
  )
}

function Indicators({ q, idx }: { q: QualityData; idx: IndexData }) {
  const t = q.totals
  const types = Object.entries(q.magnitude_types.detail).sort((a, b) => b[1] - a[1])
  const qTot = ['A', 'B', 'C', 'D', 'N'].map((k) => ({ k, n: q.by_year.reduce((s, y) => s + (y.quality[k] ?? 0), 0) }))
  return (
    <div className="stack loose">
      <Kpis
        label="Indicadores de calidad"
        items={[
          { label: 'Registros totales', value: fmtInt(t.records), sub: `de ${fmtInt(t.records_downloaded)} descargados` },
          { label: 'Duplicados descartados', value: fmtInt(t.duplicate_id + t.duplicate_near), sub: `${fmtInt(t.duplicate_id)} por identificador · ${fmtInt(t.duplicate_near)} casi idénticos` },
          { label: 'Coordenadas inválidas', value: fmtInt(t.invalid_coordinates) },
          { label: 'Magnitudes faltantes', value: fmtInt(t.missing_magnitude) },
          { label: 'Profundidades faltantes', value: fmtInt(q.missing.depth_km ? Math.round(q.missing.depth_km.total * t.records) : 0), sub: `${fmtInt(t.depth_out_of_range)} fuera de rango, anuladas` },
          { label: 'Profundidad fijada en 0 km', value: fmtInt(t.depth_fixed_zero), sub: 'valor convencional de la fuente' },
          { label: 'Valores atípicos de magnitud', value: fmtInt(t.outlier_magnitude) },
          { label: 'Eventos revisados', value: fmtShare(t.reviewed_share, 2), sub: `${fmtInt(t.automatic)} automáticos` },
          { label: 'Fuera de los departamentos', value: fmtInt(t.outside_departments), sub: 'mar y países vecinos' },
          { label: 'Sin error de localización', value: fmtInt(t.missing_location_error) },
          { label: 'Última actualización', value: <span style={{ fontSize: 'var(--fs-18)' }}>{fmtDate(idx.coverage[1])}</span>, sub: `versión ${idx.dataset_version}` },
        ]}
      />
      <div className="grid c2">
        <Card>
          <ChartFrame heading="h3" title="Distribución por tipo de magnitud" summary={`El catálogo mezcla ${types.length} tipos de magnitud. El más frecuente es ${types[0][0]} (${fmtShare(types[0][1] / t.records, 0)}), del periodo SEISAN; desde 2018 predominan las variantes MLr.`} table={{ columns: ['Tipo de magnitud', 'Eventos'], rows: types }}>
            {() => <BarList items={types.slice(0, 10).map(([k, v]) => ({ label: k, value: v, note: `(${fmtShare(v / t.records, 1)})` }))} format={fmtInt} />}
          </ChartFrame>
        </Card>
        <Card>
          <ChartFrame heading="h3" title="Calidad de la localización" summary={`Código derivado en este proyecto. ${fmtShare((qTot[0].n + qTot[1].n) / t.records, 0)} de los eventos tiene calidad A o B.`} table={{ columns: ['Código', 'Criterio', 'Eventos'], rows: qTot.map((x) => [x.k, q.quality_code_definition[x.k], x.n]) }} note={q.quality_code_definition.note}>
            {() => <BarList items={qTot.map((x) => ({ label: `${x.k} · ${q.quality_code_definition[x.k]}`, value: x.n }))} format={fmtInt} />}
          </ChartFrame>
        </Card>
      </div>
      <Card>
        <ChartFrame
          heading="h3"
          title="Error de localización mediano por año"
          summary={`Mediana anual del error de localización reportado. Pasó de ${fmtNum(q.by_year[0].median_error_km ?? NaN, 1)} km en ${q.by_year[0].year} a ${fmtNum(q.by_year[q.by_year.length - 1].median_error_km ?? NaN, 1)} km en ${q.by_year[q.by_year.length - 1].year}, a medida que creció la red de estaciones.`}
          table={{ columns: ['Año', 'Error mediano (km)', 'Gap mediano (°)', 'Fases (mediana)'], rows: q.by_year.map((y) => [y.year, y.median_error_km, y.median_gap, y.median_phases]) }}
        >
          {(w) => <XYChart width={w} height={220} x={{ format: String }} y={{ label: 'km' }} marks={[{ x: 2018.17, label: 'SeisComP' }]} series={[{ key: 'e', label: 'Error mediano', color: 'var(--s1)', type: 'line', data: q.by_year.map((y) => [y.year, y.median_error_km]) }]} />}
        </ChartFrame>
      </Card>
    </div>
  )
}

function Coverage({ q }: { q: QualityData }) {
  const years = q.by_year.map((y) => y.year)
  const cal = years.map((y) => MONTHS.map((_, m) => q.calendar.find((c) => c[0] === y && c[1] === m + 1)?.[2] ?? null))
  const fam = Object.keys(q.magnitude_types.families).sort((a, b) => q.magnitude_types.families[b].reduce((s, v) => s + v, 0) - q.magnitude_types.families[a].reduce((s, v) => s + v, 0)).slice(0, 6)
  return (
    <div className="stack loose">
      {q.instrument_changes.map((c) => (
        <Note key={c.date} tone="caution">
          <b>{c.title} ({fmtDate(c.date)}).</b> {c.detail}{' '}
          <a href={c.source} target="_blank" rel="noreferrer noopener">Fuente: SGC<span className="sr-only"> (se abre en una pestaña nueva)</span></a>
        </Note>
      ))}
      <Card>
        <ChartFrame
          heading="h3"
          title="Calendario de completitud"
          summary={`Eventos registrados por mes y año (M ≥ 2,5). Los meses sin registros aparecen en gris. Sirve para detectar vacíos y cambios de régimen en la detección.`}
          table={{ columns: ['Año', ...MONTHS], rows: years.map((y, i) => [y, ...cal[i]]) }}
        >
          {(w) => <HeatGrid width={w} rows={MONTHS} cols={years.map(String)} values={MONTHS.map((_, m) => years.map((_, i) => cal[i][m]))} rowLabelW={44} cellH={20} ramp="viridis" />}
        </ChartFrame>
      </Card>
      <div className="grid c2">
        <Card>
          <ChartFrame heading="h3" title="Línea temporal de cobertura" summary="Eventos por año según el sistema de procesamiento del SGC. El relevo de SEISAN a SeisComP ocurre en marzo de 2018." table={{ columns: ['Año', 'SEISAN', 'SeisComP', 'M ≥ 4', 'M ≥ 5'], rows: q.by_year.map((y) => [y.year, y.seisan, y.n - y.seisan, y.m4, y.m5]) }} legend={[{ label: 'SEISAN (1993–2018)', color: 'var(--s6)', shape: 'box' }, { label: 'SeisComP (2018–)', color: 'var(--s1)', shape: 'box' }]}>
            {(w) => <XYChart width={w} height={240} stacked x={{ format: String }} y={{ label: 'Eventos' }} series={[{ key: 'a', label: 'SEISAN', color: 'var(--s6)', type: 'bar', data: q.by_year.map((y) => [y.year, y.seisan]) }, { key: 'b', label: 'SeisComP', color: 'var(--s1)', type: 'bar', data: q.by_year.map((y) => [y.year, y.n - y.seisan]) }]} />}
          </ChartFrame>
        </Card>
        <Card>
          <ChartFrame heading="h3" title="Magnitud de completitud estimada por año" summary="Estimación por máxima curvatura (moda del histograma de magnitudes + 0,2). Por debajo de este valor el catálogo no registra todos los eventos. Está acotada por el umbral de descarga (2,5)." table={{ columns: ['Año', 'Mc estimada', 'Magnitud mediana'], rows: q.by_year.map((y) => [y.year, y.mc, y.median_mag]) }} note="Es una aproximación nacional; la completitud real varía por región.">
            {(w) => <XYChart width={w} height={240} x={{ format: String }} y={{ label: 'Magnitud', domain: [2.4, 3.6], format: (v) => fmtNum(v, 1) }} series={[{ key: 'mc', label: 'Mc estimada', color: 'var(--s2)', type: 'step', data: q.by_year.map((y) => [y.year, y.mc]) }]} />}
          </ChartFrame>
        </Card>
        <Card>
          <ChartFrame heading="h3" title="Tipos de magnitud a lo largo del tiempo" summary="Eventos por año de las familias de magnitud más frecuentes. El cambio de ML a MLr en 2018 hace que las series de magnitud no sean estrictamente homogéneas." table={{ columns: ['Año', ...fam], rows: q.magnitude_types.years.map((y, i) => [y, ...fam.map((f) => q.magnitude_types.families[f][i])]) }} legend={fam.map((f, i) => ({ label: f, color: FAMILY_COLOR[i], shape: 'box' as const }))}>
            {(w) => <XYChart width={w} height={240} stacked x={{ format: String }} y={{ label: 'Eventos' }} series={fam.map((f, i) => ({ key: f, label: f, color: FAMILY_COLOR[i], type: 'bar' as const, data: q.magnitude_types.years.map((y, k) => [y, q.magnitude_types.families[f][k]] as [number, number]) }))} />}
          </ChartFrame>
        </Card>
        <Card title="Detección de posibles rupturas estructurales" subtitle="Prueba de Pettitt (un punto de cambio en la mediana) sobre series mensuales.">
          <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ maxHeight: 'none' }}>
            <table className="table">
              <thead>
                <tr>
                  <th scope="col">Serie</th>
                  <th scope="col">Cambio</th>
                  <th scope="col" className="r">Antes</th>
                  <th scope="col" className="r">Después</th>
                  <th scope="col">Resultado</th>
                </tr>
              </thead>
              <tbody>
                {q.breaks.map((b) => (
                  <tr key={b.series}>
                    <th scope="row" style={{ whiteSpace: 'normal' }}>{b.label}</th>
                    <td>{b.date}</td>
                    <td className="r">{fmtNum(b.median_before, 1)}</td>
                    <td className="r">{fmtNum(b.median_after, 1)}</td>
                    <td><Pill tone={b.significant ? 'caution' : undefined}>{b.significant ? 'Ruptura probable' : 'Sin evidencia'}</Pill></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="caption" style={{ marginTop: 8 }}>La prueba señala el cambio más marcado de cada serie (valor p &lt; 0,01). Un cambio en el catálogo no implica un cambio en la sismicidad: suele reflejar la evolución de la red, del procesamiento o de los criterios de reporte. Los modelos se validan en bloques recientes para limitar este efecto.</p>
        </Card>
      </div>
      <Card>
        <ChartFrame heading="h3" title="Cobertura por departamento" summary={`Eventos registrados dentro de cada departamento (densidad del catálogo). ${q.by_department[0] ? `El mayor número corresponde a ${[...q.by_department].sort((a, b) => b.n - a.n)[0].name}.` : ''} En «Atlas sísmico» puede verse como mapa de densidad.`} table={{ columns: ['Departamento', 'Eventos', 'M ≥ 4', 'Magnitud máxima', 'Profundidad mediana (km)', 'Calidad A o B', 'Primer registro', 'Último registro'], rows: [...q.by_department].sort((a, b) => b.n - a.n).map((d) => [d.name, d.n, d.m4, d.max_mag, d.median_depth, fmtShare(d.good_share, 0), d.first, d.last]) }}>
          {() => (
            <div className="grid c2">
              {[0, 1].map((half) => (
                <BarList key={half} max={Math.max(...q.by_department.map((d) => d.n))} items={[...q.by_department].sort((a, b) => b.n - a.n).filter((_, i) => i % 2 === half).map((d) => ({ label: d.name, value: d.n, note: `· ${fmtShare(d.good_share, 0)} A/B` }))} format={fmtInt} />
              ))}
            </div>
          )}
        </ChartFrame>
      </Card>
    </div>
  )
}

function Missing({ q }: { q: QualityData }) {
  const years = q.by_year.map((y) => y.year)
  const fields = Object.entries(q.missing)
  return (
    <div className="stack loose">
      <Card>
        <ChartFrame heading="h3" title="Matriz de datos faltantes" summary="Porcentaje de registros sin dato por variable y año. Los valores faltantes no se imputan: se conservan como faltantes y los modelos los tratan explícitamente." table={{ columns: ['Variable', 'Total (%)', ...years.map(String)], rows: fields.map(([, f]) => [f.label, +(f.total * 100).toFixed(2), ...f.by_year.map((v) => +(v * 100).toFixed(1))]) }}>
          {(w) => <HeatGrid width={w} rows={fields.map(([, f]) => f.label)} cols={years.map(String)} values={fields.map(([, f]) => f.by_year.map((v) => v * 100))} domain={[0, 100]} format={(v) => `${fmtNum(v, v < 10 ? 1 : 0)} %`} rowLabelW={150} cellH={26} ramp="cividis" />}
        </ChartFrame>
      </Card>
      <Card title="Lectura de la matriz">
        <div className="prose">
          <ul>
            <li><b>Magnitud Mw y error de magnitud</b> faltan casi siempre: la fuente solo calcula Mw para eventos mayores y no publica el error de magnitud en la consulta usada.</li>
            <li><b>Municipio</b> falta en los eventos ubicados en el mar o en países vecinos ({fmtShare(q.missing.municipality?.total ?? 0, 1)} del total); conservan la descripción geográfica de la fuente.</li>
            <li><b>Profundidad</b> falta en muy pocos casos; además hay {fmtInt(q.totals.depth_fixed_zero)} eventos con profundidad fijada en 0 km por la fuente, que se marcan pero no se eliminan.</li>
          </ul>
        </div>
      </Card>
    </div>
  )
}

function Audit({ idx, q }: { idx: IndexData; q: QualityData }) {
  const toast = useApp((s) => s.toast)
  return (
    <div className="stack loose">
      <Card title="Tabla de reglas de calidad y registro de auditoría" subtitle="Cada transformación aplicada al catálogo, en orden, con el número de registros afectados y descartados." actions={<Button size="sm" variant="outline" onClick={() => (downloadJson('sismonexo-auditoria.json', { reglas: idx.audit, totales: q.totals }, provenance(idx, 'Registro de auditoría de la limpieza')), toast('Registro de auditoría descargado.'))}>Descargar JSON</Button>}>
        <div className="table-wrap" tabIndex={0} role="region" aria-label="Tabla desplazable" style={{ maxHeight: 'none' }}>
          <table className="table">
            <caption className="sr-only">Reglas de calidad aplicadas al catálogo</caption>
            <thead>
              <tr>
                <th scope="col">Regla</th>
                <th scope="col">Qué hace</th>
                <th scope="col">Acción</th>
                <th scope="col" className="r">Entran</th>
                <th scope="col" className="r">Afectados</th>
                <th scope="col" className="r">Descartados</th>
                <th scope="col" className="r">Salen</th>
              </tr>
            </thead>
            <tbody>
              {idx.audit.map((a) => (
                <tr key={a.rule}>
                  <th scope="row">{a.rule}</th>
                  <td className="wrap">
                    <b>{a.title}.</b> {a.detail}
                  </td>
                  <td>{a.action}</td>
                  <td className="r">{fmtInt(a.rows_in)}</td>
                  <td className="r">{fmtInt(a.rows_affected)}</td>
                  <td className="r">{fmtInt(a.rows_dropped)}</td>
                  <td className="r">{fmtInt(a.rows_out)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="caption" style={{ marginTop: 8 }}>Balance: {fmtInt(q.totals.records_downloaded)} descargados − {fmtInt(q.totals.records_dropped)} descartados = {fmtInt(q.totals.records)} registros finales. El mismo registro está en <code>data/processed/audit.json</code>.</p>
      </Card>
    </div>
  )
}

function Sources({ idx }: { idx: IndexData }) {
  return (
    <div className="stack">
      <p className="muted">Procedencia y trazabilidad de cada conjunto de datos. Ventana de estudio: {bboxInfo(idx.bbox)}. Magnitud mínima consultada: {fmtNum(idx.min_magnitude, 1)}.</p>
      {idx.sources.map((s) => (
        <Card key={s.key} title={s.name} subtitle={s.publisher}>
          <dl className="deflist stackable" style={{ gridTemplateColumns: 'minmax(140px, 220px) 1fr' }}>
            <dt>URL de consulta</dt>
            <dd style={{ textAlign: 'left' }}><a href={s.url} target="_blank" rel="noreferrer noopener">{s.url}<span className="sr-only"> (se abre en una pestaña nueva)</span></a></dd>
            <dt>Página de referencia</dt>
            <dd style={{ textAlign: 'left' }}><a href={s.landing} target="_blank" rel="noreferrer noopener">{s.landing}<span className="sr-only"> (se abre en una pestaña nueva)</span></a></dd>
            <dt>Fecha de consulta</dt>
            <dd style={{ textAlign: 'left' }}>{fmtDate(s.consulted_at)}</dd>
            <dt>Fecha de actualización</dt>
            <dd style={{ textAlign: 'left' }}>{/^\d{4}$/.test(s.updated_at) ? s.updated_at : fmtDate(s.updated_at)}</dd>
            <dt>Cobertura temporal</dt>
            <dd style={{ textAlign: 'left' }}>{s.coverage.map((c) => (/^\d{4}$/.test(c) ? c : fmtDate(c))).join(' a ')}</dd>
            <dt>Número de registros</dt>
            <dd style={{ textAlign: 'left' }}>{fmtInt(s.records)}{s.files ? ` (en ${s.files} archivos originales conservados con su huella SHA-256)` : ''}</dd>
            <dt>Licencia</dt>
            <dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.license}</dd>
            <dt>Procesamiento aplicado</dt>
            <dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.processing.join(' · ')}</dd>
            <dt>Variables eliminadas</dt>
            <dd style={{ textAlign: 'left', fontWeight: 400 }}>{s.removed_variables.join(' · ')}</dd>
            <dt>Registros descartados</dt>
            <dd style={{ textAlign: 'left' }}>{fmtInt(s.dropped)}{s.key.startsWith('rsnc') ? ' (en el catálogo instrumental completo)' : ''}</dd>
            <dt>Versión del dataset</dt>
            <dd style={{ textAlign: 'left' }}><code>{s.dataset_version}</code></dd>
          </dl>
          {s.note && <p className="caption" style={{ marginTop: 8 }}>{s.note}</p>}
        </Card>
      ))}
      <Card title={idx.official_layers.hazard.name} subtitle={`${idx.official_layers.hazard.publisher} · producto oficial, no generado por esta plataforma`}>
        <p className="small">Se muestra como capa opcional del atlas directamente desde el servicio de mapas del SGC; no se descarga ni se modifica. <a href={idx.official_layers.hazard.landing} target="_blank" rel="noreferrer noopener">Sitio oficial de amenaza sísmica<span className="sr-only"> (se abre en una pestaña nueva)</span></a>.</p>
        <p className="small" style={{ marginTop: 6 }}><b>Fallas geológicas:</b> {idx.official_layers.faults.reason}</p>
      </Card>
    </div>
  )
}

function Importer({ idx }: { idx: IndexData }) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<ImportResult | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const imported = useApp((s) => s.imported)
  const { setImported, toast } = useApp.getState()
  const handle = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    const geo = await loadGeo('dep').catch(() => null)
    setRes(await importFile(file, geo))
    setBusy(false)
  }
  return (
    <div className="stack loose">
      <div className="grid c2">
        <Card title="Importar un catálogo" subtitle="CSV, JSON o GeoJSON. El archivo se procesa en su navegador y no se envía a ningún servidor.">
          <div
            className="dropzone"
            data-over={over}
            onDragOver={(e) => (e.preventDefault(), setOver(true))}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setOver(false)
              void handle(e.dataTransfer.files[0])
            }}
          >
            <FileUp size={32} aria-hidden />
            <p><b>Arrastre y suelte un archivo aquí</b></p>
            <p className="small">o</p>
            <Button variant="primary" icon={<Upload size={16} aria-hidden />} onClick={() => input.current?.click()} disabled={busy}>
              {busy ? 'Validando…' : 'Elegir archivo'}
            </Button>
            <input ref={input} type="file" accept=".csv,.json,.geojson,.txt,text/csv,application/json,application/geo+json" className="sr-only" aria-label="Archivo de catálogo sísmico" onChange={(e) => (void handle(e.target.files?.[0]), (e.target.value = ''))} />
            <p className="caption">Máximo {MAX_BYTES / 1024 / 1024} MB y {fmtInt(MAX_ROWS)} filas.</p>
          </div>
        </Card>
        <Card title="Cómo obtener datos oficiales">
          <ol className="prose small" style={{ listStyle: 'decimal', paddingLeft: '1.2em' }}>
            <li>Abra el <a href="https://bdrsnc.sgc.gov.co/paginas1/catalogo/index.php" target="_blank" rel="noreferrer noopener">catálogo de sismicidad del SGC<span className="sr-only"> (se abre en una pestaña nueva)</span></a> y elija la consulta experta (1993–2018 o 2018 a la fecha).</li>
            <li>Defina fechas, magnitud y área; ejecute la consulta y descargue el reporte.</li>
            <li>Guárdelo como CSV con, al menos, estas columnas: fecha y hora (UTC), latitud, longitud y magnitud. Son opcionales la profundidad, el tipo de magnitud y el identificador.</li>
            <li>Suéltelo aquí. Verá qué filas se aceptan, cuáles se rechazan y por qué, antes de usarlo.</li>
          </ol>
          <p className="caption" style={{ marginTop: 8 }}>Para actualizar el catálogo completo y reentrenar los modelos, use el script del proyecto: <code>python -m sismonexo.ingest_sgc</code> (ver README). Nombres de columna admitidos: event_datetime_utc o fecha + hora_utc; latitude o latitud; longitude o longitud; magnitude o magnitud; depth_km o profundidad.</p>
        </Card>
      </div>
      {imported && (
        <Note tone="accent">
          El atlas y el explorador histórico están usando el archivo importado «{imported}».{' '}
          <button type="button" className="rowlink" style={{ border: 0, background: 'none', padding: 0, color: 'var(--accent-text)', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => (setSessionEvents(null), setImported(null), toast('Se restauró el catálogo oficial incluido.'))}>
            Volver al catálogo oficial
          </button>
        </Note>
      )}
      {res && (
        <Card title={`Validación de «${res.fileName}»`} subtitle={res.format ? `Formato detectado: ${res.format}` : undefined}>
          {res.error && <Note tone="critical" role="alert">{res.error}</Note>}
          {res.total > 0 && (
            <div className="stack">
              <Kpis label="Resultado de la validación" items={[{ label: 'Filas leídas', value: fmtInt(res.total) }, { label: 'Aceptadas', value: fmtInt(res.accepted) }, { label: 'Rechazadas o corregidas', value: fmtInt(res.issues.reduce((s, i) => s + i.count, 0)) }]} />
              {Object.keys(res.mapping).length > 0 && <p className="small">Columnas reconocidas: {Object.entries(res.mapping).map(([k, v]) => `${({ time: 'fecha y hora', date: 'fecha', hour: 'hora', lat: 'latitud', lon: 'longitud', depth: 'profundidad', mag: 'magnitud', type: 'tipo de magnitud', id: 'identificador' } as Record<string, string>)[k]} ← «${v}»`).join(' · ')}.</p>}
              {res.issues.length > 0 && <DataTable caption="Reglas de validación que encontraron problemas" table={{ columns: ['Regla', 'Filas', 'Primer caso'], rows: res.issues.map((i) => [i.rule, i.count, i.example ?? '']) }} />}
              {res.preview.length > 0 && <DataTable caption={`Vista previa: primeras ${res.preview.length} filas aceptadas`} table={{ columns: ['Fecha y hora (UTC)', 'Latitud', 'Longitud', 'Profundidad (km)', 'Magnitud', 'Tipo', 'Identificador'], rows: res.preview.map((p) => [p.time, p.lat, p.lon, p.depth, p.mag, p.type, p.id]) }} />}
              {res.events && (
                <div className="row wrap">
                  <Button
                    variant="primary"
                    onClick={() => {
                      setSessionEvents(res.events!)
                      setImported(res.fileName)
                      useApp.getState().resetFilters()
                      navigate('/atlas')
                      toast(`${fmtInt(res.accepted)} eventos importados. El atlas los muestra rotulados como archivo importado.`)
                    }}
                  >
                    Explorar en el atlas
                  </Button>
                  <Button variant="ghost" onClick={() => setRes(null)}>Descartar</Button>
                </div>
              )}
              <Note>Un archivo importado solo se usa para explorar (atlas y explorador histórico) durante esta sesión y siempre aparece rotulado como tal. Los pronósticos, el laboratorio y el comparador siguen basados en el catálogo oficial versión {idx.dataset_version}, con el que se entrenaron los modelos.</Note>
            </div>
          )}
        </Card>
      )}
      <Card title="Exportar el catálogo limpio" subtitle={`${fmtInt(idx.records)} eventos · ${fmtBytes(idx.counts.events_bytes)} en formato columnar`}>
        <p className="small">El catálogo limpio completo, con las 31 variables del modelo de datos, está en <code>data/processed/events.csv.gz</code> y <code>events.parquet</code>. Desde «Atlas sísmico → Exportar» puede descargar en CSV o GeoJSON los eventos filtrados y visibles, con su procedencia.</p>
      </Card>
    </div>
  )
}
