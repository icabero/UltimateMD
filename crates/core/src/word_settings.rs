//! How a vault's documents go to Word, kept in `.ultimatemd/` with its template so
//! both travel with the vault. A vault may come from someone else, so the settings
//! are validated data: they end up inside the document's XML.

use crate::files::atomic_write;
use crate::vault_themes::FOLDER;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const SETTINGS: &str = "word.json";
const TEMPLATE: &str = "plantilla.docx";
const MAX_FILE: u64 = 16 * 1024;
const MAX_STYLE_ID: usize = 120;
const TEXT_SIZES: std::ops::RangeInclusive<f32> = 6.0..=24.0;
const IMAGE_WIDTHS: std::ops::RangeInclusive<u32> = 50..=1000;

/// What the user chose. Anything unset falls back on what the template suggests.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct WordSettings {
    /// Style id for each heading level, from level 1.
    pub headings: [Option<String>; 6],
    pub body: Option<String>,
    /// Background of a table's first row, as `RRGGBB`.
    pub header_fill: Option<String>,
    /// In points.
    pub table_text_size: Option<f32>,
    pub code_text_size: Option<f32>,
    pub image_max_width: Option<u32>,
    /// Writes code blocks with no background.
    pub plain_code: bool,
}

fn check_style(id: &str) -> Result<()> {
    let valid =
        !id.is_empty() && id.len() <= MAX_STYLE_ID && !id.chars().any(|c| c.is_control() || "\"<>&'".contains(c));
    if valid { Ok(()) } else { Err(Error::Vault(format!("invalid style: {id}"))) }
}

fn check_size(size: Option<f32>) -> Result<()> {
    if size.is_none_or(|s| TEXT_SIZES.contains(&s)) { Ok(()) } else { Err(Error::Vault("invalid text size".into())) }
}

impl WordSettings {
    pub fn validate(&self) -> Result<()> {
        for id in self.headings.iter().chain([&self.body]).flatten() {
            check_style(id)?;
        }
        if let Some(fill) = &self.header_fill
            && !(fill.len() == 6 && fill.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(Error::Vault("invalid header colour".into()));
        }
        check_size(self.table_text_size)?;
        check_size(self.code_text_size)?;
        if self.image_max_width.is_some_and(|w| !IMAGE_WIDTHS.contains(&w)) {
            return Err(Error::Vault("invalid image width".into()));
        }
        Ok(())
    }
}

fn folder(root: &Path) -> PathBuf {
    root.join(FOLDER)
}

/// The vault's settings. Damaged or invalid ones count as none: an export must
/// not fail over them.
pub fn load(root: &Path) -> WordSettings {
    let file = folder(root).join(SETTINGS);
    let small = std::fs::metadata(&file).is_ok_and(|m| m.len() <= MAX_FILE);
    small
        .then(|| std::fs::read_to_string(&file).ok())
        .flatten()
        .and_then(|text| serde_json::from_str::<WordSettings>(&text).ok())
        .filter(|settings| settings.validate().is_ok())
        .unwrap_or_default()
}

pub fn save(root: &Path, settings: &WordSettings) -> Result<()> {
    settings.validate()?;
    std::fs::create_dir_all(folder(root))?;
    atomic_write(&folder(root).join(SETTINGS), serde_json::to_string_pretty(settings)?.as_bytes())
}

pub fn template(root: &Path) -> Option<Vec<u8>> {
    let file = folder(root).join(TEMPLATE);
    // Symlinks could point outside the vault.
    let plain = std::fs::symlink_metadata(&file).is_ok_and(|m| m.is_file());
    plain.then(|| std::fs::read(file).ok()).flatten()
}

/// Copies a `.docx` into the vault as its template, after checking it can be used.
pub fn set_template(root: &Path, source: &Path) -> Result<()> {
    let bytes = std::fs::read(source)?;
    crate::docx::check_template(&bytes)?;
    std::fs::create_dir_all(folder(root))?;
    atomic_write(&folder(root).join(TEMPLATE), &bytes)
}

pub fn remove_template(root: &Path) -> Result<()> {
    match std::fs::remove_file(folder(root).join(TEMPLATE)) {
        Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn settings_round_trip_inside_the_vault() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(load(dir.path()), WordSettings::default());
        let mut settings = WordSettings {
            body: Some("Cuerpo".into()),
            header_fill: Some("A1B2C3".into()),
            image_max_width: Some(420),
            ..WordSettings::default()
        };
        settings.headings[1] = Some("Propio 2".into());
        save(dir.path(), &settings).unwrap();
        assert_eq!(load(dir.path()), settings);
    }

    #[test]
    fn values_that_could_reach_the_xml_are_refused() {
        let dir = tempfile::tempdir().unwrap();
        let bad = [
            WordSettings { body: Some(r#"x"/><w:evil/>"#.into()), ..WordSettings::default() },
            WordSettings { header_fill: Some("red".into()), ..WordSettings::default() },
            WordSettings { header_fill: Some(r#"00"0000"#.into()), ..WordSettings::default() },
            WordSettings { table_text_size: Some(500.0), ..WordSettings::default() },
            WordSettings { image_max_width: Some(1), ..WordSettings::default() },
        ];
        for settings in bad {
            assert!(save(dir.path(), &settings).is_err(), "{settings:?}");
        }
    }

    #[test]
    fn a_damaged_or_tampered_file_counts_as_none() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(folder(dir.path())).unwrap();
        let file = folder(dir.path()).join(SETTINGS);
        std::fs::write(&file, "{ roto").unwrap();
        assert_eq!(load(dir.path()), WordSettings::default());
        std::fs::write(&file, r#"{"body":"a\"b"}"#).unwrap();
        assert_eq!(load(dir.path()), WordSettings::default());
    }

    #[test]
    fn a_file_that_is_no_template_is_refused() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("x.docx");
        std::fs::write(&source, "nope").unwrap();
        assert!(set_template(dir.path(), &source).is_err());
        assert!(template(dir.path()).is_none());
        remove_template(dir.path()).unwrap();
    }
}
