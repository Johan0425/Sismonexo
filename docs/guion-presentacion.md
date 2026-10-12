# Guion para presentar el proyecto

Duración: 12–15 minutos. Abra `https://sismonexo-colombia.vercel.app/#/historia` (o el modo historia local), pantalla completa. Avance con `→`. Si no habrá red, prepare antes el modo sin conexión en Configuración.

## Antes de empezar (1 min)

- Verifique tema (claro para proyector), zoom del navegador al 100 % y que el atlas cargue.
- Tenga abierta en otra pestaña la vista «Pronóstico» con una zona seleccionada.

## Apertura (1 min)

> «Colombia tiembla todos los días. Este proyecto no intenta adivinar el próximo sismo: nadie puede. Lo que hace es medir, con datos públicos, con qué frecuencia cada zona registra actividad, y decirlo con honestidad sobre lo que no sabemos.»

## Capítulos del modo historia (7 min)

1. **¿Por qué tiembla Colombia?** Señale el nido de Bucaramanga y la costa Pacífica. Color = profundidad.
2. **El catálogo.** 66.987 eventos reales del SGC, 1993–2026. Cada punto es una fila con su incertidumbre.
3. **Preparación.** 13 reglas auditadas; solo se descartan 153 duplicados; nada se imputa.
4. **Zona-periodo.** La idea central: variables con el pasado, etiqueta con los 30 días siguientes.
5. **Probabilidad.** «20 % no dice cuál zona; dice que de cien parecidas, en veinte hubo evento.»
6. **Modelos.** Siete familias. En la cuadrícula de 50 km el PR-AUC pasa de 0,17 (línea base) a 0,35.
7. **Validación.** Siempre pasado → futuro, ocho bloques. Mencione el detector de fugas.
8. **Interpretación.** Lea en voz alta la frase de certeza.
9. **Limitaciones.** No es alerta; eventos grandes escasos; cambio de 2018; sin riesgo.
10. **Evolución.** Evaluación prospectiva, ETAS completo, exposición. Muestre el QR.

## Demostración en vivo (4 min)

1. **Atlas** (`G` `A`): `Ctrl K` → «Santander» → Enter. Cambie a «Columnas 3D» para mostrar la profundidad.
2. **Pronóstico** (`G` `P`): seleccione la zona con el valor más alto → «Explicar esta estimación». Muestre línea base, periodos parecidos y «esto no demuestra causalidad».
3. **Modelos** (`G` `M`): cambie a Departamento y M ≥ 4,0 → la línea base gana. «Cuando el modelo complejo no mejora, lo decimos.»
4. **Calidad** (`G` `C`): pestaña «Reglas y auditoría».

## Cierre (1 min)

> «El aporte no es un mapa de colores. Es un método reproducible: datos trazables, validación que respeta el tiempo y una interfaz que nunca presenta una probabilidad sin su incertidumbre.»

## Preguntas frecuentes del jurado

- **¿Esto predice terremotos?** No. Estima probabilidad de actividad por zona y periodo.
- **¿Por qué no usar redes neuronales?** Con tan pocos casos positivos sobreajustarían; el gradient boosting ya apenas supera a un modelo de conteos.
- **¿Cómo saben que no hay fuga de información?** Seis comprobaciones automáticas en cada experimento, incluida la reconstrucción de variables con el catálogo truncado.
- **¿Por qué una zona tiene 86 %?** Es el nido de Bucaramanga: sismos de magnitud 4 casi todos los meses, a unos 150 km de profundidad. Alta actividad, bajo impacto habitual: por eso actividad no es riesgo.
- **¿Qué tan actual es?** El catálogo incluido termina el 10 de octubre de 2026; el pipeline lo actualiza con tres comandos.
- **¿Qué falta para usarlo en gestión del riesgo?** Evaluación prospectiva, revisión por especialistas y datos de exposición y vulnerabilidad. Hoy es un prototipo académico.
