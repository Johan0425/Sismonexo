// Canal mínimo para pedirle acciones al mapa activo desde cualquier parte de la interfaz.
export type MapCommand =
  | { type: 'fit'; bounds: [[number, number], [number, number]] }
  | { type: 'fly'; center: [number, number]; zoom?: number }
  | { type: 'home' }

type Listener = (c: MapCommand) => void
const listeners = new Set<Listener>()
let pending: MapCommand | null = null

export const mapBus = {
  /** Si todavía no hay un mapa montado, la orden queda pendiente y se entrega al primero que se suscriba. */
  send(c: MapCommand) {
    if (listeners.size) listeners.forEach((l) => l(c))
    else pending = c
  },
  subscribe(l: Listener) {
    listeners.add(l)
    if (pending) {
      const c = pending
      pending = null
      queueMicrotask(() => l(c))
    }
    return () => {
      listeners.delete(l)
    }
  },
}
