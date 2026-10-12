// Metodología: cómo se producen, validan y deben leerse las estimaciones.
import { Link } from 'react-router-dom'
import { DataTable } from '@/charts/Chart'
import { Page } from '@/components/Shell'
import { Card, Gate, Note } from '@/components/ui'
import { forecastId, loadForecast, loadIndex, MODEL_ORDER, useAsync, type ForecastFile, type IndexData } from '@/lib/data'
import { fmtDate, fmtInt, fmtNum, fmtShare, inPhrase } from '@/lib/format'

const SECTIONS = [
  ['objetivo', '1. Qué se estima'],
  ['datos', '2. Datos y limpieza'],
  ['zonas', '3. Zonas y periodos'],
  ['variables', '4. Variables'],
  ['modelos', '5. Modelos'],
  ['validacion', '6. Validación'],
  ['calibracion', '7. Calibración e incertidumbre'],
  ['explicabilidad', '8. Explicabilidad'],
  ['arquitectura', '9. Arquitectura'],
  ['limites', '10. Limitaciones'],
] as const

const MODEL_NOTES: Record<string, string> = {
  base: 'Tasa histórica de la zona con una previa Gamma que la acerca al promedio de todas las zonas cuando hay pocos datos. P = 1 − e^(−tasa).',
  logit: 'Regresión logística con ponderación de clases sobre las 24 variables estandarizadas. Calibración isotónica.',
  pois: 'Regresión de Poisson sobre el conteo de eventos; la probabilidad usa una binomial negativa (NB2) cuya sobredispersión se estima por momentos.',
  rf: 'Bosque aleatorio de 120 árboles con submuestreo balanceado. Solo en la configuración principal (30 días, M ≥ 4,0). Calibración isotónica.',
  hgb: 'Gradient boosting por histogramas de scikit-learn (misma familia que LightGBM y XGBoost), 150 árboles de hasta 15 hojas. Calibración isotónica.',
  etas: 'Poisson con dos entradas: la tasa histórica y un término que suma, para los eventos del último año, productividad por magnitud × decaimiento de Omori × núcleo espacial. Parámetros fijos; no es un ajuste ETAS completo.',
  hyb: 'Combinación logística de las probabilidades de la línea base, la tasa tipo ETAS y el gradient boosting, ajustada en el bloque de validación.',
}

export default function Methodology() {
  const index = useAsync(loadIndex, [])
  const fc = useAsync(() => loadForecast(forecastId('g50', 30, 4)), [])
  return (
    <Page title="Metodología" lead="Cómo se producen las estimaciones, con qué datos, cómo se validan y qué no pueden decir. Todo lo descrito aquí está implementado en el pipeline del proyecto.">
      <Gate of={[index, fc] as const}>{(i, f) => <Body idx={i} fc={f} />}</Gate>
    </Page>
  )
}

