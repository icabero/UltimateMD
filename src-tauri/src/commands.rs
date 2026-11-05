//! Commands called from the frontend. All of them run off the main thread, so
//! a slow disk or a large search cannot freeze the window.

use crate::{loose, startup, watcher};
use base64::Engine;
use base64::engine::general_purpose::STANDARD as BASE64;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use ultimatemd_core::links::{self, LinkInfo};
use ultimatemd_core::paths::{is_image, join_relative};
use ultimatemd_core::vault_themes::{self, ThemeFile, VaultThemes};
use ultimatemd_core::docx::Section;
use ultimatemd_core::{docx, docx_preview, templates};
use ultimatemd_core::{Error, McpAccess, Note, Registry, Result, SearchHit, TreeNode, Vault, VaultFs, WriteMode, search};

const SEARCH_LIMIT: usize = 200;
const PREVIEW_PIXELS_PER_POINT: f64 = 1.1;

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

#[tauri::command(async)]
pub fn vault_themes(id: String) -> Result<VaultThemes> {
    vault_themes::load(fs(&id)?.root())
}

#[tauri::command(async)]
pub fn save_vault_theme(id: String, theme: ThemeFile) -> Result<()> {
    vault_themes::save(fs(&id)?.root(), &theme)
}

#[tauri::command(async)]
pub fn delete_vault_theme(id: String, theme: String) -> Result<()> {
    vault_themes::delete(fs(&id)?.root(), &theme)
}

#[tauri::command(async)]
pub fn set_vault_default_theme(id: String, theme: Option<String>) -> Result<()> {
    vault_themes::set_default(fs(&id)?.root(), theme)
}

#[tauri::command(async)]
pub fn set_vault_diagram_theme(id: String, theme: Option<String>) -> Result<()> {
    vault_themes::set_default_diagrams(fs(&id)?.root(), theme)
}

#[tauri::command(async)]
pub fn list_templates() -> Result<Vec<String>> {
    templates::list()
}

/// Asks for a `.docx` and adds it as a template. None if the dialog is cancelled.
#[tauri::command(async)]
pub fn import_template(app: AppHandle) -> Result<Option<String>> {
    let picked = app.dialog().file().add_filter("Word", &["docx"]).blocking_pick_file();
    let Some(file) = picked else { return Ok(None) };
    let path = file.into_path().map_err(|e| Error::Vault(e.to_string()))?;
    templates::import(&path).map(Some)
}

#[tauri::command(async)]
pub fn rename_template(name: String, new_name: String) -> Result<()> {
    templates::rename(&name, &new_name)
}

#[tauri::command(async)]
pub fn delete_template(name: String) -> Result<()> {
    templates::delete(&name)
}

/// Bytes of an image in a vault or beside a loose file, for self-contained exports.
#[tauri::command(async)]
pub fn read_image(id: String, path: String) -> Result<Vec<u8>> {
    if !is_image(&path) {
        return Err(Error::PathNotAllowed(path));
    }
    let root = match loose::dir_of(&id) {
        Some(dir) => dir,
        None => Registry::load()?.find(&id)?.path.clone(),
    };
    Ok(std::fs::read(VaultFs::new(root).resolve_file(&path)?)?)
}

/// Finds an image for a note: relative to it, or by name in the vault as
/// `![[image.png]]` does.
fn note_image(id: &str, note: &str, reference: &str) -> Option<Vec<u8>> {
    let relative = join_relative(note, reference)?;
    if let Ok(bytes) = read_image(id.to_string(), relative) {
        return Some(bytes);
    }
    let vault = fs(id).ok()?;
    let name = reference.rsplit('/').next()?;
    fn find(nodes: &[TreeNode], name: &str) -> Option<String> {
        nodes.iter().find_map(|n| if n.is_dir { find(&n.children, name) } else { (n.name == name).then(|| n.path.clone()) })
    }
    read_image(id.to_string(), find(&vault.tree().ok()?, name)?).ok()
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PlanSection {
    Heading { text: String, style: Option<String>, level: usize, page_break: bool },
    Note { path: String, shift: usize, page_break: bool },
}

/// What to export, as decided in the export dialog.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportPlan {
    vault_id: String,
    title: String,
    /// A folder or vault is named by its title, not by its first note.
    fixed_title: bool,
    date: String,
    language: String,
    contents: String,
    cover: bool,
    template: Option<String>,
    sections: Vec<PlanSection>,
    diagrams: Vec<Vec<u8>>,
}

