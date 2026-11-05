//! Commands called from the frontend. All of them run off the main thread, so
//! a slow disk or a large search cannot freeze the window.

use crate::watcher;
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use ultimatemd_core::links::{self, LinkInfo};
use ultimatemd_core::{Error, McpAccess, Note, Registry, Result, SearchHit, TreeNode, Vault, VaultFs, WriteMode, search};

const SEARCH_LIMIT: usize = 200;

/// Serialises read-modify-write cycles on the registry file.
#[derive(Default)]
pub struct RegistryLock(Mutex<()>);

fn edit<T>(lock: &RegistryLock, change: impl FnOnce(&mut Registry) -> Result<T>) -> Result<T> {
    let _guard = lock.0.lock().unwrap_or_else(|e| e.into_inner());
    let mut registry = Registry::load()?;
    let out = change(&mut registry)?;
    registry.save()?;
    Ok(out)
}

fn fs(id: &str) -> Result<VaultFs> {
    Ok(VaultFs::new(&Registry::load()?.find(id)?.path))
}

#[tauri::command(async)]
pub fn list_vaults() -> Result<Vec<Vault>> {
    Ok(Registry::load()?.vaults)
}

#[tauri::command(async)]
pub fn create_vault(app: AppHandle, lock: State<RegistryLock>, parent: PathBuf, name: String) -> Result<Vault> {
    let vault = edit(&lock, |r| r.create(&parent, name.trim()))?;
    watcher::watch(&app, &vault);
    Ok(vault)
}

#[tauri::command(async)]
pub fn open_vault(app: AppHandle, lock: State<RegistryLock>, path: PathBuf) -> Result<Vault> {
    let vault = edit(&lock, |r| r.add(&path))?;
    watcher::watch(&app, &vault);
    Ok(vault)
}

#[tauri::command(async)]
pub fn set_vault_open(app: AppHandle, lock: State<RegistryLock>, id: String, open: bool) -> Result<()> {
    let vault = edit(&lock, |r| {
        let vault = r.find_mut(&id)?;
        vault.open = open;
        Ok(vault.clone())
    })?;
    if open {
        watcher::watch(&app, &vault);
    } else {
        watcher::unwatch(&app, &id);
    }
    Ok(())
}

#[tauri::command(async)]
pub fn remove_vault(app: AppHandle, lock: State<RegistryLock>, id: String) -> Result<()> {
    watcher::unwatch(&app, &id);
    edit(&lock, |r| r.remove(&id))
}

#[tauri::command(async)]
pub fn rename_vault(lock: State<RegistryLock>, id: String, name: String) -> Result<()> {
    edit(&lock, |r| r.rename(&id, &name))
}

#[tauri::command(async)]
pub fn set_vault_access(lock: State<RegistryLock>, id: String, mcp: McpAccess) -> Result<()> {
    edit(&lock, |r| {
        r.find_mut(&id)?.mcp = mcp;
        Ok(())
    })
}

#[tauri::command(async)]
pub fn set_vault_scripts(lock: State<RegistryLock>, id: String, allow: bool) -> Result<()> {
    edit(&lock, |r| {
        r.find_mut(&id)?.allow_scripts = allow;
        Ok(())
    })
}

#[tauri::command(async)]
pub fn vault_tree(id: String) -> Result<Vec<TreeNode>> {
    fs(&id)?.tree()
}

#[tauri::command(async)]
pub fn read_note(id: String, path: String) -> Result<Note> {
    fs(&id)?.read(&path)
}

#[tauri::command(async)]
pub fn write_note(id: String, path: String, content: String, expected: Option<String>) -> Result<String> {
    fs(&id)?.write(&path, &content, WriteMode::Replace(expected.as_deref()))
}

#[tauri::command(async)]
pub fn create_note(id: String, path: String, content: String) -> Result<String> {
    fs(&id)?.write(&path, &content, WriteMode::Create)
}

#[tauri::command(async)]
pub fn create_dir(id: String, path: String) -> Result<()> {
    fs(&id)?.create_dir(&path)
}

#[tauri::command(async)]
pub fn rename_path(id: String, from: String, to: String) -> Result<()> {
    fs(&id)?.rename(&from, &to)
}

#[tauri::command(async)]
pub fn trash_path(id: String, path: String) -> Result<()> {
    fs(&id)?.trash(&path)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultHit {
    vault_id: String,
    hit: SearchHit,
}

/// Searches the vaults open in the sidebar.
#[tauri::command(async)]
pub fn search_all(query: String) -> Result<Vec<VaultHit>> {
    let mut out = Vec::new();
    for vault in Registry::load()?.vaults.iter().filter(|v| v.open) {
        // One unreachable vault, such as an unplugged drive, must not end the search.
        let Ok(hits) = search::search(&VaultFs::new(&vault.path), &query, SEARCH_LIMIT) else { continue };
        out.extend(hits.into_iter().map(|hit| VaultHit { vault_id: vault.id.clone(), hit }));
    }
    Ok(out)
}

#[tauri::command(async)]
pub fn note_links(id: String, path: String) -> Result<LinkInfo> {
    links::info(&fs(&id)?, &path)
}

#[tauri::command(async)]
pub fn open_with_system(app: AppHandle, id: String, path: String) -> Result<()> {
    let file = fs(&id)?.resolve_file(&path)?;
    app.opener()
        .open_path(file.to_string_lossy(), None::<&str>)
        .map_err(|e| Error::Vault(e.to_string()))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpInfo {
    /// Absolute path of the bundled server, for client configuration.
    binary: String,
    available: bool,
}

/// The server is installed next to the app's executable.
#[tauri::command(async)]
pub fn mcp_info() -> Result<McpInfo> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().unwrap_or(Path::new("."));
    let binary = dir.join(format!("ultimatemd-mcp{}", std::env::consts::EXE_SUFFIX));
    Ok(McpInfo { available: binary.is_file(), binary: binary.to_string_lossy().into_owned() })
}

/// Saves a rendered diagram where the user picks. The dialog runs here so the
/// frontend never gets to choose an arbitrary path to write to.
#[tauri::command(async)]
pub fn export_file(app: AppHandle, name: String, data: Vec<u8>) -> Result<bool> {
    let Some(target) = app.dialog().file().set_file_name(&name).blocking_save_file() else {
        return Ok(false);
    };
    let path = target.into_path().map_err(|e| Error::Vault(e.to_string()))?;
    std::fs::write(path, data)?;
    Ok(true)
}
