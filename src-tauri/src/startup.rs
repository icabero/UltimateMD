//! Files the operating system asks us to open, at startup or later on.

use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager};

/// Holds files until the frontend is ready to receive them.
pub struct Pending(Mutex<(bool, Vec<PathBuf>)>);

impl Pending {
    pub fn from_args() -> Self {
        let cwd = std::env::current_dir().unwrap_or_default();
        Self(Mutex::new((false, files_in_args(std::env::args().skip(1), &cwd))))
    }

    /// Hands the queue over. From now on, files are sent to the frontend as events.
    pub fn take(&self) -> Vec<PathBuf> {
        let mut state = self.0.lock().unwrap_or_else(|e| e.into_inner());
        state.0 = true;
        std::mem::take(&mut state.1)
    }
}

pub fn files_in_args(args: impl Iterator<Item = String>, cwd: &Path) -> Vec<PathBuf> {
    args.filter(|a| !a.starts_with('-')).map(|a| cwd.join(a)).collect()
}

pub fn deliver(app: &AppHandle, files: Vec<PathBuf>) {
    if files.is_empty() {
        return;
    }
    let state = app.state::<Pending>();
    let mut guard = state.0.lock().unwrap_or_else(|e| e.into_inner());
    if guard.0 {
        drop(guard);
        let _ = app.emit("open-files", files);
    } else {
        guard.1.extend(files);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_relative_paths_and_skips_flags() {
        let args = ["--flag", "nota con espacios.md", "/abs/a.md"].map(String::from).into_iter();
        let files = files_in_args(args, Path::new("/home/x"));
        assert_eq!(files[0], Path::new("/home/x/nota con espacios.md"));
        assert_eq!(files.len(), 2);
    }
}
