# Backlog

Estado al cierre de la versión 0.1.0. ✅ hecho · 🔶 parcial · ⬜ pendiente.

## Fase 1 — Investigación y planificación
- ✅ Revisar fuentes y confirmar acceso (formularios del SGC, servicio del CSI, DANE MGN 2025).
- ✅ Documentar licencias y términos de uso.
- ✅ Definir arquitectura, modelo de datos y stack.

## Fase 2 — Sistema de diseño
- ✅ Tokens claro/oscuro, tipografía, espaciado y movimiento.
- ✅ Página de prueba (`/#/sistema`) con contraste medido en vivo.
- ✅ Validación con axe en ambos temas.

## Fase 3 — Prototipo cartográfico
- ✅ Límites del DANE, eventos reales, puntos, pulsos, agrupaciones, calor, densidad, columnas 3D, H3 y cuadrícula.
- ✅ Filtros con historial, URL compartible, inspector, búsqueda por departamento, municipio y coordenadas.
- ✅ Amenaza oficial del SGC como capa separada. ⬜ Fallas geológicas (sin fuente oficial confirmada).

## Fase 4 — Exploración histórica
- ✅ Máquina del tiempo, comparación de periodos y constelación sísmica.

## Fase 5 — Analítica predictiva
- ✅ Zona-periodo, línea base, seis modelos más, walk-forward, calibración, explicabilidad, detector de fugas.
- ⬜ Modelo secuencial (descartado por volumen de datos). 🔶 ETAS (versión simplificada).

## Fase 6 — Producto completo
- ✅ Laboratorio, comparador, calidad, informes, modo historia, Nexo, importación.
- 🔶 Modo sin conexión (service worker opcional; no cubre capas externas).

## Fase 7 — Calidad
- ✅ 50 pruebas unitarias y de componentes, 57 de extremo a extremo, 20 del pipeline, 20 de la API.
- ✅ Accesibilidad, responsive (375–2560 px), tema oscuro, movimiento reducido.
- ✅ Documentación, manuales, despliegue continuo en Vercel.
- 🔶 Docker Compose validado solo en sintaxis. ⬜ Medición de Core Web Vitals en dispositivos reales.
