//! Core of UltimateMD: vault registry, safe file access, search and links.
//!
//! Both the desktop app and the MCP server are thin layers over this crate, so
//! they share one set of rules about what can be read or written.

pub mod callouts;
pub mod docx;
pub mod error;
pub mod files;
pub mod links;
pub mod note_templates;
pub mod paths;
pub mod registry;
pub mod replace;
pub mod search;
pub mod sections;
pub mod tags;
pub mod templates;
pub mod vault_themes;
pub mod word_settings;

pub use error::{Error, Result};
pub use files::{Note, NoteStamp, TreeNode, Vault as VaultFs, WriteMode};
pub use registry::{McpAccess, Registry, Vault};
pub use search::SearchHit;
