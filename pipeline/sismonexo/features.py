"""Construcción de la tabla zona-periodo.

Cada fila describe una zona en un *origen de pronóstico* ``o`` (un día). Las
variables usan exclusivamente eventos con fecha estrictamente anterior a ``o``.
La etiqueta usa los eventos de la ventana ``[o, o + horizonte)``.

Esta separación —pasado para las variables, futuro para la etiqueta— es la
garantía central contra la fuga de información y se verifica en
``sismonexo.leakage``.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from . import config, zones

T0 = pd.Timestamp("1993-06-01", tz="UTC")   # inicio del catálogo instrumental
DAY = 86400
MIN_HISTORY_DAYS = 365                       # historia mínima antes del primer origen
ETAS = {"alpha": 1.0, "c_days": 0.05, "p": 1.1, "d0_km": 25.0, "q": 1.5, "m_ref": 3.0, "window_days": 365}
CAP_DAYS = 3650
CAP_DIST_KM = 1500.0
PREV_EVENT_MAG = 4.5

FEATURES: list[str] = [
    "n_30", "n_90", "n_365", "nt_30", "nt_90", "nt_365", "nt_1825", "rate_hist",
    "mean_mag_365", "max_mag_365", "max_mag_30", "acc_mag_365", "mean_depth_365", "median_depth_365",
    "days_since_last", "days_since_last_t", "dist_prev_km", "nb_30", "nb_365", "etas_trigger",
    "doy_sin", "doy_cos", "quality_score", "area_log",
]

FEATURE_INFO: dict[str, dict] = {
    "n_30": {"label": "Eventos recientes (30 días)", "unit": "eventos", "group": "Frecuencia reciente"},
    "n_90": {"label": "Eventos recientes (90 días)", "unit": "eventos", "group": "Frecuencia reciente"},
    "n_365": {"label": "Eventos del último año", "unit": "eventos", "group": "Frecuencia reciente"},
    "nt_30": {"label": "Eventos sobre el umbral (30 días)", "unit": "eventos", "group": "Frecuencia reciente"},
    "nt_90": {"label": "Eventos sobre el umbral (90 días)", "unit": "eventos", "group": "Frecuencia reciente"},
    "nt_365": {"label": "Eventos sobre el umbral (1 año)", "unit": "eventos", "group": "Frecuencia histórica"},
    "nt_1825": {"label": "Eventos sobre el umbral (5 años)", "unit": "eventos", "group": "Frecuencia histórica"},
    "rate_hist": {"label": "Tasa histórica sobre el umbral", "unit": "eventos por 30 días", "group": "Frecuencia histórica"},
    "mean_mag_365": {"label": "Magnitud media (1 año)", "unit": "magnitud", "group": "Magnitud"},
    "max_mag_365": {"label": "Magnitud máxima (1 año)", "unit": "magnitud", "group": "Magnitud"},
    "max_mag_30": {"label": "Magnitud máxima (30 días)", "unit": "magnitud", "group": "Magnitud"},
    "acc_mag_365": {"label": "Magnitud acumulada equivalente (1 año)", "unit": "magnitud equivalente", "group": "Magnitud"},
    "mean_depth_365": {"label": "Profundidad media (1 año)", "unit": "km", "group": "Profundidad"},
    "median_depth_365": {"label": "Profundidad mediana (1 año)", "unit": "km", "group": "Profundidad"},
    "days_since_last": {"label": "Tiempo desde el último evento", "unit": "días", "group": "Tiempo y distancia"},
    "days_since_last_t": {"label": "Tiempo desde el último evento sobre el umbral", "unit": "días", "group": "Tiempo y distancia"},
    "dist_prev_km": {"label": "Distancia al evento M ≥ 4,5 más reciente", "unit": "km", "group": "Tiempo y distancia"},
    "nb_30": {"label": "Actividad en zonas vecinas (30 días)", "unit": "eventos por zona vecina", "group": "Entorno"},
    "nb_365": {"label": "Actividad en zonas vecinas (1 año)", "unit": "eventos por zona vecina", "group": "Entorno"},
    "etas_trigger": {"label": "Término de actividad reciente ponderada (tipo ETAS)", "unit": "índice", "group": "Entorno"},
    "doy_sin": {"label": "Estacionalidad (seno del día del año)", "unit": "adimensional", "group": "Estacionalidad"},
    "doy_cos": {"label": "Estacionalidad (coseno del día del año)", "unit": "adimensional", "group": "Estacionalidad"},
    "quality_score": {"label": "Calidad de localización (proporción A o B, 1 año)", "unit": "proporción", "group": "Calidad de datos"},
    "area_log": {"label": "Tamaño de la zona (log₁₀ km²)", "unit": "log₁₀ km²", "group": "Zona"},
}


@dataclass
class EventArrays:
    """Vista numérica del catálogo, ordenada por tiempo."""
    day: np.ndarray        # día entero desde T0
    tday: np.ndarray       # tiempo en días (fraccionario) desde T0
    lon: np.ndarray
    lat: np.ndarray
    mag: np.ndarray
    depth: np.ndarray      # NaN si falta
    good: np.ndarray       # calidad A o B
    end_day: int           # primer día sin datos = origen del pronóstico vigente
    zone_cache: dict = field(default_factory=dict)

    @classmethod
    def from_frame(cls, ev: pd.DataFrame, end_day: int | None = None) -> "EventArrays":
        ev = ev.sort_values("event_datetime_utc", kind="stable")
        tday = ((ev["event_datetime_utc"] - T0) / pd.Timedelta(days=1)).to_numpy(dtype=float)
        day = np.floor(tday).astype(np.int32)
        return cls(day=day, tday=tday, lon=ev["longitude"].to_numpy(float), lat=ev["latitude"].to_numpy(float),
                   mag=ev["magnitude"].to_numpy(float), depth=ev["depth_km"].to_numpy(float),
                   good=ev["quality_code"].isin(["A", "B"]).to_numpy(),
                   end_day=int(day.max()) + 1 if end_day is None else int(end_day))

    def truncated(self, before_day: int) -> "EventArrays":
        """Copia que solo contiene eventos anteriores a ``before_day`` (para pruebas de fuga)."""
        k = self.day < before_day
        return EventArrays(self.day[k], self.tday[k], self.lon[k], self.lat[k], self.mag[k], self.depth[k],
                           self.good[k], end_day=self.end_day)

    def zone_index(self, unit: str) -> np.ndarray:
        if unit not in self.zone_cache:
            self.zone_cache[unit] = zones.assign(unit, self.lon, self.lat)
        return self.zone_cache[unit]


def load_events() -> pd.DataFrame:
    return pd.read_parquet(config.PROCESSED / "events.parquet")


def day_to_date(day: int | np.ndarray):
    return T0 + pd.to_timedelta(day, unit="D")


def origin_days(end_day: int, horizon: int, step: int | None = None) -> np.ndarray:
    """Orígenes alineados con el fin del catálogo. El último (``end_day``) no tiene etiqueta."""
    step = step or (horizon if horizon <= 30 else 30)
    o = np.arange(end_day, MIN_HISTORY_DAYS - 1, -step, dtype=np.int32)[::-1]
    return o


class _Cum:
    """Suma acumulada por zona y día; ``window(o, w)`` suma los días [o − w, o)."""

    def __init__(self, n_zones: int, n_days: int, z: np.ndarray, day: np.ndarray, values: np.ndarray | None = None):
        m = np.zeros((n_zones, n_days + 1), dtype=np.float64)
        np.add.at(m, (z, day + 1), 1.0 if values is None else values)
        np.cumsum(m, axis=1, out=m)
        self.m = m

    def window(self, o: np.ndarray, w: int | None) -> np.ndarray:
        hi = self.m[:, o]
        if w is None:
            return hi
        return hi - self.m[:, np.maximum(o - w, 0)]


def _window_groupstats(z: np.ndarray, day: np.ndarray, val: np.ndarray, n_zones: int, o: np.ndarray, w: int, how: str) -> np.ndarray:
    """Máximo o mediana por zona en la ventana [o − w, o) para cada origen."""
    out = np.full((n_zones, len(o)), np.nan)
    ok = ~np.isnan(val)
    z, day, val = z[ok], day[ok], val[ok]
    lo = np.searchsorted(day, o - w, side="left")
    hi = np.searchsorted(day, o, side="left")
    for j in range(len(o)):
        if hi[j] <= lo[j]:
            continue
        zz, vv = z[lo[j]:hi[j]], val[lo[j]:hi[j]]
        if how == "max":
            np.fmax.at(out[:, j], zz, vv)
        else:
            s = pd.Series(vv).groupby(zz).median()
            out[s.index.to_numpy(), j] = s.to_numpy()
    return out


def _etas_trigger(ea: EventArrays, zs: zones.ZoneSet, o: np.ndarray, horizon: int) -> np.ndarray:
    """Suma, sobre los eventos del último año, de productividad × integral de Omori × núcleo espacial."""
    p = ETAS
    zl, zla = zs.table["lon"].to_numpy(), zs.table["lat"].to_numpy()
    k = ea.mag >= p["m_ref"]
    t, lon, lat, mag = ea.tday[k], ea.lon[k], ea.lat[k], ea.mag[k]
    out = np.zeros((len(zs), len(o)))
    lo = np.searchsorted(t, o - p["window_days"], side="left")
    hi = np.searchsorted(t, o, side="left")
    e = 1.0 - p["p"]
    for j in range(len(o)):
        if hi[j] <= lo[j]:
            continue
        sl = slice(lo[j], hi[j])
        dt_ = o[j] - t[sl]
        omori = ((dt_ + horizon + p["c_days"]) ** e - (dt_ + p["c_days"]) ** e) / e
        w = 10.0 ** (p["alpha"] * (mag[sl] - p["m_ref"])) * omori
        d = zones.haversine_km(lon[sl][None, :], lat[sl][None, :], zl[:, None], zla[:, None])
        out[:, j] = ((1.0 + (d / p["d0_km"]) ** 2) ** (-p["q"])) @ w
    return out


def build_matrix(ea: EventArrays, unit: str, horizon: int, threshold: float,
                 origins: np.ndarray | None = None) -> pd.DataFrame:
    """Tabla zona-periodo completa: claves, variables, etiqueta binaria y conteo.

    Las filas del último origen (``ea.end_day``) llevan etiqueta NaN: son las del
    pronóstico vigente.
    """
    zs = zones.build(unit)
    nz = len(zs)
    o = origin_days(ea.end_day, horizon) if origins is None else np.asarray(origins, dtype=np.int32)
    n_days = int(max(ea.end_day, o.max())) + horizon + 1
    zi = ea.zone_index(unit)
    inz = zi >= 0
    z, day, mag, depth, good = zi[inz], ea.day[inz], ea.mag[inz], ea.depth[inz], ea.good[inz]
    isT = mag >= threshold

    c_all = _Cum(nz, n_days, z, day)
    c_thr = _Cum(nz, n_days, z[isT], day[isT])
    f: dict[str, np.ndarray] = {}
    f["n_30"], f["n_90"], f["n_365"] = c_all.window(o, 30), c_all.window(o, 90), c_all.window(o, 365)
    f["nt_30"], f["nt_90"] = c_thr.window(o, 30), c_thr.window(o, 90)
    f["nt_365"], f["nt_1825"] = c_thr.window(o, 365), c_thr.window(o, 1825)
    f["rate_hist"] = c_thr.window(o, None) / (o[None, :] / 30.0)

    # Días desde el último evento (cualquiera y sobre el umbral)
    def since_last(c: _Cum) -> np.ndarray:
        daily = np.diff(c.m, axis=1) > 0                    # [zona, día]
        idx = np.where(daily, np.arange(daily.shape[1])[None, :], -1)
        np.maximum.accumulate(idx, axis=1, out=idx)
        last = np.concatenate([np.full((nz, 1), -1), idx], axis=1)[:, o]   # último día < o
        return np.where(last < 0, CAP_DAYS, np.minimum(o[None, :] - last, CAP_DAYS)).astype(float)

    f["days_since_last"] = since_last(c_all)
    f["days_since_last_t"] = since_last(c_thr)

    n365 = f["n_365"]
    with np.errstate(invalid="ignore", divide="ignore"):
        f["mean_mag_365"] = np.where(n365 > 0, _Cum(nz, n_days, z, day, mag).window(o, 365) / n365, np.nan)
        energy = _Cum(nz, n_days, z, day, 10.0 ** (1.5 * mag)).window(o, 365)
        f["acc_mag_365"] = np.where(n365 > 0, np.log10(np.maximum(energy, 1.0)) / 1.5, np.nan)
        has_d = ~np.isnan(depth)
        nd = _Cum(nz, n_days, z[has_d], day[has_d]).window(o, 365)
        f["mean_depth_365"] = np.where(nd > 0, _Cum(nz, n_days, z[has_d], day[has_d], depth[has_d]).window(o, 365) / nd, np.nan)
        f["quality_score"] = np.where(n365 > 0, _Cum(nz, n_days, z[good], day[good]).window(o, 365) / n365, np.nan)
    f["max_mag_365"] = _window_groupstats(z, day, mag, nz, o, 365, "max")
    f["max_mag_30"] = _window_groupstats(z, day, mag, nz, o, 30, "max")
    f["median_depth_365"] = _window_groupstats(z, day, depth, nz, o, 365, "median")

    # Distancia desde el centroide al evento M ≥ 4,5 más reciente del catálogo (anterior al origen)
    big = ea.mag >= PREV_EVENT_MAG
    bt, blon, blat = ea.tday[big], ea.lon[big], ea.lat[big]
    last_big = np.searchsorted(bt, o, side="left") - 1
    dist = np.full((nz, len(o)), CAP_DIST_KM)
    ok = last_big >= 0
    if ok.any():
        d = zones.haversine_km(blon[last_big[ok]][None, :], blat[last_big[ok]][None, :],
                               zs.table["lon"].to_numpy()[:, None], zs.table["lat"].to_numpy()[:, None])
        dist[:, ok] = np.minimum(d, CAP_DIST_KM)
    f["dist_prev_km"] = dist

    f["nb_30"] = zs.neighbors @ f["n_30"]
    f["nb_365"] = zs.neighbors @ f["n_365"]
    f["etas_trigger"] = np.log1p(_etas_trigger(ea, zs, o, horizon))

    doy = day_to_date(o).dayofyear.to_numpy()
    f["doy_sin"] = np.broadcast_to(np.sin(2 * np.pi * doy / 365.25)[None, :], (nz, len(o)))
    f["doy_cos"] = np.broadcast_to(np.cos(2 * np.pi * doy / 365.25)[None, :], (nz, len(o)))
    f["area_log"] = np.broadcast_to(np.log10(zs.table["area_km2"].to_numpy())[:, None], (nz, len(o)))

    # Etiqueta: eventos sobre el umbral en [o, o + horizonte)
    count = c_thr.m[:, np.minimum(o + horizon, n_days)] - c_thr.m[:, o]
    labelled = (o + horizon) <= ea.end_day
    count = np.where(labelled[None, :], count, np.nan)

    # Descriptores de la ventana de etiqueta (solo para desagregar métricas; nunca son variables de entrada)
    lab_max = _window_groupstats(z[isT], day[isT], mag[isT], nz, o + horizon, horizon, "max")
    lab_depth = _window_groupstats(z[isT], day[isT], depth[isT], nz, o + horizon, horizon, "median")
    lab_max = np.where(labelled[None, :], lab_max, np.nan)
    lab_depth = np.where(labelled[None, :], lab_depth, np.nan)

    zz, oo = np.meshgrid(np.arange(nz, dtype=np.int32), o, indexing="ij")
    df = pd.DataFrame({"zone": zz.ravel(), "origin": oo.ravel()})
    for name in FEATURES:
        df[name] = np.asarray(f[name], dtype=np.float32).ravel()
    df["count"] = count.ravel().astype(np.float32)
    df["label_max_mag"] = lab_max.ravel().astype(np.float32)
    df["label_depth"] = lab_depth.ravel().astype(np.float32)
    df["y"] = np.where(np.isnan(df["count"]), np.nan, (df["count"] > 0).astype(np.float32))
    return df.sort_values(["origin", "zone"], kind="stable").reset_index(drop=True)


def to_period_table(df: pd.DataFrame, unit: str, horizon: int) -> pd.DataFrame:
    """Versión con los nombres del modelo de datos documentado (tabla zona-periodo)."""
    zs = zones.build(unit)
    out = pd.DataFrame({
        "zone_id": zs.table["zone_id"].to_numpy()[df["zone"].to_numpy()],
        "period_start": day_to_date(df["origin"].to_numpy()).strftime("%Y-%m-%d"),
        "period_end": day_to_date(df["origin"].to_numpy() + horizon).strftime("%Y-%m-%d"),
        "event_count": df["count"], "recent_event_count": df["n_30"],
        "mean_magnitude": df["mean_mag_365"], "max_magnitude": df["max_mag_365"],
        "accumulated_magnitude": df["acc_mag_365"], "mean_depth": df["mean_depth_365"],
        "median_depth": df["median_depth_365"], "time_since_last_event": df["days_since_last"],
        "distance_to_previous_event": df["dist_prev_km"], "historical_rate": df["rate_hist"],
        "seasonal_sin": df["doy_sin"], "seasonal_cos": df["doy_cos"], "data_quality_score": df["quality_score"],
    })
    return out
