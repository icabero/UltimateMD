<p align="center"><img src="site/img/icon.png" width="84" alt=""></p>
<h1 align="center">UltimateMD</h1>
<p align="center">Tus notas en Markdown, convertidas en documentos de verdad.</p>
<p align="center">
  <a href="https://icabero.github.io/UltimateMD/"><strong>Web</strong></a> ·
  <a href="https://github.com/icabero/UltimateMD/releases/latest"><strong>Descargar</strong></a> ·
  <a href="https://github.com/icabero/UltimateMD/issues">Issues</a>
</p>
<p align="center">
  <a href="https://github.com/icabero/UltimateMD/actions/workflows/ci.yml"><img src="https://github.com/icabero/UltimateMD/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/licencia-MIT-blue" alt="Licencia MIT"></a>
</p>

![UltimateMD en modo visual, con una nota formateada, tareas y una tabla](site/img/visual.png)

**[Visita la web de UltimateMD](https://icabero.github.io/UltimateMD/)** para ver qué puede hacer y descargarla.

UltimateMD es un editor libre para Windows, macOS y Linux. Tus notas siguen siendo archivos `.md` en carpetas normales, sin base de datos ni formato propio, así que también puedes abrir un vault de Obsidian tal cual.

## Qué puedes hacer

- **Trabajar con varios vaults a la vez**, en una sola ventana, con pestañas de cualquiera de ellos.
- **Editar en modo visual**, con formato mientras escribes y barra de herramientas, o en Markdown con vista dividida. El archivo siempre sigue siendo Markdown normal.
- **Enlazar notas** escribiendo `[[` o con un botón, con sugerencias y un clic para abrirlas. Al renombrar o mover una nota, sus enlaces se actualizan solos.
- **Moverte rápido** con autoguardado, selector rápido y búsqueda global que no distingue acentos y abre la nota en la línea encontrada.
- **Dibujar diagramas** Mermaid y D2 dentro de la nota, sin conexión: con un creador visual para los más habituales y plantillas para todos los demás.
- **Exportar** una nota, una carpeta o un vault a PDF, Word o HTML, con vista previa.
- **Usar tus plantillas de Word**, conservando portada, cabeceras, estilos e índice.
- **Conectar tu IA** por MCP, con permisos por vault.
- **Personalizarla** con ocho temas y temas propios por vault, nota o diagrama.
- **Abrir `.md` sueltos** y usarla como programa por defecto.
- **Usarla en castellano, euskera o inglés**, con un tutorial la primera vez y aviso de nuevas versiones.

## Instalación

Descarga el instalador de tu sistema desde [Releases](https://github.com/icabero/UltimateMD/releases/latest).

| Sistema | Archivo |
|---|---|
| Windows | `.exe`, que deja elegir idioma, o `.msi` |
| macOS | `.dmg`, para Apple Silicon o Intel |
| Linux | AppImage, `.deb` o `.rpm` |

Los instaladores aún no están firmados:

- **Windows:** en el aviso de SmartScreen, pulsa **Más información → Ejecutar de todas formas**.
- **macOS:** abre la app con clic derecho → **Abrir**.

### Programa por defecto

- **Windows:** en Ajustes, abre las aplicaciones predeterminadas y elige UltimateMD para `.md`. Windows no permite que una app se asigne sola.
- **macOS:** en el Finder, abre la información de un `.md`, elige UltimateMD en "Abrir con" y pulsa "Cambiar todo".
- **Linux:** con el paquete `.deb` o `.rpm`, usa el botón de Ajustes. Un AppImage no se integra en el sistema.

## Conectar una IA por MCP

Abre **Ajustes → Inteligencia artificial** en la app: allí tienes la configuración lista para copiar en Claude Code, Claude Desktop, Cursor y otros clientes. El servidor es un programa local que se comunica por stdio y **funciona aunque la app esté cerrada**. Si está abierta, ves los cambios al momento.

| Nivel de acceso | La IA puede |
|---|---|
| Desactivado | Nada; ni siquiera ve que el vault existe |
| Lectura (por defecto) | Listar, leer, buscar y consultar enlaces |
| Lectura y escritura | Además, crear, modificar, mover y enviar a la papelera |

Herramientas: `list_vaults`, `list_notes`, `read_note`, `search_notes`, `get_backlinks`, `create_note`, `update_note`, `append_note`, `move_note` y `delete_note`.

## Exportar

![Diálogo de exportación con vista previa](site/img/export.png)

Pulsa `Ctrl+E`. Lo exportado usa un aspecto de documento, sea cual sea el tema activo. Los diagramas conservan el estilo que les hayas dado, salvo los temas oscuros, pensados para pantalla y no para papel.

- **Alcance:** la nota, una carpeta o el vault. Las notas salen en orden natural: primero las de cada carpeta y luego sus subcarpetas. Usa prefijos como `01-` para fijar el orden.
- **Carpetas:** cada nivel puede ser un título, un estilo de tu plantilla o no aparecer, con salto de página opcional. Los títulos de las notas bajan de nivel para encajar.
- **PDF:** se compone directamente con un motor tipográfico integrado, sin diálogo de impresión, con portada e índice opcionales.
- **Word:** la nota se escribe dentro de una copia de tu plantilla. Incluye una plantilla de ejemplo que puedes guardar y adaptar.
- **Word por vault:** cada vault puede llevar su propia plantilla y ajustar títulos, texto, tablas, imágenes y código, con una muestra en directo. Se abre desde el icono de Word junto al nombre del vault. Los estilos de títulos numerados de la plantilla se detectan solos.

Marcadores para tu plantilla:

| Marcador | Se sustituye por |
|---|---|
| `{{contenido}}` | El texto. Sin este marcador, va al final del documento |
| `{{titulo}}` | El título del frontmatter, el primer encabezado o el nombre del archivo o carpeta |
| `{{autor}}`, `{{fecha}}` | Esos datos del frontmatter. La fecha, si falta, es la de hoy |
| `{{cualquier-dato}}` | Ese campo del frontmatter |

Si el documento tiene índice, pulsa sobre él y luego `F9` en Word para que muestre los números de página.

## Diagramas

![Creador de diagramas con el formulario a la izquierda y el dibujo a la derecha](site/img/diagramas.png)

Pulsa **Diagrama** en la barra del editor y créalo con un formulario, viendo el resultado al momento. Hay formularios para flujos, secuencias, estados, mapas mentales, tartas y Gantt; flujos y secuencias pueden guardarse en Mermaid o D2.

**Más tipos** ofrece una plantilla editable para el resto: clases, entidad-relación, líneas de tiempo, Kanban, barras, Sankey, arquitectura y otros, además de tablas de base de datos y rejillas en D2.

En modo visual, pulsa sobre un diagrama para abrirlo. También puedes escribirlo a mano con un bloque `mermaid` o `d2`:

````markdown
```mermaid
flowchart LR
  A[Idea] --> B{¿Vale la pena?}
  B -->|Sí| C[Hacerla]
```

```d2
direction: right
app: UltimateMD { shape: hexagon }
disco: Vaults { shape: cylinder }
app -> disco: lee y escribe
```
````

## Temas

![Selector de temas](site/img/temas.png)

Cada vault puede tener temas propios, creados desde **Ajustes → Vaults → Temas**. Se guardan en `.ultimatemd/temas/` y viajan con él. Gana la capa más específica: nota, vault y aplicación. La interfaz sigue siempre el tema de la aplicación.

Los diagramas tienen su propio estilo, que eliges con el botón **Estilo** de la barra para toda la nota o todo el vault. Un diagrama concreto puede ir por libre desde **Apariencia de este diagrama**, con su tema, sus colores o un aspecto de boceto a mano.

Todo queda en tus archivos, por si prefieres escribirlo a mano:

```yaml
---
tema: corporativo
tema-diagramas: boceto
---
```

````markdown
```mermaid tema=sepia relleno=#ffeecc
flowchart LR
  A --> B
```
````

## Privacidad y seguridad

- Tus notas no salen de tu equipo. La app solo se conecta a internet para preguntar a GitHub si hay una versión nueva; puedes desactivarlo en **Acerca de**.
- La IA y la app solo llegan a archivos dentro del vault. Se bloquean `..`, los enlaces simbólicos que salen de él y las carpetas ocultas como `.git`. El MCP solo accede a notas.
- Borrar siempre envía a la papelera del sistema.
- El HTML dentro de una nota se muestra sin scripts. Los archivos `.html` se abren en un marco aislado, sin acceso a la app ni a la red, y sus scripts van desactivados salvo que los permitas en ese vault.
- Un archivo suelto solo da acceso a ese archivo y a las imágenes de su carpeta.
- Los temas son datos validados, sin CSS, y una nota nunca se ejecuta como código al exportar.

## Compilar desde el código

Necesitas [Rust](https://rustup.rs), Node.js y las [dependencias de Tauri](https://tauri.app/start/prerequisites/) de tu sistema.

```sh
npm install
npm run dev     # abre la app
npm run build   # crea los instaladores para tu sistema
```

Los espacios, radios, tamaños de letra, sombras y capas de la interfaz siguen el [sistema de diseño](docs/sistema-de-diseno.md); `npm run lint` avisa si se escribe un valor suelto.

Las capturas de `site/img` salen de la interfaz real, con un vault de ejemplo inventado: `npm run screenshots` las vuelve a generar.

## Contribuir

El código es abierto y puedes usarlo, estudiarlo o adaptarlo con su licencia. El desarrollo es privado por ahora: no se aceptan pull requests sin acuerdo previo. Si encuentras un fallo o tienes una idea, abre una [issue](https://github.com/icabero/UltimateMD/issues). Para avisar de un problema de seguridad, sigue la [política de seguridad](SECURITY.md).

## Licencia

[MIT](LICENSE)
