//! `[[wikilinks]]` and relative Markdown links.

use crate::{Result, VaultFs, WriteMode};
use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq)]
enum Kind {
    Wiki,
    Markdown,
}

/// A link in a note. `start..end` is the target as written, without alias,
/// heading or surrounding spaces.
#[derive(Debug, Clone)]
struct Link {
    kind: Kind,
    start: usize,
    end: usize,
}

fn is_note_file(target: &str) -> bool {
    let lower = target.to_ascii_lowercase();
    lower.ends_with(".md") || lower.ends_with(".markdown")
}

/// Every link outside code fences and inline code, in order.
fn find_links(content: &str) -> Vec<Link> {
    let mut out = Vec::new();
    let mut fence: Option<&str> = None;
    let mut offset = 0;
    for raw in content.split_inclusive('\n') {
        let line = raw.trim_end_matches(['\n', '\r']);
        let trimmed = line.trim_start();
        let marker = ["```", "~~~"].into_iter().find(|m| trimmed.starts_with(m));
        match (fence, marker) {
            (None, Some(m)) => fence = Some(m),
            (Some(open), Some(m)) if open == m => fence = None,
            _ => {}
        }
        if fence.is_none() && marker.is_none() {
            scan_line(line, offset, &mut out);
        }
        offset += raw.len();
    }
    out
}

/// Byte ranges of a line that are inline code, between backticks.
fn code_spans(line: &str) -> Vec<(usize, usize)> {
    let ticks: Vec<usize> = line.match_indices('`').map(|(i, _)| i).collect();
    ticks.chunks(2).map(|p| (p[0], p.get(1).copied().unwrap_or(line.len()))).collect()
}

fn scan_line(line: &str, offset: usize, out: &mut Vec<Link>) {
    let code = code_spans(line);
    let in_code = |i: usize| code.iter().any(|&(a, b)| i > a && i < b);
    let kinds: [(&str, &str, &[char], Kind); 2] =
        [("[[", "]]", &['|', '#'], Kind::Wiki), ("](", ")", &['#'], Kind::Markdown)];
    let mut found = Vec::new();
    for (open, close, cut, kind) in kinds {
        let mut at = 0;
        while let Some(i) = line[at..].find(open) {
            let inner_start = at + i + open.len();
            let Some(len) = line[inner_start..].find(close) else { break };
            let inner = &line[inner_start..inner_start + len];
            at = inner_start + len + close.len();
            if in_code(inner_start) || inner.contains('`') {
                continue;
            }
            let target = inner.split(cut).next().unwrap_or("");
            let lead = target.len() - target.trim_start().len();
            let target = target.trim();
            if !target.is_empty() {
                let start = offset + inner_start + lead;
                found.push(Link { kind, start, end: start + target.len() });
            }
        }
    }
    found.sort_by_key(|l| l.start);
    out.extend(found);
}

/// Link targets to notes found in a note, skipping code fences and inline code.
pub fn extract(content: &str) -> Vec<String> {
    find_links(content)
        .into_iter()
        .filter_map(|l| {
            let target = &content[l.start..l.end];
            match l.kind {
                Kind::Wiki => Some(target.to_string()),
                Kind::Markdown if !target.contains("://") && is_note_file(target) => Some(target.replace("%20", " ")),
                Kind::Markdown => None,
            }
        })
        .collect()
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

/// What a move changed in other notes.
#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkUpdate {
    /// Links rewritten.
    pub links: usize,
    /// The notes rewritten, at their paths after the move.
    pub notes: Vec<String>,
}

/// Where `path` ends up when `from` moves to `to`, which may be a folder.
fn moved(path: &str, from: &str, to: &str) -> Option<String> {
    if path == from {
        return Some(to.to_string());
    }
    let rest = path.strip_prefix(from)?;
    rest.starts_with('/').then(|| format!("{to}{rest}"))
}

/// `rel` seen from the folder `dir`, with `.` and `..` worked out.
fn join_rel(dir: &str, rel: &str) -> Option<String> {
    let mut parts: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    for part in rel.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop()?;
            }
            p => parts.push(p),
        }
    }
    Some(parts.join("/"))
}

/// The path to `target` from the folder `dir`, both from the vault root.
fn relative(dir: &str, target: &str) -> String {
    let dir: Vec<&str> = dir.split('/').filter(|p| !p.is_empty()).collect();
    let target: Vec<&str> = target.split('/').collect();
    let common = dir.iter().zip(&target).take_while(|(a, b)| a == b).count();
    let mut parts = vec![".."; dir.len() - common];
    parts.extend(&target[common..]);
    parts.join("/")
}

fn without_ext(path: &str) -> &str {
    match path.rsplit_once('.') {
        Some((s, ext)) if !ext.contains('/') => s,
        _ => path,
    }
}

/// The vault before and after a move.
struct Places<'a> {
    vault: &'a VaultFs,
    from: &'a str,
    to: &'a str,
    before: &'a [String],
    after: &'a [String],
}

