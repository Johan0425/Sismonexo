"""Modelos, validación walk-forward, calibración, métricas y explicabilidad.

Objetivo de predicción
----------------------
P(al menos un evento con magnitud ≥ umbral en la zona durante el horizonte).

Familias comparadas
-------------------
``base``   Línea base de frecuencia histórica (Poisson homogéneo con previa Gamma).
``logit``  Regresión logística con ponderación de clases y calibración isotónica.
``pois``   Regresión de Poisson para conteos; probabilidad con binomial negativa (NB2).
``rf``     Random Forest con calibración isotónica (solo en configuraciones principales).
``hgb``    Gradient boosting por histogramas (familia LightGBM/XGBoost) con calibración isotónica.
``etas``   Tasa inspirada en ETAS: fondo histórico + actividad reciente ponderada.
``hyb``    Híbrido: combinación logística de base, ETAS y gradient boosting.

Toda transformación (imputación, escalado, calibración, umbral de decisión) se
ajusta únicamente con datos anteriores al bloque que se evalúa.
"""
from __future__ import annotations

import time
import warnings
from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.isotonic import IsotonicRegression
from sklearn.linear_model import LogisticRegression, PoissonRegressor
from sklearn.metrics import average_precision_score, precision_recall_curve, roc_auc_score, roc_curve

from .features import FEATURES

EPS = 1e-6
LOG_FEATURES = ["n_30", "n_90", "n_365", "nt_30", "nt_90", "nt_365", "nt_1825", "rate_hist",
                "days_since_last", "days_since_last_t", "dist_prev_km", "nb_30", "nb_365"]
DEPTH_CLASSES = [(0, 30, "0–30 km"), (30, 60, "30–60 km"), (60, 150, "60–150 km"),
                 (150, 300, "150–300 km"), (300, 1e9, "Más de 300 km")]

MODEL_INFO = {
    "base": {"name": "Línea base de frecuencia histórica", "family": "Estadístico", "interpretability": 5, "counts": True},
    "logit": {"name": "Regresión logística", "family": "Estadístico / ML lineal", "interpretability": 4, "counts": False},
    "pois": {"name": "Poisson / binomial negativa", "family": "Estadístico (conteos)", "interpretability": 4, "counts": True},
    "rf": {"name": "Random Forest", "family": "Aprendizaje automático", "interpretability": 2, "counts": False},
    "hgb": {"name": "Gradient boosting por histogramas", "family": "Aprendizaje automático", "interpretability": 2, "counts": False},
    "etas": {"name": "Tasa inspirada en ETAS", "family": "Estadístico (sismológico)", "interpretability": 4, "counts": True},
    "hyb": {"name": "Híbrido estadístico + ML", "family": "Híbrido", "interpretability": 2, "counts": False},
}


def clip01(p):
    return np.clip(p, EPS, 1 - EPS)


def logit(p):
    p = clip01(p)
    return np.log(p / (1 - p))


def sigmoid(x):
    return 1.0 / (1.0 + np.exp(-x))


# --------------------------------------------------------------------- particiones

@dataclass
class Fold:
    k: int
    train: np.ndarray
    val: np.ndarray
    test: np.ndarray
    info: dict


def make_folds(origin: np.ndarray, labelled: np.ndarray, horizon: int, n_folds: int = 8,
               test_days: int = 365, val_days: int = 730) -> list[Fold]:
    """Particiones walk-forward de ventana creciente con separación temporal de ``horizon`` días.

    Para cada pliegue: entrenamiento < validación < prueba, y la ventana de etiqueta de
    cualquier fila termina antes del primer origen del bloque siguiente.
    """
    lab = np.unique(origin[labelled])
    last = lab.max()
    folds = []
    for i, k in enumerate(range(n_folds - 1, -1, -1)):
        te_hi = last - k * test_days
        test_o = lab[(lab > te_hi - test_days) & (lab <= te_hi)]
        val_o = lab[(lab <= test_o.min() - horizon) & (lab > test_o.min() - horizon - val_days)]
        train_o = lab[lab <= val_o.min() - horizon]
        if len(train_o) < 12:
            continue
        folds.append(Fold(
            k=i + 1,
            train=np.flatnonzero(labelled & np.isin(origin, train_o)),
            val=np.flatnonzero(labelled & np.isin(origin, val_o)),
            test=np.flatnonzero(labelled & np.isin(origin, test_o)),
            info={"train": [int(train_o.min()), int(train_o.max())], "val": [int(val_o.min()), int(val_o.max())],
                  "test": [int(test_o.min()), int(test_o.max())], "gap_days": int(horizon),
                  "n_origins": [int(len(train_o)), int(len(val_o)), int(len(test_o))]},
        ))
    return folds


