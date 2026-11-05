//! Path rules. Every path that enters the app or the MCP server goes through here.
//!
//! Vault-relative paths always use `/`, on every platform. New names are held
//! to Windows rules even on Linux, so a vault can move between systems.

use crate::{Error, Result};
use std::path::{Component, Path, PathBuf};

const WINDOWS_RESERVED: &[&str] = &[
    "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
    "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

/// Extensions treated as notes.
pub const NOTE_EXTENSIONS: &[&str] = &["md", "markdown", "html", "htm"];

pub fn is_note(path: &str) -> bool {
    match path.rsplit_once('.') {
        Some((_, ext)) => NOTE_EXTENSIONS.contains(&ext.to_ascii_lowercase().as_str()),
        None => false,
    }
}

/// Splits a relative path into validated components.
/// Hidden entries (`.git`, `.obsidian`, `.env`...) are not reachable.
fn components(rel: &str) -> Result<Vec<&str>> {
    let rel = rel.trim_matches('/');
    let mut parts = Vec::new();
    for part in rel.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if part.starts_with('.') || part.contains('\0') {
            return Err(Error::PathNotAllowed(rel.to_string()));
        }
        // `C:` and alternate data streams (`note.md:stream`) on Windows.
        if cfg!(windows) && part.contains(':') {
            return Err(Error::PathNotAllowed(rel.to_string()));
        }
        parts.push(part);
    }
    Ok(parts)
}

/// Normalises a relative path to `a/b/c.md`. An empty string means the root.
pub fn normalize(rel: &str) -> Result<String> {
    if Path::new(rel).is_absolute() || rel.starts_with(['/', '\\']) {
        return Err(Error::PathNotAllowed(rel.to_string()));
    }
    Ok(components(rel)?.join("/"))
}

/// Checks that a name is valid on every supported platform.
pub fn check_new_name(name: &str) -> Result<()> {
    let bad = |why: &str| Err(Error::InvalidName(format!("{name}: {why}")));
    if name.is_empty() || name.len() > 255 {
        return bad("empty or too long");
    }
    if let Some(c) = name
        .chars()
        .find(|c| matches!(c, '<' | '>' | ':' | '"' | '|' | '?' | '*' | '/' | '\\') || c.is_control())
    {
        return bad(&format!("the character {c:?} is not allowed"));
    }
    if name.ends_with('.') || name.ends_with(' ') {
        return bad("it cannot end with a dot or a space");
    }
    let stem = name.split('.').next().unwrap_or(name).trim_end();
    if WINDOWS_RESERVED.iter().any(|r| r.eq_ignore_ascii_case(stem)) {
        return bad("the name is reserved on Windows");
    }
    Ok(())
}

pub fn check_new_path(rel: &str) -> Result<()> {
    for part in rel.split('/') {
        check_new_name(part)?;
    }
    Ok(())
}

/// Resolves a relative path inside `root`, refusing anything that leaves the
/// vault, including through symlinks. The target itself does not need to exist.
pub fn resolve(root: &Path, rel: &str) -> Result<PathBuf> {
    let rel_norm = normalize(rel)?;
    let root = root
        .canonicalize()
        .map_err(|_| Error::Vault(format!("vault folder not found: {}", root.display())))?;

    let mut existing = root.clone();
    let mut pending = Vec::new();
    for (i, part) in rel_norm.split('/').filter(|p| !p.is_empty()).enumerate() {
        let next = existing.join(part);
        // symlink_metadata also sees dangling symlinks, which exists() hides.
        if pending.is_empty() && next.symlink_metadata().is_ok() {
            existing = next
                .canonicalize()
                .map_err(|_| Error::PathNotAllowed(rel.to_string()))?;
        } else {
            pending.push((i, part));
        }
    }
    if !existing.starts_with(&root) {
        return Err(Error::PathNotAllowed(rel.to_string()));
    }
    Ok(pending.iter().fold(existing, |p, (_, part)| p.join(part)))
}

/// Converts an absolute path inside `root` to a vault-relative `/` path.
pub fn to_rel(root: &Path, path: &Path) -> Option<String> {
    let rel = path.strip_prefix(root).ok()?;
    let parts: Vec<_> = rel
        .components()
        .map(|c| match c {
            Component::Normal(s) => s.to_str(),
            _ => None,
        })
        .collect::<Option<_>>()?;
    Some(parts.join("/"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_separators() {
        assert_eq!(normalize("a\\b/c.md").unwrap(), "a/b/c.md");
        assert_eq!(normalize("./a//b.md").unwrap(), "a/b.md");
        assert_eq!(normalize("").unwrap(), "");
    }

    #[test]
    fn rejects_traversal_and_hidden() {
        for p in ["../x.md", "a/../../x.md", "..\\x.md", ".git/config", ".env", "a/.obsidian/x", "/etc/passwd"] {
            assert!(normalize(p).is_err(), "{p}");
        }
    }

    #[test]
    fn rejects_names_invalid_on_windows() {
        for n in ["CON", "con.md", "nul.txt", "LPT1", "a:b", "a?b", "a*b", "trail.", "trail ", ""] {
            assert!(check_new_name(n).is_err(), "{n}");
        }
        for n in ["ok.md", "console.md", "ñandú y más.md", "コメント.md"] {
            assert!(check_new_name(n).is_ok(), "{n}");
        }
    }

    #[test]
    fn resolves_inside_root() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir(d.path().join("a")).unwrap();
        let p = resolve(d.path(), "a/new/deep.md").unwrap();
        assert!(p.ends_with("a/new/deep.md"));
    }

    #[cfg(unix)]
    #[test]
    fn symlinks_cannot_escape() {
        let vault = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.md"), "x").unwrap();
        std::os::unix::fs::symlink(outside.path(), vault.path().join("out")).unwrap();
        std::os::unix::fs::symlink("/nonexistent/zz", vault.path().join("dangling")).unwrap();
        assert!(matches!(resolve(vault.path(), "out/secret.md"), Err(Error::PathNotAllowed(_))));
        assert!(matches!(resolve(vault.path(), "out/new.md"), Err(Error::PathNotAllowed(_))));
        assert!(matches!(resolve(vault.path(), "dangling/x.md"), Err(Error::PathNotAllowed(_))));
    }
}
