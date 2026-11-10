//! MCP server for UltimateMD, spoken over stdio. It works on the same files as
//! the app and does not need it running; an open app picks changes up live.
//!
//! This is a separate binary because a Windows GUI executable has no usable
//! stdin/stdout, so the app itself cannot act as a stdio server.

use rmcp::{
    ErrorData, ServerHandler, ServiceExt,
    handler::server::{router::tool::ToolRouter, wrapper::Parameters},
    model::{CallToolResult, ContentBlock, Implementation, ServerCapabilities, ServerConfig},
    schemars::{self, JsonSchema},
    tool, tool_handler, tool_router,
    transport::stdio,
};
use serde::Deserialize;
use serde_json::{Value, json};
use ultimatemd_core::{Error, McpAccess, Registry, VaultFs, WriteMode, links, paths, search, sections, tags};

const INSTRUCTIONS: &str = "UltimateMD exposes the user's vaults: folders of Markdown and HTML notes. \
Call list_vaults first. Paths are relative to the vault and use '/'. \
Link notes with [[wikilinks]]. For diagrams use fenced code blocks with the language 'mermaid' \
(flowcharts, sequence, gantt...) or 'd2' (architecture and polished diagrams); the app renders both. \
Before overwriting a note, read it and pass its version to update_note so that edits made by the user are not lost. \
To change part of a long note, call get_outline and then read_section or insert_at_heading instead of rewriting it whole.";

const DEFAULT_LIMIT: usize = 50;

#[derive(Deserialize, JsonSchema)]
struct VaultArg {
    /// Vault name or id, from list_vaults
    vault: String,
}

#[derive(Deserialize, JsonSchema)]
struct NoteArg {
    /// Vault name or id, from list_vaults
    vault: String,
    /// Note path relative to the vault, for example 'projects/ideas.md'
    path: String,
}

#[derive(Deserialize, JsonSchema)]
struct SearchArg {
    /// Vault name or id. Omit it to search every vault
    vault: Option<String>,
    /// Words to find, in any order and ignoring case. Supports "phrases", -exclusions, path:, tag:, type: and /regex/
    query: String,
    /// Maximum results per vault (default 50)
    limit: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
struct WriteArg {
    /// Vault name or id, from list_vaults
    vault: String,
    /// Note path relative to the vault. '.md' is added if it has no note extension
    path: String,
    /// Full text of the note
    content: String,
}

#[derive(Deserialize, JsonSchema)]
struct UpdateArg {
    /// Vault name or id, from list_vaults
    vault: String,
    /// Note path relative to the vault
    path: String,
    /// New full text of the note
    content: String,
    /// Version from read_note. The update fails if the note changed since then
    expected_version: Option<String>,
}

#[derive(Deserialize, JsonSchema)]
struct AppendArg {
    /// Vault name or id, from list_vaults
    vault: String,
    /// Note path relative to the vault
    path: String,
    /// Text to add at the end of the note
    content: String,
}

#[derive(Deserialize, JsonSchema)]
struct MoveArg {
    /// Vault name or id, from list_vaults
    vault: String,
    /// Current note path
    from: String,
    /// New note path. It must not exist
    to: String,
    /// Rewrite the links that would break. Defaults to true
    update_links: Option<bool>,
}

#[derive(Deserialize, JsonSchema)]
struct SectionArg {
    /// Vault name or id, from list_vaults
    vault: String,
    /// Note path relative to the vault
    path: String,
    /// Heading text, without the #. Case and accents do not matter
    heading: String,
    /// Line of the heading, from get_outline, when its text appears more than once
    heading_line: Option<usize>,
}

#[derive(Deserialize, JsonSchema)]
#[serde(rename_all = "lowercase")]
enum Where {
    /// Right under the heading
    Start,
    /// At the end of the section, before the next heading of its level
    End,
    /// Instead of the section's text; the heading stays
    Replace,
}

#[derive(Deserialize, JsonSchema)]
struct InsertArg {
    /// Vault name or id, from list_vaults
    vault: String,
    /// Note path relative to the vault
    path: String,
    /// Heading text, without the #. Case and accents do not matter
    heading: String,
    /// Line of the heading, from get_outline, when its text appears more than once
    heading_line: Option<usize>,
    /// Markdown to put in the section
    content: String,
    /// Where in the section: start, end (default) or replace
    position: Option<Where>,
    /// Version from read_note or get_outline. The edit fails if the note changed since then
    expected_version: Option<String>,
}

/// Loads a vault, enforcing the access level the user set for it. Vaults with
/// MCP off are reported as unknown so their existence is not revealed.
fn open(key: &str, need_write: bool) -> ultimatemd_core::Result<VaultFs> {
    let registry = Registry::load()?;
    let vault = registry.find(key)?;
    match (vault.mcp, need_write) {
        (McpAccess::Off, _) => Err(Error::UnknownVault(key.to_string())),
        (McpAccess::Read, true) => Err(Error::AccessDenied(vault.name.clone())),
        _ => Ok(VaultFs::new(&vault.path)),
    }
}

/// Refuses non-note files, so images and other files stay out of reach.
fn note_path(path: &str) -> ultimatemd_core::Result<String> {
    let path = paths::normalize(path)?;
    if paths::is_note(&path) { Ok(path) } else { Err(Error::PathNotAllowed(format!("{path} is not a note"))) }
}

fn with_extension(path: &str) -> String {
    if paths::is_note(path) { path.to_string() } else { format!("{path}.md") }
}

/// Failures go back as tool errors, which the model can read and act on.
fn reply(result: ultimatemd_core::Result<Value>) -> Result<CallToolResult, ErrorData> {
    Ok(match result {
        Ok(value) => CallToolResult::success(vec![ContentBlock::text(value.to_string())]),
        Err(e) => CallToolResult::error(vec![ContentBlock::text(e.to_string())]),
    })
}

#[derive(Clone)]
struct Server {
    #[expect(dead_code, reason = "read by the tool_handler macro")]
    tool_router: ToolRouter<Self>,
}

#[tool_router]
impl Server {
    fn new() -> Self {
        Self { tool_router: Self::tool_router() }
    }

