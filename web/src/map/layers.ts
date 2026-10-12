// Capas temáticas del mapa: eventos (puntos, pulsos, grupos, calor, densidad, columnas) y zonas (coropletas).
import type { ExpressionSpecification, Map as MLMap } from 'maplibre-gl'
import { useEffect, useRef } from 'react'
import type { Events } from '@/lib/data'
import { DEPTH_CLASSES, depthClass, NO_DATA_COLOR, P_CLASSES, rampStops } from '@/lib/scales'
import type { ColorBy, Viz } from '@/lib/store'
import { dropLayers, EMPTY_FC, setSource } from './MapView'

const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
const EV_LAYERS = ['ev-heat', 'ev-cluster', 'ev-points', 'ev-rings', 'ev-columns', 'ev-selected']
export const MAX_COLUMNS = 4000

export function eventsGeoJson(ev: Events, idx: ArrayLike<number>): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = new Array(idx.length)
  for (let k = 0; k < idx.length; k++) {
    const i = idx[k]
    const d = ev.depth[i]
    features[k] = { type: 'Feature', properties: { i, m: ev.mag[i], dc: depthClass(d)?.i ?? -1, t: ev.t[i] }, geometry: { type: 'Point', coordinates: [ev.lon[i], ev.lat[i]] } }
  }
  return { type: 'FeatureCollection', features }
}

const radius = (k: number): ExpressionSpecification => ['interpolate', ['linear'], ['zoom'], 4, ['interpolate', ['exponential', 1.6], ['get', 'm'], 2.5, 0.9 + k, 4, 2.2 + k, 5, 4.5 + k, 6, 8.5 + k, 7.5, 16 + k], 9, ['interpolate', ['exponential', 1.6], ['get', 'm'], 2.5, 4 + k, 4, 8 + k, 5, 14 + k, 6, 24 + k, 7.5, 40 + k]]
const RADIUS = radius(0)
export function colorExpr(colorBy: ColorBy): ExpressionSpecification | string {
  if (colorBy === 'profundidad') return ['match', ['get', 'dc'], ...DEPTH_CLASSES.flatMap((c) => [c.i, c.color]), NO_DATA_COLOR] as unknown as ExpressionSpecification
  if (colorBy === 'magnitud') {
    const s = rampStops('inferno')
    return ['interpolate', ['linear'], ['get', 'm'], ...s.slice(1, 9).flatMap((c, k) => [2.5 + (k * 4.5) / 7, c])] as ExpressionSpecification
  }
  return css('--accent')
}

function columns(ev: Events, idx: ArrayLike<number>): { fc: GeoJSON.FeatureCollection; shown: number } {
  // Las columnas son costosas: se dibujan los eventos de mayor magnitud del filtro actual.
  let pick = Array.from(idx as ArrayLike<number>)
  if (pick.length > MAX_COLUMNS) pick = pick.sort((a, b) => ev.mag[b] - ev.mag[a]).slice(0, MAX_COLUMNS)
  const features: GeoJSON.Feature[] = []
  for (const i of pick) {
    const d = ev.depth[i]
    if (!Number.isFinite(d)) continue
    const s = 0.018 + (Math.max(ev.mag[i], 2.5) - 2.5) * 0.012
    const x = ev.lon[i]
    const y = ev.lat[i]
    features.push({ type: 'Feature', properties: { i, m: ev.mag[i], dc: depthClass(d)?.i ?? -1, h: Math.max(d, 1) * 1000 }, geometry: { type: 'Polygon', coordinates: [[[x - s, y - s], [x + s, y - s], [x + s, y + s], [x - s, y + s], [x - s, y - s]]] } })
  }
  return { fc: { type: 'FeatureCollection', features }, shown: features.length }
}

interface EventLayerOpts {
  map: MLMap | null
  ev: Events | null
  idx: Uint32Array | null
  viz: Viz
  colorBy: ColorBy
  theme: string
  selected: number | null
  /** Filtro temporal aplicado en la GPU (máquina del tiempo): [desde, hasta] en segundos. */
  window?: [number, number] | null
  opacity?: number
}

