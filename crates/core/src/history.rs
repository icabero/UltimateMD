//! Past versions of notes and a log of what the AI did, kept in the app's own
//! data folder and never inside a vault: vaults stay plain folders, safe to
//! sync, and a vault that is already a repository gets nothing added to it.
//!
//! Each vault has a folder with the texts themselves, stored once each under
//! the hash of their content, one small index per note, and the AI's log.

use crate::files::version_of;
use crate::registry::config_dir;
use crate::{Error, Result, VaultFs, WriteMode, links};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

/// Versions kept per note; the oldest go first.
const MAX_PER_NOTE: usize = 60;
/// Versions older than this are dropped.
const MAX_AGE: Duration = Duration::from_secs(90 * 24 * 3600);
/// Entries of the AI's log that are listed.
const LOG_SHOWN: usize = 300;

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Source {
    /// Written in the app.
    Edit,
    /// As the note was right before the AI changed it.
    BeforeAi,
    /// As the note was right before an older version was brought back.
    BeforeRestore,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    /// Milliseconds since the epoch.
    pub time: u64,
    /// Names the text, to read it with.
    pub blob: String,
    pub source: Source,
}

#[derive(Default, Serialize, Deserialize)]
struct Index {
    path: String,
    snapshots: Vec<Snapshot>,
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

/// Where a vault's history lives. Ids come from the registry or from callers
/// in this crate's users; anything that is not a plain name is refused.
fn dir_in(base: &Path, vault_id: &str) -> Result<PathBuf> {
    if vault_id.is_empty() || !vault_id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_') {
        return Err(Error::UnknownVault(vault_id.to_string()));
    }
    Ok(base.join("history").join(vault_id))
}

fn index_file(dir: &Path, path: &str) -> PathBuf {
    dir.join("notes").join(format!("{}.json", version_of(path.as_bytes())))
}

fn load_index(dir: &Path, path: &str) -> Index {
    std::fs::read_to_string(index_file(dir, path))
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| Index { path: path.to_string(), snapshots: Vec::new() })
}

/// Written beside and renamed over, so a reader never sees half a file.
fn write_atomic(file: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = file.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let temp = file.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&temp, bytes)?;
    std::fs::rename(&temp, file).inspect_err(|_| {
        let _ = std::fs::remove_file(&temp);
    })?;
    Ok(())
}

fn save_index(dir: &Path, index: &Index) -> Result<()> {
    write_atomic(&index_file(dir, &index.path), &serde_json::to_vec(index)?)
}

fn store_blob(dir: &Path, content: &str) -> Result<String> {
    let blob = version_of(content.as_bytes());
    let file = dir.join("blobs").join(&blob);
    if !file.is_file() {
        write_atomic(&file, content.as_bytes())?;
    }
    Ok(blob)
}

/// A history rooted at a folder: the app's data folder, or a temporary one in tests.
pub struct History {
    base: PathBuf,
}

impl Default for History {
    fn default() -> Self {
        Self { base: config_dir() }
    }
}

impl History {
    pub fn at(base: &Path) -> Self {
        Self { base: base.to_path_buf() }
    }

    /// Keeps a version of a note. With `gap`, only when the last one kept is
    /// older than that; never twice in a row for the same text. Says whether
    /// it kept one.
    pub fn snapshot(
        &self,
        vault_id: &str,
        path: &str,
        content: &str,
        source: Source,
        gap: Option<Duration>,
    ) -> Result<bool> {
        let dir = dir_in(&self.base, vault_id)?;
        let mut index = load_index(&dir, path);
        let time = now();
        if let (Some(gap), Some(last)) = (gap, index.snapshots.last())
            && time.saturating_sub(last.time) < gap.as_millis() as u64
        {
            return Ok(false);
        }
        let blob = store_blob(&dir, content)?;
        if index.snapshots.last().is_some_and(|s| s.blob == blob) {
            return Ok(false);
        }
        index.snapshots.push(Snapshot { time, blob, source });
        let oldest = time.saturating_sub(MAX_AGE.as_millis() as u64);
        index.snapshots.retain(|s| s.time >= oldest);
        let extra = index.snapshots.len().saturating_sub(MAX_PER_NOTE);
        index.snapshots.drain(..extra);
        save_index(&dir, &index)?;
        Ok(true)
    }

    /// Whether a version would be kept now: the last one is older than `gap`.
    pub fn due(&self, vault_id: &str, path: &str, gap: Duration) -> bool {
        let Ok(dir) = dir_in(&self.base, vault_id) else { return false };
        load_index(&dir, path).snapshots.last().is_none_or(|s| now().saturating_sub(s.time) >= gap.as_millis() as u64)
    }

