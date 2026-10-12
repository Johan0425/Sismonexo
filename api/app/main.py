"""API de SismoNexo Colombia.

Sirve los mismos datos reales que la aplicación web: el catálogo limpio y los artefactos del pipeline.
Todas las respuestas incluyen un bloque ``meta`` con fuente, versión de los datos y advertencia de uso
académico. Fechas en ISO 8601 (UTC) y coordenadas en WGS84 (longitud, latitud).

Ejecutar:  uvicorn app.main:app --reload --port 8000   (desde la carpeta api/)
Documentación interactiva (OpenAPI): http://localhost:8000/docs
"""
from __future__ import annotations

import io
import json
import logging
import math
import re
import time
import unicodedata
import uuid
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from typing import Annotated, Literal

import numpy as np
import pandas as pd
from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import store
from .settings import settings

# ------------------------------------------------------------------ registro estructurado


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {"ts": datetime.now(timezone.utc).isoformat(timespec="milliseconds"), "nivel": record.levelname, "mensaje": record.getMessage()}
        out.update(getattr(record, "datos", {}))
        return json.dumps(out, ensure_ascii=False)


_handler = logging.StreamHandler()
_handler.setFormatter(JsonFormatter())
log = logging.getLogger("sismonexo.api")
log.handlers = [_handler]
log.setLevel(settings.log_level)
log.propagate = False

app = FastAPI(
    title="SismoNexo Colombia — API",
    version="0.1.0",
    description=(
        "API académica de actividad sísmica y pronóstico probabilístico por zona y periodo. "
        "**No es una alerta oficial y no predice terremotos individuales.** " + store.DISCLAIMER
    ),
    contact={"name": "Johan Antonio Peña López — Institución Universitaria EAM"},
    openapi_tags=[
        {"name": "eventos", "description": "Catálogo instrumental real (SGC–RSNC)"},
        {"name": "zonas", "description": "Unidades de análisis"},
        {"name": "pronósticos", "description": "Estimaciones probabilísticas experimentales"},
        {"name": "modelos", "description": "Validación walk-forward y métricas"},
        {"name": "calidad", "description": "Calidad, línea de tiempo y procedencia"},
        {"name": "acciones", "description": "Importación, escenarios, informes y asistente"},
    ],
)
app.add_middleware(CORSMiddleware, allow_origins=[o.strip() for o in settings.cors_origins.split(",") if o.strip()], allow_methods=["GET", "POST"], allow_headers=["*"])

_hits: dict[str, deque] = defaultdict(deque)


@app.middleware("http")
async def trace_and_limit(request: Request, call_next):
    """Identificador de solicitud, límite de frecuencia por cliente y registro sin datos sensibles."""
    rid = uuid.uuid4().hex[:12]
    t0 = time.perf_counter()
    client = request.client.host if request.client else "desconocido"
    now = time.monotonic()
    q = _hits[client]
    while q and now - q[0] > 60:
        q.popleft()
    if len(q) >= settings.rate_limit_per_minute:
        return JSONResponse(status_code=429, headers={"Retry-After": "60", "X-Request-ID": rid},
                            content={"error": {"codigo": "limite_de_solicitudes", "mensaje": "Demasiadas solicitudes. Intente de nuevo en un minuto.", "solicitud": rid}})
    q.append(now)
    response = await call_next(request)
    response.headers["X-Request-ID"] = rid
    response.headers["X-Content-Type-Options"] = "nosniff"
    # No se registran direcciones IP, cuerpos de solicitud ni parámetros de consulta.
    log.info("solicitud", extra={"datos": {"solicitud": rid, "metodo": request.method, "ruta": request.url.path, "estado": response.status_code, "ms": round((time.perf_counter() - t0) * 1000, 1)}})
    return response


def _error(status: int, code: str, message: str, request: Request) -> JSONResponse:
    return JSONResponse(status_code=status, content={"error": {"codigo": code, "mensaje": message, "ruta": request.url.path}})


@app.exception_handler(store.NotAvailable)
async def not_available(request: Request, exc: store.NotAvailable):
    return _error(503, "datos_no_disponibles", str(exc), request)


@app.exception_handler(HTTPException)
async def http_error(request: Request, exc: HTTPException):
    return _error(exc.status_code, {404: "no_encontrado", 413: "archivo_demasiado_grande", 422: "solicitud_invalida"}.get(exc.status_code, "error"), str(exc.detail), request)


# ------------------------------------------------------------------ utilidades

Unit = Literal["dep", "mun", "h3", "g50", "g25"]
Limit = Annotated[int, Query(ge=1, le=settings.max_page_size, description="Tamaño de página")]
Offset = Annotated[int, Query(ge=0, description="Desplazamiento")]