# -------------------------------------------------------------------- preprocesado

class Prep:
    """Imputación por mediana, log1p de variables de conteo y estandarización.

    ``fit`` recibe solo el bloque de entrenamiento; los estadísticos quedan
    guardados para auditar que no se ajustó con todo el conjunto.
    """

    def fit(self, X: np.ndarray) -> "Prep":
        self.log_idx = np.array([FEATURES.index(f) for f in LOG_FEATURES])
        Z = self._log(X)
        self.median = np.nanmedian(Z, axis=0)
        self.median = np.where(np.isnan(self.median), 0.0, self.median)
        Z = np.where(np.isnan(Z), self.median, Z)
        self.mean = Z.mean(axis=0)
        self.std = Z.std(axis=0)
        self.std[self.std < 1e-9] = 1.0
        self.n_fit = int(len(X))
        return self

    def _log(self, X):
        Z = np.array(X, dtype=np.float64)
        Z[:, self.log_idx] = np.log1p(np.maximum(Z[:, self.log_idx], 0))
        return Z

    def transform(self, X: np.ndarray) -> np.ndarray:
        Z = self._log(X)
        Z = np.where(np.isnan(Z), self.median, Z)
        return (Z - self.mean) / self.std

    def export(self) -> dict:
        return {"log_features": LOG_FEATURES, "median": self.median.round(6).tolist(),
                "mean": self.mean.round(6).tolist(), "std": self.std.round(6).tolist()}


class Iso:
    """Calibración isotónica (monótona) ajustada en el bloque de validación."""

    # Pseudo-observaciones con la prevalencia de validación. Sin este encogimiento, un escalón
    # extremo con muy pocos casos devuelve exactamente 0 o 1, que no es una probabilidad defendible.
    pseudo = 20.0

    def fit(self, p, y):
        p, y = np.asarray(p, dtype=float), np.asarray(y, dtype=float)
        iso = IsotonicRegression(y_min=0.0, y_max=1.0, out_of_bounds="clip").fit(p, y)
        levels, inv = np.unique(iso.predict(p), return_inverse=True)
        n = np.bincount(inv)
        k = np.bincount(inv, weights=y)
        shrunk = np.maximum.accumulate((k + self.pseudo * y.mean()) / (n + self.pseudo))
        self.x = np.asarray(iso.X_thresholds_, dtype=float)
        j = np.clip(np.searchsorted(levels, iso.y_thresholds_), 0, len(levels) - 1)
        self.y = shrunk[j]
        return self

    def __call__(self, p):
        return clip01(np.interp(p, self.x, self.y))

    def export(self) -> dict:
        return {"x": np.round(self.x, 6).tolist(), "y": np.round(self.y, 6).tolist()}


# ------------------------------------------------------------------------- modelos

class BaseModel:
    key = ""
    needs_calibration = False

    def expected(self, d: pd.DataFrame):
        return None


class Baseline(BaseModel):
    """Frecuencia histórica de la zona con encogimiento hacia la tasa media de todas las zonas."""
    key = "base"
    prior_events = 0.5

    def __init__(self, horizon: int):
        self.h = horizon

    def fit(self, d, y, c, dv=None, yv=None):
        self.mean_rate = float(max(np.mean(c) * 30.0 / self.h, 1e-6))   # eventos por 30 días y zona
        self.b = self.prior_events / self.mean_rate
        return self

    def rate30(self, d):
        periods = d["origin"].to_numpy(float) / 30.0
        n = d["rate_hist"].to_numpy(float) * periods
        return (n + self.prior_events) / (periods + self.b)

    def expected(self, d):
        return self.rate30(d) * self.h / 30.0

    def predict(self, d):
        return clip01(1 - np.exp(-self.expected(d)))

    def export(self):
        return {"prior_events": self.prior_events, "prior_periods": round(self.b, 6), "mean_rate30": round(self.mean_rate, 8)}


class Logit(BaseModel):
    key = "logit"
    needs_calibration = True

    def fit(self, d, y, c, dv=None, yv=None):
        self.prep = Prep().fit(d[FEATURES].to_numpy())
        self.m = LogisticRegression(C=1.0, class_weight="balanced", max_iter=400)
        self.m.fit(self.prep.transform(d[FEATURES].to_numpy()), y)
        return self

    def predict(self, d):
        return self.m.predict_proba(self.prep.transform(d[FEATURES].to_numpy()))[:, 1]

    def export(self):
        return {"prep": self.prep.export(), "coef": self.m.coef_[0].round(6).tolist(), "intercept": round(float(self.m.intercept_[0]), 6)}


