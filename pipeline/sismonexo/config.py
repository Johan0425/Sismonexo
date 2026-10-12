"""Configuración central del pipeline de SismoNexo Colombia.

Todas las rutas son relativas a la raíz del repositorio para que el pipeline
sea reproducible en cualquier máquina.
"""
from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(os.environ.get("SISMONEXO_ROOT", Path(__file__).resolve().parents[2]))
DATA = ROOT / "data"
RAW = DATA / "raw"
INTERIM = DATA / "interim"
PROCESSED = DATA / "processed"
WEB_DATA = ROOT / "web" / "public" / "data"

# Ventana geográfica de estudio (WGS84). Cubre Colombia continental, el
# archipiélago de San Andrés y las zonas fronterizas y marítimas vecinas.
BBOX = {"lon_min": -83.0, "lon_max": -66.0, "lat_min": -5.0, "lat_max": 14.0}

# Magnitud mínima de ingesta del catálogo instrumental de la RSNC.
MIN_MAGNITUDE = float(os.environ.get("SISMONEXO_MIN_MAG", "2.5"))

# Fechas de corte documentadas por el SGC en la página del catálogo.
SEISAN_START = "1993-06-01"
SEISAN_END = "2018-02-28"
SEISCOMP_START = "2018-03-01"

USER_AGENT = (
    "SismoNexo-Colombia/0.1 (proyecto academico; Institucion Universitaria EAM; "
    "consulta de baja frecuencia)"
)
# Pausa entre solicitudes a servidores del SGC y del DANE, en segundos.
REQUEST_PAUSE_S = float(os.environ.get("SISMONEXO_PAUSE", "1.5"))

SOURCES = {
    "rsnc_seisan": {
        "name": "Catálogo de sismicidad RSNC (SEISAN), 1993-06-01 a 2018-02-28",
        "publisher": "Servicio Geológico Colombiano (SGC) — Red Sismológica Nacional de Colombia",
        "url": "https://bdrsnc.sgc.gov.co/paginas1/catalogo/Consulta_Experta/consultaexperta_2.php",
        "landing": "https://bdrsnc.sgc.gov.co/paginas1/catalogo/index.php",
    },
    "rsnc_seiscomp": {
        "name": "Catálogo de sismicidad RSNC (SeisComP3), 2018-03-01 a la fecha",
        "publisher": "Servicio Geológico Colombiano (SGC) — Red Sismológica Nacional de Colombia",
        "url": "https://bdrsnc.sgc.gov.co/paginas1/catalogo/Consulta_Experta_Seiscomp/consultaexperta.php",
        "landing": "https://bdrsnc.sgc.gov.co/paginas1/catalogo/index.php",
    },
    "csi": {
        "name": "Catálogo Sísmico Integrado (CSI) para Colombia",
        "publisher": "Servicio Geológico Colombiano (SGC)",
        "url": "https://catalogosismico.sgc.gov.co/visor/",
        "landing": "https://revistas.sgc.gov.co/index.php/boletingeo/article/view/665",
    },
    "dane_mgn": {
        "name": "División Político-Administrativa — Marco Geoestadístico Nacional 2025",
        "publisher": "Departamento Administrativo Nacional de Estadística (DANE)",
        "url": "https://geoportal.dane.gov.co/mparcgis/rest/services/Divipola/Serv_DIVIPOLA_MGN_2025/FeatureServer",
        "landing": "https://geoportal.dane.gov.co/servicios/descarga-y-metadatos/datos-geoestadisticos/",
    },
}


def ensure_dirs() -> None:
    for p in (RAW, INTERIM, PROCESSED, WEB_DATA):
        p.mkdir(parents=True, exist_ok=True)