    /// The versions kept of a note, newest first.
    pub fn list(&self, vault_id: &str, path: &str) -> Result<Vec<Snapshot>> {
        let mut found = load_index(&dir_in(&self.base, vault_id)?, path).snapshots;
        found.reverse();
        Ok(found)
    }

    /// The text of a version.
    pub fn read(&self, vault_id: &str, blob: &str) -> Result<String> {
        if blob.is_empty() || !blob.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err(Error::NotFound(blob.to_string()));
        }
        let file = dir_in(&self.base, vault_id)?.join("blobs").join(blob);
        std::fs::read_to_string(file).map_err(|_| Error::NotFound(format!("version {blob}")))
    }

    /// Follows a note, or the notes of a folder, to a new path.
    pub fn moved(&self, vault_id: &str, from: &str, to: &str) -> Result<()> {
        let dir = dir_in(&self.base, vault_id)?;
        let Ok(entries) = std::fs::read_dir(dir.join("notes")) else { return Ok(()) };
        for entry in entries.flatten() {
            let Some(mut index) =
                std::fs::read_to_string(entry.path()).ok().and_then(|t| serde_json::from_str::<Index>(&t).ok())
            else {
                continue;
            };
            let rest = match index.path.strip_prefix(from) {
                Some("") => "",
                Some(rest) if rest.starts_with('/') => rest,
                _ => continue,
            };
            index.path = format!("{to}{rest}");
            // Whatever the new path had before gives way to what moved there.
            let mut merged = load_index(&dir, &index.path).snapshots;
            merged.append(&mut index.snapshots);
            merged.sort_by_key(|s| s.time);
            index.snapshots = merged;
            save_index(&dir, &index)?;
            let _ = std::fs::remove_file(entry.path());
        }
        Ok(())
    }

    /// Deletes the texts no version or log entry names any more.
    pub fn collect_garbage(&self, vault_id: &str) -> Result<()> {
        let dir = dir_in(&self.base, vault_id)?;
        let mut used: HashSet<String> = self.ai_log(vault_id)?.into_iter().filter_map(|e| e.before).collect();
        if let Ok(entries) = std::fs::read_dir(dir.join("notes")) {
            for entry in entries.flatten() {
                if let Some(index) =
                    std::fs::read_to_string(entry.path()).ok().and_then(|t| serde_json::from_str::<Index>(&t).ok())
                {
                    used.extend(index.snapshots.into_iter().map(|s| s.blob));
                }
            }
        }
        if let Ok(entries) = std::fs::read_dir(dir.join("blobs")) {
            for entry in entries.flatten() {
                if !used.contains(entry.file_name().to_string_lossy().as_ref()) {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        Ok(())
    }

    /// Notes down something the AI did through the MCP server. `before` is the
    /// note's text until then, also kept as a version of the note; `after` is
    /// the version it wrote.
    pub fn record_ai(
        &self,
        vault_id: &str,
        tool: &str,
        path: &str,
        from: Option<&str>,
        before: Option<&str>,
        after: Option<&str>,
    ) -> Result<()> {
        let dir = dir_in(&self.base, vault_id)?;
        let before = match before {
            Some(text) => {
                self.snapshot(vault_id, path, text, Source::BeforeAi, None)?;
                Some(store_blob(&dir, text)?)
            }
            None => None,
        };
        let time = now();
        let entry = AiEntry {
            // Two actions can fall in the same millisecond, so the id cannot come from the time.
            id: uuid::Uuid::new_v4().simple().to_string(),
            time,
            tool: tool.to_string(),
            path: path.to_string(),
            from: from.map(String::from),
            before,
            after: after.map(String::from),
            undone: false,
        };
        self.append_log(&dir, &LogLine::Entry(entry))
    }

    fn append_log(&self, dir: &Path, line: &LogLine) -> Result<()> {
        std::fs::create_dir_all(dir)?;
        let mut file = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("ai.jsonl"))?;
        // One write per line, so lines from two processes never mix.
        file.write_all(format!("{}\n", serde_json::to_string(line)?).as_bytes())?;
        Ok(())
    }

    /// What the AI did in a vault, newest first.
    pub fn ai_log(&self, vault_id: &str) -> Result<Vec<AiEntry>> {
        let dir = dir_in(&self.base, vault_id)?;
        let Ok(text) = std::fs::read_to_string(dir.join("ai.jsonl")) else { return Ok(Vec::new()) };
        let mut entries: Vec<AiEntry> = Vec::new();
        for line in text.lines().filter_map(|l| serde_json::from_str::<LogLine>(l).ok()) {
            match line {
                LogLine::Entry(entry) => entries.push(entry),
                LogLine::Undone { undone } => {
                    if let Some(entry) = entries.iter_mut().find(|e| e.id == undone) {
                        entry.undone = true;
                    }
                }
            }
        }
        entries.reverse();
        entries.truncate(LOG_SHOWN);
        Ok(entries)
    }

    /// Whether the AI left this note at this version, by its log.
    pub fn written_by_ai(&self, vault_id: &str, path: &str, version: &str) -> bool {
        self.ai_log(vault_id).is_ok_and(|log| log.iter().any(|e| e.path == path && e.after.as_deref() == Some(version)))
    }

    /// Takes back one thing the AI did, if the note is still as the AI left it.
    pub fn undo_ai(&self, vault: &VaultFs, vault_id: &str, id: &str) -> Result<()> {
        let log = self.ai_log(vault_id)?;
        let entry = log.iter().find(|e| e.id == id).ok_or_else(|| Error::NotFound(id.to_string()))?;
        if entry.undone {
            return Ok(());
        }
        let untouched = |path: &str| -> Result<()> {
            let current = vault.read(path)?.version;
            if entry.after.as_deref() == Some(current.as_str()) {
                Ok(())
            } else {
                Err(Error::Conflict(path.to_string()))
            }
        };
        match (entry.tool.as_str(), &entry.before) {
            ("move_note", _) => {
                let from = entry.from.as_deref().ok_or_else(|| Error::NotFound(id.to_string()))?;
                links::move_path(vault, &entry.path, from)?;
                self.moved(vault_id, &entry.path, from)?;
            }
            ("delete_note", Some(before)) => {
                vault.write(&entry.path, &self.read(vault_id, before)?, WriteMode::Create)?;
            }
            ("create_note", _) => {
                untouched(&entry.path)?;
                vault.trash(&entry.path)?;
            }
            (_, Some(before)) => {
                untouched(&entry.path)?;
                let current = vault.read(&entry.path)?;
                vault.write(&entry.path, &self.read(vault_id, before)?, WriteMode::Replace(Some(&current.version)))?;
            }
            _ => return Err(Error::Vault("this action cannot be undone".into())),
        }
        self.append_log(&dir_in(&self.base, vault_id)?, &LogLine::Undone { undone: id.to_string() })
    }
}

/// One thing the AI did.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiEntry {
    pub id: String,
    /// Milliseconds since the epoch.
    pub time: u64,
    /// The MCP tool: `update_note`, `move_note`…
    pub tool: String,
    /// The note, where it ended up.
    pub path: String,
    /// Where a moved note was.
    pub from: Option<String>,
    /// Names the note's text before, to read it with.
    pub before: Option<String>,
    /// The version the AI wrote.
    pub after: Option<String>,
    #[serde(default)]
    pub undone: bool,
}

