"""Orquestador: entrena y valida todas las configuraciones y exporta los pronósticos.

Uso::

    python -m sismonexo.run_all                 # todas las configuraciones
    python -m sismonexo.run_all --rapido        # solo las configuraciones principales (30 días)
    python -m sismonexo.run_all --solo g50-30-40

Cada configuración escribe ``web/public/data/fc/<unidad>-<horizonte>-<umbral×10>.json`` y una fila
por modelo en ``data/processed/forecasts.parquet`` y ``data/processed/experiments.json``.
"""
from __future__ import annotations

import argparse
import json
import multiprocessing as mp
import sys
import time
import traceback

import numpy as np
import pandas as pd

from . import config, export_web, zones
from . import modeling as M

UNITS = ["dep", "g50", "h3", "mun", "g25"]
HORIZONS = [30, 7, 90]
THRESHOLDS = [4.0, 3.0, 5.0]
MAIN = {"horizon": 30, "threshold": 4.0}   # configuraciones con comparación completa (incluye Random Forest)


def config_id(unit: str, horizon: int, threshold: float) -> str:
    return f"{unit}-{horizon}-{int(round(threshold * 10))}"


def all_configs(quick: bool = False) -> list[tuple[str, int, float]]:
    out = [(u, h, t) for h in HORIZONS for t in THRESHOLDS for u in UNITS]
    return [c for c in out if c[1] == 30] if quick else out


_EA = None
_VERSION = ""


def _init() -> None:
    global _EA, _VERSION
    from .features import EventArrays, load_events
    ev = load_events()
    _VERSION = str(ev["dataset_version"].iloc[0])
    _EA = EventArrays.from_frame(ev)


def _run(cfg: tuple[str, int, float]) -> dict:
    from . import experiment
    unit, horizon, threshold = cfg
    cid = config_id(*cfg)
    t0 = time.perf_counter()
    try:
        full = horizon == MAIN["horizon"] and threshold == MAIN["threshold"]
        r = experiment.run_config(_EA, unit, horizon, threshold, full=full, dataset_version=_VERSION)
        frames = r.pop("_frames")
        # Intervalos de incertidumbre del pronóstico vigente a partir de la frecuencia observada por tramo.
        lo, hi = {}, {}
        for k, p in frames["p_now"].items():
            a, b = M.interval_from_bins(r["models"][k]["uncertainty_bins"], np.asarray(p))
            lo[k], hi[k] = [round(float(v), 5) for v in a], [round(float(v), 5) for v in b]
        r["forecast"]["lo"], r["forecast"]["hi"] = lo, hi
        r["id"] = cid
        export_web._write(f"fc/{cid}.json", r)
        f = r["forecast"]
        rows = []
        for k, p in f["p"].items():
            exp = f["expected"].get(k)
            for i, z in enumerate(f["zone_ids"]):
                rows.append({
                    "forecast_id": f"{cid}-{k}-{z}", "zone_id": z, "generated_at": f["generated_at"],
                    "forecast_start": f["forecast_start"], "forecast_end": f["forecast_end"],
                    "magnitude_threshold": threshold, "probability": p[i],
                    "expected_count": exp[i] if exp else None, "uncertainty_low": lo[k][i], "uncertainty_high": hi[k][i],
                    "calibration_status": r["models"][k]["calibration_status"], "model_name": k,
                    "model_version": r["config"]["model_version"], "dataset_version": _VERSION,
                    "zone_type": unit, "horizon_days": horizon,
                })
        exps = [{
            "experiment_id": f"{cid}-{k}-fold{fr['fold']}", "model_name": k,
            "training_start": fr["train"][0], "training_end": fr["train"][1],
            "validation_start": fr["val"][0], "validation_end": fr["val"][1],
            "test_start": fr["test"][0], "test_end": fr["test"][1],
            "parameters": {"unit": unit, "horizon_days": horizon, "threshold": threshold, "gap_days": fr["gap_days"]},
            "metrics": fr["models"][k], "artifact_uri": f"web/public/data/fc/{cid}.json",
            "created_at": f["generated_at"],
        } for fr in r["folds"] for k in fr["models"]]
        return {"id": cid, "ok": True, "seconds": round(time.perf_counter() - t0, 1), "selected": r["selected_model"],
                "forecasts": rows, "experiments": exps}
    except Exception as exc:  # una configuración inviable no debe detener a las demás
        return {"id": cid, "ok": False, "seconds": round(time.perf_counter() - t0, 1),
                "error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()}


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--rapido", action="store_true", help="solo horizonte de 30 días")
    ap.add_argument("--solo", nargs="*", help="identificadores de configuración, p. ej. g50-30-40")
    ap.add_argument("--procesos", type=int, default=3)
    args = ap.parse_args(argv)
    config.ensure_dirs()
    cfgs = all_configs(args.rapido)
    if args.solo:
        cfgs = [c for c in cfgs if config_id(*c) in set(args.solo)]
    for u in UNITS:
        zones.build(u)
    print(f"{len(cfgs)} configuraciones · {args.procesos} procesos", flush=True)
    forecasts, experiments, failed = [], [], []
    with mp.get_context("spawn").Pool(args.procesos, initializer=_init, maxtasksperchild=4) as pool:
        for i, r in enumerate(pool.imap_unordered(_run, cfgs), 1):
            if r["ok"]:
                forecasts += r.pop("forecasts")
                experiments += r.pop("experiments")
                print(f"[{i}/{len(cfgs)}] {r['id']} · {r['seconds']} s · modelo por defecto: {r['selected']}", flush=True)
            else:
                failed.append(r)
                print(f"[{i}/{len(cfgs)}] {r['id']} · FALLÓ · {r['error']}", flush=True)
    if forecasts:
        new_f, new_e = pd.DataFrame(forecasts), experiments
        fpath, epath = config.PROCESSED / "forecasts.parquet", config.PROCESSED / "experiments.json"
        if args.solo and fpath.exists():
            ids = {config_id(*c) for c in cfgs}
            old = pd.read_parquet(fpath)
            keep = ~old["forecast_id"].str.rsplit("-", n=2).str[0].isin(ids)
            new_f = pd.concat([old[keep], new_f], ignore_index=True)
            old_e = json.loads(epath.read_text(encoding="utf-8"))
            new_e = [e for e in old_e if e["experiment_id"].rsplit("-", 2)[0] not in ids] + experiments
        new_f.to_parquet(fpath, index=False)
        epath.write_text(json.dumps(new_e, ensure_ascii=False), encoding="utf-8")
    (config.PROCESSED / "run_failures.json").write_text(json.dumps(failed, ensure_ascii=False, indent=1), encoding="utf-8")
    export_web.main()
    print(f"Listo: {len(cfgs) - len(failed)} correctas, {len(failed)} fallidas", flush=True)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
