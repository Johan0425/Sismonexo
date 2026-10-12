"""Exporta los artefactos que consume la aplicación web (``web/public/data``).

Todos los archivos se derivan de datos reales ya descargados y limpiados:

* ``events.json``       catálogo instrumental en formato columnar compacto.
* ``csi.json``          Catálogo Sísmico Integrado (1610–2020) para el contexto histórico.
* ``geo/*.geojson``     límites del DANE (MGN 2025).
* ``zones/<unidad>.json`` tabla de zonas de cada unidad de análisis.
* ``quality.json``      indicadores de calidad, cobertura y rupturas estructurales.
* ``index.json``        procedencia, versiones, auditoría y resumen de los experimentos.

Los pronósticos (``fc/*.json``) los escribe ``sismonexo.run_all``.
"""
from __future__ import annotations

import json
import sys

import numpy as np
import pandas as pd

from . import config, zones
from . import modeling as M
from .clean import title_es
from .features import ETAS, FEATURE_INFO, FEATURES, PREV_EVENT_MAG, load_events

SEISCOMP_EVENT_URL = (config.SOURCES["rsnc_seiscomp"]["url"].rsplit("/", 1)[0]
                      + "/download.php?destino=eventos/events/{id}&file={id}.xml")
MISSING_FIELDS = {
    "depth_km": "Profundidad", "location_error_km": "Error de localización", "rms_s": "RMS",
    "gap_deg": "Gap azimutal", "error_depth_km": "Error de profundidad", "magnitude_mw": "Magnitud Mw",
    "magnitude_error": "Error de magnitud", "municipality": "Municipio",
}
LICENSES = {
    "rsnc": "Información pública del Servicio Geológico Colombiano. Uso académico con cita de la fuente, "
            "según los términos de uso del SGC y la Ley 1712 de 2014 de transparencia y acceso a la información pública.",
    "csi": "Información pública del Servicio Geológico Colombiano. Artículo de referencia en el Boletín Geológico "
           "(acceso abierto, CC BY 4.0).",
    "dane": "Información pública del DANE, de uso libre con cita de la fuente (Marco Geoestadístico Nacional).",
}


def _write(name: str, obj) -> int:
    path = config.WEB_DATA / name
    path.parent.mkdir(parents=True, exist_ok=True)
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    path.write_text(txt, encoding="utf-8")
    return len(txt.encode("utf-8"))


def _codes(s: pd.Series) -> tuple[list[int], list[str]]:
    cat = pd.Categorical(s)
    return cat.codes.astype(int).tolist(), [str(c) for c in cat.categories]


def _nan_list(a, nd: int) -> list:
    return [None if not np.isfinite(v) else round(float(v), nd) for v in np.asarray(a, dtype=float)]


