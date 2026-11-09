# Sistema de diseño

La interfaz de UltimateMD se construye con unas pocas escalas fijas, definidas como variables CSS en [`src/app.css`](../src/app.css). Si todos los componentes usan los mismos pasos, la app se ve coherente sin tener que pensarlo en cada pantalla.

**La regla:** en el CSS de la interfaz no se escriben píxeles sueltos para espacios, radios, tamaños de letra, sombras ni capas. Se usa la variable correspondiente. `npm run lint`, que también se ejecuta en el CI, falla si alguien lo hace ([`scripts/check-tokens.mjs`](../scripts/check-tokens.mjs)).

## Color

Cada tema define solo sus colores base. La app los publica como variables al cambiar de tema ([`src/lib/themes.ts`](../src/lib/themes.ts)), y todos los temas cumplen los contrastes mínimos, comprobados en los tests.

| Variable | Uso |
|---|---|
| `--bg` | Fondo del documento y de los campos |
| `--panel` | Barra lateral, pestañas y barras |
| `--raised` | Diálogos, menús y avisos, lo que flota |
| `--line` | Bordes y separadores |
| `--text`, `--text-2`, `--text-3` | Texto principal, secundario y terciario (pistas, números de línea) |
| `--accent`, `--accent-text`, `--on-accent` | Color de acción: relleno, texto sobre fondo normal y texto sobre el acento |
| `--danger`, `--warn` | Borrar y avisos |
| `--syn-*` | Resaltado de código en el editor |

Los tintes se derivan de los colores base, así que un tema nuevo no tiene que definirlos:

| Variable | Uso |
|---|---|
| `--hover` | Fondo al pasar el ratón |
| `--accent-soft` | Elemento activo o seleccionado (pestaña, botón pulsado) |
| `--selection` | Texto seleccionado |
| `--found` | Palabras encontradas por una búsqueda |

## Espacio

Pasos de 4 px, con medios pasos en la zona pequeña, donde 2 px se notan.

| Variable | Valor | Uso típico |
|---|---|---|
| `--space-0-5` | 2 px | Separación entre elementos pegados |
| `--space-1` | 4 px | Dentro de botones pequeños |
| `--space-1-5` | 6 px | Entre icono y texto |
| `--space-2` | 8 px | Relleno de elementos de lista y botones |
| `--space-2-5` | 10 px | Relleno de campos |
| `--space-3` | 12 px | Entre grupos de controles |
| `--space-3-5` | 14 px | Relleno de paneles compactos |
| `--space-4` | 16 px | Relleno de paneles y diálogos |
| `--space-5` | 20 px | Entre secciones |
| `--space-6` | 24 px | Márgenes de diálogos grandes |
| `--space-8` | 32 px | Separaciones grandes |

Para un margen negativo: `calc(var(--space-2) * -1)`.

## Radios

| Variable | Valor | Uso |
|---|---|---|
| `--radius-2xs` | 2 px | Marcas pequeñas: resaltados, el punto de color de un vault |
| `--radius-xs` | 4 px | Etiquetas y elementos muy pequeños |
| `--radius-sm` | 6 px | Botones, iconos y elementos de lista |
| `--radius-md` | 8 px | Campos, tarjetas y bloques |
| `--radius-lg` | 10 px | Menús y diálogos |
| `--radius-xl` | 12 px | Diálogos grandes |

Un círculo sigue siendo `50%`.

## Tipografía

Tres familias: `--sans` (Inter) para la interfaz, `--serif` (Source Serif 4) para el texto de algunos temas y `--mono` (JetBrains Mono) para el editor y el código.

| Variable | Valor | Uso |
|---|---|---|
| `--font-xs` | 11,5 px | Pistas, números de línea, metadatos |
| `--font-sm` | 12,5 px | Texto secundario, listas densas |
| `--font-md` | 13 px | Controles: botones, campos, menús |
| `--font-base` | 14 px | Texto normal de la interfaz |
| `--font-lg` | 15 px | Títulos de diálogo |
| `--font-xl` | 20 px | Títulos de pantalla |
| `--font-2xl` | 26 px | Títulos destacados, como la bienvenida |

## Elevación

| Variable | Uso |
|---|---|
| `--shadow-sm` | Un control que sobresale un poco: el segmento activo |
| `--shadow-md` | Una hoja de papel sobre un fondo: las páginas de la vista previa de exportación |
| `--shadow-lg` | Lo que flota sobre la página: diálogos, menús y avisos |

Los anillos (`0 0 0 1px …`) y las líneas interiores (`inset`) no son elevación sino bordes dibujados con sombra, y se escriben tal cual.

## Capas

De abajo arriba. Un diálogo que se abre desde otro diálogo usa `nested`.

| Variable | Valor | Qué hay |
|---|---|---|
| `--z-raised` | 5 | Tiradores sobre el contenido |
| `--z-scrim`, `--z-dialog` | 30, 31 | Fondo oscurecido y diálogo |
| `--z-nested-scrim`, `--z-nested` | 32, 33 | Diálogo dentro de otro |
| `--z-menu` | 40 | Menús contextuales |
| `--z-confirm-scrim`, `--z-confirm` | 50, 51 | Preguntas y confirmaciones, sobre cualquier diálogo |
| `--z-toast` | 60 | Avisos |
| `--z-tour-scrim`, `--z-tour` | 70, 71 | El tutorial, por encima de todo |

## Movimiento

| Variable | Valor | Uso |
|---|---|---|
| `--duration-fast` | 120 ms | Cambios de color y de fondo |
| `--duration-base` | 180 ms | Aparecer y desaparecer |
| `--ease` | 120 ms ease-out | Abreviatura para `transition` |

Con «reducir movimiento» activado en el sistema, `--ease` vale 0 y nada se anima.

## Lo que queda fuera

- **El contenido de la nota** ([`src/lib/preview.css`](../src/lib/preview.css)) tiene su propia tipografía en `em`, porque es el documento y también se exporta.
- **El texto del editor** mantiene su tamaño propio, que es el del documento que se escribe.
- Las líneas de 1 px y los círculos al 50 % se escriben tal cual.
