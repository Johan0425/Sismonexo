# SismoNexo Colombia

**Atlas inteligente de actividad sísmica y pronóstico probabilístico para Colombia.**

Prototipo académico de **Johan Antonio Peña López** — Institución Universitaria EAM, Especialización en Analítica de Datos Aplicada a los Negocios.

> Esta plataforma presenta estimaciones académicas basadas en patrones históricos. No constituye una alerta oficial, no predice terremotos individuales y no reemplaza la información del Servicio Geológico Colombiano ni de las autoridades de gestión del riesgo.

## Qué es

Una aplicación web que:

- muestra los **66.987 eventos reales** (M ≥ 2,5; junio de 1993 a octubre de 2026) del catálogo de la Red Sismológica Nacional de Colombia (SGC) sobre un mapa interactivo;
- estima, por zona y horizonte (7, 30 y 90 días; principal 30), la **probabilidad de registrar al menos un evento** sobre un umbral de magnitud, siempre con su intervalo de incertidumbre;
- compara siete familias de modelos con **validación cronológica walk-forward** y un detector automático de fugas de información;
- explica cada estimación (SHAP, permutación, dependencias parciales, línea base y periodos parecidos);
- documenta la calidad y la procedencia de cada dato, y exporta informes en PDF, CSV, PNG, GeoJSON y JSON.

No predice la fecha, el lugar ni la magnitud de ningún sismo.

## Estructura

```
web/        Aplicación (React + Vite + TypeScript, MapLibre GL JS). Sitio estático con los datos reales incluidos.
pipeline/   Pipeline en Python: ingesta del SGC y del DANE, limpieza auditada, zonas, variables, modelos y validación.
api/        API con FastAPI sobre los mismos artefactos (OpenAPI en /docs).
db/         Esquema PostgreSQL/PostGIS (arquitectura objetivo).
data/       raw (respuestas originales con SHA-256), interim, processed (catálogo limpio, auditoría, pronósticos).
notebooks/  Análisis exploratorio ejecutado.
docs/       Arquitectura, manuales, limitaciones, roadmap, guion de presentación y capturas.
```

## Ejecutar la aplicación web (lo más rápido)

Requisitos: Node.js 22.12 o superior.

```bash
cd web
npm ci
npm run dev          # http://localhost:5173
```

La aplicación ya incluye los datos reales de demostración en `web/public/data` (catálogo, límites, 45 experimentos). No necesita backend.

```bash
npm run build        # compila a web/dist
npm run preview      # sirve el compilado en http://localhost:4173
```

## Regenerar los datos desde cero

Requisitos: Python 3.12 o superior (verificado con 3.14) y conexión a internet.

```bash
python -m venv .venv
source .venv/bin/activate            # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cd pipeline

python -m sismonexo.ingest_sgc       # 1. Catálogo instrumental del SGC (≈ 15 min, con pausas entre solicitudes)
python -m sismonexo.ingest_aux       # 2. Catálogo Sísmico Integrado y límites del DANE
python -m sismonexo.clean            # 3. Limpieza auditada → data/processed/events.parquet y audit.json
python -m sismonexo.run_all          # 4. Entrena y valida las 45 configuraciones y exporta todo a web/public/data
```

- `run_all --rapido` entrena solo el horizonte de 30 días; `run_all --solo g50-30-40` una configuración.
- El paso 4 tarda entre 45 y 60 minutos con tres procesos. Solo exportar (sin reentrenar): `python -m sismonexo.export_web`.
- Para actualizar el catálogo basta repetir los pasos 1, 3 y 4: la ingesta vuelve a pedir únicamente el mes en curso.

## API

```bash
cd api
uvicorn app.main:app --reload --port 8000     # documentación: http://localhost:8000/docs
```

Dieciséis endpoints (`/api/events`, `/api/forecasts`, `/api/models/{id}/metrics`, `/api/data-quality`, `/api/scenarios`…) con validación, paginación, filtros, GeoJSON, límite de solicitudes y trazabilidad. Ver [docs/api.md](docs/api.md).

## Docker

```bash
cp .env.example .env                 # ajuste la contraseña de la base de datos
docker compose up --build            # web en http://localhost:8080 y API en http://localhost:8000/docs
docker compose --profile db up -d    # añade PostgreSQL/PostGIS; el esquema se aplica solo
pip install "psycopg[binary]" && cd pipeline && python -m sismonexo.load_postgis   # carga opcional de las cinco tablas
```

