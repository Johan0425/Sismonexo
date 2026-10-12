# Registro de cambios

Formato basado en «Keep a Changelog». Las fechas están en AAAA-MM-DD.

## [0.1.0] — 2026-10-12

Primera versión del prototipo.

### Datos
- Ingesta del catálogo instrumental de la RSNC desde los formularios oficiales del SGC (SEISAN 1993–2018 y SeisComP 2018–2026), con manifiesto y huella SHA-256 de cada respuesta.
- Ingesta del Catálogo Sísmico Integrado (1610–2020) y de los límites del DANE (MGN 2025).
- Limpieza con 13 reglas auditadas; versión del conjunto de datos `rsnc-2026.10.10-094f0852` (66.987 eventos).

### Modelado
- Tabla zona-periodo con 24 variables para cinco unidades de análisis.
- Siete familias de modelos, validación walk-forward de 8 bloques con separación temporal, calibración isotónica con encogimiento y detector de seis tipos de fuga.
- 45 configuraciones entrenadas (5 unidades × 3 horizontes × 3 umbrales).
- Intervalos de incertidumbre por tramos fijos de probabilidad (sustituyen a los tramos por cuantiles, que daban intervalos sin sentido en probabilidades altas).

### Aplicación
- Doce vistas, modo historia, constelación sísmica, asistente Nexo basado en reglas, importación de archivos e informes exportables.
- Sistema de diseño propio con modo claro y oscuro, densidad, movimiento reducido y WCAG 2.2 AA verificado con axe.
- Estado compartible por URL, deshacer y rehacer, paleta de comandos y atajos de teclado.

### Infraestructura
- API con FastAPI (16 endpoints), esquema PostGIS, Docker Compose, CI y despliegue continuo en Vercel.

### Corregido durante el desarrollo
- La calibración isotónica devolvía probabilidad 1,0 en tramos extremos con pocos casos.
- Un umbral infinito en los árboles exportados impedía generar el archivo de una configuración.
- MapLibre GL JS 6 no encontraba su worker en el sitio compilado.
- El asistente Nexo cerraba la vista al aplicar filtros (un efecto devolvía la promesa de `scrollIntoView`).
- La sincronización con la URL podía pisar una navegación o un cambio de parámetros reciente.