def _clean(v):
    if v is None or (isinstance(v, float) and not math.isfinite(v)):
        return None
    if isinstance(v, (np.floating, np.integer)):
        return _clean(v.item())
    if isinstance(v, (pd.Timestamp, datetime)):
        return v.strftime("%Y-%m-%dT%H:%M:%SZ")
    if isinstance(v, np.bool_):
        return bool(v)
    return v


EVENT_FIELDS = ["event_id", "event_datetime_utc", "latitude", "longitude", "depth_km", "magnitude", "magnitude_type", "municipality",
                "department", "location_description", "source", "source_url", "reviewed", "location_error_km", "magnitude_error",
                "quality_code", "imported_at", "dataset_version"]


def _event(row: pd.Series) -> dict:
    return {k: _clean(row[k]) for k in EVENT_FIELDS}


def _page(total: int, limit: int, offset: int) -> dict:
    return {"total": total, "limite": limit, "desplazamiento": offset, "siguiente": offset + limit if offset + limit < total else None}


def _filter_events(desde: date | None, hasta: date | None, mag_min: float, mag_max: float, prof_min: float | None, prof_max: float | None,
                   departamento: str | None, bbox: str | None, calidad: str | None) -> pd.DataFrame:
    df = store.events()
    if desde and hasta and desde > hasta:
        raise HTTPException(422, "«desde» debe ser anterior o igual a «hasta».")
    if mag_min > mag_max:
        raise HTTPException(422, "«mag_min» debe ser menor o igual que «mag_max».")
    m = (df["magnitude"] >= mag_min) & (df["magnitude"] <= mag_max)
    if desde:
        m &= df["event_datetime_utc"] >= pd.Timestamp(desde, tz="UTC")
    if hasta:
        m &= df["event_datetime_utc"] < pd.Timestamp(hasta, tz="UTC") + pd.Timedelta(days=1)
    if prof_min is not None:
        m &= df["depth_km"] >= prof_min
    if prof_max is not None:
        m &= df["depth_km"] <= prof_max
    if departamento:
        if not re.fullmatch(r"\d{2}", departamento):
            raise HTTPException(422, "«departamento» debe ser un código DIVIPOLA de dos dígitos, por ejemplo 68.")
        m &= df["department_code"] == departamento
    if calidad:
        codes = [c for c in calidad.upper().split(",") if c in {"A", "B", "C", "D", "N"}]
        if not codes:
            raise HTTPException(422, "«calidad» admite A, B, C, D o N separados por comas.")
        m &= df["quality_code"].isin(codes)
    if bbox:
        try:
            x0, y0, x1, y1 = (float(v) for v in bbox.split(","))
        except ValueError:
            raise HTTPException(422, "«bbox» debe ser lon_min,lat_min,lon_max,lat_max en WGS84.") from None
        if not (-180 <= x0 < x1 <= 180 and -90 <= y0 < y1 <= 90):
            raise HTTPException(422, "«bbox» fuera de rango o con mínimos mayores que los máximos.")
        m &= df["longitude"].between(x0, x1) & df["latitude"].between(y0, y1)
    return df[m]


def _load_fc(unidad: str, horizonte: int, umbral: float) -> dict:
    if horizonte not in (7, 30, 90) or umbral not in (3.0, 4.0, 5.0):
        raise HTTPException(404, "No hay un modelo entrenado para esa combinación. Horizontes: 7, 30, 90 días. Umbrales: 3.0, 4.0, 5.0.")
    return store.forecast(store.config_id(unidad, horizonte, umbral))


def _pick_model(fc: dict, modelo: str | None) -> str:
    if modelo in (None, "auto"):
        return fc["selected_model"]
    if modelo not in fc["forecast"]["p"]:
        raise HTTPException(404, f"El modelo «{modelo}» no está disponible en esta configuración. Disponibles: {', '.join(fc['forecast']['p'])}.")
    return modelo


def _forecast_row(fc: dict, model: str, i: int, zt: dict, zi: int) -> dict:
    f = fc["forecast"]
    exp = f["expected"].get(model)
    return {
        "forecast_id": f"{fc['id']}-{model}-{f['zone_ids'][i]}", "zone_id": f["zone_ids"][i], "zone_name": zt["name"][zi],
        "generated_at": f["generated_at"], "forecast_start": f["forecast_start"], "forecast_end": f["forecast_end"],
        "magnitude_threshold": fc["config"]["threshold"], "probability": f["p"][model][i],
        "expected_count": exp[i] if exp else None, "uncertainty_low": f["lo"][model][i], "uncertainty_high": f["hi"][model][i],
        "calibration_status": fc["models"][model]["calibration_status"], "model_name": model,
        "model_version": fc["config"]["model_version"], "dataset_version": fc["config"]["dataset_version"],
    }


# ------------------------------------------------------------------ eventos

