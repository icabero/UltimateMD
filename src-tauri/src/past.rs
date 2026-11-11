//! Commands about what a vault's notes were before: the versions the app
//! keeps of each note and the log of what the AI did. Both live in the app's
//! data folder (see `ultimatemd_core::history`).

use std::time::Duration;
use ultimatemd_core::history::{AiEntry, History, Snapshot, Source};
use ultimatemd_core::{Registry, Result, VaultFs};

/// While someone writes, a version is kept this often.
const EDIT_GAP: Duration = Duration::from_secs(5 * 60);

fn vault(id: &str) -> Result<VaultFs> {
    Ok(VaultFs::new(&Registry::load()?.find(id)?.path))
}

/// Before the app overwrites a note: keeps the text it had, if none was kept
/// lately. Loose files, which belong to no vault, have no history.
pub fn before_write(id: &str, path: &str) {
    let history = History::default();
    if !history.due(id, path, EDIT_GAP) {
        return;
    }
    if let Ok(note) = vault(id).and_then(|v| v.read(path)) {
        let _ = history.snapshot(id, path, &note.content, Source::Edit, None);
    }
}

/// A note or folder moved: its versions follow it.
pub fn moved(id: &str, from: &str, to: &str) {
    let _ = History::default().moved(id, from, to);
}

#[tauri::command(async)]
pub fn history_list(id: String, path: String) -> Result<Vec<Snapshot>> {
    vault(&id)?;
    History::default().list(&id, &path)
}

#[tauri::command(async)]
pub fn history_read(id: String, blob: String) -> Result<String> {
    History::default().read(&id, &blob)
}

/// Keeps the note as it is on disk now: when its tab closes, and before an
/// older version replaces it.
#[tauri::command(async)]
pub fn history_keep(id: String, path: String, before_restore: bool) -> Result<bool> {
    let note = vault(&id)?.read(&path)?;
    let source = if before_restore { Source::BeforeRestore } else { Source::Edit };
    History::default().snapshot(&id, &path, &note.content, source, None)
}

#[tauri::command(async)]
pub fn ai_log(id: String) -> Result<Vec<AiEntry>> {
    vault(&id)?;
    History::default().ai_log(&id)
}

#[tauri::command(async)]
pub fn ai_undo(id: String, entry: String) -> Result<()> {
    History::default().undo_ai(&vault(&id)?, &id, &entry)
}

/// Whether the AI left this note at this version.
#[tauri::command(async)]
pub fn ai_wrote(id: String, path: String, version: String) -> bool {
    History::default().written_by_ai(&id, &path, &version)
}

/// Clears texts nothing refers to any more. Run once per start, off the main thread.
pub fn tidy() {
    std::thread::spawn(|| {
        let Ok(registry) = Registry::load() else { return };
        for vault in &registry.vaults {
            let _ = History::default().collect_garbage(&vault.id);
        }
    });
}
