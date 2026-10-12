"""Pruebas del pipeline: limpieza, zonas, variables sin fuga, validación cronológica, calibración y exportación.

Usan el catálogo real ya descargado (data/processed). Si no existe, las pruebas que lo necesitan se omiten.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from sismonexo import clean, config, export_web, leakage, zones
from sismonexo import modeling as M
from sismonexo.features import FEATURES, EventArrays, build_matrix, origin_days

needs_data = pytest.mark.skipif(not (config.PROCESSED / "events.parquet").exists(), reason="Ejecute primero la ingesta y la limpieza.")


@pytest.fixture(scope="module")
def ea() -> EventArrays:
    ev = pd.read_parquet(config.PROCESSED / "events.parquet")
    return EventArrays.from_frame(ev)


@pytest.fixture(scope="module")
def matrix(ea):
    return build_matrix(ea, "dep", 30, 4.0)


# ------------------------------------------------------------------ limpieza

def test_familias_de_magnitud():
    assert clean.magnitude_family("MLr_3") == "MLr"
    assert clean.magnitude_family("Mw(mB)") == "Mw"
    assert clean.magnitude_family("ML") == "ML"
    assert clean.magnitude_family("") == "No reportado"


def test_calidad_de_localizacion_derivada():
    q = clean.location_quality(pd.Series([100, 200, 280, 350, np.nan]), pd.Series([2, 8, 20, 40, 3]), pd.Series([0.5, 1.2, 2.0, 3.0, 0.2]))
    assert q.tolist() == ["A", "B", "C", "D", "N"]


def test_nombres_propios_en_espanol():
    assert clean.title_es("VALLE DEL CAUCA") == "Valle del Cauca"
    assert clean.title_es("NORTE DE SANTANDER") == "Norte de Santander"


@needs_data
def test_catalogo_limpio_cumple_las_reglas():
    ev = pd.read_parquet(config.PROCESSED / "events.parquet")
    b = config.BBOX
    assert ev["event_id"].is_unique
    assert ev["event_datetime_utc"].dt.tz is not None and str(ev["event_datetime_utc"].dt.tz) == "UTC"
    assert ev["latitude"].between(b["lat_min"], b["lat_max"]).all() and ev["longitude"].between(b["lon_min"], b["lon_max"]).all()
    assert ev["magnitude"].notna().all() and (ev["magnitude"] >= config.MIN_MAGNITUDE).all()
    assert (ev["depth_km"].dropna() >= 0).all()
    assert set(ev["quality_code"]) <= set("ABCDN")
    assert ev["dataset_version"].nunique() == 1


# ------------------------------------------------------------------ geoespacial

@needs_data
def test_asignacion_espacial_coherente():
    lon, lat = np.array([-74.08, -73.12, -80.0]), np.array([4.61, 6.80, 3.0])     # Bogotá, Los Santos, Pacífico
    dep = zones.build("dep")
    i = zones.assign("dep", lon, lat)
    assert dep.table["zone_name"].iloc[i[0]].startswith("Bogotá")
    assert dep.table["zone_name"].iloc[i[1]] == "Santander"
    assert i[2] == -1
    g = zones.build("g50")
    j = zones.assign("g50", lon, lat)
    assert g.geoms[j[0]].contains(__import__("shapely").Point(lon[0], lat[0]))
    assert zones.haversine_km(-74, 4, -74, 5) == pytest.approx(111.2, abs=0.2)


@needs_data
@pytest.mark.parametrize("unit,expected", [("dep", 33), ("mun", 1122)])
def test_universo_de_zonas(unit, expected):
    assert len(zones.build(unit)) == expected


# ------------------------------------------------------------------ variables y fugas

@needs_data
def test_las_variables_solo_usan_el_pasado(ea, matrix):
    r = leakage.check_future_features(ea, matrix, "dep", 30, 4.0)
    assert r["status"] == "ok" and r["evidence"]["diferencia_maxima"] < 1e-4


@needs_data
def test_la_etiqueta_usa_la_ventana_futura(ea, matrix):
    o = int(np.unique(matrix.loc[matrix["y"].notna(), "origin"])[-5])
    zi = ea.zone_index("dep")
    k = (ea.day >= o) & (ea.day < o + 30) & (ea.mag >= 4.0) & (zi >= 0)
    expected = np.bincount(zi[k], minlength=len(zones.build("dep")))
    got = matrix[matrix["origin"] == o].sort_values("zone")["count"].to_numpy()
    assert np.array_equal(got, expected)
    # El último origen es el del pronóstico vigente: no tiene etiqueta.
    assert matrix.loc[matrix["origin"] == ea.end_day, "y"].isna().all()


@needs_data
def test_el_detector_descubre_una_fuga_inyectada(matrix):
    leaky = matrix.copy()
    leaky["n_30"] = leaky["count"].fillna(0) * 3 + 1          # copia del objetivo como entrada
    assert leakage.check_target_in_inputs(leaky)["status"] == "falla"
    assert leakage.check_target_in_inputs(matrix)["status"] == "ok"


def test_origenes_alineados_con_el_fin_del_catalogo():
    o = origin_days(12000, 30)
    assert o[-1] == 12000 and np.all(np.diff(o) == 30) and o[0] >= 365
    assert np.all(np.diff(origin_days(12000, 7)) == 7)


# ------------------------------------------------------------------ validación cronológica

@needs_data
@pytest.mark.parametrize("horizon", [7, 30, 90])
def test_particiones_cronologicas_con_separacion(ea, horizon):
    df = build_matrix(ea, "dep", horizon, 4.0)
    origin, lab = df["origin"].to_numpy(), df["y"].notna().to_numpy()
    folds = M.make_folds(origin, lab, horizon)
    assert len(folds) == 8
    prev_test = -1
    for f in folds:
        tr, va, te = origin[f.train], origin[f.val], origin[f.test]
        assert tr.max() + horizon <= va.min(), "la etiqueta de entrenamiento no debe tocar la validación"
        assert va.max() + horizon <= te.min(), "la etiqueta de validación no debe tocar la prueba"
        assert te.min() > prev_test, "los bloques de prueba avanzan en el tiempo"
        prev_test = te.max()
        assert not (set(f.train) & set(f.val)) and not (set(f.val) & set(f.test)) and not (set(f.train) & set(f.test))
        assert lab[f.test].all()
    assert leakage.check_overlap(df, folds, horizon)["status"] == "ok"
    assert leakage.check_duplicates(df, folds)["status"] == "ok"


@needs_data
def test_el_escalador_se_ajusta_solo_con_entrenamiento(matrix):
    folds = M.make_folds(matrix["origin"].to_numpy(), matrix["y"].notna().to_numpy(), 30)
    f = folds[-1]
    good = M.Prep().fit(matrix.iloc[f.train][FEATURES].to_numpy())
    assert leakage.check_scaler(matrix, f, good)["status"] == "ok"
    bad = M.Prep().fit(matrix.loc[matrix["y"].notna(), FEATURES].to_numpy())     # ajustado con todo: debe detectarse
    assert leakage.check_scaler(matrix, f, bad)["status"] == "falla"


# ------------------------------------------------------------------ calibración, métricas y exportación

def test_la_calibracion_isotonica_no_devuelve_certezas():
    rng = np.random.default_rng(0)
    p = rng.uniform(0, 1, 4000)
    y = (rng.uniform(0, 1, 4000) < p ** 2).astype(float)
    y[p > 0.97] = 1.0                                           # tramo extremo con todos los casos positivos
    iso = M.Iso().fit(p, y)
    out = iso(np.linspace(0, 1, 201))
    assert np.all(np.diff(out) >= -1e-12)
    assert out.max() < 0.995 and out.min() > 0
    ex = iso.export()
    assert np.allclose(np.interp(0.5, ex["x"], ex["y"]), iso(np.array([0.5]))[0], atol=1e-5)


def test_intervalos_de_incertidumbre_por_tramos_fijos():
    rng = np.random.default_rng(1)
    p = np.clip(rng.beta(0.3, 20, 100_000), 0, 1)
    p[:400] = rng.uniform(0.4, 0.95, 400)
    y = (rng.random(len(p)) < p).astype(float)
    bins = M.uncertainty_bins(y, p)
    assert all(b["n"] >= 40 for b in bins) and bins[-1]["p_max"] == 1.0
    lo, hi = M.interval_from_bins(bins, np.array([0.001, 0.05, 0.9]))
    assert np.all(lo <= np.array([0.001, 0.05, 0.9])) and np.all(hi >= np.array([0.001, 0.05, 0.9]))
    assert hi[2] - lo[2] < 0.5, "una probabilidad alta no debe heredar el intervalo de las bajas"


def test_metricas_basicas():
    y = np.array([0, 0, 0, 1, 1, 0, 0, 1, 0, 0] * 30, dtype=float)
    p = np.where(y == 1, 0.8, 0.1)
    m = M.metrics(y, p, 0.5, p_base=np.full(len(y), 0.3))
    assert m["pr_auc"] == pytest.approx(1.0) and m["roc_auc"] == pytest.approx(1.0)
    assert m["confusion"] == {"tp": 90, "fp": 0, "fn": 0, "tn": 210}
    assert m["brier"] == pytest.approx(0.3 * 0.04 + 0.7 * 0.01)
    assert m["brier_skill"] > 0 and m["info_gain_bits"] > 0


def test_arboles_exportados_equivalen_al_modelo():
    rng = np.random.default_rng(2)
    X = rng.normal(size=(3000, len(FEATURES)))
    X[rng.random(X.shape) < 0.05] = np.nan
    y = (np.nan_to_num(X[:, 0]) + 0.5 * np.nan_to_num(X[:, 3]) + rng.normal(scale=0.5, size=3000) > 1).astype(int)
    from sklearn.ensemble import HistGradientBoostingClassifier
    m = HistGradientBoostingClassifier(max_iter=20, max_leaf_nodes=7, random_state=0).fit(X, y)
    raw = M.eval_hgb_export(M.export_hgb(m), X[:200])
    # Los umbrales se exportan con 6 decimales: un valor justo en la frontera puede caer en la otra rama.
    close = np.abs(raw - m.decision_function(X[:200])) < 1e-4
    assert close.mean() >= 0.97


def test_prueba_de_pettitt_y_completitud():
    x = np.r_[np.random.default_rng(3).normal(10, 1, 120), np.random.default_rng(4).normal(14, 1, 120)]
    r = export_web.pettitt(x)
    assert 110 <= r["index"] <= 130 and r["p_value"] < 1e-6 and r["after"] > r["before"]
    mags = np.round(np.random.default_rng(5).exponential(0.43, 5000) + 2.7, 1)
    assert export_web.completeness_magnitude(mags) == pytest.approx(2.9, abs=0.11)
    assert export_web.completeness_magnitude(mags[:50]) is None