class PoissonNB(BaseModel):
    key = "pois"

    def fit(self, d, y, c, dv=None, yv=None):
        self.prep = Prep().fit(d[FEATURES].to_numpy())
        X = self.prep.transform(d[FEATURES].to_numpy())
        self.m = PoissonRegressor(alpha=1e-3, max_iter=300).fit(X, c)
        mu = self.m.predict(X)
        # Sobredispersión NB2 por momentos: Var = mu + alpha·mu²
        self.alpha = float(max(np.sum((c - mu) ** 2 - mu) / max(np.sum(mu ** 2), 1e-12), 1e-6))
        return self

    def expected(self, d):
        return np.clip(self.m.predict(self.prep.transform(d[FEATURES].to_numpy())), 0, 1e4)

    def predict(self, d):
        mu = self.expected(d)
        return clip01(1 - (1 + self.alpha * mu) ** (-1 / self.alpha))

    def export(self):
        return {"prep": self.prep.export(), "coef": self.m.coef_.round(6).tolist(),
                "intercept": round(float(self.m.intercept_), 6), "alpha": round(self.alpha, 6)}


class Forest(BaseModel):
    key = "rf"
    needs_calibration = True

    def __init__(self, n_jobs: int = 4):
        self.n_jobs = n_jobs

    def fit(self, d, y, c, dv=None, yv=None):
        self.prep = Prep().fit(d[FEATURES].to_numpy())
        self.m = RandomForestClassifier(n_estimators=120, min_samples_leaf=25, max_features="sqrt",
                                        max_samples=min(150_000, len(d)), class_weight="balanced_subsample",
                                        n_jobs=self.n_jobs, random_state=7)
        self.m.fit(self.prep.transform(d[FEATURES].to_numpy()), y)
        return self

    def predict(self, d):
        return self.m.predict_proba(self.prep.transform(d[FEATURES].to_numpy()))[:, 1]


HGB_PARAMS = dict(max_iter=150, learning_rate=0.06, max_leaf_nodes=15, min_samples_leaf=100,
                  l2_regularization=1.0, class_weight="balanced", early_stopping=False, random_state=7)


class Boosting(BaseModel):
    key = "hgb"
    needs_calibration = True

    def fit(self, d, y, c, dv=None, yv=None):
        self.m = HistGradientBoostingClassifier(**HGB_PARAMS).fit(d[FEATURES].to_numpy(np.float64), y)
        return self

    def predict(self, d):
        return self.m.predict_proba(d[FEATURES].to_numpy(np.float64))[:, 1]

    def export(self):
        return export_hgb(self.m)


class EtasRate(BaseModel):
    """log λ = b0 + b1·log(tasa histórica) + b2·término de actividad reciente ponderada."""
    key = "etas"

    def __init__(self, horizon: int):
        self.h = horizon

    def _x(self, d):
        return np.column_stack([np.log(d["rate_hist"].to_numpy(float) * self.h / 30.0 + 1e-3),
                                d["etas_trigger"].to_numpy(float)])

    def fit(self, d, y, c, dv=None, yv=None):
        self.m = PoissonRegressor(alpha=1e-4, max_iter=300).fit(self._x(d), c)
        return self

    def expected(self, d):
        return np.clip(self.m.predict(self._x(d)), 0, 1e4)

    def predict(self, d):
        return clip01(1 - np.exp(-self.expected(d)))

    def export(self):
        return {"coef": self.m.coef_.round(6).tolist(), "intercept": round(float(self.m.intercept_), 6), "eps": 1e-3}


class Hybrid:
    """Combinación logística de las probabilidades de base, ETAS y gradient boosting (ajustada en validación)."""
    key = "hyb"

    def fit(self, pv: dict[str, np.ndarray], yv: np.ndarray):
        X = np.column_stack([logit(pv[k]) for k in ("base", "etas", "hgb")])
        self.m = LogisticRegression(C=10.0, max_iter=400).fit(X, yv)
        return self

    def predict(self, p: dict[str, np.ndarray]):
        X = np.column_stack([logit(p[k]) for k in ("base", "etas", "hgb")])
        return clip01(self.m.predict_proba(X)[:, 1])

    def export(self):
        return {"inputs": ["base", "etas", "hgb"], "coef": self.m.coef_[0].round(6).tolist(),
                "intercept": round(float(self.m.intercept_[0]), 6)}


