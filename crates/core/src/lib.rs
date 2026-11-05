//! Core of UltimateMD: vault registry, safe file access, search and links.
//!
//! Both the desktop app and the MCP server are thin layers over this crate, so
//! they share one set of rules about what can be read or written.

pub mod docx;
pub mod error;
pub mod files;
pub mod links;
pub mod paths;
pub mod registry;
pub mod search;
pub mod templates;
pub mod vault_themes;
pub mod word_settings;

pub use error::{Error, Result};
pub use files::{Note, TreeNode, Vault as VaultFs, WriteMode};
pub use registry::{McpAccess, Registry, Vault};
pub use search::SearchHit;