export function useEventLayers({ map, ev, idx, viz, colorBy, theme, selected, window: win, opacity = 0.72 }: EventLayerOpts): void {
  const built = useRef<string>('')
  // Datos
  useEffect(() => {
    if (!map || !ev || !idx) return
    const isCol = viz === 'columnas'
    const isCl = viz === 'grupos'
    const pointy = !isCol && !isCl && viz !== 'h3' && viz !== 'g50'
    const data = pointy ? eventsGeoJson(ev, idx) : EMPTY_FC
    setSource(map, 'ev', data)
    setSource(map, 'ev-cl', isCl ? eventsGeoJson(ev, idx) : EMPTY_FC, { cluster: true, clusterRadius: 44, clusterMaxZoom: 9, clusterProperties: { mx: ['max', ['get', 'm']] } })
    setSource(map, 'ev-col', isCol ? columns(ev, idx).fc : EMPTY_FC)
    setSource(map, 'ev-sel', EMPTY_FC)
    built.current = 'data'
  }, [map, ev, idx, viz])

  // Capas y estilo
  useEffect(() => {
    if (!map || !ev || !idx) return
    dropLayers(map, EV_LAYERS)
    const stroke = theme === 'oscuro' ? 'rgba(255,255,255,0.55)' : 'rgba(20,28,34,0.55)'
    const color = colorExpr(colorBy)
    const before = 'mun-line'
    if (viz === 'calor' || viz === 'densidad') {
      const dens = viz === 'densidad'
      const s = rampStops(dens ? 'cividis' : 'inferno')
      map.addLayer(
        {
          id: 'ev-heat',
          type: 'heatmap',
          source: 'ev',
          paint: {
            'heatmap-weight': dens ? 1 : ['interpolate', ['exponential', 2], ['get', 'm'], 2.5, 0.05, 4, 0.3, 5, 1, 6.5, 3],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 4, dens ? 16 : 9, 9, dens ? 60 : 34],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 4, dens ? 0.05 : 0.5, 9, dens ? 0.4 : 1.6],
            'heatmap-opacity': 0.82,
            'heatmap-color': ['interpolate', ['linear'], ['heatmap-density'], 0, 'rgba(0,0,0,0)', ...s.slice(1).flatMap((c, k) => [(k + 1) / (s.length - 1), c])] as ExpressionSpecification,
          },
        },
        before,
      )
    } else if (viz === 'grupos') {
      map.addLayer(
        {
          id: 'ev-cluster',
          type: 'circle',
          source: 'ev-cl',
          filter: ['has', 'point_count'],
          paint: { 'circle-color': css('--accent'), 'circle-opacity': 0.78, 'circle-stroke-color': css('--surface'), 'circle-stroke-width': 1.5, 'circle-radius': ['interpolate', ['exponential', 0.5], ['get', 'point_count'], 2, 9, 50, 16, 500, 26, 5000, 38, 30000, 52] },
        },
        before,
      )
      map.addLayer({ id: 'ev-points', type: 'circle', source: 'ev-cl', filter: ['!', ['has', 'point_count']], paint: { 'circle-radius': RADIUS, 'circle-color': color as never, 'circle-opacity': opacity, 'circle-stroke-color': stroke, 'circle-stroke-width': 0.6 } }, before)
    } else if (viz === 'columnas') {
      map.addLayer({ id: 'ev-columns', type: 'fill-extrusion', source: 'ev-col', paint: { 'fill-extrusion-color': color as never, 'fill-extrusion-height': ['get', 'h'], 'fill-extrusion-opacity': 0.86 } }, 'anchor-top')
    } else if (viz === 'pulsos') {
      map.addLayer({ id: 'ev-rings', type: 'circle', source: 'ev', paint: { 'circle-radius': RADIUS, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': color as never, 'circle-stroke-width': ['interpolate', ['linear'], ['get', 'm'], 2.5, 0.8, 6, 2.4], 'circle-stroke-opacity': 0.85 } }, before)
    } else if (viz === 'puntos') {
      map.addLayer({ id: 'ev-points', type: 'circle', source: 'ev', layout: { 'circle-sort-key': ['-', 0, ['get', 'm']] }, paint: { 'circle-radius': RADIUS, 'circle-color': color as never, 'circle-opacity': opacity, 'circle-stroke-color': stroke, 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 4, 0.3, 8, 0.9] } }, before)
    }
    map.addLayer({ id: 'ev-selected', type: 'circle', source: 'ev-sel', paint: { 'circle-radius': radius(5), 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': css('--text'), 'circle-stroke-width': 2.5 } }, 'anchor-top')
    return () => dropLayers(map, EV_LAYERS)
  }, [map, ev, idx, viz, colorBy, theme, opacity])

  // Ventana temporal (sin reconstruir los datos)
  useEffect(() => {
    if (!map) return
    const f = win ? (['all', ['>=', ['get', 't'], win[0]], ['<', ['get', 't'], win[1]]] as ExpressionSpecification) : null
    const ids = viz === 'grupos' ? [] : ['ev-points', 'ev-rings', 'ev-heat']
    for (const id of ids) if (map.getLayer(id)) map.setFilter(id, f)
  }, [map, win, viz, colorBy, theme, idx])

  // Selección
  useEffect(() => {
    if (!map || !ev || !map.getSource('ev-sel')) return
    setSource(map, 'ev-sel', selected == null ? EMPTY_FC : eventsGeoJson(ev, [selected]))
  }, [map, ev, selected, viz, idx])
}

/** Índice del evento más cercano a un punto de pantalla (o null). */
export function pickEvent(map: MLMap, point: { x: number; y: number }, pad = 8): number | null {
  const layers = ['ev-points', 'ev-rings', 'ev-columns'].filter((l) => map.getLayer(l))
  if (!layers.length) return null
  const feats = map.queryRenderedFeatures([[point.x - pad, point.y - pad], [point.x + pad, point.y + pad]], { layers })
  if (!feats.length) return null
  const best = feats.reduce((a, b) => ((b.properties.m as number) > (a.properties.m as number) ? b : a))
  return best.properties.i as number
}

// ------------------------------------------------------------------ zonas

const Z_LAYERS = ['zone-fill', 'zone-pattern', 'zone-line', 'zone-selected']

function patternImage(kind: string, ink: string): ImageData | null {
  const n = 12
  const c = document.createElement('canvas')
  c.width = c.height = n
  const g = c.getContext('2d')
  if (!g || kind === 'none' || kind === 'solid') return null
  g.strokeStyle = ink
  g.fillStyle = ink
  g.lineWidth = 1
  const diag = (step: number, dir: 1 | -1) => {
    for (let o = -n; o < n * 2; o += step) {
      g.beginPath()
      if (dir === 1) (g.moveTo(o, n), g.lineTo(o + n, 0))
      else (g.moveTo(o, 0), g.lineTo(o + n, n))
      g.stroke()
    }
  }
  if (kind === 'dots') {
    for (const [x, y] of [[3, 3], [9, 9]]) (g.beginPath(), g.arc(x, y, 1, 0, Math.PI * 2), g.fill())
  } else if (kind === 'lines') diag(6, 1)
  else if (kind === 'dense') diag(4, 1)
  else if (kind === 'cross') (diag(6, 1), diag(6, -1))
  return g.getImageData(0, 0, n, n)
}
function ensurePatterns(map: MLMap) {
  for (const c of P_CLASSES) {
    const id = `pat-${c.i}`
    if (map.hasImage(id)) continue
    const img = patternImage(c.pattern, c.i >= 4 ? 'rgba(0,0,0,0.55)' : 'rgba(255,255,255,0.75)')
    if (img) map.addImage(id, img, { pixelRatio: 1 })
  }
}

interface ZoneLayerOpts {
  map: MLMap | null
  polygons: GeoJSON.FeatureCollection | null
  /** Color por zona (índice zi). null o '' = sin dato. */
  colors: (string | null)[] | null
  /** Clase de patrón por zona (índice de clase de probabilidad) o null para no usar patrones. */
  patterns?: number[] | null
  selected: number | null
  theme: string
  opacity?: number
  outline?: boolean
}
export function useZoneLayer({ map, polygons, colors, patterns, selected, theme, opacity = 0.78, outline = true }: ZoneLayerOpts): void {
  useEffect(() => {
    if (!map) return
    if (!polygons || !colors) {
      dropLayers(map, Z_LAYERS)
      if (map.getSource('zones')) setSource(map, 'zones', EMPTY_FC)
      return
    }
    const fc: GeoJSON.FeatureCollection = {
      type: 'FeatureCollection',
      features: polygons.features.map((f) => {
        const zi = (f.properties as { zi: number }).zi
        return { ...f, properties: { zi, c: colors[zi] || '', pc: patterns ? patterns[zi] : -1 } }
      }),
    }
    setSource(map, 'zones', fc)
    ensurePatterns(map)
    if (!map.getLayer('zone-fill')) {
      map.addLayer({ id: 'zone-fill', type: 'fill', source: 'zones', filter: ['!=', ['get', 'c'], ''], paint: { 'fill-color': ['get', 'c'], 'fill-opacity': opacity } }, 'anchor-data')
      map.addLayer({ id: 'zone-pattern', type: 'fill', source: 'zones', filter: ['in', ['get', 'pc'], ['literal', P_CLASSES.filter((c) => c.pattern !== 'none' && c.pattern !== 'solid').map((c) => c.i)]], paint: { 'fill-pattern': ['concat', 'pat-', ['to-string', ['get', 'pc']]], 'fill-opacity': 0.55 } }, 'anchor-data')
      map.addLayer({ id: 'zone-line', type: 'line', source: 'zones', paint: { 'line-color': css('--map-line-soft'), 'line-width': 0.5 } }, 'anchor-data')
      map.addLayer({ id: 'zone-selected', type: 'line', source: 'zones', filter: ['==', ['get', 'zi'], -1], paint: { 'line-color': css('--text'), 'line-width': 3 } }, 'anchor-top')
    }
    map.setPaintProperty('zone-fill', 'fill-opacity', opacity)
    map.setLayoutProperty('zone-line', 'visibility', outline ? 'visible' : 'none')
    map.setPaintProperty('zone-line', 'line-color', css('--map-line-soft'))
    map.setPaintProperty('zone-selected', 'line-color', css('--text'))
    map.setLayoutProperty('zone-pattern', 'visibility', patterns ? 'visible' : 'none')
  }, [map, polygons, colors, patterns, theme, opacity, outline])
  useEffect(() => {
    if (map?.getLayer('zone-selected')) map.setFilter('zone-selected', ['==', ['get', 'zi'], selected ?? -1])
  }, [map, selected, polygons, colors])
  useEffect(() => () => void (map && dropLayers(map, Z_LAYERS, ['zones'])), [map])
}
export function pickZone(map: MLMap, point: { x: number; y: number }): number | null {
  if (!map.getLayer('zone-fill')) return null
  const f = map.queryRenderedFeatures([point.x, point.y], { layers: ['zone-fill'] })[0]
  return f ? (f.properties.zi as number) : null
}
