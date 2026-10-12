"""Acceso de solo lectura a los artefactos reales generados por el pipeline."""
from __future__ import annotations

import functools
import json
from pathlib import Path

import pandas as pd

from .settings import settings

DISCLAIMER = (
    "Esta plataforma presenta estimaciones académicas basadas en patrones históricos. No constituye una alerta "
    "oficial, no predice terremotos individuales y no reemplaza la información del Servicio Geológico Colombiano "
    "ni de las autoridades de gestión del riesgo."
)
UNITS = ("dep", "mun", "h3", "g50", "g25")
MODELS = ("base", "logit", "pois", "rf", "hgb", "etas", "hyb")


class NotAvailable(Exception):
    """El artefacto solicitado no existe (por ejemplo, el pipeline no se ha ejecutado)."""


def _read(path: Path) -> dict:
    if not path.exists():
        raise NotAvailable(f"No se encontró el artefacto «{path.name}». Ejecute el pipeline (ver README).")
    return json.loads(path.read_text(encoding="utf-8"))


@functools.lru_cache(maxsize=1)
def index() -> dict:
    return _read(settings.web_data_dir / "index.json")


@functools.lru_cache(maxsize=1)
def quality() -> dict:
    return _read(settings.web_data_dir / "quality.json")


@functools.lru_cache(maxsize=1)
def events() -> pd.DataFrame:
    path = settings.data_dir / "events.parquet"
    if not path.exists():
        raise NotAvailable("No se encontró el catálogo limpio (events.parquet). Ejecute el pipeline (ver README).")
    return pd.read_parquet(path).sort_values("event_datetime_utc", kind="stable").reset_index(drop=True)


@functools.lru_cache(maxsize=8)
def zones(unit: str) -> dict:
    return _read(settings.web_data_dir / "zones" / f"{unit}.json")


@functools.lru_cache(maxsize=12)
def forecast(config_id: str) -> dict:
    return _read(settings.web_data_dir / "fc" / f"{config_id}.json")


def config_id(unit: str, horizon: int, threshold: float) -> str:
    return f"{unit}-{horizon}-{int(round(threshold * 10))}"


def meta(**extra) -> dict:
    idx = index()
    return {
        "fuente": "Servicio Geológico Colombiano (SGC) — Red Sismológica Nacional de Colombia",
        "url_fuente": "https://bdrsnc.sgc.gov.co/paginas1/catalogo/index.php",
        "version_datos": idx["dataset_version"],
        "datos_generados": idx["generated_at"],
        "advertencia": DISCLAIMER,
        **extra,
    }
