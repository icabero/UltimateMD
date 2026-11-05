use serde::{Serialize, Serializer};

pub type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, thiserror::Error)]
pub enum Error {
    #[error("path is not allowed: {0}")]
    PathNotAllowed(String),
    #[error("invalid name: {0}")]
    InvalidName(String),
    #[error("not found: {0}")]
    NotFound(String),
    #[error("already exists: {0}")]
    AlreadyExists(String),
    #[error("the file changed since it was read: {0}")]
    Conflict(String),
    #[error("not a UTF-8 text file: {0}")]
    NotText(String),
    #[error("unknown vault: {0}")]
    UnknownVault(String),
    #[error("{0}")]
    Vault(String),
    #[error("MCP access to vault '{0}' does not allow this operation")]
    AccessDenied(String),
    #[error("could not move to trash: {0}")]
    Trash(String),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error(transparent)]
    Json(#[from] serde_json::Error),
}

// Tauri sends command errors to the frontend through serde.
impl Serialize for Error {
    fn serialize<S: Serializer>(&self, s: S) -> std::result::Result<S::Ok, S::Error> {
        s.serialize_str(&self.to_string())
    }
}
