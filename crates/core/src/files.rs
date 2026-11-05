//! File operations inside one vault.

use crate::paths::{check_new_path, is_note, normalize, resolve, to_rel};
use crate::{Error, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::Duration;
use walkdir::{DirEntry, WalkDir};

const BOM: &str = "\u{feff}";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TreeNode {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Vec<TreeNode>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Note {
    pub path: String,
    /// Text with `\n` line endings and no BOM.
    pub content: String,
    /// Hash of the bytes on disk. Pass it back when writing to detect conflicts.
    pub version: String,
}

pub enum WriteMode<'a> {
    /// Fails if the file exists.
    Create,
    /// Replaces the file. With `Some(version)`, fails if it changed meanwhile.
    Replace(Option<&'a str>),
}

/// A vault root plus the operations allowed inside it.
pub struct Vault {
    root: PathBuf,
}

impl Vault {
    pub fn new(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolves a path for raw reads, such as images used by a note.
    pub fn resolve_file(&self, rel: &str) -> Result<PathBuf> {
        let path = resolve(&self.root, rel)?;
        if path.is_file() {
            Ok(path)
        } else {
            Err(Error::NotFound(rel.to_string()))
        }
    }

    pub fn tree(&self) -> Result<Vec<TreeNode>> {
        let root = self.root.canonicalize()?;
        read_tree(&root, &root)
    }

    /// Relative paths of every note, sorted.
    pub fn notes(&self) -> Result<Vec<String>> {
        let root = self.root.canonicalize()?;
        let mut out: Vec<String> = WalkDir::new(&root)
            .into_iter()
            .filter_entry(visible)
            .filter_map(|e| e.ok())
            .filter(|e| e.file_type().is_file())
            .filter_map(|e| to_rel(&root, e.path()))
            .filter(|p| is_note(p))
            .collect();
        out.sort();
        Ok(out)
    }

    pub fn read(&self, rel: &str) -> Result<Note> {
        let path = resolve(&self.root, rel)?;
        let bytes = std::fs::read(&path).map_err(|e| not_found(e, rel))?;
        let version = version_of(&bytes);
        let text = String::from_utf8(bytes).map_err(|_| Error::NotText(rel.to_string()))?;
        let text = text.strip_prefix(BOM).unwrap_or(&text);
        Ok(Note {
            path: normalize(rel)?,
            content: text.replace("\r\n", "\n"),
            version,
        })
    }

    /// Writes a note atomically and returns its new version. Line endings and
    /// the BOM of an existing file are kept, so editing never rewrites a whole
    /// file on Windows.
    pub fn write(&self, rel: &str, content: &str, mode: WriteMode) -> Result<String> {
        // First, so a bad name gets a clear error rather than the one the
        // operating system gives when it reads a path containing it.
        if matches!(mode, WriteMode::Create) {
            check_new_path(&normalize(rel)?)?;
        }
        let path = resolve(&self.root, rel)?;
        let current = match std::fs::read(&path) {
            Ok(bytes) => Some(bytes),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
            Err(e) => return Err(e.into()),
        };
        match (&mode, &current) {
            (WriteMode::Create, Some(_)) => return Err(Error::AlreadyExists(rel.to_string())),
            (WriteMode::Replace(_), None) => return Err(Error::NotFound(rel.to_string())),
            (WriteMode::Replace(Some(expected)), Some(bytes)) if version_of(bytes) != *expected => {
                return Err(Error::Conflict(rel.to_string()));
            }
            _ => {}
        }
        if current.is_none()
            && let Some(dir) = path.parent()
        {
            std::fs::create_dir_all(dir)?;
        }
        let bytes = encode_like(content, current.as_deref());
        atomic_write(&path, &bytes)?;
        Ok(version_of(&bytes))
    }

    pub fn create_dir(&self, rel: &str) -> Result<()> {
        check_new_path(&normalize(rel)?)?;
        let path = resolve(&self.root, rel)?;
        if path.exists() {
            return Err(Error::AlreadyExists(rel.to_string()));
        }
        Ok(std::fs::create_dir_all(path)?)
    }

    /// Moves or renames a file or folder. Never overwrites.
    pub fn rename(&self, from: &str, to: &str) -> Result<()> {
        if normalize(from)?.is_empty() {
            return Err(Error::PathNotAllowed(from.to_string()));
        }
        let to_norm = normalize(to)?;
        check_new_path(&to_norm)?;
        let src = resolve(&self.root, from)?;
        let dst = resolve(&self.root, to)?;
        if !src.exists() {
            return Err(Error::NotFound(from.to_string()));
        }
        if dst.starts_with(&src) && dst != src {
            return Err(Error::PathNotAllowed(to.to_string()));
        }
        // `a.md` to `A.md` is the same file on Windows and macOS.
        let same_file = dst.exists() && dst.canonicalize()? == src.canonicalize()?;
        if dst.exists() && !same_file {
            return Err(Error::AlreadyExists(to.to_string()));
        }
        if let Some(dir) = dst.parent() {
            std::fs::create_dir_all(dir)?;
        }
        retry_locked(|| std::fs::rename(&src, &dst))?;
        Ok(())
    }

    /// Sends a file or folder to the system trash. There is no permanent delete.
    pub fn trash(&self, rel: &str) -> Result<()> {
        if normalize(rel)?.is_empty() {
            return Err(Error::PathNotAllowed(rel.to_string()));
        }
        let path = resolve(&self.root, rel)?;
        if !path.exists() {
            return Err(Error::NotFound(rel.to_string()));
        }
        // Canonical Windows paths are `\\?\C:\...`; the shell API behind the
        // trash expects the ordinary form.
        trash::delete(dunce::simplified(&path)).map_err(|e| Error::Trash(e.to_string()))
    }
}

fn not_found(e: std::io::Error, rel: &str) -> Error {
    if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::InvalidFilename) {
        Error::NotFound(rel.to_string())
    } else {
        e.into()
    }
}

fn visible(e: &DirEntry) -> bool {
    e.depth() == 0 || !e.file_name().to_string_lossy().starts_with('.')
}

fn read_tree(root: &Path, dir: &Path) -> Result<Vec<TreeNode>> {
    let mut nodes = Vec::new();
    for entry in std::fs::read_dir(dir)?.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with('.') {
            continue;
        }
        let path = entry.path();
        // Symlinks are not followed, so the tree stays inside the vault.
        let Ok(kind) = entry.file_type() else { continue };
        if kind.is_symlink() {
            continue;
        }
        let Some(rel) = to_rel(root, &path) else { continue };
        let children = if kind.is_dir() { read_tree(root, &path)? } else { Vec::new() };
        nodes.push(TreeNode { name, path: rel, is_dir: kind.is_dir(), children });
    }
    nodes.sort_by_key(|n| (!n.is_dir, n.name.to_lowercase()));
    Ok(nodes)
}

pub fn version_of(bytes: &[u8]) -> String {
    Sha256::digest(bytes).iter().take(12).map(|b| format!("{b:02x}")).collect()
}

fn encode_like(content: &str, existing: Option<&[u8]>) -> Vec<u8> {
    let lf = content.replace("\r\n", "\n");
    let lf = lf.strip_prefix(BOM).unwrap_or(&lf);
    let existing = existing.unwrap_or_default();
    let crlf = existing.windows(2).filter(|w| w == b"\r\n").count();
    let bare_lf = existing.iter().filter(|b| **b == b'\n').count() - crlf;
    let mut out = String::with_capacity(lf.len() + 8);
    if existing.starts_with(BOM.as_bytes()) {
        out.push_str(BOM);
    }
    if crlf > bare_lf {
        out.push_str(&lf.replace('\n', "\r\n"));
    } else {
        out.push_str(lf);
    }
    out.into_bytes()
}

/// Writes through a temp file in the same folder, then renames over the target.
/// A crash can therefore never leave a half-written note.
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<()> {
    use std::io::Write;
    let dir = path.parent().ok_or_else(|| Error::PathNotAllowed(path.display().to_string()))?;
    let tmp = dir.join(format!(".umd-{}.tmp", uuid::Uuid::new_v4()));
    let result = (|| -> std::io::Result<()> {
        let mut file = std::fs::File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        if let Ok(meta) = std::fs::metadata(path) {
            std::fs::set_permissions(&tmp, meta.permissions())?;
        }
        retry_locked(|| std::fs::rename(&tmp, path))
    })();
    if result.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    Ok(result?)
}

/// On Windows, antivirus and search indexers briefly lock files, which makes
/// renames fail with a permission error. Those clear up by themselves.
fn retry_locked(mut op: impl FnMut() -> std::io::Result<()>) -> std::io::Result<()> {
    let attempts = if cfg!(windows) { 10 } else { 1 };
    let mut last = Ok(());
    for i in 0..attempts {
        last = op();
        match &last {
            Err(e) if e.kind() == std::io::ErrorKind::PermissionDenied && i + 1 < attempts => {
                std::thread::sleep(Duration::from_millis(30 * (i as u64 + 1)));
            }
            _ => break,
        }
    }
    last
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault() -> (tempfile::TempDir, Vault) {
        let d = tempfile::tempdir().unwrap();
        let v = Vault::new(d.path());
        (d, v)
    }

    #[test]
    fn create_read_replace() {
        let (_d, v) = vault();
        let ver = v.write("a/b/nota.md", "hola\n", WriteMode::Create).unwrap();
        let note = v.read("a/b/nota.md").unwrap();
        assert_eq!(note.content, "hola\n");
        assert_eq!(note.version, ver);
        assert!(matches!(v.write("a/b/nota.md", "x", WriteMode::Create), Err(Error::AlreadyExists(_))));
        assert!(matches!(v.write("no.md", "x", WriteMode::Replace(None)), Err(Error::NotFound(_))));
    }

    #[test]
    fn stale_version_is_a_conflict() {
        let (_d, v) = vault();
        let first = v.write("n.md", "1", WriteMode::Create).unwrap();
        let second = v.write("n.md", "2", WriteMode::Replace(Some(&first))).unwrap();
        assert!(matches!(v.write("n.md", "3", WriteMode::Replace(Some(&first))), Err(Error::Conflict(_))));
        v.write("n.md", "3", WriteMode::Replace(Some(&second))).unwrap();
        assert_eq!(v.read("n.md").unwrap().content, "3");
    }

    #[test]
    fn keeps_crlf_and_bom() {
        let (d, v) = vault();
        std::fs::write(d.path().join("w.md"), "\u{feff}uno\r\ndos\r\n").unwrap();
        let note = v.read("w.md").unwrap();
        assert_eq!(note.content, "uno\ndos\n");
        v.write("w.md", "uno\ndos\ntres\n", WriteMode::Replace(Some(&note.version))).unwrap();
        assert_eq!(std::fs::read(d.path().join("w.md")).unwrap(), "\u{feff}uno\r\ndos\r\ntres\r\n".as_bytes());
    }

    #[test]
    fn keeps_lf() {
        let (d, v) = vault();
        std::fs::write(d.path().join("l.md"), "a\nb\n").unwrap();
        v.write("l.md", "a\r\nb\r\nc\r\n", WriteMode::Replace(None)).unwrap();
        assert_eq!(std::fs::read(d.path().join("l.md")).unwrap(), b"a\nb\nc\n");
    }

    #[test]
    fn binary_is_not_text() {
        let (d, v) = vault();
        std::fs::write(d.path().join("b.md"), [0xff, 0xfe, 0x00]).unwrap();
        assert!(matches!(v.read("b.md"), Err(Error::NotText(_))));
    }

    #[test]
    fn writing_leaves_no_temp_files() {
        let (d, v) = vault();
        v.write("n.md", "1", WriteMode::Create).unwrap();
        v.write("n.md", "2", WriteMode::Replace(None)).unwrap();
        assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test]
    fn tree_hides_dotfiles_and_sorts_dirs_first() {
        let (d, v) = vault();
        std::fs::create_dir(d.path().join(".git")).unwrap();
        std::fs::write(d.path().join(".git/config"), "x").unwrap();
        v.write("b.md", "", WriteMode::Create).unwrap();
        v.write("z/c.md", "", WriteMode::Create).unwrap();
        let t = v.tree().unwrap();
        assert_eq!(t.iter().map(|n| n.name.as_str()).collect::<Vec<_>>(), ["z", "b.md"]);
        assert_eq!(t[0].children[0].path, "z/c.md");
        assert_eq!(v.notes().unwrap(), ["b.md", "z/c.md"]);
    }

    #[test]
    fn rename_never_overwrites() {
        let (_d, v) = vault();
        v.write("a.md", "a", WriteMode::Create).unwrap();
        v.write("b.md", "b", WriteMode::Create).unwrap();
        assert!(matches!(v.rename("a.md", "b.md"), Err(Error::AlreadyExists(_))));
        v.rename("a.md", "dir/c.md").unwrap();
        assert_eq!(v.read("dir/c.md").unwrap().content, "a");
        assert!(v.rename("dir", "dir/inner").is_err());
        assert!(v.rename("", "x").is_err());
    }

    #[test]
    fn new_names_follow_windows_rules() {
        let (_d, v) = vault();
        assert!(matches!(v.write("con.md", "", WriteMode::Create), Err(Error::InvalidName(_))));
        assert!(matches!(v.write("a?/b.md", "", WriteMode::Create), Err(Error::InvalidName(_))));
    }

    // Only runs where the trash is real and disposable, such as the CI runners.
    #[cfg(windows)]
    #[test]
    fn trash_handles_canonical_windows_paths() {
        let (d, v) = vault();
        v.write("dir/n.md", "x", WriteMode::Create).unwrap();
        v.trash("dir/n.md").unwrap();
        assert!(!d.path().join("dir/n.md").exists());
    }
}
