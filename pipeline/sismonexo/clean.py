"""Limpieza auditada del catálogo y construcción de la tabla de eventos.

Cada regla deja una entrada en el registro de auditoría con el número de
registros de entrada, afectados y descartados. Ningún valor se imputa: lo que
la fuente no reporta queda vacío y se contabiliza.

Uso::

    python -m sismonexo.clean
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import sys

import numpy as np
import pandas as pd
import shapely
from shapely.geometry import shape

from . import config

NUMERIC = ["latitude", "longitude", "depth_km", "magnitude", "magnitude_mw", "phases", "rms_s",
           "gap_deg", "error_lat_km", "error_lon_km", "error_depth_km"]


class Audit:
    """Registro de auditoría: una entrada por transformación aplicada."""

    def __init__(self) -> None:
        self.steps: list[dict] = []

    def add(self, rule: str, title: str, detail: str, n_in: int, affected: int, dropped: int, action: str) -> None:
        self.steps.append({
            "order": len(self.steps) + 1, "rule": rule, "title": title, "detail": detail,
            "rows_in": int(n_in), "rows_affected": int(affected), "rows_dropped": int(dropped),
            "rows_out": int(n_in - dropped), "action": action,
        })


def magnitude_family(t: str) -> str:
    """Agrupa los tipos de magnitud publicados (MLr_1, MLv, Mw(mB)…) en familias."""
    u = (t or "").strip()
    low = u.lower()
    if not u:
        return "No reportado"
    if low.startswith("mlr"):
        return "MLr"
    if low.startswith("mlv"):
        return "MLv"
    if low.startswith("ml"):
        return "ML"
    if low.startswith("mww") or low.startswith("mwp") or low.startswith("mw"):
        return "Mw"
    if low.startswith("mb"):
        return "mb"
    if low == "m":
        return "M"
    return u


def location_quality(gap: pd.Series, err_h: pd.Series, rms: pd.Series) -> pd.Series:
    """Código de calidad de localización derivado en este proyecto (no es un código del SGC).

    A: gap ≤ 180°, error horizontal ≤ 5 km y RMS ≤ 1,0 s.
    B: gap ≤ 220°, error horizontal ≤ 10 km y RMS ≤ 1,5 s.
    C: gap ≤ 300° y error horizontal ≤ 25 km.
    D: el resto con métricas reportadas.  N: sin métricas reportadas.
    """
    q = pd.Series("D", index=gap.index, dtype="object")
    c = (gap <= 300) & (err_h <= 25)
    b = (gap <= 220) & (err_h <= 10) & (rms <= 1.5)
    a = (gap <= 180) & (err_h <= 5) & (rms <= 1.0)
    q[c] = "C"
    q[b] = "B"
    q[a] = "A"
    q[gap.isna() | err_h.isna()] = "N"
    return q


def load_polygons(name: str) -> tuple[list, list[dict]]:
    fc = json.loads((config.RAW / "dane" / f"{name}.geojson").read_text(encoding="utf-8"))
    geoms, props = [], []
    for f in fc["features"]:
        g = shape(f["geometry"])
        if not g.is_valid:
            g = shapely.make_valid(g)
        geoms.append(g)
        props.append(f["properties"])
    return geoms, props


def spatial_join(lon: np.ndarray, lat: np.ndarray, geoms: list) -> np.ndarray:
    """Índice del polígono que contiene cada punto (-1 si ninguno)."""
    tree = shapely.STRtree(geoms)
    pts = shapely.points(lon, lat)
    pi, gi = tree.query(pts, predicate="within")
    out = np.full(len(lon), -1, dtype=np.int32)
    # Si un punto cae en dos polígonos por la simplificación, se conserva el primero.
    out[pi[::-1]] = gi[::-1]
    return out


def title_es(s: str) -> str:
    """Nombre propio en español: 'VALLE DEL CAUCA' -> 'Valle del Cauca'."""
    minor = {"de", "del", "la", "las", "los", "y", "el"}
    words = s.lower().split()
    out = []
    for i, w in enumerate(words):
        if i and w in minor:
            out.append(w)
        elif w in {"d.c.", "d.c"}:
            out.append("D. C.")
        else:
            out.append(w[:1].upper() + w[1:])
    return " ".join(out)


def run() -> dict:
    config.ensure_dirs()
    audit = Audit()
    raw = pd.read_csv(config.INTERIM / "rsnc_raw.csv", dtype=str, keep_default_na=False)
    n0 = len(raw)
    df = raw.copy()

    # R01 — fechas
    ts = pd.to_datetime(df["event_datetime_utc"], utc=True, errors="coerce")
    bad = ts.isna()
    audit.add("R01", "Fecha y hora en UTC (ISO 8601)",
              "La fuente publica la hora en UTC. Se descartan registros con fecha ilegible.",
              len(df), bad.sum(), bad.sum(), "descartar")
    df = df[~bad].copy()
    df["event_datetime_utc"] = ts[~bad]

    # R02 — tipos numéricos
    for c in NUMERIC:
        df[c] = pd.to_numeric(df[c].replace("", np.nan), errors="coerce")
    audit.add("R02", "Conversión de campos numéricos",
              "Latitud, longitud, profundidad, magnitud, fases, RMS, gap y errores pasan a número. "
              "Los vacíos se conservan como dato faltante (sin imputar).",
              len(df), len(df), 0, "transformar")

    # R03 — coordenadas
    b = config.BBOX
    bad = (df["latitude"].isna() | df["longitude"].isna()
           | ~df["latitude"].between(b["lat_min"], b["lat_max"])
           | ~df["longitude"].between(b["lon_min"], b["lon_max"]))
    n_invalid_coords = int(bad.sum())
    audit.add("R03", "Coordenadas válidas dentro de la ventana de estudio",
              f"WGS84. Ventana: lat {b['lat_min']} a {b['lat_max']}, lon {b['lon_min']} a {b['lon_max']}.",
              len(df), bad.sum(), bad.sum(), "descartar")
    df = df[~bad].copy()

    # R04 — magnitud
    bad = df["magnitude"].isna()
    n_missing_mag = int(bad.sum())
    audit.add("R04", "Magnitud reportada",
              "Sin magnitud no es posible evaluar umbrales; el registro se descarta y se contabiliza.",
              len(df), bad.sum(), bad.sum(), "descartar")
    df = df[~bad].copy()

    # R05 — duplicados exactos de identificador
    df = df.sort_values("event_datetime_utc", kind="stable")
    dup = df.duplicated("event_id", keep="first")
    n_dup_id = int(dup.sum())
    audit.add("R05", "Duplicados por identificador",
              "Un mismo identificador de evento aparece más de una vez (por ejemplo, en el traslape de consultas).",
              len(df), dup.sum(), dup.sum(), "descartar")
    df = df[~dup].copy()

    # R06 — duplicados aproximados (misma solución publicada dos veces)
    t = df["event_datetime_utc"].astype("int64") // 10**9 if str(df["event_datetime_utc"].dtype).endswith("ns, UTC]") \
        else (df["event_datetime_utc"] - pd.Timestamp("1970-01-01", tz="UTC")) // pd.Timedelta(seconds=1)
    t = np.asarray(t, dtype=np.int64)
    lat, lon, mag = df["latitude"].to_numpy(), df["longitude"].to_numpy(), df["magnitude"].to_numpy()
    near = np.zeros(len(df), dtype=bool)
    for k in (1, 2, 3):
        same = (np.abs(t[k:] - t[:-k]) <= 2) & (np.abs(lat[k:] - lat[:-k]) <= 0.1) \
            & (np.abs(lon[k:] - lon[:-k]) <= 0.1) & (np.abs(mag[k:] - mag[:-k]) <= 0.3)
        near[k:] |= same
    n_dup_near = int(near.sum())
    audit.add("R06", "Duplicados aproximados",
              "Registros a ≤ 2 s, ≤ 0,1° y ≤ 0,3 unidades de magnitud de un registro anterior. Se conserva el primero.",
              len(df), near.sum(), near.sum(), "descartar")
    df = df[~near].copy()

    # R07 — profundidad
    miss_depth = df["depth_km"].isna()
    out_depth = (df["depth_km"] < 0) | (df["depth_km"] > 700)
    df.loc[out_depth, "depth_km"] = np.nan
    df["depth_flag"] = np.where(miss_depth, "faltante", np.where(out_depth, "fuera_de_rango",
                                np.where(df["depth_km"] == 0, "fijada_en_0", "")))
    n_missing_depth = int(miss_depth.sum())
    n_depth_out = int(out_depth.sum())
    n_depth_zero = int((df["depth_flag"] == "fijada_en_0").sum())
    audit.add("R07", "Profundidad faltante, fuera de rango o fijada en 0 km",
              "Las profundidades < 0 o > 700 km pasan a faltante. Profundidad exactamente 0 km suele indicar "
              "profundidad fijada por el analista; se marca, no se descarta.",
              len(df), miss_depth.sum() + out_depth.sum() + n_depth_zero, 0, "marcar")

    # R08 — familia de magnitud
    df["magnitude_family"] = df["magnitude_type"].map(magnitude_family)
    audit.add("R08", "Familia del tipo de magnitud",
              "Se agrupan variantes (MLr_1, MLr_2, MLv, Mw…) en familias. La magnitud original no se convierte "
              "ni se homogeneiza: los tipos no son equivalentes entre sí.",
              len(df), len(df), 0, "transformar")

    # R09 — asignación territorial con polígonos oficiales del DANE
    dgeoms, dprops = load_polygons("departamentos")
    mgeoms, mprops = load_polygons("municipios")
    di = spatial_join(df["longitude"].to_numpy(), df["latitude"].to_numpy(), dgeoms)
    mi = spatial_join(df["longitude"].to_numpy(), df["latitude"].to_numpy(), mgeoms)
    df["source_department"] = df["department"]
    df["source_municipality"] = df["municipality"]
    df["department_code"] = [dprops[i]["DPTO_CCDGO"] if i >= 0 else "" for i in di]
    df["department"] = [title_es(dprops[i]["DPTO_CNMBRE"]) if i >= 0 else "" for i in di]
    df["municipality_code"] = [mprops[i]["MPIO_CDPMP"] if i >= 0 else "" for i in mi]
    df["municipality"] = [title_es(mprops[i]["MPIO_CNMBRE"]) if i >= 0 else "" for i in mi]
    # Coherencia: el municipio manda sobre el departamento cuando discrepan por simplificación.
    has_m = df["municipality_code"] != ""
    df.loc[has_m, "department_code"] = df.loc[has_m, "municipality_code"].str[:2]
    code_to_name = {p["DPTO_CCDGO"]: title_es(p["DPTO_CNMBRE"]) for p in dprops}
    df.loc[has_m, "department"] = df.loc[has_m, "department_code"].map(code_to_name)
    outside = df["department_code"] == ""
    audit.add("R09", "Departamento y municipio por unión espacial (DANE, MGN 2025)",
              "El epicentro se ubica en los polígonos oficiales. Los eventos en el mar o en países vecinos quedan "
              "sin departamento; se conservan porque aportan a las celdas de frontera.",
              len(df), (~outside).sum(), 0, "enriquecer")

    # R10 — descripción de ubicación para registros que no la traen
    empty_desc = df["location_description"] == ""
    desc = np.where(df["source_municipality"] != "",
                    df["source_municipality"].str.title() + " - " + df["source_department"].str.title() + ", Colombia",
                    "")
    df.loc[empty_desc, "location_description"] = desc[empty_desc.to_numpy()]
    audit.add("R10", "Descripción de ubicación",
              "Para el periodo SEISAN se arma como 'Municipio - Departamento' con los campos publicados por el SGC.",
              len(df), empty_desc.sum(), 0, "transformar")

    # R11 — error de localización y código de calidad
    df["location_error_km"] = np.sqrt(df["error_lat_km"] ** 2 + df["error_lon_km"] ** 2).round(2)
    # 999 es el valor centinela del formulario del SGC para 'sin estimación'.
    sentinel = (df["error_lat_km"] >= 999) | (df["error_lon_km"] >= 999)
    df.loc[sentinel, "location_error_km"] = np.nan
    df["quality_code"] = location_quality(df["gap_deg"], df["location_error_km"], df["rms_s"])
    audit.add("R11", "Error horizontal y código de calidad de localización",
              "Error horizontal = √(error_lat² + error_lon²). El código A–D/N es una clasificación propia de este "
              "proyecto basada en gap, error horizontal y RMS; no es un código oficial del SGC.",
              len(df), len(df), 0, "derivar")

    # R12 — estado de revisión
    df["reviewed"] = df["status"].str.lower().isin(["revisado", "manual"])
    audit.add("R12", "Estado de revisión",
              "'Revisado' (SEISAN) y 'manual' (SeisComP) se interpretan como solución revisada por un analista.",
              len(df), int(df["reviewed"].sum()), 0, "derivar")

    # R13 — valores atípicos de magnitud (se marcan, no se eliminan)
    out_mag = (df["magnitude"] > 8.5) | (df["magnitude"] < config.MIN_MAGNITUDE)
    df["magnitude_flag"] = np.where(out_mag, "atipica", "")
    audit.add("R13", "Magnitudes atípicas",
              f"Magnitud > 8,5 o inferior al umbral de consulta ({config.MIN_MAGNITUDE}). Se marcan para revisión.",
              len(df), out_mag.sum(), 0, "marcar")

    df["magnitude_error"] = np.nan  # la fuente no publica el error de magnitud en estos formularios
    now = dt.datetime.now(dt.timezone.utc)
    df["imported_at"] = now.isoformat(timespec="seconds")
    last = df["event_datetime_utc"].max()
    digest = hashlib.sha256(pd.util.hash_pandas_object(df[["event_id", "magnitude", "latitude"]], index=False).values.tobytes()).hexdigest()[:8]
    version = f"rsnc-{last:%Y.%m.%d}-{digest}"
    df["dataset_version"] = version

    cols = ["event_id", "event_datetime_utc", "latitude", "longitude", "depth_km", "magnitude", "magnitude_type",
            "magnitude_family", "magnitude_mw", "municipality", "municipality_code", "department", "department_code",
            "location_description", "source", "source_url", "reviewed", "location_error_km", "magnitude_error",
            "quality_code", "phases", "rms_s", "gap_deg", "error_lat_km", "error_lon_km", "error_depth_km",
            "depth_flag", "magnitude_flag", "status", "imported_at", "dataset_version"]
    events = df[cols].reset_index(drop=True)
    events.to_parquet(config.PROCESSED / "events.parquet", index=False)
    events.assign(event_datetime_utc=events["event_datetime_utc"].dt.strftime("%Y-%m-%dT%H:%M:%SZ")) \
        .to_csv(config.PROCESSED / "events.csv.gz", index=False, compression="gzip")

    removed_vars = ["Enlaces a archivos S-file, formas de onda y mapa individual (no son atributos del evento)"]
    summary = {
        "dataset_version": version,
        "generated_at": now.isoformat(timespec="seconds"),
        "records_downloaded": int(n0),
        "records_final": int(len(events)),
        "records_dropped": int(n0 - len(events)),
        "coverage_start": events["event_datetime_utc"].min().strftime("%Y-%m-%dT%H:%M:%SZ"),
        "coverage_end": last.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "min_magnitude_query": config.MIN_MAGNITUDE,
        "bbox": config.BBOX,
        "counts": {
            "invalid_coordinates": n_invalid_coords, "missing_magnitude": n_missing_mag,
            "duplicate_id": n_dup_id, "duplicate_near": n_dup_near,
            "missing_depth": n_missing_depth, "depth_out_of_range": n_depth_out, "depth_fixed_zero": n_depth_zero,
            "outlier_magnitude": int(out_mag.sum()), "outside_departments": int(outside.sum()),
            "reviewed": int(events["reviewed"].sum()),
            "missing_location_error": int(events["location_error_km"].isna().sum()),
        },
        "removed_variables": removed_vars,
        "audit": audit.steps,
    }
    (config.PROCESSED / "audit.json").write_text(json.dumps(summary, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"Eventos finales: {len(events)} de {n0} descargados · versión {version}")
    for s in audit.steps:
        print(f"  {s['rule']} {s['title']}: afectados={s['rows_affected']} descartados={s['rows_dropped']}")
    return summary


def clean_csi() -> pd.DataFrame:
    """Normaliza el Catálogo Sísmico Integrado (magnitud Mw homogénea, 1610–2020)."""
    fc = json.loads((config.RAW / "csi" / "csi_caparr.geojson").read_text(encoding="utf-8"))
    rows = []
    for f in fc["features"]:
        p = f["properties"]
        if p.get("ESP_FECHA_LONG") is None or p.get("ESP_MAGNITUD") is None:
            continue
        rows.append({
            "event_id": f"CSI-{p['ESP_ID_EVENTO_TXT']}",
            "time_ms": int(p["ESP_FECHA_LONG"]),
            "latitude": p["ESP_LATITUD"], "longitude": p["ESP_LONGITUD"],
            "depth_km": p["ESP_PROFUNDIDAD"], "magnitude": round(float(p["ESP_MAGNITUD"]), 2),
            "magnitude_type": "Mw (homogeneizada, CSI)",
            "magnitude_source": p.get("ESP_FUENTE_MAGNITUD") or "",
            "location_source": p.get("ESP_FUENTE_LOCALIZACION") or "",
            "department_code": p.get("DEPT_CODIGO") or "",
            "municipality_code": p.get("MUN_CODIGO") or "",
            "error_h_km": p.get("ERRORES_LOC_2D"), "error_depth_km": p.get("ERROR_PROF"),
            "error_magnitude": p.get("ERROR_MAG"),
        })
    df = pd.DataFrame(rows).drop_duplicates("event_id").sort_values("time_ms").reset_index(drop=True)
    # Año calendario proléptico: las fechas anteriores a 1970 son milisegundos negativos.
    epoch = dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    df["year"] = [(epoch + dt.timedelta(milliseconds=int(v))).year for v in df["time_ms"]]
    df.to_parquet(config.PROCESSED / "csi_events.parquet", index=False)
    print(f"CSI: {len(df)} eventos, {df['year'].min()}–{df['year'].max()}")
    return df


def main() -> int:
    run()
    clean_csi()
    return 0


if __name__ == "__main__":
    sys.exit(main())
