# Manual de usuario

SismoNexo Colombia se usa desde el navegador. No requiere cuenta ni instalación. Dirección pública: https://sismonexo-colombia.vercel.app

> Las estimaciones son académicas. No son una alerta oficial ni predicen terremotos individuales.

## 1. Orientación general

- **Barra lateral** (escritorio): las doce vistas agrupadas en Explorar, Analizar, Comprender y Proyecto. Se contrae con el botón de la barra superior.
- **Barra superior**: búsqueda global, estado y fecha de los datos, asistente Nexo, tema claro u oscuro y perfil del proyecto.
- **Teléfono**: navegación inferior con Inicio, Atlas, Pronóstico, Histórico y «Más». Los paneles se abren como hojas que suben desde abajo.
- **Advertencia permanente**: siempre visible en la parte inferior.

### Búsqueda global y atajos

Presione `Ctrl K` (o `⌘ K`) o `/`. Puede escribir:

- un departamento («Nariño»): filtra el atlas y acerca el mapa;
- un municipio («Los Santos»): acerca el mapa;
- coordenadas como `6.8, -73.1` (latitud, longitud);
- una vista, una acción («copiar enlace») o un término del glosario.

| Tecla | Acción |
|---|---|
| `?` | Lista de atajos |
| `G` y luego `I A P H L M C E` | Inicio, Atlas, Pronóstico, Histórico, Laboratorio, Modelos, Calidad, Metodología |
| `Ctrl/⌘ Z` · `⇧ Ctrl/⌘ Z` | Deshacer · rehacer cambios de filtros |
| `T` · `F` · `N` | Tema · pantalla completa · Nexo |
| `Esc` | Cerrar paneles |

Los atajos de una sola tecla pueden desactivarse en Configuración.

## 2. Atlas sísmico

1. **Filtros**: fechas (días UTC), magnitud, profundidad, departamento y calidad de localización. Cada cambio actualiza el mapa, el resumen, los gráficos y la dirección del navegador. Los filtros activos aparecen como etiquetas que se pueden quitar.
2. **Capas**: ocho representaciones (puntos, pulsos, agrupaciones, mapa de calor, densidad suavizada, columnas 3D, hexágonos H3 y celdas cuadradas), color por profundidad o magnitud, límites municipales, relieve, mapa de referencia y la amenaza sísmica oficial del SGC. También una capa de análisis por zona (probabilidad, tasa histórica, incertidumbre, calidad o cambio).
3. **Seleccionar un evento**: clic o toque sobre el punto; con teclado, enfoque el mapa, desplácelo con las flechas y presione `Enter` para elegir lo que esté bajo la mira. También puede elegirlo en la tabla «Eventos de mayor magnitud». La ficha muestra fecha y hora (Colombia y UTC), magnitud y tipo, profundidad, coordenadas, lugar, fuente, calidad, enlace al registro original y eventos cercanos.
4. **Controles del mapa**: acercar, alejar, volver a la extensión nacional (`0`), orientar al norte, vista inclinada 3D y pantalla completa.
5. **Exportar**: registros visibles en CSV o GeoJSON, imagen del mapa y enlace a la vista.

La leyenda explica siempre qué representa el color y qué el tamaño.

## 3. Pronóstico probabilístico

Cada zona muestra la probabilidad de registrar **al menos un evento** de magnitud igual o superior al umbral durante el horizonte.

- **Parámetros** (botón superior izquierdo): horizonte (7, 30, 90 días u otro), umbral, resolución geográfica, modelo, profundidad, periodo histórico y suavizado.
- Si la combinación no tiene modelo entrenado, la plataforma lo avisa y usa la **línea base recalculada**.
- **Variable del mapa** (en Capas): probabilidad, incertidumbre, cambio frente al periodo anterior, tasa histórica o cobertura y calidad.
- **Seleccione una zona** (mapa o tabla) para ver: probabilidad con su intervalo, tasa esperada, variación, nivel de confianza, modelo y versión, actividad observada, distribuciones y variables más influyentes.
- **Explicar esta estimación**: qué pesó, actividad reciente, línea base, periodos parecidos, incertidumbre, datos faltantes y estabilidad del modelo.
- **Comparar zona**: fije una zona y seleccione otra para verlas lado a lado.
- **Crear informe**: abre el informe de la zona.

Cómo leerlo: una probabilidad alta no es certeza; una baja no es ausencia de actividad. Habla de actividad, no de daños.

