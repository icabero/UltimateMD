//! Tells the frontend when files change on disk, whoever changed them: the MCP
//! server, a sync client, or another editor.
//!
//! Hidden folders and the heavy folders of programming tools are not watched.
//! When a vault cannot be watched, the frontend is told, since changes made
//! outside the app will not show until it reads the vault again.

use notify_debouncer_full::notify::{EventKind, RecommendedWatcher, RecursiveMode};
use notify_debouncer_full::{DebounceEventResult, Debouncer, RecommendedCache, new_debouncer};
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};
use ultimatemd_core::Vault;

const DEBOUNCE: Duration = Duration::from_millis(250);

/// Folders that tools fill with thousands of files nobody writes notes in.
const HEAVY: &[&str] = &["node_modules", "__pycache__", "bower_components", "venv"];

/// On Linux each folder takes a watch of its own, and the system allows a
/// limited number; elsewhere one watch covers the whole vault.
const PER_FOLDER: bool = cfg!(target_os = "linux");

type Watcher = Debouncer<RecommendedWatcher, RecommendedCache>;

#[derive(Default)]
pub struct Watchers {
    active: Mutex<HashMap<String, Watcher>>,
    /// Vaults that could not be watched, with why.
    failed: Mutex<HashMap<String, String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct VaultChanged {
    vault_id: String,
    paths: Vec<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WatchProblem {
    vault_id: String,
    error: String,
}

/// Theme files live in a hidden folder, yet their changes must still show.
fn touches_themes(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|rel| rel.starts_with(ultimatemd_core::vault_themes::FOLDER))
}

/// Inside a hidden or heavy folder, or hidden itself.
fn ignored(root: &Path, path: &Path) -> bool {
    path.strip_prefix(root).is_ok_and(|rel| {
        rel.components().any(|c| {
            let name = c.as_os_str().to_string_lossy();
            name.starts_with('.') || HEAVY.contains(&name.as_ref())
        })
    })
}

/// The folders to watch one by one: `dir` and those below it, leaving out
/// ignored ones and links, which could lead out of the vault.
fn folders(root: &Path, dir: &Path) -> Vec<PathBuf> {
    let mut out = vec![dir.to_path_buf()];
    let mut i = 0;
    while i < out.len() {
        if let Ok(entries) = std::fs::read_dir(&out[i]) {
            for entry in entries.flatten() {
                let path = entry.path();
                if entry.file_type().is_ok_and(|t| t.is_dir()) && !ignored(root, &path) {
                    out.push(path);
                }
            }
        }
        i += 1;
    }
    out
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

/// Remembers that a vault cannot be watched and tells the frontend, once.
fn fail(app: &AppHandle, id: &str, error: String) {
    let state = app.state::<Watchers>();
    let mut failed = state.failed.lock().unwrap_or_else(|e| e.into_inner());
    if failed.insert(id.to_string(), error.clone()).is_none() {
        let _ = app.emit("watch-failed", WatchProblem { vault_id: id.to_string(), error });
    }
}

/// Starts watching folders created after the vault was opened. Run on a
/// thread of its own: the debouncer may not be touched from its own handler.
fn watch_new_folders(app: AppHandle, id: String, root: PathBuf, created: Vec<PathBuf>) {
    std::thread::spawn(move || {
        let state = app.state::<Watchers>();
        let mut active = state.active.lock().unwrap_or_else(|e| e.into_inner());
        let Some(debouncer) = active.get_mut(&id) else { return };
        let watched = created
            .iter()
            .flat_map(|d| folders(&root, d))
            .try_for_each(|dir| debouncer.watch(&dir, RecursiveMode::NonRecursive));
        drop(active);
        if let Err(e) = watched {
            fail(&app, &id, e.to_string());
        }
    });
}

/// A failed watch is not fatal: the file works, it just will not refresh live.
fn watch_path(app: &AppHandle, id: &str, path: &Path, mode: RecursiveMode, only: Option<String>) {
    let state = app.state::<Watchers>();
    state.failed.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    let root = match path.canonicalize() {
        Ok(root) => root,
        Err(e) => return fail(app, id, e.to_string()),
    };
    let per_folder = PER_FOLDER && mode == RecursiveMode::Recursive;
    let (emitter, key, events_root) = (app.clone(), id.to_string(), root.clone());
    let debouncer = new_debouncer(DEBOUNCE, None, move |result: DebounceEventResult| {
        let events = match result {
            Ok(events) => events,
            Err(errors) => {
                let error = errors.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n");
                return fail(&emitter, &key, error);
            }
        };
        let root = &events_root;
        if events.iter().flat_map(|e| e.paths.iter()).any(|p| touches_themes(root, p)) {
            let _ = emitter.emit("themes-changed", key.clone());
        }
        if per_folder {
            let created: Vec<PathBuf> = events
                .iter()
                .filter(|e| matches!(e.kind, EventKind::Create(_)))
                .flat_map(|e| e.paths.iter())
                .filter(|p| p.is_dir() && !ignored(root, p))
                .cloned()
                .collect();
            if !created.is_empty() {
                watch_new_folders(emitter.clone(), key.clone(), root.clone(), created);
            }
        }
        let mut paths: Vec<String> = events
            .iter()
            .flat_map(|e| e.paths.iter())
            .filter(|p| !ignored(root, p))
            .filter_map(|p| ultimatemd_core::paths::to_rel(root, p))
            .filter(|p| only.as_ref().is_none_or(|name| name == p))
            .collect();
        paths.sort();
        paths.dedup();
        if !paths.is_empty() {
            let _ = emitter.emit("vault-changed", VaultChanged { vault_id: key.clone(), paths });
        }
    });
    let mut debouncer = match debouncer {
        Ok(d) => d,
        Err(e) => return fail(app, id, e.to_string()),
    };
    let watched = if per_folder {
        folders(&root, &root).iter().try_for_each(|dir| debouncer.watch(dir, RecursiveMode::NonRecursive))
    } else {
        debouncer.watch(&root, mode)
    };
    if let Err(e) = watched {
        return fail(app, id, e.to_string());
    }
    state.active.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string(), debouncer);
}

pub fn unwatch(app: &AppHandle, id: &str) {
    let state = app.state::<Watchers>();
    state.active.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
    state.failed.lock().unwrap_or_else(|e| e.into_inner()).remove(id);
}

/// The vaults that could not be watched, for a frontend that started late.
pub fn problems(app: &AppHandle) -> Vec<WatchProblem> {
    let state = app.state::<Watchers>();
    let failed = state.failed.lock().unwrap_or_else(|e| e.into_inner());
    failed.iter().map(|(id, error)| WatchProblem { vault_id: id.clone(), error: error.clone() }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hidden_and_heavy_folders_are_ignored() {
        let root = Path::new("/v");
        assert!(ignored(root, Path::new("/v/.git/index")));
        assert!(ignored(root, Path::new("/v/web/node_modules/a/b.js")));
        assert!(ignored(root, Path::new("/v/x/__pycache__")));
        assert!(!ignored(root, Path::new("/v/notas/node.md")));
        assert!(!ignored(root, Path::new("/v/Inicio.md")));
    }

    #[test]
    fn folders_to_watch_skip_ignored_ones() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        for d in ["a/b", "node_modules/x", ".git/objects", "c"] {
            std::fs::create_dir_all(root.join(d)).unwrap();
        }
        std::fs::write(root.join("a/nota.md"), "").unwrap();
        let mut found: Vec<String> =
            folders(root, root).iter().filter_map(|p| ultimatemd_core::paths::to_rel(root, p)).collect();
        found.sort();
        assert_eq!(found, ["", "a", "a/b", "c"], "the root and the folders below it");
    }
}
