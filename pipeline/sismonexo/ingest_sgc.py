"""Descarga del catálogo instrumental de la RSNC desde los formularios públicos del SGC.

El SGC publica el catálogo en dos periodos (ver https://bdrsnc.sgc.gov.co/paginas1/catalogo/):

* 1993-06-01 a 2018-02-28 — adquirido con Earthworm y procesado con SEISAN.
* 2018-03-01 a la fecha — adquirido y procesado con SeisComP3.

Este módulo usa únicamente la biblioteca estándar. Guarda cada respuesta
original en ``data/raw`` junto con un manifiesto (URL, parámetros, fecha de
consulta, SHA-256, registros reportados y registros leídos) para que la
procedencia sea auditable. Las consultas se hacen de forma secuencial y con
pausa entre solicitudes.

Uso::

    python -m sismonexo.ingest_sgc            # descarga incremental completa
    python -m sismonexo.ingest_sgc --desde 2024-01-01
"""
from __future__ import annotations

import argparse
import calendar
import csv
import datetime as dt
import hashlib
import io
import json
import re
import sys
import time
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path
from typing import Iterable, Iterator

from . import config

SEISAN_BASE = "https://bdrsnc.sgc.gov.co/paginas1/catalogo/Consulta_Experta/"
SEISCOMP_BASE = "https://bdrsnc.sgc.gov.co/paginas1/catalogo/Consulta_Experta_Seiscomp/"

RAW_COLUMNS = [
    "event_id", "event_datetime_utc", "latitude", "longitude", "depth_km",
    "magnitude", "magnitude_type", "magnitude_mw", "municipality", "department",
    "location_description", "phases", "rms_s", "gap_deg", "error_lat_km",
    "error_lon_km", "error_depth_km", "status", "source", "source_url",
]

_XLSX_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


# --------------------------------------------------------------------------- HTTP

def _request(url: str, data: dict[str, str] | None = None, timeout: int = 240, retries: int = 4) -> bytes:
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    last: Exception | None = None
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, data=body, headers={"User-Agent": config.USER_AGENT})
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.read()
        except Exception as exc:  # red inestable: reintento con espera creciente
            last = exc
            time.sleep(5 * (attempt + 1))
    raise RuntimeError(f"No fue posible consultar {url}: {last}")


def _common_params(start: dt.date, end: dt.date) -> dict[str, str]:
    b = config.BBOX
    return {
        "inicial": start.strftime("%d/%m/%Y"),
        "final": end.strftime("%d/%m/%Y"),
        "Submit": "Consultar",
        "longitudStart": str(b["lon_min"]), "longitudEnd": str(b["lon_max"]),
        "latitudStart": str(b["lat_min"]), "latitudEnd": str(b["lat_max"]),
        "magnitudStart": str(config.MIN_MAGNITUDE), "magnitudEnd": "9",
        "depthStart": "0", "depthEnd": "700",
        "rmsStart": "0", "rmsEnd": "10", "gapStart": "0", "gapEnd": "360",
        "eprofmin": "0", "eprofmax": "999", "elongmin": "0", "elongmax": "999",
        "elatmin": "0", "elatmax": "999",
    }


def _sha256(b: bytes) -> str:
    return hashlib.sha256(b).hexdigest()


def _num(s: str | None) -> str:
    """Normaliza un número conservando vacío cuando la fuente no lo reporta."""
    if s is None:
        return ""
    s = s.strip().replace(",", ".")
    if not s:
        return ""
    try:
        float(s)
    except ValueError:
        return ""
    return s


# ------------------------------------------------------------------------ SEISAN

