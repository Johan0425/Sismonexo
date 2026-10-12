"""Pruebas de la API sobre los artefactos reales."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app import store
from app.main import app, _hits
from app.settings import settings

pytestmark = pytest.mark.skipif(
    not (settings.web_data_dir / "index.json").exists() or not (settings.data_dir / "events.parquet").exists(),
    reason="Ejecute primero el pipeline (se necesitan el catálogo limpio y los artefactos).",
)
client = TestClient(app)


@pytest.fixture(autouse=True)
def _sin_limite():
    _hits.clear()


def test_eventos_con_filtros_paginacion_y_trazabilidad():
    r = client.get("/api/events", params={"mag_min": 5, "desde": "2020-01-01", "hasta": "2024-12-31", "limite": 5, "orden": "-magnitud"})
    assert r.status_code == 200 and r.headers["X-Request-ID"]
    body = r.json()
    assert body["meta"]["version_datos"] == store.index()["dataset_version"]
    assert "No constituye una alerta oficial" in body["meta"]["advertencia"]
    assert body["meta"]["paginacion"]["limite"] == 5 and len(body["datos"]) == 5
    mags = [e["magnitude"] for e in body["datos"]]
    assert mags == sorted(mags, reverse=True) and min(mags) >= 5
    assert all(e["event_datetime_utc"].endswith("Z") and "2020" <= e["event_datetime_utc"][:4] <= "2024" for e in body["datos"])
    assert set(body["datos"][0]) >= {"event_id", "latitude", "longitude", "depth_km", "magnitude_type", "source_url", "dataset_version"}


def test_eventos_en_geojson_wgs84():
    r = client.get("/api/events", params={"departamento": "68", "mag_min": 4.5, "formato": "geojson", "limite": 3}).json()
    assert r["type"] == "FeatureCollection" and len(r["features"]) == 3
    lon, lat = r["features"][0]["geometry"]["coordinates"]
    assert -75 < lon < -72 and 5 < lat < 9
    assert r["features"][0]["properties"]["department"] == "Santander"


def test_evento_por_identificador_y_no_encontrado():
    eid = client.get("/api/events", params={"limite": 1}).json()["datos"][0]["event_id"]
    assert client.get(f"/api/events/{eid}").json()["datos"]["event_id"] == eid
    r = client.get("/api/events/no-existe")
    assert r.status_code == 404 and r.json()["error"]["codigo"] == "no_encontrado"


@pytest.mark.parametrize("params", [{"mag_min": 11}, {"desde": "2024-13-01"}, {"desde": "2025-01-01", "hasta": "2024-01-01"}, {"bbox": "1,2,3"},
                                    {"departamento": "Santander"}, {"limite": 100000}, {"formato": "xml"}])
def test_validacion_de_parametros(params):
    assert client.get("/api/events", params=params).status_code == 422


def test_resumen_y_linea_de_tiempo():
    s = client.get("/api/events/summary", params={"mag_min": 4}).json()["datos"]
    assert s["eventos"] > 1000 and s["magnitud_maxima"] >= 7 and s["evento_mayor"]["magnitude"] == s["magnitud_maxima"]
    t = client.get("/api/timeline", params={"intervalo": "anio", "mag_min": 4}).json()["datos"]
    assert sum(x["eventos"] for x in t) == s["eventos"] and t[0]["inicio"].startswith("1993")
    assert client.get("/api/timeline", params={"intervalo": "dia"}).status_code == 422


def test_zonas():
    z = client.get("/api/zones", params={"unidad": "dep"}).json()
    assert z["meta"]["paginacion"]["total"] == 33
    one = client.get("/api/zones/68", params={"unidad": "dep"}).json()["datos"]
    assert one["zone_name"] == "Santander" and one["actividad_observada"]["eventos"] > 10000
    assert client.get("/api/zones/00", params={"unidad": "dep"}).status_code == 404


def test_pronosticos_con_incertidumbre_y_version():
    r = client.get("/api/forecasts", params={"unidad": "g50", "horizonte": 30, "umbral": 4.0, "limite": 10}).json()
    assert "terremoto ocurrirá con certeza" in r["meta"]["nota"] and r["meta"]["version_modelo"].startswith("sn-g50-h30-m40")
    ps = [f["probability"] for f in r["datos"]]
    assert ps == sorted(ps, reverse=True)
    for f in r["datos"]:
        assert 0 < f["uncertainty_low"] <= f["probability"] <= f["uncertainty_high"] < 1
        assert f["forecast_start"] < f["forecast_end"] and f["calibration_status"] and f["model_version"] and f["dataset_version"]
    zone = r["datos"][0]["zone_id"]
    d = client.get(f"/api/forecasts/{zone}", params={"unidad": "g50"}).json()["datos"]
    assert "base" in {p["model_name"] for p in d["pronosticos"]}, "siempre se incluye la línea base"
    assert "no demuestra causalidad" in d["explicacion"]["aviso"] and len(d["explicacion"]["periodos_similares"]) == 3
    assert client.get("/api/forecasts", params={"horizonte": 45}).status_code == 404
    assert client.get("/api/forecasts", params={"modelo": "inexistente"}).status_code == 404


def test_modelos_metricas_y_validacion_cronologica():
    exps = client.get("/api/models", params={"horizonte": 30}).json()["datos"]["experimentos"]
    assert len(exps) == 15
    m = client.get("/api/models/g50-30-40/metrics").json()["datos"]
    assert "base" in m["modelos"] and m["modelo_por_defecto"] in m["modelos"]
    for f in m["particiones"]:
        assert f["train"][1] < f["val"][0] < f["val"][1] < f["test"][0] and f["gap_days"] == 30
    assert [x["status"] for x in m["deteccion_de_fugas"]].count("falla") == 0 and len(m["deteccion_de_fugas"]) == 6
    assert client.get("/api/models/../../etc/passwd/metrics").status_code == 404
    assert client.get("/api/models/g50-45-40/metrics").status_code == 404


def test_calidad_y_fuentes():
    q = client.get("/api/data-quality").json()["datos"]
    assert q["totales"]["records"] == store.index()["records"] and len(q["auditoria"]) >= 10
    s = client.get("/api/sources").json()["datos"]
    for src in s["fuentes"]:
        assert {"url", "consulted_at", "coverage", "records", "license", "processing", "removed_variables", "dropped", "dataset_version"} <= set(src)
    assert s["capas_oficiales"]["faults"]["available"] is False


def test_importacion_valida_sin_almacenar():
    csv = "fecha_hora_utc,latitud,longitud,magnitud\n2024-05-01T10:20:30Z,6.8,-73.1,4.1\n2024-05-01T10:20:30Z,6.8,-73.1,4.1\nmal,6,-73,3\n2024-05-02T00:00:00Z,48.8,2.3,3\n"
    r = client.post("/api/import", files={"archivo": ("prueba.csv", csv, "text/csv")})
    d = r.json()["datos"]
    assert r.status_code == 200 and d["filas_leidas"] == 4 and d["filas_aceptadas"] == 1
    assert {p["regla"] for p in d["problemas"]} == {"Fecha ilegible o futura", "Fuera de la ventana de estudio", "Registro duplicado"}
    assert client.post("/api/import", files={"archivo": ("x.exe", b"MZ\x00\x00", "application/octet-stream")}).status_code == 422
    assert client.post("/api/import", files={"archivo": ("x.csv", b"a,b\n1,2\n", "text/csv")}).status_code == 422
    assert client.post("/api/import", files={"archivo": ("g.csv", b"x" * (settings.max_upload_bytes + 10), "text/csv")}).status_code == 413


def test_escenario_hipotetico_coincide_con_el_pronostico_real():
    f = client.get("/api/forecasts", params={"unidad": "dep", "limite": 1, "modelo": "pois"}).json()["datos"][0]
    r = client.post("/api/scenarios", json={"unidad": "dep", "zone_id": f["zone_id"], "cambios": {}}).json()["datos"]
    assert r["aviso"].startswith("Escenario hipotético")
    assert r["real"]["pois"] == pytest.approx(f["probability"], abs=0.02)
    assert r["real"] == r["hipotetico"]
    r2 = client.post("/api/scenarios", json={"unidad": "dep", "zone_id": f["zone_id"], "cambios": {"n_30": 500}}).json()["datos"]
    assert r2["advertencias"] and "fuera del rango histórico" in r2["advertencias"][0]
    assert client.post("/api/scenarios", json={"unidad": "dep", "zone_id": f["zone_id"], "cambios": {"n_30": 1e9}}).status_code == 422
    assert client.post("/api/scenarios", json={"unidad": "dep", "zone_id": f["zone_id"], "cambios": {"y": 1}}).status_code == 422


def test_informes_y_asistente():
    rep = client.post("/api/reports", json={"tipo": "probabilistico"}).json()
    assert rep["datos"]["autor"] == "Johan Antonio Peña López" and rep["datos"]["institucion"] == "Institución Universitaria EAM"
    assert len(rep["datos"]["tabla"]) == 25 and rep["datos"]["limitaciones"] and rep["meta"]["version_modelo"]
    assert client.post("/api/reports", json={"tipo": "zona"}).status_code == 422
    a = client.post("/api/assistant/query", json={"consulta": "Muéstrame los eventos de magnitud mayor a 4 en Santander durante 2024"}).json()["datos"]
    assert a["intencion"] == "filtrar" and a["filtros"]["departamento"] == "68" and a["eventos"] > 0 and len(a["filtros_aplicados"]) == 3
    assert client.post("/api/assistant/query", json={"consulta": "¿Va a temblar mañana?"}).json()["datos"]["intencion"] == "sin_alerta"
    assert client.post("/api/assistant/query", json={"consulta": "¿Quién ganó el partido?"}).json()["datos"]["intencion"] == "desconocida"
    assert client.post("/api/assistant/query", json={"consulta": "x" * 301}).status_code == 422


def test_limite_de_solicitudes(monkeypatch):
    monkeypatch.setattr(settings, "rate_limit_per_minute", 3)
    codes = [client.get("/api/health").status_code for _ in range(5)]
    assert codes == [200, 200, 200, 429, 429]


def test_openapi_documenta_todos_los_endpoints():
    paths = set(client.get("/openapi.json").json()["paths"])
    assert {"/api/events", "/api/events/{event_id}", "/api/events/summary", "/api/zones", "/api/zones/{zone_id}", "/api/forecasts",
            "/api/forecasts/{zone_id}", "/api/models", "/api/models/{experimento}/metrics", "/api/data-quality", "/api/timeline",
            "/api/sources", "/api/import", "/api/scenarios", "/api/reports", "/api/assistant/query"} <= paths
