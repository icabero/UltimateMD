# Contribuir a UltimateMD

Gracias por el interés. UltimateMD es un proyecto personal de código abierto: puedes usarlo, estudiarlo o adaptarlo con su [licencia MIT](LICENSE). Al participar aceptas el [código de conducta](CODE_OF_CONDUCT.md).

## Cómo ayudar

- **Avisar de un fallo:** abre una [issue con la plantilla de fallo](https://github.com/icabero/UltimateMD/issues/new/choose). Di la versión (en **Acerca de**), tu sistema y los pasos para que ocurra. Si puedes, adjunta el registro: **Ajustes → Registro de errores → Copiar**.
- **Proponer una idea:** abre una issue con la plantilla de idea. Cuenta qué quieres hacer y por qué, más que cómo hacerlo.
- **Un problema de seguridad:** nunca en una issue pública. Sigue la [política de seguridad](SECURITY.md).

## Pull requests

El desarrollo es privado por ahora, así que **no se aceptan pull requests sin acuerdo previo**. Si quieres aportar código, abre antes una issue y espera a que se acuerde el cambio. Así nadie trabaja en algo que no va a entrar.

Cuando haya acuerdo:

1. Parte de la rama `develop`, que es donde se trabaja; `main` solo recibe las versiones publicadas.
2. Haz un commit por cambio, con un título corto en inglés que diga qué cambia para quien usa la app, y `Closes #N` con su issue.
3. Abre el pull request contra `develop` con la plantilla, y deja que pase la CI.

## Preparar el entorno

Necesitas [Rust](https://rustup.rs), Node.js y las [dependencias de Tauri](https://tauri.app/start/prerequisites/) de tu sistema.

```sh
npm install
npm run dev     # abre la app
npm run build   # crea los instaladores para tu sistema
```

## Antes de abrir el pull request

Lo mismo que comprueba la CI, en local:

```sh
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
npm run lint        # ESLint, el sistema de diseño y la versión
npm run check       # tipos de Svelte y TypeScript
npm test            # tests unitarios del frontend
npm run test:e2e    # la interfaz entera, con Playwright
```

## Cómo está hecho

- `crates/core`: los vaults, los enlaces, la búsqueda, el historial y la exportación a Word, sin interfaz.
- `crates/pdf`: la exportación a PDF, con Typst.
- `crates/mcp`: el servidor MCP para las IA.
- `src-tauri`: la app de escritorio, que une el núcleo con la interfaz.
- `src`: la interfaz, en Svelte.
- `e2e`: las pruebas de la interfaz, con un backend simulado en `e2e/mock.js`.
- `docs`: el sistema de diseño, el rendimiento, la accesibilidad y las actualizaciones.

Para la interfaz:

- Los espacios, radios, tamaños de letra, sombras y capas siguen el [sistema de diseño](docs/sistema-de-diseno.md). `npm run lint` avisa si se escribe un valor suelto.
- Todo texto visible va en los tres idiomas de `src/lib/locales`: castellano, euskera e inglés.
- Lo que se añade tiene que ser fácil de usar y de encontrar, y accesible: la prueba con axe del e2e lo comprueba.