def export_events(ev: pd.DataFrame) -> dict:
    ev = ev.sort_values("event_datetime_utc", kind="stable").reset_index(drop=True)
    seisan = ev["source"].str.contains("SEISAN").to_numpy()
    # Los identificadores SEISAN se derivan de la fecha; basta guardar el sufijo y reconstruirlos en el navegador.
    ids = [i.rsplit("-", 1)[1] if s else i for i, s in zip(ev["event_id"], seisan)]
    mt, mt_names = _codes(ev["magnitude_type"])
    dep_codes = sorted(c for c in ev["department_code"].unique() if c)
    mun_codes = sorted(c for c in ev["municipality_code"].unique() if c)
    dep_ix = {c: i for i, c in enumerate(dep_codes)}
    mun_ix = {c: i for i, c in enumerate(mun_codes)}
    outside = ev["municipality"] == ""
    loc, loc_names = _codes(ev["location_description"].where(outside, ""))
    q, q_names = _codes(ev["quality_code"])
    flag = ev["depth_flag"].map({"": 0, "fijada_en_0": 1, "fuera_de_rango": 2}).fillna(0).astype(int)
    out = {
        "n": len(ev),
        "t": (ev["event_datetime_utc"].astype("int64") // 1_000_000).astype(int).tolist(),
        "lon": ev["longitude"].round(3).tolist(), "lat": ev["latitude"].round(3).tolist(),
        "depth": _nan_list(ev["depth_km"], 1), "mag": ev["magnitude"].round(1).tolist(),
        "mt": mt, "mt_names": mt_names,
        "dep": [dep_ix.get(c, -1) for c in ev["department_code"]], "dep_codes": dep_codes,
        "mun": [mun_ix.get(c, -1) for c in ev["municipality_code"]], "mun_codes": mun_codes,
        "loc": loc, "loc_names": loc_names,
        "q": q, "q_names": q_names,
        "err": _nan_list(ev["location_error_km"], 1),
        "src": seisan.astype(int).tolist(),
        "status": [0 if s == "automatic" else 1 for s in ev["status"]],
        "dflag": flag.tolist(),
        "id": ids,
        "sources": [
            {"key": "rsnc_seiscomp", "name": "SGC-RSNC (SeisComP)", "event_url": SEISCOMP_EVENT_URL,
             "query_url": config.SOURCES["rsnc_seiscomp"]["url"]},
            {"key": "rsnc_seisan", "name": "SGC-RSNC (SEISAN)", "event_url": None,
             "query_url": config.SOURCES["rsnc_seisan"]["url"]},
        ],
    }
    out["bytes"] = _write("events.json", out)
    return out


def export_csi() -> int:
    c = pd.read_parquet(config.PROCESSED / "csi_events.parquet")
    obj = {"n": len(c), "year": c["year"].astype(int).tolist(),
           "t": (c["time_ms"] // 1000).astype(int).tolist(),
           "lon": c["longitude"].round(2).tolist(), "lat": c["latitude"].round(2).tolist(),
           "depth": _nan_list(c["depth_km"], 0), "mag": c["magnitude"].round(1).tolist()}
    _write("csi.json", obj)
    return len(c)


def export_geo() -> dict:
    out = {}
    names = {}
    for name, key in (("departamentos", "dep"), ("municipios", "mun")):
        fc = json.loads((config.RAW / "dane" / f"{name}.geojson").read_text(encoding="utf-8"))
        feats = []
        for f in fc["features"]:
            p = f["properties"]
            if key == "dep":
                names[p["DPTO_CCDGO"]] = title_es(p["DPTO_CNMBRE"])
                props = {"id": p["DPTO_CCDGO"], "name": title_es(p["DPTO_CNMBRE"])}
            else:
                props = {"id": p["MPIO_CDPMP"], "name": title_es(p["MPIO_CNMBRE"]), "dep": p["DPTO_CCDGO"]}
            feats.append({"type": "Feature", "id": int(props["id"]), "properties": props, "geometry": f["geometry"]})
        _write(f"geo/{key}.geojson", {"type": "FeatureCollection", "features": feats})
        out[key] = len(feats)
    return out


def export_zones() -> dict:
    out = {}
    for unit in zones.UNITS:
        t = zones.build(unit).table
        _write(f"zones/{unit}.json", {
            "unit": unit, "label": zones.UNITS[unit]["label"], "resolution": zones.UNITS[unit]["resolution"],
            "id": t["zone_id"].tolist(), "name": t["zone_name"].tolist(), "department": t["department"].tolist(),
            "municipality": t["municipality"].tolist(), "area_km2": t["area_km2"].tolist(),
            "lon": t["lon"].tolist(), "lat": t["lat"].tolist(),
        })
        out[unit] = len(t)
    return out


# ------------------------------------------------------------------- calidad

def pettitt(x: np.ndarray) -> dict:
    """Prueba no paramétrica de Pettitt para un único punto de cambio en la mediana."""
    x = np.asarray(x, dtype=float)
    n = len(x)
    r = pd.Series(x).rank().to_numpy()
    u = 2 * np.cumsum(r) - np.arange(1, n + 1) * (n + 1)
    k = int(np.argmax(np.abs(u[:-1])))
    kmax = float(abs(u[k]))
    p = float(min(1.0, 2 * np.exp(-6 * kmax ** 2 / (n ** 3 + n ** 2))))
    return {"index": k + 1, "p_value": p, "before": float(np.median(x[:k + 1])), "after": float(np.median(x[k + 1:]))}


def completeness_magnitude(mag: np.ndarray) -> float | None:
    """Magnitud de completitud por máxima curvatura (moda del histograma de 0,1) + 0,2."""
    if len(mag) < 200:
        return None
    b = np.round(mag, 1)
    vals, cnt = np.unique(b, return_counts=True)
    return round(float(vals[int(np.argmax(cnt))]) + 0.2, 1)


def export_quality(ev: pd.DataFrame, audit: dict) -> dict:
    ev = ev.copy()
    ts = ev["event_datetime_utc"]
    ev["year"], ev["month"] = ts.dt.year, ts.dt.month
    years = list(range(int(ev["year"].min()), int(ev["year"].max()) + 1))
    by_year = []
    for y, g in ev.groupby("year"):
        by_year.append({
            "year": int(y), "n": int(len(g)),
            "seisan": int(g["source"].str.contains("SEISAN").sum()),
            "m4": int((g["magnitude"] >= 4).sum()), "m5": int((g["magnitude"] >= 5).sum()),
            "mc": completeness_magnitude(g["magnitude"].to_numpy()),
            "median_mag": round(float(g["magnitude"].median()), 2),
            "median_depth": round(float(g["depth_km"].median()), 1),
            "median_error_km": None if g["location_error_km"].isna().all() else round(float(g["location_error_km"].median()), 2),
            "median_gap": None if g["gap_deg"].isna().all() else round(float(g["gap_deg"].median()), 1),
            "median_phases": round(float(g["phases"].median()), 1),
            "quality": {q: int((g["quality_code"] == q).sum()) for q in "ABCDN"},
            "reviewed": int(g["reviewed"].sum()), "depth_fixed": int((g["depth_flag"] == "fijada_en_0").sum()),
            "in_departments": int((g["department_code"] != "").sum()),
        })
    cal = ev.groupby(["year", "month"]).size()
    calendar = [[int(y), int(m), int(n)] for (y, m), n in cal.items()]
    types = (ev.groupby(["year", "magnitude_family"]).size().unstack(fill_value=0).reindex(years, fill_value=0))
    missing = {}
    for col, label in MISSING_FIELDS.items():
        isna = ev[col].isna() if ev[col].dtype != object and str(ev[col].dtype) != "str" else (ev[col] == "")
        s = isna.groupby(ev["year"]).mean().reindex(years)
        missing[col] = {"label": label, "by_year": [round(float(v), 4) for v in s], "total": round(float(isna.mean()), 4)}
    dep = (ev[ev["department_code"] != ""].groupby(["department_code", "department"])
           .agg(n=("magnitude", "size"), m4=("magnitude", lambda s: int((s >= 4).sum())),
                max_mag=("magnitude", "max"), median_depth=("depth_km", "median"),
                good=("quality_code", lambda s: float(s.isin(["A", "B"]).mean())),
                first=("event_datetime_utc", "min"), last=("event_datetime_utc", "max")).reset_index())
    by_dep = [{"code": r.department_code, "name": r.department, "n": int(r.n), "m4": int(r.m4), "max_mag": float(r.max_mag),
               "median_depth": None if pd.isna(r.median_depth) else round(float(r.median_depth), 1),
               "good_share": round(r.good, 4), "first": r.first.strftime("%Y-%m-%d"), "last": r.last.strftime("%Y-%m-%d")}
              for r in dep.itertuples()]

    # Rupturas estructurales sobre series mensuales completas (se excluye el mes en curso).
    monthly = ev.set_index("event_datetime_utc").resample("MS")
    series = {
        "count": ("Eventos por mes (M ≥ 2,5)", monthly.size()),
        "count_m3": ("Eventos por mes (M ≥ 3,0)", ev[ev["magnitude"] >= 3.0].set_index("event_datetime_utc").resample("MS").size()),
        "median_mag": ("Magnitud mediana mensual", monthly["magnitude"].median()),
        "median_depth": ("Profundidad mediana mensual", monthly["depth_km"].median()),
        "median_error": ("Error de localización mediano mensual", monthly["location_error_km"].median()),
    }
    breaks = []
    for key, (label, s) in series.items():
        s = s.iloc[:-1].dropna()
        if len(s) < 48:
            continue
        r = pettitt(s.to_numpy())
        breaks.append({"series": key, "label": label, "date": s.index[r["index"]].strftime("%Y-%m"),
                       "p_value": float(f"{r['p_value']:.3g}"), "median_before": round(r["before"], 3),
                       "median_after": round(r["after"], 3), "significant": bool(r["p_value"] < 0.01)})
    mag = ev["magnitude"].to_numpy()
    mag_hist = [[round(float(v), 1), int(c)] for v, c in zip(*np.unique(np.round(mag, 1), return_counts=True))]
    out = {
        "totals": {"records": int(len(ev)), **audit["counts"], "records_downloaded": audit["records_downloaded"],
                   "records_dropped": audit["records_dropped"],
                   "reviewed_share": round(float(ev["reviewed"].mean()), 4),
                   "automatic": int((ev["status"] == "automatic").sum())},
        "by_year": by_year, "calendar": calendar,
        "magnitude_types": {"years": years, "families": {c: types[c].astype(int).tolist() for c in types.columns},
                            "detail": {k: int(v) for k, v in ev["magnitude_type"].value_counts().items()}},
        "missing": missing, "by_department": by_dep, "breaks": breaks, "magnitude_histogram": mag_hist,
        "instrument_changes": [
            {"date": config.SEISCOMP_START, "title": "Cambio de sistema de procesamiento: SEISAN → SeisComP",
             "detail": "Desde marzo de 2018 el SGC publica el catálogo procesado con SeisComP. Cambian los tipos de magnitud "
                       "(ML → MLr y variantes regionales), la densidad de la red y los criterios de revisión. Las series que "
                       "cruzan esa fecha no son estrictamente homogéneas.",
             "source": config.SOURCES["rsnc_seiscomp"]["landing"]},
        ],
        "quality_code_definition": {
            "A": "gap ≤ 180°, error horizontal ≤ 5 km y RMS ≤ 1,0 s", "B": "gap ≤ 220°, error horizontal ≤ 10 km y RMS ≤ 1,5 s",
            "C": "gap ≤ 300° y error horizontal ≤ 25 km", "D": "el resto con métricas reportadas", "N": "sin métricas reportadas",
            "note": "Código derivado en este proyecto a partir de gap, error horizontal y RMS. No es un código oficial del SGC.",
        },
    }
    _write("quality.json", out)
    return out


# -------------------------------------------------------------------- índice

def export_index(ev: pd.DataFrame, audit: dict, counts: dict) -> dict:
    rs = json.loads((config.RAW / "rsnc_manifest.json").read_text(encoding="utf-8"))["entries"]
    aux = json.loads((config.RAW / "aux_manifest.json").read_text(encoding="utf-8"))
    fetched = sorted(e["fetched_at"] for e in rs.values())
    csi = pd.read_parquet(config.PROCESSED / "csi_events.parquet")
    processing = [f"{s['rule']} · {s['title']}" for s in audit["audit"]]

    def src(key: str, **kw) -> dict:
        s = config.SOURCES[key]
        return {"key": key, "name": s["name"], "publisher": s["publisher"], "url": s["url"], "landing": s["landing"], **kw}

    n_seisan = int(ev["source"].str.contains("SEISAN").sum())
    sources = [
        src("rsnc_seisan", consulted_at=fetched[0], updated_at=config.SEISAN_END,
            coverage=[config.SEISAN_START, config.SEISAN_END], records=n_seisan, license=LICENSES["rsnc"],
            processing=processing, removed_variables=audit["removed_variables"],
            dropped=audit["records_dropped"], dataset_version=audit["dataset_version"],
            files=sum(1 for k in rs if k.startswith("rsnc_seisan"))),
        src("rsnc_seiscomp", consulted_at=fetched[-1], updated_at=audit["coverage_end"],
            coverage=[config.SEISCOMP_START, audit["coverage_end"][:10]], records=len(ev) - n_seisan,
            license=LICENSES["rsnc"], processing=processing, removed_variables=audit["removed_variables"],
            dropped=audit["records_dropped"], dataset_version=audit["dataset_version"],
            files=sum(1 for k in rs if k.startswith("rsnc_seiscomp"))),
        src("csi", consulted_at=aux["csi"]["fetched_at"], updated_at=f"{int(csi['year'].max())}-12-31",
            coverage=[str(int(csi["year"].min())), str(int(csi["year"].max()))], records=int(len(csi)),
            license=LICENSES["csi"],
            processing=["Se descartan registros sin fecha o sin magnitud", "Duplicados por identificador",
                        "Se conserva la magnitud Mw homogeneizada que publica el CSI"],
            removed_variables=["Atributos internos del visor (identificadores de capa y estilos)"],
            dropped=int(aux["csi"]["records"] - len(csi)), dataset_version=f"csi-{aux['csi']['sha256'][:8]}",
            note="Se usa solo como contexto histórico. No alimenta los modelos de pronóstico."),
        src("dane_mgn", consulted_at=aux["dane_departamentos"]["fetched_at"], updated_at="2025",
            coverage=["2025", "2025"], records=aux["dane_departamentos"]["records"] + aux["dane_municipios"]["records"],
            license=LICENSES["dane"],
            processing=[f"Simplificación geométrica en el servidor: {aux['dane_departamentos']['server_simplification_deg']}° "
                        f"(departamentos) y {aux['dane_municipios']['server_simplification_deg']}° (municipios)",
                        "Reparación de geometrías inválidas"],
            removed_variables=["Atributos administrativos no usados (acto de creación, año de vigencia)"],
            dropped=0, dataset_version=f"mgn2025-{aux['dane_municipios']['sha256'][:8]}"),
    ]
    experiments = []
    for p in sorted((config.WEB_DATA / "fc").glob("*.json")):
        r = json.loads(p.read_text(encoding="utf-8"))
        c, sel = r["config"], r["selected_model"]
        experiments.append({
            "id": p.stem, "unit": c["unit"], "horizon": c["horizon_days"], "threshold": c["threshold"],
            "n_zones": c["n_zones"], "n_rows": c["n_rows"], "positives": c["positives"], "prevalence": c["prevalence"],
            "full_comparison": c["full_comparison"], "model_version": c["model_version"],
            "selected_model": sel, "generated_at": r["forecast"]["generated_at"],
            "forecast_start": r["forecast"]["forecast_start"], "forecast_end": r["forecast"]["forecast_end"],
            "models": {k: {"pr_auc": m["walk_forward"]["pr_auc"], "brier": m["walk_forward"]["brier"],
                           "log_loss": m["walk_forward"]["log_loss"], "brier_skill": m["walk_forward"].get("brier_skill"),
                           "status": m["calibration_status"]} for k, m in r["models"].items()},
            "leakage": [x["status"] for x in r["leakage"]],
        })
    idx = {
        "app": {"name": "SismoNexo Colombia",
                "subtitle": "Atlas inteligente de actividad sísmica y pronóstico probabilístico para Colombia",
                "author": "Johan Antonio Peña López", "institution": "Institución Universitaria EAM",
                "program": "Especialización en Analítica de Datos Aplicada a los Negocios"},
        "dataset_version": audit["dataset_version"], "generated_at": audit["generated_at"],
        "coverage": [audit["coverage_start"], audit["coverage_end"]], "min_magnitude": audit["min_magnitude_query"],
        "bbox": audit["bbox"], "records": int(len(ev)), "counts": counts,
        "sources": sources, "audit": audit["audit"],
        "units": {u: {**v, "n_zones": counts["zones"][u],
                      **({"grid_deg": zones.GRID_DEG[u]} if u in zones.GRID_DEG else {}),
                      **({"h3_res": zones.H3_RES} if u == "h3" else {})} for u, v in zones.UNITS.items()},
        "features": [{"key": f, **FEATURE_INFO[f]} for f in FEATURES],
        "model_info": M.MODEL_INFO, "depth_classes": [[lo, min(hi, 9999), n] for lo, hi, n in M.DEPTH_CLASSES],
        "etas": ETAS, "prev_event_mag": PREV_EVENT_MAG,
        "experiments": experiments,
        "official_layers": {
            "hazard": {"available": True, "name": "Mapa de amenaza sísmica nacional — PGA, periodo de retorno de 475 años",
                       "publisher": "Servicio Geológico Colombiano",
                       "service": "https://srvags.sgc.gov.co/arcgis/rest/services/Amenaza_Sismica/Mapa_Amenaza_Sismica_Nacional_PGA475/MapServer",
                       "landing": "https://amenazasismica.sgc.gov.co/"},
            "faults": {"available": False, "name": "Fallas geológicas",
                       "reason": "No se confirmó un servicio oficial de descarga con licencia documentada; la capa no se incluye."},
        },
    }
    _write("index.json", idx)
    return idx


def main() -> int:
    config.ensure_dirs()
    ev = load_events()
    audit = json.loads((config.PROCESSED / "audit.json").read_text(encoding="utf-8"))
    e = export_events(ev)
    counts = {"events": e["n"], "events_bytes": e["bytes"], "csi": export_csi(), "geo": export_geo(), "zones": export_zones()}
    export_quality(ev, audit)
    idx = export_index(ev, audit, counts)
    print(f"Artefactos web en {config.WEB_DATA} · {e['n']} eventos · {len(idx['experiments'])} experimentos")
    return 0


if __name__ == "__main__":
    sys.exit(main())
