//! `[[wikilinks]]` and relative Markdown links.

use crate::{Result, VaultFs};
use serde::Serialize;

/// Link targets found in a note, skipping code fences and inline code.
pub fn extract(content: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut fence: Option<&str> = None;
    for line in content.lines() {
        let trimmed = line.trim_start();
        let marker = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m));
        match (fence, marker) {
            (None, Some(m)) => fence = Some(m),
            (Some(open), Some(m)) if open == m => fence = None,
            _ => {}
        }
        if fence.is_some() || marker.is_some() {
            continue;
        }
        scan_line(&strip_inline_code(line), &mut out);
    }
    out
}

fn strip_inline_code(line: &str) -> String {
    line.split('`').step_by(2).collect::<Vec<_>>().join(" ")
}

fn scan_line(line: &str, out: &mut Vec<String>) {
    let mut rest = line;
    while let Some(start) = rest.find("[[") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find("]]") else { break };
        let target = rest[..end].split(['|', '#']).next().unwrap_or("").trim();
        if !target.is_empty() {
            out.push(target.to_string());
        }
        rest = &rest[end + 2..];
    }
    let mut rest = line;
    while let Some(start) = rest.find("](") {
        rest = &rest[start + 2..];
        let Some(end) = rest.find(')') else { break };
        let target = rest[..end].split('#').next().unwrap_or("").trim();
        let lower = target.to_ascii_lowercase();
        if !target.contains("://") && (lower.ends_with(".md") || lower.ends_with(".markdown")) {
            out.push(target.replace("%20", " "));
        }
        rest = &rest[end + 1..];
    }
}

fn stem(path: &str) -> &str {
    let name = path.rsplit('/').next().unwrap_or(path);
    name.rsplit_once('.').map_or(name, |(s, _)| s)
}

fn parent(path: &str) -> &str {
    path.rsplit_once('/').map_or("", |(dir, _)| dir)
}

/// Resolves a link written in `from` to a note: first as a path relative to
/// the note, then from the vault root, then by name anywhere in the vault.
pub fn resolve<'a>(target: &str, from: &str, notes: &'a [String]) -> Option<&'a String> {
    let clean = target.trim_start_matches("./").trim_start_matches('/');
    let without_ext = clean.strip_suffix(".md").unwrap_or(clean);
    let sibling = match parent(from) {
        "" => without_ext.to_string(),
        dir => format!("{dir}/{without_ext}"),
    };
    let same = |note: &str, wanted: &str| note.rsplit_once('.').map_or(note, |(s, _)| s).eq_ignore_ascii_case(wanted);
    notes
        .iter()
        .find(|n| same(n, &sibling))
        .or_else(|| notes.iter().find(|n| same(n, without_ext)))
        .or_else(|| notes.iter().find(|n| stem(n).eq_ignore_ascii_case(without_ext)))
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkInfo {
    pub outgoing: Vec<String>,
    pub unresolved: Vec<String>,
    pub backlinks: Vec<String>,
}

/// Outgoing links and backlinks of a note. Scans the whole vault.
pub fn info(vault: &VaultFs, path: &str) -> Result<LinkInfo> {
    let path = crate::paths::normalize(path)?;
    let notes = vault.notes()?;
    let (mut outgoing, mut unresolved) = (Vec::new(), Vec::new());
    for target in extract(&vault.read(&path)?.content) {
        match resolve(&target, &path, &notes) {
            Some(n) if !outgoing.contains(n) => outgoing.push(n.clone()),
            Some(_) => {}
            None if !unresolved.contains(&target) => unresolved.push(target),
            None => {}
        }
    }
    let mut backlinks = Vec::new();
    for note in notes.iter().filter(|n| **n != path) {
        let Ok(other) = vault.read(note) else { continue };
        let links_here = extract(&other.content).iter().any(|t| resolve(t, note, &notes) == Some(&path));
        if links_here {
            backlinks.push(note.clone());
        }
    }
    Ok(LinkInfo { outgoing, unresolved, backlinks })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WriteMode;

    #[test]
    fn extracts_links_outside_code() {
        let text = "[[Uno]] y [[dos/Tres#h|alias]] ![[img.md]]\n`[[no]]` [x](a%20b.md#s) [y](https://e.com/z.md)\n```\n[[tampoco]]\n```\n";
        assert_eq!(extract(text), ["Uno", "dos/Tres", "img.md", "a b.md"]);
    }

    #[test]
    fn resolution_order() {
        let notes: Vec<String> = ["Hola.md", "a/Hola.md", "a/b/Fin.md"].map(String::from).to_vec();
        assert_eq!(resolve("Hola", "a/x.md", &notes).unwrap(), "a/Hola.md");
        assert_eq!(resolve("hola", "z.md", &notes).unwrap(), "Hola.md");
        assert_eq!(resolve("Fin", "z.md", &notes).unwrap(), "a/b/Fin.md");
        assert!(resolve("Nada", "z.md", &notes).is_none());
    }

    #[test]
    fn computes_backlinks() {
        let d = tempfile::tempdir().unwrap();
        let v = VaultFs::new(d.path());
        v.write("a.md", "[[b]] [[falta]]", WriteMode::Create).unwrap();
        v.write("b.md", "[[a]]", WriteMode::Create).unwrap();
        v.write("c.md", "[[b]]", WriteMode::Create).unwrap();
        let i = info(&v, "b.md").unwrap();
        assert_eq!(i.outgoing, ["a.md"]);
        assert_eq!(i.backlinks, ["a.md", "c.md"]);
        assert_eq!(info(&v, "a.md").unwrap().unresolved, ["falta"]);
    }
}
