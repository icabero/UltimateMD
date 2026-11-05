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

/// A failed watch is not fatal: the vault works, it just will not refresh live.
pub fn watch(app: &AppHandle, vault: &Vault) {
    let (Ok(root), emitter, id) = (vault.path.canonicalize(), app.clone(), vault.id.clone()) else {
        return;
    };
    let watched_root = root.clone();
    let debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let Ok(events) = result else { return };
        let mut paths: Vec<String> = events
            .iter()
            .flat_map(|e| e.paths.iter())
            .filter(|p| !is_hidden(&root, p))
            .filter_map(|p| ultimatemd_core::paths::to_rel(&root, p))
            .collect();
        paths.sort();
        paths.dedup();
        if !paths.is_empty() {
            let _ = emitter.emit("vault-changed", VaultChanged { vault_id: id.clone(), paths });
        }
    });
    let mut debouncer = match debouncer {
        Ok(d) => d,
        Err(e) => return eprintln!("cannot watch {}: {e}", vault.name),
    };
    if let Err(e) = debouncer.watch(&watched_root, RecursiveMode::Recursive) {
        return eprintln!("cannot watch {}: {e}", vault.name);
    }
    let state = app.state::<Watchers>();
    state.0.lock().unwrap_or_else(|e| e.into_inner()).insert(vault.id.clone(), debouncer);
}

pub fn unwatch(app: &AppHandle, id: &str) {
    let state = app.state::<Watchers>();
    state.0.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
}
