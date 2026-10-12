# Sistema de diseño

Página de prueba viva: `/#/sistema` (todos los componentes, con el contraste medido en el tema actual). Fuentes: `web/src/styles/tokens.css`, `app.css` y `web/src/components/ui.tsx`.

## Principios

1. **El color pertenece a los datos.** La interfaz usa grises y un solo acento (azul petróleo); las escalas de color se reservan para mapas y gráficos.
2. **Superficies sólidas.** El vidrio (desenfoque) aparece solo en la barra superior, los controles e inspectores sobre el mapa, hojas, ventanas y el panel de reproducción.
3. **Jerarquía por tipografía y espacio**, no por cajas: títulos compactos (máximo 36 px), cuerpo de 16 px, nada por debajo de 12 px, cifras tabulares.
4. **Movimiento con propósito.** 160–220 ms para retroalimentación, ~340 ms para paneles; nada se mueve de forma perpetua y todo respeta `prefers-reduced-motion` y la preferencia de la aplicación.
5. **Nunca solo color.** La probabilidad se comunica con color, patrón, etiqueta, porcentaje e intervalo; los estados llevan icono y texto.

## Tokens

| Token | Claro | Oscuro |
|---|---|---|
| Fondo general | `#f4f5f3` | `#0e1113` |
| Superficie | `#ffffff` | `#171b1e` |
| Superficie secundaria | `#eceeed` | `#20262a` |
| Texto principal | `#1b1f23` | `#f3f1ec` |
| Texto secundario | `#55606a` | `#adb5bb` |
| Acento | `#0b5f6b` | `#63bcc2` |
| Precaución · crítico · positivo | `#8a5a00` · `#a8321f` · `#1d6b4a` | `#e2b25a` · `#f0907c` · `#77c9a2` |

Contraste medido: texto secundario sobre superficie 6,4:1 (claro) y 8,3:1 (oscuro); acento sobre superficie 7,3:1 y 9,5:1. Todas las combinaciones de texto superan 4,5:1.

Espaciado en retícula de 4 px; radios de 6, 10, 14 y 20 px; controles de 44 px de alto como mínimo. Tipografía: fuente del sistema (SF Pro en dispositivos Apple; Segoe UI, Inter o Roboto en el resto), sin descargar fuentes.

## Escalas de datos

- **Probabilidad**: seis clases sobre viridis — muy baja (< 1 %), baja (1–5 %), moderada (5–15 %), media (15–35 %), alta (35–65 %), muy alta (> 65 %) — cada una con un patrón distinto (liso, puntos, líneas, líneas densas, cuadrícula, sólido).
- **Profundidad**: cinco clases sobre viridis invertida (0–30, 30–60, 60–150, 150–300, > 300 km).
- **Magnitud y calor**: inferno. **Incertidumbre y calidad**: cividis. **Diferencias**: divergente azul–ocre (nunca rojo–verde).

## Componentes

Botones (primario, secundario, contorno, discreto, de icono), campos con ayuda y error enlazados, selector, control segmentado, interruptor, deslizador con advertencia, pestañas, tarjetas, indicadores, notas, etiquetas de estado, tooltip accesible, ventana modal y hoja lateral (inferior con resorte en teléfono) con foco atrapado, paleta de comandos, avisos temporales, esqueletos de carga, estados vacío, de error y de conexión interrumpida, escala y valor de probabilidad, leyendas y controles del mapa, y el marco de gráficos (resumen, tabla alternativa, PNG y CSV).

## Identidad

Logotipo original (`web/src/components/Logo.tsx`): silueta abstracta de Colombia, malla geográfica, traza sísmica y punto de epicentro. Una sola tinta (`currentColor`); la malla se omite por debajo de 40 px para que el símbolo siga siendo legible a 24 px. La traza sísmica es la firma visual y se usa estática.

## Accesibilidad

Enlace para saltar al contenido, foco visible de 3 px, encabezados y regiones con nombre, región viva para anunciar cambios de filtros, alternativa tabular en cada gráfico y mapa, áreas táctiles de 44 px, zoom al 200 % sin pérdida, y verificación automática con axe (WCAG 2.2 AA) en ambos temas.