def _xlsx_rows(blob: bytes) -> list[list[str]]:
    """Lee la primera hoja de un .xlsx respetando celdas vacías (por referencia de columna)."""
    z = zipfile.ZipFile(io.BytesIO(blob))
    shared: list[str] = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")).findall(f"{_XLSX_NS}si"):
            shared.append("".join(t.text or "" for t in si.iter(f"{_XLSX_NS}t")))
    sheet = ET.fromstring(z.read("xl/worksheets/sheet1.xml"))
    out: list[list[str]] = []
    for row in sheet.iter(f"{_XLSX_NS}row"):
        cells: dict[int, str] = {}
        for c in row.findall(f"{_XLSX_NS}c"):
            ref = c.get("r", "")
            letters = "".join(ch for ch in ref if ch.isalpha())
            idx = 0
            for ch in letters:
                idx = idx * 26 + (ord(ch.upper()) - 64)
            v = c.find(f"{_XLSX_NS}v")
            if v is not None and v.text is not None:
                val = shared[int(v.text)] if c.get("t") == "s" else v.text
            else:
                inline = c.find(f"{_XLSX_NS}is")
                val = "".join(t.text or "" for t in inline.iter(f"{_XLSX_NS}t")) if inline is not None else ""
            cells[idx - 1] = val
        if cells:
            out.append([cells.get(i, "") for i in range(max(cells) + 1)])
    return out


def parse_seisan_xlsx(blob: bytes) -> list[dict[str, str]]:
    rows = _xlsx_rows(blob)
    if not rows:
        return []
    header = [h.strip().upper() for h in rows[0]]
    expected = ["FECHA", "HORA_UTC", "LATITUD (GRADOS)", "LONGITUD (GRADOS)", "PROFUNDIDAD (KM)"]
    if header[:5] != expected:
        raise ValueError(f"Encabezado inesperado en el reporte SEISAN: {header}")
    col = {name: i for i, name in enumerate(header)}

    def g(r: list[str], name: str) -> str:
        i = col.get(name)
        return r[i].strip() if i is not None and i < len(r) else ""

    out = []
    for r in rows[1:]:
        fecha, hora = g(r, "FECHA"), g(r, "HORA_UTC")
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", fecha) or not re.fullmatch(r"\d{2}:\d{2}:\d{2}", hora):
            continue
        ml, mw = _num(g(r, "MAGNITUD ML")), _num(g(r, "MAGNITUD MW"))
        stamp = f"{fecha}T{hora}Z"
        lat, lon = _num(g(r, "LATITUD (GRADOS)")), _num(g(r, "LONGITUD (GRADOS)"))
        # El reporte SEISAN no publica un identificador; se deriva uno estable y trazable.
        eid = "SGC-SEISAN-" + fecha.replace("-", "") + hora.replace(":", "") + "-" + _sha256(f"{lat}|{lon}".encode())[:6]
        out.append({
            "event_id": eid,
            "event_datetime_utc": stamp,
            "latitude": lat, "longitude": lon,
            "depth_km": _num(g(r, "PROFUNDIDAD (KM)")),
            "magnitude": ml or mw,
            "magnitude_type": "ML" if ml else ("Mw" if mw else ""),
            "magnitude_mw": mw,
            "municipality": g(r, "MUNICIPIO").replace("_", " "),
            "department": g(r, "DEPARTAMENTO").replace("_", " "),
            "location_description": "",
            "phases": _num(g(r, "# FASES")), "rms_s": _num(g(r, "RMS (SEG)")),
            "gap_deg": _num(g(r, "GAP (GRADOS)")),
            "error_lat_km": _num(g(r, "ERROR LATITUD (KM)")),
            "error_lon_km": _num(g(r, "ERROR LONGITUD (KM)")),
            "error_depth_km": _num(g(r, "ERROR PROFUNDIDAD (KM)")),
            "status": g(r, "ESTADO"),
            "source": "SGC-RSNC (SEISAN)",
            "source_url": config.SOURCES["rsnc_seisan"]["url"],
        })
    return out