impl Places<'_> {
    fn after_move(&self, path: &str) -> String {
        moved(path, self.from, self.to).unwrap_or_else(|| path.to_string())
    }

    /// The new text for a link written in `note`, which is now at `here`, or
    /// `None` when the link still points where it did.
    fn relink(&self, kind: Kind, raw: &str, note: &str, here: &str) -> Option<String> {
        if kind == Kind::Markdown && (raw.contains(':') || raw.starts_with('#')) {
            return None;
        }
        if kind == Kind::Markdown && !is_note_file(raw) {
            return self.relink_file(raw, note, here);
        }
        if kind == Kind::Markdown {
            // Other programs follow a Markdown link only by its exact path.
            let decoded = raw.replace("%20", " ");
            let exact = |from: &str| match decoded.strip_prefix('/') {
                Some(from_root) => join_rel("", from_root),
                None => join_rel(parent(from), &decoded),
            };
            let old = exact(note);
            let target = match old.as_ref().and_then(|p| self.before.iter().find(|n| *n == p)) {
                Some(t) => t,
                None => resolve(&decoded, note, self.before)?,
            };
            let wanted = self.after_move(target);
            if note == here && *target == wanted {
                return None;
            }
            return (exact(here).as_deref() != Some(wanted.as_str())).then(|| markdown_path(raw, here, &wanted));
        }
        let target = resolve(raw, note, self.before)?;
        let wanted = self.after_move(target);
        let decoded = raw;
        if resolve(decoded, here, self.after) == Some(&wanted) {
            return None;
        }
        // A wikilink keeps its style: a bare name stays a name while it is
        // enough, and an extension written stays written.
        let ext = &decoded[without_ext(decoded).len()..];
        let with_ext = |s: &str| format!("{s}{ext}");
        let by_path = with_ext(without_ext(&wanted));
        let fits = |c: &String| resolve(c, here, self.after) == Some(&wanted);
        let mut candidates = Vec::new();
        if !decoded.contains('/') {
            candidates.push(with_ext(stem(&wanted)));
        }
        candidates.push(by_path.clone());
        Some(candidates.into_iter().find(fits).unwrap_or(by_path))
    }

    /// Images and other files reached with a relative Markdown link.
    fn relink_file(&self, raw: &str, note: &str, here: &str) -> Option<String> {
        let decoded = raw.replace("%20", " ");
        let old = match decoded.strip_prefix('/') {
            Some(from_root) => join_rel("", from_root)?,
            None => join_rel(parent(note), &decoded)?,
        };
        let new = self.after_move(&old);
        if note == here && new == old {
            return None;
        }
        self.vault.resolve_file(&old).ok()?;
        Some(markdown_path(raw, here, &new))
    }
}

/// A Markdown link to `target` from the note at `here`, from the root when the
/// original link was.
fn markdown_path(raw: &str, here: &str, target: &str) -> String {
    let path = if raw.starts_with('/') { format!("/{target}") } else { relative(parent(here), target) };
    path.replace(' ', "%20")
}

struct Rewrite {
    path: String,
    version: String,
    content: String,
    links: usize,
}

fn plan_move(vault: &VaultFs, from: &str, to: &str) -> Result<Vec<Rewrite>> {
    let before = vault.notes()?;
    let after: Vec<String> = before.iter().map(|n| moved(n, from, to).unwrap_or_else(|| n.clone())).collect();
    let places = Places { vault, from, to, before: &before, after: &after };
    let mut plan = Vec::new();
    for note in &before {
        let Ok(read) = vault.read(note) else { continue };
        let here = places.after_move(note);
        let mut content = String::with_capacity(read.content.len());
        let (mut at, mut links) = (0, 0);
        for link in find_links(&read.content) {
            let raw = &read.content[link.start..link.end];
            if let Some(text) = places.relink(link.kind, raw, note, &here) {
                content.push_str(&read.content[at..link.start]);
                content.push_str(&text);
                at = link.end;
                links += 1;
            }
        }
        if links > 0 {
            content.push_str(&read.content[at..]);
            plan.push(Rewrite { path: here, version: read.version, content, links });
        }
    }
    Ok(plan)
}