#[derive(Serialize, Deserialize)]
#[serde(untagged)]
enum LogLine {
    Undone { undone: String },
    Entry(AiEntry),
}

#[cfg(test)]
mod tests {
    use super::*;

    fn setup() -> (tempfile::TempDir, History, VaultFs) {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir(d.path().join("vault")).unwrap();
        let history = History::at(&d.path().join("data"));
        let vault = VaultFs::new(d.path().join("vault"));
        (d, history, vault)
    }

    #[test]
    fn keeps_versions_once_each_and_respects_the_gap() {
        let (_d, h, _v) = setup();
        assert!(h.snapshot("v1", "a.md", "uno", Source::Edit, None).unwrap());
        assert!(!h.snapshot("v1", "a.md", "uno", Source::Edit, None).unwrap(), "same text twice");
        assert!(!h.snapshot("v1", "a.md", "dos", Source::Edit, Some(Duration::from_secs(300))).unwrap(), "too soon");
        assert!(!h.due("v1", "a.md", Duration::from_secs(300)));
        assert!(h.due("v1", "b.md", Duration::from_secs(300)));
        assert!(h.snapshot("v1", "a.md", "dos", Source::BeforeAi, None).unwrap());
        let list = h.list("v1", "a.md").unwrap();
        assert_eq!(list.iter().map(|s| s.source).collect::<Vec<_>>(), [Source::BeforeAi, Source::Edit]);
        assert_eq!(h.read("v1", &list[1].blob).unwrap(), "uno");
        assert!(h.list("v1", "otra.md").unwrap().is_empty());
    }

    #[test]
    fn refuses_names_that_could_leave_its_folder() {
        let (_d, h, _v) = setup();
        assert!(h.snapshot("../fuera", "a.md", "x", Source::Edit, None).is_err());
        assert!(h.read("v1", "../../secreto").is_err());
    }