def fetch_seisan_chunk(start: dt.date, end: dt.date) -> tuple[bytes, int]:
    """Consulta el formulario y descarga el reporte Excel completo del periodo."""
    params = _common_params(start, end)
    params.update({"radiobutton": "cuadrante", "magnitudmwStart": "0", "magnitudmwEnd": "9"})
    html = _request(SEISAN_BASE + "consulsismo3.php", params).decode("utf-8", "replace")
    m = re.search(r"(\d+)\s+registros encontrados", html)
    total = int(m.group(1)) if m else 0
    if total == 0:
        return b"", 0
    link = re.search(r"HREF=(descargar_exel_experta\.php\?[^>\s]+)", html, re.I)
    if not link:
        raise RuntimeError("El formulario SEISAN no devolvió el enlace al reporte.")
    time.sleep(config.REQUEST_PAUSE_S)
    href = link.group(1).replace(" ", "%20")
    return _request(SEISAN_BASE + href), total


# ---------------------------------------------------------------------- SeisComP

_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.S | re.I)
_CELL_RE = re.compile(r"<td[^>]*>(.*?)</td>", re.S | re.I)
_TAG_RE = re.compile(r"<[^>]+>")
_EID_RE = re.compile(r"file=(SGC[0-9A-Za-z]+)\.xml")


def split_region(region: str) -> tuple[str, str]:
    """'Los Santos - Santander, Colombia' -> ('Los Santos', 'Santander')."""
    m = re.match(r"^(.*?)\s+-\s+(.*?),\s*Colombia\s*$", region)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return "", ""


def parse_seiscomp_html(blob: bytes) -> tuple[list[dict[str, str]], int]:
    html = blob.decode("utf-8", "replace")
    m = re.search(r"Total de registros:.*?<td[^>]*>\s*(\d+)", html, re.S)
    total = int(m.group(1)) if m else 0
    body = html.split("<tbody>", 1)[1] if "<tbody>" in html else ""
    out = []
    for row in _ROW_RE.findall(body):
        cells = [_TAG_RE.sub("", c).strip() for c in _CELL_RE.findall(row)]
        if len(cells) < 13 or not re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}", cells[0]):
            continue
        eid = _EID_RE.search(row)
        event_id = eid.group(1) if eid else "SGC-SC-" + cells[0].replace("-", "").replace(":", "").replace(" ", "")
        mun, dep = split_region(cells[12])
        out.append({
            "event_id": event_id,
            "event_datetime_utc": cells[0].replace(" ", "T") + "Z",
            "latitude": _num(cells[1]), "longitude": _num(cells[2]),
            "depth_km": _num(cells[3]), "magnitude": _num(cells[4]),
            "magnitude_type": cells[5], "magnitude_mw": "",
            "municipality": mun, "department": dep,
            "location_description": cells[12],
            "phases": _num(cells[6]), "rms_s": _num(cells[7]), "gap_deg": _num(cells[8]),
            "error_lat_km": _num(cells[9]), "error_lon_km": _num(cells[10]),
            "error_depth_km": _num(cells[11]),
            "status": cells[-1],
            "source": "SGC-RSNC (SeisComP)",
            "source_url": (
                f"{SEISCOMP_BASE}download.php?destino=eventos/events/{event_id}&file={event_id}.xml"
                if eid else config.SOURCES["rsnc_seiscomp"]["url"]
            ),
        })
    return out, total


def fetch_seiscomp_chunk(start: dt.date, end: dt.date) -> bytes:
    params = _common_params(start, end)
    params.update({"departamento": "", "municipio": "", "ubi": "cuadrante"})
    return _request(SEISCOMP_BASE + "consulta_sismo.php", params)


# ------------------------------------------------------------------ Orquestación

def month_chunks(start: dt.date, end: dt.date) -> Iterator[tuple[dt.date, dt.date]]:
    cur = start
    while cur <= end:
        last = dt.date(cur.year, cur.month, calendar.monthrange(cur.year, cur.month)[1])
        yield cur, min(last, end)
        cur = last + dt.timedelta(days=1)


def year_chunks(start: dt.date, end: dt.date) -> Iterator[tuple[dt.date, dt.date]]:
    cur = start
    while cur <= end:
        last = dt.date(cur.year, 12, 31)
        yield cur, min(last, end)
        cur = last + dt.timedelta(days=1)


def _load_manifest(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"entries": {}}


