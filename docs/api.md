# API

Implementada con FastAPI en `api/app/main.py`. Sirve los mismos datos reales que la aplicación.

```bash
cd api && uvicorn app.main:app --reload --port 8000
```

- Documentación interactiva (OpenAPI): `http://localhost:8000/docs` · esquema: `/openapi.json`
- No está desplegada en Vercel: el sitio público es estático y no la necesita.

## Convenciones

- **Fechas**: ISO 8601 en UTC (`2024-05-01T10:20:30Z`). Los filtros `desde` y `hasta` son días UTC (`AAAA-MM-DD`), ambos inclusive.
- **Coordenadas**: WGS84; en GeoJSON, `[longitud, latitud]`.
- **Paginación**: `limite` (1–1000) y `desplazamiento`; la respuesta incluye `meta.paginacion` con `total` y `siguiente`.
- **Trazabilidad**: toda respuesta trae `meta` con fuente, URL, `version_datos`, `advertencia` y, cuando aplica, `version_modelo`. Cabecera `X-Request-ID`.
- **Errores**: `{"error": {"codigo", "mensaje", "ruta"}}` con 404, 413, 422, 429 o 503.
- **Límite**: 120 solicitudes por minuto y cliente (configurable).

## Endpoints

| Método y ruta | Descripción | Parámetros principales |
|---|---|---|
| `GET /api/events` | Eventos con filtros | `desde`, `hasta`, `mag_min`, `mag_max`, `prof_min`, `prof_max`, `departamento`, `bbox`, `calidad`, `orden`, `formato=json\|geojson` |
| `GET /api/events/{id}` | Un evento | — |
| `GET /api/events/summary` | Resumen de los eventos filtrados | los mismos filtros |
| `GET /api/zones` | Zonas de una unidad | `unidad=dep\|mun\|h3\|g50\|g25`, `departamento` |
| `GET /api/zones/{id}` | Una zona y su actividad observada | `unidad` |
| `GET /api/forecasts` | Pronóstico vigente por zona | `unidad`, `horizonte=7\|30\|90`, `umbral=3\|4\|5`, `modelo`, `prob_min` |
| `GET /api/forecasts/{zoneId}` | Todos los modelos y la explicación de una zona | `unidad`, `horizonte`, `umbral` |
| `GET /api/models` | Experimentos y modelo por defecto | `unidad`, `horizonte` |
| `GET /api/models/{id}/metrics` | Métricas, particiones y fugas (`id` como `g50-30-40`) | — |
| `GET /api/data-quality` | Indicadores, auditoría y rupturas | — |
| `GET /api/timeline` | Serie temporal de conteos | `intervalo=dia\|semana\|mes\|anio`, filtros |
| `GET /api/sources` | Procedencia y licencias | — |
| `POST /api/import` | Valida un CSV/JSON/GeoJSON (no lo almacena) | archivo `multipart` (máx. 15 MB) |
| `POST /api/scenarios` | Escenario hipotético | `unidad`, `horizonte`, `umbral`, `zone_id`, `cambios` |
| `POST /api/reports` | Informe estructurado en JSON | `tipo=zona\|periodo\|probabilistico\|calidad` |
| `POST /api/assistant/query` | Consulta en lenguaje natural → filtros y conteo | `consulta` |

## Ejemplos

```bash
# Eventos de magnitud 5 o más en Santander, en GeoJSON
curl "http://localhost:8000/api/events?departamento=68&mag_min=5&formato=geojson&limite=5"

# Las diez zonas con mayor probabilidad a 30 días para M ≥ 4,0
curl "http://localhost:8000/api/forecasts?unidad=g50&horizonte=30&umbral=4.0&limite=10"

# Escenario hipotético: ¿qué responde el modelo con 12 eventos recientes?
curl -X POST http://localhost:8000/api/scenarios -H "Content-Type: application/json" \
  -d '{"unidad":"dep","zone_id":"68","cambios":{"n_30":12}}'
```

Respuesta abreviada de `/api/forecasts`:

```json
{
  "meta": {
    "fuente": "Servicio Geológico Colombiano (SGC) — Red Sismológica Nacional de Colombia",
    "version_datos": "rsnc-2026.10.10-094f0852",
    "version_modelo": "sn-g50-h30-m40-rsnc-2026.10.10-094f0852",
    "advertencia": "Esta plataforma presenta estimaciones académicas…",
    "nota": "Una probabilidad alta no significa que un terremoto ocurrirá con certeza…",
    "paginacion": {"total": 547, "limite": 10, "desplazamiento": 0, "siguiente": 10}
  },
  "datos": [
    {"zone_id": "g50-21-26", "probability": 0.86, "uncertainty_low": 0.86, "uncertainty_high": 0.98,
     "calibration_status": "calibrado", "model_name": "hyb", "forecast_start": "2026-10-11", "forecast_end": "2026-11-10"}
  ]
}
```

## Configuración

Variables con prefijo `SISMONEXO_` (ver `.env.example`): `DATA_DIR`, `WEB_DATA_DIR`, `CORS_ORIGINS`, `RATE_LIMIT_PER_MINUTE`, `MAX_UPLOAD_BYTES`, `LOG_LEVEL`, `DATABASE_URL`.

## Pruebas

`cd api && python -m pytest tests -q` — 20 pruebas: filtros, paginación, validación, GeoJSON, pronósticos con incertidumbre, validación cronológica, importación, escenarios, informes, asistente, límite de solicitudes y cobertura de OpenAPI.
