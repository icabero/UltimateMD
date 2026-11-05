//! Full-text search. Plain scanning is fast enough for vaults of thousands of
//! notes and means there is no index that can go stale.

use crate::{Result, VaultFs};
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub path: String,
    pub line: usize,
    pub text: String,
}

const MAX_TEXT: usize = 200;

/// Finds lines containing every word of `query`, ignoring case. A note whose
/// file name matches ranks first and reports line 0.
pub fn search(vault: &VaultFs, query: &str, limit: usize) -> Result<Vec<SearchHit>> {
    let terms: Vec<String> = query.to_lowercase().split_whitespace().map(String::from).collect();
    if terms.is_empty() {
        return Ok(Vec::new());
    }
    let matches = |text: &str| {
        let lower = text.to_lowercase();
        terms.iter().all(|t| lower.contains(t))
    };
    let notes = vault.notes()?;
    let mut hits: Vec<SearchHit> = notes
        .iter()
        .filter(|p| matches(p))
        .map(|p| SearchHit { path: p.clone(), line: 0, text: String::new() })
        .take(limit)
        .collect();
    for path in &notes {
        if hits.len() >= limit {
            break;
        }
        let Ok(note) = vault.read(path) else { continue };
        for (i, line) in note.content.lines().enumerate() {
            if matches(line) {
                hits.push(SearchHit {
                    path: path.clone(),
                    line: i + 1,
                    text: line.trim().chars().take(MAX_TEXT).collect(),
                });
                if hits.len() >= limit {
                    break;
                }
            }
        }
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::WriteMode;

    #[test]
    fn finds_case_insensitive_and_all_terms() {
        let d = tempfile::tempdir().unwrap();
        let v = VaultFs::new(d.path());
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
    fn respects_limit() {
        let d = tempfile::tempdir().unwrap();
        let v = VaultFs::new(d.path());
        v.write("a.md", "x\nx\nx\nx\n", WriteMode::Create).unwrap();
        assert_eq!(search(&v, "x", 2).unwrap().len(), 2);
    }
}
