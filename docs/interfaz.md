# Inventario de la interfaz

Qué hay en cada pantalla, menú y barra de UltimateMD, y cómo se llega a cada acción. Sirve para detectar lo que solo se alcanza por un camino oculto (clic derecho, solo la paleta) y para que la misma acción se llame igual en todas partes. Se revisó en el issue #179.

## Criterios

- Lo frecuente está a la vista: nueva nota, buscar, ajustes del vault, ajustes de la nota, vistas, negrita, listas, enlaces.
- Lo poco usado está agrupado en un menú **Más** (en inglés **More**, en euskera **Gehiago**), con el botón de tres puntos. Se abre con clic, Intro o Espacio, se recorre con las flechas, `Esc` lo cierra y devuelve el foco al botón.
- Nada es alcanzable solo desde la paleta: cada comando de la paleta tiene también un botón, menú o pantalla.
- Cada pantalla y cada ajuste tiene su comando en la paleta (`Ctrl+Mayús+P`).
- Una acción se llama igual en el botón (título), en el menú y en la paleta, en es, en y eu. Los textos de las tres lenguas salen de la misma clave.

## Barras y su contenido

### Barra lateral (cabecera de la app)

| Control | Qué hace | Antes | Ahora |
| --- | --- | --- | --- |
| Buscar | Búsqueda en todos los vaults (`Ctrl+Mayús+F`) | Botón | Botón |
| Ajustes de la app | Abre los ajustes de la app | Botón («Ajustes y MCP») | Botón («Ajustes de la app») |
| Más | Acciones, atajos, tutorial, novedades, vault de ejemplo, Acerca de | No existía; Acerca de era un botón | Menú nuevo |
| Ocultar la barra lateral | `Ctrl+Mayús+E` | Botón | Botón |

### Barra lateral (cada vault)

| Control | Qué hace | Antes | Ahora |
| --- | --- | --- | --- |
| Nueva nota | Crea una nota en la raíz | Botón | Botón |
| Abrir la nota de hoy | Nota diaria | Botón («Hoy: abrir la nota de hoy») | Botón («Abrir la nota de hoy») |
| Ajustes del vault | Pantalla de ajustes del vault | Botón | Botón |
| Git | Cambios del vault (solo si es un repositorio) | Botón | Botón |
| Más | Ordenar, nueva nota, plantilla, hoy, nueva carpeta, leer el vault, enlaces rotos, actividad de la IA, mostrar en el explorador, ajustes, cerrar | Solo con clic derecho en el nombre | Botón visible, además del clic derecho |
| Nueva carpeta | Crea una carpeta | Botón | En Más y en la paleta |
| Ordenar | Orden de las notas | Botón | En Más, en la paleta y en los ajustes del vault |
| Leer el vault de arriba abajo | Lector | Botón | En Más y en la paleta |

### Pestañas y vistas (barra superior de la nota)

