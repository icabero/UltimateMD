# Rendimiento con vaults grandes

Medido para la versión 0.7 (#80), con un vault inventado de 10 000 notas
(unos 20 MB). Tiene 100 carpetas de 100 notas, cada nota con frontmatter,
títulos, tres enlaces, etiquetas, y algunas con tablas, imágenes y diagramas.

## Cómo repetirlo

```sh
# El motor: abrir, árbol, búsqueda, etiquetas, enlaces y exportación.
cargo run --release -p ultimatemd-pdf --example bench_vault -- 10000

# La interfaz: el árbol con una carpeta de 2000 notas abierta.
npx playwright test -g "10 000 notes"
```

El primero imprime una tabla como la de abajo. Si le pasas una carpeta como
segundo argumento, deja el vault allí para abrirlo en la app.

## Resultados

Windows 11, 16 hilos y SSD, con el antivirus de Windows activo, mediana de
tres pasadas.

| Operación | Antes | Ahora |
|---|---:|---:|
| Listar las notas | 21 ms | 20 ms |
| Leer el árbol | 22 ms | 21 ms |
| Notas recientes | 21 ms | 19 ms |
| Buscar una palabra | 2673 ms | 880 ms |
| Buscar una frase, `tag:` o `/regex/` | 2259–2397 ms | 751–867 ms |
| Contar etiquetas | 2182 ms | 643 ms |
| Enlaces de una nota (panel de enlaces) | 7590 ms | 584 ms |
| Enlaces rotos del vault | 7619 ms | 679 ms |
| Exportar 100 notas a Word / PDF | 10 / 36 ms | igual |
| Exportar 1000 notas a Word / PDF | 167 / 401 ms | igual |

En la interfaz (prueba e2e): el vault se abre en unos 250 ms, una carpeta de
2000 notas se despliega en unos 200 ms y una nota se abre en unos 140 ms con
esa carpeta abierta.

## Qué se cambió

- **Leer el vault entero.** `VaultFs::read` comprueba cada carpeta de la ruta
  por si un enlace simbólico saca fuera del vault, y eso costaba siete veces
  más que leer el archivo (2054 ms frente a 320 ms). Las búsquedas, las
  etiquetas y los enlaces ahora leen con `VaultFs::listing()`, que recorre el
  vault una vez sin seguir enlaces simbólicos y, antes de leer, solo vuelve a
  comprobar el archivo.
- **Resolver enlaces.** Cada enlace se buscaba recorriendo todas las notas,
  así que el coste crecía con el cuadrado del vault. `links::Index` las indexa
  por ruta y por nombre una vez, con el mismo orden de preferencia que
  `links::resolve`, y lo usan el panel de enlaces, los enlaces rotos y los
  movimientos y renombrados.

## Decisiones

- **#81, árbol con carga perezosa: no hace falta por ahora.** Leer el árbol
  cuesta 21 ms y pasarlo a la interfaz, 1 ms. El árbol ya solo pinta las
  carpetas abiertas, y una carpeta de 2000 notas se abre en 200 ms.
- **#50, índice de búsqueda: no hace falta por ahora.** Una búsqueda en 10 000
  notas tarda menos de un segundo, y casi todo es leer del disco. En un vault
  de 1000 notas son menos de 100 ms. Merecería la pena con vaults bastante
  mayores, y entonces lo siguiente sería leer en paralelo antes que mantener
  un índice.
