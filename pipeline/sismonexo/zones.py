"""Unidades de análisis (zonas) y asignación espacial de eventos.

Unidades admitidas:

* ``dep``  — departamento (DANE, MGN 2025).
* ``mun``  — municipio (DANE, MGN 2025).
* ``h3``   — celda hexagonal H3 de resolución 4 (≈ 1.770 km², arista ≈ 26 km).
* ``g50``  — cuadrícula geográfica de 0,45° (≈ 50 km de lado).
* ``g25``  — cuadrícula geográfica de 0,225° (≈ 25 km de lado).

Para las mallas (h3, g50, g25) el universo de zonas es fijo: las celdas que
intersecan el territorio continental e insular de Colombia. No depende de la
sismicidad observada, de modo que no introduce información del futuro.
"""
from __future__ import annotations

import functools
import math
from dataclasses import dataclass

import h3
import numpy as np
import pandas as pd
import shapely
from scipy import sparse
from shapely.geometry import Polygon, box

from . import config
from .clean import load_polygons, spatial_join, title_es

UNITS = {
    "dep": {"label": "Departamento", "resolution": "DIVIPOLA nivel 1"},
    "mun": {"label": "Municipio", "resolution": "DIVIPOLA nivel 2"},
    "h3": {"label": "Celda H3", "resolution": "H3 resolución 4"},
    "g50": {"label": "Cuadrícula ≈ 50 km", "resolution": "0,45° × 0,45°"},
    "g25": {"label": "Cuadrícula ≈ 25 km", "resolution": "0,225° × 0,225°"},
}
GRID_DEG = {"g50": 0.45, "g25": 0.225}
H3_RES = 4
KM_PER_DEG = 111.32


@dataclass
class ZoneSet:
    unit: str
    table: pd.DataFrame          # zone_id, zone_type, zone_name, department, municipality, resolution, area_km2, lon, lat
    geoms: list                  # geometrías shapely alineadas con la tabla
    neighbors: sparse.csr_matrix  # matriz de vecindad normalizada por fila (sin la propia zona)

    def __len__(self) -> int:
        return len(self.table)


@functools.lru_cache(maxsize=1)
def _admin():
    dgeoms, dprops = load_polygons("departamentos")
    mgeoms, mprops = load_polygons("municipios")
    territory = shapely.union_all(dgeoms)
    return dgeoms, dprops, mgeoms, mprops, territory


def _place_name(lon: np.ndarray, lat: np.ndarray) -> tuple[list[str], list[str], list[str]]:
    """Municipio y departamento que contienen cada punto (vacío si está fuera del país)."""
    dgeoms, dprops, mgeoms, mprops, _ = _admin()
    mi = spatial_join(lon, lat, mgeoms)
    di = spatial_join(lon, lat, dgeoms)
    mun = [title_es(mprops[i]["MPIO_CNMBRE"]) if i >= 0 else "" for i in mi]
    dep_code = [mprops[i]["DPTO_CCDGO"] if i >= 0 else (dprops[j]["DPTO_CCDGO"] if j >= 0 else "") for i, j in zip(mi, di)]
    names = {p["DPTO_CCDGO"]: title_es(p["DPTO_CNMBRE"]) for p in dprops}
    dep = [names.get(c, "") for c in dep_code]
    return mun, dep, dep_code


def _fmt_coord(lat: float, lon: float) -> str:
    ns = "N" if lat >= 0 else "S"
    return f"{abs(lat):.2f}° {ns}, {abs(lon):.2f}° O".replace(".", ",")


def _neighbors(geoms: list, buffer_deg: float) -> sparse.csr_matrix:
    tree = shapely.STRtree(geoms)
    buf = shapely.buffer(np.array(geoms, dtype=object), buffer_deg)
    a, b = tree.query(buf, predicate="intersects")
    keep = a != b
    n = len(geoms)
    m = sparse.csr_matrix((np.ones(keep.sum()), (a[keep], b[keep])), shape=(n, n))
    deg = np.asarray(m.sum(axis=1)).ravel()
    deg[deg == 0] = 1
    return sparse.diags(1.0 / deg) @ m


def grid_cell_polygon(unit: str, ix: int, iy: int) -> Polygon:
    s = GRID_DEG[unit]
    x0 = config.BBOX["lon_min"] + ix * s
    y0 = config.BBOX["lat_min"] + iy * s
    return box(x0, y0, x0 + s, y0 + s)


def _mesh_table(unit: str, ids: list[str], geoms: list, areas: list[float]) -> pd.DataFrame:
    cen = shapely.centroid(np.array(geoms, dtype=object))
    lon, lat = shapely.get_x(cen), shapely.get_y(cen)
    mun, dep, _ = _place_name(lon, lat)
    label = UNITS[unit]["label"].replace("Cuadrícula", "Celda").replace("Celda H3", "Hexágono")
    names = []
    for m, d, la, lo in zip(mun, dep, lat, lon):
        place = f"{m}, {d}" if m else (d or "zona de frontera")
        names.append(f"{label} · {place} ({_fmt_coord(la, lo)})")
    return pd.DataFrame({
        "zone_id": ids, "zone_type": unit, "zone_name": names, "department": dep, "municipality": mun,
        "resolution": UNITS[unit]["resolution"], "area_km2": np.round(areas, 1), "lon": np.round(lon, 4), "lat": np.round(lat, 4),
    })


