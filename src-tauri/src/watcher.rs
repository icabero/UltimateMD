//! Tells the frontend when files change on disk, whoever changed them: the MCP
//! server, a sync client, or another editor.

use notify_debouncer_full::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use serde::Serialize;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use ultimatemd_core::Vault;

const DEBOUNCE: Duration = Duration::from_millis(250);

#[derive(Default)]
pub struct Watchers(Mutex<HashMap<String, Debouncer<RecommendedWatcher, RecommendedCache>>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultChanged {
    vault_id: String,
    paths: Vec<String>,
}

fn is_hidden(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root)
        .is_ok_and(|rel| rel.components().any(|c| c.as_os_str().to_string_lossy().starts_with('.')))
}

pub fn watch(app: &AppHandle, vault: &Vault) {
    watch_path(app, &vault.id, &vault.path, RecursiveMode::Recursive, None);
}

/// Watches the folder of a loose file, reporting that file only.
pub fn watch_file(app: &AppHandle, id: &str, file: &Path) {
    let (Some(dir), Some(name)) = (file.parent(), file.file_name()) else { return };
    let name = name.to_string_lossy().into_owned();
    watch_path(app, id, dir, RecursiveMode::NonRecursive, Some(name));
}

/// A failed watch is not fatal: the file works, it just will not refresh live.
fn watch_path(app: &AppHandle, id: &str, path: &Path, mode: RecursiveMode, only: Option<String>) {
    let (Ok(root), emitter, id) = (path.canonicalize(), app.clone(), id.to_string()) else {
        return;
    };
    let watched_root = root.clone();
    let key = id.clone();
    let debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let mut paths: Vec<String> = events
            .iter()
            .flat_map(|e| e.paths.iter())
            .filter(|p| !is_hidden(&root, p))
            .filter_map(|p| ultimatemd_core::paths::to_rel(&root, p))
            .filter(|p| only.as_ref().is_none_or(|name| name == p))
            .collect();
        paths.sort();
        paths.dedup();
        if !paths.is_empty() {
            let _ = emitter.emit("vault-changed", VaultChanged { vault_id: id.clone(), paths });
        }
    });
    let mut debouncer = match debouncer {
        Ok(d) => d,
        Err(e) => return eprintln!("cannot watch {}: {e}", path.display()),
    };
    if let Err(e) = debouncer.watch(&watched_root, mode) {
        return eprintln!("cannot watch {}: {e}", path.display());
    }
    let state = app.state::<Watchers>();
    state.0.lock().unwrap_or_else(|e| e.into_inner()).insert(key, debouncer);
}

pub fn unwatch(app: &AppHandle, id: &str) {
    let state = app.state::<Watchers>();
    state.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
}