def export_hgb(m: HistGradientBoostingClassifier) -> dict:
    """Árboles en formato compacto para evaluarlos en el navegador (laboratorio de escenarios)."""
    trees = []
    for it in m._predictors:
        n = it[0].nodes
        trees.append({
            "f": n["feature_idx"].astype(int).tolist(),
            # Un umbral infinito (división «con dato / sin dato») no es JSON válido: se acota.
            "t": [None if l else round(float(np.clip(v, -1e30, 1e30)), 6) for v, l in zip(n["num_threshold"], n["is_leaf"])],
            "l": n["left"].astype(int).tolist(), "r": n["right"].astype(int).tolist(),
            "m": n["missing_go_to_left"].astype(int).tolist(),
            "v": [round(float(v), 6) if l else None for v, l in zip(n["value"], n["is_leaf"])],
        })
    return {"baseline": round(float(np.ravel(m._baseline_prediction)[0]), 6), "trees": trees}


def eval_hgb_export(ex: dict, X: np.ndarray) -> np.ndarray:
    """Evaluador de referencia del formato exportado (misma lógica que el navegador)."""
    out = np.full(len(X), ex["baseline"])
    for t in ex["trees"]:
        for i, row in enumerate(X):
            k = 0
            while t["v"][k] is None:
                x = row[t["f"][k]]
                left = bool(t["m"][k]) if np.isnan(x) else x <= t["t"][k]
                k = t["l"][k] if left else t["r"][k]
            out[i] += t["v"][k]
    return out


# ------------------------------------------------------------------------ métricas

def jeffreys(k: float, n: float, level: float = 0.90) -> tuple[float, float]:
    """Intervalo creíble de Jeffreys para una proporción."""
    a = (1 - level) / 2
    lo = stats.beta.ppf(a, k + 0.5, n - k + 0.5) if k > 0 else 0.0
    hi = stats.beta.ppf(1 - a, k + 0.5, n - k + 0.5) if k < n else 1.0
    return float(lo), float(hi)


def reliability(y: np.ndarray, p: np.ndarray, n_bins: int = 10, min_n: int = 50) -> list[dict]:
    """Curva de fiabilidad por cuantiles (bins fusionados hasta tener ``min_n`` casos)."""
    order = np.argsort(p, kind="stable")
    y, p = y[order], p[order]
    edges = np.unique(np.quantile(p, np.linspace(0, 1, n_bins + 1)))
    idx = np.clip(np.searchsorted(edges, p, side="right") - 1, 0, max(len(edges) - 2, 0))
    bins = []
    for b in np.unique(idx):
        k = idx == b
        bins.append([float(p[k].sum()), float(y[k].sum()), int(k.sum()), float(p[k].min()), float(p[k].max())])
    merged: list[list] = []
    for b in bins:
        if merged and merged[-1][2] < min_n:
            m = merged[-1]
            merged[-1] = [m[0] + b[0], m[1] + b[1], m[2] + b[2], m[3], b[4]]
        else:
            merged.append(b)
    if len(merged) > 1 and merged[-1][2] < min_n:
        b = merged.pop()
        m = merged[-1]
        merged[-1] = [m[0] + b[0], m[1] + b[1], m[2] + b[2], m[3], b[4]]
    out = []
    for sp, sy, n, lo, hi in merged:
        jl, jh = jeffreys(sy, n)
        out.append({"p_mean": sp / n, "observed": sy / n, "n": n, "p_min": lo, "p_max": hi, "lo": jl, "hi": jh})
    return out


def _curve(x: np.ndarray, y: np.ndarray, n: int = 60) -> list[list[float]]:
    if len(x) > n:
        k = np.unique(np.round(np.linspace(0, len(x) - 1, n)).astype(int))
        x, y = x[k], y[k]
    return [[round(float(a), 5), round(float(b), 5)] for a, b in zip(x, y)]


def best_f1_threshold(y: np.ndarray, p: np.ndarray) -> float:
    if y.sum() == 0:
        return 0.5
    pr, rc, th = precision_recall_curve(y, p)
    f1 = 2 * pr[:-1] * rc[:-1] / np.maximum(pr[:-1] + rc[:-1], 1e-12)
    return float(th[int(np.argmax(f1))])


