//! Core of UltimateMD: vault registry, safe file access, search and links.
//!
//! Both the desktop app and the MCP server are thin layers over this crate, so
//! they share one set of rules about what can be read or written.

pub mod aliases;
pub mod callouts;
pub mod daily_notes;
pub mod diagram_guide;
pub mod docx;
pub mod error;
pub mod export_links;
pub mod files;
pub mod folder_looks;
pub mod git;
pub mod history;
pub mod links;
pub mod marks;
pub mod math;
pub mod note_templates;
pub mod paths;
pub mod registry;
pub mod replace;
pub mod search;
pub mod sections;
pub mod svg;
pub mod tags;
pub mod templates;
pub mod tree_order;
pub mod vault_themes;
pub mod word_settings;

pub use error::{Error, Result};
pub use files::{Listing, Note, NoteStamp, TreeNode, Vault as VaultFs, WriteMode};
pub use registry::{McpAccess, Registry, Vault};
pub use search::SearchHit;
