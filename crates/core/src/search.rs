//! Full-text search. Plain scanning is fast enough for vaults of thousands of
//! notes and means there is no index that can go stale.

use crate::{Result, VaultFs};
use serde::Serialize;
use unicode_normalization::char::{decompose_canonical, is_combining_mark};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub text: String,
    /// How well the whole note matches. Every hit of a note shares it.
    pub score: u32,
}

const MAX_TEXT: usize = 200;
/// Characters kept before the first match when the start of a line is cut.
const LEAD: usize = 24;
const NAME_SCORE: u32 = 100;
const HEADING_SCORE: u32 = 10;
const LINE_SCORE: u32 = 1;

fn fold_char(c: char, out: &mut String) {
    decompose_canonical(c, |d| {
        if !is_combining_mark(d) {
            out.extend(d.to_lowercase());
        }
    });
}

/// Lower case without accents, so that "reunion" finds "Reunión".
pub fn fold(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        fold_char(c, &mut out);
    }
    out
}

fn is_heading(line: &str) -> bool {
    let line = line.trim_start();
    let rest = line.trim_start_matches('#');
    rest.len() < line.len() && (rest.is_empty() || rest.starts_with(' '))
}

/// The line, trimmed and cut so that the first match is near the start.
fn snippet(line: &str, terms: &[String]) -> String {
    let chars: Vec<char> = line.trim().chars().collect();
    let mut folded = String::new();
    // The character each byte of `folded` comes from.
    let mut owner = Vec::new();
    for (i, c) in chars.iter().enumerate() {
        fold_char(*c, &mut folded);
        owner.resize(folded.len(), i);
    }
    let first = terms.iter().filter_map(|t| folded.find(t.as_str())).min().map_or(0, |b| owner[b]);
    let mut start = first.saturating_sub(LEAD);
    if start > 0 {
        // Starts at a word when there is one close before.
        if let Some(space) = chars[start..first].iter().position(|c| c.is_whitespace()) {
            start += space + 1;
        }
    }
    let text: String = chars[start..].iter().take(MAX_TEXT).collect();
    if start > 0 { format!("…{text}") } else { text }
}

/// Finds lines containing every word of `query`, ignoring case and accents.
/// A note whose name matches reports line 0. Notes come best first: a match
/// in the name counts most, then headings, then other lines.
pub fn search(vault: &VaultFs, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let terms: Vec<String> = fold(query).split_whitespace().map(String::from).collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let matches = |text: &str| {
        let folded = fold(text);
        terms.iter().all(|t| folded.contains(t.as_str()))
    };
    let hit = |path: &str, line, text| SearchHit { path: path.to_string(), line, text, score: 0 };
    let mut found: Vec<(u32, Vec<SearchHit>)> = Vec::new();
    for path in vault.notes()? {
        let mut score = 0;
        let mut hits = Vec::new();
        let name = path.rsplit_once('.').map_or(path.as_str(), |(stem, _)| stem);
        if matches(name) {
            score += NAME_SCORE;
            hits.push(hit(&path, 0, String::new()));
        }
        if let Ok(note) = vault.read(&path) {
            for (i, line) in note.content.lines().enumerate() {
                if hits.len() >= limit {
                    break;
                }
                if matches(line) {
                    score += if is_heading(line) { HEADING_SCORE } else { LINE_SCORE };
                    hits.push(hit(&path, i + 1, snippet(line, &terms)));
                }
            }
        }
        if !hits.is_empty() {
            found.push((score, hits));
        }
    }
    // Stable, so notes that score the same keep the vault's order.
    found.sort_by(|a, b| b.0.cmp(&a.0));
    Ok(found
        .into_iter()
        .flat_map(|(score, hits)| hits.into_iter().map(move |h| SearchHit { score, ..h }))
        .take(limit)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WriteMode;

    fn vault() -> (tempfile::TempDir, VaultFs) {
        let d = tempfile::tempdir().unwrap();
        let v = VaultFs::new(d.path());
        (d, v)
    }

    #[test]
    fn finds_case_insensitive_and_all_terms() {
        let (_d, v) = vault();
        v.write("Reunión.md", "uno\nEl PRESUPUESTO de marzo\nmarzo solo\n", WriteMode::Create).unwrap();
        v.write("otra.md", "nada", WriteMode::Create).unwrap();
        let hits = search(&v, "presupuesto MARZO", 10).unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!((hits[0].path.as_str(), hits[0].line), ("Reunión.md", 2));
        let by_name = search(&v, "reunión", 10).unwrap();
        assert_eq!(by_name[0].line, 0);
        assert!(search(&v, "  ", 10).unwrap().is_empty());
    }

    #[test]
    fn ignores_accents_both_ways() {
        let (_d, v) = vault();
        v.write("Reunión.md", "Acción pendiente\n", WriteMode::Create).unwrap();
        // Decomposed accents, as some systems store them.
        v.write("b.md", "cancio\u{301}n\n", WriteMode::Create).unwrap();
        let hits = search(&v, "reunion", 10).unwrap();
        assert_eq!((hits[0].path.as_str(), hits[0].line), ("Reunión.md", 0));
        assert_eq!(search(&v, "ACCION", 10).unwrap()[0].line, 1);
        assert_eq!(search(&v, "canción", 10).unwrap()[0].path, "b.md");
        assert_eq!(fold("Ñandú ÄÖ"), "nandu ao");
    }

    #[test]
    fn the_extension_is_not_part_of_the_name() {
        let (_d, v) = vault();
        v.write("a.md", "x\n", WriteMode::Create).unwrap();
        assert!(search(&v, "md", 10).unwrap().is_empty());
    }

    #[test]
    fn ranks_names_then_headings_then_lines() {
        let (_d, v) = vault();
        v.write("a.md", "plan\nplan\n", WriteMode::Create).unwrap();
        v.write("b.md", "## Plan\n", WriteMode::Create).unwrap();
        v.write("plan.md", "nada\n", WriteMode::Create).unwrap();
        let hits = search(&v, "plan", 10).unwrap();
        let order: Vec<_> = hits.iter().map(|h| (h.path.as_str(), h.line)).collect();
        assert_eq!(order, [("plan.md", 0), ("b.md", 1), ("a.md", 1), ("a.md", 2)]);
        assert_eq!(hits[2].score, hits[3].score);
    }

    #[test]
    fn long_lines_start_near_the_match() {
        let terms = vec!["clave".to_string()];
        let long = format!("{} la palabra clave aquí", "relleno ".repeat(30));
        let text = snippet(&long, &terms);
        assert!(text.starts_with('…'), "{text}");
        assert!(text.chars().position(|c| c == 'c').unwrap() <= LEAD + 1, "{text}");
        assert!(text.contains("palabra clave"), "{text}");
        assert_eq!(snippet("  clave al principio ", &terms), "clave al principio");
    }

    #[test]
    fn respects_limit() {
        let (_d, v) = vault();
        v.write("a.md", "x\nx\nx\nx\n", WriteMode::Create).unwrap();
        assert_eq!(search(&v, "x", 2).unwrap().len(), 2);
    }
}
