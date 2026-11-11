//! Git for vaults that already are repositories, or folders inside one. The
//! app never creates a repository: it shows what changed, a note as it was in
//! the last commit, and commits the vault's changes. It runs the system's
//! `git`, with fixed arguments and no shell; without `git` there is no Git.

use crate::{Error, Result};
use serde::Serialize;
use std::path::Path;
use std::process::{Command, Stdio};

/// Settings for every call. A repository's own configuration can name a
/// program to run on `status`; that one is turned off.
const SAFE: &[&str] = &["-c", "core.fsmonitor=false", "-c", "core.quotepath=false", "-c", "color.ui=false"];

fn git(root: &Path, args: &[&str]) -> Result<std::process::Output> {
    let mut command = Command::new("git");
    command.current_dir(root).args(SAFE).args(args).stdin(Stdio::null()).env("GIT_TERMINAL_PROMPT", "0");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window flashing up.
        command.creation_flags(0x0800_0000);
    }
    command.output().map_err(|e| Error::Vault(format!("git: {e}")))
}

/// Runs git and returns what it printed, or what it said went wrong.
fn run(root: &Path, args: &[&str]) -> Result<String> {
    let out = git(root, args)?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).into_owned())
    } else {
        let said = String::from_utf8_lossy(&out.stderr).trim().to_string();
        Err(Error::Vault(if said.is_empty() { "git failed".into() } else { said }))
    }
}

/// How a file differs from the last commit.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum State {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
    Conflict,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// From the vault root.
    pub path: String,
    pub state: State,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    /// The branch checked out, or None when detached.
    pub branch: Option<String>,
    pub changes: Vec<Change>,
}

/// Where the vault sits in its repository: the folder from the repository's
/// root, with a trailing `/`, or "" at the root. None if it is not in one.
fn prefix(root: &Path) -> Option<String> {
    let out = git(root, &["rev-parse", "--is-inside-work-tree", "--show-prefix"]).ok()?;
    if !out.status.success() {
        return None;
    }
    let text = String::from_utf8_lossy(&out.stdout);
    let mut lines = text.lines();
    (lines.next()? == "true").then(|| lines.next().unwrap_or("").to_string())
}

/// Whether the vault is in a Git repository.
pub fn is_repo(root: &Path) -> bool {
    prefix(root).is_some()
}

fn state_of(code: &str) -> State {
    let (index, tree) = (code.as_bytes()[0], code.as_bytes()[1]);
    match (index, tree) {
        (b'?', _) => State::Untracked,
        (b'U', _) | (_, b'U') | (b'A', b'A') | (b'D', b'D') => State::Conflict,
        (b'R', _) | (_, b'R') => State::Renamed,
        (b'A', _) | (_, b'A') => State::Added,
        (b'D', _) | (_, b'D') => State::Deleted,
        _ => State::Modified,
    }
}

/// What changed in the vault since the last commit. None if it is not in a repository.
pub fn status(root: &Path) -> Result<Option<Status>> {
    let Some(prefix) = prefix(root) else { return Ok(None) };
    let text = run(root, &["status", "--porcelain=v1", "-z", "--branch", "--untracked-files=all", "--", "."])?;
    let mut entries = text.split('\0').filter(|e| !e.is_empty());
    let mut branch = None;
    let mut changes = Vec::new();
    while let Some(entry) = entries.next() {
        if let Some(head) = entry.strip_prefix("## ") {
            let name = head.split("...").next().unwrap_or(head).trim();
            let name = name.strip_prefix("No commits yet on ").unwrap_or(name);
            branch = (!name.starts_with("HEAD")).then(|| name.to_string());
            continue;
        }
        if entry.len() < 4 {
            continue;
        }
        let state = state_of(&entry[..2]);
        // A rename is followed by the path it had.
        if entry.as_bytes()[0] == b'R' || entry.as_bytes()[0] == b'C' {
            entries.next();
        }
        let path = &entry[3..];
        if let Some(inside) = path.strip_prefix(prefix.as_str()) {
            changes.push(Change { path: inside.to_string(), state });
        }
    }
    Ok(Some(Status { branch, changes }))
}

/// A note as it was in the last commit, or None if it was not in it.
pub fn committed(root: &Path, path: &str) -> Result<Option<String>> {
    let path = crate::paths::normalize(path)?;
    let Some(prefix) = prefix(root) else { return Err(Error::Vault("not a Git repository".into())) };
    let out = git(root, &["show", &format!("HEAD:{prefix}{path}")])?;
    Ok(out.status.success().then(|| String::from_utf8_lossy(&out.stdout).replace("\r\n", "\n")))
}

/// Commits every change inside the vault, and only those. Returns the new commit's short id.
pub fn commit(root: &Path, message: &str) -> Result<String> {
    let message = message.trim();
    if message.is_empty() {
        return Err(Error::Vault("the commit needs a message".into()));
    }
    if prefix(root).is_none() {
        return Err(Error::Vault("not a Git repository".into()));
    }
    run(root, &["add", "--all", "--", "."])?;
    run(root, &["commit", "--quiet", "-m", message, "--", "."])?;
    Ok(run(root, &["rev-parse", "--short", "HEAD"])?.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn repo() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        for args in [
            vec!["init", "--quiet", "--initial-branch=main"],
            vec!["config", "user.name", "Prueba"],
            vec!["config", "user.email", "prueba@example.com"],
            vec!["config", "commit.gpgsign", "false"],
        ] {
            run(d.path(), &args).unwrap();
        }
        d
    }

    #[test]
    fn a_folder_outside_git_has_no_git() {
        let d = tempfile::tempdir().unwrap();
        assert!(!is_repo(d.path()));
        assert_eq!(status(d.path()).unwrap(), None);
    }

    #[test]
    fn shows_changes_compares_and_commits_only_the_vault() {
        let d = repo();
        let vault = d.path().join("Notas");
        std::fs::create_dir_all(vault.join("sub")).unwrap();
        std::fs::write(vault.join("a.md"), "uno\n").unwrap();
        std::fs::write(d.path().join("fuera.txt"), "x").unwrap();
        let first = status(&vault).unwrap().unwrap();
        assert_eq!(first.branch.as_deref(), Some("main"));
        assert_eq!(first.changes, [Change { path: "a.md".into(), state: State::Untracked }]);
        assert_eq!(committed(&vault, "a.md").unwrap(), None);

        commit(&vault, "Primera").unwrap();
        assert!(status(&vault).unwrap().unwrap().changes.is_empty());
        assert!(
            run(d.path(), &["status", "--porcelain"]).unwrap().contains("fuera.txt"),
            "outside the vault stays out"
        );

        std::fs::write(vault.join("a.md"), "dos\n").unwrap();
        std::fs::write(vault.join("sub/con espacio ñ.md"), "x").unwrap();
        let next = status(&vault).unwrap().unwrap();
        assert!(next.changes.contains(&Change { path: "a.md".into(), state: State::Modified }));
        assert!(next.changes.contains(&Change { path: "sub/con espacio ñ.md".into(), state: State::Untracked }));
        assert_eq!(committed(&vault, "a.md").unwrap().as_deref(), Some("uno\n"));

        assert!(commit(&vault, "  ").is_err());
        assert!(committed(&vault, "../fuera.txt").is_err());
    }
}
