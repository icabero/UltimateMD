//! Tries the bundled MCP server the way a client would: starts it, greets it
//! and asks which vaults it sees. Whatever goes wrong is reported in words a
//! person can act on, together with what the server itself said.

use serde::Serialize;
use serde_json::{Value, json};
use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(10);

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SeenVault {
    name: String,
    access: String,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct McpCheck {
    /// The server answered and listed vaults.
    ok: bool,
    version: Option<String>,
    vaults: Vec<SeenVault>,
    /// Which step failed: `missing`, `start`, `silent`, `answer`.
    failed: Option<String>,
    /// What went wrong, as the system or the server said it.
    error: Option<String>,
}

fn failure(step: &str, error: impl Into<String>) -> McpCheck {
    McpCheck { failed: Some(step.into()), error: Some(error.into()), ..McpCheck::default() }
}

/// The vaults in a `list_vaults` reply.
fn vaults_in(result: &Value) -> Option<Vec<SeenVault>> {
    let text = result["content"][0]["text"].as_str()?;
    let list: Value = serde_json::from_str(text).ok()?;
    let vaults = list["vaults"].as_array()?;
    Some(
        vaults
            .iter()
            .map(|v| SeenVault {
                name: v["name"].as_str().unwrap_or_default().to_string(),
                access: v["access"].as_str().unwrap_or_default().to_string(),
            })
            .collect(),
    )
}

pub fn check(binary: &Path) -> McpCheck {
    if !binary.is_file() {
        return failure("missing", binary.display().to_string());
    }
    let mut command = Command::new(binary);
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // No console window flashing up.
        command.creation_flags(0x0800_0000);
    }
    let mut child = match command.spawn() {
        Ok(child) => child,
        Err(e) => return failure("start", e.to_string()),
    };
    let (Some(mut stdin), Some(stdout), Some(mut stderr)) =
        (child.stdin.take(), child.stdout.take(), child.stderr.take())
    else {
        let _ = child.kill();
        return failure("start", "no standard input or output");
    };

    // Replies arrive on a thread of their own, so a silent server cannot hang the check.
    let (tx, rx) = mpsc::channel::<Value>();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(std::result::Result::ok) {
            if let Ok(message) = serde_json::from_str::<Value>(&line)
                && tx.send(message).is_err()
            {
                break;
            }
        }
    });
    let mut send = |message: Value| writeln!(stdin, "{message}").and_then(|()| stdin.flush());
    let wait = |id: u64| loop {
        match rx.recv_timeout(TIMEOUT) {
            Ok(message) if message["id"] == id => break Ok(message),
            Ok(_) => continue,
            Err(e) => break Err(e),
        }
    };

    let outcome = (|| {
        let hello = json!({
            "jsonrpc": "2.0", "id": 1, "method": "initialize",
            "params": { "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "ultimatemd-check", "version": "1" } }
        });
        send(hello).map_err(|e| failure("start", e.to_string()))?;
        let init = wait(1).map_err(|_| failure("silent", ""))?;
        let version = init["result"]["serverInfo"]["version"].as_str().map(str::to_string);
        let _ = send(json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }));
        let call = json!({ "jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": { "name": "list_vaults", "arguments": {} } });
        send(call).map_err(|e| failure("answer", e.to_string()))?;
        let reply = wait(2).map_err(|_| failure("silent", ""))?;
        let result = &reply["result"];
        if result["isError"] == true || !reply["error"].is_null() {
            let said =
                result["content"][0]["text"].as_str().map(str::to_string).unwrap_or_else(|| reply["error"].to_string());
            return Err(failure("answer", said));
        }
        let vaults = vaults_in(result).ok_or_else(|| failure("answer", result.to_string()))?;
        Ok(McpCheck { ok: true, version, vaults, ..McpCheck::default() })
    })();

    let _ = child.kill();
    let _ = child.wait();
    outcome.unwrap_or_else(|mut failed| {
        // What the server wrote about itself says most when it fails.
        let mut said = String::new();
        let _ = stderr.read_to_string(&mut said);
        let said = said.trim();
        if !said.is_empty() {
            let before = failed.error.take().unwrap_or_default();
            failed.error = Some(if before.is_empty() { said.to_string() } else { format!("{before}\n{said}") });
        }
        failed
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_missing_server_is_reported_as_such() {
        let found = check(Path::new("/no/such/ultimatemd-mcp"));
        assert!(!found.ok);
        assert_eq!(found.failed.as_deref(), Some("missing"));
    }

    #[test]
    fn the_vaults_are_read_from_the_reply() {
        let reply = json!({ "content": [{ "type": "text", "text": "{\"vaults\":[{\"name\":\"Trabajo\",\"id\":\"a\",\"access\":\"read\"}]}" }] });
        assert_eq!(vaults_in(&reply), Some(vec![SeenVault { name: "Trabajo".into(), access: "read".into() }]));
        assert_eq!(vaults_in(&json!({ "content": [] })), None);
    }
}

#[cfg(test)]
mod real {
    /// Run by hand after building the server: cargo test -p ultimatemd real -- --ignored
    #[test]
    #[ignore]
    fn the_built_server_answers() {
        let exe = std::env::current_exe().unwrap();
        let dir = exe.parent().unwrap().parent().unwrap();
        let binary = dir.join(format!("ultimatemd-mcp{}", std::env::consts::EXE_SUFFIX));
        let found = super::check(&binary);
        println!("{found:?}");
        assert!(found.ok, "{found:?}");
    }
}
