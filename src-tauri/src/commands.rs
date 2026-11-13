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
use ultimatemd_core::docx::Section;
use ultimatemd_core::links::{self, LinkInfo};
use ultimatemd_core::paths::{is_image, join_relative};
use ultimatemd_core::tree_order::{self, SortMode};
use ultimatemd_core::vault_themes::{self, ThemeFile, VaultThemes};
use ultimatemd_core::word_settings::{self, WordSettings};
use ultimatemd_core::{
    Error, McpAccess, Note, Registry, Result, SearchHit, TreeNode, Vault, VaultFs, WriteMode, search,
};
use ultimatemd_core::{docx, note_templates, replace, templates};

const SEARCH_LIMIT: usize = 200;
/// In an export plan, the template kept in the vault itself.
const VAULT_TEMPLATE: &str = ":vault";
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
    if loose::folder_for(&id, &path).is_none() {
        crate::past::before_write(&id, &path);
    }
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
/// Moves or renames, rewriting the links that would otherwise break.
pub fn rename_path(id: String, from: String, to: String) -> Result<links::LinkUpdate> {
    let update = links::move_path(&fs(&id)?, &from, &to)?;
    crate::past::moved(&id, &from, &to);
    Ok(update)
}

/// The names of the vault's note templates.
#[tauri::command(async)]
pub fn note_templates(id: String) -> Result<Vec<String>> {
    note_templates::list(fs(&id)?.root())
}

#[tauri::command(async)]
pub fn note_template(id: String, name: String) -> Result<String> {
    note_templates::read(fs(&id)?.root(), &name)
}

#[tauri::command(async)]
pub fn save_note_template(id: String, name: String, content: String) -> Result<()> {
    note_templates::save(fs(&id)?.root(), &name, &content)
}

#[tauri::command(async)]
pub fn delete_note_template(id: String, name: String) -> Result<()> {
    note_templates::delete(fs(&id)?.root(), &name)
}

/// Saves an image pasted or dropped into a note. Its path in the vault.
#[tauri::command(async)]
pub fn save_image(id: String, dir: String, name: String, data: Vec<u8>) -> Result<String> {
    fs(&id)?.save_image(&dir, &name, &data)
}

/// Sets a file or folder aside, to be undone or trashed for good. Its token.
#[tauri::command(async)]
pub fn trash_path(id: String, path: String) -> Result<String> {
    fs(&id)?.trash_later(&path)
}

/// Puts back a deletion. The path it is at again.
#[tauri::command(async)]
pub fn undo_trash(id: String, token: String) -> Result<String> {
    fs(&id)?.undo_trash(&token)
}

