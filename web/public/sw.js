// Service worker mínimo para el modo sin conexión (opcional, se activa desde Configuración).
// Estrategia: red primero para la navegación; caché primero para archivos de la app y datos ya consultados.
const CACHE = 'sismonexo-v1'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))

self.addEventListener('message', (e) => {
  if (e.data?.type !== 'precache' || !Array.isArray(e.data.urls)) return
  e.waitUntil(caches.open(CACHE).then((c) => Promise.allSettled(e.data.urls.map((u) => c.add(u)))))
})

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  if (e.request.method !== 'GET' || url.origin !== self.location.origin) return
  e.respondWith(
    (async () => {
      const cache = await caches.open(CACHE)
      if (e.request.mode === 'navigate') {
        try {
          const res = await fetch(e.request)
          cache.put(e.request, res.clone())
          return res
        } catch {
          return (await cache.match(e.request)) ?? (await cache.match(self.registration.scope)) ?? Response.error()
        }
      }
      const hit = await cache.match(e.request)
      if (hit) return hit
      const res = await fetch(e.request)
      if (res.ok) cache.put(e.request, res.clone())
      return res
    })(),
  )
})
