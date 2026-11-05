//! Commands called from the frontend. All of them run off the main thread, so
//! a slow disk or a large search cannot freeze the window.

use crate::{loose, startup, watcher};
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

/// A vault, or for a loose file its folder limited to that one file.
fn file_fs(id: &str, path: &str) -> Result<VaultFs> {
    match loose::folder_for(id, path) {
        Some(result) => result,
        None => fs(id),
    }
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
    file_fs(&id, &path)?.read(&path)
}

#[tauri::command(async)]
pub fn write_note(id: String, path: String, content: String, expected: Option<String>) -> Result<String> {
    file_fs(&id, &path)?.write(&path, &content, WriteMode::Replace(expected.as_deref()))
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
#[serde(rename_all = "camelCase", tag = "kind")]
pub enum Opened {
    Vault { vault_id: String, path: String },
    Loose { id: String, name: String, absolute: String, dir: String },
}

/// Decides how to open a file handed over by the operating system: as part of
/// its vault when it has one, which also reopens a closed vault.
#[tauri::command(async)]
pub fn open_path(app: AppHandle, lock: State<RegistryLock>, path: PathBuf) -> Result<Opened> {
    if !path.is_file() {
        return Err(Error::NotFound(path.display().to_string()));
    }
    let registry = Registry::load()?;
    if let Some((vault, rel)) = registry.locate(&path) {
        let vault_id = vault.id.clone();
        if !vault.open {
            set_vault_open(app, lock, vault_id.clone(), true)?;
        }
        return Ok(Opened::Vault { vault_id, path: rel });
    }
    let file = path.canonicalize()?;
    let name = file.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_default();
    if !ultimatemd_core::paths::is_note(&name) {
        return Err(Error::PathNotAllowed(name));
    }
    let id = loose::register(&file);
    watcher::watch_file(&app, &id, &file);
    let plain = |p: &Path| p.to_string_lossy().trim_start_matches(r"\\?\").to_string();
    Ok(Opened::Loose {
        id,
        name,
        dir: file.parent().map(plain).unwrap_or_default(),
        absolute: plain(&file),
    })
}

#[tauri::command(async)]
pub fn close_loose(app: AppHandle, id: String) {
    watcher::unwatch(&app, &id);
    loose::remove(&id);
}

/// Files the system asked to open before the frontend was ready.
#[tauri::command(async)]
pub fn take_pending_files(state: State<startup::Pending>) -> Vec<PathBuf> {
    state.take()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultAppInfo {
    platform: &'static str,
    /// Linux only: an AppImage has no desktop entry to associate.
    appimage: bool,
    /// Linux only: whether this app already opens Markdown files.
    is_default: bool,
}

#[cfg(target_os = "linux")]
const DESKTOP_FILE: &str = "UltimateMD.desktop";
#[cfg(target_os = "linux")]
const MARKDOWN_MIME: &str = "text/markdown";

#[tauri::command(async)]
pub fn default_app_info() -> DefaultAppInfo {
    #[cfg(target_os = "linux")]
    let is_default = std::process::Command::new("xdg-mime")
        .args(["query", "default", MARKDOWN_MIME])
        .output()
        .is_ok_and(|o| String::from_utf8_lossy(&o.stdout).trim() == DESKTOP_FILE);
    #[cfg(not(target_os = "linux"))]
    let is_default = false;
    DefaultAppInfo {
        platform: std::env::consts::OS,
        appimage: std::env::var_os("APPIMAGE").is_some(),
        is_default,
    }
}

/// Windows lets only the user pick default apps, so this opens that screen. On
/// Linux the choice can be made directly; macOS does it from the Finder.
#[tauri::command(async)]
pub fn set_default_app(app: AppHandle) -> Result<()> {
    #[cfg(target_os = "windows")]
    app.opener()
        .open_url("ms-settings:defaultapps", None::<&str>)
        .map_err(|e| Error::Vault(e.to_string()))?;
    #[cfg(target_os = "linux")]
    {
        let _ = &app;
        let status = std::process::Command::new("xdg-mime")
            .args(["default", DESKTOP_FILE, MARKDOWN_MIME])
            .status()?;
        if !status.success() {
            return Err(Error::Vault("xdg-mime could not set the default app".into()));
        }
    }
    #[cfg(target_os = "macos")]
    let _ = &app;
    Ok(())
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