def run(desde: dt.date | None = None, hasta: dt.date | None = None, refresh_last: bool = True) -> Path:
    config.ensure_dirs()
    today = hasta or dt.datetime.now(dt.timezone.utc).date()
    raw_a = config.RAW / "rsnc_seisan"
    raw_b = config.RAW / "rsnc_seiscomp"
    raw_a.mkdir(parents=True, exist_ok=True)
    raw_b.mkdir(parents=True, exist_ok=True)
    manifest_path = config.RAW / "rsnc_manifest.json"
    manifest = _load_manifest(manifest_path)
    entries: dict = manifest["entries"]

    a_start, a_end = dt.date.fromisoformat(config.SEISAN_START), dt.date.fromisoformat(config.SEISAN_END)
    b_start = dt.date.fromisoformat(config.SEISCOMP_START)
    jobs: list[tuple[str, dt.date, dt.date, Path]] = []
    for s, e in year_chunks(max(a_start, desde or a_start), a_end):
        jobs.append(("rsnc_seisan", s, e, raw_a / f"{s:%Y}.xlsx"))
    for s, e in month_chunks(max(b_start, desde or b_start), today):
        jobs.append(("rsnc_seiscomp", s, e, raw_b / f"{s:%Y-%m}.html"))

    for i, (kind, s, e, path) in enumerate(jobs):
        key = f"{kind}/{path.name}"
        is_open_period = kind == "rsnc_seiscomp" and e >= today - dt.timedelta(days=45)
        if path.exists() and key in entries and not (is_open_period and refresh_last):
            continue
        if kind == "rsnc_seisan":
            blob, reported = fetch_seisan_chunk(s, e)
            parsed = len(parse_seisan_xlsx(blob)) if blob else 0
        else:
            blob = fetch_seiscomp_chunk(s, e)
            rows, reported = parse_seiscomp_html(blob)
            parsed = len(rows)
        path.write_bytes(blob)
        entries[key] = {
            "source": kind, "period_start": s.isoformat(), "period_end": e.isoformat(),
            "url": config.SOURCES[kind]["url"],
            "min_magnitude": config.MIN_MAGNITUDE, "bbox": config.BBOX,
            "fetched_at": dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds"),
            "bytes": len(blob), "sha256": _sha256(blob),
            "records_reported": reported, "records_parsed": parsed,
        }
        manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
        flag = "" if reported == parsed else "  << DIFERENCIA"
        print(f"[{i + 1}/{len(jobs)}] {key}: reportados={reported} leídos={parsed}{flag}", flush=True)
        time.sleep(config.REQUEST_PAUSE_S)

    return consolidate()


def iter_raw_records() -> Iterable[dict[str, str]]:
    for p in sorted((config.RAW / "rsnc_seisan").glob("*.xlsx")):
        blob = p.read_bytes()
        if blob:
            yield from parse_seisan_xlsx(blob)
    for p in sorted((config.RAW / "rsnc_seiscomp").glob("*.html")):
        rows, _ = parse_seiscomp_html(p.read_bytes())
        yield from rows


def consolidate() -> Path:
    """Une todas las respuestas originales en un único CSV sin limpieza (capa 'interim')."""
    config.ensure_dirs()
    out = config.INTERIM / "rsnc_raw.csv"
    n = 0
    with out.open("w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=RAW_COLUMNS)
        w.writeheader()
        for rec in iter_raw_records():
            w.writerow(rec)
            n += 1
    print(f"Consolidado: {n} registros -> {out}")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--desde", type=dt.date.fromisoformat, default=None, help="Fecha inicial AAAA-MM-DD")
    ap.add_argument("--hasta", type=dt.date.fromisoformat, default=None, help="Fecha final AAAA-MM-DD")
    ap.add_argument("--solo-consolidar", action="store_true", help="No descarga; solo reconstruye el CSV")
    a = ap.parse_args(argv)
    if a.solo_consolidar:
        consolidate()
    else:
        run(a.desde, a.hasta)
    return 0


if __name__ == "__main__":
    sys.exit(main())