    #[tool(
        description = "List the vaults this client can use, with their access level.",
        annotations(read_only_hint = true)
    )]
    async fn list_vaults(&self) -> Result<CallToolResult, ErrorData> {
        reply(Registry::load().map(|r| {
            let vaults: Vec<Value> = r
                .vaults
                .iter()
                .filter(|v| v.mcp != McpAccess::Off)
                .map(|v| json!({ "name": v.name, "id": v.id, "access": v.mcp }))
                .collect();
            json!({ "vaults": vaults })
        }))
    }

    #[tool(description = "List all notes in a vault.", annotations(read_only_hint = true))]
    async fn list_notes(&self, Parameters(a): Parameters<VaultArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| Ok(json!({ "notes": open(&a.vault, false)?.notes()? })))())
    }

    #[tool(description = "Read a note. Returns its content and its version.", annotations(read_only_hint = true))]
    async fn read_note(&self, Parameters(a): Parameters<NoteArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let path = note_path(&a.path)?;
            Ok(serde_json::to_value(open(&a.vault, false)?.read(&path)?)?)
        })())
    }

    #[tool(
        description = "Search note names and contents, ignoring case and accents. Returns matching lines, best notes first; line 0 means the file name matched. Words may be in any order. Also: \"exact phrase\", -word to leave out notes containing it, path:folder, tag:name (also nested tags), type:md or type:html, and /regular expression/. Filters alone list the notes that pass them.",
        annotations(read_only_hint = true)
    )]
    async fn search_notes(&self, Parameters(a): Parameters<SearchArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let limit = a.limit.unwrap_or(DEFAULT_LIMIT);
            let names: Vec<String> = match a.vault {
                Some(v) => vec![v],
                None => Registry::load()?
                    .vaults
                    .iter()
                    .filter(|v| v.mcp != McpAccess::Off)
                    .map(|v| v.name.clone())
                    .collect(),
            };
            let mut results = Vec::new();
            for name in names {
                let hits = search::search(&open(&name, false)?, &a.query, limit)?;
                results.extend(hits.into_iter().map(|h| (name.clone(), h)));
            }
            // Best notes first across vaults. Stable, so each note's lines stay together.
            results.sort_by_key(|(_, h)| std::cmp::Reverse(h.score));
            results.truncate(limit);
            let results: Vec<_> =
                results.into_iter().map(|(vault, hit)| json!({ "vault": vault, "hit": hit })).collect();
            Ok(json!({ "results": results }))
        })())
    }

    #[tool(
        description = "Get the notes a note links to, its broken links, and the notes linking to it.",
        annotations(read_only_hint = true)
    )]
    async fn get_backlinks(&self, Parameters(a): Parameters<NoteArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let path = note_path(&a.path)?;
            Ok(serde_json::to_value(links::info(&open(&a.vault, false)?, &path)?)?)
        })())
    }

    #[tool(
        description = "Get the headings of a note with their level and the lines each section spans, plus the note's version. Use it before read_section or insert_at_heading, instead of reading a long note whole.",
        annotations(read_only_hint = true)
    )]
    async fn get_outline(&self, Parameters(a): Parameters<NoteArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let path = note_path(&a.path)?;
            let note = open(&a.vault, false)?.read(&path)?;
            let lines = note.content.lines().count();
            Ok(json!({ "headings": sections::outline(&note.content), "lines": lines, "version": note.version }))
        })())
    }

    #[tool(
        description = "Read one section of a note: its heading and everything under it, down to the next heading of the same level.",
        annotations(read_only_hint = true)
    )]
    async fn read_section(&self, Parameters(a): Parameters<SectionArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let path = note_path(&a.path)?;
            let note = open(&a.vault, false)?.read(&path)?;
            let headings = sections::outline(&note.content);
            let heading = sections::find(&headings, &a.heading, a.heading_line)?;
            Ok(
                json!({ "heading": heading, "content": sections::section_text(&note.content, heading), "version": note.version }),
            )
        })())
    }

    #[tool(
        description = "Write into one section of a note without rewriting the rest: at its start, at its end (default), or replacing its text while keeping the heading. Needs write access.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn insert_at_heading(&self, Parameters(a): Parameters<InsertArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let path = note_path(&a.path)?;
            let vault = open(&a.vault, true)?;
            let note = vault.read(&path)?;
            if a.expected_version.as_ref().is_some_and(|v| *v != note.version) {
                return Err(Error::Conflict(path));
            }
            let headings = sections::outline(&note.content);
            let heading = sections::find(&headings, &a.heading, a.heading_line)?;
            let place = match a.position {
                Some(Where::Start) => sections::Place::Start,
                Some(Where::Replace) => sections::Place::Replace,
                Some(Where::End) | None => sections::Place::End,
            };
            let text = sections::insert(&note.content, heading, place, &a.content);
            let version = vault.write(&path, &text, WriteMode::Replace(Some(&note.version)))?;
            Ok(json!({ "path": path, "version": version }))
        })())
    }

    #[tool(
        description = "List the tags of a vault (#tag in the text and tags: in the properties) with how many notes have each, most used first. Find the notes of a tag with search_notes and tag:name.",
        annotations(read_only_hint = true)
    )]
    async fn list_tags(&self, Parameters(a): Parameters<VaultArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| Ok(json!({ "tags": tags::vault_tags(&open(&a.vault, false)?)? })))())
    }

    #[tool(
        description = "Create a new note. Folders are created as needed. Fails if the note exists. Needs write access.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn create_note(&self, Parameters(a): Parameters<WriteArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let path = note_path(&with_extension(&a.path))?;
            let version = open(&a.vault, true)?.write(&path, &a.content, WriteMode::Create)?;
            Ok(json!({ "path": path, "version": version }))
        })())
    }

    #[tool(
        description = "Replace the full text of a note. Pass expected_version from read_note to avoid losing changes. Needs write access.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn update_note(&self, Parameters(a): Parameters<UpdateArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let path = note_path(&a.path)?;
            let mode = WriteMode::Replace(a.expected_version.as_deref());
            let version = open(&a.vault, true)?.write(&path, &a.content, mode)?;
            Ok(json!({ "path": path, "version": version }))
        })())
    }

    #[tool(
        description = "Add text at the end of a note. Needs write access.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn append_note(&self, Parameters(a): Parameters<AppendArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let path = note_path(&a.path)?;
            let vault = open(&a.vault, true)?;
            let note = vault.read(&path)?;
            let separator = if note.content.is_empty() || note.content.ends_with('\n') { "" } else { "\n" };
            let text = format!("{}{separator}{}", note.content, a.content);
            let version = vault.write(&path, &text, WriteMode::Replace(Some(&note.version)))?;
            Ok(json!({ "path": path, "version": version }))
        })())
    }

    #[tool(
        description = "Move or rename a note. Never overwrites. By default rewrites the links that would break, in other notes and in the note itself, and reports how many. Needs write access.",
        annotations(read_only_hint = false, destructive_hint = false)
    )]
    async fn move_note(&self, Parameters(a): Parameters<MoveArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let (from, to) = (note_path(&a.from)?, note_path(&with_extension(&a.to))?);
            let vault = open(&a.vault, true)?;
            if a.update_links == Some(false) {
                vault.rename(&from, &to)?;
                return Ok(json!({ "path": to }));
            }
            let update = links::move_path(&vault, &from, &to)?;
            Ok(json!({ "path": to, "linksUpdated": update.links, "notesUpdated": update.notes }))
        })())
    }

    #[tool(
        description = "Send a note to the system trash, where the user can restore it. Needs write access.",
        annotations(read_only_hint = false, destructive_hint = true)
    )]
    async fn delete_note(&self, Parameters(a): Parameters<NoteArg>) -> Result<CallToolResult, ErrorData> {
        reply((|| {
            let path = note_path(&a.path)?;
            open(&a.vault, true)?.trash(&path)?;
            Ok(json!({ "trashed": path }))
        })())
    }
}

#[tool_handler]
impl ServerHandler for Server {
    fn get_info(&self) -> ServerConfig {
        ServerConfig::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("ultimatemd", env!("CARGO_PKG_VERSION")))
            .with_instructions(INSTRUCTIONS)
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    if std::env::args().any(|a| a == "--version") {
        println!("ultimatemd-mcp {}", env!("CARGO_PKG_VERSION"));
        return Ok(());
    }
    Server::new().serve(stdio()).await?.waiting().await?;
    Ok(())
}