| Control | Qué hace | Antes | Ahora |
| --- | --- | --- | --- |
| Visual, Editar, Dividido, Vista previa | Cambia la vista (`Ctrl+\`) | Botones | Botones |
| Exportar la nota | Exportar a PDF, Word o HTML (`Ctrl+E`) | Botón («Exportar») | Botón («Exportar la nota») |
| Panel de la nota | Esquema, enlaces, Nota, historial (`Ctrl+Mayús+O`) | Botón | Botón |
| Más | Modo concentración, máquina de escribir, guardar como plantilla | No existía | Menú nuevo |
| Modo concentración | Solo la nota (`Ctrl+Mayús+Intro`) | Botón | En Más y en la paleta |
| Clic derecho en una pestaña | Cerrar, fijar, abrir al lado, copiar enlace, mostrar en el explorador | Clic derecho | Sin cambios (las acciones de cerrar también están en la paleta) |

### Barra de formato (encima de la nota)

| Control | Antes | Ahora |
| --- | --- | --- |
| Título (menú), negrita, cursiva | Visible | Visible |
| Lista, lista numerada, lista de tareas | Visible | Visible |
| Enlace, tabla, enlazar nota, diagrama | Visible | Visible |
| Tachado, código, fórmula, cita, línea separadora | Visible | En Más |
| Estilo de los diagramas (de la nota) | Botón «Estilo» | En Más y en la paleta |

### Paleta (`Ctrl+Mayús+P` para acciones, `Ctrl+P` para notas, `#` para títulos)

Reúne todas las acciones. Las nuevas de este repaso:

| Comando | Para qué |
| --- | --- |
| Nueva carpeta | Crear una carpeta en el vault de la nota abierta |
| Añadir a favoritos / Quitar de favoritos | Marcar la nota |
| Copiar enlace a la nota | Portapapeles |
| Cambiar el nombre | Renombrar la nota abierta |
| Mostrar en el explorador | Abrir la carpeta de la nota |
| Fijar la pestaña / Soltar la pestaña | Fijar la pestaña actual |
| Estilo de los diagramas de esta nota | Abre la pestaña «Nota» del panel |
| Estilo de diagramas para la IA | Guía de estilo del vault, en los ajustes del vault |
| Notas diarias de este vault | Ajustes de las notas diarias |
| Ordenar las notas | Orden del vault, en los ajustes del vault |
| Git en {vault} | Pantalla de cambios, si el vault es un repositorio |
| Crear vault, Abrir carpeta | Igual que los botones de la barra lateral |

## Pantallas y cómo se abren

| Pantalla | Cómo se abre | Comando de la paleta |
| --- | --- | --- |
| Ajustes de la app (General, Apariencia, Vaults, IA) | Botón de ajustes de la cabecera | Ajustes de la app |
| Ajustes del vault (General, Aspecto, Diagramas, Word, Notas diarias, IA) | Botón de ajustes de cada vault, Más del vault | Ajustes del vault, Temas, Diagramas, Word, Notas diarias, Acceso de la IA |
| Ajustes de la nota (pestaña «Nota» del panel derecho) | Botón del panel de la nota | Ajustes de esta nota |
| Esquema, Enlaces, Historial (panel derecho) | Pestañas del panel | Ver el esquema, los enlaces, el historial |
| Búsqueda en todos los vaults (Buscar, Reemplazar, Etiquetas) | Botón de buscar | Buscar en todos los vaults |
| Exportar (PDF, Word, HTML) | Botón de exportar | Exportar la nota |
| Lector del vault o de una carpeta | Más del vault, clic derecho en una carpeta | Leer el vault de arriba abajo |
| Git | Botón de Git del vault | Git en {vault} |
| Enlaces rotos | Más del vault | Enlaces rotos |
| Actividad de la IA | Más del vault, ajustes del vault | Actividad de la IA |
| Atajos de teclado | Más de la app | Ver todos los atajos |
| Tutorial | Más de la app, ajustes de la app | Ver el tutorial |
| Novedades | Más de la app | Novedades de esta versión |
| Vault de ejemplo | Más de la app, tutorial, inicio | Crear un vault de ejemplo |
| Acerca de | Más de la app | Acerca de UltimateMD |
| Plantillas | Más del vault, clic derecho | Nueva nota desde plantilla |

## Menús contextuales (clic derecho o `Mayús+F10`)

| Dónde | Acciones | ¿Se alcanzan sin clic derecho? |
| --- | --- | --- |
| Nota o carpeta del árbol | Nuevo, plantilla, carpeta, leer, aspecto, abrir al lado, favorito, copiar enlace, mover, copiar ruta, mostrar, renombrar (`F2`), papelera (`Supr`) | Sí: los atajos, la paleta (favorito, enlace, renombrar, mostrar) y la barra |
| Nombre del vault | Lo mismo que el botón Más del vault | Sí: botón Más |
| Pestaña | Cerrar, cerrar otras, fijar, abrir al lado, copiar enlace, mostrar | Sí: paleta y atajos |
| Favorito | Abrir al lado, quitar | Sí: paleta |

## Nombres que no coincidían y se unificaron

| Acción | Antes | Ahora (es) |
| --- | --- | --- |
| Ajustes de la app | «Ajustes y MCP» (botón) y «Abrir los ajustes» (paleta) | «Ajustes de la app» |
| Ajustes de la nota | «Editar las propiedades de la nota» (paleta) y «Nota» (pestaña) | «Ajustes de esta nota» y «Nota» (pestaña) |
| Nota de hoy | «Hoy: abrir la nota de hoy» (botón) y «Abrir la nota de hoy» (paleta) | «Abrir la nota de hoy» |
| Leer el vault | «Leer el vault de arriba abajo» (menú) y «Leer el vault de la nota de arriba abajo» (paleta) | «Leer el vault de arriba abajo» |
| Buscar | «Buscar en todo» (inicio) y «Buscar en todos los vaults» (paleta) | «Buscar en todos los vaults» |
| Acciones | «Acciones» (inicio) y «Buscar una acción» (atajos) | «Buscar una acción» |
| Exportar | «Exportar» (botón) y «Exportar la nota» (paleta) | «Exportar la nota» |
| Más | No existía | «Más» / «More» / «Gehiago» |

## Buscador de ajustes

El buscador de los ajustes de la app (#136) encuentra los ajustes de la app, de cada vault abierto y de la nota abierta. Se revisó que cada ajuste con pantalla propia tenga entrada, y se añadieron la carpeta, el nombre y la plantilla de las notas diarias y el estilo de diagramas para la IA. Los resultados dicen dónde están («Ajustes de Trabajo › Notas diarias», «Nota › Propiedades»).

## Primeros pasos

El tutorial tiene un paso nuevo, «Cada ajuste, en su sitio», que enseña dónde están los ajustes de la app, del vault (botón junto al nombre del vault) y de la nota (pestaña «Nota» del panel derecho), el buscador de ajustes, los menús «Más» y la paleta.

## Cómo mantenerlo

- Una acción nueva se añade con su comando en `Palette.svelte` y con una clave de texto única que usen el botón, el menú y la paleta.
- Si es poco usada, va en el menú Más que le toque; si es frecuente, a la vista.
- Un ajuste nuevo se añade a `src/lib/settingsIndex.ts` con el mismo `data-setting` en su pantalla.
- Nunca se usan atajos `Ctrl+Alt+<carácter>`: en los teclados españoles esa combinación es AltGr.
