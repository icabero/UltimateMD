//! How a vault's daily notes are made, kept in `.ultimatemd/diario.json` so it
//! travels with the vault. A vault may come from someone else, so the settings are
//! validated data: the folder ends up as a path inside the vault.

use crate::files::atomic_write;
use crate::paths::{check_new_path, normalize};
use crate::vault_themes::FOLDER;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::Path;

const FILE: &str = "diario.json";
const MAX_FILE: u64 = 16 * 1024;
const MAX_TEMPLATE: usize = 200;

/// How the note of a day is named.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NameFormat {
    /// `2026-11-13`
    #[default]
    Iso,
    /// `2026/11/2026-11-13`
    YearMonth,
    /// `13-11-2026`
    DayFirst,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DailySettings {
    /// Folder of the vault where the notes go; empty is the vault itself.
    pub folder: String,
    pub format: NameFormat,
    /// Name of one of the vault's note templates.
    pub template: Option<String>,
}

impl Default for DailySettings {
    fn default() -> Self {
        Self { folder: "Diario".into(), format: NameFormat::default(), template: None }
    }
}

impl DailySettings {
    pub fn validate(&self) -> Result<()> {
        if !self.folder.is_empty() {
            check_new_path(&normalize(&self.folder)?)?;
        }
        let bad = |t: &String| {
            t.is_empty() || t.len() > MAX_TEMPLATE || t.chars().any(|c| c.is_control() || c == '/' || c == '\\')
        };
        if self.template.as_ref().is_some_and(bad) {
            return Err(Error::Vault("invalid template".into()));
        }
        Ok(())
    }
}

/// The vault's settings. A missing or damaged file means the defaults.
pub fn load(root: &Path) -> DailySettings {
    let file = root.join(FOLDER).join(FILE);
    let small = std::fs::metadata(&file).is_ok_and(|m| m.len() <= MAX_FILE);
    small
        .then(|| std::fs::read_to_string(&file).ok())
        .flatten()
        .and_then(|text| serde_json::from_str::<DailySettings>(&text).ok())
        .filter(|s| s.validate().is_ok())
        .unwrap_or_default()
}

pub fn save(root: &Path, settings: &DailySettings) -> Result<()> {
    let mut settings = settings.clone();
    if !settings.folder.is_empty() {
        settings.folder = normalize(&settings.folder)?;
    }
    settings.validate()?;
    std::fs::create_dir_all(root.join(FOLDER))?;
    atomic_write(&root.join(FOLDER).join(FILE), serde_json::to_string_pretty(&settings)?.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_without_a_file() {
        let dir = tempfile::tempdir().unwrap();
        let s = load(dir.path());
        assert_eq!(s.folder, "Diario");
        assert_eq!(s.format, NameFormat::Iso);
        assert_eq!(s.template, None);
    }

    #[test]
    fn saves_and_loads() {
        let dir = tempfile::tempdir().unwrap();
        let s = DailySettings {
            folder: "Notas/Diario/".into(),
            format: NameFormat::YearMonth,
            template: Some("Día".into()),
        };
        save(dir.path(), &s).unwrap();
        let back = load(dir.path());
        assert_eq!(back.folder, "Notas/Diario");
        assert_eq!(back.format, NameFormat::YearMonth);
        assert_eq!(back.template.as_deref(), Some("Día"));
    }

    #[test]
    fn refuses_folders_outside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        for folder in ["../fuera", "/abs", "a/../../b"] {
            let s = DailySettings { folder: folder.into(), ..Default::default() };
            assert!(save(dir.path(), &s).is_err(), "{folder}");
        }
    }

    #[test]
    fn a_damaged_file_means_defaults() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(FOLDER)).unwrap();
        std::fs::write(dir.path().join(FOLDER).join(FILE), r#"{"folder":"../x"}"#).unwrap();
        assert_eq!(load(dir.path()), DailySettings::default());
    }
}