impl ExportPlan {
    fn sections(&self) -> Result<Vec<Section>> {
        self.sections
            .iter()
            .map(|section| {
                Ok(match section {
                    PlanSection::Heading { text, style, level, page_break } => Section::Heading {
                        text: text.clone(),
                        style: style.clone(),
                        level: *level,
                        page_break: *page_break,
                    },
                    PlanSection::Note { path, shift, page_break } => Section::Note {
                        path: path.clone(),
                        markdown: file_fs(&self.vault_id, path)?.read(path)?.content,
                        shift: *shift,
                        page_break: *page_break,
                    },
                })
            })
            .collect()
    }

    fn docx(&self) -> Result<Vec<u8>> {
        let sections = self.sections()?;
        let template = self.template.as_deref().map(templates::read).transpose()?;
        docx::render(&docx::Input {
            sections: &sections,
            title: &self.title,
            fixed_title: self.fixed_title,
            date: &self.date,
            contents: &self.contents,
            diagrams: &self.diagrams,
            image: &|note, reference| note_image(&self.vault_id, note, reference),
            template: template.as_deref(),
        })
    }

    fn with_pdf<T>(&self, run: impl FnOnce(&ultimatemd_pdf::Input) -> Result<T>) -> Result<T> {
        let sections = self.sections()?;
        run(&ultimatemd_pdf::Input {
            sections: &sections,
            title: &self.title,
            date: &self.date,
            language: &self.language,
            contents: &self.contents,
            cover: self.cover,
            diagrams: &self.diagrams,
            image: &|note, reference| note_image(&self.vault_id, note, reference),
        })
    }
}

fn save_as(app: &AppHandle, name: String, kind: &str, ext: &str, bytes: Vec<u8>) -> Result<bool> {
    let picked = app.dialog().file().set_file_name(name).add_filter(kind, &[ext]).blocking_save_file();
    let Some(target) = picked else { return Ok(false) };
    std::fs::write(target.into_path().map_err(|e| Error::Vault(e.to_string()))?, bytes)?;
    Ok(true)
}

/// Writes a `.docx` where the user picks. False if the dialog is cancelled.
#[tauri::command(async)]
pub fn export_docx(app: AppHandle, plan: ExportPlan) -> Result<bool> {
    save_as(&app, format!("{}.docx", plan.title), "Word", "docx", plan.docx()?)
}

/// Writes a PDF where the user picks. False if the dialog is cancelled.
#[tauri::command(async)]
pub fn export_pdf(app: AppHandle, plan: ExportPlan) -> Result<bool> {
    let bytes = plan.with_pdf(ultimatemd_pdf::render)?;
    save_as(&app, format!("{}.pdf", plan.title), "PDF", "pdf", bytes)
}

/// The generated `.docx`, read back for display.
#[tauri::command(async)]
pub fn preview_docx(plan: ExportPlan) -> Result<docx_preview::Preview> {
    docx_preview::render(&plan.docx()?)
}

/// The pages of the PDF as images, so the preview is the document itself.
#[tauri::command(async)]
pub fn preview_pdf(plan: ExportPlan) -> Result<Vec<String>> {
    let pages = plan.with_pdf(|input| ultimatemd_pdf::preview(input, PREVIEW_PIXELS_PER_POINT))?;
    Ok(pages.iter().map(|png| format!("data:image/png;base64,{}", BASE64.encode(png))).collect())
}

#[tauri::command(async)]
pub fn template_styles(template: Option<String>) -> Result<Vec<docx::StyleInfo>> {
    let bytes = template.as_deref().map(templates::read).transpose()?;
    docx::paragraph_styles(bytes.as_deref())
}

/// Saves a template as a normal `.docx`, to adapt the example in Word.
#[tauri::command(async)]
pub fn save_template_copy(app: AppHandle, name: String) -> Result<bool> {
    save_as(&app, format!("{name}.docx"), "Word", "docx", templates::read(&name)?)
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

/// The language picked in the Windows installer, left next to the program.
#[tauri::command(async)]
pub fn installer_language() -> Option<String> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    Some(std::fs::read_to_string(dir.join("language.txt")).ok()?.trim().to_string())
}
