//! Themes that travel with a vault, in `.ultimatemd/`. A vault may come from
//! someone else, or have been written by an AI, so a theme is validated data:
//! known colours and options only, never CSS, so it cannot load anything or
//! touch the interface.

use crate::files::atomic_write;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const FOLDER: &str = ".ultimatemd";
const THEMES: &str = "temas";
const CONFIG: &str = "config.json";
const EXT: &str = ".json";
const MAX_FILE: u64 = 16 * 1024;
const MAX_NAME: usize = 60;
const MAX_ID: usize = 40;

const BASES: &[&str] = &["claro", "oscuro", "sepia", "rosa", "medianoche", "bosque", "grafito", "contraste"];
const COLORS: &[&str] = &[
    "bg",
    "panel",
    "raised",
    "line",
    "text",
    "text2",
    "text3",
    "accent",
    "accentText",
    "onAccent",
    "danger",
    "warn",
    "synString",
    "synKeyword",
    "synNumber",
    "synAttr",
];
const DIAGRAM_COLORS: &[&str] = &["surface", "border", "line", "text"];

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Prose {
    Serif,
    Sans,
}

/// A theme is a built-in base plus the values that differ from it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ThemeFile {
    pub id: String,
    pub name: String,
    pub base: String,
    #[serde(default)]
    pub colors: BTreeMap<String, String>,
    #[serde(default)]
    pub diagram: BTreeMap<String, String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub prose: Option<Prose>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Config {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_theme: Option<String>,
    /// A theme for diagrams alone, or `boceto` for the hand-drawn look.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    default_diagram_theme: Option<String>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VaultThemes {
    pub default_theme: Option<String>,
    pub default_diagram_theme: Option<String>,
    pub themes: Vec<ThemeFile>,
    /// Files that were ignored because they are not valid themes.
    pub invalid: Vec<String>,
}

