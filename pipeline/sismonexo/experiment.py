"""Experimento completo para una configuración (unidad, horizonte, umbral).

1. Tabla zona-periodo.
2. Validación walk-forward (entrenamiento → validación → prueba, con separación temporal).
3. Métricas agregadas, por pliegue, por departamento, por profundidad y por magnitud.
4. Detector de fugas.
5. Ajuste final y pronóstico vigente con intervalos de incertidumbre.
6. Explicabilidad: SHAP, importancia por permutación, dependencias parciales y periodos similares.
"""
from __future__ import annotations

import time
import warnings

import numpy as np
import pandas as pd
import shap
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_curve

from . import leakage, zones
from . import modeling as M
from .features import FEATURES, EventArrays, build_matrix, day_to_date

SIM_FEATURES = ["n_30", "n_90", "n_365", "nt_365", "max_mag_365", "max_mag_30", "days_since_last",
                "nb_30", "etas_trigger", "median_depth_365"]
FINAL_TEST_FOLDS = 2


def _date(day: int) -> str:
    return day_to_date(int(day)).strftime("%Y-%m-%d")


def _r(x, nd=5):
    """Redondeo seguro para JSON (NaN → None)."""
    if x is None:
        return None
    if isinstance(x, (float, np.floating)):
        return None if not np.isfinite(x) else round(float(x), nd)
    if isinstance(x, (int, np.integer)):
        return int(x)
    if isinstance(x, dict):
        return {k: _r(v, nd) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_r(v, nd) for v in x]
    return x


def _arr(a: np.ndarray, nd: int = 4) -> list:
    a = np.asarray(a, dtype=float)
    return [None if not np.isfinite(v) else round(float(v), nd) for v in a]


def _fit_block(models: dict, dtr, ytr, ctr, dval, yval, timing: dict) -> tuple[dict, dict, dict]:
    """Ajusta los modelos en entrenamiento y calibra en validación. Devuelve calibradores, umbrales y predicciones de validación."""
    cal, thr, pv = {}, {}, {}
    for key, m in models.items():
        t0 = time.perf_counter()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            m.fit(dtr, ytr, ctr)
        timing.setdefault(key, {"fit_s": [], "infer_us": []})["fit_s"].append(time.perf_counter() - t0)
        p = m.predict(dval)
        if m.needs_calibration:
            cal[key] = M.Iso().fit(p, yval)
            p = cal[key](p)
        pv[key] = M.clip01(p)
        thr[key] = M.best_f1_threshold(yval, pv[key])
    return cal, thr, pv


def _predict(models: dict, cal: dict, d: pd.DataFrame, timing: dict | None = None) -> tuple[dict, dict]:
    p, e = {}, {}
    for key, m in models.items():
        t0 = time.perf_counter()
        x = m.predict(d)
        if key in cal:
            x = cal[key](x)
        if timing is not None and len(d):
            timing[key]["infer_us"].append((time.perf_counter() - t0) / len(d) * 1e6)
        p[key] = M.clip01(x)
        ex = m.expected(d)
        if ex is not None:
            e[key] = ex
    return p, e


def _new_models(horizon: int, full: bool, n_jobs: int) -> dict:
    ms = {"base": M.Baseline(horizon), "logit": M.Logit(), "pois": M.PoissonNB(),
          "hgb": M.Boosting(), "etas": M.EtasRate(horizon)}
    if full:
        ms["rf"] = M.Forest(n_jobs=n_jobs)
    return ms