/// Sends a deletion to the system trash once it can no longer be undone.
#[tauri::command(async)]
pub fn finish_trash(id: String, token: String) -> Result<()> {
    fs(&id)?.trash_now(&token)
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
    // A query that cannot be read fails once, not quietly in every vault.
    search::parse(&query)?;
    let mut out = Vec::new();
    for vault in Registry::load()?.vaults.iter().filter(|v| v.open) {
        // One unreachable vault, such as an unplugged drive, must not end the search.
        let Ok(hits) = search::search(&VaultFs::new(&vault.path), &query, SEARCH_LIMIT) else { continue };
        out.extend(hits.into_iter().map(|hit| VaultHit { vault_id: vault.id.clone(), hit }));
    }
    // Best notes first across vaults. Stable, so each note's lines stay together.
    out.sort_by_key(|h| std::cmp::Reverse(h.hit.score));
    out.truncate(SEARCH_LIMIT);
    Ok(out)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultSummary {
    vault_id: String,
    /// None when the folder cannot be read, such as an unplugged drive.
    notes: Option<usize>,
    last_edit: Option<u64>,
    /// The note edited last, to pick up where it was left.
    last_note: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentNote {
    vault_id: String,
    path: String,
    modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeInfo {
    vaults: Vec<VaultSummary>,
    recent: Vec<RecentNote>,
}

const RECENT_LIMIT: usize = 8;

/// What the start screen shows: each open vault's size and last edit, and
/// the notes changed last across all of them.
#[tauri::command(async)]
pub fn home_info() -> Result<HomeInfo> {
    let mut vaults = Vec::new();
    let mut recent = Vec::new();
    for vault in Registry::load()?.vaults.iter().filter(|v| v.open) {
        let stamps = VaultFs::new(&vault.path).note_stamps().ok();
        vaults.push(VaultSummary {
            vault_id: vault.id.clone(),
            notes: stamps.as_ref().map(Vec::len),
            last_edit: stamps.as_ref().and_then(|s| s.first()).map(|s| s.modified),
            last_note: stamps.as_ref().and_then(|s| s.first()).map(|s| s.path.clone()),
        });
        for s in stamps.unwrap_or_default().into_iter().take(RECENT_LIMIT) {
            recent.push(RecentNote { vault_id: vault.id.clone(), path: s.path, modified: s.modified });
        }
    }
    recent.sort_by_key(|r| std::cmp::Reverse(r.modified));
    recent.truncate(RECENT_LIMIT);
    Ok(HomeInfo { vaults, recent })
}

#[tauri::command(async)]
pub fn note_links(id: String, path: String) -> Result<LinkInfo> {
    links::info(&fs(&id)?, &path)
}

/// Every link in the vault that leads nowhere.
#[tauri::command(async)]
pub fn broken_links(id: String) -> Result<Vec<links::BrokenLink>> {
    links::broken(&fs(&id)?)
}

/// Points the links of a note written as `target` to another note or file.
#[tauri::command(async)]
pub fn repoint_link(id: String, note: String, target: String, to: String) -> Result<usize> {
    links::repoint(&fs(&id)?, &note, &target, &to)
}

#[tauri::command(async)]
pub fn open_with_system(app: AppHandle, id: String, path: String) -> Result<()> {
    let file = fs(&id)?.resolve_file(&path)?;
    app.opener().open_path(file.to_string_lossy(), None::<&str>).map_err(|e| Error::Vault(e.to_string()))
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
        nodes
            .iter()
            .find_map(|n| if n.is_dir { find(&n.children, name) } else { (n.name == name).then(|| n.path.clone()) })
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
    /// PDF/A, for archiving.
    #[serde(default)]
    archive: bool,
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

    fn docx(&self, inline_numbering: bool) -> Result<Vec<u8>> {
        let sections = self.sections()?;
        let root = fs(&self.vault_id)?;
        let template = match self.template.as_deref() {
            Some(VAULT_TEMPLATE) => word_settings::template(root.root()),
            Some(name) => Some(templates::read(name)?),
            None => None,
        };
        docx::render(&docx::Input {
            sections: &sections,
            title: &self.title,
            fixed_title: self.fixed_title,
            date: &self.date,
            contents: &self.contents,
            diagrams: &self.diagrams,
            image: &|note, reference| note_image(&self.vault_id, note, reference),
            template: template.as_deref(),
            settings: &word_settings::load(root.root()),
            inline_numbering,
            language: &self.language,
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
            archive: self.archive,
            diagrams: &self.diagrams,
            image: &|note, reference| note_image(&self.vault_id, note, reference),
        })
    }
}

/// Files written by an export in this session. Only these can be opened or
/// shown afterwards, so the frontend never opens an arbitrary path.
static EXPORTED: std::sync::LazyLock<Mutex<std::collections::HashSet<PathBuf>>> =
    std::sync::LazyLock::new(Default::default);

fn exported() -> std::sync::MutexGuard<'static, std::collections::HashSet<PathBuf>> {
    EXPORTED.lock().unwrap_or_else(|e| e.into_inner())
}

/// Asks where to save and writes the file there. Its path, or None if the dialog is cancelled.
fn save_to(picked: Option<tauri_plugin_dialog::FilePath>, bytes: Vec<u8>) -> Result<Option<String>> {
    let Some(target) = picked else { return Ok(None) };
    let path = target.into_path().map_err(|e| Error::Vault(e.to_string()))?;
    std::fs::write(&path, bytes)?;
    let shown = path.to_string_lossy().into_owned();
    exported().insert(path);
    Ok(Some(shown))
}

fn save_as(app: &AppHandle, name: String, kind: &str, ext: &str, bytes: Vec<u8>) -> Result<Option<String>> {
    save_to(app.dialog().file().set_file_name(name).add_filter(kind, &[ext]).blocking_save_file(), bytes)
}

fn exported_path(path: &str) -> Result<PathBuf> {
    let path = PathBuf::from(path);
    if exported().contains(&path) { Ok(path) } else { Err(Error::PathNotAllowed(path.to_string_lossy().into_owned())) }
}

/// Opens a file this session exported with the system's program for it.
#[tauri::command(async)]
pub fn open_exported(app: AppHandle, path: String) -> Result<()> {
    let path = exported_path(&path)?;
    app.opener().open_path(path.to_string_lossy(), None::<&str>).map_err(|e| Error::Vault(e.to_string()))
}

/// Shows a file this session exported in its folder.
#[tauri::command(async)]
pub fn reveal_exported(app: AppHandle, path: String) -> Result<()> {
    let path = exported_path(&path)?;
    app.opener().reveal_item_in_dir(path).map_err(|e| Error::Vault(e.to_string()))
}

/// One page of an exported site, by its path inside the site.
#[derive(serde::Deserialize)]
pub struct SitePage {
    path: String,
    html: String,
}

/// Marks a folder as a site this app wrote, so exporting again may replace it.
const SITE_MARK: &str = ".ultimatemd-sitio";

/// Writes a static site in a new folder `name` inside the one the user picks,
/// with the vault's images it uses under `assets/`. Returns its index page,
/// or None if the dialog is cancelled.
#[tauri::command(async)]
pub fn export_site(
    app: AppHandle,
    id: String,
    name: String,
    pages: Vec<SitePage>,
    assets: Vec<String>,
) -> Result<Option<String>> {
    let vault = fs(&id)?;
    let Some(picked) = app.dialog().file().blocking_pick_folder() else { return Ok(None) };
    let parent = picked.into_path().map_err(|e| Error::Vault(e.to_string()))?;
    let index = write_site(&vault, &parent, &name, &pages, &assets)?;
    exported().insert(index.clone());
    Ok(Some(index.to_string_lossy().into_owned()))
}

/// The site's files in `parent/name`. An existing folder is only replaced
/// when this app wrote it, and nothing is written outside it.
fn write_site(vault: &VaultFs, parent: &Path, name: &str, pages: &[SitePage], assets: &[String]) -> Result<PathBuf> {
    ultimatemd_core::paths::check_new_name(name)?;
    let root = parent.join(name);
    if root.exists() && !root.join(SITE_MARK).is_file() {
        return Err(Error::Vault(format!(
            "{} already exists and is not a site exported by UltimateMD",
            root.display()
        )));
    }
    std::fs::create_dir_all(&root)?;
    std::fs::write(root.join(SITE_MARK), b"")?;
    let write = |rel: &str, bytes: &[u8]| -> Result<()> {
        let target = ultimatemd_core::paths::resolve(&root, rel)?;
        std::fs::create_dir_all(target.parent().unwrap_or(&root))?;
        Ok(std::fs::write(target, bytes)?)
    };
    for page in pages {
        if !page.path.ends_with(".html") {
            return Err(Error::PathNotAllowed(page.path.clone()));
        }
        write(&page.path, page.html.as_bytes())?;
    }
    for asset in assets {
        write(&format!("assets/{asset}"), &std::fs::read(vault.resolve_existing(asset)?)?)?;
    }
    Ok(root.join("index.html"))
}

#[cfg(test)]
mod site_tests {
    use super::*;

    fn page(path: &str) -> SitePage {
        SitePage { path: path.into(), html: format!("<p>{path}</p>") }
    }

    #[test]
    fn a_site_is_written_inside_its_own_folder() {
        let vault_dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(vault_dir.path().join("adjuntos")).unwrap();
        std::fs::write(vault_dir.path().join("adjuntos/foto.png"), b"png").unwrap();
        let vault = VaultFs::new(vault_dir.path());
        let out = tempfile::tempdir().unwrap();

        let index = write_site(
            &vault,
            out.path(),
            "Docs",
            &[page("index.html"), page("a/b.html")],
            &["adjuntos/foto.png".into()],
        )
        .unwrap();
        assert_eq!(index, out.path().join("Docs/index.html"));
        assert_eq!(std::fs::read(out.path().join("Docs/assets/adjuntos/foto.png")).unwrap(), b"png");
        assert!(out.path().join("Docs/a/b.html").is_file());
        // Again over its own folder.
        write_site(&vault, out.path(), "Docs", &[page("index.html")], &[]).unwrap();

        std::fs::create_dir(out.path().join("Mio")).unwrap();
        assert!(
            write_site(&vault, out.path(), "Mio", &[page("index.html")], &[]).is_err(),
            "a folder it did not write"
        );
        for bad in ["../fuera.html", "x.js", ".oculto/a.html"] {
            assert!(write_site(&vault, out.path(), "Otro", &[page(bad)], &[]).is_err(), "{bad}");
        }
        assert!(write_site(&vault, out.path(), "Otro", &[], &["../secreto.png".into()]).is_err());
        assert!(write_site(&vault, out.path(), "a/b", &[], &[]).is_err(), "a name, not a path");
    }
}

/// Writes a `.docx` where the user picks. Its path, or None if the dialog is cancelled.
#[tauri::command(async)]
pub fn export_docx(app: AppHandle, plan: ExportPlan) -> Result<Option<String>> {
    save_as(&app, format!("{}.docx", plan.title), "Word", "docx", plan.docx(false)?)
}

/// Writes a PDF where the user picks. Its path, or None if the dialog is cancelled.
#[tauri::command(async)]
pub fn export_pdf(app: AppHandle, plan: ExportPlan) -> Result<Option<String>> {
    let bytes = plan.with_pdf(ultimatemd_pdf::render)?;
    save_as(&app, format!("{}.pdf", plan.title), "PDF", "pdf", bytes)
}

/// The generated `.docx`, written for the viewer that displays it.
#[tauri::command(async)]
pub fn preview_docx(plan: ExportPlan) -> Result<Vec<u8>> {
    plan.docx(true)
}

/// The pages of the PDF as images, so the preview is the document itself.
#[tauri::command(async)]
pub fn preview_pdf(plan: ExportPlan) -> Result<Vec<String>> {
    let pages = plan.with_pdf(|input| ultimatemd_pdf::preview(input, PREVIEW_PIXELS_PER_POINT))?;
    Ok(pages.iter().map(|png| format!("data:image/png;base64,{}", BASE64.encode(png))).collect())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WordConfig {
    settings: WordSettings,
    has_template: bool,
    info: docx::TemplateInfo,
}

#[tauri::command(async)]
pub fn word_config(id: String) -> Result<WordConfig> {
    let root = fs(&id)?;
    let template = word_settings::template(root.root());
    Ok(WordConfig {
        settings: word_settings::load(root.root()),
        has_template: template.is_some(),
        info: docx::template_info(template.as_deref())?,
    })
}

/// The other names notes answer to, from `aliases:`: of the whole vault, or
/// only of `paths` after they changed.
#[tauri::command(async)]
pub fn vault_aliases(id: String, paths: Option<Vec<String>>) -> Result<Vec<ultimatemd_core::aliases::NoteAliases>> {
    ultimatemd_core::aliases::of_vault(&fs(&id)?, paths.as_deref())
}

/// What changed since the last commit, when the vault is in a Git repository.
#[tauri::command(async)]
pub fn git_status(id: String) -> Result<Option<ultimatemd_core::git::Status>> {
    ultimatemd_core::git::status(fs(&id)?.root())
}

/// A note as it was in the last commit.
#[tauri::command(async)]
pub fn git_committed(id: String, path: String) -> Result<Option<String>> {
    ultimatemd_core::git::committed(fs(&id)?.root(), &path)
}

/// Commits the vault's changes; its short id.
#[tauri::command(async)]
pub fn git_commit(id: String, message: String) -> Result<String> {
    ultimatemd_core::git::commit(fs(&id)?.root(), &message)
}

/// The vault's guide for the diagrams an AI draws, if it has one.
#[tauri::command(async)]
pub fn diagram_guide(id: String) -> Result<Option<String>> {
    ultimatemd_core::diagram_guide::load(fs(&id)?.root())
}

/// Saves the guide; an empty text removes it.
#[tauri::command(async)]
pub fn save_diagram_guide(id: String, text: String) -> Result<()> {
    ultimatemd_core::diagram_guide::save(fs(&id)?.root(), &text)
}

/// How the vault's tree is ordered.
#[tauri::command(async)]
pub fn tree_order(id: String) -> Result<SortMode> {
    Ok(tree_order::load(fs(&id)?.root()).mode)
}

#[tauri::command(async)]
pub fn set_tree_order(id: String, mode: SortMode) -> Result<()> {
    tree_order::set_mode(fs(&id)?.root(), mode)
}

/// Places a note or folder before or after a sibling, for the manual order.
#[tauri::command(async)]
pub fn place_in_tree(id: String, path: String, target: String, after: bool) -> Result<()> {
    fs(&id)?.place(&path, &target, after)
}

#[tauri::command(async)]
pub fn save_word_settings(id: String, settings: WordSettings) -> Result<()> {
    word_settings::save(fs(&id)?.root(), &settings)
}

/// Asks for a `.docx` and makes it the vault's template. False if cancelled.
#[tauri::command(async)]
pub fn choose_vault_template(app: AppHandle, id: String) -> Result<bool> {
    let picked = app.dialog().file().add_filter("Word", &["docx"]).blocking_pick_file();
    let Some(file) = picked else { return Ok(false) };
    let path = file.into_path().map_err(|e| Error::Vault(e.to_string()))?;
    word_settings::set_template(fs(&id)?.root(), &path)?;
    Ok(true)
}

#[tauri::command(async)]
pub fn remove_vault_template(id: String) -> Result<()> {
    word_settings::remove_template(fs(&id)?.root())
}

/// One example of everything, written by the real exporter.
#[tauri::command(async)]
pub fn word_sample(id: String, settings: WordSettings, markdown: String, picture: Vec<u8>) -> Result<Vec<u8>> {
    settings.validate()?;
    let template = word_settings::template(fs(&id)?.root());
    docx::sample(template.as_deref(), &settings, &markdown, &picture)
}

#[tauri::command(async)]
pub fn template_styles(template: Option<String>) -> Result<Vec<docx::StyleInfo>> {
    let bytes = template.as_deref().map(templates::read).transpose()?;
    docx::paragraph_styles(bytes.as_deref())
}

/// Saves a template as a normal `.docx`, to adapt the example in Word.
#[tauri::command(async)]
pub fn save_template_copy(app: AppHandle, name: String) -> Result<bool> {
    save_as(&app, format!("{name}.docx"), "Word", "docx", templates::read(&name)?).map(|p| p.is_some())
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
    Ok(Opened::Loose { id, name, dir: file.parent().map(plain).unwrap_or_default(), absolute: plain(&file) })
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
    DefaultAppInfo { platform: std::env::consts::OS, appimage: std::env::var_os("APPIMAGE").is_some(), is_default }
}

/// Windows lets only the user pick default apps, so this opens that screen. On
/// Linux the choice can be made directly; macOS does it from the Finder.
#[tauri::command(async)]
pub fn set_default_app(app: AppHandle) -> Result<()> {
    #[cfg(target_os = "windows")]
    app.opener().open_url("ms-settings:defaultapps", None::<&str>).map_err(|e| Error::Vault(e.to_string()))?;
    #[cfg(target_os = "linux")]
    {
        let _ = &app;
        let status = std::process::Command::new("xdg-mime").args(["default", DESKTOP_FILE, MARKDOWN_MIME]).status()?;
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
fn mcp_binary() -> Result<PathBuf> {
    let exe = std::env::current_exe()?;
    let dir = exe.parent().unwrap_or(Path::new("."));
    Ok(dir.join(format!("ultimatemd-mcp{}", std::env::consts::EXE_SUFFIX)))
}

#[tauri::command(async)]
pub fn mcp_info() -> Result<McpInfo> {
    let binary = mcp_binary()?;
    Ok(McpInfo { available: binary.is_file(), binary: binary.to_string_lossy().into_owned() })
}

/// Starts the MCP server as a client would and reports what it sees.
#[tauri::command(async)]
pub fn check_mcp() -> Result<crate::mcp_check::McpCheck> {
    Ok(crate::mcp_check::check(&mcp_binary()?))
}

/// Saves a rendered diagram where the user picks. The dialog runs here so the
/// frontend never gets to choose an arbitrary path to write to.
#[tauri::command(async)]
pub fn export_file(app: AppHandle, name: String, data: Vec<u8>) -> Result<Option<String>> {
    save_to(app.dialog().file().set_file_name(&name).blocking_save_file(), data)
}

/// The language picked in the Windows installer, left next to the program.
#[tauri::command(async)]
pub fn installer_language() -> Option<String> {
    let dir = std::env::current_exe().ok()?.parent()?.to_path_buf();
    Some(std::fs::read_to_string(dir.join("language.txt")).ok()?.trim().to_string())
}

/// Turns the spell checker on with these dictionaries, or off with none.
/// Only WebKitGTK needs telling; the Windows and macOS webviews follow the
/// page and the system.
#[tauri::command]
pub fn set_spellcheck(window: tauri::WebviewWindow, languages: Vec<String>) -> Result<()> {
    #[cfg(target_os = "linux")]
    window
        .with_webview(move |webview| {
            use webkit2gtk::{WebContextExt, WebViewExt};
            if let Some(context) = webview.inner().context() {
                let names: Vec<&str> = languages.iter().map(String::as_str).collect();
                context.set_spell_checking_languages(&names);
                context.set_spell_checking_enabled(!names.is_empty());
            }
        })
        .map_err(|e| Error::Vault(e.to_string()))?;
    #[cfg(not(target_os = "linux"))]
    let _ = (window, languages);
    Ok(())
}

/// The vaults whose changes on disk are not being followed, and why.
#[tauri::command]
pub fn watch_problems(app: AppHandle) -> Vec<watcher::WatchProblem> {
    watcher::problems(&app)
}

/// Most lines a replace preview lists, so a careless search cannot flood the window.
const REPLACE_PREVIEW_LINES: usize = 2000;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplacePlan {
    vault_id: String,
    path: String,
    version: String,
    changes: Vec<replace::LineChange>,
}

/// What would change in the notes of the open vaults.
#[tauri::command(async)]
pub fn replace_preview(replace: replace::Replace) -> Result<Vec<ReplacePlan>> {
    replace.changes("")?;
    let mut out = Vec::new();
    let mut lines = 0;
    for vault in Registry::load()?.vaults.iter().filter(|v| v.open) {
        let fs = VaultFs::new(&vault.path);
        let Ok(notes) = fs.notes() else { continue };
        for path in notes {
            let Ok(note) = fs.read(&path) else { continue };
            let changes = replace.changes(&note.content)?;
            if changes.is_empty() {
                continue;
            }
            lines += changes.len();
            out.push(ReplacePlan { vault_id: vault.id.clone(), path, version: note.version, changes });
            if lines >= REPLACE_PREVIEW_LINES {
                return Ok(out);
            }
        }
    }
    Ok(out)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceIn {
    vault_id: String,
    path: String,
    /// As previewed. A note that changed since is left alone.
    version: String,
    lines: Vec<usize>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Replaced {
    vault_id: String,
    path: String,
    /// The text before, to undo.
    before: String,
    /// The version written, so undoing can tell if it changed again.
    version: String,
    lines: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReplaceResult {
    replaced: Vec<Replaced>,
    /// Notes that changed after the preview, or could not be written.
    skipped: Vec<String>,
}

/// Replaces the chosen lines, note by note.
#[tauri::command(async)]
pub fn replace_apply(replace: replace::Replace, notes: Vec<ReplaceIn>) -> Result<ReplaceResult> {
    replace.changes("")?;
    let mut result = ReplaceResult { replaced: Vec::new(), skipped: Vec::new() };
    for target in notes {
        let done = (|| {
            let fs = fs(&target.vault_id)?;
            let note = fs.read(&target.path)?;
            if note.version != target.version {
                return Err(Error::Conflict(target.path.clone()));
            }
            let (text, lines) = replace.apply(&note.content, Some(&target.lines))?;
            if lines == 0 {
                return Ok(None);
            }
            let version = fs.write(&target.path, &text, WriteMode::Replace(Some(&note.version)))?;
            Ok(Some(Replaced {
                vault_id: target.vault_id.clone(),
                path: target.path.clone(),
                before: note.content,
                version,
                lines,
            }))
        })();
        match done {
            Ok(Some(replaced)) => result.replaced.push(replaced),
            Ok(None) => {}
            Err(_) => result.skipped.push(target.path),
        }
    }
    Ok(result)
}

/// The tags of a vault with how many notes have each.
#[tauri::command(async)]
pub fn vault_tags(id: String) -> Result<Vec<ultimatemd_core::tags::TagCount>> {
    ultimatemd_core::tags::vault_tags(&fs(&id)?)
}

/// Shows a file or folder of a vault in the system's file manager.
#[tauri::command(async)]
pub fn reveal_path(app: AppHandle, id: String, path: String) -> Result<()> {
    let vault = file_fs(&id, &path)?;
    let target = if path.is_empty() { vault.root().to_path_buf() } else { vault.resolve_existing(&path)? };
    app.opener().reveal_item_in_dir(target).map_err(|e| Error::Vault(e.to_string()))
}
