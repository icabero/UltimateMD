//! Installs a newer version from inside the app. The packages come from the
//! GitHub release and are checked against the public key the app carries, so
//! only ones built by the project's release workflow are accepted.

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tauri_plugin_updater::UpdaterExt;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Progress {
    done: u64,
    /// Unknown when the server does not say.
    total: Option<u64>,
}

/// Whether this copy can update itself. A package installed by the system
/// (deb or rpm) is updated by the system; only an AppImage replaces itself.
/// A portable copy is a folder the updater does not know how to replace.
#[tauri::command]
pub fn update_supported() -> bool {
    portable_data().is_none() && (!cfg!(target_os = "linux") || std::env::var_os("APPIMAGE").is_some())
}

/// The folder a portable copy keeps its data in, or nothing when installed.
#[tauri::command]
pub fn portable_data() -> Option<String> {
    ultimatemd_core::registry::portable_dir().map(|d| d.to_string_lossy().into_owned())
}

/// Downloads the newest version, installs it and starts it. Says how far the
/// download is through `update-progress`. Fails with words for the log when
/// there is nothing newer or the package cannot be used.
#[tauri::command]
pub async fn update_install(app: AppHandle) -> Result<(), String> {
    let failed = |e: tauri_plugin_updater::Error| {
        let text = e.to_string();
        crate::logbook::error("update", &text);
        text
    };
    let update = app.updater().map_err(failed)?.check().await.map_err(failed)?;
    let Some(update) = update else { return Err("no newer version is published".into()) };
    let mut done = 0;
    let progress = app.clone();
    update
        .download_and_install(
            |chunk, total| {
                done += chunk as u64;
                let _ = progress.emit("update-progress", Progress { done, total });
            },
            || {},
        )
        .await
        .map_err(failed)?;
    app.restart()
}
