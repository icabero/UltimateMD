//! Drives the real binary over stdio, the way an MCP client does.

use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};
use ultimatemd_core::{McpAccess, Registry};

struct Client {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
    id: u64,
}

impl Client {
    fn start(config: &Path) -> Self {
        let mut child = Command::new(env!("CARGO_BIN_EXE_ultimatemd-mcp"))
            .env("ULTIMATEMD_CONFIG_DIR", config)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap();
        let stdin = child.stdin.take().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        let mut c = Self { child, stdin, stdout, id: 0 };
        let init = c.request(
            "initialize",
            json!({
                "protocolVersion": "2025-06-18",
                "capabilities": {},
                "clientInfo": { "name": "test", "version": "1" }
            }),
        );
        assert_eq!(init["serverInfo"]["name"], "ultimatemd");
        assert!(init["instructions"].as_str().unwrap().contains("mermaid"));
        c.send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        c
    }

    fn send(&mut self, message: Value) {
        writeln!(self.stdin, "{message}").unwrap();
        self.stdin.flush().unwrap();
    }

    fn request(&mut self, method: &str, params: Value) -> Value {
        self.id += 1;
        let id = self.id;
        self.send(json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params }));
        loop {
            let mut line = String::new();
            assert!(self.stdout.read_line(&mut line).unwrap() > 0, "server closed");
            let v: Value = serde_json::from_str(&line).expect("stdout must only carry JSON-RPC");
            if v["id"] == id {
                return v["result"].clone();
            }
        }
    }

    /// Returns (is_error, text).
    fn call(&mut self, tool: &str, args: Value) -> (bool, String) {
        let r = self.request("tools/call", json!({ "name": tool, "arguments": args }));
        let text = r["content"][0]["text"].as_str().unwrap().to_string();
        (r["isError"] == true, text)
    }

    fn ok(&mut self, tool: &str, args: Value) -> Value {
        let (err, text) = self.call(tool, args);
        assert!(!err, "{tool}: {text}");
        serde_json::from_str(&text).unwrap()
    }
}

impl Drop for Client {
    fn drop(&mut self) {
        let _ = self.child.kill();
    }
}

fn setup() -> (tempfile::TempDir, Client) {
    let d = tempfile::tempdir().unwrap();
    let mut r = Registry::default();
    for (name, access) in [("rw", McpAccess::Write), ("ro", McpAccess::Read), ("off", McpAccess::Off)] {
        let id = r.create(d.path(), name).unwrap().id;
        r.find_mut(&id).unwrap().mcp = access;
        std::fs::write(d.path().join(name).join("base.md"), "hola [[otra]]\n").unwrap();
    }
    r.save_to(&d.path().join("cfg/vaults.json")).unwrap();
    let c = Client::start(&d.path().join("cfg"));
    (d, c)
}