function Body({ idx, fc }: { idx: IndexData; fc: ForecastFile }) {
  const groups = [...new Set(idx.features.map((f) => f.group))]
  return (
    <div className="doc-layout">
      <nav aria-label="Contenido de la metodología" style={{ position: 'sticky', top: 16 }}>
        <ul className="stack tight small">
          {SECTIONS.map(([id, label]) => (
            <li key={id}>
              <a href={`#m-${id}`} onClick={(e) => (e.preventDefault(), document.getElementById(`m-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), document.getElementById(`m-${id}`)?.focus())} style={{ textDecoration: 'none', display: 'block', padding: '6px 0' }}>
                {label}
              </a>
            </li>
          ))}
        </ul>
      </nav>
      <div className="stack loose">
        <section id="m-objetivo" tabIndex={-1} className="prose">
          <h2>1. Qué se estima</h2>
          <p>Para cada zona y cada horizonte, la plataforma estima <b>la probabilidad de registrar al menos un evento con magnitud igual o superior a un umbral</b>. El horizonte principal es de 30 días; también hay 7 y 90 días. Los umbrales entrenados son magnitud 3,0, 4,0 y 5,0.</p>
          <p>No se estima cuándo, dónde exactamente ni de qué tamaño será un sismo. Tampoco se estima daño: eso es riesgo, y exige datos de exposición y vulnerabilidad que este proyecto no incluye.</p>
          <Note tone="caution">Las estimaciones son experimentales y están separadas de los productos oficiales. La amenaza sísmica oficial de Colombia la calcula el Servicio Geológico Colombiano para periodos de retorno de cientos de años; aquí solo se muestra como capa de referencia.</Note>
        </section>

        <section id="m-datos" tabIndex={-1} className="prose">
          <h2>2. Datos y limpieza</h2>
          <p>Se usa el catálogo instrumental de la Red Sismológica Nacional de Colombia, descargado de los formularios oficiales de consulta del SGC: {fmtInt(idx.records)} eventos de magnitud {fmtNum(idx.min_magnitude, 1)} o superior entre el {fmtDate(idx.coverage[0])} y el {fmtDate(idx.coverage[1])}, dentro de la ventana 5° S–14° N y 83°–66° O. Cada respuesta original se conserva con su huella SHA-256.</p>
          <p>La limpieza aplica {idx.audit.length} reglas en orden y registra cuántas filas afecta cada una. Solo se descartan duplicados ({fmtInt(idx.audit.reduce((s, a) => s + a.rows_dropped, 0))} filas). Los valores faltantes no se imputan.</p>
          <p>El Catálogo Sísmico Integrado (1610–2020) se usa únicamente como contexto histórico en la portada. <Link to="/calidad">Ver reglas, procedencia y licencias</Link>.</p>
        </section>

        <section id="m-zonas" tabIndex={-1}>
          <div className="prose">
            <h2>3. Zonas y periodos</h2>
            <p>El territorio se divide de cinco maneras. Las mallas se definen por geometría (celdas que tocan el territorio nacional), no por la sismicidad observada, para no introducir información del futuro.</p>
          </div>
          <div style={{ marginTop: 12 }}>
            <DataTable caption="Unidades de análisis" table={{ columns: ['Unidad', 'Resolución', 'Zonas'], rows: Object.values(idx.units).map((u) => [u.label, u.resolution, u.n_zones]) }} />
          </div>
          <div className="prose" style={{ marginTop: 12 }}>
            <p>Cada fila de la tabla de modelado es una zona en una <b>fecha de origen</b>. Los orígenes se espacian cada 7 días (horizonte de 7) o cada 30 días (horizontes de 30 y 90). Las variables usan solo eventos anteriores al origen; la etiqueta usa los eventos del intervalo [origen, origen + horizonte).</p>
          </div>
        </section>

        <section id="m-variables" tabIndex={-1}>
          <div className="prose">
            <h2>4. Variables</h2>
            <p>Son {idx.features.length} variables por zona-periodo, en {groups.length} grupos. Ninguna usa información posterior al origen del pronóstico.</p>
          </div>
          <div style={{ marginTop: 12 }}>
            <DataTable caption="Variables de entrada de los modelos" maxHeight={460} table={{ columns: ['Variable', 'Grupo', 'Unidad', 'Nombre interno'], rows: idx.features.map((f) => [f.label, f.group, f.unit, f.key]) }} />
          </div>
          <p className="caption" style={{ marginTop: 8 }}>Parámetros del término tipo ETAS: α = {idx.etas.alpha}, c = {idx.etas.c_days} días, p = {idx.etas.p}, d₀ = {idx.etas.d0_km} km, q = {idx.etas.q}, magnitud de referencia {idx.etas.m_ref}, ventana de {idx.etas.window_days} días.</p>
        </section>

        <section id="m-modelos" tabIndex={-1}>
          <div className="prose">
            <h2>5. Modelos</h2>
            <p>Se comparan siete familias, de la más simple a la más flexible. No se entrenó un modelo secuencial (redes recurrentes): el número de zonas-periodo con evento no lo justifica.</p>
          </div>
          <div className="stack tight" style={{ marginTop: 12 }}>
            {MODEL_ORDER.map((k) => (
              <Card key={k} flat as="div">
                <div className="row wrap between">
                  <h4>{idx.model_info[k].name}</h4>
                  <span className="caption">{idx.model_info[k].family} · interpretabilidad {idx.model_info[k].interpretability}/5</span>
                </div>
                <p className="small" style={{ marginTop: 4 }}>{MODEL_NOTES[k]}</p>
              </Card>
            ))}
          </div>
          <p className="caption" style={{ marginTop: 8 }}>El desbalance de clases se trata con ponderación de clases en los modelos de clasificación y con métricas adecuadas (PR-AUC, Brier, log-loss); nunca con sobremuestreo antes de particionar.</p>
        </section>

        <section id="m-validacion" tabIndex={-1} className="prose">
          <h2>6. Validación</h2>
          <p>La validación es <b>walk-forward de ventana creciente</b> en {fc.folds.length} bloques. En cada bloque se entrena con todo el pasado, se valida con los dos años siguientes (calibración, umbral de decisión y pesos del híbrido) y se prueba con el año posterior. Entre conjuntos se deja una separación igual al horizonte.</p>
          <p>Nunca se usa una división aleatoria. Los dos bloques más recientes forman la <b>prueba final</b> y no participan en la elección del modelo por defecto, que es el de menor log-loss en los bloques anteriores.</p>
          <p>En la configuración principal de este documento (cuadrícula de 50 km, 30 días, M ≥ 4,0) hay {fmtInt(fc.config.n_rows)} zonas-periodo y {fmtInt(fc.config.positives)} con evento ({fmtShare(fc.config.prevalence, 2)}). El modelo elegido fue {inPhrase(fc.models[fc.selected_model]?.name)}.</p>
          <p>Un <b>detector de fugas</b> comprueba en cada experimento: variables construidas con datos futuros (se recalculan con el catálogo truncado), escaladores ajustados con todo el conjunto, duplicados entre conjuntos, ventanas superpuestas, réplicas cercanas repartidas entre entrenamiento y prueba, y variable objetivo entre las entradas. <Link to="/modelos">Ver resultados</Link>.</p>
        </section>

        <section id="m-calibracion" tabIndex={-1} className="prose">
          <h2>7. Calibración e incertidumbre</h2>
          <p>Los modelos de clasificación se calibran con regresión isotónica ajustada solo con el bloque de validación. Para que un tramo con pocos casos no produzca probabilidades de 0 o 1 exactos, cada escalón se encoge hacia la prevalencia con 20 pseudo-observaciones. La interfaz nunca muestra 0 % ni 100 %.</p>
          <p>El <b>estado de calibración</b> se asigna así: «calibrado» si el error de calibración esperado (ECE) es de 0,02 o menos y la pendiente está entre 0,8 y 1,25; «calibración parcial» si el ECE es de 0,05 o menos; «no calibrado» en otro caso; «sin evaluar» si hay menos de 30 positivos.</p>
          <p>El <b>intervalo de incertidumbre</b> de cada zona es la frecuencia observada (intervalo de Jeffreys del 90 %) en la validación para las zonas-periodo con probabilidades del mismo tramo. Con la línea base recalculada en el navegador se usa un intervalo creíble aproximado de la tasa (posterior Gamma).</p>
          <p>El <b>nivel de confianza del dato</b> de una zona es alto con más de 200 registros y al menos la mitad con localización A o B; medio con 30 a 200 registros; bajo con menos de 30.</p>
        </section>

        <section id="m-explicabilidad" tabIndex={-1} className="prose">
          <h2>8. Explicabilidad</h2>
          <p>«¿Por qué el modelo muestra este valor?» combina cinco elementos: valores SHAP del gradient boosting para la zona, importancia por permutación (caída de PR-AUC en el último bloque de prueba), dependencias parciales de las variables principales, comparación con la línea base y los periodos históricos de la misma zona más parecidos al actual.</p>
          <p>Todo ello describe el comportamiento del modelo. Son asociaciones estadísticas: no demuestran causalidad ni indican que una variable provoque sismos.</p>
        </section>

        <section id="m-arquitectura" tabIndex={-1} className="prose">
          <h2>9. Arquitectura</h2>
          <p>El prototipo funciona como aplicación estática: el pipeline en Python descarga, limpia, entrena, valida y exporta artefactos JSON que el navegador lee. Los modelos estadísticos simples se recalculan en el navegador cuando usted cambia profundidad, periodo histórico, suavizado o un horizonte personalizado; los de aprendizaje automático solo existen en las {idx.experiments.length} configuraciones entrenadas, y la interfaz lo indica.</p>
          <p>El repositorio incluye además una API con FastAPI sobre los mismos artefactos y un esquema PostgreSQL/PostGIS con Docker Compose como arquitectura objetivo. Nada de lo que usted hace en la interfaz se envía a un servidor.</p>
        </section>

        <section id="m-limites" tabIndex={-1} className="prose">
          <h2>10. Limitaciones</h2>
          <ul>
            <li><b>No es predicción.</b> No existe un método validado para predecir terremotos individuales.</li>
            <li><b>Eventos raros.</b> Para magnitud 5,0 o superior hay muy pocos casos; las diferencias entre modelos son poco fiables y la línea base suele ser la mejor opción.</li>
            <li><b>Catálogo heterogéneo.</b> En marzo de 2018 cambiaron el sistema de procesamiento y los tipos de magnitud; la red se densificó con los años. Parte de las tendencias refleja la detección, no la sismicidad.</li>
            <li><b>Magnitudes mezcladas.</b> No se homogeneizaron a Mw; un umbral «M ≥ 4,0» combina ML, MLr y otras.</li>
            <li><b>Agrupamiento.</b> Las secuencias de réplicas elevan las métricas de los modelos que usan actividad reciente; el detector de fugas lo advierte.</li>
            <li><b>ETAS simplificado</b> con parámetros fijos; sin modelo de fuentes ni atenuación.</li>
            <li><b>Sin riesgo.</b> No hay exposición ni vulnerabilidad.</li>
            <li><b>Suavizado e intervalos aproximados</b> en la línea base recalculada.</li>
          </ul>
          <Note>Versión del conjunto de datos: {idx.dataset_version}. Versión del modelo principal: {fc.config.model_version}. Pronóstico generado el {fmtDate(fc.forecast.generated_at)}.</Note>
        </section>
      </div>
    </div>
  )
}
