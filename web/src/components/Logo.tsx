// Logotipo original: silueta abstracta de Colombia, malla geográfica, onda sísmica y punto de epicentro.
// Usa una sola tinta (currentColor), por lo que funciona en claro, oscuro y monocromo.
import { useId } from 'react'

const OUTLINE = 'M27 3 31 5 27.5 10 30 16 40 17 43.5 21 42 28 37 29 38 34 36 45 33 38 26 36 20 33 13 31 10 27 14 22 12 15 14 11 20 8Z'
const WAVE = 'M3 25H14.5l2-3.5 2.6 8 3-15.5 3.2 19 2.8-11 2 3H45'

export function Logo({ size = 28, title = 'SismoNexo Colombia' }: { size?: number; title?: string }) {
  const id = useId()
  const detail = size >= 40 // la malla solo aporta en tamaños medianos y grandes
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" role="img" aria-label={title} fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
      {detail && (
        <>
          <clipPath id={id}>
            <path d={OUTLINE} />
          </clipPath>
          <g clipPath={`url(#${id})`} strokeWidth={0.6} opacity={0.42}>
            {[10, 17, 31, 38].map((y) => (
              <path key={y} d={`M4 ${y}H46`} />
            ))}
            {[16, 23, 30, 37].map((x) => (
              <path key={x} d={`M${x} 2V46`} />
            ))}
          </g>
        </>
      )}
      <path d={OUTLINE} strokeWidth={size < 32 ? 2.6 : 1.9} />
      <path d={WAVE} strokeWidth={size < 32 ? 2.6 : 2} stroke="var(--logo-wave, currentColor)" />
      <circle cx={22.1} cy={14} r={size < 32 ? 3.4 : 2.7} fill="var(--logo-wave, currentColor)" stroke="none" />
    </svg>
  )
}

/** Traza sísmica decorativa: firma visual de la marca. Estática; no es una medición. */
export function Trace({ width = 240, height = 28, opacity = 0.5 }: { width?: number; height?: number; opacity?: number }) {
  const mid = height / 2
  const pts = [0, 0, 0, 0.1, -0.15, 0.1, 0, 0.5, -0.9, 1, -0.7, 0.45, -0.3, 0.2, -0.1, 0.05, 0, 0, 0.08, -0.05, 0, 0, 0, 0]
  const d = pts.map((v, i) => `${i ? 'L' : 'M'}${((i / (pts.length - 1)) * width).toFixed(1)} ${(mid - v * (mid - 2)).toFixed(1)}`).join('')
  return (
    <svg width={width} height={height} aria-hidden style={{ opacity }}>
      <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
