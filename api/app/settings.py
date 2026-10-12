"""Configuración de la API por variables de entorno (prefijo SISMONEXO_). Ver .env.example."""
from __future__ import annotations

from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="SISMONEXO_", env_file=".env", extra="ignore")

    data_dir: Path = ROOT / "data" / "processed"
    web_data_dir: Path = ROOT / "web" / "public" / "data"
    cors_origins: str = "http://localhost:5173,http://localhost:4173,http://127.0.0.1:5173"
    rate_limit_per_minute: int = 120
    max_upload_bytes: int = 15 * 1024 * 1024
    max_page_size: int = 1000
    log_level: str = "INFO"
    # Arquitectura objetivo: si se define, los scripts de carga escriben en PostGIS. La API del prototipo
    # sirve los mismos datos desde los artefactos en disco y no necesita la base para funcionar.
    database_url: str | None = None


settings = Settings()