#[test]
fn lists_every_tool_with_a_schema() {
    let (_d, mut c) = setup();
    let tools = c.request("tools/list", json!({}));
    let names: Vec<&str> = tools["tools"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect();
    for name in [
        "list_vaults",
        "list_notes",
        "read_note",
        "search_notes",
        "get_backlinks",
        "create_note",
        "update_note",
        "append_note",
        "move_note",
        "delete_note",
        "get_outline",
        "read_section",
        "insert_at_heading",
        "list_tags",
        "get_diagram_guide",
        "add_diagram_image",
    ] {
        assert!(names.contains(&name), "{name} missing from {names:?}");
    }
    let read = tools["tools"].as_array().unwrap().iter().find(|t| t["name"] == "read_note").unwrap();
    assert_eq!(read["annotations"]["readOnlyHint"], true);
    assert!(read["inputSchema"]["properties"]["path"].is_object());
}

#[test]
fn full_note_lifecycle() {
    let (d, mut c) = setup();
    let created = c.ok("create_note", json!({ "vault": "rw", "path": "dir/nueva", "content": "uno" }));
    assert_eq!(created["path"], "dir/nueva.md");
    assert!(d.path().join("rw/dir/nueva.md").is_file());

    let note = c.ok("read_note", json!({ "vault": "RW", "path": "dir/nueva.md" }));
    c.ok("append_note", json!({ "vault": "rw", "path": "dir/nueva.md", "content": "dos" }));
    assert_eq!(std::fs::read_to_string(d.path().join("rw/dir/nueva.md")).unwrap(), "uno\ndos");

    let (err, text) = c.call(
        "update_note",
        json!({
            "vault": "rw", "path": "dir/nueva.md", "content": "x", "expected_version": note["version"]
        }),
    );
    assert!(err && text.contains("changed"), "{text}");

    c.ok("move_note", json!({ "vault": "rw", "from": "dir/nueva.md", "to": "otra.md" }));
    let links = c.ok("get_backlinks", json!({ "vault": "rw", "path": "otra.md" }));
    assert_eq!(links["backlinks"], json!(["base.md"]));

    let found = c.ok("search_notes", json!({ "query": "hola" }));
    let vaults: Vec<&str> = found["results"].as_array().unwrap().iter().map(|r| r["vault"].as_str().unwrap()).collect();
    assert_eq!(vaults, ["rw", "ro"], "search must skip vaults with MCP off");
}

#[test]
fn enforces_access_levels() {
    let (d, mut c) = setup();
    let vaults = c.ok("list_vaults", json!({}));
    assert_eq!(vaults["vaults"].as_array().unwrap().len(), 2, "off vault must be hidden");

    c.ok("read_note", json!({ "vault": "ro", "path": "base.md" }));
    for (tool, args) in [
        ("create_note", json!({ "vault": "ro", "path": "n.md", "content": "x" })),
        ("update_note", json!({ "vault": "ro", "path": "base.md", "content": "x" })),
        ("append_note", json!({ "vault": "ro", "path": "base.md", "content": "x" })),
        ("move_note", json!({ "vault": "ro", "from": "base.md", "to": "b.md" })),
        ("delete_note", json!({ "vault": "ro", "path": "base.md" })),
    ] {
        let (err, text) = c.call(tool, args);
        assert!(err && text.contains("does not allow"), "{tool}: {text}");
    }
    assert_eq!(std::fs::read_to_string(d.path().join("ro/base.md")).unwrap(), "hola [[otra]]\n");

    let (err, text) = c.call("read_note", json!({ "vault": "off", "path": "base.md" }));
    assert!(err && text.contains("unknown vault"), "{text}");
}

#[test]
fn permission_changes_apply_without_restart() {
    let (d, mut c) = setup();
    let cfg = d.path().join("cfg/vaults.json");
    assert!(c.call("create_note", json!({ "vault": "ro", "path": "a.md", "content": "" })).0);
    let mut r = Registry::load_from(&cfg).unwrap();
    let id = r.find("ro").unwrap().id.clone();
    r.find_mut(&id).unwrap().mcp = McpAccess::Write;
    r.save_to(&cfg).unwrap();
    c.ok("create_note", json!({ "vault": "ro", "path": "a.md", "content": "" }));
}

#[test]
fn stays_inside_the_vault_and_on_notes() {
    let (d, mut c) = setup();
    std::fs::write(d.path().join("secret.md"), "x").unwrap();
    std::fs::write(d.path().join("rw/.env"), "TOKEN=1").unwrap();
    std::fs::write(d.path().join("rw/data.json"), "{}").unwrap();
    for path in ["../secret.md", "..\\secret.md", "/etc/passwd", ".env", "data.json"] {
        let (err, text) = c.call("read_note", json!({ "vault": "rw", "path": path }));
        assert!(err && text.contains("not allowed") || text.contains("not a note"), "{path}: {text}");
    }
    let (err, _) = c.call("create_note", json!({ "vault": "rw", "path": "../fuera.md", "content": "" }));
    assert!(err);
    assert!(!d.path().join("fuera.md").exists());
}

#[test]
fn html_notes_are_supported() {
    let (d, mut c) = setup();
    c.ok("create_note", json!({ "vault": "rw", "path": "p.html", "content": "<h1>x</h1>" }));
    assert!(d.path().join("rw/p.html").is_file());
    let notes = c.ok("list_notes", json!({ "vault": "rw" }));
    assert!(notes["notes"].as_array().unwrap().contains(&json!("p.html")));
}

#[test]
fn sections_are_read_and_written_without_touching_the_rest() {
    let (d, mut c) = setup();
    let file = d.path().join("rw/plan.md");
    std::fs::write(&file, "# Plan\nintro #proyecto\n## Fechas\nmarzo\n## Coste\n100\n").unwrap();

    let outline = c.ok("get_outline", json!({ "vault": "rw", "path": "plan.md" }));
    let texts: Vec<&str> =
        outline["headings"].as_array().unwrap().iter().map(|h| h["text"].as_str().unwrap()).collect();
    assert_eq!(texts, ["Plan", "Fechas", "Coste"]);
    assert_eq!(outline["headings"][1]["endLine"], 4);

    let section = c.ok("read_section", json!({ "vault": "rw", "path": "plan.md", "heading": "fechas" }));
    assert_eq!(section["content"], "## Fechas\nmarzo");

    c.ok("insert_at_heading", json!({ "vault": "rw", "path": "plan.md", "heading": "Fechas", "content": "abril" }));
    c.ok(
        "insert_at_heading",
        json!({ "vault": "rw", "path": "plan.md", "heading": "Coste", "content": "200", "position": "replace" }),
    );
    assert_eq!(
        std::fs::read_to_string(&file).unwrap(),
        "# Plan\nintro #proyecto\n## Fechas\nmarzo\nabril\n## Coste\n200\n"
    );

    let (err, text) =
        c.call("insert_at_heading", json!({ "vault": "ro", "path": "base.md", "heading": "x", "content": "y" }));
    assert!(err, "{text}");
    let (err, text) = c.call(
        "insert_at_heading",
        json!({ "vault": "rw", "path": "plan.md", "heading": "Plan", "content": "z", "expected_version": outline["version"] }),
    );
    assert!(err && text.contains("changed"), "{text}");

    let tags = c.ok("list_tags", json!({ "vault": "rw" }));
    assert_eq!(tags["tags"], json!([{ "tag": "proyecto", "notes": 1 }]));
}

#[test]
fn what_it_writes_is_logged_for_the_user_to_see_and_undo() {
    let (d, mut c) = setup();
    c.ok("append_note", json!({ "vault": "rw", "path": "base.md", "content": "añadido" }));
    c.ok("create_note", json!({ "vault": "rw", "path": "nueva", "content": "x" }));
    c.ok("read_note", json!({ "vault": "rw", "path": "base.md" }));

    let registry = Registry::load_from(&d.path().join("cfg/vaults.json")).unwrap();
    let id = registry.find("rw").unwrap().id.clone();
    let history = ultimatemd_core::history::History::at(&d.path().join("cfg"));
    let log = history.ai_log(&id).unwrap();
    let tools: Vec<&str> = log.iter().map(|e| e.tool.as_str()).collect();
    assert_eq!(tools, ["create_note", "append_note"], "reading is not logged");

    let vault = ultimatemd_core::VaultFs::new(d.path().join("rw"));
    history.undo_ai(&vault, &id, &log[1].id).unwrap();
    assert_eq!(std::fs::read_to_string(d.path().join("rw/base.md")).unwrap(), "hola [[otra]]\n");
}

#[test]
fn diagrams_follow_the_vault_guide_and_arrive_as_clean_images() {
    let (d, mut c) = setup();
    let empty = c.ok("get_diagram_guide", json!({ "vault": "ro" }));
    assert_eq!(empty["vault"], Value::Null);
    ultimatemd_core::diagram_guide::save(&d.path().join("rw"), "Paleta azul, cajas redondeadas.").unwrap();
    std::fs::write(
        d.path().join("rw/plan.md"),
        "---
diagramas: Sin sombras
---
# Plan

## Flujo

Texto.

## Fin
",
    )
    .unwrap();
    let guide = c.ok("get_diagram_guide", json!({ "vault": "rw", "path": "plan.md" }));
    assert_eq!(guide["vault"], "Paleta azul, cajas redondeadas.");
    assert_eq!(guide["note"], "Sin sombras");

    let svg = r#"<svg viewBox="0 0 2 2" onload="x()"><script>x()</script><rect width="2" height="2"/></svg>"#;
    let added = c.ok(
        "add_diagram_image",
        json!({ "vault": "rw", "path": "plan.md", "name": "flujo", "svg": svg, "alt": "El flujo", "heading": "Flujo" }),
    );
    assert_eq!(added["image"], "adjuntos/flujo.svg");
    let saved = std::fs::read_to_string(d.path().join("rw/adjuntos/flujo.svg")).unwrap();
    assert!(saved.contains("<rect") && !saved.contains("script") && !saved.contains("onload"));
    let note = std::fs::read_to_string(d.path().join("rw/plan.md")).unwrap();
    let image = note.find("![El flujo](adjuntos/flujo.svg)").expect("the image is in the note");
    assert!(image > note.find("## Flujo").unwrap() && image < note.find("## Fin").unwrap(), "{note}");
    assert!(note.contains("%%diagrama de IA: El flujo%%"));

    // Base64 of a PNG signature and a byte.
    let png = c.ok(
        "add_diagram_image",
        json!({ "vault": "rw", "path": "plan.md", "name": "foto", "png_base64": "iVBORw0KGgoA", "alt": "x" }),
    );
    assert_eq!(png["image"], "adjuntos/foto.png");

    let (err, _) =
        c.call("add_diagram_image", json!({ "vault": "ro", "path": "base.md", "name": "n", "svg": svg, "alt": "x" }));
    assert!(err, "needs write access");
    let (err, _) = c.call(
        "add_diagram_image",
        json!({ "vault": "rw", "path": "plan.md", "name": "n", "svg": svg, "alt": "x", "heading": "No existe" }),
    );
    assert!(err);
    assert!(!d.path().join("rw/adjuntos/n.svg").exists(), "nothing is saved when the note cannot take it");
    let (err, _) = c.call("add_diagram_image", json!({ "vault": "rw", "path": "plan.md", "name": "n", "alt": "x" }));
    assert!(err, "an image is needed");
}
