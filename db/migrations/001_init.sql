-- SismoNexo Colombia · esquema de la arquitectura objetivo (PostgreSQL + PostGIS).
-- Cinco tablas del modelo de datos. Coordenadas en WGS84 (EPSG:4326); fechas en UTC.
-- Se aplica automáticamente al crear el contenedor (docker-entrypoint-initdb.d) o con:
--   psql "$SISMONEXO_DATABASE_URL" -f db/migrations/001_init.sql

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS schema_migrations (
    version     text PRIMARY KEY,
    applied_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seismic_events (
    event_id              text PRIMARY KEY,
    event_datetime_utc    timestamptz NOT NULL,
    latitude              double precision NOT NULL CHECK (latitude BETWEEN -90 AND 90),
    longitude             double precision NOT NULL CHECK (longitude BETWEEN -180 AND 180),
    depth_km              double precision CHECK (depth_km IS NULL OR depth_km >= 0),
    magnitude             double precision NOT NULL,
    magnitude_type        text NOT NULL,
    municipality          text NOT NULL DEFAULT '',
    department            text NOT NULL DEFAULT '',
    location_description  text NOT NULL DEFAULT '',
    source                text NOT NULL,
    source_url            text NOT NULL,
    reviewed              boolean NOT NULL,
    location_error_km     double precision,
    magnitude_error       double precision,
    quality_code          char(1) NOT NULL CHECK (quality_code IN ('A', 'B', 'C', 'D', 'N')),
    imported_at           timestamptz NOT NULL,
    dataset_version       text NOT NULL,
    geom                  geometry(Point, 4326) GENERATED ALWAYS AS (ST_SetSRID(ST_MakePoint(longitude, latitude), 4326)) STORED
);
CREATE INDEX IF NOT EXISTS seismic_events_time_idx ON seismic_events (event_datetime_utc);
CREATE INDEX IF NOT EXISTS seismic_events_mag_idx ON seismic_events (magnitude);
CREATE INDEX IF NOT EXISTS seismic_events_geom_idx ON seismic_events USING gist (geom);

CREATE TABLE IF NOT EXISTS zones (
    zone_id       text NOT NULL,
    zone_type     text NOT NULL CHECK (zone_type IN ('dep', 'mun', 'h3', 'g50', 'g25')),
    zone_name     text NOT NULL,
    geometry      geometry(MultiPolygon, 4326),
    department    text NOT NULL DEFAULT '',
    municipality  text NOT NULL DEFAULT '',
    resolution    text NOT NULL,
    area_km2      double precision NOT NULL CHECK (area_km2 > 0),
    PRIMARY KEY (zone_type, zone_id)
);
CREATE INDEX IF NOT EXISTS zones_geom_idx ON zones USING gist (geometry);

CREATE TABLE IF NOT EXISTS zone_period_features (
    zone_type                    text NOT NULL,
    zone_id                      text NOT NULL,
    period_start                 date NOT NULL,
    period_end                   date NOT NULL,
    magnitude_threshold          double precision NOT NULL,
    event_count                  integer,              -- NULL en el periodo vigente (aún sin observar)
    recent_event_count           integer NOT NULL,
    mean_magnitude               double precision,
    max_magnitude                double precision,
    accumulated_magnitude        double precision,
    mean_depth                   double precision,
    median_depth                 double precision,
    time_since_last_event        double precision NOT NULL,
    distance_to_previous_event   double precision NOT NULL,
    historical_rate              double precision NOT NULL,
    seasonal_features            jsonb NOT NULL,       -- {"sin": …, "cos": …}
    data_quality_score           double precision,
    PRIMARY KEY (zone_type, zone_id, period_start, period_end, magnitude_threshold),
    FOREIGN KEY (zone_type, zone_id) REFERENCES zones (zone_type, zone_id),
    CHECK (period_end > period_start)
);

CREATE TABLE IF NOT EXISTS forecasts (
    forecast_id          text PRIMARY KEY,
    zone_type            text NOT NULL,
    zone_id              text NOT NULL,
    generated_at         timestamptz NOT NULL,
    forecast_start       date NOT NULL,
    forecast_end         date NOT NULL,
    magnitude_threshold  double precision NOT NULL,
    probability          double precision NOT NULL CHECK (probability > 0 AND probability < 1),
    expected_count       double precision,
    uncertainty_low      double precision NOT NULL,
    uncertainty_high     double precision NOT NULL,
    calibration_status   text NOT NULL,
    model_name           text NOT NULL,
    model_version        text NOT NULL,
    dataset_version      text NOT NULL,
    FOREIGN KEY (zone_type, zone_id) REFERENCES zones (zone_type, zone_id),
    CHECK (uncertainty_low <= probability AND probability <= uncertainty_high),
    CHECK (forecast_end > forecast_start)
);
CREATE INDEX IF NOT EXISTS forecasts_zone_idx ON forecasts (zone_type, zone_id, forecast_start);

CREATE TABLE IF NOT EXISTS experiments (
    experiment_id     text PRIMARY KEY,
    model_name        text NOT NULL,
    training_start    date NOT NULL,
    training_end      date NOT NULL,
    validation_start  date NOT NULL,
    validation_end    date NOT NULL,
    test_start        date NOT NULL,
    test_end          date NOT NULL,
    parameters        jsonb NOT NULL,
    metrics           jsonb NOT NULL,
    artifact_uri      text NOT NULL,
    created_at        timestamptz NOT NULL,
    -- La validación siempre es cronológica: entrenamiento < validación < prueba.
    CHECK (training_end < validation_start AND validation_end < test_start)
);

INSERT INTO schema_migrations (version) VALUES ('001_init') ON CONFLICT DO NOTHING;