@app.get("/api/events", tags=["eventos"], summary="Lista de eventos sísmicos con filtros y paginación")
def list_events(
    desde: Annotated[date | None, Query(description="Fecha inicial (día UTC, AAAA-MM-DD)")] = None,
    hasta: Annotated[date | None, Query(description="Fecha final inclusive (día UTC)")] = None,
    mag_min: Annotated[float, Query(ge=0, le=10)] = 2.5,
    mag_max: Annotated[float, Query(ge=0, le=10)] = 10,
    prof_min: Annotated[float | None, Query(ge=0, le=800, description="Profundidad mínima en km")] = None,
    prof_max: Annotated[float | None, Query(ge=0, le=800)] = None,
    departamento: Annotated[str | None, Query(description="Código DIVIPOLA de dos dígitos")] = None,
    bbox: Annotated[str | None, Query(description="lon_min,lat_min,lon_max,lat_max (WGS84)")] = None,
    calidad: Annotated[str | None, Query(description="Códigos de calidad separados por comas: A,B,C,D,N")] = None,
    orden: Literal["fecha", "-fecha", "magnitud", "-magnitud"] = "-fecha",
    formato: Literal["json", "geojson"] = "json",
    limite: Limit = 100,
    desplazamiento: Offset = 0,
):
    df = _filter_events(desde, hasta, mag_min, mag_max, prof_min, prof_max, departamento, bbox, calidad)
    col = "event_datetime_utc" if "fecha" in orden else "magnitude"
    df = df.sort_values(col, ascending=not orden.startswith("-"), kind="stable")
    page = df.iloc[desplazamiento:desplazamiento + limite]
    rows = [_event(r) for _, r in page.iterrows()]
    m = store.meta(paginacion=_page(len(df), limite, desplazamiento))
    if formato == "geojson":
        return {"type": "FeatureCollection", "meta": m, "features": [
            {"type": "Feature", "id": r["event_id"], "geometry": {"type": "Point", "coordinates": [r["longitude"], r["latitude"]]}, "properties": r} for r in rows]}
    return {"meta": m, "datos": rows}


@app.get("/api/events/summary", tags=["eventos"], summary="Resumen de los eventos que cumplen los filtros")
def events_summary(desde: date | None = None, hasta: date | None = None, mag_min: Annotated[float, Query(ge=0, le=10)] = 2.5,
                   mag_max: Annotated[float, Query(ge=0, le=10)] = 10, prof_min: float | None = None, prof_max: float | None = None,
                   departamento: str | None = None, bbox: str | None = None, calidad: str | None = None):
    df = _filter_events(desde, hasta, mag_min, mag_max, prof_min, prof_max, departamento, bbox, calidad)
    if df.empty:
        return {"meta": store.meta(), "datos": {"eventos": 0}}
    top = df.loc[df["magnitude"].idxmax()]
    by_dep = df[df["department"] != ""].groupby("department").size().sort_values(ascending=False).head(10)
    return {"meta": store.meta(), "datos": {
        "eventos": int(len(df)), "primer_evento": _clean(df["event_datetime_utc"].min()), "ultimo_evento": _clean(df["event_datetime_utc"].max()),
        "magnitud_maxima": float(top["magnitude"]), "evento_mayor": _event(top), "magnitud_media": round(float(df["magnitude"].mean()), 2),
        "profundidad_mediana_km": _clean(round(float(df["depth_km"].median()), 1)), "sin_profundidad": int(df["depth_km"].isna().sum()),
        "calidad": {k: int(v) for k, v in df["quality_code"].value_counts().items()},
        "departamentos_con_mas_eventos": [{"departamento": k, "eventos": int(v)} for k, v in by_dep.items()],
    }}


@app.get("/api/events/{event_id}", tags=["eventos"], summary="Un evento por identificador")
def get_event(event_id: str):
    df = store.events()
    hit = df[df["event_id"] == event_id]
    if hit.empty:
        raise HTTPException(404, "No existe un evento con ese identificador en el catálogo.")
    return {"meta": store.meta(), "datos": _event(hit.iloc[0])}


@app.get("/api/timeline", tags=["calidad"], summary="Serie temporal de conteos")
def timeline(intervalo: Literal["dia", "semana", "mes", "anio"] = "mes", desde: date | None = None, hasta: date | None = None,
             mag_min: Annotated[float, Query(ge=0, le=10)] = 2.5, departamento: str | None = None):
    df = _filter_events(desde, hasta, mag_min, 10, None, None, departamento, None, None)
    if intervalo == "dia" and len(df) and (df["event_datetime_utc"].max() - df["event_datetime_utc"].min()).days > 1100:
        raise HTTPException(422, "El intervalo diario admite como máximo tres años. Acote las fechas o use «semana» o «mes».")
    rule = {"dia": "D", "semana": "W-MON", "mes": "MS", "anio": "YS"}[intervalo]
    g = df.set_index("event_datetime_utc").resample(rule, label="left", closed="left")
    out = pd.DataFrame({"eventos": g.size(), "magnitud_maxima": g["magnitude"].max(), "profundidad_mediana_km": g["depth_km"].median()})
    return {"meta": store.meta(intervalo=intervalo), "datos": [
        {"inicio": _clean(t), "eventos": int(r.eventos), "magnitud_maxima": _clean(r.magnitud_maxima), "profundidad_mediana_km": _clean(r.profundidad_mediana_km)}
        for t, r in out.iterrows()]}


