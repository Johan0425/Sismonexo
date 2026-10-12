"""Descarga de fuentes complementarias oficiales.

* Catálogo Sísmico Integrado (CSI) del SGC — servicio REST del visor público.
* Límites departamentales y municipales — DANE, DIVIPOLA / MGN 2025.

Uso::

    python -m sismonexo.ingest_aux
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import sys
import time
import urllib.parse
import urllib.request

from . import config

CSI_REST = "https://catalogosismico.sgc.gov.co/rest_cats/"
DANE_MGN = config.SOURCES["dane_mgn"]["url"]
DANE_LAYERS = {"departamentos": 319, "municipios": 317}
# Tolerancia de simplificación en grados (≈ 550 m y ≈ 330 m). La simplificación la
# ejecuta el servidor del DANE (parámetro maxAllowableOffset de ArcGIS REST).
DANE_OFFSET = {"departamentos": 0.005, "municipios": 0.003}


def _get(url: str, timeout: int = 300, retries: int = 4) -> bytes:
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:
            last = exc
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"No fue posible consultar {url}: {last}")


def _entry(url: str, blob: bytes, n: int, extra: dict | None = None) -> dict:
    e = {
        "url": url,
        "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
        "bytes": len(blob), "sha256": hashlib.sha256(blob).hexdigest(), "records": n,
    }
    e.update(extra or {})
    return e


def fetch_csi() -> dict:
    """Consulta 'caparr' (por coordenadas) con la misma ruta que usa el visor del SGC.

    Ruta: caparr/latMin/latMax/lonMin/lonMax/profMin/profMax/magMin/magMax/fechaIni/fechaFin
    con fechas en milisegundos desde 1970-01-01 UTC. Se piden todos los eventos
    de la ventana de estudio, sin filtro de magnitud ni de fecha.
    """
    b = config.BBOX
    url = (
        f"{CSI_REST}caparr/{b['lat_min']}/{b['lat_max']}/{b['lon_min']}/{b['lon_max']}"
        "/0/40000/0/1000/-30607527824000/32506376400000"
    )
    blob = _get(url)
    data = json.loads(blob)
    out = config.RAW / "csi" / "csi_caparr.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(blob)
    return _entry(url, blob, len(data.get("features", [])), {"bbox": b})


def fetch_dane(layer: str) -> dict:
    lid = DANE_LAYERS[layer]
    # El servicio no admite paginación; su límite (2.000 entidades) supera las
    # 33 y 1.122 entidades de cada capa, de modo que basta una consulta.
    q = urllib.parse.urlencode({
        "where": "1=1", "outFields": "*", "outSR": "4326",
        "maxAllowableOffset": DANE_OFFSET[layer], "geometryPrecision": 4, "returnGeometry": "true", "f": "geojson",
    })
    raw = _get(f"{DANE_MGN}/{lid}/query?{q}")
    raw_bytes = len(raw)
    feats = json.loads(raw).get("features", [])
    expected = {"departamentos": 33, "municipios": 1122}[layer]
    if len(feats) != expected:
        raise RuntimeError(f"DANE {layer}: se esperaban {expected} entidades y llegaron {len(feats)}")
    fc = {"type": "FeatureCollection", "features": feats}
    out = config.RAW / "dane" / f"{layer}.geojson"
    out.parent.mkdir(parents=True, exist_ok=True)
    blob = json.dumps(fc, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    out.write_bytes(blob)
    return _entry(f"{DANE_MGN}/{lid}", blob, len(feats), {
        "layer_id": lid, "server_simplification_deg": DANE_OFFSET[layer], "downloaded_bytes": raw_bytes,
    })


def main() -> int:
    config.ensure_dirs()
    manifest_path = config.RAW / "aux_manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest["csi"] = fetch_csi()
    print("CSI:", manifest["csi"]["records"], "eventos")
    for layer in DANE_LAYERS:
        manifest[f"dane_{layer}"] = fetch_dane(layer)
        print(f"DANE {layer}:", manifest[f"dane_{layer}"]["records"], "entidades,", manifest[f"dane_{layer}"]["bytes"], "bytes")
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    return 0


if __name__ == "__main__":
    sys.exit(main())