## Despliegue en Vercel

El repositorio está conectado al proyecto de Vercel `sismonexo-colombia`: **cada `git push` a `main` publica producción** y cada rama o pull request genera una vista previa. La configuración está en [`vercel.json`](vercel.json) (instala y compila `web/`, publica `web/dist`). Detalles y solución de problemas en [docs/despliegue.md](docs/despliegue.md).

## Pruebas

```bash
cd web
npm run typecheck
npm test                             # 50 pruebas unitarias y de componentes (Vitest)
npx playwright install chromium      # solo la primera vez
npm run test:e2e                     # 57 pruebas de extremo a extremo (Playwright + axe)

cd ../pipeline && python -m pytest tests -q      # 20 pruebas: limpieza, zonas, fugas, validación cronológica
cd ../api && python -m pytest tests -q           # 20 pruebas de la API
```

Las pruebas de extremo a extremo cubren: todas las rutas sin errores de consola, filtros → mapa/gráficos/URL, teclado, accesibilidad WCAG 2.2 AA en claro y oscuro, anchos de 375 a 2560 px, movimiento reducido, zonas horarias, importación y exportaciones.

## Fuentes de datos

| Conjunto | Fuente | Cobertura | Registros |
|---|---|---|---|
| Catálogo instrumental RSNC (SEISAN) | [SGC](https://bdrsnc.sgc.gov.co/paginas1/catalogo/index.php) | 1993-06 a 2018-02 | 48.820 |
| Catálogo instrumental RSNC (SeisComP) | [SGC](https://bdrsnc.sgc.gov.co/paginas1/catalogo/index.php) | 2018-03 a 2026-10-10 | 18.167 |
| Catálogo Sísmico Integrado (contexto histórico) | [SGC](https://catalogosismico.sgc.gov.co/visor/) | 1610 a 2020 | 15.169 |
| Límites administrativos, MGN 2025 | [DANE](https://geoportal.dane.gov.co/servicios/descarga-y-metadatos/datos-geoestadisticos/) | 2025 | 33 departamentos, 1.122 municipios |

Versión del conjunto de datos incluido: `rsnc-2026.10.10-094f0852`. La procedencia completa (URL, fecha de consulta, licencia, procesamiento, variables eliminadas y registros descartados) está en la vista «Calidad de los datos → Procedencia» y en `data/raw/*_manifest.json`.

## Resultados principales (validación walk-forward, 30 días)

| Unidad | Umbral | Modelo elegido | PR-AUC | PR-AUC línea base | Mejora de Brier |
|---|---|---|---|---|---|
| Cuadrícula ≈ 50 km | M ≥ 4,0 | Híbrido | 0,350 | 0,169 | +19,8 % |
| Municipio | M ≥ 4,0 | Poisson / binomial negativa | 0,384 | 0,329 | +8,9 % |
| Departamento | M ≥ 4,0 | Línea base | 0,613 | 0,613 | 0 % |
| Cuadrícula ≈ 50 km | M ≥ 5,0 | Poisson / binomial negativa | 0,073 | 0,033 | +2,1 % |

Lectura honesta: en mallas finas la actividad reciente aporta información real; por departamento ningún modelo supera a la frecuencia histórica, y para M ≥ 5,0 hay tan pocos casos que la mejora es marginal. El detector de fugas no encontró fallas en ninguna de las 45 configuraciones y advierte, en todas, que hay secuencias de réplicas que cruzan la frontera de prueba.

## Documentación

- [Arquitectura, componentes, flujo de datos y modelo entidad-relación](docs/arquitectura.md)
- [Manual de usuario](docs/manual-usuario.md) · [Manual metodológico](docs/manual-metodologico.md)
- [API](docs/api.md) · [Sistema de diseño](docs/sistema-diseno.md) · [Despliegue](docs/despliegue.md)
- [Limitaciones](docs/limitaciones.md) · [Roadmap](docs/roadmap.md) · [Backlog](docs/backlog.md)
- [Guion para presentar el proyecto](docs/guion-presentacion.md) · [Capturas](docs/capturas/)
- [Registro de cambios](CHANGELOG.md)

## Licencias y uso

Uso académico. Los datos pertenecen a sus fuentes (SGC y DANE) y deben citarse. Las bibliotecas de terceros conservan sus licencias (ver «Acerca del proyecto» en la aplicación). No use los resultados como alerta ni para decisiones de protección civil.
