"""Carga los artefactos del pipeline en PostgreSQL/PostGIS (arquitectura objetivo).

Requiere la variable SISMONEXO_DATABASE_URL y el paquete opcional ``psycopg``:

    pip install "psycopg[binary]"
    python -m sismonexo.load_postgis

El esquema está en db/migrations/001_init.sql. La carga es idempotente (upsert por clave primaria).
"""
from __future__ import annotations

import json
import os
import sys

import pandas as pd
import shapely

from . import config, zones
from .features import EventArrays, build_matrix, load_events, to_period_table

EVENT_COLS = ["event_id", "event_datetime_utc", "latitude", "longitude", "depth_km", "magnitude", "magnitude_type", "municipality",
              "department", "location_description", "source", "source_url", "reviewed", "location_error_km", "magnitude_error",
              "quality_code", "imported_at", "dataset_version"]


def _none(v):
    return None if v is None or (isinstance(v, float) and v != v) or v is pd.NaT else v


def _upsert(cur, table: str, cols: list[str], rows: list[tuple], key: str, cast: dict[str, str] | None = None) -> None:
    ph = ", ".join((cast or {}).get(c, "%s") for c in cols)
    upd = ", ".join(f"{c} = EXCLUDED.{c}" for c in cols)
    cur.executemany(f"INSERT INTO {table} ({', '.join(cols)}) VALUES ({ph}) ON CONFLICT ({key}) DO UPDATE SET {upd}", rows)


def main() -> int:
    url = os.environ.get("SISMONEXO_DATABASE_URL")
    if not url:
        print("Defina SISMONEXO_DATABASE_URL (ver .env.example).", file=sys.stderr)
        return 2
    try:
        import psycopg
    except ImportError:
        print('Instale el controlador opcional:  pip install "psycopg[binary]"', file=sys.stderr)
        return 2

    ev = load_events()
    with psycopg.connect(url) as conn, conn.cursor() as cur:
        cur.execute((config.ROOT / "db" / "migrations" / "001_init.sql").read_text(encoding="utf-8"))
        _upsert(cur, "seismic_events", EVENT_COLS, [tuple(_none(v) for v in r) for r in ev[EVENT_COLS].itertuples(index=False, name=None)], "event_id")
        print(f"seismic_events: {len(ev)} filas")

        for unit in zones.UNITS:
            zs = zones.build(unit)
            rows = [(r.zone_id, unit, r.zone_name, shapely.to_wkt(shapely.multipolygons([g]) if g.geom_type == "Polygon" else g, rounding_precision=5),
                     r.department, r.municipality, r.resolution, r.area_km2) for r, g in zip(zs.table.itertuples(), zs.geoms)]
            _upsert(cur, "zones", ["zone_id", "zone_type", "zone_name", "geometry", "department", "municipality", "resolution", "area_km2"], rows,
                    "zone_type, zone_id", {"geometry": "ST_Multi(ST_GeomFromText(%s, 4326))"})
            print(f"zones[{unit}]: {len(rows)} filas")

        # Tabla zona-periodo de la configuración principal (departamentos, 30 días, M ≥ 4,0) como ejemplo completo.
        ea = EventArrays.from_frame(ev)
        t = to_period_table(build_matrix(ea, "dep", 30, 4.0), "dep", 30)
        rows = [("dep", r.zone_id, r.period_start, r.period_end, 4.0, _none(r.event_count), int(r.recent_event_count), _none(r.mean_magnitude),
                 _none(r.max_magnitude), _none(r.accumulated_magnitude), _none(r.mean_depth), _none(r.median_depth), r.time_since_last_event,
                 r.distance_to_previous_event, r.historical_rate, json.dumps({"sin": float(r.seasonal_sin), "cos": float(r.seasonal_cos)}),
                 _none(r.data_quality_score)) for r in t.itertuples()]
        _upsert(cur, "zone_period_features", ["zone_type", "zone_id", "period_start", "period_end", "magnitude_threshold", "event_count",
                                              "recent_event_count", "mean_magnitude", "max_magnitude", "accumulated_magnitude", "mean_depth",
                                              "median_depth", "time_since_last_event", "distance_to_previous_event", "historical_rate",
                                              "seasonal_features", "data_quality_score"], rows,
                "zone_type, zone_id, period_start, period_end, magnitude_threshold")
        print(f"zone_period_features: {len(rows)} filas")

        fpath, epath = config.PROCESSED / "forecasts.parquet", config.PROCESSED / "experiments.json"
        if fpath.exists():
            f = pd.read_parquet(fpath)
            cols = ["forecast_id", "zone_type", "zone_id", "generated_at", "forecast_start", "forecast_end", "magnitude_threshold", "probability",
                    "expected_count", "uncertainty_low", "uncertainty_high", "calibration_status", "model_name", "model_version", "dataset_version"]
            _upsert(cur, "forecasts", cols, [tuple(_none(v) for v in r) for r in f[cols].itertuples(index=False, name=None)], "forecast_id")
            print(f"forecasts: {len(f)} filas")
        if epath.exists():
            ex = json.loads(epath.read_text(encoding="utf-8"))
            cols = ["experiment_id", "model_name", "training_start", "training_end", "validation_start", "validation_end", "test_start", "test_end",
                    "parameters", "metrics", "artifact_uri", "created_at"]
            _upsert(cur, "experiments", cols, [tuple(json.dumps(e[c]) if c in ("parameters", "metrics") else e[c] for c in cols) for e in ex], "experiment_id")
            print(f"experiments: {len(ex)} filas")
        conn.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
