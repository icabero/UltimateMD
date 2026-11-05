//! Files opened from outside any vault. Each is registered under an id, and
//! that id gives access to that single file, never to the folder around it.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, Mutex, MutexGuard};
use ultimatemd_core::{Error, Result, VaultFs};

const PREFIX: &str = "loose-";

static FILES: LazyLock<Mutex<HashMap<String, PathBuf>>> = LazyLock::new(Default::default);

fn files() -> MutexGuard<'static, HashMap<String, PathBuf>> {
    FILES.lock().unwrap_or_else(|e| e.into_inner())
}

/// Returns the file's id. Opening the same file again gives the same id.
pub fn register(file: &Path) -> String {
    let mut files = files();
    if let Some((id, _)) = files.iter().find(|(_, path)| path.as_path() == file) {
        return id.clone();
    }
    let mut n = files.len();
    let id = loop {
        let id = format!("{PREFIX}{n}");
        if !files.contains_key(&id) {
            break id;
        }
        n += 1;
    };
    files.insert(id.clone(), file.to_path_buf());
    id
}

pub fn remove(id: &str) {
    files().remove(id);
}

pub fn dir_of(id: &str) -> Option<PathBuf> {
    files().get(id)?.parent().map(Path::to_path_buf)
}

/// None when `id` is not a loose file. Otherwise gives access to its folder,
/// only if `path` names that very file.
pub fn folder_for(id: &str, path: &str) -> Option<Result<VaultFs>> {
    if !id.starts_with(PREFIX) {
        return None;
    }
    let files = files();
    let Some(file) = files.get(id) else {
        return Some(Err(Error::UnknownVault(id.to_string())));
    };
    let same = file.file_name().is_some_and(|n| n.to_string_lossy() == path);
    Some(match (same, file.parent()) {
        (true, Some(dir)) => Ok(VaultFs::new(dir)),
        _ => Err(Error::PathNotAllowed(path.to_string())),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn access_is_limited_to_the_registered_file() {
        let d = tempfile::tempdir().unwrap();
        let file = d.path().canonicalize().unwrap().join("nota.md");
        std::fs::write(&file, "hola").unwrap();
        std::fs::write(file.with_file_name("otra.md"), "secreto").unwrap();

        let id = register(&file);
        assert_eq!(register(&file), id, "the same file keeps its id");
        assert_eq!(folder_for(&id, "nota.md").unwrap().unwrap().read("nota.md").unwrap().content, "hola");
        for path in ["otra.md", "../otra.md", "./nota.md", ""] {
            assert!(folder_for(&id, path).unwrap().is_err(), "{path}");
        }
        assert!(folder_for("un-vault-normal", "x.md").is_none());

        remove(&id);
        assert!(folder_for(&id, "nota.md").unwrap().is_err());
    }
}