## 4. Explorador histórico

- **Máquina del tiempo**: reproducir, pausar, avanzar y retroceder; paso por día, semana, mes o año; velocidad 1×, 2× o 3×; estela temporal, acumulado y mapa de calor. Arrastre el deslizador o haga clic en la curva de frecuencia para saltar. `Espacio` reproduce o pausa. «Guardar este momento» conserva puntos de interés durante la sesión. Las ondas son una representación visual, no una simulación física.
- **Comparar periodos**: elija dos periodos; verá indicadores lado a lado, distribuciones y un mapa de diferencia. Si los periodos quedan a lados distintos de marzo de 2018, se advierte.
- **Constelación** (experimental): red de eventos enlazados por cercanía espacial y temporal. Ajuste magnitud mínima, distancia y días; reproduzca la construcción; alterne vista geográfica y de grafo; seleccione un nodo para ver su secuencia. La conexión no implica causalidad.

## 5. Laboratorio de escenarios

Parte de los valores reales de una zona. Mueva los controles (frecuencia reciente, magnitud acumulada, profundidad, tiempo desde el último evento, distancia, estacionalidad, ventana histórica) y compare «real» frente a «hipotético» en todos los modelos. Muestra la sensibilidad, advierte los valores fuera del rango histórico, permite restablecer, guardar el escenario en la sesión y exportar una captura rotulada. **Un escenario no es un pronóstico.**

## 6. Comparador de modelos

Elija unidad, horizonte y umbral. Encontrará la tabla de métricas, curvas precisión-recall, ROC y de calibración, matriz de confusión, historial por bloque temporal, rendimiento por departamento, magnitud y profundidad, la visualización de la validación walk-forward y el detector de fugas. El botón **«¿Qué modelo debería usar?»** da una recomendación razonada.

## 7. Calidad de los datos

Indicadores, calendario de completitud, cobertura, tipos de magnitud, rupturas estructurales, matriz de faltantes, reglas de auditoría y procedencia de cada fuente. En **Importar datos** puede soltar un CSV, JSON o GeoJSON: verá qué filas se aceptan y por qué se rechazan las demás antes de explorarlo en el atlas (siempre rotulado como archivo importado).

## 8. Informes

Ocho informes: resumen ejecutivo, por zona, por periodo, actividad histórica, probabilístico, comparación de modelos, calidad de datos y anexo metodológico. Vista previa en pantalla y descarga en PDF, CSV, JSON, PNG, GeoJSON o enlace. Todos incluyen autor, institución, fecha, filtros, fuente, versiones, mapa, gráfico, tabla, interpretación, limitaciones y advertencia.

## 9. Asistente Nexo

Escriba consultas como:

- «Muéstrame los eventos de magnitud mayor a 4 en Santander durante 2024.»
- «Compara la profundidad promedio de Antioquia y Nariño.»
- «¿Qué zonas tuvieron mayor actividad en los últimos 30 días?»
- «¿Qué significa el Brier score?» · «¿Cuál modelo está mejor calibrado?»

Nexo explica qué filtros aplicó, permite deshacerlos y cita la fuente. No es un modelo generativo: si no tiene la información, lo dice. No emite alertas.

## 10. Modo historia y aprendizaje

El **modo historia** presenta el proyecto en diez capítulos: flechas para avanzar, subtítulos, narración opcional por voz, pantalla completa, resumen en PDF y código QR hacia el atlas. El **centro de aprendizaje** reúne conceptos, glosario y preguntas frecuentes.

## 11. Configuración y accesibilidad

Tema (sistema, claro, oscuro), densidad, animaciones reducidas, atajos de una tecla, zona horaria (Colombia o UTC) y preparación del modo sin conexión. Toda la aplicación se puede usar con teclado; cada gráfico tiene resumen textual y tabla alternativa; el contraste cumple WCAG 2.2 AA.

## 12. Idioma

El selector pequeño de la barra superior (ES · EN · PT) cambia la interfaz entre español, inglés y portugués; también está en Configuración y en el modo historia. Las cifras y fechas adoptan el formato del idioma. Los nombres de lugares y los archivos exportados se mantienen en español.

## 13. Compartir

La dirección del navegador contiene filtros, parámetros, capas, encuadre del mapa, selección, tema, idioma y zona horaria. Copiarla es suficiente para que otra persona vea lo mismo.
