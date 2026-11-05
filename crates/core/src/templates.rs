//! Word templates, kept as plain `.docx` files in the config folder. The file
//! name is the template's name.

use crate::paths::check_new_name;
use crate::registry::config_dir;
use crate::{Error, Result};
use std::path::{Path, PathBuf};

const EXT: &str = ".docx";

fn dir() -> PathBuf {
    config_dir().join("templates")
}

fn file_of(name: &str) -> Result<PathBuf> {
    check_new_name(name)?;
    if name.starts_with('.') {
        return Err(Error::InvalidName(name.to_string()));
    }
    Ok(dir().join(format!("{name}{EXT}")))
}

pub fn list() -> Result<Vec<String>> {
    let Ok(entries) = std::fs::read_dir(dir()) else {
        return Ok(Vec::new());
    };
    let mut names: Vec<String> = entries
        .flatten()
        .filter_map(|e| e.file_name().to_str()?.strip_suffix(EXT).map(String::from))
        .collect();
    names.sort_by_key(|n| n.to_lowercase());
    Ok(names)
}

/// Copies a `.docx` in as a template, after checking that it can be used.
pub fn import(source: &Path) -> Result<String> {
    let bytes = std::fs::read(source)?;
    crate::docx::check_template(&bytes)?;
    let base = source.file_stem().and_then(|s| s.to_str()).unwrap_or("Plantilla");
    let names = list()?;
    let name = std::iter::once(base.to_string())
        .chain((2..).map(|i| format!("{base} {i}")))
        .find(|n| !names.iter().any(|t| t.eq_ignore_ascii_case(n)))
        .expect("unbounded");
    let file = file_of(&name)?;
    std::fs::create_dir_all(dir())?;
    std::fs::write(file, bytes)?;
    Ok(name)
}

pub fn read(name: &str) -> Result<Vec<u8>> {
    std::fs::read(file_of(name)?).map_err(|_| Error::NotFound(name.to_string()))
}

pub fn rename(name: &str, new_name: &str) -> Result<()> {
    let (from, to) = (file_of(name)?, file_of(new_name)?);
    if to.exists() {
        return Err(Error::AlreadyExists(new_name.to_string()));
    }
    Ok(std::fs::rename(from, to)?)
}

pub fn delete(name: &str) -> Result<()> {
    Ok(std::fs::remove_file(file_of(name)?)?)
}
