// Mapa base de Colombia con MapLibre GL JS (carga diferida). El estilo es propio y autocontenido:
// límites oficiales del DANE sobre un fondo neutro, sin depender de teselas externas.
import type { GeoJSONSource, Map as MLMap, MapMouseEvent, StyleSpecification } from 'maplibre-gl'
import { Box, Compass, LocateFixed, Maximize, Minus, Plus } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { toggleFullscreen } from '@/components/Palette'
import { useTheme } from '@/components/Shell'
import { ErrorState, Skeleton, Tooltip, useMotionOk } from '@/components/ui'
import { mapBus } from '@/lib/bus'
import { loadGeo, loadIndex, loadZones, type IndexData } from '@/lib/data'
import { BBOX, COLOMBIA_BOUNDS } from '@/lib/geo'
import { DEFAULT_VIEW, useApp } from '@/lib/store'

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
export const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] }

function graticule(): GeoJSON.FeatureCollection {
  const f: GeoJSON.Feature[] = []
  for (let lon = -84; lon <= -64; lon += 2) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[lon, -8], [lon, 16]] } })
  for (let lat = -8; lat <= 16; lat += 2) f.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: [[-86, lat], [-62, lat]] } })
  return { type: 'FeatureCollection', features: f }
}
const studyWindow: GeoJSON.Feature = {
  type: 'Feature',
  properties: {},
  geometry: { type: 'LineString', coordinates: [[BBOX.lon_min, BBOX.lat_min], [BBOX.lon_max, BBOX.lat_min], [BBOX.lon_max, BBOX.lat_max], [BBOX.lon_min, BBOX.lat_max], [BBOX.lon_min, BBOX.lat_min]] },
}

function baseStyle(): StyleSpecification {
  return {
    version: 8,
    sources: {
      graticule: { type: 'geojson', data: graticule() },
      window: { type: 'geojson', data: studyWindow },
      dep: { type: 'geojson', data: EMPTY_FC },
      mun: { type: 'geojson', data: EMPTY_FC },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': css('--map-water') } },
      { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': css('--map-graticule'), 'line-width': 1 } },
      { id: 'window', type: 'line', source: 'window', paint: { 'line-color': css('--map-line-soft'), 'line-width': 1, 'line-dasharray': [4, 4] } },
      { id: 'dep-fill', type: 'fill', source: 'dep', paint: { 'fill-color': css('--map-land-co') } },
      // Ancla de orden: las capas temáticas se insertan debajo de los límites.
      { id: 'anchor-data', type: 'background', layout: { visibility: 'none' }, paint: {} },
      { id: 'mun-line', type: 'line', source: 'mun', minzoom: 6.5, layout: { visibility: 'none' }, paint: { 'line-color': css('--map-line-soft'), 'line-width': 0.6 } },
      { id: 'dep-line', type: 'line', source: 'dep', paint: { 'line-color': css('--map-line'), 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.6, 9, 1.6] } },
      { id: 'anchor-top', type: 'background', layout: { visibility: 'none' }, paint: {} },
    ],
  }
}
function applyTheme(map: MLMap) {
  if (!map.getLayer('bg')) return
  map.setPaintProperty('bg', 'background-color', css('--map-water'))
  map.setPaintProperty('graticule', 'line-color', css('--map-graticule'))
  map.setPaintProperty('window', 'line-color', css('--map-line-soft'))
  map.setPaintProperty('dep-fill', 'fill-color', css('--map-land-co'))
  map.setPaintProperty('dep-line', 'line-color', css('--map-line'))
  map.setPaintProperty('mun-line', 'line-color', css('--map-line-soft'))
}

const TERRAIN_TILES = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'
const hazardTiles = (service: string) => `${service}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&format=png32&transparent=true&layers=show:10&f=image`

