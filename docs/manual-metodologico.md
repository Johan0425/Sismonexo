# Manual metodológico

Este documento describe el método con el detalle necesario para reproducirlo. El código está en `pipeline/sismonexo/`.

## 1. Pregunta

Para cada zona *z* y fecha de origen *o*, estimar

  P( N(z, [o, o + h)) ≥ 1 ),

donde N cuenta los eventos con magnitud ≥ *m* registrados en la zona durante el horizonte *h*. Horizontes: 7, 30 (principal) y 90 días. Umbrales: 3,0; 4,0; 5,0.

## 2. Datos

| Paso | Módulo | Resultado |
|---|---|---|
| Ingesta RSNC | `ingest_sgc.py` | `data/raw/rsnc_*` + manifiesto con URL, fecha, SHA-256 y registros reportados frente a leídos |
| Ingesta auxiliar | `ingest_aux.py` | CSI (1610–2020) y límites del DANE |
| Limpieza | `clean.py` | `events.parquet` (66.987 filas, 31 columnas) y `audit.json` |

Consulta: M ≥ 2,5; 5° S–14° N; 83°–66° O; 1993-06-01 a 2026-10-10. Se descargaron 67.140 registros y se descartaron 153 duplicados (35 por identificador y 118 casi idénticos en tiempo, posición y magnitud). No hubo coordenadas inválidas ni magnitudes faltantes. 241 profundidades fuera de rango se anularon; 4.007 profundidades fijadas en 0 km por la fuente se marcaron. No se imputó ningún valor.

**Calidad de localización (derivada, no oficial):** A si gap ≤ 180°, error horizontal ≤ 5 km y RMS ≤ 1,0 s; B si ≤ 220°, ≤ 10 km y ≤ 1,5 s; C si gap ≤ 300° y error ≤ 25 km; D el resto; N sin métricas.

## 3. Zonas

| Unidad | Definición | Zonas |
|---|---|---|
| Departamento | DANE, MGN 2025 | 33 |
| Municipio | DANE, MGN 2025 | 1.122 |
| Celda H3 | Resolución 4 (≈ 1.770 km²) | 711 |
| Cuadrícula ≈ 50 km | 0,45° × 0,45° | 547 |
| Cuadrícula ≈ 25 km | 0,225° × 0,225° | 2.023 |

Las mallas incluyen todas las celdas que tocan el territorio; no dependen de la sismicidad.

## 4. Tabla zona-periodo

Orígenes alineados con el fin del catálogo, cada 7 días (h = 7) o cada 30 días (h = 30 y 90), a partir de un año de historia. Las variables usan eventos con fecha estrictamente anterior al origen:

- **Frecuencia**: eventos en 30, 90 y 365 días; eventos sobre el umbral en 30, 90, 365 y 1.825 días; tasa histórica por 30 días.
- **Magnitud**: media y máxima de un año, máxima de 30 días, magnitud equivalente a la energía acumulada.
- **Profundidad**: media y mediana de un año.
- **Tiempo y distancia**: días desde el último evento (cualquiera y sobre el umbral), distancia al último evento M ≥ 4,5.
- **Entorno**: actividad media en zonas vecinas; término tipo ETAS Σ 10^{α(M−M₀)} · ∫Omori · núcleo espacial (α = 1, c = 0,05 d, p = 1,1, d₀ = 25 km, q = 1,5, M₀ = 3, ventana de 365 d).
- **Otras**: seno y coseno del día del año, proporción de localizaciones A o B, logaritmo del área.

La etiqueta es 1 si hubo al menos un evento ≥ umbral en [o, o + h). El último origen no tiene etiqueta: es el pronóstico vigente.

## 5. Modelos

1. **Línea base**: tasa λ = (n + a)/(T + b) por 30 días, con a = 0,5 y b tal que la previa reproduce la tasa media; P = 1 − e^{−λh/30}.
2. **Regresión logística** con ponderación de clases; estandarización y log(1 + x) en conteos.
3. **Poisson / binomial negativa**: regresión de Poisson del conteo; P = 1 − (1 + αμ)^{−1/α}, α por momentos.
4. **Random Forest** (120 árboles, hojas ≥ 25): solo 30 días y M ≥ 4,0.
5. **Gradient boosting por histogramas** (150 iteraciones, 15 hojas, tasa 0,06, L2 = 1).
6. **Tasa tipo ETAS**: Poisson con log-tasa histórica y término de actividad reciente.
7. **Híbrido**: logística sobre los logits de 1, 5 y 6, ajustada en validación.

