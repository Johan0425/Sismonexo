// Glosario del proyecto. Lo usan el centro de aprendizaje, la búsqueda global y el asistente Nexo.

export interface Term {
  id: string
  term: string
  short: string
  long: string
  aliases?: string[]
}

export const GLOSSARY: Term[] = [
  {
    id: 'actividad',
    term: 'Actividad sísmica',
    short: 'Lo que ya ocurrió y quedó registrado: cuántos sismos, dónde, a qué profundidad y de qué magnitud.',
    long: 'Describe el pasado observado en el catálogo. Es la materia prima de esta plataforma. No habla de daños ni de lo que ocurrirá.',
    aliases: ['sismicidad'],
  },
  {
    id: 'amenaza',
    term: 'Amenaza sísmica',
    short: 'Probabilidad de que el suelo de un lugar supere cierto nivel de movimiento en un periodo largo (decenas o cientos de años).',
    long: 'La calcula oficialmente el Servicio Geológico Colombiano con modelos de fuentes sismogénicas y atenuación. Se expresa, por ejemplo, como aceleración máxima del terreno (PGA) para un periodo de retorno de 475 años. No es lo mismo que el pronóstico experimental de 30 días de esta plataforma.',
    aliases: ['peligro sismico', 'pga'],
  },
  {
    id: 'exposicion',
    term: 'Exposición',
    short: 'Personas, edificaciones e infraestructura ubicadas donde puede sentirse un sismo.',
    long: 'Dos zonas con la misma amenaza pueden tener exposiciones muy distintas. Esta plataforma no incluye datos de exposición.',
  },
  {
    id: 'vulnerabilidad',
    term: 'Vulnerabilidad',
    short: 'Qué tan propensos al daño son los elementos expuestos (por ejemplo, según el tipo de construcción).',
    long: 'Depende de cómo se construyó y de las condiciones sociales. Esta plataforma no la evalúa.',
  },
  {
    id: 'riesgo',
    term: 'Riesgo sísmico',
    short: 'Pérdidas esperadas: resulta de combinar amenaza, exposición y vulnerabilidad.',
    long: 'Una probabilidad alta de actividad no equivale a riesgo alto, y viceversa. Esta plataforma estima probabilidad de actividad; no calcula riesgo.',
  },
  {
    id: 'magnitud',
    term: 'Magnitud',
    short: 'Medida del tamaño de un sismo. Cada unidad equivale a unas 32 veces más energía liberada.',
    long: 'El catálogo usa varios tipos: ML (local), MLr (local regionalizada, desde 2018), Mw (momento) y otros. No son estrictamente equivalentes entre sí, por lo que las series que mezclan tipos deben leerse con cautela.',
    aliases: ['ml', 'mw', 'mlr'],
  },
  {
    id: 'profundidad',
    term: 'Profundidad',
    short: 'Distancia vertical entre la superficie y el punto donde se inició la ruptura (hipocentro).',
    long: 'En Colombia hay sismicidad superficial (0–30 km), intermedia (por ejemplo, el nido de Bucaramanga, cerca de 150 km) y profunda. La profundidad es el parámetro peor resuelto; el catálogo marca los casos en que quedó fijada en 0 km.',
    aliases: ['hipocentro'],
  },
  {
    id: 'epicentro',
    term: 'Epicentro',
    short: 'Punto de la superficie situado justo encima del hipocentro.',
    long: 'Es la ubicación que se dibuja en el mapa. Tiene un error de localización que el catálogo reporta en kilómetros.',
  },
  {
    id: 'catalogo',
    term: 'Catálogo sísmico',
    short: 'Lista ordenada de sismos con fecha, ubicación, profundidad, magnitud y medidas de calidad.',
    long: 'Aquí se usa el catálogo instrumental de la Red Sismológica Nacional de Colombia (SGC), desde junio de 1993. Un catálogo nunca es completo: los sismos pequeños se detectan mejor donde y cuando hay más estaciones.',
  },
  {
    id: 'completitud',
    term: 'Magnitud de completitud (Mc)',
    short: 'Magnitud a partir de la cual el catálogo registra prácticamente todos los sismos.',
    long: 'Por debajo de Mc faltan eventos. Cambia con el tiempo y la región según la densidad de la red. Por eso un aumento de sismos pequeños puede deberse a mejor detección y no a más actividad.',
    aliases: ['mc', 'cobertura'],
  },
  {
    id: 'zona-periodo',
    term: 'Zona-periodo',
    short: 'Unidad de análisis: una zona (departamento, municipio o celda) observada durante un periodo (7, 30 o 90 días).',
    long: 'Cada fila de la tabla de modelado describe una zona en una fecha de origen con variables calculadas solo con el pasado, y una etiqueta que indica si en el periodo siguiente hubo al menos un sismo sobre el umbral.',
  },
  {
    id: 'probabilidad',
    term: 'Probabilidad',
    short: 'Número entre 0 % y 100 % que expresa con qué frecuencia se espera que ocurra algo en situaciones parecidas.',
    long: 'Una probabilidad de 20 % significa que, de cada 100 zonas-periodo similares, en unas 20 se observó al menos un evento. No dice en cuáles. Una probabilidad alta no es certeza y una baja no es ausencia de actividad.',
  },
  {
    id: 'tasa',
    term: 'Tasa esperada',
    short: 'Número promedio de eventos que el modelo espera en la zona durante el horizonte.',
    long: 'Puede ser fraccionaria (por ejemplo, 0,3 eventos en 30 días). Con una tasa λ, la probabilidad de al menos un evento en un proceso de Poisson es 1 − e^(−λ).',
  },
  {
    id: 'incertidumbre',
    term: 'Intervalo de incertidumbre',
    short: 'Rango en el que razonablemente puede estar el valor real, dado lo limitado de los datos.',
    long: 'Aquí se reporta con 90 %: se calcula con la frecuencia observada en la validación para zonas-periodo con probabilidades parecidas. Un intervalo ancho indica poca información.',
  },
  {
    id: 'linea-base',
    term: 'Línea base',
    short: 'Modelo más simple posible: la frecuencia histórica de cada zona.',
    long: 'Todo modelo más complejo debe compararse contra ella. Si no la supera con claridad, la complejidad adicional no se justifica.',
    aliases: ['baseline'],
  },
  {
    id: 'walk-forward',
    term: 'Validación walk-forward',
    short: 'Forma de evaluar que respeta el tiempo: se entrena con el pasado y se prueba con el periodo siguiente, avanzando por bloques.',
    long: 'Evita que el modelo «vea» el futuro. Entre entrenamiento, validación y prueba se deja una separación igual al horizonte, para que ninguna ventana de etiqueta se solape con el bloque siguiente.',
    aliases: ['validacion cronologica', 'validacion temporal'],
  },
  {
    id: 'fuga',
    term: 'Fuga de información',
    short: 'Error que ocurre cuando un modelo usa, sin querer, datos que no estarían disponibles al momento de pronosticar.',
    long: 'Produce métricas engañosamente buenas. Esta plataforma ejecuta seis comprobaciones automáticas: variables con datos futuros, escaladores ajustados con todo el conjunto, duplicados, ventanas superpuestas, réplicas repartidas y variable objetivo entre las entradas.',
    aliases: ['leakage'],
  },
  {
    id: 'calibracion',
    term: 'Calibración',
    short: 'Un modelo está calibrado si, cuando dice 30 %, el evento ocurre cerca del 30 % de las veces.',
    long: 'Se revisa con la curva de fiabilidad. Aquí se usa calibración isotónica ajustada solo con el bloque de validación.',
  },
  {
    id: 'brier',
    term: 'Brier score',
    short: 'Error cuadrático medio entre la probabilidad pronosticada y lo que ocurrió (0 o 1). Menor es mejor.',
    long: 'Va de 0 (perfecto) a 1. Premia a la vez la discriminación y la calibración. Con eventos raros todos los modelos tienen valores bajos, por lo que conviene mirar la mejora relativa frente a la línea base (Brier skill score).',
    aliases: ['brier score', 'puntaje de brier'],
  },
  {
    id: 'pr-auc',
    term: 'PR-AUC',
    short: 'Área bajo la curva precisión-recall. Resume qué tan bien el modelo ordena los casos cuando los positivos son escasos. Mayor es mejor.',
    long: 'Con eventos raros es más informativa que la exactitud (accuracy) y que el ROC-AUC. Su valor de referencia es la prevalencia: un modelo sin información obtiene un PR-AUC igual a la proporción de positivos.',
    aliases: ['precision recall'],
  },
  {
    id: 'roc-auc',
    term: 'ROC-AUC',
    short: 'Probabilidad de que el modelo asigne un valor mayor a un caso positivo que a uno negativo tomado al azar.',
    long: 'Vale 0,5 para un modelo sin información y 1 para uno perfecto. Con clases muy desbalanceadas puede verse alto aunque el modelo tenga poca utilidad práctica.',
  },
  {
    id: 'log-loss',
    term: 'Log-loss',
    short: 'Penaliza con fuerza las probabilidades muy seguras que resultan equivocadas. Menor es mejor.',
    long: 'Es el criterio con el que se elige el modelo por defecto, usando solo los bloques anteriores a la prueba final.',
  },
  {
    id: 'precision-recall',
    term: 'Precisión y recall',
    short: 'Precisión: de las zonas señaladas, cuántas tuvieron evento. Recall: de las zonas con evento, cuántas fueron señaladas.',
    long: 'Dependen del umbral de decisión. F1 es su media armónica.',
    aliases: ['f1', 'sensibilidad'],
  },
  {
    id: 'shap',
    term: 'SHAP',
    short: 'Método que reparte la estimación de un modelo entre sus variables: cuánto empujó cada una hacia arriba o hacia abajo.',
    long: 'Describe el comportamiento del modelo, no la física de los sismos. Una contribución alta no demuestra causalidad.',
    aliases: ['explicabilidad'],
  },
  {
    id: 'etas',
    term: 'ETAS',
    short: 'Modelo estadístico de sismicidad en el que cada sismo eleva temporalmente la tasa de sismos cercanos.',
    long: 'Epidemic-Type Aftershock Sequence. Aquí se usa una versión simplificada («tasa inspirada en ETAS») con parámetros fijos; no es un ajuste ETAS completo.',
    aliases: ['replicas', 'omori'],
  },
  {
    id: 'replica',
    term: 'Réplica',
    short: 'Sismo que sigue a otro mayor en la misma región, dentro de una secuencia.',
    long: 'Las réplicas agrupan la actividad en el tiempo y el espacio. Si una misma secuencia queda repartida entre entrenamiento y prueba, las métricas se inflan.',
  },
  {
    id: 'h3',
    term: 'Celda H3',
    short: 'Hexágono de una malla global jerárquica. Aquí se usa la resolución 4 (unos 1.770 km² por celda).',
    long: 'Los hexágonos tienen vecinos equidistantes, lo que facilita medir actividad en el entorno.',
    aliases: ['hexagono'],
  },
  {
    id: 'gutenberg-richter',
    term: 'Ley de Gutenberg–Richter',
    short: 'Relación empírica: por cada unidad de magnitud, los sismos son unas diez veces menos frecuentes.',
    long: 'Se resume con el valor b, cercano a 1 en muchas regiones. Explica por qué los eventos grandes son raros y difíciles de modelar.',
    aliases: ['valor b'],
  },
]

export const findTerm = (id: string) => GLOSSARY.find((t) => t.id === id)
