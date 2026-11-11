# Accesibilidad

## Lo que se comprueba solo

La prueba e2e `the main screens pass an accessibility check` pasa
[axe](https://github.com/dequelabs/axe-core) con las reglas WCAG 2.1 A y AA y
las buenas prácticas. Revisa la bienvenida, una nota abierta, la paleta, la
búsqueda, los ajustes, la exportación y el menú contextual, y falla si
encuentra algo. Se deja fuera el contenido de la nota, que es del usuario.

Lo que se corrigió al añadirla (#92):

- El editor no tenía nombre. Ahora se anuncia como «Texto de «nota.md»».
- El botón de cerrar estaba dentro de la pestaña. Ahora va al lado y queda
  oculto a los lectores de pantalla, porque la pestaña se cierra con `Supr` o
  `Ctrl+W` y desde su menú contextual.
- Los controles de la ventana quedaban fuera de cualquier región, y las vistas
  previas de exportar, Word y el creador de diagramas tenían nombre pero no
  rol.
- La ruta de los resultados de búsqueda no llegaba al contraste mínimo.

axe no sustituye a probar con un lector de pantalla de verdad.

## Prueba a mano con un lector de pantalla

Con NVDA en Windows, VoiceOver en macOS u Orca en Linux, y sin mirar la
pantalla en lo posible. Anota en #92 lo que no se entienda o no se pueda hacer.

**Arranque y barra lateral**

- [ ] Al abrir la app se anuncia algo que dice dónde estás.
- [ ] Con `Tab` se llega a los vaults y se oye su nombre.
- [ ] Las carpetas dicen si están abiertas o cerradas, y `Enter` las abre.
- [ ] Una nota se abre con `Enter` y el foco va al editor.

**Editor**

- [ ] El editor se anuncia con el nombre de la nota.
- [ ] Se puede escribir, moverse por líneas y oír el texto.
- [ ] En el modo visual, las casillas de tareas se pueden marcar.
- [ ] `Ctrl+S` y el autoguardado avisan de que se guardó.

**Pestañas**

- [ ] Las flechas recorren las pestañas y se oye cuál está seleccionada.
- [ ] `Supr` cierra la pestaña con el foco.
- [ ] El menú contextual (`Mayús+F10` o la tecla de menú) se abre y se recorre
  con flechas.

**Paleta y búsqueda**

- [ ] `Ctrl+P` abre la paleta, el campo tiene nombre y se oye la opción
  elegida al moverse con flechas.
- [ ] `Ctrl+Mayús+F` busca, y se oye cuántos resultados hay.

**Diálogos**

- [ ] Ajustes, Exportar y Word se anuncian con su título al abrirse.
- [ ] El foco no sale del diálogo con `Tab`, y `Esc` lo cierra y devuelve el
  foco a donde estaba.
- [ ] Los avisos (guardado, errores, cambios de fuera) se leen sin tener que
  ir a buscarlos.