@functools.lru_cache(maxsize=8)
def build(unit: str) -> ZoneSet:
    dgeoms, dprops, mgeoms, mprops, territory = _admin()
    if unit == "dep":
        cen = shapely.point_on_surface(np.array(dgeoms, dtype=object))
        table = pd.DataFrame({
            "zone_id": [p["DPTO_CCDGO"] for p in dprops], "zone_type": "dep",
            "zone_name": [title_es(p["DPTO_CNMBRE"]) for p in dprops],
            "department": [title_es(p["DPTO_CNMBRE"]) for p in dprops], "municipality": "",
            "resolution": UNITS[unit]["resolution"], "area_km2": [round(p["DPTO_NAREA"], 1) for p in dprops],
            "lon": np.round(shapely.get_x(cen), 4), "lat": np.round(shapely.get_y(cen), 4),
        })
        return ZoneSet(unit, table, dgeoms, _neighbors(dgeoms, 0.02))
    if unit == "mun":
        names = {p["DPTO_CCDGO"]: title_es(p["DPTO_CNMBRE"]) for p in dprops}
        cen = shapely.point_on_surface(np.array(mgeoms, dtype=object))
        table = pd.DataFrame({
            "zone_id": [p["MPIO_CDPMP"] for p in mprops], "zone_type": "mun",
            "zone_name": [f"{title_es(p['MPIO_CNMBRE'])}, {names.get(p['DPTO_CCDGO'], '')}" for p in mprops],
            "department": [names.get(p["DPTO_CCDGO"], "") for p in mprops],
            "municipality": [title_es(p["MPIO_CNMBRE"]) for p in mprops],
            "resolution": UNITS[unit]["resolution"], "area_km2": [round(p["MPIO_NAREA"], 1) for p in mprops],
            "lon": np.round(shapely.get_x(cen), 4), "lat": np.round(shapely.get_y(cen), 4),
        })
        return ZoneSet(unit, table, mgeoms, _neighbors(mgeoms, 0.02))
    if unit in GRID_DEG:
        s = GRID_DEG[unit]
        b = config.BBOX
        nx = int(math.ceil((b["lon_max"] - b["lon_min"]) / s))
        ny = int(math.ceil((b["lat_max"] - b["lat_min"]) / s))
        cells = [(ix, iy, grid_cell_polygon(unit, ix, iy)) for ix in range(nx) for iy in range(ny)]
        polys = np.array([c[2] for c in cells], dtype=object)
        hit = shapely.intersects(polys, territory)
        ids, geoms, areas = [], [], []
        for (ix, iy, g), h in zip(cells, hit):
            if h:
                ids.append(f"{unit}-{ix}-{iy}")
                geoms.append(g)
                latc = b["lat_min"] + (iy + 0.5) * s
                areas.append((s * KM_PER_DEG) ** 2 * math.cos(math.radians(latc)))
        return ZoneSet(unit, _mesh_table(unit, ids, geoms, areas), geoms, _neighbors(geoms, s * 0.05))
    if unit == "h3":
        # Se muestrea el territorio con una malla densa para encontrar todos los hexágonos que lo tocan.
        minx, miny, maxx, maxy = territory.bounds
        xs = np.arange(minx, maxx + 0.04, 0.04)
        ys = np.arange(miny, maxy + 0.04, 0.04)
        gx, gy = np.meshgrid(xs, ys)
        pts = shapely.points(gx.ravel(), gy.ravel())
        shapely.prepare(territory)
        inside = shapely.contains(territory, pts)
        cells = sorted({h3.latlng_to_cell(float(y), float(x), H3_RES) for x, y in zip(gx.ravel()[inside], gy.ravel()[inside])})
        geoms = [Polygon([(lo, la) for la, lo in h3.cell_to_boundary(c)]) for c in cells]
        areas = [h3.cell_area(c, unit="km^2") for c in cells]
        return ZoneSet(unit, _mesh_table(unit, cells, geoms, areas), geoms, _neighbors(geoms, 0.02))
    raise ValueError(f"Unidad desconocida: {unit}")


def assign(unit: str, lon: np.ndarray, lat: np.ndarray) -> np.ndarray:
    """Índice de zona de cada punto dentro del ZoneSet (-1 si queda fuera del universo)."""
    zs = build(unit)
    idx = {z: i for i, z in enumerate(zs.table["zone_id"])}
    if unit in ("dep", "mun"):
        return spatial_join(lon, lat, zs.geoms)
    if unit in GRID_DEG:
        s = GRID_DEG[unit]
        ix = np.floor((lon - config.BBOX["lon_min"]) / s).astype(int)
        iy = np.floor((lat - config.BBOX["lat_min"]) / s).astype(int)
        return np.array([idx.get(f"{unit}-{a}-{b}", -1) for a, b in zip(ix, iy)], dtype=np.int32)
    return np.array([idx.get(h3.latlng_to_cell(float(a), float(o), H3_RES), -1) for a, o in zip(lat, lon)], dtype=np.int32)


def haversine_km(lon1, lat1, lon2, lat2):
    """Distancia de círculo máximo en km (admite difusión de numpy)."""
    p1, p2 = np.radians(lat1), np.radians(lat2)
    dphi = p2 - p1
    dl = np.radians(lon2) - np.radians(lon1)
    a = np.sin(dphi / 2) ** 2 + np.cos(p1) * np.cos(p2) * np.sin(dl / 2) ** 2
    return 6371.0088 * 2 * np.arcsin(np.sqrt(np.clip(a, 0, 1)))