def run_config(ea: EventArrays, unit: str, horizon: int, threshold: float, full: bool = False,
               n_folds: int = 8, n_jobs: int = 2, dataset_version: str = "") -> dict:
    t_start = time.perf_counter()
    zs = zones.build(unit)
    df = build_matrix(ea, unit, horizon, threshold)
    lab = df["y"].notna().to_numpy()
    origin = df["origin"].to_numpy()
    folds = M.make_folds(origin, lab, horizon, n_folds=n_folds)
    dept = zs.table["department"].to_numpy()

    timing: dict = {}
    oof = {k: [] for k in ("idx", "fold")}
    oof_p: dict[str, list] = {}
    oof_e: dict[str, list] = {}
    fold_rows = []
    last_models = last_cal = None
    last_fold_prep = None

    for f in folds:
        dtr, dval, dte = df.iloc[f.train], df.iloc[f.val], df.iloc[f.test]
        ytr, yval, yte = dtr["y"].to_numpy(), dval["y"].to_numpy(), dte["y"].to_numpy()
        models = _new_models(horizon, full, n_jobs)
        cal, thr, pv = _fit_block(models, dtr, ytr, dtr["count"].to_numpy(), dval, yval, timing)
        hyb = M.Hybrid().fit(pv, yval)
        thr["hyb"] = M.best_f1_threshold(yval, hyb.predict(pv))
        p, e = _predict(models, cal, dte, timing)
        p["hyb"] = hyb.predict(p)
        oof["idx"].append(f.test)
        oof["fold"].append(np.full(len(f.test), f.k))
        for k, v in p.items():
            oof_p.setdefault(k, []).append(v)
        for k, v in e.items():
            oof_e.setdefault(k, []).append(v)
        row = {"fold": f.k, **{a: [_date(b[0]), _date(b[1])] for a, b in f.info.items() if a in ("train", "val", "test")},
               "n_train": int(len(f.train)), "n_val": int(len(f.val)), "n_test": int(len(f.test)),
               "gap_days": horizon, "test_positives": int(yte.sum()), "models": {}}
        for k, v in p.items():
            mt = M.metrics(yte, v, thr[k], p_base=p["base"], count=dte["count"].to_numpy(), expected=e.get(k))
            row["models"][k] = {a: mt[a] for a in ("pr_auc", "roc_auc", "brier", "log_loss", "ece", "precision",
                                                   "recall", "f1", "decision_threshold", "brier_skill", "mae_count")}
        fold_rows.append(row)
        last_models, last_cal, last_fold_prep, last_thr = models, cal, models["logit"].prep, thr

    idx = np.concatenate(oof["idx"])
    fold_id = np.concatenate(oof["fold"])
    P = {k: np.concatenate(v) for k, v in oof_p.items()}
    E = {k: np.concatenate(v) for k, v in oof_e.items()}
    y = df["y"].to_numpy()[idx]
    cnt = df["count"].to_numpy()[idx]
    final_mask = fold_id > len(folds) - FINAL_TEST_FOLDS
    sel_mask = ~final_mask

    model_keys = [k for k in ("base", "logit", "pois", "rf", "hgb", "etas", "hyb") if k in P]
    # El umbral de decisión reportado en el agregado es el del último pliegue (ajustado en su validación).
    result_models = {}
    for k in model_keys:
        thr_k = last_thr[k]
        allm = M.metrics(y, P[k], thr_k, p_base=P["base"], count=cnt, expected=E.get(k))
        testm = M.metrics(y[final_mask], P[k][final_mask], thr_k, p_base=P["base"][final_mask],
                          count=cnt[final_mask], expected=E[k][final_mask] if k in E else None)
        selm = M.metrics(y[sel_mask], P[k][sel_mask], thr_k, p_base=P["base"][sel_mask])
        per_fold_pr = [r["models"][k]["pr_auc"] for r in fold_rows if r["models"][k]["pr_auc"] is not None]
        per_fold_br = [r["models"][k]["brier"] for r in fold_rows]
        curves = {}
        if allm["evaluable"]:
            pr, rc, _ = precision_recall_curve(y, P[k])
            fpr, tpr, _ = roc_curve(y, P[k])
            curves = {"pr": M._curve(rc[::-1], pr[::-1]), "roc": M._curve(fpr, tpr)}
        curves["calibration"] = _r(M.reliability(y, P[k]))
        t = timing.get(k, {"fit_s": [0.0], "infer_us": [0.0]})
        result_models[k] = {
            **M.MODEL_INFO[k], "key": k,
            "walk_forward": _r(allm), "final_test": _r(testm), "selection": _r(selm),
            "calibration_status": M.calibration_status(testm if testm["positives"] >= 30 else allm),
            "stability": {"pr_auc_std": _r(float(np.std(per_fold_pr)) if len(per_fold_pr) > 1 else None),
                          "pr_auc_min": _r(min(per_fold_pr) if per_fold_pr else None),
                          "pr_auc_max": _r(max(per_fold_pr) if per_fold_pr else None),
                          "brier_std": _r(float(np.std(per_fold_br)))},
            "fit_seconds": _r(float(np.mean(t["fit_s"])), 3) if k != "hyb" else None,
            "inference_us_per_row": _r(float(np.mean(t["infer_us"])), 3) if k != "hyb" else None,
            "curves": curves,
            "uncertainty_bins": M.uncertainty_bins(y, P[k]),
        }

    # Desagregaciones --------------------------------------------------------------------------
    zone_of = df["zone"].to_numpy()[idx]
    by_dept = []
    for d in sorted(set(dept) - {""}):
        k = dept[zone_of] == d
        if k.sum() < 50:
            continue
        row = {"department": d, "n": int(k.sum()), "positives": int(y[k].sum()), "observed_rate": _r(float(y[k].mean())), "models": {}}
        for mk in model_keys:
            ok = 0 < y[k].sum() < k.sum() and y[k].sum() >= 10
            row["models"][mk] = {"brier": _r(float(np.mean((P[mk][k] - y[k]) ** 2))),
                                 "pr_auc": _r(float(average_precision_score(y[k], P[mk][k]))) if ok else None,
                                 "mean_p": _r(float(P[mk][k].mean()))}
        by_dept.append(row)

    lab_depth = df["label_depth"].to_numpy()[idx]
    lab_mag = df["label_max_mag"].to_numpy()[idx]
    by_depth = []
    for lo, hi, name in M.DEPTH_CLASSES:
        k = (y == 1) & (lab_depth >= lo) & (lab_depth < hi)
        row = {"class": name, "positives": int(k.sum()), "models": {}}
        for mk in model_keys:
            row["models"][mk] = {"recall": _r(float((P[mk][k] >= last_thr[mk]).mean())) if k.sum() >= 5 else None,
                                 "mean_p": _r(float(P[mk][k].mean())) if k.sum() else None}
        by_depth.append(row)
    by_mag = []
    for lo, hi in ((0.0, 0.5), (0.5, 1.0), (1.0, 99.0)):
        k = (y == 1) & (lab_mag >= threshold + lo) & (lab_mag < threshold + hi)
        name = f"M {threshold + lo:.1f}–{threshold + hi:.1f}" if hi < 90 else f"M ≥ {threshold + lo:.1f}"
        row = {"class": name.replace(".", ","), "positives": int(k.sum()), "models": {}}
        for mk in model_keys:
            row["models"][mk] = {"recall": _r(float((P[mk][k] >= last_thr[mk]).mean())) if k.sum() >= 5 else None,
                                 "mean_p": _r(float(P[mk][k].mean())) if k.sum() else None}
        by_mag.append(row)

    # Selección del modelo por defecto: menor log-loss fuera del bloque de prueba final --------
    cands = {k: result_models[k]["selection"]["log_loss"] for k in model_keys}
    selected = min(cands, key=cands.get)

    # Detector de fugas ------------------------------------------------------------------------
    leaks = leakage.run_all(ea, df, folds, last_fold_prep, unit, horizon, threshold)

    # Ajuste final y pronóstico vigente --------------------------------------------------------
    lab_o = np.unique(origin[lab])
    val_o = lab_o[lab_o > lab_o.max() - 730]
    train_o = lab_o[lab_o <= val_o.min() - horizon]
    dtr = df[lab & np.isin(origin, train_o)]
    dval = df[lab & np.isin(origin, val_o)]
    models = _new_models(horizon, full, n_jobs)
    tmp: dict = {}
    cal, thr, pv = _fit_block(models, dtr, dtr["y"].to_numpy(), dtr["count"].to_numpy(), dval, dval["y"].to_numpy(), tmp)
    hyb = M.Hybrid().fit(pv, dval["y"].to_numpy())
    now = df[origin == ea.end_day].sort_values("zone")
    prev_origin = int(np.unique(origin)[-2])
    prev = df[origin == prev_origin].sort_values("zone")
    p_now, e_now = _predict(models, cal, now)
    p_now["hyb"] = hyb.predict(p_now)
    p_prev, _ = _predict(models, cal, prev)
    p_prev["hyb"] = hyb.predict(p_prev)

    # Explicabilidad ---------------------------------------------------------------------------
    Xnow = now[FEATURES].to_numpy(np.float64)
    explainer = shap.TreeExplainer(models["hgb"].m)
    sv = np.asarray(explainer.shap_values(Xnow, check_additivity=False))
    if sv.ndim == 3:
        sv = sv[..., -1]
    shap_base = float(np.ravel(explainer.expected_value)[-1])

    f_last = folds[-1]
    dte = df.iloc[f_last.test]
    rng = np.random.default_rng(5)
    if len(dte) > 60_000:
        dte = dte.iloc[rng.choice(len(dte), 60_000, replace=False)]
    yte = dte["y"].to_numpy()
    hgb_last = last_models["hgb"]
    base_ap = average_precision_score(yte, hgb_last.predict(dte)) if 0 < yte.sum() < len(yte) else None
    perm = []
    if base_ap is not None:
        for j, name in enumerate(FEATURES):
            drops = []
            for _ in range(3):
                d2 = dte.copy()
                d2[name] = rng.permutation(d2[name].to_numpy())
                drops.append(base_ap - average_precision_score(yte, hgb_last.predict(d2)))
            perm.append({"feature": name, "drop_pr_auc": _r(float(np.mean(drops))), "std": _r(float(np.std(drops)))})
        perm.sort(key=lambda r: -(r["drop_pr_auc"] or 0))
    mean_abs_shap = np.abs(sv).mean(axis=0)
    top_feats = [r["feature"] for r in perm[:6]] if perm else [FEATURES[i] for i in np.argsort(-mean_abs_shap)[:6]]
    pdp = []
    sample = dte.iloc[rng.choice(len(dte), min(2500, len(dte)), replace=False)]
    for name in top_feats:
        vals = np.unique(np.nanquantile(dte[name].to_numpy(float), np.linspace(0.02, 0.98, 12)))
        curve = []
        for v in vals:
            d2 = sample.copy()
            d2[name] = v
            curve.append([_r(float(v), 4), _r(float(last_cal["hgb"](hgb_last.predict(d2)).mean()), 5)])
        pdp.append({"feature": name, "curve": curve})

    # Periodos históricos similares de la misma zona -------------------------------------------
    labdf = df[lab].sort_values(["origin", "zone"])
    n_o, nz = labdf["origin"].nunique(), len(zs)
    A = labdf[SIM_FEATURES].to_numpy(np.float32)
    med = np.nanmedian(A, axis=0)
    A = np.where(np.isnan(A), med, A)
    mu, sd = A.mean(axis=0), A.std(axis=0) + 1e-6
    A = ((A - mu) / sd).reshape(n_o, nz, len(SIM_FEATURES))
    F = now[SIM_FEATURES].to_numpy(np.float32)
    F = (np.where(np.isnan(F), med, F) - mu) / sd
    D = np.sqrt(((A - F[None, :, :]) ** 2).sum(axis=2))            # [origen, zona]
    lab_origins = np.sort(labdf["origin"].unique())
    C = labdf["count"].to_numpy().reshape(n_o, nz)
    k20 = min(20, n_o)
    near = np.argpartition(D, k20 - 1, axis=0)[:k20]                # [k, zona]
    sim_pos = (np.take_along_axis(C, near, axis=0) > 0).sum(axis=0)
    order = np.argsort(np.take_along_axis(D, near, axis=0), axis=0)[:3]
    top3 = np.take_along_axis(near, order, axis=0)                  # [3, zona]
    similar = [[[_date(lab_origins[top3[r, z]]), int(C[top3[r, z], z]), _r(float(D[top3[r, z], z]), 2)] for r in range(3)]
               for z in range(nz)]

    fc_start, fc_end = _date(ea.end_day), _date(ea.end_day + horizon)
    forecast = {
        "generated_at": pd.Timestamp.now(tz="UTC").strftime("%Y-%m-%dT%H:%M:%SZ"),
        "forecast_start": fc_start, "forecast_end": fc_end, "previous_origin": _date(prev_origin),
        "zone_ids": zs.table["zone_id"].tolist(),
        "p": {k: _arr(v, 5) for k, v in p_now.items()},
        "p_prev": {k: _arr(v, 5) for k, v in p_prev.items()},
        "expected": {k: _arr(v, 4) for k, v in e_now.items()},
        "features": [_arr(r, 3) for r in Xnow],
        "shap": [_arr(r, 4) for r in sv], "shap_base": round(shap_base, 5),
        "similar": similar, "similar_k": int(k20), "similar_positive": sim_pos.astype(int).tolist(),
    }
    lab_models = {
        "base": models["base"].export(), "logit": {**models["logit"].export(), "iso": cal["logit"].export()},
        "pois": models["pois"].export(), "etas": models["etas"].export(),
        "hgb": {**models["hgb"].export(), "iso": cal["hgb"].export()}, "hyb": hyb.export(),
    }
    lo_q = np.nanquantile(df.loc[lab, FEATURES].to_numpy(float), 0.005, axis=0)
    hi_q = np.nanquantile(df.loc[lab, FEATURES].to_numpy(float), 0.995, axis=0)
    mins = np.nanmin(df.loc[lab, FEATURES].to_numpy(float), axis=0)
    maxs = np.nanmax(df.loc[lab, FEATURES].to_numpy(float), axis=0)
    ranges = {f: {"min": _r(float(mins[i]), 4), "max": _r(float(maxs[i]), 4), "q005": _r(float(lo_q[i]), 4),
                  "q995": _r(float(hi_q[i]), 4)} for i, f in enumerate(FEATURES)}

    return {
        "config": {"unit": unit, "unit_label": zones.UNITS[unit]["label"], "horizon_days": horizon,
                   "threshold": threshold, "full_comparison": full, "n_zones": len(zs),
                   "n_rows": int(lab.sum()), "positives": int(df.loc[lab, "y"].sum()),
                   "prevalence": _r(float(df.loc[lab, "y"].mean())),
                   "origin_step_days": int(np.diff(np.unique(origin)).min()),
                   "first_origin": _date(origin.min()), "last_labelled_origin": _date(lab_o.max()),
                   "dataset_version": dataset_version,
                   "model_version": f"sn-{unit}-h{horizon}-m{int(round(threshold * 10))}-{dataset_version}",
                   "elapsed_s": round(time.perf_counter() - t_start, 1)},
        "features": FEATURES,
        "folds": fold_rows,
        "final_fit": {"train": [_date(train_o.min()), _date(train_o.max())], "val": [_date(val_o.min()), _date(val_o.max())],
                      "n_train": int(len(dtr)), "n_val": int(len(dval))},
        "final_test_folds": FINAL_TEST_FOLDS,
        "models": result_models, "selected_model": selected,
        "selection_rule": "Menor log-loss en los pliegues walk-forward anteriores al bloque de prueba final.",
        "by_department": by_dept, "by_depth": by_depth, "by_magnitude": by_mag,
        "leakage": _r(leaks),
        "explain": {"permutation": perm, "pdp": pdp,
                    "mean_abs_shap": [{"feature": f, "value": _r(float(v), 5)} for f, v in zip(FEATURES, mean_abs_shap)],
                    "logit_coef": [{"feature": f, "coef": _r(float(c), 4)} for f, c in zip(FEATURES, models["logit"].m.coef_[0])],
                    "note": "SHAP en log-odds del modelo de gradient boosting antes de la calibración isotónica."},
        "forecast": forecast,
        "lab": {"models": lab_models, "ranges": ranges},
        "_frames": {"df": df, "p_now": p_now, "e_now": e_now},
    }