# ------------------------------------------------------------------ zonas y pronósticos

@app.get("/api/zones", tags=["zonas"], summary="Zonas de una unidad de análisis")
def list_zones(unidad: Unit = "dep", departamento: Annotated[str | None, Query(description="Nombre del departamento")] = None, limite: Limit = 200, desplazamiento: Offset = 0):
    z = store.zones(unidad)
    idx = [i for i in range(len(z["id"])) if not departamento or _fold(z["department"][i]) == _fold(departamento)]
    rows = [{"zone_id": z["id"][i], "zone_type": unidad, "zone_name": z["name"][i], "department": z["department"][i], "municipality": z["municipality"][i],
             "resolution": z["resolution"], "area_km2": z["area_km2"][i], "centroid": {"type": "Point", "coordinates": [z["lon"][i], z["lat"][i]]}}
            for i in idx[desplazamiento:desplazamiento + limite]]
    return {"meta": store.meta(paginacion=_page(len(idx), limite, desplazamiento)), "datos": rows}


@app.get("/api/zones/{zone_id}", tags=["zonas"], summary="Una zona con su actividad observada")
def get_zone(zone_id: str, unidad: Unit = "dep"):
    z = store.zones(unidad)
    if zone_id not in z["id"]:
        raise HTTPException(404, f"No existe la zona «{zone_id}» en la unidad «{unidad}».")
    i = z["id"].index(zone_id)
    out = {"zone_id": zone_id, "zone_type": unidad, "zone_name": z["name"][i], "department": z["department"][i], "municipality": z["municipality"][i],
           "resolution": z["resolution"], "area_km2": z["area_km2"][i], "centroid": {"type": "Point", "coordinates": [z["lon"][i], z["lat"][i]]}}
    if unidad in ("dep", "mun"):
        df = store.events()
        d = df[df["department_code" if unidad == "dep" else "municipality_code"] == zone_id]
        out["actividad_observada"] = {"eventos": int(len(d)), "magnitud_maxima": _clean(d["magnitude"].max()) if len(d) else None,
                                      "profundidad_mediana_km": _clean(d["depth_km"].median()) if len(d) else None,
                                      "ultimo_evento": _clean(d["event_datetime_utc"].max()) if len(d) else None}
    return {"meta": store.meta(), "datos": out}


@app.get("/api/forecasts", tags=["pronósticos"], summary="Pronóstico probabilístico vigente por zona")
def list_forecasts(unidad: Unit = "g50", horizonte: Annotated[int, Query(description="7, 30 o 90 días")] = 30,
                   umbral: Annotated[float, Query(description="3.0, 4.0 o 5.0")] = 4.0, modelo: str | None = None,
                   prob_min: Annotated[float, Query(ge=0, le=1)] = 0, limite: Limit = 200, desplazamiento: Offset = 0):
    fc = _load_fc(unidad, horizonte, umbral)
    model = _pick_model(fc, modelo)
    zt = store.zones(unidad)
    zi = {z: i for i, z in enumerate(zt["id"])}
    p = fc["forecast"]["p"][model]
    order = sorted((i for i in range(len(p)) if p[i] >= prob_min), key=lambda i: -p[i])
    rows = [_forecast_row(fc, model, i, zt, zi[fc["forecast"]["zone_ids"][i]]) for i in order[desplazamiento:desplazamiento + limite]]
    return {"meta": store.meta(paginacion=_page(len(order), limite, desplazamiento), version_modelo=fc["config"]["model_version"],
                               nota="Una probabilidad alta no significa que un terremoto ocurrirá con certeza. Una probabilidad baja tampoco significa ausencia total de actividad."),
            "datos": rows}