/** Capas opcionales: municipios, amenaza oficial (SGC), relieve y mapa de referencia. */
function applyOverlays(map: MLMap, overlays: string[], index: IndexData | null, loadMun: () => void) {
  const vis = (id: string, on: boolean) => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none')
  vis('dep-line', overlays.includes('dep'))
  vis('mun-line', overlays.includes('mun'))
  if (overlays.includes('mun')) loadMun()
  const raster = (id: string, on: boolean, tiles: string, attribution: string, opacity: number, before: string) => {
    if (on && !map.getSource(id)) {
      map.addSource(id, { type: 'raster', tiles: [tiles], tileSize: 256, attribution, maxzoom: 12 })
      map.addLayer({ id, type: 'raster', source: id, paint: { 'raster-opacity': opacity, 'raster-fade-duration': 200 } }, before)
    }
    vis(id, on)
  }
  raster('osm', overlays.includes('osm'), 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', '© Colaboradores de OpenStreetMap (ODbL)', 0.85, 'dep-fill')
  if (map.getLayer('dep-fill')) map.setPaintProperty('dep-fill', 'fill-opacity', overlays.includes('osm') ? 0 : 1)
  if (index?.official_layers.hazard.available)
    raster('amenaza', overlays.includes('amenaza'), hazardTiles(index.official_layers.hazard.service), 'Amenaza sísmica: Servicio Geológico Colombiano y Universidad Nacional de Colombia', 0.7, 'anchor-data')
  const relief = overlays.includes('relieve')
  if (relief && !map.getSource('dem')) {
    map.addSource('dem', { type: 'raster-dem', tiles: [TERRAIN_TILES], tileSize: 256, encoding: 'terrarium', maxzoom: 11, attribution: 'Relieve: Mapzen Terrain Tiles (AWS Open Data; SRTM, GMTED y otros)' })
    map.addLayer({ id: 'hillshade', type: 'hillshade', source: 'dem', paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': 'rgba(20,30,40,0.5)' } }, 'anchor-data')
  }
  vis('hillshade', relief)
  try {
    map.setTerrain(relief && map.getPitch() > 5 ? { source: 'dem', exaggeration: 1.4 } : null)
  } catch {
    /* el relieve es opcional */
  }
}

interface Props {
  /** Se llama cuando el mapa y su estilo están listos. */
  onMap: (map: MLMap | null) => void
  children?: ReactNode
  label: string
  onClick?: (e: MapMouseEvent, map: MLMap) => void
  /** Selección por teclado: Enter con el mapa enfocado elige lo que esté bajo la mira central. */
  onPickCenter?: (map: MLMap) => void
  labels?: boolean
  syncView?: boolean
}

export function MapView({ onMap, children, label, onClick, onPickCenter, labels = true, syncView = true }: Props) {
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [focused, setFocused] = useState(false)
  const [pitched, setPitched] = useState(false)
  const [bearing, setBearing] = useState(0)
  const [attempt, setAttempt] = useState(0)
  const theme = useTheme()
  const overlays = useApp((s) => s.atlas.overlays)
  const motionOk = useMotionOk()
  const cb = useRef({ onClick, onPickCenter, onMap, motionOk })
  cb.current = { onClick, onPickCenter, onMap, motionOk }
  const indexRef = useRef<IndexData | null>(null)

  useEffect(() => {
    let dead = false
    let map: MLMap | null = null
    let unsub = () => {}
    ;(async () => {
      try {
        const [ml, dep, worker] = await Promise.all([import('maplibre-gl'), loadGeo('dep'), import('maplibre-gl/dist/maplibre-gl-worker.mjs?url'), import('maplibre-gl/dist/maplibre-gl.css')])
        if (dead || !box.current) return
        // MapLibre 6 busca su worker junto a su propio módulo; al empaquetar hay que indicarle la URL final.
        ml.setWorkerUrl(new URL(worker.default, window.location.href).href)
        const v = useApp.getState().view
        map = new ml.Map({
          container: box.current,
          style: baseStyle(),
          center: [v.lon, v.lat],
          zoom: v.zoom,
          bearing: v.bearing,
          pitch: v.pitch,
          minZoom: 3.2,
          maxZoom: 13,
          maxPitch: 70,
          maxBounds: [[-100, -18], [-50, 26]],
          attributionControl: { compact: true, customAttribution: 'Límites: DANE, MGN 2025 · Eventos: SGC–RSNC' },
          dragRotate: true,
          canvasContextAttributes: { preserveDrawingBuffer: true },
        })
        mapRef.current = map
        const m = map
        m.getCanvas().setAttribute('aria-label', `${label}. Use las flechas para desplazar, más y menos para acercar, cero para volver a la extensión nacional${onPickCenter ? ' y Enter para seleccionar lo que esté en el centro' : ''}.`)
        m.getCanvas().setAttribute('role', 'application')
        m.on('load', () => {
          if (dead) return
          ;(m.getSource('dep') as GeoJSONSource).setData(dep)
          void loadIndex().then((i) => {
            indexRef.current = i
            if (!dead) applyOverlays(m, useApp.getState().atlas.overlays, i, loadMun)
          })
          if (v === DEFAULT_VIEW) m.fitBounds(COLOMBIA_BOUNDS, { padding: 40, animate: false })
          setReady(true)
          cb.current.onMap(m)
        })
        m.on('error', (e) => {
          // Una tesela externa opcional que falla no debe romper el mapa.
          if (import.meta.env.DEV) console.warn('MapLibre:', e.error?.message)
        })
        m.on('click', (e) => cb.current.onClick?.(e, m))
        m.on('moveend', () => {
          const c = m.getCenter()
          setPitched(m.getPitch() > 5)
          setBearing(m.getBearing())
          if (syncView) useApp.getState().setView({ lon: c.lng, lat: c.lat, zoom: m.getZoom(), bearing: m.getBearing(), pitch: m.getPitch() })
        })
        const go = (opts: { center: [number, number]; zoom: number }) => (cb.current.motionOk ? m.flyTo({ ...opts, duration: 900, essential: false }) : m.jumpTo(opts))
        unsub = mapBus.subscribe((c) => {
          if (c.type === 'home') cb.current.motionOk ? m.fitBounds(COLOMBIA_BOUNDS, { padding: 40, duration: 700, bearing: 0, pitch: 0 }) : m.fitBounds(COLOMBIA_BOUNDS, { padding: 40, animate: false, bearing: 0, pitch: 0 })
          else if (c.type === 'fit') m.fitBounds(c.bounds, { padding: 60, maxZoom: 9, animate: cb.current.motionOk, duration: 800 })
          else go({ center: c.center, zoom: c.zoom ?? Math.max(m.getZoom(), 7) })
        })
      } catch (e) {
        if (!dead) setError((e as Error).message || 'El navegador no pudo iniciar el mapa (WebGL no disponible).')
      }
    })()
    let munLoaded = false
    function loadMun() {
      if (munLoaded) return
      munLoaded = true
      void loadGeo('mun').then((fc) => {
        if (!dead) (mapRef.current?.getSource('mun') as GeoJSONSource | undefined)?.setData(fc)
      })
    }
    return () => {
      dead = true
      unsub()
      cb.current.onMap(null)
      map?.remove()
      mapRef.current = null
      setReady(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt])

  useEffect(() => {
    const m = mapRef.current
    if (m && ready) applyTheme(m)
  }, [theme, ready])
  useEffect(() => {
    const m = mapRef.current
    if (!m || !ready) return
    applyOverlays(m, overlays, indexRef.current, () => void loadGeo('mun').then((fc) => (m.getSource('mun') as GeoJSONSource | undefined)?.setData(fc)))
  }, [overlays, ready, pitched])

  const m = () => mapRef.current
  const anim = (o: object) => (motionOk ? o : { ...o, animate: false, duration: 0 })
  if (error)
    return (
      <div className="map-stage">
        <ErrorState error={{ message: `No fue posible mostrar el mapa: ${error}`, kind: 'formato' }} retry={() => (setError(null), setAttempt((a) => a + 1))} />
      </div>
    )
  return (
    <div className="map-stage">
      <div
        ref={box}
        className="map-canvas"
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (!(e.target as HTMLElement).classList.contains('maplibregl-canvas')) return
          if (e.key === '0') mapBus.send({ type: 'home' })
          else if (e.key === 'Enter' && mapRef.current) cb.current.onPickCenter?.(mapRef.current)
        }}
      />
      {!ready && (
        <div style={{ position: 'absolute', inset: 0, padding: 16 }} role="status" aria-label="Cargando el mapa">
          <Skeleton h="100%" r={14} />
        </div>
      )}
      {focused && onPickCenter && (
        <svg width={28} height={28} style={{ position: 'absolute', left: '50%', top: '50%', translate: '-50% -50%', pointerEvents: 'none', color: 'var(--text)' }} aria-hidden>
          <path d="M14 2v8M14 18v8M2 14h8M18 14h8" stroke="currentColor" strokeWidth={2} />
        </svg>
      )}
      {ready && labels && overlays.includes('dep') && mapRef.current && <DeptLabels map={mapRef.current} />}
      <div className="map-ctrl tr no-print">
        <div className="ctrl-group glass" role="group" aria-label="Zoom">
          <Tooltip text="Acercar">
            <button type="button" aria-label="Acercar" onClick={() => m()?.zoomIn(anim({}))}>
              <Plus size={20} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip text="Alejar">
            <button type="button" aria-label="Alejar" onClick={() => m()?.zoomOut(anim({}))}>
              <Minus size={20} aria-hidden />
            </button>
          </Tooltip>
        </div>
        <div className="ctrl-group glass" role="group" aria-label="Vista del mapa">
          <Tooltip text="Volver a la extensión nacional (0)">
            <button type="button" aria-label="Volver a la extensión nacional" onClick={() => mapBus.send({ type: 'home' })}>
              <LocateFixed size={20} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip text="Orientar al norte">
            <button type="button" aria-label="Orientar al norte" onClick={() => m()?.easeTo(anim({ bearing: 0, duration: 400 }))}>
              <Compass size={20} aria-hidden style={{ rotate: `${-bearing - 45}deg`, transition: 'rotate var(--t-base) var(--ease)' }} />
            </button>
          </Tooltip>
          <Tooltip text={pitched ? 'Vista 2D' : 'Vista inclinada (3D)'}>
            <button type="button" aria-label="Vista inclinada (3D)" aria-pressed={pitched} onClick={() => m()?.easeTo(anim({ pitch: pitched ? 0 : 55, duration: 420 }))}>
              <Box size={20} aria-hidden />
            </button>
          </Tooltip>
          <Tooltip text="Pantalla completa (F)">
            <button type="button" aria-label="Pantalla completa" onClick={toggleFullscreen}>
              <Maximize size={20} aria-hidden />
            </button>
          </Tooltip>
        </div>
      </div>
      {ready && children}
    </div>
  )
}

/** Nombres de departamentos como texto HTML sobre el mapa (no requiere fuentes de glifos externas). */
function DeptLabels({ map }: { map: MLMap }) {
  const [pts, setPts] = useState<{ name: string; x: number; y: number }[]>([])
  useEffect(() => {
    let zt: Awaited<ReturnType<typeof loadZones>> | null = null
    const update = () => {
      if (!zt) return
      const z = map.getZoom()
      if (z < 5.2 || map.getPitch() > 30) return setPts([])
      const { width, height } = map.getCanvas().getBoundingClientRect()
      const out = []
      for (let i = 0; i < zt.id.length; i++) {
        if (z < 6.2 && zt.area_km2[i] < 12000) continue
        const p = map.project([zt.lon[i], zt.lat[i]])
        if (p.x > 40 && p.y > 20 && p.x < width - 40 && p.y < height - 20) out.push({ name: zt.name[i], x: p.x, y: p.y })
      }
      setPts(out)
    }
    void loadZones('dep').then((t) => ((zt = t), update()))
    map.on('move', update)
    return () => {
      map.off('move', update)
    }
  }, [map])
  return (
    <div aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none', overflow: 'hidden' }}>
      {pts.map((p) => (
        <span key={p.name} style={{ position: 'absolute', left: p.x, top: p.y, translate: '-50% -50%', fontSize: 12, fontWeight: 600, letterSpacing: '0.02em', color: 'var(--text-2)', textShadow: '0 0 3px var(--map-land-co), 0 0 3px var(--map-land-co), 0 0 2px var(--map-land-co)', whiteSpace: 'nowrap' }}>
          {p.name}
        </span>
      ))}
    </div>
  )
}

/** Imagen PNG del mapa tal como se ve (incluye las capas activas). */
export function mapSnapshot(map: MLMap): Promise<{ dataUrl: string; width: number; height: number }> {
  return new Promise((resolve) => {
    map.once('render', () => {
      const c = map.getCanvas()
      const r = c.getBoundingClientRect()
      resolve({ dataUrl: c.toDataURL('image/png'), width: r.width, height: r.height })
    })
    map.triggerRepaint()
  })
}

/** Añade o actualiza una fuente GeoJSON. */
export function setSource(map: MLMap, id: string, data: GeoJSON.FeatureCollection, opts: Record<string, unknown> = {}) {
  const s = map.getSource(id) as GeoJSONSource | undefined
  if (s) s.setData(data)
  else map.addSource(id, { type: 'geojson', data, ...opts } as never)
}
export function dropLayers(map: MLMap, ids: string[], sources: string[] = []) {
  // El mapa puede haberse destruido antes de que se limpie el efecto.
  try {
    for (const id of ids) if (map.getLayer(id)) map.removeLayer(id)
    for (const s of sources) if (map.getSource(s)) map.removeSource(s)
  } catch {
    /* mapa ya eliminado */
  }
}