## 6. Validación

Ocho bloques walk-forward de ventana creciente. En el bloque *k*: prueba = un año; validación = los dos años anteriores, separados por *h* días; entrenamiento = todo lo anterior, separado por *h* días. Calibración isotónica, umbral de decisión (máximo F1) y pesos del híbrido se ajustan con validación. Los dos bloques más recientes forman la prueba final. El modelo por defecto es el de menor log-loss en los seis bloques restantes.

**Métricas**: PR-AUC, ROC-AUC, Brier y su mejora relativa frente a la base, log-loss, ECE, pendiente e intercepto de calibración, precisión, recall y F1 al umbral, error absoluto de conteos, ganancia de información (bits por evento), tiempos y estabilidad entre bloques. La exactitud no se usa.

**Detector de fugas** (`leakage.py`): (1) recalcula variables con el catálogo truncado en el origen y exige igualdad; (2) compara el escalador con los estadísticos de entrenamiento; (3) busca parejas zona-periodo repetidas entre conjuntos; (4) verifica la holgura temporal; (5) cuenta eventos de prueba con vecinos a ≤ 50 km en los 30 días previos a la frontera; (6) busca columnas de etiqueta o correlaciones > 0,98 entre entradas y objetivo.

## 7. Calibración e incertidumbre

- Isotónica con encogimiento: cada escalón se mezcla con la prevalencia usando 20 pseudo-observaciones y se fuerza la monotonía.
- Estado: calibrado (ECE ≤ 0,02 y pendiente 0,8–1,25), parcial (ECE ≤ 0,05), no calibrado, sin evaluar (< 30 positivos).
- Intervalo del 90 %: Jeffreys sobre la frecuencia observada en 16 tramos fijos de probabilidad (fusionando los de menos de 40 casos), ampliado para contener siempre la estimación.

## 8. Explicabilidad

SHAP (TreeExplainer, log-odds antes de calibrar) para cada zona; importancia por permutación (caída de PR-AUC, 3 repeticiones) y dependencias parciales en el último bloque de prueba; los 3 periodos más parecidos de la misma zona (distancia euclídea en 10 variables estandarizadas) y cuántos de los 20 más parecidos tuvieron evento.

## 9. Resultados (30 días)

| Configuración | Zonas-periodo | Positivos | Elegido | PR-AUC | Base | Mejora de Brier | Calibración |
|---|---|---|---|---|---|---|---|
| Cuadrícula 50 km, M ≥ 3,0 | 215.518 | 7.744 | Híbrido | 0,372 | 0,314 | +5,4 % | calibrado |
| Cuadrícula 50 km, M ≥ 4,0 | 215.518 | 1.570 | Híbrido | 0,350 | 0,169 | +19,8 % | calibrado |
| Cuadrícula 50 km, M ≥ 5,0 | 215.518 | 253 | Poisson/BN | 0,073 | 0,033 | +2,1 % | calibrado |
| Municipio, M ≥ 3,0 | 442.068 | 8.303 | Híbrido | 0,318 | 0,218 | +16,0 % | calibrado |
| Municipio, M ≥ 4,0 | 442.068 | 1.618 | Poisson/BN | 0,384 | 0,329 | +8,9 % | calibrado |
| Departamento, M ≥ 3,0 | 13.002 | 4.071 | Poisson/BN | 0,795 | 0,790 | +2,3 % | parcial |
| Departamento, M ≥ 4,0 | 13.002 | 1.106 | Línea base | 0,613 | 0,613 | 0 % | parcial |
| Departamento, M ≥ 5,0 | 13.002 | 218 | Línea base | 0,134 | 0,134 | 0 % | calibrado |

En las 45 configuraciones el modelo elegido fue el híbrido en 25, Poisson/binomial negativa en 15, la línea base en 4 y el gradient boosting en 1. Ninguna comprobación de fuga falló; la de réplicas quedó como advertencia en todas.

**Interpretación.** La información útil más allá de la frecuencia histórica es, sobre todo, la persistencia de la actividad reciente en escalas finas. Agregada por departamento desaparece. Para eventos grandes, los datos no permiten distinguir modelos.

## 10. Reproducibilidad

Semillas fijas; versiones en `requirements.txt`; cada artefacto lleva `dataset_version` y `model_version`; `run_all.py` regenera todo. Las pruebas de `pipeline/tests` verifican las propiedades del método (variables sin futuro, particiones cronológicas, calibración sin certezas, paridad de los árboles exportados).
