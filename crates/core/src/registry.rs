//! The list of known vaults, stored as JSON in the user's config folder.
//! It is shared between the app, which writes it, and the MCP server, which
//! reloads it on each call so permission changes apply immediately.

use crate::{Error, Result};
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum McpAccess {
    Off,
    #[default]
    Read,
    Write,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Vault {
    pub id: String,
    pub name: String,
    pub path: PathBuf,
    /// Shown in the sidebar. Closed vaults stay listed and keep their MCP access.
    #[serde(default = "yes")]
    pub open: bool,
    #[serde(default)]
    pub mcp: McpAccess,
    /// Lets `.html` files in this vault run scripts inside their sandbox.
    #[serde(default)]
    pub allow_scripts: bool,
}

fn yes() -> bool {
    true
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Registry {
    #[serde(default)]
    pub vaults: Vec<Vault>,
}

/// The file that, next to the program, makes a copy portable.
pub const PORTABLE_MARK: &str = "portable";

/// Where a portable copy keeps everything: `datos` next to the program, when
/// the `portable` file is there too. The MCP server sits in the same folder,
/// so it finds the same vaults.
pub fn portable_dir() -> Option<PathBuf> {
    portable_dir_beside(std::env::current_exe().ok()?.parent()?)
}

fn portable_dir_beside(program: &Path) -> Option<PathBuf> {
    program.join(PORTABLE_MARK).is_file().then(|| program.join("datos"))
}

/// Config folder: `ULTIMATEMD_CONFIG_DIR` if set, then a portable copy's own
/// folder, then the user's config folder.
pub fn config_dir() -> PathBuf {
    if let Some(dir) = std::env::var_os("ULTIMATEMD_CONFIG_DIR") {
        return PathBuf::from(dir);
    }
    if let Some(dir) = portable_dir() {
        return dir;
    }
    ProjectDirs::from("dev", "ultimatemd", "UltimateMD")
        .map(|d| d.config_dir().to_path_buf())
        .unwrap_or_else(|| PathBuf::from(".ultimatemd"))
}

impl Registry {
    pub fn file() -> PathBuf {
        config_dir().join("vaults.json")
    }

    pub fn load() -> Result<Self> {
        Self::load_from(&Self::file())
    }

    pub fn load_from(file: &Path) -> Result<Self> {
        match std::fs::read_to_string(file) {
            Ok(text) => Ok(serde_json::from_str(&text)?),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    pub fn save(&self) -> Result<()> {
        self.save_to(&Self::file())
    }

    pub fn save_to(&self, file: &Path) -> Result<()> {
        if let Some(dir) = file.parent() {
            std::fs::create_dir_all(dir)?;
        }
        crate::files::atomic_write(file, serde_json::to_string_pretty(self)?.as_bytes())
    }

    /// Finds a vault by id or by name, ignoring case.
    pub fn find(&self, key: &str) -> Result<&Vault> {
        self.vaults
            .iter()
            .find(|v| v.id == key || v.name.eq_ignore_ascii_case(key))
            .ok_or_else(|| Error::UnknownVault(key.to_string()))
    }

    pub fn find_mut(&mut self, id: &str) -> Result<&mut Vault> {
        self.vaults.iter_mut().find(|v| v.id == id).ok_or_else(|| Error::UnknownVault(id.to_string()))
    }

    /// Registers an existing folder as a vault. Its folder name is the default
    /// vault name, with a numeric suffix if that name is already used.
    pub fn add(&mut self, path: &Path) -> Result<Vault> {
        let path = path.canonicalize().map_err(|_| Error::Vault(format!("folder not found: {}", path.display())))?;
        if !path.is_dir() {
            return Err(Error::Vault(format!("not a folder: {}", path.display())));
        }
        if let Some(v) = self.vaults.iter_mut().find(|v| v.path == path) {
            v.open = true;
            return Ok(v.clone());
        }
        let base = path.file_name().and_then(|n| n.to_str()).unwrap_or("Vault").to_string();
        let vault = Vault {
            id: uuid::Uuid::new_v4().to_string(),
            name: self.unique_name(&base),
            path,
            open: true,
            mcp: McpAccess::default(),
            allow_scripts: false,
        };
        self.vaults.push(vault.clone());
        Ok(vault)
    }

    /// Creates `parent/name` and registers it. Fails if the folder exists.
    pub fn create(&mut self, parent: &Path, name: &str) -> Result<Vault> {
        crate::paths::check_new_name(name)?;
        if name.starts_with('.') {
            return Err(Error::InvalidName(name.to_string()));
        }
        let path = parent.join(name);
        if path.exists() {
            return Err(Error::AlreadyExists(path.display().to_string()));
        }
        std::fs::create_dir_all(&path)?;
        self.add(&path)
    }

    /// Finds the vault holding a file, with its vault-relative path. Files in
    /// hidden folders do not count: they are not reachable through the vault.
    pub fn locate(&self, file: &Path) -> Option<(&Vault, String)> {
        let file = file.canonicalize().ok()?;
        self.vaults.iter().find_map(|vault| {
            let root = vault.path.canonicalize().ok()?;
            let rel = crate::paths::to_rel(&root, &file)?;
            crate::paths::normalize(&rel).ok()?;
            Some((vault, rel))
        })
    }

    /// Forgets a vault. Its files are left untouched.
    pub fn remove(&mut self, id: &str) -> Result<()> {
        self.find_mut(id)?;
        self.vaults.retain(|v| v.id != id);
        Ok(())
    }

    pub fn rename(&mut self, id: &str, name: &str) -> Result<()> {
        let name = name.trim();
        if name.is_empty() {
            return Err(Error::InvalidName("empty name".into()));
        }
        if self.vaults.iter().any(|v| v.id != id && v.name.eq_ignore_ascii_case(name)) {
            return Err(Error::AlreadyExists(name.to_string()));
        }
        self.find_mut(id)?.name = name.to_string();
        Ok(())
    }

    fn unique_name(&self, base: &str) -> String {
        let taken = |n: &str| self.vaults.iter().any(|v| v.name.eq_ignore_ascii_case(n));
        if !taken(base) {
            return base.to_string();
        }
        (2..).map(|i| format!("{base} {i}")).find(|n| !taken(n)).expect("unbounded range")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_portable_copy_keeps_its_data_beside_the_program() {
        let d = tempfile::tempdir().unwrap();
        assert_eq!(portable_dir_beside(d.path()), None);
        std::fs::create_dir(d.path().join(PORTABLE_MARK)).unwrap();
        assert_eq!(portable_dir_beside(d.path()), None, "a folder is not the mark");
        std::fs::remove_dir(d.path().join(PORTABLE_MARK)).unwrap();
        std::fs::write(d.path().join(PORTABLE_MARK), "").unwrap();
        assert_eq!(portable_dir_beside(d.path()), Some(d.path().join("datos")));
    }

    #[test]
    fn add_create_remove_roundtrip() {
        let d = tempfile::tempdir().unwrap();
        let file = d.path().join("cfg/vaults.json");
        let mut r = Registry::default();
        let a = r.create(d.path(), "Notas").unwrap();
        assert!(a.path.is_dir());
        assert_eq!(a.mcp, McpAccess::Read, "MCP must default to read-only");

        let again = r.add(&a.path).unwrap();
        assert_eq!(again.id, a.id, "same folder must not register twice");

        std::fs::create_dir_all(d.path().join("other/Notas")).unwrap();
        let b = r.add(&d.path().join("other/Notas")).unwrap();
        assert_eq!(b.name, "Notas 2");

        r.save_to(&file).unwrap();
        let mut loaded = Registry::load_from(&file).unwrap();
        assert_eq!(loaded.find("notas").unwrap().id, a.id);
        loaded.remove(&a.id).unwrap();
        assert!(a.path.is_dir(), "removing a vault keeps its files");
        assert!(matches!(loaded.find(&a.id), Err(Error::UnknownVault(_))));
    }

    #[test]
    fn locates_files_inside_vaults_only() {
        let d = tempfile::tempdir().unwrap();
        let mut r = Registry::default();
        let v = r.create(d.path(), "V").unwrap();
        std::fs::create_dir_all(v.path.join("a/.git")).unwrap();
        std::fs::write(v.path.join("a/n.md"), "").unwrap();
        std::fs::write(v.path.join("a/.git/h.md"), "").unwrap();
        std::fs::write(d.path().join("fuera.md"), "").unwrap();

        let (found, rel) = r.locate(&v.path.join("a/n.md")).unwrap();
        assert_eq!((found.id.as_str(), rel.as_str()), (v.id.as_str(), "a/n.md"));
        assert!(r.locate(&d.path().join("fuera.md")).is_none());
        assert!(r.locate(&v.path.join("a/.git/h.md")).is_none());
        assert!(r.locate(&d.path().join("no-existe.md")).is_none());
    }

    #[test]
    fn missing_file_is_an_empty_registry() {
        let d = tempfile::tempdir().unwrap();
        assert!(Registry::load_from(&d.path().join("none.json")).unwrap().vaults.is_empty());
    }

    #[test]
    fn rename_rejects_duplicates() {
        let d = tempfile::tempdir().unwrap();
        let mut r = Registry::default();
        let a = r.create(d.path(), "A").unwrap();
        r.create(d.path(), "B").unwrap();
        assert!(r.rename(&a.id, "b").is_err());
        r.rename(&a.id, "C").unwrap();
    }
}
