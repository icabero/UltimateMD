//! A colour or an emoji for a folder, chosen per vault and kept in
//! `.ultimatemd/carpetas.json` so it travels with the vault. The file maps a
//! folder's path to its look; folders without one are not in it.

use crate::files::atomic_write;
use crate::paths::normalize;
use crate::vault_themes::FOLDER;
use crate::{Error, Result};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::Path;

const FILE: &str = "carpetas.json";
const MAX_FILE: u64 = 4 * 1024 * 1024;
/// The colours on offer, each one a colour of the theme so it suits light and dark.
pub const COLORS: [&str; 7] = ["accent", "danger", "string", "attr", "keyword", "number", "muted"];
/// More than a ZWJ sequence of a few emoji is not an icon.
const MAX_EMOJI: usize = 16;

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct FolderLook {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub emoji: Option<String>,
}

pub type Looks = BTreeMap<String, FolderLook>;

fn file(root: &Path) -> std::path::PathBuf {
    root.join(FOLDER).join(FILE)
}

/// The vault's folder looks. A missing or damaged file means none.
pub fn load(root: &Path) -> Looks {
    let path = file(root);
    let small = std::fs::metadata(&path).is_ok_and(|m| m.len() <= MAX_FILE);
    small
        .then(|| std::fs::read_to_string(&path).ok())
        .flatten()
        .and_then(|text| serde_json::from_str(&text).ok())
        .unwrap_or_default()
}

fn save(root: &Path, looks: &Looks) -> Result<()> {
    let path = file(root);
    if looks.is_empty() {
        return match std::fs::remove_file(&path) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e.into()),
            _ => Ok(()),
        };
    }
    std::fs::create_dir_all(root.join(FOLDER))?;
    atomic_write(&path, serde_json::to_string_pretty(looks)?.as_bytes())
}

/// Sets the look of `folder`, or forgets it when `look` is `None` or empty.
pub fn set(root: &Path, folder: &str, look: Option<FolderLook>) -> Result<()> {
    let folder = normalize(folder)?;
    if folder.is_empty() {
        return Err(Error::PathNotAllowed(folder));
    }
    let look = look.map(|l| FolderLook {
        color: l.color.filter(|c| COLORS.contains(&c.as_str())),
        emoji: l
            .emoji
            .map(|e| e.trim().to_string())
            .filter(|e| !e.is_empty() && e.chars().count() <= MAX_EMOJI && !e.chars().any(char::is_control)),
    });
    let mut looks = load(root);
    match look {
        Some(l) if l != FolderLook::default() => looks.insert(folder, l),
        _ => looks.remove(&folder),
    };
    save(root, &looks)
}

/// Keeps the looks right after `from` became `to`: the folder and the ones inside it follow.
pub fn renamed(root: &Path, from: &str, to: &str) {
    let mut looks = load(root);
    let inside = format!("{from}/");
    let moved: Vec<String> = looks.keys().filter(|k| *k == from || k.starts_with(&inside)).cloned().collect();
    if moved.is_empty() {
        return;
    }
    for key in moved {
        if let Some(look) = looks.remove(&key) {
            looks.insert(format!("{to}{}", &key[from.len()..]), look);
        }
    }
    let _ = save(root, &looks);
}

/// Forgets `rel` and what is inside it after it was deleted.
pub fn removed(root: &Path, rel: &str) {
    let mut looks = load(root);
    let inside = format!("{rel}/");
    let before = looks.len();
    looks.retain(|k, _| k != rel && !k.starts_with(&inside));
    if looks.len() != before {
        let _ = save(root, &looks);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn look(color: &str, emoji: &str) -> Option<FolderLook> {
        Some(FolderLook { color: Some(color.into()), emoji: Some(emoji.into()) })
    }

    #[test]
    fn sets_validates_and_clears() {
        let d = tempfile::tempdir().unwrap();
        set(d.path(), "a", look("accent", "🧭")).unwrap();
        set(d.path(), "b/c", look("nope", "")).unwrap();
        let looks = load(d.path());
        assert_eq!(looks["a"].emoji.as_deref(), Some("🧭"));
        assert!(!looks.contains_key("b/c"), "an unknown colour and no emoji is no look");
        set(d.path(), "a", None).unwrap();
        assert!(load(d.path()).is_empty());
        assert!(!file(d.path()).exists());
        assert!(set(d.path(), "", look("accent", "x")).is_err());
    }

    #[test]
    fn follows_renames_and_deletes() {
        let d = tempfile::tempdir().unwrap();
        set(d.path(), "a", look("danger", "")).unwrap();
        set(d.path(), "a/b", look("muted", "📁")).unwrap();
        set(d.path(), "ab", look("muted", "")).unwrap();
        renamed(d.path(), "a", "x/a2");
        let keys: Vec<_> = load(d.path()).into_keys().collect();
        assert_eq!(keys, ["ab", "x/a2", "x/a2/b"]);
        removed(d.path(), "x/a2");
        assert_eq!(load(d.path()).into_keys().collect::<Vec<_>>(), ["ab"]);
    }
}
