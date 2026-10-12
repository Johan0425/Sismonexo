"""Detector automático de fugas de información.

Cada comprobación devuelve ``{"id", "title", "status", "detail", "evidence"}``
con estado ``ok``, ``advertencia`` o ``falla``. Las comprobaciones se ejecutan
sobre la tabla zona-periodo real y sobre las particiones reales del
experimento, no sobre supuestos.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from . import zones
from .features import FEATURES, EventArrays, build_matrix
from .modeling import Fold, Prep

LABEL_COLUMNS = ["y", "count", "label_max_mag", "label_depth"]


def _res(cid: str, title: str, status: str, detail: str, evidence: dict | None = None) -> dict:
    return {"id": cid, "title": title, "status": status, "detail": detail, "evidence": evidence or {}}


def check_future_features(ea: EventArrays, df: pd.DataFrame, unit: str, horizon: int, threshold: float,
                          n_probe: int = 3, seed: int = 11) -> dict:
    """Recalcula las variables con un catálogo truncado en el origen y exige igualdad exacta.

    Si alguna variable usara eventos del origen o posteriores, cambiaría al
    eliminar esos eventos del catálogo.
    """
    rng = np.random.default_rng(seed)
    origins = np.unique(df.loc[df["y"].notna(), "origin"].to_numpy())
    probe = rng.choice(origins[len(origins) // 4:], size=min(n_probe, len(origins)), replace=False)
    worst, worst_feat = 0.0, ""
    for o in probe:
        ref = df[df["origin"] == o].sort_values("zone")[FEATURES].to_numpy(np.float64)
        alt = build_matrix(ea.truncated(int(o)), unit, horizon, threshold, origins=np.array([o]))
        alt = alt.sort_values("zone")[FEATURES].to_numpy(np.float64)
        diff = np.abs(np.nan_to_num(ref, nan=-9e9) - np.nan_to_num(alt, nan=-9e9)).max(axis=0)
        j = int(np.argmax(diff))
        if diff[j] > worst:
            worst, worst_feat = float(diff[j]), FEATURES[j]
    ok = worst < 1e-4
    return _res("futuro", "Variables construidas con datos futuros", "ok" if ok else "falla",
                "Al truncar el catálogo en el origen de pronóstico, las variables no cambian: solo usan eventos anteriores."
                if ok else f"La variable «{worst_feat}» cambia al quitar eventos futuros (diferencia máxima {worst:.4g}).",
                {"origenes_probados": [int(x) for x in probe], "diferencia_maxima": worst})


def check_scaler(df: pd.DataFrame, fold: Fold, prep: Prep) -> dict:
    """El escalador debe coincidir con los estadísticos del entrenamiento y diferir de los globales."""
    Xtr = df.iloc[fold.train][FEATURES].to_numpy()
    ref = Prep().fit(Xtr)
    same_train = bool(np.allclose(ref.mean, prep.mean, atol=1e-9) and np.allclose(ref.std, prep.std, atol=1e-9))
    full = Prep().fit(df.loc[df["y"].notna(), FEATURES].to_numpy())
    differs_full = bool(not np.allclose(full.mean, prep.mean, atol=1e-9))
    ok = same_train and differs_full and prep.n_fit == len(fold.train)
    return _res("escalador", "Escaladores ajustados con toda la información", "ok" if ok else "falla",
                "Imputación y estandarización se ajustaron solo con el bloque de entrenamiento."
                if ok else "Los estadísticos del escalador no corresponden al bloque de entrenamiento.",
                {"filas_ajuste": prep.n_fit, "filas_entrenamiento": int(len(fold.train)),
                 "coincide_con_entrenamiento": same_train, "difiere_del_total": differs_full})


def check_duplicates(df: pd.DataFrame, folds: list[Fold]) -> dict:
    n_dup = 0
    for f in folds:
        keys = [set(map(tuple, df.iloc[idx][["zone", "origin"]].to_numpy().tolist())) for idx in (f.train, f.val, f.test)]
        n_dup += len(keys[0] & keys[1]) + len(keys[0] & keys[2]) + len(keys[1] & keys[2])
    return _res("duplicados", "Duplicados entre conjuntos", "ok" if n_dup == 0 else "falla",
                "Ninguna pareja zona-periodo aparece en más de un conjunto." if n_dup == 0
                else f"{n_dup} parejas zona-periodo están repetidas entre conjuntos.",
                {"duplicados": n_dup, "pliegues": len(folds)})


def check_overlap(df: pd.DataFrame, folds: list[Fold], horizon: int) -> dict:
    """La ventana de etiqueta de un bloque debe terminar antes del primer origen del bloque siguiente."""
    worst = 10**9
    for f in folds:
        o = df["origin"].to_numpy()
        gap_tv = o[f.val].min() - (o[f.train].max() + horizon)
        gap_vt = o[f.test].min() - (o[f.val].max() + horizon)
        worst = min(worst, int(gap_tv), int(gap_vt))
    ok = worst >= 0
    return _res("ventanas", "Ventanas superpuestas", "ok" if ok else "falla",
                f"Entre bloques hay al menos {horizon} días: ninguna etiqueta de entrenamiento o validación "
                "se solapa con el bloque siguiente." if ok
                else f"Hay solapamiento de {-worst} días entre la etiqueta de un bloque y el siguiente.",
                {"holgura_minima_dias": worst, "horizonte_dias": horizon})


def check_aftershocks(ea: EventArrays, df: pd.DataFrame, folds: list[Fold], threshold: float,
                      days: float = 30.0, km: float = 50.0) -> dict:
    """Cuenta secuencias que cruzan cada frontera validación → prueba.

    Un evento de prueba se considera parte de una secuencia que cruza la frontera
    si tiene un evento (≥ umbral) a ≤ ``km`` y ≤ ``days`` antes de la frontera.
    """
    k = ea.mag >= threshold
    t, lon, lat = ea.tday[k], ea.lon[k], ea.lat[k]
    crossing = total = 0
    for f in folds:
        b = float(df["origin"].to_numpy()[f.test].min())
        before = (t >= b - days) & (t < b)
        after = (t >= b) & (t < b + days)
        total += int(after.sum())
        if before.any() and after.any():
            d = zones.haversine_km(lon[after][:, None], lat[after][:, None], lon[before][None, :], lat[before][None, :])
            crossing += int((d.min(axis=1) <= km).sum())
    share = crossing / max(total, 1)
    return _res("replicas", "Réplicas cercanas repartidas entre conjuntos",
                "advertencia" if crossing else "ok",
                f"{crossing} de {total} eventos de los primeros {days:.0f} días de los bloques de prueba ({share:.0%}) "
                f"tienen un evento a ≤ {km:.0f} km en los {days:.0f} días previos a la frontera. La partición es "
                "cronológica (nunca aleatoria), de modo que una secuencia jamás queda mezclada al azar; aun así, "
                "la actividad persistente cruza la frontera y explica parte del acierto de todos los modelos, "
                "incluida la línea base.",
                {"eventos_cruzan_frontera": crossing, "eventos_evaluados": total, "ventana_dias": days, "radio_km": km})


def check_target_in_inputs(df: pd.DataFrame) -> dict:
    named = sorted(set(FEATURES) & set(LABEL_COLUMNS))
    lab = df[df["y"].notna()]
    sample = lab.sample(min(len(lab), 200_000), random_state=3)
    worst, worst_feat = 0.0, ""
    for f in FEATURES:
        x = sample[f].to_numpy(float)
        ok = ~np.isnan(x)
        if ok.sum() < 100 or np.std(x[ok]) == 0:
            continue
        for target in ("y", "count"):
            c = abs(np.corrcoef(x[ok], sample[target].to_numpy(float)[ok])[0, 1])
            if c > worst:
                worst, worst_feat = float(c), f
    ok_ = not named and worst < 0.98
    return _res("objetivo", "Variable objetivo incluida como entrada", "ok" if ok_ else "falla",
                "Ninguna variable de entrada es la etiqueta ni una copia casi exacta de ella "
                f"(correlación absoluta máxima {worst:.2f}, en «{worst_feat}»)." if ok_
                else f"Posible copia del objetivo: {named or worst_feat} (correlación {worst:.3f}).",
                {"correlacion_maxima": worst, "variable": worst_feat, "columnas_etiqueta_en_entradas": named})


def run_all(ea: EventArrays, df: pd.DataFrame, folds: list[Fold], prep: Prep, unit: str, horizon: int,
            threshold: float) -> list[dict]:
    return [
        check_future_features(ea, df, unit, horizon, threshold),
        check_scaler(df, folds[-1], prep),
        check_duplicates(df, folds),
        check_overlap(df, folds, horizon),
        check_aftershocks(ea, df, folds, threshold),
        check_target_in_inputs(df),
    ]
