//! Note templates: Markdown files in a vault's `.ultimatemd/plantillas/`, so
//! they travel with the vault. Filling in `{{titulo}}` and the like is the
//! frontend's job, as it knows the language and the date format.

use crate::paths::check_new_name;
use crate::vault_themes::FOLDER;
use crate::{Error, Result};
use std::path::{Path, PathBuf};

const SUBFOLDER: &str = "plantillas";

fn folder(root: &Path) -> PathBuf {
    root.join(FOLDER).join(SUBFOLDER)
}

/// The file of a template, checking its name is a plain one.
fn file(root: &Path, name: &str) -> Result<PathBuf> {
    let name = name.trim();
    check_new_name(name)?;
    if name.starts_with('.') {
        return Err(Error::InvalidName(name.to_string()));
    }
    Ok(folder(root).join(format!("{name}.md")))
}

/// The names of the vault's templates, sorted, without `.md`.
pub fn list(root: &Path) -> Result<Vec<String>> {
    let Ok(entries) = std::fs::read_dir(folder(root)) else { return Ok(Vec::new()) };
    let mut names: Vec<String> = entries
        .flatten()
        .filter(|e| e.file_type().is_ok_and(|t| t.is_file()))
        .filter_map(|e| e.file_name().to_str()?.strip_suffix(".md").map(String::from))
        .filter(|n| !n.starts_with('.'))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

pub fn read(root: &Path, name: &str) -> Result<String> {
    let path = file(root, name)?;
    let text = std::fs::read_to_string(&path).map_err(|_| Error::NotFound(name.to_string()))?;
    Ok(text.replace("\r\n", "\n"))
}

/// Saves a template, replacing one with the same name.
pub fn save(root: &Path, name: &str, content: &str) -> Result<()> {
    let path = file(root, name)?;
    std::fs::create_dir_all(folder(root))?;
    std::fs::write(path, content)?;
    Ok(())
}

pub fn delete(root: &Path, name: &str) -> Result<()> {
    let path = file(root, name)?;
    std::fs::remove_file(path).map_err(|_| Error::NotFound(name.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn templates_are_saved_listed_read_and_deleted() {
        let d = tempfile::tempdir().unwrap();
        assert!(list(d.path()).unwrap().is_empty());
        save(d.path(), "Acta", "# {{titulo}}\r\n\nFecha: {{fecha}}\n").unwrap();
        save(d.path(), "bitácora", "x").unwrap();
        std::fs::write(folder(d.path()).join("no.txt"), "x").unwrap();
        assert_eq!(list(d.path()).unwrap(), ["Acta", "bitácora"]);
        assert_eq!(read(d.path(), "Acta").unwrap(), "# {{titulo}}\n\nFecha: {{fecha}}\n");
        delete(d.path(), "Acta").unwrap();
        assert_eq!(list(d.path()).unwrap(), ["bitácora"]);
        assert!(read(d.path(), "Acta").is_err());
    }

    #[test]
    fn names_cannot_leave_the_folder() {
        let d = tempfile::tempdir().unwrap();
        for name in ["../fuera", "a/b", ".oculta", ""] {
            assert!(save(d.path(), name, "x").is_err(), "{name}");
            assert!(read(d.path(), name).is_err(), "{name}");
        }
    }
}
