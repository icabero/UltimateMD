//! Word templates, kept as plain `.docx` files in the config folder. The file
//! name is the template's name.

use crate::paths::check_new_name;
use crate::registry::config_dir;
use crate::{Error, Result};
use std::path::{Path, PathBuf};

const EXT: &str = ".docx";
/// The built-in example. It always exists and cannot be changed.
pub const EXAMPLE: &str = "Ejemplo";

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
        return Ok(vec![EXAMPLE.to_string()]);
    };
    let mut names: Vec<String> =
        entries.flatten().filter_map(|e| e.file_name().to_str()?.strip_suffix(EXT).map(String::from)).collect();
    names.sort_by_key(|n| n.to_lowercase());
    names.insert(0, EXAMPLE.to_string());
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
    if name == EXAMPLE {
        return Ok(crate::docx::example_template());
    }
    std::fs::read(file_of(name)?).map_err(|_| Error::NotFound(name.to_string()))
}

fn check_editable(name: &str) -> Result<()> {
    if name.eq_ignore_ascii_case(EXAMPLE) {
        return Err(Error::InvalidName(name.to_string()));
    }
    Ok(())
}

pub fn rename(name: &str, new_name: &str) -> Result<()> {
    check_editable(name)?;
    check_editable(new_name)?;
    let (from, to) = (file_of(name)?, file_of(new_name)?);
    if to.exists() {
        return Err(Error::AlreadyExists(new_name.to_string()));
    }
    Ok(std::fs::rename(from, to)?)
}

pub fn delete(name: &str) -> Result<()> {
    check_editable(name)?;
    Ok(std::fs::remove_file(file_of(name)?)?)
}
