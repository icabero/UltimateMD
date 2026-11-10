//! A plain text file with what went wrong, so that a failure that showed for
//! a few seconds can still be read, and sent along with a report. It holds
//! messages and paths, never the text of a note.

use std::fs::OpenOptions;
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;
use tauri_plugin_opener::OpenerExt;
use ultimatemd_core::registry::config_dir;
use ultimatemd_core::{Error, Result};

/// Past this size the file starts again, keeping the one before.
const MAX_BYTES: u64 = 512 * 1024;
/// What the settings show and copy: the end of the file.
const SHOWN_LINES: usize = 200;
/// One message can be this long; a stack trace beyond it says little more.
const MAX_MESSAGE: usize = 4000;

static WRITING: Mutex<()> = Mutex::new(());

pub fn file() -> PathBuf {
    config_dir().join("ultimatemd.log")
}

/// Days since the epoch to a calendar date, in UTC.
fn date(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let (day, month) = (doy - (153 * mp + 2) / 5 + 1, if mp < 10 { mp + 3 } else { mp - 9 });
    (yoe + era * 400 + u64::from(month <= 2), month, day)
}

fn stamp(seconds: u64) -> String {
    let (year, month, day) = date(seconds / 86_400);
    let rest = seconds % 86_400;
    format!("{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}Z", rest / 3600, rest % 3600 / 60, rest % 60)
}

fn line(seconds: u64, level: &str, source: &str, message: &str) -> String {
    let message: String = message.chars().take(MAX_MESSAGE).collect();
    // Further lines of a message are indented, so each entry starts with its time.
    format!("{} [{level}] {source}: {}\n", stamp(seconds), message.trim_end().replace('\n', "\n    "))
}

/// Adds a line. Never fails: a log that cannot be written must not break anything else.
pub fn write(level: &str, source: &str, message: &str) {
    let _guard = WRITING.lock().unwrap_or_else(|e| e.into_inner());
    let path = file();
    if let Some(dir) = path.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    if std::fs::metadata(&path).is_ok_and(|m| m.len() > MAX_BYTES) {
        let _ = std::fs::rename(&path, path.with_extension("old.log"));
    }
    let seconds = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_secs());
    if let Ok(mut out) = OpenOptions::new().create(true).append(true).open(&path) {
        let _ = out.write_all(line(seconds, level, source, message).as_bytes());
    }
}

pub fn error(source: &str, message: &str) {
    write("error", source, message);
}

/// Notes the start of a run, and from then on any panic.
pub fn start() {
    write(
        "info",
        "app",
        &format!("UltimateMD {} on {} {}", env!("CARGO_PKG_VERSION"), std::env::consts::OS, std::env::consts::ARCH),
    );
    let before = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        error("panic", &info.to_string());
        before(info);
    }));
}

/// An error the interface showed, or one it caught without showing.
#[tauri::command]
pub fn log_error(source: String, message: String) {
    error(&source, &message);
}

/// The end of the log, for the settings.
#[tauri::command(async)]
pub fn read_log() -> String {
    let text = std::fs::read_to_string(file()).unwrap_or_default();
    let lines: Vec<&str> = text.lines().collect();
    lines[lines.len().saturating_sub(SHOWN_LINES)..].join("\n")
}

/// Shows the log file in the system's file manager.
#[tauri::command(async)]
pub fn reveal_log(app: AppHandle) -> Result<()> {
    let path = file();
    if !path.is_file() {
        write("info", "app", "log opened");
    }
    app.opener().reveal_item_in_dir(path).map_err(|e| Error::Vault(e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn times_are_written_in_utc() {
        assert_eq!(stamp(0), "1970-01-01T00:00:00Z");
        assert_eq!(stamp(951_782_400), "2000-02-29T00:00:00Z");
        assert_eq!(stamp(1_794_300_000), "2026-11-10T08:40:00Z");
    }

    #[test]
    fn a_long_message_keeps_its_entry_readable() {
        let text = line(0, "error", "ui", "falla\n  at algo\n");
        assert_eq!(text, "1970-01-01T00:00:00Z [error] ui: falla\n      at algo\n");
        assert!(line(0, "error", "ui", &"x".repeat(10_000)).len() < MAX_MESSAGE + 100);
    }
}