fn is_hex_color(value: &str) -> bool {
    value.len() == 7 && value.starts_with('#') && value[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

fn check_id(id: &str) -> Result<()> {
    let valid = !id.is_empty()
        && id.len() <= MAX_ID
        && id.bytes().all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        && !id.starts_with('-');
    if valid { Ok(()) } else { Err(Error::InvalidName(id.to_string())) }
}

fn check_colors(colors: &BTreeMap<String, String>, allowed: &[&str]) -> Result<()> {
    for (key, value) in colors {
        if !allowed.contains(&key.as_str()) || !is_hex_color(value) {
            return Err(Error::Vault(format!("invalid theme colour: {key}")));
        }
    }
    Ok(())
}

impl ThemeFile {
    fn validate(&self) -> Result<()> {
        check_id(&self.id)?;
        if self.name.trim().is_empty()
            || self.name.chars().count() > MAX_NAME
            || self.name.chars().any(char::is_control)
        {
            return Err(Error::InvalidName(self.name.clone()));
        }
        if !BASES.contains(&self.base.as_str()) {
            return Err(Error::Vault(format!("unknown base theme: {}", self.base)));
        }
        check_colors(&self.colors, COLORS)?;
        check_colors(&self.diagram, DIAGRAM_COLORS)
    }
}

fn themes_dir(root: &Path) -> PathBuf {
    root.join(FOLDER).join(THEMES)
}

fn read_theme(path: &Path) -> Result<ThemeFile> {
    if std::fs::metadata(path)?.len() > MAX_FILE {
        return Err(Error::Vault("theme file too large".into()));
    }
    let theme: ThemeFile = serde_json::from_str(&std::fs::read_to_string(path)?)?;
    theme.validate()?;
    // The file name is the id, so that saving and deleting agree with listing.
    if path.file_stem().and_then(|s| s.to_str()) != Some(theme.id.as_str()) {
        return Err(Error::Vault("theme id does not match its file".into()));
    }
    Ok(theme)
}

fn read_config(root: &Path) -> Config {
    std::fs::read_to_string(root.join(FOLDER).join(CONFIG))
        .ok()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

pub fn load(root: &Path) -> Result<VaultThemes> {
    let config = read_config(root);
    let mut out = VaultThemes {
        default_theme: config.default_theme,
        default_diagram_theme: config.default_diagram_theme,
        ..Default::default()
    };
    let Ok(entries) = std::fs::read_dir(themes_dir(root)) else {
        return Ok(out);
    };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if !name.ends_with(EXT) || name.starts_with('.') {
            continue;
        }
        // Symlinks could point outside the vault.
        let plain_file = entry.file_type().is_ok_and(|t| t.is_file());
        match plain_file.then(|| read_theme(&entry.path())) {
            Some(Ok(theme)) => out.themes.push(theme),
            _ => out.invalid.push(name),
        }
    }
    out.themes.sort_by_key(|t| t.name.to_lowercase());
    out.invalid.sort();
    Ok(out)
}

pub fn save(root: &Path, theme: &ThemeFile) -> Result<()> {
    theme.validate()?;
    let dir = themes_dir(root);
    std::fs::create_dir_all(&dir)?;
    atomic_write(&dir.join(format!("{}{EXT}", theme.id)), serde_json::to_string_pretty(theme)?.as_bytes())
}

pub fn delete(root: &Path, id: &str) -> Result<()> {
    check_id(id)?;
    let config = read_config(root);
    if config.default_theme.as_deref() == Some(id) {
        set_default(root, None)?;
    }
    if config.default_diagram_theme.as_deref() == Some(id) {
        set_default_diagrams(root, None)?;
    }
    Ok(std::fs::remove_file(themes_dir(root).join(format!("{id}{EXT}")))?)
}

/// Sets the vault's default theme, a vault theme or built-in. None clears it.
pub fn set_default(root: &Path, id: Option<String>) -> Result<()> {
    change_config(root, &id, |config| config.default_theme = id.clone())
}

/// Sets the theme for the vault's diagrams, or `boceto`. None leaves them to each note.
pub fn set_default_diagrams(root: &Path, id: Option<String>) -> Result<()> {
    change_config(root, &id, |config| config.default_diagram_theme = id.clone())
}

fn change_config(root: &Path, id: &Option<String>, change: impl FnOnce(&mut Config)) -> Result<()> {
    if let Some(id) = id {
        check_id(id)?;
    }
    let dir = root.join(FOLDER);
    std::fs::create_dir_all(&dir)?;
    let mut config = read_config(root);
    change(&mut config);
    atomic_write(&dir.join(CONFIG), serde_json::to_string_pretty(&config)?.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample(id: &str) -> ThemeFile {
        ThemeFile {
            id: id.to_string(),
            name: "Corporativo".to_string(),
            base: "claro".to_string(),
            colors: BTreeMap::from([("accent".to_string(), "#0b5394".to_string())]),
            diagram: BTreeMap::from([("surface".to_string(), "#eef3f9".to_string())]),
            prose: Some(Prose::Sans),
        }
    }

    fn write_raw(root: &Path, name: &str, text: &str) {
        std::fs::create_dir_all(themes_dir(root)).unwrap();
        std::fs::write(themes_dir(root).join(name), text).unwrap();
    }

    #[test]
    fn themes_round_trip_inside_the_vault() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), &sample("corp")).unwrap();
        set_default(d.path(), Some("corp".into())).unwrap();
        assert!(d.path().join(".ultimatemd/temas/corp.json").is_file());

        let loaded = load(d.path()).unwrap();
        assert_eq!(loaded.themes, [sample("corp")]);
        assert_eq!(loaded.default_theme.as_deref(), Some("corp"));

        delete(d.path(), "corp").unwrap();
        let loaded = load(d.path()).unwrap();
        assert!(loaded.themes.is_empty());
        assert_eq!(loaded.default_theme, None, "deleting the default clears it");

        set_default(d.path(), Some("corp".into())).unwrap();
        set_default_diagrams(d.path(), Some("boceto".into())).unwrap();
        let both = load(d.path()).unwrap();
        assert_eq!(both.default_theme.as_deref(), Some("corp"), "one setting keeps the other");
        assert_eq!(both.default_diagram_theme.as_deref(), Some("boceto"));
    }

    #[test]
    fn empty_vault_has_no_themes() {
        let d = tempfile::tempdir().unwrap();
        let loaded = load(d.path()).unwrap();
        assert!(loaded.themes.is_empty() && loaded.invalid.is_empty());
    }

    #[test]
    fn rejects_anything_that_is_not_plain_data() {
        let d = tempfile::tempdir().unwrap();
        let mut css = sample("a");
        css.colors.insert("bg".into(), "url(https://evil.example/x)".into());
        assert!(save(d.path(), &css).is_err());

        let mut escape = sample("a");
        escape.colors.insert("bg".into(), "#fff;}body{display:none".into());
        assert!(save(d.path(), &escape).is_err());

        let mut unknown = sample("a");
        unknown.colors.insert("--app-chrome".into(), "#000000".into());
        assert!(save(d.path(), &unknown).is_err());

        let mut base = sample("a");
        base.base = "otra".into();
        assert!(save(d.path(), &base).is_err());

        for id in ["../fuera", "a/b", "", "UP", "-x", "a.json"] {
            assert!(save(d.path(), &sample(id)).is_err(), "{id}");
            assert!(delete(d.path(), id).is_err(), "{id}");
            assert!(set_default(d.path(), Some(id.into())).is_err(), "{id}");
        }
        assert!(!d.path().join(".ultimatemd/fuera.json").exists());
    }

    #[test]
    fn invalid_files_are_reported_and_skipped() {
        let d = tempfile::tempdir().unwrap();
        save(d.path(), &sample("buena")).unwrap();
        write_raw(d.path(), "rota.json", "{ esto no es json");
        write_raw(d.path(), "css.json", r#"{"id":"css","name":"x","base":"claro","colors":{"bg":"url(x)"}}"#);
        write_raw(d.path(), "extra.json", r#"{"id":"extra","name":"x","base":"claro","css":"body{}"}"#);
        write_raw(d.path(), "otro.json", r#"{"id":"distinto","name":"x","base":"claro"}"#);
        write_raw(d.path(), "grande.json", &" ".repeat(MAX_FILE as usize + 1));
        let loaded = load(d.path()).unwrap();
        assert_eq!(loaded.themes, [sample("buena")]);
        assert_eq!(loaded.invalid, ["css.json", "extra.json", "grande.json", "otro.json", "rota.json"]);
    }

    #[cfg(unix)]
    #[test]
    fn symlinked_themes_are_not_followed() {
        let d = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        save(outside.path(), &sample("fuera")).unwrap();
        std::fs::create_dir_all(themes_dir(d.path())).unwrap();
        std::os::unix::fs::symlink(
            themes_dir(outside.path()).join("fuera.json"),
            themes_dir(d.path()).join("fuera.json"),
        )
        .unwrap();
        let loaded = load(d.path()).unwrap();
        assert!(loaded.themes.is_empty());
        assert_eq!(loaded.invalid, ["fuera.json"]);
    }
}
