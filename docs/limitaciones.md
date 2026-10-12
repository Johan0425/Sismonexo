# Lista de limitaciones

## Científicas

1. **No es predicción.** No existe un método validado para anticipar la fecha, el lugar y la magnitud de un terremoto. La plataforma estima frecuencias por zona y periodo.
2. **Eventos raros.** Para M ≥ 5,0 hay entre 218 y 253 zonas-periodo positivas en 33 años, según la unidad. Las diferencias entre modelos son poco fiables y la línea base suele ser la mejor opción.
3. **Catálogo heterogéneo.** En marzo de 2018 el SGC cambió de SEISAN a SeisComP: cambian los tipos de magnitud (ML → MLr), la densidad de la red y los criterios de revisión. La prueba de Pettitt detecta rupturas en todas las series mensuales examinadas.
4. **Magnitudes sin homogeneizar.** Un umbral «M ≥ 4,0» mezcla ML, MLr, Mw y otras. No se convirtió a Mw.
5. **Completitud variable.** La magnitud de completitud se estima a escala nacional (2,7–3,3 según el año) y es peor lejos de la red; el umbral de descarga es 2,5.
6. **Agrupamiento.** Las secuencias de réplicas favorecen a los modelos que usan actividad reciente. El detector de fugas lo señala como advertencia en las 45 configuraciones: la partición es cronológica, pero la actividad persistente cruza las fronteras.
7. **ETAS simplificado.** La «tasa inspirada en ETAS» usa parámetros fijos de la literatura; no se ajustó por máxima verosimilitud ni se hizo desagrupamiento.
8. **Sin modelo secuencial.** No se entrenaron redes recurrentes: el volumen de positivos no lo justifica.
9. **Intervalos aproximados.** El intervalo de incertidumbre resume la frecuencia observada por tramo de probabilidad; no es un intervalo de predicción individual. Con la línea base recalculada es un intervalo creíble aproximado.
10. **Sin riesgo.** No hay exposición ni vulnerabilidad: una probabilidad alta de actividad (por ejemplo, en el nido de Bucaramanga, a unos 150 km de profundidad) no implica daños.
11. **Evaluación retrospectiva.** Los modelos se evaluaron con datos pasados; no hay todavía evaluación prospectiva.

## Técnicas

1. Los modelos de aprendizaje automático solo existen en 45 configuraciones; con profundidad, periodo histórico, suavizado, umbral u horizonte personalizados se usa la línea base recalculada.
2. Random Forest solo se entrena en la configuración principal (30 días, M ≥ 4,0) y no se evalúa en el navegador.
3. Los límites del DANE están simplificados (0,005° y 0,003°); un evento a metros de un borde puede quedar asignado al municipio vecino.
4. El mapa base no tiene topónimos ni vías; el relieve, el mapa de referencia y la amenaza oficial dependen de servicios externos.
5. La capa de fallas geológicas no se incluye: no se confirmó un servicio oficial con licencia documentada.
6. Las columnas 3D muestran como máximo los 4.000 eventos de mayor magnitud; la constelación, 350 nodos.
7. Un archivo importado solo sirve para explorar (atlas e histórico) durante la sesión; no reentrena modelos.
8. El asistente Nexo entiende un conjunto acotado de consultas en español; no es un modelo de lenguaje.
9. La narración del modo historia depende de la voz del navegador.
10. Docker Compose se validó en sintaxis; no se ejecutó de extremo a extremo en este equipo.
11. La API no está desplegada: el sitio de Vercel es estático y autosuficiente.
12. Idiomas: la interfaz está en español, inglés y portugués, pero los informes y archivos exportados, los nombres de lugares y la narración por voz permanecen en español. Las traducciones no fueron revisadas por hablantes nativos; un texto sin traducción se muestra en español.