def metrics(y: np.ndarray, p: np.ndarray, thr: float, p_base: np.ndarray | None = None,
            count: np.ndarray | None = None, expected: np.ndarray | None = None) -> dict:
    y = np.asarray(y, dtype=float)
    p = clip01(np.asarray(p, dtype=float))
    n, pos = int(len(y)), int(y.sum())
    out: dict = {"n": n, "positives": pos, "prevalence": pos / max(n, 1), "decision_threshold": float(thr)}
    out["brier"] = float(np.mean((p - y) ** 2))
    ll = y * np.log(p) + (1 - y) * np.log(1 - p)
    out["log_loss"] = float(-ll.mean())
    evaluable = 0 < pos < n
    out["evaluable"] = bool(evaluable and pos >= 5)
    out["pr_auc"] = float(average_precision_score(y, p)) if evaluable else None
    out["roc_auc"] = float(roc_auc_score(y, p)) if evaluable else None
    pred = p >= thr
    tp, fp = int((pred & (y == 1)).sum()), int((pred & (y == 0)).sum())
    fn, tn = int((~pred & (y == 1)).sum()), int((~pred & (y == 0)).sum())
    out["confusion"] = {"tp": tp, "fp": fp, "fn": fn, "tn": tn}
    out["precision"] = tp / (tp + fp) if tp + fp else None
    out["recall"] = tp / (tp + fn) if tp + fn else None
    out["f1"] = 2 * tp / (2 * tp + fp + fn) if 2 * tp + fp + fn else None
    rel = reliability(y, p)
    out["ece"] = float(sum(b["n"] * abs(b["p_mean"] - b["observed"]) for b in rel) / max(n, 1))
    if evaluable:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            cal = LogisticRegression(C=1e6, max_iter=300).fit(logit(p)[:, None], y)
        out["calibration_slope"] = float(cal.coef_[0][0])
        out["calibration_intercept"] = float(cal.intercept_[0])
    else:
        out["calibration_slope"] = out["calibration_intercept"] = None
    if p_base is not None:
        pb = clip01(p_base)
        llb = y * np.log(pb) + (1 - y) * np.log(1 - pb)
        bb = float(np.mean((pb - y) ** 2))
        out["brier_skill"] = float(1 - out["brier"] / bb) if bb > 0 else None
        out["info_gain_bits"] = float((ll.sum() - llb.sum()) / (max(pos, 1) * np.log(2)))
    if count is not None:
        e = expected if expected is not None else -np.log(1 - p)
        out["mae_count"] = float(np.mean(np.abs(np.asarray(e, float) - count)))
    return out


def calibration_status(m: dict) -> str:
    if not m.get("evaluable") or m["positives"] < 30:
        return "sin evaluar"
    slope = m.get("calibration_slope") or 0
    if m["ece"] <= 0.02 and 0.8 <= slope <= 1.25:
        return "calibrado"
    if m["ece"] <= 0.05:
        return "calibración parcial"
    return "no calibrado"


UNC_EDGES = np.array([0, 0.002, 0.005, 0.01, 0.02, 0.035, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.35, 0.5, 0.65, 0.8, 1.0])


def uncertainty_bins(y: np.ndarray, p: np.ndarray, min_n: int = 40) -> list[dict]:
    """Intervalos de incertidumbre empíricos: frecuencia observada (Jeffreys 90 %) por tramo de probabilidad.

    Los tramos tienen bordes fijos, más finos donde se concentran los casos. Un reparto por cuantiles
    dejaría todas las probabilidades altas en un único tramo muy ancho, con un intervalo sin sentido.
    Los tramos con menos de ``min_n`` casos se fusionan con el tramo inferior contiguo.
    """
    idx = np.clip(np.searchsorted(UNC_EDGES, p, side="right") - 1, 0, len(UNC_EDGES) - 2)
    raw = [[float(UNC_EDGES[b + 1]), float(y[idx == b].sum()), int((idx == b).sum())] for b in range(len(UNC_EDGES) - 1)]
    merged: list[list] = []
    for hi, k, n in raw:
        if n == 0 and merged:
            merged[-1][0] = hi
        elif merged and (n < min_n or merged[-1][2] < min_n):
            merged[-1] = [hi, merged[-1][1] + k, merged[-1][2] + n]
        else:
            merged.append([hi, k, n])
    out = []
    for hi, k, n in merged:
        lo_, hi_ = jeffreys(k, n) if n else (0.0, 1.0)
        out.append({"p_max": round(hi, 6), "lo": round(lo_, 5), "hi": round(hi_, 5),
                    "observed": round(k / n, 5) if n else None, "n": n})
    return out


def interval_from_bins(bins: list[dict], p: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    edges = np.array([b["p_max"] for b in bins])
    i = np.clip(np.searchsorted(edges, p, side="left"), 0, len(bins) - 1)
    lo = np.array([b["lo"] for b in bins])[i]
    hi = np.array([b["hi"] for b in bins])[i]
    return np.minimum(lo, p), np.maximum(hi, p)