/// Moves or renames a note or folder and rewrites the links that would
/// otherwise break: those pointing into what moved, and the relative links
/// of the notes that moved. A note changed in the meantime is left alone.
pub fn move_path(vault: &VaultFs, from: &str, to: &str) -> Result<LinkUpdate> {
    let (from, to) = (crate::paths::normalize(from)?, crate::paths::normalize(to)?);
    // Planned first, while links still resolve against the vault as it was.
    let plan = plan_move(vault, &from, &to)?;
    vault.rename(&from, &to)?;
    let mut update = LinkUpdate::default();
    for r in plan {
        if vault.write(&r.path, &r.content, WriteMode::Replace(Some(&r.version))).is_ok() {
            update.links += r.links;
            update.notes.push(r.path);
        }
    }
    Ok(update)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn vault_with(files: &[(&str, &str)]) -> (tempfile::TempDir, VaultFs) {
        let d = tempfile::tempdir().unwrap();
        let v = VaultFs::new(d.path());
        for (path, content) in files {
            v.write(path, content, WriteMode::Create).unwrap();
        }
        (d, v)
    }

    fn text(v: &VaultFs, path: &str) -> String {
        v.read(path).unwrap().content
    }

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
        let (_d, v) = vault_with(&[("a.md", "[[b]] [[falta]]"), ("b.md", "[[a]]"), ("c.md", "[[b]]")]);
        let i = info(&v, "b.md").unwrap();
        assert_eq!(i.outgoing, ["a.md"]);
        assert_eq!(i.backlinks, ["a.md", "c.md"]);
        assert_eq!(info(&v, "a.md").unwrap().unresolved, ["falta"]);
    }

    #[test]
    fn renaming_updates_wikilinks_keeping_aliases_and_headings() {
        let (_d, v) = vault_with(&[
            ("Plan.md", "# Plan\n"),
            ("a.md", "Ver [[Plan]], [[plan#Fechas|las fechas]] y [[Plan.md]].\n`[[Plan]]`\n```\n[[Plan]]\n```\n"),
            ("b.md", "[[Otra]]\n"),
        ]);
        let update = move_path(&v, "Plan.md", "Proyecto.md").unwrap();
        assert_eq!(
            text(&v, "a.md"),
            "Ver [[Proyecto]], [[Proyecto#Fechas|las fechas]] y [[Proyecto.md]].\n`[[Plan]]`\n```\n[[Plan]]\n```\n"
        );
        assert_eq!((update.links, update.notes), (3, vec!["a.md".to_string()]));
        assert_eq!(text(&v, "b.md"), "[[Otra]]\n");
    }

    #[test]
    fn moving_keeps_links_that_still_resolve() {
        let (_d, v) = vault_with(&[("Plan.md", ""), ("a.md", "[[Plan]] [x](Plan.md)\n")]);
        let update = move_path(&v, "Plan.md", "dir/Plan.md").unwrap();
        // The name finds the note anywhere; the relative path needs the folder.
        assert_eq!(text(&v, "a.md"), "[[Plan]] [x](dir/Plan.md)\n");
        assert_eq!(update.links, 1);
    }

    #[test]
    fn a_name_that_becomes_ambiguous_gets_its_path() {
        let (_d, v) = vault_with(&[("x/Plan.md", ""), ("y/Plan.md", ""), ("y/a.md", "[[Plan]]\n")]);
        move_path(&v, "y/Plan.md", "z/Plan.md").unwrap();
        assert_eq!(text(&v, "y/a.md"), "[[z/Plan]]\n");
    }

    #[test]
    fn a_moved_note_keeps_its_relative_links_and_images() {
        let (_d, v) = vault_with(&[
            ("a/n.md", "[o](../otra.md) ![i](img%20uno.png) [w](https://e.com/x.md) [h](#t) [[otra]]\n"),
            ("otra.md", ""),
            ("a/img uno.png", ""),
        ]);
        move_path(&v, "a/n.md", "b/c/n.md").unwrap();
        assert_eq!(
            text(&v, "b/c/n.md"),
            "[o](../../otra.md) ![i](../../a/img%20uno.png) [w](https://e.com/x.md) [h](#t) [[otra]]\n"
        );
    }

    #[test]
    fn moving_a_folder_updates_links_into_it() {
        let (_d, v) = vault_with(&[
            ("dir/Uno.md", "[dos](sub/Dos.md)\n"),
            ("dir/sub/Dos.md", ""),
            ("raiz.md", "[[dir/Uno]] [d](dir/sub/Dos.md) [abs](/dir/Uno.md)\n"),
        ]);
        let update = move_path(&v, "dir", "nuevo/dir2").unwrap();
        assert_eq!(text(&v, "raiz.md"), "[[nuevo/dir2/Uno]] [d](nuevo/dir2/sub/Dos.md) [abs](/nuevo/dir2/Uno.md)\n");
        // Moved together, so the relative link still works.
        assert_eq!(text(&v, "nuevo/dir2/Uno.md"), "[dos](sub/Dos.md)\n");
        assert_eq!(update.notes, ["raiz.md"]);
    }

    #[test]
    fn a_failed_move_changes_nothing() {
        let (_d, v) = vault_with(&[("a.md", ""), ("b.md", ""), ("c.md", "[[a]]\n")]);
        assert!(move_path(&v, "a.md", "b.md").is_err());
        assert_eq!(text(&v, "c.md"), "[[a]]\n");
    }

    #[test]
    fn path_helpers() {
        assert_eq!(relative("a/b", "a/c/x.md"), "../c/x.md");
        assert_eq!(relative("", "x.md"), "x.md");
        assert_eq!(join_rel("a/b", "../c/./x.md").unwrap(), "a/c/x.md");
        assert!(join_rel("", "../x").is_none());
        assert_eq!(moved("dir/x.md", "dir", "d2").unwrap(), "d2/x.md");
        assert!(moved("dirx/x.md", "dir", "d2").is_none());
        assert_eq!(without_ext("a.b/c"), "a.b/c");
    }
}
