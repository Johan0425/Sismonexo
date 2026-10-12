# Roadmap

## Corto plazo (0–3 meses)
- Actualización automática: tarea programada que ejecute ingesta, limpieza, entrenamiento y despliegue cada mes.
- **Evaluación prospectiva**: guardar cada pronóstico publicado y compararlo con lo ocurrido al cerrar el periodo; mostrar el historial en el comparador.
- Magnitudes homogéneas: relaciones de conversión ML/MLr → Mw publicadas por el SGC y análisis de sensibilidad del umbral.
- Completitud por región y época (Mc espacial) como variable y como filtro de zonas evaluables.

## Mediano plazo (3–9 meses)
- ETAS espaciotemporal ajustado por máxima verosimilitud; desagrupamiento (Gardner–Knopoff, Zaliapin) y pruebas de consistencia tipo CSEP (N, L, S).
- Modelos de suavizado adaptativo de sismicidad como segunda línea base.
- Teselas vectoriales (PMTiles) para el catálogo completo sin umbral de magnitud y para municipios.
- Capa de fallas cuando exista un servicio oficial con licencia clara.
- API desplegada con PostGIS y caché; la aplicación consulta la API cuando esté disponible y los archivos cuando no.

## Largo plazo
- Integración con exposición (población y edificaciones del DANE) para explorar indicadores de riesgo, con la participación de especialistas.
- Pronósticos condicionados a la profundidad y a dominios tectónicos.
- Revisión por pares del método y publicación de los pronósticos en un repositorio abierto con DOI.
- Versión en inglés y evaluación de usabilidad con estudiantes, docentes y personal de gestión del riesgo.