    #[test]
    fn versions_follow_a_note_and_a_folder_that_move() {
        let (_d, h, _v) = setup();
        h.snapshot("v1", "dir/a.md", "uno", Source::Edit, None).unwrap();
        h.snapshot("v1", "dir2/a.md", "otro", Source::Edit, None).unwrap();
        h.moved("v1", "dir", "nuevo").unwrap();
        assert_eq!(h.list("v1", "nuevo/a.md").unwrap().len(), 1);
        assert!(h.list("v1", "dir/a.md").unwrap().is_empty());
        assert_eq!(h.list("v1", "dir2/a.md").unwrap().len(), 1, "a folder with a similar name stays");
        h.moved("v1", "nuevo/a.md", "b.md").unwrap();
        assert_eq!(h.list("v1", "b.md").unwrap().len(), 1);
    }

    #[test]
    fn unused_texts_are_deleted() {
        let (d, h, _v) = setup();
        h.snapshot("v1", "a.md", "uno", Source::Edit, None).unwrap();
        let blobs = d.path().join("data/history/v1/blobs");
        std::fs::write(blobs.join("abcdef"), "huérfano").unwrap();
        h.collect_garbage("v1").unwrap();
        assert_eq!(std::fs::read_dir(&blobs).unwrap().count(), 1);
    }

    #[test]
    fn what_the_ai_did_is_logged_and_can_be_undone() {
        let (_d, h, v) = setup();
        let v0 = v.write("a.md", "antes", WriteMode::Create).unwrap();
        let v1 = v.write("a.md", "de la IA", WriteMode::Replace(Some(&v0))).unwrap();
        h.record_ai("v1", "update_note", "a.md", None, Some("antes"), Some(&v1)).unwrap();
        let created = v.write("nueva.md", "x", WriteMode::Create).unwrap();
        h.record_ai("v1", "create_note", "nueva.md", None, None, Some(&created)).unwrap();
        v.rename("a.md", "b.md").unwrap();
        h.record_ai("v1", "move_note", "b.md", Some("a.md"), None, None).unwrap();

        let log = h.ai_log("v1").unwrap();
        assert_eq!(
            log.iter().map(|e| e.tool.as_str()).collect::<Vec<_>>(),
            ["move_note", "create_note", "update_note"]
        );
        let ids: std::collections::HashSet<&str> = log.iter().map(|e| e.id.as_str()).collect();
        assert_eq!(ids.len(), 3, "each action has its own id, even in the same millisecond");
        assert!(h.written_by_ai("v1", "a.md", &v1));
        assert!(!h.written_by_ai("v1", "a.md", &v0));
        // The text before is also a version of the note.
        assert_eq!(h.list("v1", "a.md").unwrap()[0].source, Source::BeforeAi);

        h.undo_ai(&v, "v1", &log[0].id).unwrap();
        assert_eq!(v.read("a.md").unwrap().content, "de la IA");
        h.undo_ai(&v, "v1", &log[2].id).unwrap();
        assert_eq!(v.read("a.md").unwrap().content, "antes");
        h.undo_ai(&v, "v1", &log[1].id).unwrap();
        assert!(v.read("nueva.md").is_err());
        assert!(h.ai_log("v1").unwrap().iter().all(|e| e.undone));
    }

    #[test]
    fn a_note_edited_since_is_not_overwritten_by_undo() {
        let (_d, h, v) = setup();
        let v0 = v.write("a.md", "antes", WriteMode::Create).unwrap();
        let v1 = v.write("a.md", "de la IA", WriteMode::Replace(Some(&v0))).unwrap();
        h.record_ai("v1", "update_note", "a.md", None, Some("antes"), Some(&v1)).unwrap();
        v.write("a.md", "y luego yo", WriteMode::Replace(Some(&v1))).unwrap();
        let id = h.ai_log("v1").unwrap()[0].id.clone();
        assert!(matches!(h.undo_ai(&v, "v1", &id), Err(Error::Conflict(_))));
        assert_eq!(v.read("a.md").unwrap().content, "y luego yo");
    }

    #[test]
    fn a_deleted_note_comes_back() {
        let (_d, h, v) = setup();
        v.write("a.md", "texto", WriteMode::Create).unwrap();
        std::fs::remove_file(v.root().join("a.md")).unwrap();
        h.record_ai("v1", "delete_note", "a.md", None, Some("texto"), None).unwrap();
        let id = h.ai_log("v1").unwrap()[0].id.clone();
        h.undo_ai(&v, "v1", &id).unwrap();
        assert_eq!(v.read("a.md").unwrap().content, "texto");
    }
}