@app.get("/api/forecasts/{zone_id}", tags=["pronósticos"], summary="Pronóstico de una zona con todos los modelos y su explicación")
def get_forecast(zone_id: str, unidad: Unit = "g50", horizonte: int = 30, umbral: float = 4.0):
    fc = _load_fc(unidad, horizonte, umbral)
    f = fc["forecast"]
    if zone_id not in f["zone_ids"]:
        raise HTTPException(404, f"No existe la zona «{zone_id}» en la unidad «{unidad}».")
    i = f["zone_ids"].index(zone_id)
    zt = store.zones(unidad)
    zi = zt["id"].index(zone_id)
    shap = sorted(zip(fc["features"], f["shap"][i], f["features"][i]), key=lambda t: -abs(t[1]))[:8]
    return {"meta": store.meta(version_modelo=fc["config"]["model_version"]), "datos": {
        "modelo_por_defecto": fc["selected_model"],
        "pronosticos": [_forecast_row(fc, m, i, zt, zi) for m in f["p"]],
        "explicacion": {"metodo": fc["explain"]["note"], "aviso": "Asociaciones del modelo; esto no demuestra causalidad.",
                        "contribuciones_shap": [{"variable": a, "shap_log_odds": b, "valor": c} for a, b, c in shap],
                        "periodos_similares": [{"inicio": s[0], "eventos": s[1], "distancia": s[2]} for s in f["similar"][i]],
                        "similares_con_evento": f["similar_positive"][i], "similares_considerados": f["similar_k"]},
    }}


@app.get("/api/models", tags=["modelos"], summary="Experimentos disponibles y modelo por defecto de cada uno")
def list_models(unidad: Unit | None = None, horizonte: int | None = None):
    exps = [e for e in store.index()["experiments"] if (not unidad or e["unit"] == unidad) and (not horizonte or e["horizon"] == horizonte)]
    return {"meta": store.meta(), "datos": {"familias": store.index()["model_info"], "experimentos": exps}}


@app.get("/api/models/{experimento}/metrics", tags=["modelos"], summary="Métricas walk-forward, particiones y detector de fugas de un experimento")
def model_metrics(experimento: Annotated[str, Field(description="Identificador, por ejemplo g50-30-40")]):
    if not re.fullmatch(r"(dep|mun|h3|g50|g25)-(7|30|90)-(30|40|50)", experimento):
        raise HTTPException(404, "Identificador de experimento inválido. Ejemplo: g50-30-40 (unidad-horizonte-umbral×10).")
    fc = store.forecast(experimento)
    return {"meta": store.meta(version_modelo=fc["config"]["model_version"]), "datos": {
        "configuracion": fc["config"], "modelo_por_defecto": fc["selected_model"], "regla_de_seleccion": fc["selection_rule"],
        "modelos": {k: {"nombre": m["name"], "walk_forward": m["walk_forward"], "prueba_final": m["final_test"], "calibracion": m["calibration_status"],
                        "estabilidad": m["stability"], "entrenamiento_s": m["fit_seconds"], "inferencia_us_por_fila": m["inference_us_per_row"]}
                    for k, m in fc["models"].items()},
        "particiones": fc["folds"], "deteccion_de_fugas": fc["leakage"],
    }}


@app.get("/api/data-quality", tags=["calidad"], summary="Indicadores de calidad, reglas de auditoría y rupturas estructurales")
def data_quality():
    q = store.quality()
    return {"meta": store.meta(), "datos": {"totales": q["totals"], "auditoria": store.index()["audit"], "rupturas": q["breaks"],
                                            "cambios_de_instrumentacion": q["instrument_changes"], "por_anio": q["by_year"],
                                            "faltantes": q["missing"], "definicion_calidad": q["quality_code_definition"]}}


@app.get("/api/sources", tags=["calidad"], summary="Procedencia y licencias de cada conjunto de datos")
def sources():
    idx = store.index()
    return {"meta": store.meta(), "datos": {"fuentes": idx["sources"], "capas_oficiales": idx["official_layers"]}}


# ------------------------------------------------------------------ acciones

_ALIASES = {"time": ["event_datetime_utc", "fecha_hora_utc", "datetime", "time"], "lat": ["latitude", "latitud", "lat"],
            "lon": ["longitude", "longitud", "lon", "lng"], "mag": ["magnitude", "magnitud", "mag"], "depth": ["depth_km", "profundidad", "depth"]}


