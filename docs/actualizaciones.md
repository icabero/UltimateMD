# Actualizaciones desde la app

Desde la versión 0.7 la app puede descargar e instalar una versión nueva
(«Acerca de» → «Actualizar ahora»). Usa `tauri-plugin-updater`.

## Cómo funciona

1. El workflow de release construye, además de los instaladores, los paquetes
   de actualización y un archivo `latest.json` que los enumera, y los adjunta a
   la release de GitHub.
2. La app lee `https://github.com/icabero/UltimateMD/releases/latest/download/latest.json`.
   Solo lo encuentra cuando la release está **publicada**: un borrador no cuenta.
3. Descarga el paquete de su sistema, comprueba su firma con la clave pública
   que lleva dentro (`plugins.updater.pubkey` en `src-tauri/tauri.conf.json`),
   lo instala y se reinicia.

En Linux solo se actualiza sola la AppImage. Los paquetes `.deb` y `.rpm` los
actualiza el sistema, y la app lo dice.

## La clave de firma

La firma es la propia de Tauri, gratuita; no tiene que ver con los
certificados de pago de Windows o Apple.

- La clave **privada** no está en el repositorio. Vive en el secreto
  `TAURI_SIGNING_PRIVATE_KEY` de GitHub Actions y en una copia local del
  mantenedor (`~/.tauri/ultimatemd-updater.key`).
- Si se pierde, las versiones ya instaladas no podrán actualizarse solas:
  habría que generar otra (`npx tauri signer generate`), cambiar la pública en
  `tauri.conf.json` y pedir a la gente que instale esa versión a mano.
- Las construcciones locales (`npm run build`) no la necesitan: los paquetes de
  actualización solo se crean con `--config src-tauri/tauri.release.conf.json`,
  que es lo que usa el workflow.