def _fold(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", str(s).lower()) if unicodedata.category(c) != "Mn")


@app.post("/api/import", tags=["acciones"], summary="Valida un catálogo en CSV o JSON (no lo almacena)")
async def import_file(archivo: Annotated[UploadFile, File(description="CSV o JSON con fecha y hora UTC, latitud, longitud y magnitud")]):
    name = re.sub(r"[^\w.\- ]", "", archivo.filename or "archivo")[:120]
    ext = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if ext not in {"csv", "json", "geojson", "txt"}:
        raise HTTPException(422, "Tipo de archivo no admitido. Use CSV, JSON o GeoJSON.")
    blob = await archivo.read(settings.max_upload_bytes + 1)
    if len(blob) > settings.max_upload_bytes:
        raise HTTPException(413, f"El archivo supera el límite de {settings.max_upload_bytes // 1024 // 1024} MB.")
    if b"\x00" in blob[:4096]:
        raise HTTPException(422, "El archivo parece binario. Solo se admite texto.")
    try:
        text = blob.decode("utf-8-sig")
        if ext in {"json", "geojson"}:
            data = json.loads(text)
            if isinstance(data, dict) and data.get("type") == "FeatureCollection":
                rows = [{**(f.get("properties") or {}), "longitude": (f.get("geometry") or {}).get("coordinates", [None, None])[0],
                         "latitude": (f.get("geometry") or {}).get("coordinates", [None, None])[1]} for f in data.get("features", [])]
            else:
                rows = data if isinstance(data, list) else data.get("datos") or data.get("events") or []
            df = pd.DataFrame(rows)
        else:
            df = pd.read_csv(io.StringIO(text), comment="#", sep=None, engine="python", dtype=str)
    except Exception:
        raise HTTPException(422, "No fue posible leer el archivo. Verifique que sea CSV o JSON válido en UTF-8.") from None
    if len(df) > 200_000:
        raise HTTPException(413, "El archivo supera las 200.000 filas.")
    df.columns = [re.sub(r"[^a-z0-9]+", "_", _fold(re.sub(r"\(.*?\)", "", c))).strip("_") for c in df.columns]
    cols = {k: next((a for a in al if a in df.columns), None) for k, al in _ALIASES.items()}
    missing = [k for k in ("time", "lat", "lon", "mag") if not cols[k]]
    if missing:
        raise HTTPException(422, f"Faltan columnas obligatorias: {', '.join(missing)}. Encontradas: {', '.join(map(str, df.columns[:12]))}.")
    t = pd.to_datetime(df[cols["time"]], utc=True, errors="coerce")
    lat, lon, mag = (pd.to_numeric(df[cols[k]], errors="coerce") for k in ("lat", "lon", "mag"))
    b = store.index()["bbox"]
    issues = {
        "Fecha ilegible o futura": t.isna() | (t > pd.Timestamp.now(tz="UTC")),
        "Coordenadas inválidas": lat.isna() | lon.isna() | (lat.abs() > 90) | (lon.abs() > 180),
        "Fuera de la ventana de estudio": ~(lat.between(b["lat_min"], b["lat_max"]) & lon.between(b["lon_min"], b["lon_max"])),
        "Magnitud ausente o fuera de rango": mag.isna() | (mag < -1) | (mag > 9.5),
    }
    bad = pd.Series(False, index=df.index)
    report = []
    for rule, mask in issues.items():
        new = mask & ~bad
        if new.any():
            report.append({"regla": rule, "filas": int(new.sum()), "primera_fila": int(new.idxmax()) + 2})
        bad |= mask
    ok = df[~bad]
    dup = pd.DataFrame({"t": t[~bad], "lat": lat[~bad].round(3), "lon": lon[~bad].round(3), "mag": mag[~bad].round(1)}).duplicated()
    if dup.any():
        report.append({"regla": "Registro duplicado", "filas": int(dup.sum()), "primera_fila": int(dup.idxmax()) + 2})
    accepted = int((~dup).sum())
    preview = [{"event_datetime_utc": _clean(t[i]), "latitude": float(lat[i]), "longitude": float(lon[i]), "magnitude": float(mag[i])} for i in ok.index[:10]]
    return {"meta": store.meta(), "datos": {"archivo": name, "filas_leidas": int(len(df)), "filas_aceptadas": accepted, "problemas": report,
                                            "columnas_reconocidas": cols, "vista_previa": preview,
                                            "nota": "Validación únicamente: el archivo no se almacena ni modifica el catálogo oficial."}}


class ScenarioIn(BaseModel):
    unidad: Unit = "g50"
    horizonte: Literal[7, 30, 90] = 30
    umbral: Literal[3.0, 4.0, 5.0] = 4.0
    zone_id: str = Field(max_length=40)
    cambios: dict[str, float] = Field(default_factory=dict, description="Variables a modificar, por nombre interno (por ejemplo n_30)")


def _iso(iso: dict, p: float) -> float:
    return float(np.interp(p, iso["x"], iso["y"]))


def _predict(lab: dict, features: list[str], x: np.ndarray, horizon: int, origin_days: float) -> dict[str, float]:
    """Evalúa los modelos exportados (misma lógica que el navegador y que el pipeline)."""
    eps = 1e-6
    clip = lambda p: float(min(1 - eps, max(eps, p)))  # noqa: E731
    f = dict(zip(features, x))

    def prep(pr: dict) -> np.ndarray:
        z = np.array([math.log1p(max(v, 0)) if n in pr["log_features"] and math.isfinite(v) else v for n, v in zip(features, x)], dtype=float)
        z = np.where(np.isfinite(z), z, pr["median"])
        return (z - np.array(pr["mean"])) / np.array(pr["std"])

    out = {}
    periods = origin_days / 30
    rate = (f["rate_hist"] * periods + lab["base"]["prior_events"]) / (periods + lab["base"]["prior_periods"])
    out["base"] = clip(1 - math.exp(-rate * horizon / 30))
    lg = lab["logit"]
    out["logit"] = clip(_iso(lg["iso"], 1 / (1 + math.exp(-(float(np.dot(lg["coef"], prep(lg["prep"]))) + lg["intercept"])))))
    po = lab["pois"]
    mu = min(1e4, math.exp(float(np.dot(po["coef"], prep(po["prep"]))) + po["intercept"]))
    out["pois"] = clip(1 - (1 + po["alpha"] * mu) ** (-1 / po["alpha"]))
    et = lab["etas"]
    out["etas"] = clip(1 - math.exp(-min(1e4, math.exp(et["coef"][0] * math.log(f["rate_hist"] * horizon / 30 + et["eps"]) + et["coef"][1] * f["etas_trigger"] + et["intercept"]))))
    raw = lab["hgb"]["baseline"]
    for t in lab["hgb"]["trees"]:
        k = 0
        while t["v"][k] is None:
            v = x[t["f"][k]]
            k = t["l"][k] if (bool(t["m"][k]) if not math.isfinite(v) else v <= t["t"][k]) else t["r"][k]
        raw += t["v"][k]
    out["hgb"] = clip(_iso(lab["hgb"]["iso"], 1 / (1 + math.exp(-raw))))
    hy = lab["hyb"]
    out["hyb"] = clip(1 / (1 + math.exp(-(sum(c * math.log(out[k] / (1 - out[k])) for c, k in zip(hy["coef"], hy["inputs"])) + hy["intercept"]))))
    return out


@app.post("/api/scenarios", tags=["acciones"], summary="Escenario hipotético: cómo responde el modelo al modificar variables")
def scenario(body: ScenarioIn):
    fc = _load_fc(body.unidad, body.horizonte, body.umbral)
    f = fc["forecast"]
    if body.zone_id not in f["zone_ids"]:
        raise HTTPException(404, f"No existe la zona «{body.zone_id}» en la unidad «{body.unidad}».")
    unknown = [k for k in body.cambios if k not in fc["features"]]
    if unknown:
        raise HTTPException(422, f"Variables desconocidas: {', '.join(unknown)}. Válidas: {', '.join(fc['features'])}.")
    i = f["zone_ids"].index(body.zone_id)
    real = np.array([np.nan if v is None else v for v in f["features"][i]], dtype=float)
    hyp = real.copy()
    warnings = []
    for k, v in body.cambios.items():
        r = fc["lab"]["ranges"][k]
        if not math.isfinite(v) or v < r["min"] - abs(r["max"]) or v > r["max"] * 3 + 1:
            raise HTTPException(422, f"Valor absurdo para «{k}»: {v}. El histórico va de {r['min']} a {r['max']}.")
        if v < r["q005"] or v > r["q995"]:
            warnings.append(f"«{k}» = {v} está fuera del rango histórico habitual ({r['q005']} a {r['q995']}): el modelo extrapola.")
        hyp[fc["features"].index(k)] = v
    origin = (pd.Timestamp(f["forecast_start"], tz="UTC") - pd.Timestamp("1993-06-01", tz="UTC")).days
    return {"meta": store.meta(version_modelo=fc["config"]["model_version"]), "datos": {
        "aviso": "Escenario hipotético. No representa un pronóstico oficial ni modifica los datos reales.",
        "zone_id": body.zone_id, "real": _predict(fc["lab"]["models"], fc["features"], real, body.horizonte, origin),
        "hipotetico": _predict(fc["lab"]["models"], fc["features"], hyp, body.horizonte, origin), "advertencias": warnings,
    }}


class ReportIn(BaseModel):
    tipo: Literal["zona", "periodo", "probabilistico", "calidad"] = "probabilistico"
    unidad: Unit = "g50"
    horizonte: Literal[7, 30, 90] = 30
    umbral: Literal[3.0, 4.0, 5.0] = 4.0
    zone_id: str | None = Field(default=None, max_length=40)
    desde: date | None = None
    hasta: date | None = None


@app.post("/api/reports", tags=["acciones"], summary="Informe estructurado en JSON con procedencia y limitaciones")
def report(body: ReportIn):
    idx = store.index()
    base = {"autor": idx["app"]["author"], "institucion": idx["app"]["institution"], "fecha": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "limitaciones": ["No se predicen terremotos individuales.", "Los eventos de magnitud alta son escasos y las diferencias entre modelos, poco fiables.",
                             "El catálogo cambió de sistema en marzo de 2018.", "No se incluyen exposición ni vulnerabilidad: no se mide riesgo."]}
    if body.tipo == "calidad":
        return {"meta": store.meta(), "datos": {**base, "titulo": "Informe de calidad de datos", "totales": store.quality()["totals"], "auditoria": idx["audit"]}}
    if body.tipo == "periodo":
        s = events_summary(desde=body.desde, hasta=body.hasta)["datos"]
        return {"meta": store.meta(), "datos": {**base, "titulo": "Informe por periodo", "filtros": {"desde": body.desde, "hasta": body.hasta}, "resumen": s}}
    fc = _load_fc(body.unidad, body.horizonte, body.umbral)
    model = fc["selected_model"]
    zt = store.zones(body.unidad)
    f = fc["forecast"]
    if body.tipo == "zona":
        if not body.zone_id or body.zone_id not in f["zone_ids"]:
            raise HTTPException(422, "El informe por zona requiere un «zone_id» válido para la unidad elegida.")
        i = f["zone_ids"].index(body.zone_id)
        rows = [_forecast_row(fc, model, i, zt, zt["id"].index(body.zone_id))]
        title = f"Informe por zona: {rows[0]['zone_name']}"
    else:
        order = sorted(range(len(f["zone_ids"])), key=lambda i: -f["p"][model][i])[:25]
        zi = {z: i for i, z in enumerate(zt["id"])}
        rows = [_forecast_row(fc, model, i, zt, zi[f["zone_ids"][i]]) for i in order]
        title = "Informe probabilístico"
    m = fc["models"][model]["walk_forward"]
    return {"meta": store.meta(version_modelo=fc["config"]["model_version"]), "datos": {
        **base, "titulo": title, "filtros": {"unidad": body.unidad, "horizonte_dias": body.horizonte, "umbral": body.umbral},
        "modelo": {"nombre": fc["models"][model]["name"], "pr_auc": m["pr_auc"], "brier": m["brier"], "calibracion": fc["models"][model]["calibration_status"]},
        "tabla": rows,
        "interpretacion": "Una probabilidad alta no significa que un terremoto ocurrirá con certeza. Una probabilidad baja tampoco significa ausencia total de actividad.",
    }}


class AssistantIn(BaseModel):
    consulta: str = Field(min_length=1, max_length=300)


_ALARM = re.compile(r"(va a temblar|habra (un )?(terremoto|sismo|temblor)|debo evacuar|evacu|es seguro|alerta|predic|inminente|a punto de)")


@app.post("/api/assistant/query", tags=["acciones"], summary="Nexo: convierte una consulta en filtros y devuelve el conteo real")
def assistant(body: AssistantIn):
    q = _fold(body.consulta)
    if _ALARM.search(q):
        return {"meta": store.meta(), "datos": {"intencion": "sin_alerta", "respuesta": (
            "No es posible predecir cuándo ni dónde ocurrirá un sismo, y esta plataforma no emite alertas. "
            "Consulte al Servicio Geológico Colombiano y a las autoridades de gestión del riesgo.")}}
    filtros: dict = {}
    aplicados = []
    if m := re.search(r"(?:magnitud(?:es)?|m)\s*(?:mayor(?:es)?|superior(?:es)?|>=?)\s*(?:o igual\s*)?(?:a|de|que)?\s*(\d+(?:[.,]\d+)?)", q):
        filtros["mag_min"] = float(m.group(1).replace(",", "."))
        aplicados.append(f"magnitud ≥ {m.group(1)}")
    if m := re.search(r"(?:durante|en|del|de|ano)\s+((?:19|20)\d{2})\b", q):
        filtros["desde"], filtros["hasta"] = date(int(m.group(1)), 1, 1), date(int(m.group(1)), 12, 31)
        aplicados.append(f"año {m.group(1)}")
    deps = store.zones("dep")
    for code, name in sorted(zip(deps["id"], deps["name"]), key=lambda t: -len(t[1])):
        if re.search(rf"\b{re.escape(_fold(name).split(',')[0])}\b", q):
            filtros["departamento"] = code
            aplicados.append(f"departamento: {name}")
            break
    if not aplicados:
        return {"meta": store.meta(), "datos": {"intencion": "desconocida", "respuesta": (
            "No tengo información para responder eso con los datos de la plataforma. Puedo filtrar eventos por magnitud, año y departamento.")}}
    n = len(_filter_events(filtros.get("desde"), filtros.get("hasta"), filtros.get("mag_min", 2.5), 10, None, None, filtros.get("departamento"), None, None))
    return {"meta": store.meta(), "datos": {"intencion": "filtrar", "filtros": filtros, "filtros_aplicados": aplicados, "eventos": n,
                                            "respuesta": f"Apliqué: {'; '.join(aplicados)}. Resultado: {n} eventos en el catálogo."}}


@app.get("/api/health", include_in_schema=False)
def health():
    return {"estado": "ok", "version_datos": store.index()["dataset_version"]}
